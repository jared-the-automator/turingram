import { describe, it, expect } from 'vitest';
import {
  parseSilenceLines,
  shouldAutostop,
  pickPlaybackSink,
  BILATERAL_SILENCE_MS,
  REMOTE_SILENCE_MS,
  SYS_AUDIBLE_MIN_SEC,
} from '../audio/linux';

describe('parseSilenceLines', () => {
  it('reads a lone silence_start with its stream time', () => {
    expect(parseSilenceLines('[silencedetect @ 0x55] silence_start: 3863.9\n'))
      .toEqual([{ kind: 'start', at: 3863.9 }]);
  });

  it('does not mistake silence_duration on an end line for a start', () => {
    const line = '[silencedetect @ 0x55] silence_end: 3987.2 | silence_duration: 124.06\n';
    expect(parseSilenceLines(line)).toEqual([{ kind: 'end', at: 3987.2 }]);
  });

  it('applies BOTH events when one stderr read carries an end then a start', () => {
    // The old code tested the whole chunk with a single regex, so a chunk in this
    // order was read as "start" only — and because the start was applied with
    // `?? Date.now()` over a value the swallowed end should have cleared, the
    // channel kept a stale, far-too-early silence timestamp.
    const chunk =
      '[silencedetect @ 0x55] silence_end: 3863.4 | silence_duration: 17.2\n' +
      '[silencedetect @ 0x55] silence_start: 3863.9\n';
    expect(parseSilenceLines(chunk).map(e => e.kind)).toEqual(['end', 'start']);
  });

  it('applies both when the order is reversed, leaving the channel NOT silent', () => {
    // The reverse chunk was worse: the end was dropped entirely and the channel
    // stayed marked silent for the rest of the recording.
    const chunk =
      '[silencedetect @ 0x55] silence_start: 100.0\n' +
      '[silencedetect @ 0x55] silence_end: 103.0 | silence_duration: 3.0\n';
    expect(parseSilenceLines(chunk)).toEqual([
      { kind: 'start', at: 100.0 },
      { kind: 'end', at: 103.0 },
    ]);
  });

  it('ignores ffmpeg progress lines interleaved with events', () => {
    const chunk =
      'size=   12345kB time=00:12:34.56 bitrate=  256.0kbits/s speed=   1x\n' +
      '[silencedetect @ 0x55] silence_start: 42.0\n';
    expect(parseSilenceLines(chunk)).toEqual([{ kind: 'start', at: 42.0 }]);
  });

  it('returns nothing for output with no events', () => {
    expect(parseSilenceLines('size= 1kB time=00:00:01.00\n')).toEqual([]);
  });

  it('survives a mangled line by reporting the event with an unknown time', () => {
    // A stderr read can split mid-line; the event still matters, the time is lost.
    const got = parseSilenceLines('[silencedetect @ 0x55] silence_start: ');
    expect(got).toHaveLength(1);
    expect(got[0].kind).toBe('start');
    expect(Number.isNaN(got[0].at)).toBe(true);
  });
});

