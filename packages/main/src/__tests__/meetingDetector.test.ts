import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { pickMeetingCandidate, parseStreams, appLabel, cleanTitle, parseWmctrl, pickTitle, MeetingDetector, type StreamInfo } from '../meetingDetector';

// Stand-in for the `pactl subscribe` child: an EventEmitter with a piped stdout
// and a kill() that records whether teardown reached it.
const h = vi.hoisted(() => {
  const { EventEmitter } = require('events') as typeof import('events');
  class FakeChild extends EventEmitter {
    stdout = new EventEmitter();
    killed = false;
    kill() { this.killed = true; return true; }
  }
  const spawned: InstanceType<typeof FakeChild>[] = [];
  return { FakeChild, spawned };
});

vi.mock('child_process', async (orig) => {
  const actual = await orig<typeof import('child_process')>();
  return {
    ...actual,
    spawn: () => { const c = new h.FakeChild(); h.spawned.push(c); return c; },
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
