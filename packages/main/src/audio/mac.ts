import { spawn } from 'child_process';
import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import type { AudioDevice } from '@turingyde/transcript-core';
import type { AudioCaptureSession, CaptureResult } from './index';
import { captureIsDead, captureFailureReason } from './index';
import { ffmpegPath } from '../ffmpegPath';

const HELPER_NAME = 'turingram-audio-helper';

export class MacAudioCapture implements AudioCaptureSession {
  private micProcess: ReturnType<typeof spawn> | null = null;
  private sysProcess: ReturnType<typeof spawn> | null = null;
  private ffmpegSysProcess: ReturnType<typeof spawn> | null = null;
  private micPath = '';
  private sysPath = '';
  private outputPath = '';
  private hasSys = false;
  private helperPresent = false;
  private sysStderr = '';
  // Kept for the same reason as linux.ts: a denied microphone prompt makes
  // avfoundation fail on line one, and that line is the whole diagnosis.
  private micStderr = '';
  private stopping = false;
  private handlers = new Map<string, Array<(arg: unknown) => void>>();

  constructor(private dataDir: string, private _deviceId?: string) {}

  private getHelperPath(): string {
    if (app.isPackaged) {
      return path.join(process.resourcesPath, HELPER_NAME);
    }
    // Dev: compiled binary lives next to the swift source
    return path.join(__dirname, '..', '..', 'resources', HELPER_NAME);
  }

  async start(): Promise<void> {
    const dir = path.join(this.dataDir, 'recordings');
    fs.mkdirSync(dir, { recursive: true });
    const ts = Date.now();
    this.micPath = path.join(dir, `${ts}_mic.wav`);
    this.sysPath = path.join(dir, `${ts}_sys.wav`);
    this.outputPath = path.join(dir, `${ts}.wav`);

    // Mic: ffmpeg reads from AVFoundation. The device is an index into
    // avfoundation's audio list, NOT the system default input — those coincide
    // often enough to hide the difference and not always, so a user whose headset
    // sits at index 1 recorded their laptop lid until the picker existed.
    const micIndex = /^\d+$/.test(this._deviceId ?? '') ? this._deviceId : '0';
    this.micProcess = spawn(ffmpegPath(), [
      '-f', 'avfoundation', '-i', `:${micIndex}`,
      '-ar', '16000', '-ac', '1',
      '-y', this.micPath,
    ], { stdio: ['pipe', 'ignore', 'pipe'] });
    this.micProcess.on('error', (err) => this.emit('error', err));
    this.micProcess.stderr?.on('data', (chunk: Buffer) => {
      this.micStderr = (this.micStderr + chunk.toString()).slice(-2000);
    });
    // Mic capture dying is not survivable on its own — the local speaker is
    // half the recording and the whole point of the two-channel split.
    this.micProcess.on('close', (code) => {
      if (!this.stopping && code !== 0) {
        this.emit('error', new Error(`microphone capture stopped unexpectedly (ffmpeg exit ${code})`));
      }
    });

    // System audio: Swift helper → raw f32le PCM → ffmpeg → WAV
    const helperPath = this.getHelperPath();
    if (fs.existsSync(helperPath)) {
      this.sysProcess = spawn(helperPath, [], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      this.ffmpegSysProcess = spawn(ffmpegPath(), [
        '-f', 'f32le', '-ar', '48000', '-ac', '1', '-i', 'pipe:0',
        '-ar', '16000', '-ac', '1', '-y', this.sysPath,
      ], { stdio: ['pipe', 'ignore', 'ignore'] });

      // PCM from Swift helper flows into ffmpeg's stdin
      this.sysProcess.stdout?.pipe(this.ffmpegSysProcess.stdin!);

      // Drain the helper's stderr. It is spawned with stderr piped and nothing
      // was reading it, so a helper that logged steadily would fill the pipe
      // buffer and block on write — a recording that stops capturing system
      // audio partway through with no error anywhere. Keep only the tail; it is
      // the part that says why SCStream gave up.
      this.sysProcess.stderr?.on('data', (chunk: Buffer) => {
        this.sysStderr = (this.sysStderr + chunk.toString()).slice(-2000);
      });

      this.helperPresent = true;
      this.hasSys = true;
      this.sysProcess.on('error', () => { this.hasSys = false; });
      this.sysProcess.on('close', (code) => { if (code !== 0) this.hasSys = false; });
    }
  }

  captureFailure(): string | null {
    if (this.stopping) return null;
    if (!captureIsDead([this.micProcess, this.ffmpegSysProcess], [this.micPath, this.sysPath])) return null;
    return captureFailureReason(this.micStderr || this.sysStderr);
  }

  async stop(): Promise<CaptureResult> {
    this.stopping = true;
    // Stop mic
    await new Promise<void>(resolve => {
      if (!this.micProcess) { resolve(); return; }
      this.micProcess.once('close', resolve);
      this.micProcess.stdin?.write('q');
      this.micProcess.stdin?.end();
      setTimeout(() => { this.micProcess?.kill('SIGTERM'); resolve(); }, 3000);
    });
    this.micProcess = null;

    // Stop Swift helper by closing its stdin — triggers EOF inside the helper,
    // which stops SCStream, closes stdout, which closes ffmpeg's stdin,
    // which makes ffmpeg finalize the WAV.
    if (this.sysProcess) {
      this.sysProcess.stdin?.end();
      await new Promise<void>(resolve => {
        this.sysProcess!.once('close', resolve);
        setTimeout(() => { this.sysProcess?.kill('SIGTERM'); resolve(); }, 4000);
      });
      this.sysProcess = null;
    }

    // Wait for ffmpeg to finish writing the system audio WAV
    if (this.ffmpegSysProcess) {
      await new Promise<void>(resolve => {
        this.ffmpegSysProcess!.once('close', resolve);
        setTimeout(() => { this.ffmpegSysProcess?.kill('SIGTERM'); resolve(); }, 3000);
      });
      this.ffmpegSysProcess = null;
    }

    // Determine if system audio was actually captured
    const sysUsable = this.hasSys
      && fs.existsSync(this.sysPath)
      && fs.statSync(this.sysPath).size > 44; // more than a WAV header

    if (sysUsable) {
      await joinStereo(this.micPath, this.sysPath, this.outputPath);
      fs.unlinkSync(this.micPath);
      fs.unlinkSync(this.sysPath);
      return { audioPath: this.outputPath, isStereo: true };
    } else {
      // Mic only
      fs.renameSync(this.micPath, this.outputPath);
      if (fs.existsSync(this.sysPath)) fs.unlinkSync(this.sysPath);
      return {
        audioPath: this.outputPath,
        isStereo: false,
        warning: macSystemAudioWarning(this.helperPresent, this.sysStderr),
      };
    }
  }

  on(event: 'autostop', cb: () => void): this;
  on(event: 'error', cb: (err: Error) => void): this;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  on(event: string, cb: (arg: any) => void): this {
    if (!this.handlers.has(event)) this.handlers.set(event, []);
    this.handlers.get(event)!.push(cb);
    return this;
  }

  private emit(event: string, ...args: unknown[]): void {
    this.handlers.get(event)?.forEach(cb => (cb as (...a: unknown[]) => void)(...args));
  }
}

function joinStereo(micPath: string, sysPath: string, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath(), [
      '-i', micPath, '-i', sysPath,
      '-filter_complex',
      '[0:a]aformat=channel_layouts=mono[l];[1:a]aformat=channel_layouts=mono[r];[l][r]join=inputs=2:channel_layout=stereo[out]',
      '-map', '[out]',
      '-ar', '16000', '-ac', '2',
      '-y', outPath,
    ]);
    proc.on('error', reject);
    proc.on('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg join failed: ${code}`)));
  });
}