describe('shouldAutostop', () => {
  const t0 = 1_000_000;

  it('does not fire while either channel is live', () => {
    expect(shouldAutostop({ micSilentSince: t0, sysSilentSince: null, hasSys: true, sysEverAudible: true }, t0 + 10 * 60_000)).toBe(false);
    expect(shouldAutostop({ micSilentSince: null, sysSilentSince: t0, hasSys: true, sysEverAudible: true }, t0 + 60_000)).toBe(false);
  });

  it('fires once both channels have been quiet for the bilateral window', () => {
    const s = { micSilentSince: t0, sysSilentSince: t0, hasSys: true, sysEverAudible: true };
    expect(shouldAutostop(s, t0 + BILATERAL_SILENCE_MS - 1)).toBe(false);
    expect(shouldAutostop(s, t0 + BILATERAL_SILENCE_MS)).toBe(true);
  });

  it('measures the bilateral window from the LATER of the two channels', () => {
    const s = { micSilentSince: t0 + 60_000, sysSilentSince: t0, hasSys: true, sysEverAudible: true };
    expect(shouldAutostop(s, t0 + 60_000 + BILATERAL_SILENCE_MS - 1)).toBe(false);
    expect(shouldAutostop(s, t0 + 60_000 + BILATERAL_SILENCE_MS)).toBe(true);
  });

  it('fires on the far end alone, however busy the microphone is', () => {
    // The whole point: the mic is the user's room, not the meeting.
    const s = { micSilentSince: null, sysSilentSince: t0, hasSys: true, sysEverAudible: true };
    expect(shouldAutostop(s, t0 + REMOTE_SILENCE_MS - 1)).toBe(false);
    expect(shouldAutostop(s, t0 + REMOTE_SILENCE_MS)).toBe(true);
  });

  it('never fires on the remote rule for a mic-only recording', () => {
    // hasSys=false means there is no far end to go quiet; only the mic gates it,
    // or a mono recording could never auto-stop at all.
    const s = { micSilentSince: null, sysSilentSince: null, hasSys: false, sysEverAudible: false };
    expect(shouldAutostop(s, t0 + 10 * REMOTE_SILENCE_MS)).toBe(false);
    expect(shouldAutostop({ ...s, micSilentSince: t0 }, t0 + BILATERAL_SILENCE_MS)).toBe(true);
  });

  // 2026-08-06, meeting a3540288: the sys capture recorded 305.6s of digital
  // zeros because Google Meet played to a USB headset the capture never
  // monitored. The remote rule read that as "the far end hung up" and cut the
  // meeting off at 302s, mid-conversation. A channel that has NEVER carried
  // audio is a broken capture, not a finished call — the remote rule may only
  // act on silence that FOLLOWED sound.
  it('refuses the remote rule when the sys channel was never audible', () => {
    const s = { micSilentSince: null, sysSilentSince: t0, hasSys: true, sysEverAudible: false };
    expect(shouldAutostop(s, t0 + 10 * REMOTE_SILENCE_MS)).toBe(false);
  });

  it('still applies the bilateral rule when the sys channel was never audible', () => {
    // Dead sys + a mic that has ALSO been quiet for two minutes is a finished
    // recording whichever way you read it.
    const s = { micSilentSince: t0, sysSilentSince: t0, hasSys: true, sysEverAudible: false };
    expect(shouldAutostop(s, t0 + BILATERAL_SILENCE_MS)).toBe(true);
  });
});

