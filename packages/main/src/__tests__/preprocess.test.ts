import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, existsSync } from 'fs';
import path from 'path';
import { tmpdir } from 'os';
import { EventEmitter } from 'events';

vi.mock('child_process', () => ({ spawn: vi.fn() }));

import { preprocessAudio, buildFilterArgs } from '../stt/preprocess';
import { spawn } from 'child_process';

function makeSpawnMock(exitCode: number, outputSizeBytes = 4096) {
  return vi.mocked(spawn).mockImplementation((_cmd, args) => {
    const ee = new EventEmitter() as ReturnType<typeof spawn>;
    const outPath = (args as string[])[args!.length - 1];
    if (outPath && exitCode === 0) writeFileSync(outPath, Buffer.alloc(outputSizeBytes));
    setTimeout(() => ee.emit('close', exitCode), 0);
    return Object.assign(ee, {
      stdin: null, stdout: null, stderr: null, pid: 1, killed: false,
    }) as ReturnType<typeof spawn>;
  });
}

describe('preprocessAudio', () => {
  let dir: string;
  let inputPath: string;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'tu-pre-'));
    inputPath = path.join(dir, 'test.wav');
    writeFileSync(inputPath, Buffer.alloc(8192));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('returns the preprocessed path when ffmpeg succeeds', async () => {
    makeSpawnMock(0, 4096);
    const result = await preprocessAudio(inputPath, 'mtg-abc', dir, 1);
    expect(result).toContain('mtg-abc_pre.wav');
    expect(result).not.toBe(inputPath);
  });

  it('falls back to original when ffmpeg exits non-zero', async () => {
    makeSpawnMock(1);
    const result = await preprocessAudio(inputPath, 'mtg-abc', dir, 1);
    expect(result).toBe(inputPath);
  });

  it('falls back to original when output is smaller than 1 KB', async () => {
    makeSpawnMock(0, 512);
    const result = await preprocessAudio(inputPath, 'mtg-abc', dir, 1);
    expect(result).toBe(inputPath);
  });

  it('cleans up the _pre file on fallback', async () => {
    makeSpawnMock(1);
    await preprocessAudio(inputPath, 'mtg-abc', dir, 1);
    const prePath = path.join(dir, 'recordings', 'mtg-abc_pre.wav');
    expect(existsSync(prePath)).toBe(false);
  });

  // Deepgram bills multichannel audio PER CHANNEL. If a stereo file ever reaches
  // the API, a one-hour meeting bills as two and $0.26/hr becomes $0.52/hr. This
  // is the guard for that.
  it.each([1, 2])('always emits mono, whatever the input channel count (%i)', async (channels) => {
    const mock = makeSpawnMock(0, 4096);
    await preprocessAudio(inputPath, 'mtg-abc', dir, channels);
    const args = mock.mock.calls[0][1] as string[];
    const acIndex = args.lastIndexOf('-ac');
    expect(acIndex).toBeGreaterThan(-1);
    expect(args[acIndex + 1]).toBe('1');
    expect(args).not.toContain('2');
  });
});

describe('buildFilterArgs', () => {
  it('normalizes a mono capture without a mix stage', () => {
    const args = buildFilterArgs(1);
    expect(args[0]).toBe('-af');
    expect(args[1]).toContain('loudnorm');
    expect(args[1]).not.toContain('amix');
  });

  it('gates the mic channel before mixing so bleed is not doubled', () => {
    const [flag, graph, mapFlag, mapTarget] = buildFilterArgs(2);
    expect(flag).toBe('-filter_complex');
    expect(mapFlag).toBe('-map');
    expect(mapTarget).toBe('[out]');
    // Left (mic) must pass through the gate before reaching amix — mixing an
    // ungated mic with the clean system tap makes every remote voice appear
    // twice, offset by the capture start-skew.
    expect(graph).toMatch(/\[l\]agate=[^[]*\[lg\]/);
    expect(graph.indexOf('[lg][rg]amix')).toBeGreaterThan(graph.indexOf('agate'));
    // amix must not renormalize, or both sides get halved.
    expect(graph).toContain('normalize=0');
    expect(graph).toContain('loudnorm');
  });

  // A mic and a conferencing app's output are not level-matched — measured
  // 16.1 dB apart on a real call — and folding them together without matching
  // first is what made the local speaker's words go missing.
  it('normalizes each channel before folding them together', () => {
    const [, graph] = buildFilterArgs(2);
    expect(graph).toMatch(/\[l\]agate=[^[]*,loudnorm\[lg\]/);
    expect(graph).toContain('[r]loudnorm[rg]');
    expect(graph.indexOf('loudnorm')).toBeLessThan(graph.indexOf('amix'));
  });

  // The gate exists to mute the mic's noise floor, not the person talking into
  // it. Its threshold must stay well under real speech (a median -41 dBFS on
  // the call that exposed this) instead of sitting above it.
  it('gates far below speech level and attenuates rather than deleting', () => {
    const [, graph] = buildFilterArgs(2);
    const threshold = Number(/agate=threshold=([\d.]+)/.exec(graph)?.[1]);
    expect(threshold).toBeLessThanOrEqual(0.002); // <= about -54 dBFS
    expect(graph).not.toMatch(/agate=[^[]*range=0[,:\][]/);
  });
});
