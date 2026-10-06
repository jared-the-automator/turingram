import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promisify } from 'util';
import {
  pickMeetingCandidate, parseStreams, appLabel, cleanTitle, parseWmctrl, pickTitle, MeetingDetector,
  macBinary, parseMacSnapshot, windowsBinary, parseConsentStore, MacSource, WindowsSource,
  type StreamInfo, type SignalSource,
} from '../meetingDetector';

// Stand-in for the `pactl subscribe` child: an EventEmitter with a piped stdout
// and a kill() that records whether teardown reached it.
const h = vi.hoisted(() => {
  const { EventEmitter } = require('events') as typeof import('events');
  class FakeChild extends EventEmitter {
    stdout = new EventEmitter();
    stdinEnded = false;
    stdin = { end: () => { this.stdinEnded = true; } };
    killed = false;
    args: string[] = [];
    kill() { this.killed = true; return true; }
  }
  const spawned: InstanceType<typeof FakeChild>[] = [];
  // What `reg query` prints on the next WindowsSource poll.
  const reg = { stdout: '' };
  return { FakeChild, spawned, reg };
});

vi.mock('child_process', async (orig) => {
  const actual = await orig<typeof import('child_process')>();
  return {
    ...actual,
    spawn: (_cmd: string, args: string[]) => {
      const c = new h.FakeChild(); c.args = args ?? []; h.spawned.push(c); return c;
    },
    execFile: Object.assign(() => { /* only the promisified form is used */ }, {
      [promisify.custom]: async () => ({ stdout: h.reg.stdout, stderr: '' }),
    }),
  };
});

const s = (binary: string, pid: number | null): StreamInfo => ({
  key: pid !== null ? String(pid) : binary, pid, binary,
});

describe('pickMeetingCandidate', () => {
  it('flags a known conferencing app on the mic even with no matching playback', () => {
    // Audio-only Zoom call: mic stream, no same-app playback.
    const c = pickMeetingCandidate([s('zoom', 100)], []);
    expect(c?.binary).toBe('zoom');
  });

  it('flags an unknown app doing two-way audio (mic + its own playback)', () => {
    const c = pickMeetingCandidate([s('somevoipthing', 200)], [s('somevoipthing', 200)]);
    expect(c?.binary).toBe('somevoipthing');
  });

  it('matches two-way by binary when the playback pid differs (helper processes)', () => {
    // Browsers capture and play from different child pids but the same binary.
    const c = pickMeetingCandidate([s('chrome', 300)], [s('chrome', 999)]);
    expect(c?.binary).toBe('chrome');
  });

  it('ignores a one-way mic grab from an unknown app (voice memo, not a call)', () => {
    expect(pickMeetingCandidate([s('somerecorder', 400)], [])).toBeNull();
  });

  it('ignores playback with no mic capture (music or a video)', () => {
    expect(pickMeetingCandidate([], [s('spotify', 500)])).toBeNull();
  });

  it('returns null when nothing is capturing', () => {
    expect(pickMeetingCandidate([], [])).toBeNull();
  });
});

describe('parseStreams', () => {
  it('extracts pid, binary and source index from a source-output block', () => {
    const text = [
      'Source Output #12',
      '\tSource: 53',
      '\tapplication.process.id = "4242"',
      '\tapplication.process.binary = "zoom"',
      'Source Output #13',
      '\tSource: 52',
      '\tapplication.process.binary = "obs"',
    ].join('\n');
    const got = parseStreams(text);
    expect(got).toEqual([
      { key: '4242', pid: 4242, binary: 'zoom', source: 53 },
      { key: 'obs', pid: null, binary: 'obs', source: 52 },
    ]);
  });

  it('parses sink-input blocks that have no Source line', () => {
    const text = [
      'Sink Input #7',
      '\tapplication.process.id = "9"',
      '\tapplication.process.binary = "chrome"',
    ].join('\n');
    expect(parseStreams(text)).toEqual([{ key: '9', pid: 9, binary: 'chrome', source: null }]);
  });

  it('drops blocks with no binary rather than emitting empty entries', () => {
    const text = 'Source Output #1\n\tSource: 5\n\tapplication.name = "unnamed"';
    expect(parseStreams(text)).toEqual([]);
  });

  it('returns nothing for empty input', () => {
    expect(parseStreams('')).toEqual([]);
  });
});