describe('pickPlaybackSink', () => {
  const SINKS =
    '52\talsa_output.pci-0000_00_1f.3.analog-stereo\tPipeWire\ts32le 2ch 48000Hz\tRUNNING\n' +
    '55\talsa_output.usb-Razer_Razer_BlackShark_V2_Pro-00.iec958-stereo\tPipeWire\ts16le 2ch 48000Hz\tRUNNING\n' +
    '61\tturingram_ec\tPipeWire\tfloat32le 2ch 48000Hz\tRUNNING\n';

  const input = (id: number, sink: number, props: Record<string, string>) =>
    `Sink Input #${id}\n\tDriver: PipeWire\n\tSink: ${sink}\n\tProperties:\n` +
    Object.entries(props).map(([k, v]) => `\t\t${k} = "${v}"\n`).join('') + '\n';

  const meet = (id: number, sink: number) => input(id, sink, {
    'application.name': 'Google Chrome',
    'application.process.binary': 'chrome',
    'media.name': 'Playback',
  });
  const ownStream = (id: number, sink: number) => input(id, sink, {
    'application.name': 'Chromium',
    'application.process.binary': 'turingram-workspace',
    'media.name': 'Playback',
  });
  const ecLoopback = (id: number, sink: number) => input(id, sink, {
    'media.name': 'Echo-Cancel Sink',
    'node.name': 'turingram_ec',
  });

  it('finds the sink real playback is on when it is not the EC sink', () => {
    // The 2026-08-06 failure: Meet pinned to the headset, everything Turingram
    // captured was the EC monitor, 305.6s of zeros.
    const text = meet(400, 55) + ownStream(364, 52) + ecLoopback(401, 52);
    expect(pickPlaybackSink(text, SINKS, 'turingram-workspace', 'turingram_ec'))
      .toBe('alsa_output.usb-Razer_Razer_BlackShark_V2_Pro-00.iec958-stereo');
  });

  it('returns the EC sink when the moves actually worked', () => {
    const text = meet(400, 61) + ownStream(364, 52) + ecLoopback(401, 52);
    expect(pickPlaybackSink(text, SINKS, 'turingram-workspace', 'turingram_ec'))
      .toBe('turingram_ec');
  });

  it('ignores our own stream and the EC loopback entirely', () => {
    // Only Turingram itself and the EC plumbing are playing: no evidence of
    // where meeting audio goes, so no opinion — the caller keeps its default.
    const text = ownStream(364, 52) + ecLoopback(401, 52);
    expect(pickPlaybackSink(text, SINKS, 'turingram-workspace', 'turingram_ec')).toBeNull();
  });

  it('returns null for no streams at all', () => {
    expect(pickPlaybackSink('', SINKS, 'turingram-workspace', 'turingram_ec')).toBeNull();
  });

  it('prefers the non-EC sink on a split vote', () => {
    // One stream herded into the EC sink, one that would not move. The EC path
    // is the one that has already proven it can lose audio; monitor the other.
    const text = meet(400, 61) + input(402, 55, {
      'application.name': 'zoom',
      'application.process.binary': 'zoom',
      'media.name': 'Playback',
    });
    expect(pickPlaybackSink(text, SINKS, 'turingram-workspace', 'turingram_ec'))
      .toBe('alsa_output.usb-Razer_Razer_BlackShark_V2_Pro-00.iec958-stereo');
  });

  it('majority wins when more streams sit on one sink', () => {
    const text = meet(400, 55) + meet(403, 55) + input(402, 61, {
      'application.name': 'spotify',
      'application.process.binary': 'spotify',
      'media.name': 'Playback',
    });
    expect(pickPlaybackSink(text, SINKS, 'turingram-workspace', 'turingram_ec'))
      .toBe('alsa_output.usb-Razer_Razer_BlackShark_V2_Pro-00.iec958-stereo');
  });

  it('returns null when the winning sink index is not in the sink list', () => {
    expect(pickPlaybackSink(meet(400, 99), SINKS, 'turingram-workspace', 'turingram_ec')).toBeNull();
  });
});

// Replay of the real 2026-07-30 recording (meeting e44020b5), taken by running
// ffmpeg's silencedetect with the app's own settings — noise=-35dB:d=2 — over
// each channel of the retained capture. The call ended at 3676s (the last
// goodbye); recording ran to a manual stop at 4599.7s.
//
// The numbers that justify REMOTE_SILENCE_MS: across the whole 77 minutes the
// mic produced 218 separate silent runs and only 3 reached two minutes, while
// the remote channel's longest silence during the live call was 85 seconds.
const MIC_RUNS = '3603-3609 3634-3639 3644-3670 3671-3676 3677-3696 3696-3700 3700-3706 ' +
  '3706-3763 3763-3778 3778-3787 3787-3795 3797-3846 3846-3863 3863-3987 3987-3995 ' +
  '3995-4013 4013-4042 4042-4212 4212-4227 4227-4233 4233-4347 4348-4401 4401-4600';
const SYS_RUNS = '3602-3604 3610-3622 3622-3634 3674-3754 3754-4600';
const RECORDING_END = 4599.7;
// silencedetect reports the START of a run, but only after d=2 has elapsed, so
// the app learns of it two seconds late.
const EMIT_DELAY = 2;

type Event = { at: number; channel: 'mic' | 'sys'; kind: 'start' | 'end' };

function eventsFor(runs: string, channel: 'mic' | 'sys'): Event[] {
  return runs.split(' ').flatMap(run => {
    const [start, end] = run.split('-').map(Number);
    const out: Event[] = [{ at: start + EMIT_DELAY, channel, kind: 'start' }];
    if (end < RECORDING_END) out.push({ at: end, channel, kind: 'end' });
    return out;
  });
}

