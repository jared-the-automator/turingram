import { spawn, exec, execFile } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

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
// macOS and Windows read the same signal from their own sources (see
// MacSource and WindowsSource below): CoreAudio's per-process objects on
// macOS 14.2+, which report input and output per app like PipeWire does, and
// the Windows privacy registry, which records which app holds the microphone
// right now but says nothing about playback.
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
  'safari', 'facetime', 'arc', 'skype',
]);

// Pretty label for a binary. Keeps the prompt readable without a huge lookup.
export function appLabel(binary: string): string {
  const map: Record<string, string> = {
    'zoom': 'Zoom', 'zoom.real': 'Zoom', 'teams': 'Teams',
    'teams-for-linux': 'Teams', 'discord': 'Discord', 'webex': 'Webex',
    'webexmta': 'Webex', 'skypeforlinux': 'Skype', 'slack': 'Slack',
    'chrome': 'Chrome', 'chromium': 'Chrome', 'chromium-browser': 'Chrome',
    'brave': 'Brave', 'vivaldi-bin': 'Vivaldi', 'firefox': 'Firefox',
    'firefox-bin': 'Firefox', 'msedge': 'Edge', 'safari': 'Safari',
    'facetime': 'FaceTime', 'arc': 'Arc', 'skype': 'Skype',
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

export interface Snapshot { mics: StreamInfo[]; playback: StreamInfo[] }

// Where the signal comes from. start() calls onChange whenever the set of audio
// streams may have changed; snapshot() reads the current state. onChange must
// stay quiet while nothing changes, because every call restarts the debounce.
export interface SignalSource {
  start(onChange: () => void): void
  stop(): void
  snapshot(): Promise<Snapshot>
}

// Bundle ids and executable names on macOS and Windows, mapped to the names
// CONFERENCING_BINARIES and appLabel already know. Browsers capture in a
// helper process (com.google.Chrome.helper, com.apple.WebKit.GPU), so these
// match on prefix.
const BUNDLE_PREFIXES: Array<[string, string]> = [
  ['us.zoom.', 'zoom'], ['com.microsoft.teams', 'teams'], ['com.google.chrome', 'chrome'],
  ['org.chromium.', 'chromium'], ['com.microsoft.edgemac', 'msedge'], ['com.brave.browser', 'brave'],
  ['com.vivaldi.', 'vivaldi-bin'], ['org.mozilla.', 'firefox'], ['com.apple.webkit.', 'safari'],
  ['com.apple.safari', 'safari'], ['com.apple.facetime', 'facetime'], ['company.thebrowser.', 'arc'],
  ['com.tinyspeck.slackmacgap', 'slack'], ['com.hnc.discord', 'discord'], ['com.cisco.webex', 'webex'],
  ['cisco-systems.spark', 'webex'], ['com.skype.', 'skype'],
];

const EXE_NAMES: Record<string, string> = {
  'zoom': 'zoom', 'ms-teams': 'teams', 'teams': 'teams', 'msteams': 'teams', 'chrome': 'chrome',
  'msedge': 'msedge', 'firefox': 'firefox', 'brave': 'brave', 'vivaldi': 'vivaldi-bin',
  'slack': 'slack', 'discord': 'discord', 'ciscocollabhost': 'webex', 'atmgr': 'webex',
  'webex': 'webex', 'skype': 'skype', 'microsoft.skypeapp': 'skype',
};

export function macBinary(bundle: string, name: string): string {
  const b = bundle.toLowerCase();
  const hit = BUNDLE_PREFIXES.find(([prefix]) => b.startsWith(prefix));
  if (hit) return hit[1];
  return (name || bundle.split('.').pop() || '').toLowerCase();
}

// A helper line is {"procs":[{pid,bundle,name,in,out}]}. Our own processes are
// dropped by bundle id, so a Turingram window never prompts about itself.
export function parseMacSnapshot(line: string, ownBundle: string): Snapshot | null {
  let data: { procs?: Array<{ pid?: unknown; bundle?: unknown; name?: unknown; in?: unknown; out?: unknown }> };
  try { data = JSON.parse(line); } catch { return null; }
  if (!Array.isArray(data.procs)) return null;
  const mics: StreamInfo[] = [];
  const playback: StreamInfo[] = [];
  for (const p of data.procs) {
    const pid = typeof p.pid === 'number' ? p.pid : null;
    const bundle = typeof p.bundle === 'string' ? p.bundle : '';
    if (bundle.toLowerCase().startsWith(ownBundle.toLowerCase())) continue;
    const binary = macBinary(bundle, typeof p.name === 'string' ? p.name : '');
    if (!binary) continue;
    const info = { key: pid !== null ? String(pid) : binary, pid, binary };
    if (p.in === true) mics.push(info);
    if (p.out === true) playback.push(info);
  }
  return { mics, playback };
}

// The app named by a ConsentStore key. Desktop apps sit under NonPackaged with
// the path's backslashes written as '#' ("C:#Program Files#Zoom#bin#Zoom.exe");
// Store apps use their package family name ("MSTeams_8wekyb3d8bbwe").
export function windowsBinary(keyName: string): string {
  const base = keyName.split('#').pop()!.replace(/\.exe$/i, '').toLowerCase();
  const name = keyName.includes('#') ? base : base.split('_')[0];
  return EXE_NAMES[name] ?? name;
}

// Parses `reg query <ConsentStore\microphone> /s`. An app holds the microphone
// right now when it has started (LastUsedTimeStart non-zero) and not stopped
// (LastUsedTimeStop zero).
export function parseConsentStore(text: string, ownNames: string[]): StreamInfo[] {
  const out: StreamInfo[] = [];
  let key = '';
  let started = false;
  let stopped = true;
  const flush = () => {
    if (!key || !started || stopped) return;
    const name = key.split('\\').pop()!;
    if (name === 'NonPackaged' || name === 'microphone') return;
    const exe = name.split('#').pop()!.toLowerCase();
    if (ownNames.some(n => exe === n.toLowerCase())) return;
    out.push({ key: name, pid: null, binary: windowsBinary(name) });
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (/^HKEY_/i.test(line)) {
      flush();
      key = line; started = false; stopped = true;
      continue;
    }
    const v = line.match(/^(LastUsedTimeStart|LastUsedTimeStop)\s+REG_QWORD\s+0x([0-9a-f]+)/i);
    if (!v) continue;
    const zero = /^0+$/.test(v[2]);
    if (v[1] === 'LastUsedTimeStart') started = !zero;
    else stopped = !zero;
  }
  flush();
  return out;
}

// Linux: `pactl subscribe` wakes us on any stream change; the snapshot reads
// the current source-outputs and sink-inputs.
export class PulseSource implements SignalSource {
  private sub: ReturnType<typeof spawn> | null = null;
  private resubscribe: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  // How long to wait before re-subscribing after the pactl child exits. Long
  // enough that a PipeWire restart is not a spawn storm, short enough that a
  // call starting right after the restart is still caught.
  private readonly RESUBSCRIBE_MS = 5000;

  start(onChange: () => void): void {
    if (this.sub) return;
    this.stopped = false;
    try {
      this.sub = spawn('pactl', ['subscribe'], { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      return; // no pactl — detection simply unavailable
    }
    this.sub.stdout?.on('data', (chunk: Buffer) => {
      if (/source-output|sink-input/.test(chunk.toString())) onChange();
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
      this.resubscribe = setTimeout(() => { this.resubscribe = null; this.start(onChange); }, this.RESUBSCRIBE_MS);
    });
  }

  stop(): void {
    this.stopped = true;
    if (this.resubscribe) { clearTimeout(this.resubscribe); this.resubscribe = null; }
    if (this.sub) { this.sub.kill(); this.sub = null; }
  }

  async snapshot(): Promise<Snapshot> {
    const [monitorIdx, soText, siText] = await Promise.all([
      this.monitorSourceIndexes(),
      execAsync('pactl list source-outputs').then(r => r.stdout).catch(() => ''),
      execAsync('pactl list sink-inputs').then(r => r.stdout).catch(() => ''),
    ]);
    // Mic captures = source-outputs on a real input (not a monitor). We do not
    // need to exclude our own recorder here: detection is gated off while
    // recording, so the recorder's own streams never reach this path.
    return {
      mics: parseStreams(soText).filter(s => s.source === null || !monitorIdx.has(s.source)),
      playback: parseStreams(siText),
    };
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
}

// macOS: the Swift helper's --watch-mic mode prints one JSON line each time the
// set of processes using audio changes. Needs macOS 14.2; on older systems the
// helper prints {"unsupported":true} and exits, and detection stays off.
export class MacSource implements SignalSource {
  private child: ReturnType<typeof spawn> | null = null;
  private restart: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private unsupported = false;
  private last: Snapshot = { mics: [], playback: [] };
  private readonly RESTART_MS = 5000;

  constructor(private helperPath: string, private ownBundle: string) {}

  start(onChange: () => void): void {
    if (this.child || this.unsupported) return;
    this.stopped = false;
    try {
      this.child = spawn(this.helperPath, ['--watch-mic'], { stdio: ['pipe', 'pipe', 'ignore'] });
    } catch {
      return;
    }
    let buf = '';
    this.child.stdout?.on('data', (chunk: Buffer) => {
      buf += chunk.toString();
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (line.includes('"unsupported"')) { this.unsupported = true; continue; }
        const snap = parseMacSnapshot(line, this.ownBundle);
        if (snap) { this.last = snap; onChange(); }
      }
    });
    this.child.on('error', () => { /* helper missing — detection unavailable */ });
    this.child.on('close', () => {
      this.child = null;
      if (this.stopped || this.unsupported || this.restart) return;
      this.restart = setTimeout(() => { this.restart = null; this.start(onChange); }, this.RESTART_MS);
    });
  }

  stop(): void {
    this.stopped = true;
    if (this.restart) { clearTimeout(this.restart); this.restart = null; }
    // The helper exits when its stdin closes; the kill covers a hung one.
    if (this.child) { this.child.stdin?.end(); this.child.kill(); this.child = null; }
  }

  async snapshot(): Promise<Snapshot> { return this.last; }
}

// Windows: polls the privacy registry, which has no change notification that
// Node can reach without a native module. A poll fires onChange only when the
// set of apps holding the microphone changes.
const CONSENT_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone';

export class WindowsSource implements SignalSource {
  private timer: ReturnType<typeof setInterval> | null = null;
  private last: StreamInfo[] = [];
  private readonly POLL_MS = 3000;

  constructor(private ownNames: string[]) {}

  start(onChange: () => void): void {
    if (this.timer) return;
    const poll = async () => {
      try {
        // windowsHide: without it every poll flashes a console window.
        const { stdout } = await execFileAsync('reg', ['query', CONSENT_KEY, '/s'], { windowsHide: true });
        const now = parseConsentStore(stdout, this.ownNames);
        const sig = (l: StreamInfo[]) => l.map(s => s.key).sort().join('|');
        if (sig(now) !== sig(this.last)) { this.last = now; onChange(); }
      } catch { /* key absent until an app first uses the mic */ }
    };
    this.timer = setInterval(() => { void poll(); }, this.POLL_MS);
    void poll();
  }

  stop(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  // The registry says nothing about playback, so only known conferencing apps
  // qualify on Windows.
  async snapshot(): Promise<Snapshot> { return { mics: this.last, playback: [] }; }
}

export class MeetingDetector {
  private debounce: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  // Apps we have already offered to record this call. Cleared when their mic
  // stream goes away, so leaving and rejoining prompts again — but an ignored
  // prompt never nags while the same call is still running.
  private handled = new Set<string>();
  private readonly DEBOUNCE_MS = 4000;

  constructor(
    private isEnabled: () => boolean,
    private isRecording: () => boolean,
    private onDetected: (c: MeetingCandidate) => void,
    private source: SignalSource = new PulseSource(),
  ) {}

  start(): void {
    this.stopped = false;
    // The debounce doubles as the "sustained call" filter: a transient
    // permission probe is gone before the timer fires.
    this.source.start(() => this.schedule());
    // A call may already be in progress when we start.
    this.schedule();
  }

  stop(): void {
    this.stopped = true;
    if (this.debounce) { clearTimeout(this.debounce); this.debounce = null; }
    this.source.stop();
  }

  private schedule(): void {
    if (this.debounce) clearTimeout(this.debounce);
    this.debounce = setTimeout(() => { void this.evaluate(); }, this.DEBOUNCE_MS);
  }

  private async evaluate(): Promise<void> {
    if (this.stopped || !this.isEnabled() || this.isRecording()) return;
    try {
      const { mics, playback } = await this.source.snapshot();

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

  // Best-effort meeting name from the window title. Never blocks the prompt.
  // wmctrl exists only on X11 Linux; elsewhere the app name stands in.
  private async resolveTitle(pid: number | null, binary: string): Promise<string> {
    if (process.platform !== 'linux') return `${appLabel(binary)} meeting`;
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
