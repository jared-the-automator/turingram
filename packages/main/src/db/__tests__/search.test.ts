import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { applySchema } from '../schema';
import { insertMeeting } from '../meetings';
import { insertSegments, renameSegmentSpeakers } from '../segments';
import { searchTranscripts } from '../search';

function makeDb(): Database.Database {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  applySchema(db);
  return db;
}

describe('searchTranscripts', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = makeDb();
    insertMeeting(db, { id: 'm1', title: 'Strategy', startedAt: 1000, endedAt: 2000, durationSec: 1, notes: '', summary: null, actionItems: [] });
    insertMeeting(db, { id: 'm2', title: 'Budget', startedAt: 3000, endedAt: 4000, durationSec: 1, notes: '', summary: null, actionItems: [] });
    insertSegments(db, [
      { id: 's1', meetingId: 'm1', speakerLabel: 'Speaker 0', startTime: 0, endTime: 2, text: 'quarterly roadmap review' },
      { id: 's2', meetingId: 'm2', speakerLabel: 'Speaker 0', startTime: 0, endTime: 2, text: 'quarterly budget planning' },
      { id: 's3', meetingId: 'm1', speakerLabel: 'Speaker 1', startTime: 3, endTime: 5, text: 'unrelated content' },
    ]);
  });
  afterEach(() => { db.close(); });

  it('returns all segments matching query', () => {
    expect(searchTranscripts(db, 'quarterly')).toHaveLength(2);
  });

  it('returns segment with meeting context', () => {
    const results = searchTranscripts(db, 'roadmap');
    expect(results).toHaveLength(1);
    expect(results[0].meetingTitle).toBe('Strategy');
    expect(results[0].text).toBe('quarterly roadmap review');
  });

  it('returns empty array when no match', () => {
    expect(searchTranscripts(db, 'nonexistent')).toHaveLength(0);
  });

  it('returns empty array for blank query', () => {
    expect(searchTranscripts(db, '')).toHaveLength(0);
    expect(searchTranscripts(db, '   ')).toHaveLength(0);
  });

  it('does not throw on FTS5 syntax characters in the query', () => {
    for (const q of ['mark"s', 'roadmap*', '(review', 'AND', 'a OR b', 'x NOT y', '"unbalanced']) {
      expect(() => searchTranscripts(db, q)).not.toThrow();
    }
  });

  it('still matches terms when the query carries stray quotes', () => {
    expect(searchTranscripts(db, 'roadmap').length).toBeGreaterThan(0);
    expect(searchTranscripts(db, '"roadmap"').length).toBeGreaterThan(0);
  });

  // Auto speaker naming renames via UPDATE, so without an FTS update trigger
  // the index kept the old label forever: the client's real name found nothing
  // while the discarded "Speaker N" ghost-matched.
  it('finds a renamed speaker by the new name, not the old one', () => {
    renameSegmentSpeakers(db, 'm1', { 'Speaker 1': 'Avery' });
    expect(searchTranscripts(db, 'Avery')).toHaveLength(1);
    expect(searchTranscripts(db, 'Avery')[0].speakerName).toBe('Avery');
    // s1 (m1) and s2 (m2) still carry "Speaker 0"; s3 must no longer ghost-hit.
    expect(searchTranscripts(db, 'Speaker')).toHaveLength(2);
  });

  it('reflects edited text in search results', () => {
    db.prepare("UPDATE segments SET text = 'entirely new phrasing' WHERE id = 's3'").run();
    expect(searchTranscripts(db, 'phrasing')).toHaveLength(1);
    expect(searchTranscripts(db, 'unrelated')).toHaveLength(0);
  });

  // Databases created before the update trigger existed hold stale FTS rows;
  // applySchema must heal them on next open via the one-time rebuild.
  it('rebuilds a stale index inherited from the pre-trigger schema', () => {
    db.exec('DROP TRIGGER segments_fts_update;');
    db.prepare("UPDATE segments SET speaker_name = 'Kim' WHERE id = 's3'").run();
    db.pragma('user_version = 0'); // simulate an old database
    applySchema(db);
    expect(searchTranscripts(db, 'Kim')).toHaveLength(1);
  });
});
