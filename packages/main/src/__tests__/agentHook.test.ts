import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import {
  writeAgentHook, rebuildIndex, findHookFiles, migrateTranscriptNames, INDEX_FILE,
} from '../agentHook';
import { meetingBaseName } from '../naming';
import type { Meeting, TranscriptSegment } from '@turingyde/transcript-core';

const tdir = (dir: string) => path.join(dir, 'transcripts');

const hookPath = (dir: string, m: Meeting) =>
  path.join(dir, 'transcripts', `${meetingBaseName(m)}.json`);

const hookFiles = (dir: string) =>
  readdirSync(path.join(dir, 'transcripts')).filter(f => f.endsWith('.json') && f !== INDEX_FILE);

const readIndex = (dir: string) =>
  JSON.parse(readFileSync(path.join(dir, 'transcripts', INDEX_FILE), 'utf8'));

const meeting: Meeting = {
  id: 'h1', title: 'Client call', startedAt: 1748390400000,
  endedAt: 1748392920000, durationSec: 2520, notes: 'Q3 roadmap',
  summary: null, actionItems: [],
};

const segments: TranscriptSegment[] = [
  { id: 's1', meetingId: 'h1', speakerLabel: 'Jared', startTime: 0, endTime: 4.2, text: 'Let us begin.' },
  { id: 's2', meetingId: 'h1', speakerLabel: 'Client', startTime: 4.5, endTime: 8.0, text: 'Sounds good.' },
];

describe('writeAgentHook', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'te-hook-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('creates transcripts dir and writes JSON file', () => {
    writeAgentHook(tdir(dir), meeting, segments);
    const filePath = hookPath(dir, meeting);
    expect(existsSync(filePath)).toBe(true);
  });

  // A folder of UUIDs is unusable by the agent it exists for: finding "the
  // client call from May" means opening every file. The name carries the answer.
  it('names the file for its date and title, not its id', () => {
    writeAgentHook(tdir(dir), meeting, segments);
    expect(hookFiles(dir)).toEqual([expect.stringMatching(/^\d{4}-\d{2}-\d{2}-client-call-\d{4}-\d{4}\.json$/)]);
  });

  it('JSON contains correct meeting fields', () => {
    writeAgentHook(tdir(dir), meeting, segments);
    const parsed = JSON.parse(readFileSync(hookPath(dir, meeting), 'utf8'));
    expect(parsed.id).toBe('h1');
    expect(parsed.title).toBe('Client call');
    expect(parsed.notes).toBe('Q3 roadmap');
    expect(parsed.startedAt).toBe(1748390400000);
  });

  it('JSON segments match input', () => {
    writeAgentHook(tdir(dir), meeting, segments);
    const parsed = JSON.parse(readFileSync(hookPath(dir, meeting), 'utf8'));
    expect(parsed.segments).toHaveLength(2);
    expect(parsed.segments[0].speaker).toBe('Jared');
    expect(parsed.segments[0].text).toBe('Let us begin.');
    expect(parsed.segments[1].speaker).toBe('Client');
  });

  // This file is written after the summary lands, so leaving the summary out
  // of it made an agent re-read the whole transcript to learn what the meeting
  // was about — work the app had already paid Gemini to do.
  it('carries the derived summary and action items', () => {
    const summarized: Meeting = {
      ...meeting,
      summary: 'Agreed the Q3 roadmap.',
      actionItems: [{ text: 'Send the deck', owner: 'Jared', deadline: 'Friday' }],
    };
    writeAgentHook(tdir(dir), summarized, segments);
    const parsed = JSON.parse(readFileSync(hookPath(dir, meeting), 'utf8'));
    expect(parsed.summary).toBe('Agreed the Q3 roadmap.');
    expect(parsed.actionItems).toEqual([{ text: 'Send the deck', owner: 'Jared', deadline: 'Friday' }]);
    expect(parsed.durationSec).toBe(2520);
  });

  // Segment times stay machine-readable. Formatting them as clock strings
  // forces every consumer to parse them back before it can do arithmetic.
  it('keeps segment times as numeric seconds', () => {
    writeAgentHook(tdir(dir), meeting, segments);
    const parsed = JSON.parse(readFileSync(hookPath(dir, meeting), 'utf8'));
    expect(parsed.segments[0].endTime).toBe(4.2);
    expect(typeof parsed.segments[1].startTime).toBe('number');
  });

  // Renaming a meeting renames its file. Leaving the old one behind would show
  // an agent two meetings where there is one, and the stale copy keeps the old
  // title forever — exactly the drift refreshAgentHook exists to prevent.
  it('removes the old file when a rename changes the name', () => {
    writeAgentHook(tdir(dir), meeting, segments);
    const renamed = { ...meeting, title: 'Roadmap review' };
    writeAgentHook(tdir(dir), renamed, segments);

    expect(hookFiles(dir)).toHaveLength(1);
    expect(existsSync(hookPath(dir, renamed))).toBe(true);
    expect(existsSync(hookPath(dir, meeting))).toBe(false);
  });

  // Same title, same start minute, different meeting. Rare — but the losing one
  // would be silently destroyed, and a lost transcript cannot be re-recorded.
  it('does not let one meeting overwrite another with the same name', () => {
    writeAgentHook(tdir(dir), meeting, segments);
    writeAgentHook(tdir(dir), { ...meeting, id: 'h2' }, segments);

    expect(hookFiles(dir)).toHaveLength(2);
    expect(findHookFiles(tdir(dir), 'h1')).toHaveLength(1);
    expect(findHookFiles(tdir(dir), 'h2')).toHaveLength(1);
  });

  it('rewrites the same meeting in place rather than suffixing it', () => {
    writeAgentHook(tdir(dir), meeting, segments);
    writeAgentHook(tdir(dir), { ...meeting, notes: 'edited' }, segments);

    expect(hookFiles(dir)).toHaveLength(1);
    expect(JSON.parse(readFileSync(hookPath(dir, meeting), 'utf8')).notes).toBe('edited');
  });
});

