import { spawn, exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// Detects that the user is in a call and lets the caller offer to record it.
//
// The signal is the microphone itself: every conferencing app — Zoom, Meet,
// Teams, Discord, a browser WebRTC call — opens a mic-capture stream the moment
// a call starts. PipeWire/PulseAudio exposes those streams with the owning
// process, and a real call also plays the far end back, so "mic capture + audio
// playback from the same app" is a call and not a voice memo or music. This
// lives at the same PipeWire layer the recorder already uses and needs no
// calendar, no OAuth, no network, and no per-app integration.
//
// It only ever PROMPTS. It never arms the recorder on its own — that is a
// consent line the product does not cross.

export interface StreamInfo {
  key: string        // pid as string, else binary — stable id for de-duping prompts
  pid: number | null
  binary: string     // application.process.binary, e.g. "zoom", "chrome"
}

export interface MeetingCandidate {
  app: string        // friendly-ish app name for the prompt
  title: string      // window title if resolvable, else a sensible fallback
}

// Native conferencing clients. A stream from one of these counts as a call even
// without the two-way check (some are audio-only). Browsers are here too: a
// browser only opens a mic stream when a page actually starts a call, so the
// mere presence of the stream is already meaningful.
const CONFERENCING_BINARIES = new Set([
  'zoom', 'zoom.real', 'teams', 'teams-for-linux', 'msedge', 'discord',
  'webexmta', 'webex', 'skypeforlinux', 'slack', 'chrome', 'chromium',
  'chromium-browser', 'brave', 'vivaldi-bin', 'firefox', 'firefox-bin',
]);

// Pretty label for a binary. Keeps the prompt readable without a huge lookup.
export function appLabel(binary: string): string {
  const map: Record<string, string> = {
    'zoom': 'Zoom', 'zoom.real': 'Zoom', 'teams': 'Teams',
    'teams-for-linux': 'Teams', 'discord': 'Discord', 'webex': 'Webex',
    'webexmta': 'Webex', 'skypeforlinux': 'Skype', 'slack': 'Slack',
    'chrome': 'Chrome', 'chromium': 'Chrome', 'chromium-browser': 'Chrome',
    'brave': 'Brave', 'vivaldi-bin': 'Vivaldi', 'firefox': 'Firefox',
    'firefox-bin': 'Firefox', 'msedge': 'Edge',
  };
  return map[binary] ?? (binary ? binary.charAt(0).toUpperCase() + binary.slice(1) : 'a call');
}

// The testable core: given the mic-capture streams and the playback streams
// currently open (minus our own), return the app that looks like a live call, or
// null. A candidate qualifies if it is a known conferencing client OR it is
// doing two-way audio (the same process/binary is both capturing and playing).
export function pickMeetingCandidate(
  micStreams: StreamInfo[],
  playbackStreams: StreamInfo[],
): StreamInfo | null {
  const playingKeys = new Set(playbackStreams.map(s => String(s.pid ?? '')));
  const playingBins = new Set(playbackStreams.map(s => s.binary));
  for (const mic of micStreams) {
    const known = CONFERENCING_BINARIES.has(mic.binary);
    const twoWay = (mic.pid !== null && playingKeys.has(String(mic.pid))) ||
                   playingBins.has(mic.binary);
    if (known || twoWay) return mic;
  }
  return null;
}

// Parses `pactl list source-outputs` / `sink-inputs` verbose blocks. Each block
// starts with a "#<n>" header; we pull the process id, binary, and (for source
// outputs) the Source index so monitor captures can be dropped. Exported because
// the block format is the fragile part worth pinning.
export function parseStreams(text: string): Array<StreamInfo & { source: number | null }> {
  const out: Array<StreamInfo & { source: number | null }> = [];
  let cur: (StreamInfo & { source: number | null }) | null = null;
  const push = () => { if (cur && cur.binary) out.push(cur); };
  for (const line of text.split('\n')) {
    if (/^(Source Output|Sink Input)\s+#\d+/.test(line)) {
      push();
      cur = { key: '', pid: null, binary: '', source: null };
      continue;
    }
    if (!cur) continue;
    const src = line.match(/^\s*Source:\s*(\d+)/);
    if (src) { cur.source = parseInt(src[1], 10); continue; }
    const pid = line.match(/application\.process\.id\s*=\s*"(\d+)"/);
    if (pid) { cur.pid = parseInt(pid[1], 10); continue; }
    const bin = line.match(/application\.process\.binary\s*=\s*"([^"]+)"/);
    if (bin) { cur.binary = bin[1]; continue; }
  }
  push();
  return out.map(s => ({ ...s, key: s.pid !== null ? String(s.pid) : s.binary }));
}

export class MeetingDetector {
  private sub: ReturnType<typeof spawn> | null = null;
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private resubscribe: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  // Apps we have already offered to record this call. Cleared when their mic
  // stream goes away, so leaving and rejoining prompts again — but an ignored
  // prompt never nags while the same call is still running.
  private handled = new Set<string>();
  private readonly DEBOUNCE_MS = 4000;
  // How long to wait before re-subscribing after the pactl child exits. Long
  // enough that a PipeWire restart is not a spawn storm, short enough that a
  // call starting right after the restart is still caught.
  private readonly RESUBSCRIBE_MS = 5000;

  constructor(
    private isEnabled: () => boolean,
    private isRecording: () => boolean,
    private onDetected: (c: MeetingCandidate) => void,
  ) {}

