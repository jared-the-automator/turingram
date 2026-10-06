import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { exportMeeting } from '../export';
import { buildAgentHook } from '../agentHook';
import type { Meeting, TranscriptSegment } from '@turingyde/transcript-core';

const meeting: Meeting = {
  id: 'e1', title: 'Strategy call', startedAt: 1748390400000,
  endedAt: 1748392920000, durationSec: 2520, notes: 'Key priorities here',
  summary: null, actionItems: [],
};

const segments: TranscriptSegment[] = [
  { id: 's1', meetingId: 'e1', speakerLabel: 'Jared', startTime: 0, endTime: 4, text: 'Let us begin.' },
  { id: 's2', meetingId: 'e1', speakerLabel: 'Client', startTime: 60, endTime: 65, text: 'Sounds good.' },
];

describe('exportMeeting', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'te-export-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('returns path to a file that exists', () => {
    const p = exportMeeting(dir, meeting, segments);
    expect(existsSync(p)).toBe(true);
  });

  it('names the file date-slug-start-end', () => {
    const p = exportMeeting(dir, meeting, segments);
    expect(path.basename(p)).toMatch(/^\d{4}-\d{2}-\d{2}-strategy-call-\d{4}-\d{4}\.md$/);
    // End time = start + durationSec (42 min), in local clock time.
    const start = new Date(meeting.startedAt);
    const end = new Date(meeting.startedAt + meeting.durationSec * 1000);
    const hhmm = (d: Date) =>
      `${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
    expect(path.basename(p)).toContain(`strategy-call-${hhmm(start)}-${hhmm(end)}.md`);
  });

  it('rolls timestamps past the hour into H:MM:SS', () => {
    const late: TranscriptSegment[] = [
      { id: 's3', meetingId: 'e1', speakerLabel: 'Jared', startTime: 3725, endTime: 3730, text: 'Wrapping up.' },
    ];
    const p = exportMeeting(dir, meeting, late);
    expect(readFileSync(p, 'utf8')).toContain('1:02:05');
  });

  it('includes meeting title as h1', () => {
    const p = exportMeeting(dir, meeting, segments);
    expect(readFileSync(p, 'utf8')).toContain('# Strategy call');
  });

  it('includes user notes', () => {
    const p = exportMeeting(dir, meeting, segments);
    expect(readFileSync(p, 'utf8')).toContain('Key priorities here');
  });

  // Agent-friendliness is a product differentiator, so there is one JSON shape,
  // not a weaker export-only one: exporting JSON gives you byte-for-byte what
  // transcripts/<id>.json holds.
  it('exports JSON as the same object an agent reads', () => {
    const summarized: Meeting = { ...meeting, summary: 'Covered pricing.' };
    const p = exportMeeting(dir, summarized, segments, 'json');
    const parsed = JSON.parse(readFileSync(p, 'utf8'));
    expect(parsed).toEqual(buildAgentHook(summarized, segments));
    expect(parsed.summary).toBe('Covered pricing.');
    expect(parsed.segments[1].startTime).toBe(60);
  });

  it('includes speaker labels and text', () => {
    const p = exportMeeting(dir, meeting, segments);
    const content = readFileSync(p, 'utf8');
    expect(content).toContain('Jared');
    expect(content).toContain('Let us begin.');
    expect(content).toContain('01:00');
  });
});
