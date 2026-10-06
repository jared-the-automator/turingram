import { describe, it, expect } from 'vitest';
import { groupWordsBySpeaker, normalizeSpeaker, buildQuery, transcribeAudioDeepgram, type DeepgramWord } from '../stt/deepgram';

const w = (word: string, start: number, end: number, speaker?: number): DeepgramWord =>
  ({ word, punctuated_word: word, start, end, speaker });

describe('normalizeSpeaker', () => {
  it('maps Deepgram 0-based speakers to 1-based labels', () => {
    expect(normalizeSpeaker(0)).toBe('Speaker 1');
    expect(normalizeSpeaker(3)).toBe('Speaker 4');
  });

  it('falls back to Speaker 1 when diarization returns nothing', () => {
    expect(normalizeSpeaker(undefined)).toBe('Speaker 1');
    expect(normalizeSpeaker(null)).toBe('Speaker 1');
  });
});

describe('groupWordsBySpeaker', () => {
  it('collapses consecutive words from one speaker into a single segment', () => {
    const segs = groupWordsBySpeaker(
      [w('Hello', 0.1, 0.5, 0), w('there', 0.5, 0.9, 0), w('friend', 0.9, 1.4, 0)],
      'm1',
    );
    expect(segs).toHaveLength(1);
    expect(segs[0].text).toBe('Hello there friend');
    expect(segs[0].speakerLabel).toBe('Speaker 1');
  });

  it('starts a new segment when the speaker changes, and back again', () => {
    const segs = groupWordsBySpeaker(
      [w('Hi', 0, 1, 0), w('Hey', 1, 2, 1), w('Right', 2, 3, 0)],
      'm1',
    );
    expect(segs.map(s => [s.speakerLabel, s.text])).toEqual([
      ['Speaker 1', 'Hi'],
      ['Speaker 2', 'Hey'],
      ['Speaker 1', 'Right'],
    ]);
  });

  // Regression guard: AssemblyAI reports milliseconds and its mapper divides by
  // 1000. Deepgram reports SECONDS. Copying that conversion across would put a
  // 60-second meeting at 0.06s and silently break every timestamp in the UI.
  it('treats Deepgram timestamps as seconds, applying no conversion', () => {
    const segs = groupWordsBySpeaker([w('One', 12.5, 59.9, 0)], 'm1');
    expect(segs[0].startTime).toBe(12.5);
    expect(segs[0].endTime).toBe(59.9);
  });

  it('spans a segment from its first word start to its last word end', () => {
    const segs = groupWordsBySpeaker(
      [w('a', 1, 2, 0), w('b', 2, 3, 0), w('c', 3, 7.25, 0)],
      'm1',
    );
    expect(segs[0].startTime).toBe(1);
    expect(segs[0].endTime).toBe(7.25);
  });

  it('prefers punctuated_word over the raw word', () => {
    const segs = groupWordsBySpeaker(
      [{ word: 'hello', punctuated_word: 'Hello,', start: 0, end: 1, speaker: 0 }],
      'm1',
    );
    expect(segs[0].text).toBe('Hello,');
  });

  it('keeps the transcript when diarization returns no words', () => {
    const segs = groupWordsBySpeaker([], 'm1', 'salvaged transcript');
    expect(segs).toHaveLength(1);
    expect(segs[0].text).toBe('salvaged transcript');
    expect(segs[0].speakerLabel).toBe('Speaker 1');
  });

  it('returns nothing when there is neither words nor transcript', () => {
    expect(groupWordsBySpeaker([], 'm1', '   ')).toEqual([]);
    expect(groupWordsBySpeaker(null, 'm1')).toEqual([]);
  });

  it('drops blank words rather than emitting empty segments', () => {
    const segs = groupWordsBySpeaker(
      [w('   ', 0, 1, 0), w('real', 1, 2, 0)],
      'm1',
    );
    expect(segs).toHaveLength(1);
    expect(segs[0].text).toBe('real');
  });
});

describe('buildQuery', () => {
  const params = (q: string) => new URLSearchParams(q);

  // Privacy-critical: without this, requests can be swept into Deepgram's Model
  // Improvement Program. The whole positioning rests on it.
  it('always opts out of the Model Improvement Program', () => {
    expect(params(buildQuery()).get('mip_opt_out')).toBe('true');
    expect(params(buildQuery({ vocabulary: ['x'] })).get('mip_opt_out')).toBe('true');
  });

  it('requests diarization on the costed model', () => {
    const p = params(buildQuery());
    expect(p.get('diarize')).toBe('true');
    expect(p.get('model')).toBe('nova-3');
  });

  // keyterm is repeated per term; comma-joining silently produces one bogus term.
  it('repeats keyterm per phrase instead of joining them', () => {
    const p = params(buildQuery({ vocabulary: ['Turingram', 'customer service'] }));
    expect(p.getAll('keyterm')).toEqual(['Turingram', 'customer service']);
  });

  it('drops blank and over-long terms, and caps the count', () => {
    const p = params(buildQuery({
      vocabulary: ['ok', '  ', 'x'.repeat(80), ...Array.from({ length: 150 }, (_, i) => `t${i}`)],
    }));
    const terms = p.getAll('keyterm');
    expect(terms).not.toContain('');
    expect(terms.some(t => t.length > 50)).toBe(false);
    expect(terms.length).toBeLessThanOrEqual(100);
  });
});

// The pipeline's "stop & discard" contract depends on an aborted signal ending
// the upload rather than the upload running to completion and being thrown away.
// The transport moved from fetch to node:https to escape undici's unraisable
// 300-second headers timeout, and hand-rolled abort wiring is exactly the kind
// of thing that silently stops working.
describe('transcribeAudioDeepgram abort handling', () => {
  it('rejects without touching the network when the signal is already aborted', async () => {
    await expect(
      transcribeAudioDeepgram('/nonexistent.wav', 'm1', 'key', {}, AbortSignal.abort()),
    ).rejects.toThrow();
  });

  it('does not read the file before checking the signal', async () => {
    // A missing path would throw ENOENT if the abort check came second; the
    // rejection must be the abort, not a filesystem error.
    const err = await transcribeAudioDeepgram('/nonexistent.wav', 'm1', 'key', {}, AbortSignal.abort())
      .catch((e: Error) => e);
    expect(String(err)).not.toMatch(/ENOENT/);
  });
});
