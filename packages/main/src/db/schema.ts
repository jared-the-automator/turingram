import type Database from 'better-sqlite3';

export function applySchema(db: Database.Database): void {
  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS meetings (
      id           TEXT PRIMARY KEY,
      title        TEXT NOT NULL DEFAULT 'Untitled Meeting',
      started_at   INTEGER NOT NULL,
      ended_at     INTEGER NOT NULL DEFAULT 0,
      duration_sec INTEGER NOT NULL DEFAULT 0,
      notes        TEXT NOT NULL DEFAULT '',
      summary      TEXT,
      action_items TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS segments (
      id           TEXT PRIMARY KEY,
      meeting_id   TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
      speaker_name TEXT NOT NULL DEFAULT 'Speaker 0',
      start_time   REAL NOT NULL,
      end_time     REAL NOT NULL,
      text         TEXT NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS segments_fts USING fts5(
      text,
      speaker_name,
      content=segments,
      content_rowid=rowid
    );

    CREATE TRIGGER IF NOT EXISTS segments_fts_insert
    AFTER INSERT ON segments BEGIN
      INSERT INTO segments_fts(rowid, text, speaker_name)
      VALUES (new.rowid, new.text, new.speaker_name);
    END;

    CREATE TRIGGER IF NOT EXISTS segments_fts_delete
    AFTER DELETE ON segments BEGIN
      INSERT INTO segments_fts(segments_fts, rowid, text, speaker_name)
      VALUES ('delete', old.rowid, old.text, old.speaker_name);
    END;

    -- Without this, renameSegmentSpeakers left the FTS copy holding the OLD
    -- label forever: searching a client's real name found nothing, while the
    -- discarded "Speaker N" kept ghost-matching. Auto speaker naming renames on
    -- every summarized meeting, so this was the common case, not an edge.
    CREATE TRIGGER IF NOT EXISTS segments_fts_update
    AFTER UPDATE ON segments BEGIN
      INSERT INTO segments_fts(segments_fts, rowid, text, speaker_name)
      VALUES ('delete', old.rowid, old.text, old.speaker_name);
      INSERT INTO segments_fts(rowid, text, speaker_name)
      VALUES (new.rowid, new.text, new.speaker_name);
    END;

    CREATE INDEX IF NOT EXISTS idx_segments_meeting ON segments(meeting_id);
  `);

  // Existing databases indexed every rename with the pre-rename labels (the
  // update trigger above did not exist when those rows changed). 'rebuild'
  // re-derives the whole index from the segments table — cheap at this scale,
  // and idempotent. Run once per schema bump.
  const ftsFixed = db.pragma('user_version', { simple: true }) as number;
  if (ftsFixed < 1) {
    db.exec(`INSERT INTO segments_fts(segments_fts) VALUES('rebuild');`);
    db.pragma('user_version = 1');
  }
}