// Drives the real decision function over the real timeline at the real 5s poll
// interval, and returns the second at which it would have stopped the recording.
// micNeverSilent models the ordinary case this fix exists for: a room that never
// gives the detector two clear minutes, so the bilateral rule can never fire.
function replay(micNeverSilent = false): number | null {
  const events = [
    ...(micNeverSilent ? [] : eventsFor(MIC_RUNS, 'mic')),
    ...eventsFor(SYS_RUNS, 'sys'),
  ].sort((a, b) => a.at - b.at);
  let micSilentSince: number | null = null;
  let sysSilentSince: number | null = null;
  let sysEverAudible = false;
  let next = 0;
  for (let now = 3600; now <= RECORDING_END; now += 5) {
    while (next < events.length && events[next].at <= now) {
      const e = events[next++];
      if (e.kind === 'start') {
        if (e.channel === 'mic') micSilentSince = micSilentSince ?? e.at;
        else {
          sysSilentSince = sysSilentSince ?? e.at;
          // Mirrors the session logic: silence that BEGINS this far into the
          // recording proves audio came before it.
          if (e.at >= SYS_AUDIBLE_MIN_SEC) sysEverAudible = true;
        }
      } else if (e.channel === 'mic') micSilentSince = null;
      else {
        sysSilentSince = null;
        sysEverAudible = true;
      }
    }
    // The replay is in seconds; the thresholds are in ms.
    const scaled = {
      micSilentSince: micSilentSince === null ? null : micSilentSince * 1000,
      sysSilentSince: sysSilentSince === null ? null : sysSilentSince * 1000,
      hasSys: true,
      sysEverAudible,
    };
    if (shouldAutostop(scaled, now * 1000)) return now;
  }
  return null;
}

describe('replayed against the real 2026-07-30 recording', () => {
  it('ends the recording well before the manual stop', () => {
    const firedAt = replay();
    expect(firedAt).not.toBeNull();
    // The bilateral rule gets there first, on the mic's 3863-3987 run — by less
    // than two seconds of margin. Worth recording that it SHOULD have fired here
    // on the day and did not: autostop used to disarm itself before emitting, so
    // a stop() that failed left the detector dead for the rest of the recording.
    expect(firedAt).toBe(3985);
    expect(RECORDING_END - firedAt!).toBeGreaterThan(600);
  });

  it('still stops when the mic never gives it two clear minutes', () => {
    // The mic managed a two-minute silence only 3 times in 77 minutes, and only
    // once with any margin. Take those away and the far end alone carries it:
    // the remote went quiet at 3754 and never came back.
    expect(replay(true)).toBe(4060);
  });

  it('leaves the live part of the call untouched', () => {
    // Nothing may fire before the last spoken word at 3676s, or the fix would be
    // cutting meetings off mid-sentence to save a few cents.
    expect(replay()!).toBeGreaterThan(3676);
    expect(replay(true)!).toBeGreaterThan(3676);
  });
});

describe('replayed against the broken 2026-08-06 recording', () => {
  // Meeting a3540288: the sys channel was digital zeros from the first sample —
  // one silence_start at stream time 0 (reported at 2s, after d=2), never an
  // end — while the mic carried a live conversation. The old rule stopped the
  // recording at ~302s; the fixed rule must let it run.
  it('does not cut off a meeting whose sys channel was dead from the start', () => {
    const wallStart = 1_000_000;
    let sysSilentSince: number | null = null;
    let sysEverAudible = false;
    for (let now = 0; now <= 3600; now += 5) {
      if (now >= 2 && sysSilentSince === null) {
        const at = 0; // stream time on the silence_start line
        sysSilentSince = wallStart + now * 1000;
        if (at >= SYS_AUDIBLE_MIN_SEC) sysEverAudible = true;
      }
      const s = { micSilentSince: null, sysSilentSince, hasSys: true, sysEverAudible };
      expect(shouldAutostop(s, wallStart + now * 1000)).toBe(false);
    }
  });
});
