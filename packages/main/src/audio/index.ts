import fs from 'fs';
import type { AudioDevice } from '@turingyde/transcript-core';

export interface CaptureResult {
  audioPath: string
  isStereo: boolean  // true = mic left, system right; transcribed per-channel
  // Set when capture succeeded but produced less than it should have — the
  // system-audio half failing while the microphone kept working, say. The result
  // is a transcript with every voice collapsed into one speaker, which looks like
  // a bad diarization model rather than a permission the user denied. Nothing
  // downstream can infer this from the audio, so the backend has to say it.
  warning?: string
}

export interface AudioCaptureSession {
  start(): Promise<void>
  stop(): Promise<CaptureResult>
  /**
   * A sentence explaining why this capture is dead, or null while it is alive
   * or still salvageable. See captureIsDead for what "dead" means and why the
   * caller can act on it without risking a real meeting.
   */
  captureFailure(): string | null
  on(event: 'error', cb: (err: Error) => void): this
  on(event: 'autostop', cb: () => void): this
  // No 'level' event: no backend has ever emitted one. The recording screen's
  // meter taps the microphone itself via getUserMedia rather than routing levels
  // through the main process.
}

/** A process handle far enough along to say whether it is still running. */
export interface LiveProcess {
  // undefined when the spawn itself failed (a missing binary, a directory that
  // is not executable). Node leaves exitCode null in that case, so a liveness
  // test written only against exitCode reads a process that never existed as
  // still running — which is the one reading this code must not get wrong.
  pid?: number
  exitCode: number | null
  signalCode: NodeJS.Signals | null
}

function isRunning(p: LiveProcess): boolean {
  return p.pid !== undefined && p.exitCode === null && p.signalCode === null;
}

/** statSync().size, or 0 for a file that is not there. */
export function sizeOnDisk(p: string): number {
  try { return fs.statSync(p).size; } catch { return 0; }
}

// A capture that dies takes the recording with it and nothing downstream
// notices. Autostop is driven by silencedetect events parsed off ffmpeg's
// stderr, so no ffmpeg means no events, which means the silence timer can never
// fire: on 2026-08-05 a recording whose ffmpeg exited at spawn ran for five
// hours before anyone opened the window and looked.
//
// The test is deliberately conjunctive — every encoder dead AND no channel
// holding audio. A microphone that dies forty minutes into a call has forty
// minutes worth salvaging and must not end the meeting; a capture that never
// opened its device has nothing to lose. That asymmetry is what makes acting on
// this safe, because a false positive can only fire when there is no audio to
// throw away.
export function captureIsDead(
  procs: Array<LiveProcess | null>,
  paths: string[],
  sizeOf: (p: string) => number = sizeOnDisk,
): boolean {
  if (procs.some(p => p !== null && isRunning(p))) return false;
  // 44 bytes is a bare WAV header: ffmpeg opened the file and captured nothing.
  return !paths.some(p => sizeOf(p) > 44);
}

// Quote the capture process's own complaint rather than paraphrasing it. The
// 2026-08-05 failure took a full debugging session to identify and ffmpeg had
// been printing the answer — "Unknown input format: 'pulse'" — into a stderr
// pipe that only the silence parser was reading.
export function captureFailureReason(stderr: string): string {
  const detail = stderr
    .split('\n')
    .map(l => l.trim())
    .filter(l => /\b(error|unknown|failed|denied|no such|invalid|cannot|permission)\b/i.test(l))
    .pop();
  return 'Recording stopped: the audio capture process exited immediately and no audio was recorded.'
    + (detail ? ` ${detail}` : '');
}

export function createAudioCapture(dataDir: string, deviceId?: string | null): AudioCaptureSession {
  if (process.platform === 'linux') {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { LinuxAudioCapture } = require('./linux') as typeof import('./linux');
    return new LinuxAudioCapture(dataDir, deviceId ?? undefined);
  }
  if (process.platform === 'darwin') {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { MacAudioCapture } = require('./mac') as typeof import('./mac');
    return new MacAudioCapture(dataDir, deviceId ?? undefined);
  }
  if (process.platform === 'win32') {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { WindowsAudioCapture } = require('./win') as typeof import('./win');
    return new WindowsAudioCapture(dataDir, deviceId ?? undefined);
  }
  throw new Error(`Audio capture not yet implemented for platform: ${process.platform}`);
}

export async function listAudioDevices(): Promise<AudioDevice[]> {
  if (process.platform === 'linux') {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { listLinuxSources } = require('./linux') as typeof import('./linux');
    return listLinuxSources();
  }
  if (process.platform === 'darwin') {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { listMacDevices } = require('./mac') as typeof import('./mac');
    return listMacDevices();
  }
  if (process.platform === 'win32') {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { listWindowsDevices } = require('./win') as typeof import('./win');
    return listWindowsDevices();
  }
  return [];
}
