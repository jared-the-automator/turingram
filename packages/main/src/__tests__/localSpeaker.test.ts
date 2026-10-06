import { describe, it, expect } from 'vitest';
import { activeRangesFromSilence, pinLocalSpeaker, dropPhantomRemoteSpeech, type Range } from '../stt/localSpeaker';
import type { TranscriptSegment } from '@turingyde/transcript-core';

const seg = (speaker: string, start: number, end: number): TranscriptSegment => ({
  id: `${speaker}-${start}`, meetingId: 'm1', speakerLabel: speaker,
  startTime: start, endTime: end, text: 'x',
});

describe('activeRangesFromSilence', () => {
  it('returns the gaps between silent spans', () => {
    expect(activeRangesFromSilence([[2, 5], [8, 9]], 12)).toEqual([[0, 2], [5, 8], [9, 12]]);
  });

  it('treats a file with no silence as entirely active', () => {
    expect(activeRangesFromSilence([], 10)).toEqual([[0, 10]]);
  });

  it('returns nothing when the whole file is silent', () => {
    expect(activeRangesFromSilence([[0, 10]], 10)).toEqual([]);
  });

  it('handles silence running to the end without a trailing active span', () => {
    expect(activeRangesFromSilence([[4, 10]], 10)).toEqual([[0, 4]]);
  });

  it('merges overlapping silent spans rather than emitting negative gaps', () => {
    expect(activeRangesFromSilence([[2, 6], [4, 8]], 10)).toEqual([[0, 2], [8, 10]]);
  });

  it('clamps spans that exceed the duration', () => {
    expect(activeRangesFromSilence([[8, 99]], 10)).toEqual([[0, 8]]);
  });

  it('returns nothing for a zero-length file', () => {
    expect(activeRangesFromSilence([], 0)).toEqual([]);
  });
});

describe('pinLocalSpeaker', () => {
  // Speaker 1 talks only while the mic is live; Speaker 2 only while it is not.
  const segments = [
    seg('Speaker 1', 0, 10),
    seg('Speaker 2', 10, 20),
    seg('Speaker 1', 20, 30),
  ];
  const micLive: Range[] = [[0, 10], [20, 30]];

  it('relabels the speaker who lines up with mic activity', () => {
    const out = pinLocalSpeaker(segments, micLive);
    expect(out.map(s => s.speakerLabel)).toEqual(['You', 'Speaker 2', 'You']);
  });

  it('leaves every other speaker untouched', () => {
    const out = pinLocalSpeaker(segments, micLive);
    expect(out.filter(s => s.speakerLabel === 'Speaker 2')).toHaveLength(1);
  });

  it('does not mutate the input segments', () => {
    pinLocalSpeaker(segments, micLive);
    expect(segments.map(s => s.speakerLabel)).toEqual(['Speaker 1', 'Speaker 2', 'Speaker 1']);
  });

  it('pins nothing when there was no mic activity at all', () => {
    expect(pinLocalSpeaker(segments, []).map(s => s.speakerLabel))
      .toEqual(['Speaker 1', 'Speaker 2', 'Speaker 1']);
  });

  // A wrong "You" is worse than an honest "Speaker 2", so ambiguity pins nothing.
  it('pins nothing when two speakers match the mic about equally', () => {
    const bleedy = [seg('Speaker 1', 0, 10), seg('Speaker 2', 10, 20)];
    const out = pinLocalSpeaker(bleedy, [[0, 10], [10, 20]]);
    expect(out.map(s => s.speakerLabel)).toEqual(['Speaker 1', 'Speaker 2']);
  });

  it('pins nothing when the best match is mostly outside mic activity', () => {
    const out = pinLocalSpeaker([seg('Speaker 1', 0, 10)], [[0, 2]]);
    expect(out[0].speakerLabel).toBe('Speaker 1');
  });

  it('pins a solo recording where the only speaker is the local one', () => {
    const out = pinLocalSpeaker([seg('Speaker 1', 0, 10)], [[0, 10]]);
    expect(out[0].speakerLabel).toBe('You');
  });

  it('handles an empty transcript', () => {
    expect(pinLocalSpeaker([], [[0, 10]])).toEqual([]);
  });

  it('ignores zero-length segments rather than dividing by zero', () => {
    const out = pinLocalSpeaker([seg('Speaker 1', 5, 5), seg('Speaker 2', 0, 10)], [[0, 10]]);
    expect(out.find(s => s.startTime === 0)?.speakerLabel).toBe('You');
  });
});

