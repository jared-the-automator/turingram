import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import type { AudioDevice } from '@turingyde/transcript-core';
import type { AudioCaptureSession, CaptureResult } from './index';
import { captureIsDead, captureFailureReason } from './index';
import { ffmpegPath } from '../ffmpegPath';
import { wavDurationSec } from './wavDuration';

const execAsync = promisify(exec);

const EC_SOURCE = 'turingram_ec_source';
const EC_SINK = 'turingram_ec_sink';

// Device and sink names that get interpolated into an execAsync command line
// must look like PulseAudio names and nothing else. They normally come from
// pactl itself, but the mic can arrive via settings.json — this keeps a
// hand-edited settings file (or a compromised renderer) from smuggling shell
// syntax into the echo-cancel setup.
const SAFE_PA_NAME = /^[A-Za-z0-9._-]+$/;

// Capture from PipeWire/PulseAudio:
//   mic  → echo-cancelled source (speaker bleed removed via WebRTC AEC) when
//          available, else the raw 'default' input source.
//   sys  → monitor of the sink audio is ACTUALLY playing through, found by
//          reading the live sink-inputs (the EC sink when the routing worked,
//          else e.g. a USB headset WirePlumber pinned the meeting to). This is
//          the remote-party audio.
// Both are captured as separate mono WAVs and joined into stereo on stop.
//
// Echo cancellation routes system audio through a virtual EC sink (which forwards
// to the real speakers), so the AEC has the playback as its reference. The
// default sink is restored and the module unloaded on stop.

// Both channels quiet for this long = the room and the call are both finished.
export const BILATERAL_SILENCE_MS = 120_000;
// The far end alone quiet for this long. The mic is the user's ROOM, not the
// meeting: measured over a real 77-minute call it produced 218 separate silent
// runs and only 3 of them reached two minutes, so requiring it to be quiet is
// requiring something that barely happens even long after everyone said goodbye.
// That call ended at 3676s and recording ran to 4600s because the mic kept
// twitching; the remote channel had gone silent at 3754s and stayed silent for
// 845 seconds straight. The far end going quiet IS the end of the meeting.
//
// Five minutes, against a longest mid-call remote silence of 85s in that same
// recording — 3.5x margin, so a long screen-share monologue cannot trip it.
// This matters in money as well as disk: Deepgram bills the file's LENGTH, not
// the speech in it, so every trailing minute is billed at $0.0043.
export const REMOTE_SILENCE_MS = 300_000;

// A silence run that BEGINS this many seconds into the stream proves audio came
// before it — silencedetect opens a run at t≈0 only when the channel was silent
// from the first sample. That distinction is load-bearing for the remote rule:
// on 2026-08-06 a USB headset took the meeting's playback and the sys capture
// recorded pure zeros, which the rule read as "the far end hung up" and cut a
// live meeting off at 302s. A channel that was never audible is a broken
// capture, not a finished call.
export const SYS_AUDIBLE_MIN_SEC = 3;

export interface SilenceState {
  micSilentSince: number | null;
  sysSilentSince: number | null;
  hasSys: boolean;
  // The sys channel has carried actual audio at some point. Gates the remote
  // rule — see SYS_AUDIBLE_MIN_SEC.
  sysEverAudible: boolean;
}

export interface SilenceEvent {
  kind: 'start' | 'end';
  // Stream time in seconds from the silencedetect line; NaN when the line was
  // split mid-write and the number is missing.
  at: number;
}

// ffmpeg logs one silencedetect event per line, and a single stderr read can
// carry several of them plus a progress line. Testing the whole chunk with one
// regex kept only the first KIND of event present: a chunk holding
// "silence_start … silence_end" left the channel marked silent for the rest of
// the recording. Split it and apply every event in order.
export function parseSilenceLines(text: string): SilenceEvent[] {
  const out: SilenceEvent[] = [];
  for (const line of text.split('\n')) {
    // silence_end lines also carry "silence_duration"; neither contains "start".
    const start = line.match(/silence_start:\s*(\S*)/);
    if (start) { out.push({ kind: 'start', at: Number.parseFloat(start[1]) }); continue; }
    const end = line.match(/silence_end:\s*(\S*)/);
    if (end) out.push({ kind: 'end', at: Number.parseFloat(end[1]) });
  }
  return out;
}