describe('appLabel', () => {
  it('maps known binaries to friendly names', () => {
    expect(appLabel('zoom')).toBe('Zoom');
    expect(appLabel('teams-for-linux')).toBe('Teams');
    expect(appLabel('chromium-browser')).toBe('Chrome');
  });
  it('title-cases an unknown binary', () => {
    expect(appLabel('foobar')).toBe('Foobar');
  });
  it('handles an empty binary', () => {
    expect(appLabel('')).toBe('a call');
  });
});

describe('cleanTitle', () => {
  it('strips a trailing browser name', () => {
    expect(cleanTitle('Q3 Sync - Google Chrome')).toBe('Q3 Sync');
    expect(cleanTitle('Standup — Mozilla Firefox')).toBe('Standup');
  });
  it('leaves a native app title alone', () => {
    expect(cleanTitle('Zoom Meeting')).toBe('Zoom Meeting');
  });
});

describe('parseWmctrl', () => {
  it('extracts pid and the full title from wmctrl -lp rows', () => {
    const out = [
      '0x03200003  0 4744   host Desktop',
      '0x07a00004  0 139737 host Q3 Sync - Google Chrome',
    ].join('\n');
    expect(parseWmctrl(out)).toEqual([
      { pid: 4744, title: 'Desktop' },
      { pid: 139737, title: 'Q3 Sync - Google Chrome' },
    ]);
  });
});

describe('pickTitle', () => {
  const rows = [
    { pid: 10, title: 'Some File - Editor' },
    { pid: 42, title: 'Weekly Standup - Google Chrome' },
    { pid: 99, title: 'Zoom Meeting' },
  ];

  // The branch a real windowed call exercises but an ffmpeg-based live test cannot.
  it('names the meeting from the exact call-window PID, browser suffix stripped', () => {
    expect(pickTitle(rows, 42, 'chrome')).toBe('Weekly Standup');
  });

  it('falls back to a meeting-pattern window when the PID has no window', () => {
    expect(pickTitle(rows, 12345, 'zoom')).toBe('Zoom Meeting');
  });

  it('falls back to the app name when nothing matches', () => {
    expect(pickTitle([{ pid: 1, title: 'Spotify' }], 12345, 'teams')).toBe('Teams meeting');
  });

  it('skips the PID branch entirely when pid is null, using the meeting-pattern fallback', () => {
    // No PID match possible, and the Chrome row is not meeting-like, so the
    // "Zoom Meeting" window wins — not the browser standup.
    expect(pickTitle(rows, null, 'chrome')).toBe('Zoom Meeting');
  });
});