describe('the index', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'te-idx-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('lists each meeting with what you need to choose between them', () => {
    writeAgentHook(tdir(dir), meeting, segments);
    const { count, meetings } = readIndex(dir);

    expect(count).toBe(1);
    expect(meetings[0]).toMatchObject({
      id: 'h1', title: 'Client call', durationSec: 2520,
      speakers: ['Jared', 'Client'],
    });
    expect(meetings[0].file).toBe(path.basename(hookPath(dir, meeting)));
  });

  it('orders newest first', () => {
    writeAgentHook(tdir(dir), { ...meeting, id: 'old', startedAt: 1000000000000 }, segments);
    writeAgentHook(tdir(dir), { ...meeting, id: 'new', startedAt: 1900000000000 }, segments);
    expect(readIndex(dir).meetings.map((m: { id: string }) => m.id)).toEqual(['new', 'old']);
  });

  // Rebuilt from disk, not patched, so a file removed by hand cannot leave the
  // index advertising a transcript that is not there.
  it('drops a meeting whose file was deleted outside the app', () => {
    writeAgentHook(tdir(dir), meeting, segments);
    rmSync(hookPath(dir, meeting));
    expect(rebuildIndex(tdir(dir))).toEqual([]);
    expect(readIndex(dir).count).toBe(0);
  });

  it('skips unreadable files instead of failing the whole rebuild', () => {
    writeAgentHook(tdir(dir), meeting, segments);
    writeFileSync(path.join(dir, 'transcripts', 'broken.json'), '{ not json');
    expect(rebuildIndex(tdir(dir)).map(e => e.id)).toEqual(['h1']);
  });

  it('never indexes itself', () => {
    writeAgentHook(tdir(dir), meeting, segments);
    rebuildIndex(tdir(dir));
    expect(readIndex(dir).meetings.map((m: { file: string }) => m.file)).not.toContain(INDEX_FILE);
  });
});

describe('migrateTranscriptNames', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'te-mig-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  const writeLegacy = (m: Meeting) => {
    mkdirSync(path.join(dir, 'transcripts'), { recursive: true });
    writeFileSync(
      path.join(dir, 'transcripts', `${m.id}.json`),
      JSON.stringify({ ...m, segments: [{ speaker: 'Jared', startTime: 0, endTime: 1, text: 'hi' }] }),
    );
  };

  it('renames existing uuid-named files', () => {
    writeLegacy(meeting);
    expect(migrateTranscriptNames(tdir(dir))).toBe(1);
    expect(hookFiles(dir)).toEqual([path.basename(hookPath(dir, meeting))]);
  });

  it('is idempotent, so running it on every launch is free', () => {
    writeLegacy(meeting);
    migrateTranscriptNames(tdir(dir));
    expect(migrateTranscriptNames(tdir(dir))).toBe(0);
    expect(hookFiles(dir)).toHaveLength(1);
  });

  it('leaves a file it cannot parse where it is', () => {
    mkdirSync(path.join(dir, 'transcripts'), { recursive: true });
    writeFileSync(path.join(dir, 'transcripts', 'junk.json'), 'nope');
    expect(migrateTranscriptNames(tdir(dir))).toBe(0);
    expect(existsSync(path.join(dir, 'transcripts', 'junk.json'))).toBe(true);
  });
});
