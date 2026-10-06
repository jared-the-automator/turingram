import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { applySchema } from '../schema';
import { insertMeeting } from '../meetings';
import { insertSegments, getSegments } from '../segments';
import type { Meeting, TranscriptSegment } from '@turingyde/transcript-core';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applySchema(db);
  return db;
}

const meeting: Meeting = {
  id: 'm1', title: 'Test', startedAt: 1000, endedAt: 2000,
  durationSec: 1, notes: '', summary: null, actionItems: [],
};

describe('segments', () => {
  let db: Database.Database;
  beforeEach(() => { db = makeDb(); insertMeeting(db, meeting); });
  afterEach(() => { db.close(); });

  it('inserts and retrieves segments ordered by start_time', () => {
    const segs: TranscriptSegment[] = [
      { id: 's1', meetingId: 'm1', speakerLabel: 'Speaker 0', startTime: 0, endTime: 4.2, text: 'Hello world' },
      { id: 's2', meetingId: 'm1', speakerLabel: 'Speaker 1', startTime: 4.5, endTime: 8.0, text: 'How are you' },
    ];
    insertSegments(db, segs);
    const result = getSegments(db, 'm1');
    expect(result).toHaveLength(2);
    expect(result[0].text).toBe('Hello world');
    expect(result[1].startTime).toBe(4.5);
    expect(result[1].speakerLabel).toBe('Speaker 1');
  });

  it('FTS5 trigger indexes segments on insert', () => {
    insertSegments(db, [
      { id: 's3', meetingId: 'm1', speakerLabel: 'Speaker 0', startTime: 0, endTime: 2, text: 'quarterly budget review' },
    ]);
    const rows = db.prepare("SELECT * FROM segments_fts WHERE segments_fts MATCH 'quarterly'").all();
    expect(rows).toHaveLength(1);
  });

  it('returns empty array for unknown meetingId', () => {
    expect(getSegments(db, 'nope')).toEqual([]);
  });
});