describe('MeetingDetector subscription lifecycle', () => {
  beforeEach(() => { h.spawned.length = 0; vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  const make = () => new MeetingDetector(() => true, () => false, () => { /* unused */ });

  it('subscribes to pactl on start', () => {
    const d = make();
    d.start();
    expect(h.spawned).toHaveLength(1);
    d.stop();
  });

  it('resubscribes when the pactl subscribe child dies', () => {
    // PipeWire restarts (or a `systemctl --user restart pipewire`) kill the
    // subscribe child. Without a respawn the detector goes permanently deaf and
    // never prompts again for the rest of the session — indistinguishable, from
    // the outside, from "auto meeting detection just stopped working".
    const d = make();
    d.start();
    expect(h.spawned).toHaveLength(1);

    h.spawned[0].emit('close', 0, null);
    vi.advanceTimersByTime(5000);

    expect(h.spawned).toHaveLength(2);
    d.stop();
  });

  it('does not resubscribe after stop()', () => {
    const d = make();
    d.start();
    d.stop();
    h.spawned[0].emit('close', 0, null);
    vi.advanceTimersByTime(30000);
    expect(h.spawned).toHaveLength(1);
  });
});

describe('macBinary', () => {
  it('maps a native client bundle id', () => {
    expect(macBinary('us.zoom.xos', 'zoom.us')).toBe('zoom');
  });

  it('maps the browser helper processes that own the capture', () => {
    expect(macBinary('com.google.Chrome.helper', 'Google Chrome Helper')).toBe('chrome');
    expect(macBinary('com.apple.WebKit.GPU', 'com.apple.WebKit.GPU')).toBe('safari');
  });

  it('falls back to the process name for an unknown app', () => {
    expect(macBinary('com.example.Voip', 'VoipThing')).toBe('voipthing');
  });
});

describe('parseMacSnapshot', () => {
  const line = JSON.stringify({ procs: [
    { pid: 10, bundle: 'us.zoom.xos', name: 'zoom.us', in: true, out: true },
    { pid: 11, bundle: 'com.spotify.client', name: 'Spotify', in: false, out: true },
    { pid: 12, bundle: 'com.turingyde.turingram.helper', name: 'Turingram Helper', in: true, out: true },
  ] });

  it('splits input and output and drops our own processes', () => {
    const snap = parseMacSnapshot(line, 'com.turingyde.turingram')!;
    expect(snap.mics.map(m => m.binary)).toEqual(['zoom']);
    expect(snap.playback.map(m => m.binary)).toEqual(['zoom', 'spotify']);
    expect(snap.mics[0].key).toBe('10');
  });

  it('rejects a line that is not a process list', () => {
    expect(parseMacSnapshot('not json', 'x')).toBeNull();
    expect(parseMacSnapshot('{"unsupported":true}', 'x')).toBeNull();
  });
});

describe('windowsBinary', () => {
  it('reads the executable out of a NonPackaged path key', () => {
    expect(windowsBinary('C:#Program Files#Zoom#bin#Zoom.exe')).toBe('zoom');
    expect(windowsBinary('C:#Program Files (x86)#Microsoft#Edge#Application#msedge.exe')).toBe('msedge');
  });

  it('reads the app out of a Store package family name', () => {
    expect(windowsBinary('MSTeams_8wekyb3d8bbwe')).toBe('teams');
  });
});

const ROOT = 'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\CapabilityAccessManager\\ConsentStore\\microphone';
const consent = (rows: Array<[string, string, string]>) => [
  ROOT, '    Value    REG_SZ    Allow', '',
  `${ROOT}\\NonPackaged`, '    Value    REG_SZ    Allow', '',
  ...rows.flatMap(([key, start, stop]) => [
    `${ROOT}\\${key}`,
    '    Value    REG_SZ    Allow',
    `    LastUsedTimeStart    REG_QWORD    ${start}`,
    `    LastUsedTimeStop    REG_QWORD    ${stop}`,
    '',
  ]),
].join('\r\n');

describe('parseConsentStore', () => {
  it('lists only apps that started and have not stopped, minus our own', () => {
    const text = consent([
      ['MSTeams_8wekyb3d8bbwe', '0x1db1a2b3c4d5e6f', '0x0'],
      ['NonPackaged\\C:#Program Files#Zoom#bin#Zoom.exe', '0x1db1a2b3c4d5e6f', '0x0'],
      ['NonPackaged\\C:#Program Files#Google#Chrome#Application#chrome.exe', '0x1db1a2b3c4d5e00', '0x1db1a2b3c4d5e10'],
      ['NonPackaged\\C:#Program Files#Turingram#Turingram.exe', '0x1db1a2b3c4d5e6f', '0x0'],
      ['Microsoft.WindowsSoundRecorder_8wekyb3d8bbwe', '0x0', '0x0'],
    ]);
    const live = parseConsentStore(text, ['Turingram.exe']);
    expect(live.map(s => s.binary)).toEqual(['teams', 'zoom']);
    expect(pickMeetingCandidate(live, [])?.binary).toBe('teams');
  });
});

describe('MacSource', () => {
  beforeEach(() => { h.spawned.length = 0; vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('runs the helper in watch mode and serves the latest line', async () => {
    const src = new MacSource('/x/helper', 'com.turingyde.turingram');
    const onChange = vi.fn();
    src.start(onChange);
    expect(h.spawned[0].args).toEqual(['--watch-mic']);

    const line = JSON.stringify({ procs: [{ pid: 7, bundle: 'us.zoom.xos', name: 'zoom.us', in: true, out: false }] });
    // Split across chunks: a line is only parsed once its newline arrives.
    h.spawned[0].stdout.emit('data', Buffer.from(line.slice(0, 20)));
    expect(onChange).not.toHaveBeenCalled();
    h.spawned[0].stdout.emit('data', Buffer.from(line.slice(20) + '\n'));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect((await src.snapshot()).mics.map(m => m.binary)).toEqual(['zoom']);

    src.stop();
    expect(h.spawned[0].stdinEnded).toBe(true);
  });

  it('restarts a helper that dies, and gives up on an unsupported macOS', () => {
    const src = new MacSource('/x/helper', 'com.turingyde.turingram');
    src.start(() => { /* unused */ });
    h.spawned[0].emit('close', 1, null);
    vi.advanceTimersByTime(5000);
    expect(h.spawned).toHaveLength(2);

    h.spawned[1].stdout.emit('data', Buffer.from('{"unsupported":true}\n'));
    h.spawned[1].emit('close', 0, null);
    vi.advanceTimersByTime(30000);
    expect(h.spawned).toHaveLength(2);
    expect(src.status()).toBe('off, needs macOS 14.2 or later');
    src.stop();
  });
});

describe('WindowsSource', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('fires only when the set of apps holding the mic changes', async () => {
    const zoom = consent([['NonPackaged\\C:#Program Files#Zoom#bin#Zoom.exe', '0x1db1a2b3c4d5e6f', '0x0']]);
    h.reg.stdout = zoom;
    const src = new WindowsSource(['Turingram.exe']);
    const onChange = vi.fn();
    src.start(onChange);
    await vi.advanceTimersByTimeAsync(0);
    expect(onChange).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(9000);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect((await src.snapshot()).mics.map(m => m.binary)).toEqual(['zoom']);

    h.reg.stdout = consent([]);
    await vi.advanceTimersByTimeAsync(3000);
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(src.status()).toBe('watching the microphone privacy registry');
    src.stop();
  });
});

describe('MeetingDetector with a platform source', () => {
  // Off Linux the title is the app name; on Linux it would shell out to wmctrl.
  const realPlatform = process.platform;
  beforeEach(() => { vi.useFakeTimers(); Object.defineProperty(process, 'platform', { value: 'win32' }); });
  afterEach(() => { vi.useRealTimers(); Object.defineProperty(process, 'platform', { value: realPlatform }); });

  it('prompts once per call from whatever the source reports', async () => {
    let fire = () => { /* set by start */ };
    let mics: StreamInfo[] = [];
    const source: SignalSource = {
      start: (cb) => { fire = cb; },
      stop: () => { /* nothing */ },
      snapshot: async () => ({ mics, playback: [] }),
      status: () => 'fake',
    };
    const onDetected = vi.fn();
    const d = new MeetingDetector(() => true, () => false, onDetected, source);
    d.start();

    mics = [{ key: 'MSTeams_8wekyb3d8bbwe', pid: null, binary: 'teams' }];
    fire();
    await vi.advanceTimersByTimeAsync(4000);
    expect(onDetected).toHaveBeenCalledTimes(1);
    expect(onDetected.mock.calls[0][0]).toEqual({ app: 'Teams', title: 'Teams meeting' });

    fire();
    await vi.advanceTimersByTimeAsync(4000);
    expect(onDetected).toHaveBeenCalledTimes(1);
    d.stop();
  });
});