describe('dropPhantomRemoteSpeech', () => {
  const micActive: Range[] = [[0, 100]];
  const remoteActive: Range[] = [[0, 50]];
  // The rule only runs once a local speaker has been pinned, so every fixture
  // needs one — see the "could not be pinned" block below for why.
  const anchor = seg('You', 0, 1);
  const drop = (segs: TranscriptSegment[]) =>
    dropPhantomRemoteSpeech([anchor, ...segs], remoteActive, micActive).filter(s => s !== anchor);

  it('drops a remote-attributed segment with no remote audio while the mic was live', () => {
    expect(drop([seg('Avery', 60, 70)])).toEqual([]);
  });

  it('keeps remote speech that actually carries remote audio', () => {
    const segs = [seg('Avery', 10, 20)];
    expect(drop(segs)).toEqual(segs);
  });

  it('never drops the local speaker, however quiet the far end was', () => {
    // Post-call, the local user may still be talking — notes to self, a follow-up
    // phone call. That is their audio and it is correctly theirs.
    const segs = [seg('You', 60, 70)];
    expect(dropPhantomRemoteSpeech(segs, remoteActive, micActive)).toEqual(segs);
  });

  it('leaves a segment alone when the mic was NOT carrying it either', () => {
    // No remote audio and no mic audio means we cannot say where it came from,
    // so the rule declines to act rather than guessing.
    const segs = [seg('Avery', 60, 70)];
    expect(dropPhantomRemoteSpeech([anchor, ...segs], remoteActive, [[0, 50]]))
      .toEqual([anchor, ...segs]);
  });

  it('does nothing at all when remote detection returned nothing', () => {
    // Otherwise a failed ffmpeg pass would delete every remote speaker's turn.
    const segs = [seg('Avery', 10, 20), seg('Blake', 30, 40)];
    expect(dropPhantomRemoteSpeech([anchor, ...segs], [], micActive))
      .toEqual([anchor, ...segs]);
  });

  it('does nothing when mic detection returned nothing', () => {
    const segs = [seg('Avery', 60, 70)];
    expect(dropPhantomRemoteSpeech([anchor, ...segs], remoteActive, []))
      .toEqual([anchor, ...segs]);
  });

  it('tolerates a segment boundary clipping a few samples of real remote audio', () => {
    // 0.1s of a 10s segment is 1% — under the 2% floor, still phantom.
    expect(drop([seg('Avery', 49.9, 59.9)])).toEqual([]);
  });

  it('keeps a segment that straddles the end of the call', () => {
    // Half in real remote audio: that is a genuine turn the recording caught the
    // tail of, not room noise.
    const segs = [seg('Avery', 45, 55)];
    expect(drop(segs)).toEqual(segs);
  });
});

// A real client call, 2026-07-31. Everyone said goodbye at
// 1552s; ffmpeg's silencedetect puts the system channel silent from 1552s to the
// end of the recording at 1854.7s, while the mic kept going (an Instagram reel
// playing in the room). Diarization handed that audio to two clients who had
// already left the call.
describe('the Instagram reel', () => {
  const REMOTE: Range[] = [[0, 1552]];
  const MIC: Range[] = [[1552, 1737], [1737, 1746], [1748, 1749]];

  it('drops both phantom segments and keeps every real turn', () => {
    const segments = [
      seg('Blake', 1508, 1534),
      seg('You', 1534, 1535),
      seg('Avery', 1550, 1551),
      seg('You', 1551, 1552),
      seg('Blake', 1737, 1739),      // reel audio
      seg('Avery', 1741, 1747),  // reel audio
    ];
    const kept = dropPhantomRemoteSpeech(segments, REMOTE, MIC);
    expect(kept.map(s => `${s.speakerLabel}@${s.startTime}`)).toEqual([
      'Blake@1508', 'You@1534', 'Avery@1550', 'You@1551',
    ]);
  });
});

describe('dropPhantomRemoteSpeech when the local speaker could not be pinned', () => {
  // pinLocalSpeaker returns segments untouched when the answer is ambiguous, so
  // no segment carries "You". The local person's ordinary turns are then
  // indistinguishable from the phantom case: they speak, the far end is silent,
  // the mic is live. Without an exemptible local speaker there is no rule.
  it('drops nothing at all, rather than deleting the local speaker', () => {
    const segments = [
      seg('Speaker 1', 0, 10),   // remote talking
      seg('Speaker 2', 60, 70),  // the local person, alone, far end quiet
      seg('Speaker 2', 80, 90),
    ];
    expect(dropPhantomRemoteSpeech(segments, [[0, 50]], [[0, 100]])).toEqual(segments);
  });

  it('still applies once a local speaker IS pinned', () => {
    const segments = [
      seg('You', 60, 70),
      seg('Speaker 1', 80, 90),
    ];
    expect(dropPhantomRemoteSpeech(segments, [[0, 50]], [[0, 100]]))
      .toEqual([segments[0]]);
  });
});