// Only the microphone half of the recording survived. Say which half is missing
// and what to do about it, because the audio itself gives no clue: the user gets
// a complete-looking transcript with every voice merged into one speaker, and
// the natural reading of that is "the diarization is bad," not "macOS denied a
// permission." The two causes need different sentences — a denied prompt is the
// user's to fix, a missing helper is ours.
export function macSystemAudioWarning(helperPresent: boolean, stderr: string): string {
  if (!helperPresent) {
    return 'Recorded your microphone only: the system-audio helper is missing from this build, '
      + 'so the other participants were not captured. This is a packaging bug, not a setting.';
  }
  const detail = stderr.trim().split('\n').filter(Boolean).pop();
  return 'Recorded your microphone only: macOS did not allow system-audio capture, so the other '
    + 'participants were not recorded and everyone appears as one speaker. Grant Turingram '
    + 'Screen Recording under System Settings, Privacy & Security, then quit and reopen it.'
    + (detail ? ` (${detail})` : '');
}

// ffmpeg writes its device list to stderr, in two sections, like:
//
//   [AVFoundation indev @ 0x...] AVFoundation video devices:
//   [AVFoundation indev @ 0x...] [0] FaceTime HD Camera
//   [AVFoundation indev @ 0x...] AVFoundation audio devices:
//   [AVFoundation indev @ 0x...] [0] MacBook Pro Microphone
//   [AVFoundation indev @ 0x...] [1] Jabra SPEAK 410
//
// Only the audio section counts, and the video one has to be skipped rather than
// filtered out afterwards: both use bare `[N] Name` lines, so an index taken from
// the wrong section would name a camera and then record from whatever audio
// device happens to share its number.
export function parseAvfoundationAudioDevices(stderr: string): AudioDevice[] {
  const out: AudioDevice[] = [];
  let inAudio = false;
  for (const raw of stderr.split(/\r?\n/)) {
    const line = raw.replace(/^\[AVFoundation[^\]]*\]\s*/, '').trim();
    if (/AVFoundation audio devices:/i.test(line)) { inAudio = true; continue; }
    if (/AVFoundation \w+ devices:/i.test(line)) { inAudio = false; continue; }
    if (!inAudio) continue;
    const m = /^\[(\d+)\]\s+(.+)$/.exec(line);
    if (!m) continue;
    out.push({ id: m[1], name: m[2].trim(), isDefault: m[1] === '0' });
  }
  return out;
}

// ffmpeg exits non-zero here by design: -list_devices has no input to process, so
// it prints the list and fails. Read stderr regardless of the exit code.
export async function listMacDevices(): Promise<AudioDevice[]> {
  return new Promise(resolve => {
    let stderr = '';
    const proc = spawn(ffmpegPath(), [
      '-f', 'avfoundation', '-list_devices', 'true', '-i', '',
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    proc.stderr?.on('data', (c: Buffer) => { stderr += c.toString(); });
    proc.on('error', () => resolve([]));
    proc.on('close', () => resolve(parseAvfoundationAudioDevices(stderr)));
    // The enumeration itself can hang if a device is wedged, and a Settings screen
    // that never finishes loading is worse than one that lists nothing.
    setTimeout(() => { proc.kill('SIGTERM'); resolve(parseAvfoundationAudioDevices(stderr)); }, 5000);
  });
}