  start(): void {
    if (this.sub) return;
    // pactl subscribe wakes us on any stream change; we then read the current
    // state. The debounce doubles as the "sustained call" filter: a transient
    // permission probe is gone before the timer fires.
    try {
      this.sub = spawn('pactl', ['subscribe'], { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      return; // no pactl — detection simply unavailable
    }
    this.sub.stdout?.on('data', (chunk: Buffer) => {
      if (/source-output|sink-input/.test(chunk.toString())) this.schedule();
    });
    this.sub.on('error', () => { /* pactl vanished — give up quietly */ });
    // pactl dies whenever the sound server does (a PipeWire restart, a crash, a
    // logout/login of the audio stack). Without re-subscribing the detector goes
    // silently deaf for the rest of the session while still looking alive —
    // which is indistinguishable, from the outside, from the feature "just
    // stopping working".
    this.sub.on('close', () => {
      this.sub = null;
      if (this.stopped || this.resubscribe) return;
      this.resubscribe = setTimeout(() => { this.resubscribe = null; this.start(); }, this.RESUBSCRIBE_MS);
    });
    // A call may already be in progress when we start.
    this.schedule();
  }

  stop(): void {
    this.stopped = true;
    if (this.debounce) { clearTimeout(this.debounce); this.debounce = null; }
    if (this.resubscribe) { clearTimeout(this.resubscribe); this.resubscribe = null; }
    if (this.sub) { this.sub.kill(); this.sub = null; }
  }

  private schedule(): void {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => { void this.evaluate(); }, this.DEBOUNCE_MS);
  }

  private async evaluate(): Promise<void> {
    if (this.stopped || !this.isEnabled() || this.isRecording()) return;
    try {
      const [monitorIdx, soText, siText] = await Promise.all([
        this.monitorSourceIndexes(),
        execAsync('pactl list source-outputs').then(r => r.stdout).catch(() => ''),
        execAsync('pactl list sink-inputs').then(r => r.stdout).catch(() => ''),
      ]);

      // Mic captures = source-outputs on a real input (not a monitor). We do not
      // need to exclude our own recorder here: detection is gated off while
      // recording, so the recorder's own streams never reach this path.
      const mics = parseStreams(soText).filter(s => s.source === null || !monitorIdx.has(s.source));
      const playback = parseStreams(siText);

      // Prune handled apps whose call has ended, so a later call re-prompts.
      const liveKeys = new Set(mics.map(s => s.key));
      for (const k of [...this.handled]) if (!liveKeys.has(k)) this.handled.delete(k);

      const candidate = pickMeetingCandidate(mics, playback);
      if (!candidate || this.handled.has(candidate.key)) return;

      this.handled.add(candidate.key);
      const title = await this.resolveTitle(candidate.pid, candidate.binary);
      this.onDetected({ app: appLabel(candidate.binary), title });
    } catch { /* best effort — a detection miss must never crash the app */ }
  }

  private async monitorSourceIndexes(): Promise<Set<number>> {
    try {
      const { stdout } = await execAsync('pactl list sources short');
      const set = new Set<number>();
      for (const line of stdout.split('\n')) {
        const parts = line.split('\t');
        if (parts[1]?.endsWith('.monitor')) {
          const i = parseInt(parts[0], 10);
          if (!Number.isNaN(i)) set.add(i);
        }
      }
      return set;
    } catch { return new Set(); }
  }

  // Best-effort meeting name from the window title. Never blocks the prompt.
  private async resolveTitle(pid: number | null, binary: string): Promise<string> {
    try {
      const { stdout } = await execAsync('wmctrl -lp');
      return pickTitle(parseWmctrl(stdout), pid, binary);
    } catch {
      // No wmctrl / Wayland — fall through to the app-name default.
      return `${appLabel(binary)} meeting`;
    }
  }
}

export interface WinRow { pid: number; title: string }

// Parses `wmctrl -lp` rows. Columns: winid desktop pid host title…
export function parseWmctrl(stdout: string): WinRow[] {
  return stdout.split('\n').map(l => l.trim()).filter(Boolean).map(l => {
    const parts = l.split(/\s+/);
    return { pid: parseInt(parts[2], 10), title: parts.slice(4).join(' ').trim() };
  });
}

// Chooses a meeting name: the exact call-window title by PID, else any window
// that looks like a meeting, else the app-name default. Pure, so the PID-match
// branch — which real windows exercise but ffmpeg-based tests cannot — is tested.
export function pickTitle(rows: WinRow[], pid: number | null, binary: string): string {
  const fallback = `${appLabel(binary)} meeting`;
  if (pid !== null) {
    const exact = rows.find(r => r.pid === pid && r.title);
    if (exact) return cleanTitle(exact.title) || fallback;
  }
  const meetingLike = rows.find(r => /zoom meeting|microsoft teams|\bmeet\b|webex|- google meet/i.test(r.title));
  if (meetingLike) return cleanTitle(meetingLike.title) || fallback;
  return fallback;
}

// Strips the trailing app-name chrome browsers append ("… - Google Chrome").
export function cleanTitle(title: string): string {
  return title
    .replace(/\s*[-–—]\s*(Google Chrome|Chromium|Brave|Mozilla Firefox|Vivaldi|Microsoft Edge)\s*$/i, '')
    .trim();
}
