import { describe, it, expect } from 'vitest';
import { buildPrompt, buildTranscriptText, parseSummaryResponse } from '../stt/summarize';
import type { TranscriptSegment } from '@turingyde/transcript-core';

const seg = (speakerLabel: string, text: string): TranscriptSegment => ({
  id: `${speakerLabel}-${text}`, meetingId: 'm1', speakerLabel,
  startTime: 0, endTime: 1, text,
});

describe('buildTranscriptText', () => {
  it('renders speaker-prefixed lines', () => {
    const out = buildTranscriptText([seg('Speaker 1', 'hi'), seg('Speaker 2', 'hello')]);
    expect(out).toBe('Speaker 1: hi\nSpeaker 2: hello');
  });
});

describe('buildPrompt', () => {
  // The user's own notes are the single most-praised behavior in this category
  // (Granola's signature move). If they silently stop reaching the model, the
  // summaries get generically worse in a way nobody would trace back to here.
  it('includes the user notes when present', () => {
    const out = buildPrompt([seg('Speaker 1', 'hi')], 'decide on pricing');
    expect(out).toContain('<notes>');
    expect(out).toContain('decide on pricing');
    expect(out).toContain('<transcript>');
  });

  it('omits the notes block entirely when there are no notes', () => {
    expect(buildPrompt([seg('Speaker 1', 'hi')], '   ')).not.toContain('<notes>');
    expect(buildPrompt([seg('Speaker 1', 'hi')], '')).not.toContain('<notes>');
  });
});

describe('parseSummaryResponse', () => {
  it('reads a well-formed response', () => {
    const out = parseSummaryResponse({
      summary: '  Decided to ship.  ',
      action_items: [{ text: 'Send the deck', owner: 'Jared', deadline: 'Friday' }],
    });
    expect(out.summary).toBe('Decided to ship.');
    expect(out.actionItems).toEqual([
      { text: 'Send the deck', owner: 'Jared', deadline: 'Friday' },
    ]);
  });

  it('normalizes empty owner and deadline to null rather than empty strings', () => {
    const out = parseSummaryResponse({
      summary: 's',
      action_items: [{ text: 'Do it', owner: '  ', deadline: '' }],
    });
    expect(out.actionItems[0]).toEqual({ text: 'Do it', owner: null, deadline: null });
  });

  it('drops action items with no text', () => {
    const out = parseSummaryResponse({
      summary: 's',
      action_items: [{ text: '  ' }, { owner: 'x' }, { text: 'keep' }],
    });
    expect(out.actionItems).toHaveLength(1);
    expect(out.actionItems[0].text).toBe('keep');
  });

  it('reads the title and trims it', () => {
    expect(parseSummaryResponse({ summary: 's', action_items: [], title: '  CRM sync review  ' }).title)
      .toBe('CRM sync review');
  });

  it('caps a runaway title — it lands in filenames', () => {
    const out = parseSummaryResponse({ summary: 's', action_items: [], title: 'x'.repeat(500) });
    expect(out.title).toHaveLength(120);
  });

  it('reads speaker mappings into a label → name record', () => {
    const out = parseSummaryResponse({
      summary: 's', action_items: [],
      speakers: [{ label: 'Speaker 1', name: 'Casey' }, { label: 'Speaker 2', name: 'Drew' }],
    });
    expect(out.speakerNames).toEqual({ 'Speaker 1': 'Casey', 'Speaker 2': 'Drew' });
  });

  it('drops speaker entries that are empty, self-referential, or malformed', () => {
    const out = parseSummaryResponse({
      summary: 's', action_items: [],
      speakers: [
        { label: 'Speaker 1', name: '  ' },
        { label: '', name: 'Ghost' },
        { label: 'Speaker 2', name: 'Speaker 2' },
        null,
        { label: 'Speaker 3', name: 'Real' },
      ],
    });
    expect(out.speakerNames).toEqual({ 'Speaker 3': 'Real' });
  });

  // This is the boundary between a model response and the database. Anything
  // malformed must degrade, never throw into the transcription pipeline.
  it('survives malformed or missing input', () => {
    const empty = { summary: '', actionItems: [], title: '', speakerNames: {} };
    expect(parseSummaryResponse({})).toEqual(empty);
    expect(parseSummaryResponse(null)).toEqual(empty);
    expect(parseSummaryResponse({ summary: 42, action_items: 'nope', title: 7, speakers: 'x' }))
      .toEqual(empty);
  });
});
