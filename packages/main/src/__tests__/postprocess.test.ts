import { describe, it, expect } from 'vitest';
import { speechExtentSec, inferableSpeakerRenames } from '../stt/postprocess';
import type { TranscriptSegment } from '@turingyde/transcript-core';

const seg = (startTime: number, endTime: number): TranscriptSegment => ({
  id: `${startTime}`, meetingId: 'm1', speakerLabel: 'Speaker 1', startTime, endTime, text: 'x',
});

describe('speechExtentSec', () => {
  it('returns the last spoken second, rounded', () => {
    expect(speechExtentSec([seg(0, 4.2), seg(3690, 3696.125)])).toBe(3696);
  });

  it('does not assume segments are ordered', () => {
    expect(speechExtentSec([seg(3690, 3696), seg(0, 4)])).toBe(3696);
  });

  it('returns 0 for an empty transcript', () => {
    expect(speechExtentSec([])).toBe(0);
  });
});

describe('inferableSpeakerRenames', () => {
  it('passes anonymous diarized labels through', () => {
    expect(inferableSpeakerRenames({ 'Speaker 1': 'Casey', 'Speaker 12': 'Drew' }))
      .toEqual({ 'Speaker 1': 'Casey', 'Speaker 12': 'Drew' });
  });

  // "You" is the pinned local speaker and anything else is a name a user set —
  // a model guess must never overwrite either.
  it('refuses to rename non-anonymous labels', () => {
    expect(inferableSpeakerRenames({ You: 'Sam', Casey: 'Cassie', 'Speaker 2': 'Ellis' }))
      .toEqual({ 'Speaker 2': 'Ellis' });
  });

  it('drops empty names', () => {
    expect(inferableSpeakerRenames({ 'Speaker 1': '   ' })).toEqual({});
  });
});