// The autostop decision, pure so the thresholds can be tested against a real
// recording's silence timeline without spawning ffmpeg.
export function shouldAutostop(s: SilenceState, now: number): boolean {
  // No sys capture (mic-only recording) → only the mic can gate autostop;
  // otherwise a mono recording could never auto-stop.
  if (!s.hasSys) {
    return s.micSilentSince !== null && now - s.micSilentSince >= BILATERAL_SILENCE_MS;
  }
  // The remote rule needs the far end to have SAID something before its silence
  // can mean goodbye; a dead capture keeps recording (mic-only) instead.
  if (s.sysEverAudible && s.sysSilentSince !== null && now - s.sysSilentSince >= REMOTE_SILENCE_MS) return true;
  if (s.micSilentSince === null || s.sysSilentSince === null) return false;
  return now - Math.max(s.micSilentSince, s.sysSilentSince) >= BILATERAL_SILENCE_MS;
}

// Decides which sink's monitor the sys capture should record, from the raw text
// of `pactl list sink-inputs` and `pactl list sinks short`. Pure for testing.
//
// The EC setup herds playback streams onto the EC sink, but a stream can refuse
// to move — WirePlumber pins streams to a per-application saved route, and a
// freshly plugged USB headset takes new streams by profile priority — and a
// meeting playing to a sink we don't monitor records as zeros. So instead of
// trusting the herding, look at where playback actually IS: ignore our own
// audio and the EC module's internal loopback, and back the sink carrying the
// most remaining streams (a tie prefers the non-EC sink, the path that has
// already proven it can lose audio). Null when nothing is playing — the caller
// keeps its default choice.
export function pickPlaybackSink(
  sinkInputsText: string,
  sinksShortText: string,
  ownBinary: string,
  ecSink: string,
): string | null {
  const sinkNames = new Map<string, string>();
  for (const line of sinksShortText.split('\n')) {
    const [index, name] = line.split('\t');
    if (index?.trim() && name) sinkNames.set(index.trim(), name);
  }
  const votes = new Map<string, number>();
  for (const block of sinkInputsText.split(/^Sink Input #/m).slice(1)) {
    const sinkIndex = block.match(/^\s*Sink:\s*(\d+)\s*$/m)?.[1];
    if (!sinkIndex) continue;
    if (block.match(/application\.process\.binary = "([^"]*)"/)?.[1] === ownBinary) continue;
    if ((block.match(/media\.name = "([^"]*)"/)?.[1] ?? '').includes('Echo-Cancel')) continue;
    const name = sinkNames.get(sinkIndex);
    if (!name) continue;
    votes.set(name, (votes.get(name) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestCount = 0;
  for (const [name, count] of votes) {
    if (count > bestCount || (count === bestCount && best === ecSink && name !== ecSink)) {
      best = name;
      bestCount = count;
    }
  }
  return best;
}

// The effectful wrapper around pickPlaybackSink.
async function findPlaybackSink(): Promise<string | null> {
  const [inputs, sinks] = await Promise.all([
    execAsync('pactl list sink-inputs'),
    execAsync('pactl list sinks short'),
  ]);
  return pickPlaybackSink(inputs.stdout, sinks.stdout, path.basename(process.execPath), EC_SINK);
}

export class LinuxAudioCapture implements AudioCaptureSession {
  private micProcess: ReturnType<typeof spawn> | null = null;
  private sysProcess: ReturnType<typeof spawn> | null = null;
  private micPath = '';
  private sysPath = '';
  private outputPath = '';
  private hasSys = false;
  private ecModuleId: string | null = null;
  private prevDefaultSink: string | null = null;
  private handlers = new Map<string, Array<(arg: unknown) => void>>();
  private micSilentSince: number | null = null;
  private sysSilentSince: number | null = null;
  private sysEverAudible = false;
  private stopping = false;
  // Tail of what ffmpeg printed. The silence parser was the only reader, so a
  // fatal complaint on line one ("Unknown input format: 'pulse'") was discarded
  // by the same handler that was looking for silencedetect events.
  private micStderr = '';
  private silenceCheckInterval: ReturnType<typeof setInterval> | null = null;
  private lastAutostopEmit = 0;
  private readonly SILENCE_CHECK_INTERVAL_MS = 5_000;
  private readonly AUTOSTOP_RETRY_MS = 60_000;

  // deviceId is a PulseAudio source name chosen in Settings. It anchors the echo
  // canceller and, failing that, is captured directly. Empty/absent means "use
  // whatever PulseAudio calls default".
  constructor(private dataDir: string, private deviceId?: string) {}

  // Resolve the mic once so setup and the fallback path cannot disagree about
  // which device is being recorded.
  private async resolveMicSource(): Promise<string> {
    const chosen = (this.deviceId ?? '').trim();
    if (chosen) {
      // A device can vanish between sessions (headset unplugged). Fall back to
      // the default rather than failing the whole recording.
      try {
        const { stdout } = await execAsync('pactl list sources short');
        if (stdout.split('\n').some(l => l.split('\t')[1] === chosen)) return chosen;
      } catch { /* fall through to default */ }
    }
    try {
      const def = (await execAsync('pactl get-default-source')).stdout.trim();
      if (def && !def.endsWith('.monitor')) return def;
    } catch { /* fall through */ }
    return '';
  }

  async start(): Promise<void> {
    const dir = path.join(this.dataDir, 'recordings');
    fs.mkdirSync(dir, { recursive: true });
    const ts = Date.now();
    this.micPath = path.join(dir, `${ts}_mic.wav`);
    this.sysPath = path.join(dir, `${ts}_sys.wav`);
    this.outputPath = path.join(dir, `${ts}.wav`);

    // Clear any EC module left over from a crashed session, then try to set up
    // echo cancellation. ec is null when unavailable → fall back to direct capture.
    await cleanupStaleEchoCancel();
    const chosenMic = await this.resolveMicSource();
    const ec = await this.setupEchoCancel(chosenMic);

    // Mic: echo-cancelled source if available, else the selected input directly
    // ('default' only when nothing could be resolved at all).
    const micSource = ec ? ec.micSource : (chosenMic || 'default');
    this.micProcess = spawn(ffmpegPath(), [
      '-f', 'pulse', '-i', micSource,
      '-af', 'silencedetect=noise=-35dB:d=2',
      '-ar', '16000', '-ac', '1',
      '-y', this.micPath,
    ], { stdio: ['pipe', 'ignore', 'pipe'] });
    this.micProcess.on('error', (err) => this.emit('error', err));
    // ffmpeg dying mid-recording (device unplugged, PipeWire restart) must not
    // be silent — every second after it is audio the user thinks was captured.
    this.micProcess.on('close', (code) => {
      if (!this.stopping && code !== 0) {
        this.emit('error', new Error(`microphone capture stopped unexpectedly (ffmpeg exit ${code})`));
      }
    });
    this.micProcess.stderr?.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      this.micStderr = (this.micStderr + text).slice(-2000);
      this.parseSilenceEvent(text, 'mic');
    });

    // System audio: monitor of whichever sink the audio ACTUALLY plays through,
    // read from the live sink-inputs — the EC herding can silently miss a
    // stream (see pickPlaybackSink), and monitoring a sink nothing plays to
    // records zeros for the whole meeting. Fall back to the EC/default sink
    // when nothing is playing yet. Resolve robustly (the default sink can be
    // momentarily unavailable at record start, which used to drop us to a mono
    // mic-only recording) and wait for the monitor source to actually exist
    // before capturing.
    try {
      const streamSink = await findPlaybackSink().catch(() => null);
      const monitor = streamSink && SAFE_PA_NAME.test(streamSink)
        ? `${streamSink}.monitor`
        : (ec?.sysMonitor ?? await resolveDefaultMonitor());
      if (monitor) {
        await waitForSource(monitor, 2000);
        this.sysProcess = spawn(ffmpegPath(), [
          '-f', 'pulse', '-i', monitor,
          '-af', 'silencedetect=noise=-35dB:d=2',
          '-ar', '16000', '-ac', '1',
          '-y', this.sysPath,
        ], { stdio: ['pipe', 'ignore', 'pipe'] });
        this.sysProcess.on('error', () => { this.hasSys = false; });
        this.sysProcess.on('close', (code) => {
          // System-audio capture died mid-recording: keep going mic-only, but
          // flag it so stop() doesn't try to join a truncated sys track.
          if (!this.stopping && code !== 0) this.hasSys = false;
        });
        this.sysProcess.stderr?.on('data', (chunk: Buffer) => {
          this.parseSilenceEvent(chunk.toString(), 'sys');
        });
        this.hasSys = true;
      }
    } catch { /* system audio unavailable — mic only */ }

    this.startSilenceCheck();
  }

  captureFailure(): string | null {
    // stop() kills these deliberately, and a WAV finalized on the way out is
    // briefly indistinguishable from one that was never written.
    if (this.stopping) return null;
    if (!captureIsDead([this.micProcess, this.sysProcess], [this.micPath, this.sysPath])) return null;
    return captureFailureReason(this.micStderr);
  }

  async stop(): Promise<CaptureResult> {
    this.stopping = true;
    if (this.silenceCheckInterval !== null) {
      clearInterval(this.silenceCheckInterval);
      this.silenceCheckInterval = null;
    }
    this.micSilentSince = null;
    this.sysSilentSince = null;
    await stopFfmpeg(this.micProcess);
    this.micProcess = null;
    if (this.sysProcess) {
      await stopFfmpeg(this.sysProcess);
      this.sysProcess = null;
    }
    // Restore audio routing and unload the EC module before anything else.
    await this.teardownEchoCancel();

    // A 44-byte file is a bare WAV header — ffmpeg started and captured nothing.
    const usable = (p: string) => fs.existsSync(p) && fs.statSync(p).size > 44;
    const micUsable = usable(this.micPath);
    const sysUsable = this.hasSys && usable(this.sysPath);

    if (micUsable && sysUsable) {
      try {
        await joinStereo(this.micPath, this.sysPath, this.outputPath);
      } catch {
        // Join failed (truncated sys track etc.) — salvage the mic recording
        // rather than losing the whole meeting.
        fs.renameSync(this.micPath, this.outputPath);
        if (fs.existsSync(this.sysPath)) fs.unlinkSync(this.sysPath);
        return { audioPath: this.outputPath, isStereo: false };
      }
      fs.unlinkSync(this.micPath);
      fs.unlinkSync(this.sysPath);
      return { audioPath: this.outputPath, isStereo: true };
    }
    if (micUsable) {
      fs.renameSync(this.micPath, this.outputPath);
      if (fs.existsSync(this.sysPath)) fs.unlinkSync(this.sysPath);
      return { audioPath: this.outputPath, isStereo: false };
    }
    if (sysUsable) {
      // Mic ffmpeg never wrote anything (spawn failed, device vanished at
      // start). The far end alone is still the meeting — keep it.
      fs.renameSync(this.sysPath, this.outputPath);
      if (fs.existsSync(this.micPath)) fs.unlinkSync(this.micPath);
      return { audioPath: this.outputPath, isStereo: false };
    }
    // Nothing was captured. This used to be an unguarded renameSync that threw
    // ENOENT; throw something the pipeline can show and act on instead.
    for (const p of [this.micPath, this.sysPath]) {
      if (fs.existsSync(p)) { try { fs.unlinkSync(p); } catch { /* best effort */ } }
    }
    throw new Error('Recording produced no audio — the capture process never started.');
  }

  // Loads module-echo-cancel and routes system audio through its sink so the AEC
  // has the playback as reference. Returns the cleaned mic source + EC sink
  // monitor, or null if echo cancellation can't be set up (→ direct capture).
  private async setupEchoCancel(chosenMic: string): Promise<{ micSource: string; sysMonitor: string } | null> {
    try {
      const mic = chosenMic;
      const sink = (await execAsync('pactl get-default-sink')).stdout.trim();
      // Need a real microphone (not a monitor) and a real sink to anchor the AEC.
      if (!mic || !sink || mic.endsWith('.monitor')) return null;
      if (!SAFE_PA_NAME.test(mic) || !SAFE_PA_NAME.test(sink)) return null;

      // aec_args: disable WebRTC auto-gain (it pumps/distorts the voice and hurts
      // transcription), keep noise suppression + a high-pass + extended filter for
      // clean echo cancellation without degrading speech.
      const load = (await execAsync(
        `pactl load-module module-echo-cancel aec_method=webrtc ` +
        `aec_args="webrtc.gain_control=0 webrtc.noise_suppression=1 webrtc.extended_filter=1 webrtc.high_pass_filter=1" ` +
        `source_master=${mic} sink_master=${sink} ` +
        `source_name=${EC_SOURCE} sink_name=${EC_SINK} use_master_format=1`
      )).stdout.trim();
      if (!/^\d+$/.test(load)) return null;
      this.ecModuleId = load;
      this.prevDefaultSink = sink;

      // Route system audio through the EC sink (it forwards to the real speakers).
      await execAsync(`pactl set-default-sink ${EC_SINK}`);
      // Move already-playing streams onto the EC sink so they're referenced too.
      try {
        const si = (await execAsync('pactl list sink-inputs short')).stdout.trim();
        for (const line of si.split('\n').filter(Boolean)) {
          const id = line.split('\t')[0];
          if (/^\d+$/.test(id)) {
            await execAsync(`pactl move-sink-input ${id} ${EC_SINK}`).catch(() => {});
          }
        }
      } catch { /* best effort */ }

      await new Promise(r => setTimeout(r, 400)); // let the module settle
      return { micSource: EC_SOURCE, sysMonitor: `${EC_SINK}.monitor` };
    } catch {
      await this.teardownEchoCancel();
      return null;
    }
  }

  private async teardownEchoCancel(): Promise<void> {
    if (this.prevDefaultSink && SAFE_PA_NAME.test(this.prevDefaultSink)) {
      await execAsync(`pactl set-default-sink ${this.prevDefaultSink}`).catch(() => {});
    }
    this.prevDefaultSink = null;
    if (this.ecModuleId) {
      await execAsync(`pactl unload-module ${this.ecModuleId}`).catch(() => {});
      this.ecModuleId = null;
    }
  }

  private parseSilenceEvent(text: string, channel: 'mic' | 'sys'): void {
    try {
      for (const event of parseSilenceLines(text)) {
        if (event.kind === 'start') {
          if (channel === 'mic') { this.micSilentSince = this.micSilentSince ?? Date.now(); }
          else {
            this.sysSilentSince = this.sysSilentSince ?? Date.now();
            // Silence beginning this deep into the stream means audio preceded
            // it (NaN from a mangled line stays not-audible).
            if (event.at >= SYS_AUDIBLE_MIN_SEC) this.sysEverAudible = true;
          }
        } else {
          if (channel === 'mic') this.micSilentSince = null;
          else {
            this.sysSilentSince = null;
            // A silence run ENDED — the channel is carrying audio right now.
            this.sysEverAudible = true;
          }
        }
      }
    } catch { /* ignore malformed output */ }
  }

  private startSilenceCheck(): void {
    this.silenceCheckInterval = setInterval(() => {
      const silence = {
        micSilentSince: this.micSilentSince,
        sysSilentSince: this.sysSilentSince,
        hasSys: this.hasSys,
        sysEverAudible: this.sysEverAudible,
      };
      const now = Date.now();
      if (!shouldAutostop(silence, now)) return;
      // Deliberately does NOT clear the interval. It used to, which made
      // autostop one-shot — and the pipeline's handler only console.errors a
      // failed stop(), so a single failure disarmed the detector for the rest
      // of the recording and it ran until someone pressed stop by hand. A real
      // stop() clears this interval itself, so the only way we get here twice
      // is that the stop did not take; retry rather than give up.
      if (now - this.lastAutostopEmit < this.AUTOSTOP_RETRY_MS) return;
      this.lastAutostopEmit = now;
      this.emit('autostop');
    }, this.SILENCE_CHECK_INTERVAL_MS);
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

// Resolve the default sink's monitor, retrying — the default sink can be briefly
// unavailable right at record start, which previously caused a mono fallback.
async function resolveDefaultMonitor(): Promise<string | null> {
  for (let i = 0; i < 3; i++) {
    try {
      const sink = (await execAsync('pactl get-default-sink')).stdout.trim();
      if (sink) return `${sink}.monitor`;
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 200));
  }
  return null;
}

// Wait until a PulseAudio/PipeWire source exists, so we don't start capturing a
// monitor that isn't ready yet (e.g. a freshly created EC sink) and get silence.
async function waitForSource(name: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const { stdout } = await execAsync('pactl list sources short');
      if (stdout.split('\n').some(l => l.split('\t')[1] === name)) return true;
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, 150));
  }
  return false;
}

// Ask ffmpeg to finish gracefully ('q' lets it finalize the WAV header), and
// ALWAYS wait for the process to actually exit before resolving — resolving
// while ffmpeg is still flushing lets the caller read/join a half-written WAV.
// Escalate q → SIGTERM → SIGKILL if it drags its feet.
function stopFfmpeg(proc: ReturnType<typeof spawn> | null): Promise<void> {
  return new Promise(resolve => {
    if (!proc || proc.exitCode !== null || proc.signalCode !== null) { resolve(); return; }
    const timers: NodeJS.Timeout[] = [];
    proc.once('close', () => { timers.forEach(clearTimeout); resolve(); });
    try {
      proc.stdin?.write('q');
      proc.stdin?.end();
    } catch { /* stdin already closed — fall through to signals */ }
    timers.push(setTimeout(() => proc.kill('SIGTERM'), 3000));
    timers.push(setTimeout(() => proc.kill('SIGKILL'), 5000));
  });
}

async function joinStereo(micPath: string, sysPath: string, outPath: string): Promise<void> {
  // `join` ends at the SHORTEST input — verified directly: joining a 20-second
  // file with a 5-second one yields 5 seconds. So if either capture dies partway
  // through (device unplugged, PipeWire restart) the joined recording silently
  // discards everything after that moment on BOTH channels, and the meeting comes
  // back truncated with nothing to say it was. Pad both to the longer length so a
  // half-dead capture costs one channel, not the rest of the call.
  const dur = Math.max(wavDurationSec(micPath), wavDurationSec(sysPath));
  const pad = dur > 0 ? `,apad=whole_dur=${dur.toFixed(3)}` : '';
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath(), [
      '-i', micPath, '-i', sysPath,
      '-filter_complex',
      `[0:a]aformat=channel_layouts=mono${pad}[l];[1:a]aformat=channel_layouts=mono${pad}[r];` +
      '[l][r]join=inputs=2:channel_layout=stereo[out]',
      '-map', '[out]', '-ar', '16000', '-ac', '2', '-y', outPath,
    ]);
    proc.on('error', reject);
    proc.on('close', code => code === 0 ? resolve() : reject(new Error(`ffmpeg join failed: ${code}`)));
  });
}

