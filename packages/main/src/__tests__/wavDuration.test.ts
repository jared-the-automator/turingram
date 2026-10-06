import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { wavDurationSec } from '../audio/wavDuration';

let dir: string;

beforeAll(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tgr-wav-')); });
afterAll(() => { fs.rmSync(dir, { recursive: true, force: true }); });

function chunk(id: string, body: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.write(id, 0, 4, 'ascii');
  head.writeUInt32LE(body.length, 4);
  // Word alignment: an odd-length chunk carries a pad byte the length excludes.
  const pad = body.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0);
  return Buffer.concat([head, body, pad]);
}

function fmtChunk(rate: number, channels: number, bits: number): Buffer {
  const b = Buffer.alloc(16);
  b.writeUInt16LE(1, 0);                                  // PCM
  b.writeUInt16LE(channels, 2);
  b.writeUInt32LE(rate, 4);
  b.writeUInt32LE(rate * channels * (bits / 8), 8);        // byteRate
  b.writeUInt16LE(channels * (bits / 8), 12);              // block align
  b.writeUInt16LE(bits, 14);
  return chunk('fmt ', b);
}

/** Writes a WAV and returns its path. `extra` chunks land between fmt and data. */
function writeWav(
  name: string,
  opts: { rate?: number; channels?: number; bits?: number; seconds?: number; extra?: Buffer[]; truncateBy?: number } = {},
): string {
  const { rate = 16000, channels = 1, bits = 16, seconds = 1, extra = [], truncateBy = 0 } = opts;
  const byteRate = rate * channels * (bits / 8);
  const data = chunk('data', Buffer.alloc(Math.round(byteRate * seconds)));
  const body = Buffer.concat([Buffer.from('WAVE', 'ascii'), fmtChunk(rate, channels, bits), ...extra, data]);
  const riff = Buffer.alloc(8);
  riff.write('RIFF', 0, 4, 'ascii');
  riff.writeUInt32LE(body.length, 4);
  const full = Buffer.concat([riff, body]);
  const file = path.join(dir, name);
  fs.writeFileSync(file, truncateBy ? full.subarray(0, full.length - truncateBy) : full);
  return file;
}

describe('wavDurationSec', () => {
  it('reads the duration of the 16 kHz mono file Turingram actually writes', () => {
    expect(wavDurationSec(writeWav('mono.wav', { seconds: 12.5 }))).toBeCloseTo(12.5, 3);
  });

  it('accounts for channels and bit depth, not just byte count', () => {
    // Same 3 seconds, four times the bytes. A naive size/rate would say 12.
    expect(wavDurationSec(writeWav('stereo.wav', { channels: 2, bits: 32, seconds: 3 }))).toBeCloseTo(3, 3);
  });

  it('skips a LIST chunk sitting between fmt and data', () => {
    // ffmpeg writes LIST/INFO when it has metadata. Assuming data comes second
    // would measure the metadata instead of the samples.
    const extra = [chunk('LIST', Buffer.concat([
      Buffer.from('INFOISFT', 'ascii'),
      Buffer.from([6, 0, 0, 0]),
      Buffer.from('Lavf61', 'ascii'),
    ]))];
    expect(wavDurationSec(writeWav('listed.wav', { seconds: 4, extra }))).toBeCloseTo(4, 3);
  });

  it('handles an odd-length chunk without losing sync on the pad byte', () => {
    const extra = [chunk('junk', Buffer.alloc(7))];
    expect(wavDurationSec(writeWav('odd.wav', { seconds: 2, extra }))).toBeCloseTo(2, 3);
  });

  it('reports what is on disk when a killed capture leaves the header overstating data', () => {
    // The header claims 10 s; half the samples never got written. Trusting the
    // header here would pad the OTHER channel out to a length this file never
    // reaches, which is worse than not padding at all.
    const byteRate = 16000 * 2;
    const file = writeWav('killed.wav', { seconds: 10, truncateBy: byteRate * 5 });
    expect(wavDurationSec(file)).toBeCloseTo(5, 2);
  });

  it('returns 0 rather than throwing for a missing file', () => {
    expect(wavDurationSec(path.join(dir, 'nope.wav'))).toBe(0);
  });

  it('returns 0 for a file that is not a WAV', () => {
    const file = path.join(dir, 'notwav.bin');
    fs.writeFileSync(file, Buffer.alloc(2048, 7));
    expect(wavDurationSec(file)).toBe(0);
  });

  it('returns 0 for a header with no data chunk', () => {
    const body = Buffer.concat([Buffer.from('WAVE', 'ascii'), fmtChunk(16000, 1, 16)]);
    const riff = Buffer.alloc(8);
    riff.write('RIFF', 0, 4, 'ascii');
    riff.writeUInt32LE(body.length, 4);
    const file = path.join(dir, 'headeronly.wav');
    fs.writeFileSync(file, Buffer.concat([riff, body]));
    expect(wavDurationSec(file)).toBe(0);
  });

  it('returns 0 for an empty file', () => {
    const file = path.join(dir, 'empty.wav');
    fs.writeFileSync(file, Buffer.alloc(0));
    expect(wavDurationSec(file)).toBe(0);
  });
});
