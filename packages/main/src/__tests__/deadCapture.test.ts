import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { getDb, closeDb } from '../db/client';
import { DEFAULT_SETTINGS } from '@turingyde/transcript-core';
import { captureIsDead, captureFailureReason } from '../audio/index';
import type { AudioCaptureSession, CaptureResult } from '../audio/index';
import { RecordingPipeline } from '../stt/pipeline';

// On 2026-08-05 the bundled Linux ffmpeg had no pulse input device compiled in.
// It exited on its first line, wrote nothing, and — because autostop is driven
// by silencedetect events parsed off that same ffmpeg's stderr — could never
// fire. The app claimed to be recording for nearly five hours. These tests cover
// the two halves of the answer: telling a dead capture from a wounded one, and
// ending the recording the moment that call comes back positive.

const exited = { pid: 42, exitCode: 1, signalCode: null };
const running = { pid: 42, exitCode: null, signalCode: null };
// spawn() itself failed — a missing binary. Node leaves exitCode null here, so
// this is the case a liveness test written only against exitCode gets backwards.
const neverSpawned = { pid: undefined, exitCode: null, signalCode: null };

describe('captureIsDead', () => {
  const empty = () => 44; // a bare WAV header
  const audio = () => 96_344;

  it('calls a capture dead when every process exited and no channel holds audio', () => {
    expect(captureIsDead([exited, exited], ['mic.wav', 'sys.wav'], empty)).toBe(true);
  });

  it('treats a process that never spawned as dead, not as running', () => {
    expect(captureIsDead([neverSpawned], ['mic.wav'], empty)).toBe(true);
  });

  it('spares a capture with one process still running', () => {
    expect(captureIsDead([exited, running], ['mic.wav', 'sys.wav'], empty)).toBe(false);
  });

  // The asymmetry that makes acting on this safe. A microphone that dies forty
  // minutes into a call has forty minutes worth salvaging; ending the meeting
  // over it would destroy the very thing the check exists to protect.
  it('spares a dead capture that already wrote audio', () => {
    expect(captureIsDead([exited, exited], ['mic.wav', 'sys.wav'], p => p === 'mic.wav' ? audio() : 44)).toBe(false);
  });

  it('ignores a null process — a channel that was never opened cannot keep one alive', () => {
    expect(captureIsDead([null, exited], ['sys.wav'], empty)).toBe(true);
  });
});

describe('captureFailureReason', () => {
  it("quotes ffmpeg's own complaint", () => {
    const reason = captureFailureReason(
      'ffmpeg version 7.1.1\n  built with gcc 12\n[in#0] Unknown input format: \'pulse\'\n',
    );
    expect(reason).toContain("Unknown input format: 'pulse'");
  });

  it('still says something when the process printed nothing useful', () => {
    expect(captureFailureReason('')).toMatch(/no audio was recorded/);
  });
});

// --- the pipeline half -------------------------------------------------------

class FakeCapture implements AudioCaptureSession {
  reason: string | null = null;
  /** Emit 'error' from inside start(), the way an ffmpeg that dies at spawn does. */
  dieDuringStart = false;
  stopCalled = false;
  private handlers = new Map<string, Array<(arg: unknown) => void>>();

  async start(): Promise<void> {
    if (this.dieDuringStart) {
      this.reason = 'Recording stopped: the audio capture process exited immediately and no audio was recorded.';
      this.emit('error', new Error('microphone capture stopped unexpectedly (ffmpeg exit 1)'));
    }
  }

  async stop(): Promise<CaptureResult> {
    this.stopCalled = true;
    throw new Error('Recording produced no audio — the capture process never started.');
  }

  captureFailure(): string | null { return this.reason; }

  on(event: 'autostop', cb: () => void): this;
  on(event: 'error', cb: (err: Error) => void): this;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, cb: (arg: any) => void): this {
    if (!this.handlers.has(event)) this.handlers.set(event, []);
    this.handlers.get(event)!.push(cb);
    return this;
  }

  private emit(event: string, arg?: unknown): void {
    this.handlers.get(event)?.forEach(cb => cb(arg));
  }
}

// Named with the `mock` prefix so vitest's hoisting of vi.mock() below is happy
// with the factory closing over it.
let mockFake: FakeCapture;

vi.mock('../audio/index', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../audio/index')>();
  return { ...actual, createAudioCapture: () => mockFake };
});



describe('RecordingPipeline with a capture that dies', () => {
  let dir: string;
  let send: ReturnType<typeof vi.fn>;
  let win: { showInactive: ReturnType<typeof vi.fn>; setAlwaysOnTop: ReturnType<typeof vi.fn> };
  let pipeline: RecordingPipeline;

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'te-dead-'));
    getDb(path.join(dir, 'meetings.db'));
    mockFake = new FakeCapture();
    send = vi.fn();
    win = {
      isDestroyed: () => false, isVisible: () => false, isFocused: () => false,
      isMinimized: () => false, restore: vi.fn(), show: vi.fn(),
      showInactive: vi.fn(), setAlwaysOnTop: vi.fn(), flashFrame: vi.fn(),
      webContents: { send },
    } as never;
    pipeline = new RecordingPipeline(dir, { ...DEFAULT_SETTINGS }, win as never);
  });
  afterEach(() => { closeDb(); rmSync(dir, { recursive: true, force: true }); });

  const meetingCount = () =>
    (getDb().prepare('SELECT COUNT(*) AS n FROM meetings').get() as { n: number }).n;

  it('starts normally when the capture is alive', async () => {
    const id = await pipeline.start();
    expect(id).toBeTruthy();
    expect(pipeline.getState().isRecording).toBe(true);
    expect(send).not.toHaveBeenCalledWith('recording:failed', expect.anything());
  });

  it('refuses to return a recording that is already over', async () => {
    mockFake.reason = "Recording stopped: … Unknown input format: 'pulse'";
    await expect(pipeline.start()).rejects.toThrow(/Unknown input format/);
    expect(pipeline.getState().isRecording).toBe(false);
  });

  it('removes the empty meeting rather than leaving a 0:00 ghost', async () => {
    mockFake.reason = 'dead';
    await expect(pipeline.start()).rejects.toThrow();
    expect(meetingCount()).toBe(0);
  });

  // The whole point: the window was hidden in the tray for five hours while a
  // banner nobody could see was the only notice given.
  it('tells the renderer and raises the window', async () => {
    mockFake.reason = 'dead';
    await expect(pipeline.start()).rejects.toThrow();
    expect(send).toHaveBeenCalledWith('recording:failed', 'dead');
    expect(win.showInactive).toHaveBeenCalled();
    expect(win.setAlwaysOnTop).toHaveBeenCalledWith(true);
  });

  // Linux resolves the mic source and settles the echo-cancel module inside
  // start(), which takes longer than an ffmpeg with a bad argument takes to
  // exit. The error therefore arrives before there is any recording state to
  // tear down, and the check after start() is what catches it.
  it('catches a capture that dies during start(), before the state exists', async () => {
    mockFake.dieDuringStart = true;
    await expect(pipeline.start()).rejects.toThrow(/no audio was recorded/);
    expect(pipeline.getState().isRecording).toBe(false);
    expect(meetingCount()).toBe(0);
    expect(mockFake.stopCalled).toBe(true); // teardown still runs: Linux has a module to unload
  });

  it('ends the recording only once, however many errors arrive', async () => {
    mockFake.dieDuringStart = true;
    await expect(pipeline.start()).rejects.toThrow();
    const failures = send.mock.calls.filter(c => c[0] === 'recording:failed');
    expect(failures).toHaveLength(1);
  });
});