// Unload any echo-cancel module left behind by a crashed session (identified by
// our EC source/sink names), restoring normal audio routing.
export async function cleanupStaleEchoCancel(): Promise<void> {
  try {
    const { stdout } = await execAsync('pactl list modules short');
    for (const line of stdout.split('\n')) {
      if (line.includes(EC_SOURCE) || line.includes(EC_SINK)) {
        const id = line.split('\t')[0];
        if (/^\d+$/.test(id)) await execAsync(`pactl unload-module ${id}`).catch(() => {});
      }
    }
  } catch { /* pactl unavailable */ }
}

// Lists MICROPHONES, not speakers. This used to list sinks, which was wrong twice
// over: the system-audio side is always the default sink's monitor (there is
// nothing to choose), and the thing a user actually needs to pick is which mic
// they are talking into — laptop array versus headset.
//
// `id` is the PulseAudio source NAME, not the index, because indices are
// reassigned across reboots and module loads while names are stable.
export async function listLinuxSources(): Promise<AudioDevice[]> {
  try {
    const [{ stdout }, verbose, def] = await Promise.all([
      execAsync('pactl list sources short'),
      execAsync('pactl list sources').then(r => r.stdout).catch(() => ''),
      execAsync('pactl get-default-source').then(r => r.stdout.trim()).catch(() => ''),
    ]);

    // "Built-in Audio Analog Stereo" is what a person recognises;
    // "alsa_input.pci-0000_00_1f.3.analog-stereo" is not. Pair each source Name
    // with the Description that follows it in the verbose listing.
    const descriptions = new Map<string, string>();
    let current = '';
    for (const line of verbose.split('\n')) {
      const name = line.match(/^\s*Name:\s*(.+)$/);
      if (name) { current = name[1].trim(); continue; }
      const desc = line.match(/^\s*Description:\s*(.+)$/);
      if (desc && current) { descriptions.set(current, desc[1].trim()); current = ''; }
    }

    return stdout.trim().split('\n')
      .filter(l => l.trim())
      .map(line => line.split('\t'))
      // Monitors are loopbacks of an output, not inputs — never a mic choice.
      // Our own echo-cancel source is transient and must not be offered either.
      .filter(parts => parts[1] && !parts[1].endsWith('.monitor') && parts[1] !== EC_SOURCE)
      .map((parts, i) => ({
        id: parts[1],
        name: descriptions.get(parts[1]) || parts[1],
        isDefault: def ? parts[1] === def : i === 0,
      }));
  } catch {
    return [];
  }
}
