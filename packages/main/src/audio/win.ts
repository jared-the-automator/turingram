import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import type { AudioDevice } from '@turingyde/transcript-core';
import type { AudioCaptureSession, CaptureResult } from './index';
import { captureIsDead, captureFailureReason, sizeOnDisk } from './index';
import { ffmpegPath } from '../ffmpegPath';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type NaudiodonModule = any;

function getNaudiodon(): NaudiodonModule {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('naudiodon') as NaudiodonModule;
}

interface PortAudioDeviceInfo {
  id: number
  name: string
  hostAPIName: string
  maxInputChannels: number
  maxOutputChannels: number
  isLoopbackDevice?: boolean
  defaultSampleRate: number
}

export class WindowsAudioCapture implements AudioCaptureSession {
  private micStream: NaudiodonModule = null;
  private sysStream: NaudiodonModule = null;
  private ffmpegMic: ReturnType<typeof spawn> | null = null;
  private ffmpegSys: ReturnType<typeof spawn> | null = null;
  private micPath = '';
  private sysPath = '';
  private outputPath = '';
  private hasSys = false;
  private stopping = false;
  // naudiodon reports a dead capture through the stream, never through ffmpeg,
  // so this flag is the Windows equivalent of an ffmpeg that exited.
  private micFailed = false;
  private micError = '';
  private handlers = new Map<string, Array<(arg: unknown) => void>>();

  constructor(private dataDir: string, private _deviceId?: string) {}

  async start(): Promise<void> {
    const dir = path.join(this.dataDir, 'recordings');
    fs.mkdirSync(dir, { recursive: true });
    const ts = Date.now();
    this.micPath = path.join(dir, `${ts}_mic.wav`);
    this.sysPath = path.join(dir, `${ts}_sys.wav`);
    this.outputPath = path.join(dir, `${ts}.wav`);

    const naudiodon = getNaudiodon();
    const devices: PortAudioDeviceInfo[] = naudiodon.getDevices();

    // WASAPI loopback endpoint for system audio
    const loopback = devices.find(d =>
      d.hostAPIName === 'Windows WASAPI' &&
      d.maxInputChannels > 0 &&
      d.isLoopbackDevice
    );

    // Mic capture: naudiodon default input → ffmpeg resample → 16kHz mono WAV
    this.ffmpegMic = spawn(ffmpegPath(), [
      '-f', 's16le', '-ar', '44100', '-ac', '1', '-i', 'pipe:0',
      '-ar', '16000', '-ac', '1', '-y', this.micPath,
    ], { stdio: ['pipe', 'ignore', 'ignore'] });
    this.ffmpegMic.on('error', (err) => this.emit('error', err));

    this.micStream = new naudiodon.AudioIO({
      inOptions: {
        channelCount: 1,
        sampleFormat: naudiodon.SampleFormat16Bit,
        sampleRate: 44100,
        deviceId: -1, // default input
        closeOnError: true,
      },
    });
    this.micStream.on('error', (err: Error) => {
      this.micFailed = true;
      this.micError = String(err?.message ?? err);
      this.emit('error', err);
    });
    this.micStream.pipe(this.ffmpegMic.stdin);
    this.micStream.start();

    // System audio via WASAPI loopback (stereo, 44100Hz) → 16kHz mono WAV
    if (loopback) {
      try {
        this.ffmpegSys = spawn(ffmpegPath(), [
          '-f', 's16le', '-ar', '44100', '-ac', '2', '-i', 'pipe:0',
          '-ar', '16000', '-ac', '1', '-y', this.sysPath,
        ], { stdio: ['pipe', 'ignore', 'ignore'] });

        this.sysStream = new naudiodon.AudioIO({
          inOptions: {
            channelCount: 2,
            sampleFormat: naudiodon.SampleFormat16Bit,
            sampleRate: 44100,
            deviceId: loopback.id,
            closeOnError: true,
          },
        });
        this.sysStream.on('error', () => { this.hasSys = false; });
        this.sysStream.pipe(this.ffmpegSys.stdin);
        this.sysStream.start();
        this.hasSys = true;
      } catch {
        // WASAPI loopback unavailable on this driver — mic only
        this.sysStream = null;
        this.ffmpegSys = null;
      }
    }
  }

  captureFailure(): string | null {
    if (this.stopping) return null;
    if (sizeOnDisk(this.micPath) > 44 || sizeOnDisk(this.sysPath) > 44) return null;
    // ffmpeg is only the encoder here: naudiodon opens WASAPI and pipes PCM into
    // it. A capture that fails leaves ffmpeg alive and idle on a pipe that will
    // never carry anything, so unlike the other two platforms the process table
    // says nothing and the stream's own error is the signal.
    const capturing = !this.micFailed || this.hasSys;
    const encoding = !captureIsDead([this.ffmpegMic, this.ffmpegSys], []);
    if (capturing && encoding) return null;
    return captureFailureReason(this.micError);
  }

  async stop(): Promise<CaptureResult> {
    this.stopping = true;
    // Stop mic — quit() ends the Readable, which ends ffmpeg's stdin pipe
    this.micStream?.quit();
    await new Promise<void>(resolve => {
      if (!this.ffmpegMic) { resolve(); return; }
      this.ffmpegMic.once('close', resolve);
      setTimeout(() => { this.ffmpegMic?.kill('SIGTERM'); resolve(); }, 4000);
    });
    this.micStream = null;
    this.ffmpegMic = null;

    // Stop system audio
    if (this.sysStream) {
      this.sysStream.quit();
      await new Promise<void>(resolve => {
        if (!this.ffmpegSys) { resolve(); return; }
        this.ffmpegSys.once('close', resolve);
        setTimeout(() => { this.ffmpegSys?.kill('SIGTERM'); resolve(); }, 4000);
      });
      this.sysStream = null;
      this.ffmpegSys = null;
    }

    const sysUsable = this.hasSys
      && fs.existsSync(this.sysPath)
      && fs.statSync(this.sysPath).size > 44;

    if (sysUsable) {
      await joinStereo(this.micPath, this.sysPath, this.outputPath);
      fs.unlinkSync(this.micPath);
      fs.unlinkSync(this.sysPath);
      return { audioPath: this.outputPath, isStereo: true };
    } else {
      fs.renameSync(this.micPath, this.outputPath);
      if (fs.existsSync(this.sysPath)) fs.unlinkSync(this.sysPath);
      return { audioPath: this.outputPath, isStereo: false };
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

export async function listWindowsDevices(): Promise<AudioDevice[]> {
  try {
    const naudiodon = getNaudiodon();
    const devices: PortAudioDeviceInfo[] = naudiodon.getDevices();
    return devices
      .filter(d => d.maxInputChannels > 0 && !d.isLoopbackDevice)
      .map(d => ({ id: String(d.id), name: d.name, isDefault: d.id === -1 }));
  } catch {
    return [];
  }
}
