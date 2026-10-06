import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { applySchema } from '../schema';
import { insertMeeting, getMeeting, listMeetings, updateMeeting, updateMeetingNotes } from '../meetings';
import type { Meeting } from '@turingyde/transcript-core';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applySchema(db);
  return db;
}

const base: Meeting = {
  id: 't1', title: 'Client call', startedAt: 1748390400000,
  endedAt: 1748392920000, durationSec: 2520, notes: 'Q3 roadmap',
  summary: null, actionItems: [],
};

describe('meetings CRUD', () => {
  let db: Database.Database;
  beforeEach(() => { db = makeDb(); });
  afterEach(() => { db.close(); });

  it('inserts and retrieves a meeting', () => {
    insertMeeting(db, base);
    const result = getMeeting(db, 't1');
    expect(result).not.toBeNull();
    expect(result!.title).toBe('Client call');
    expect(result!.notes).toBe('Q3 roadmap');
    expect(result!.actionItems).toEqual([]);
  });

  it('returns null for unknown id', () => {
    expect(getMeeting(db, 'nope')).toBeNull();
  });

  it('lists meetings newest first', () => {
    insertMeeting(db, { ...base, id: 'a', startedAt: 1000 });
    insertMeeting(db, { ...base, id: 'b', startedAt: 3000 });
    const list = listMeetings(db);
    expect(list[0].id).toBe('b');
    expect(list[1].id).toBe('a');
  });

  it('updateMeetingNotes persists notes', () => {
    insertMeeting(db, base);
    updateMeetingNotes(db, 't1', 'updated');
    expect(getMeeting(db, 't1')!.notes).toBe('updated');
  });

  it('updateMeeting patches endedAt and durationSec', () => {
    insertMeeting(db, { ...base, endedAt: 0, durationSec: 0 });
    updateMeeting(db, 't1', { endedAt: 9000, durationSec: 9 });
    const m = getMeeting(db, 't1')!;
    expect(m.endedAt).toBe(9000);
    expect(m.durationSec).toBe(9);
  });
});
