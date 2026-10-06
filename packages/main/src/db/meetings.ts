import type Database from 'better-sqlite3';
import type { Meeting, ActionItem } from '@turingyde/transcript-core';

interface RawMeeting {
  id: string; title: string; started_at: number; ended_at: number;
  duration_sec: number; notes: string; summary: string | null; action_items: string;
}

function rowToMeeting(row: RawMeeting): Meeting {
  // One corrupt action_items cell must cost that meeting its action items, not
  // take down listMeetings — and with it the entire meeting list — forever.
  let actionItems: ActionItem[] = [];
  try {
    const parsed = JSON.parse(row.action_items);
    if (Array.isArray(parsed)) actionItems = parsed;
  } catch { /* keep [] */ }
  return {
    id: row.id, title: row.title, startedAt: row.started_at, endedAt: row.ended_at,
    durationSec: row.duration_sec, notes: row.notes, summary: row.summary,
    actionItems,
  };
}

export function insertMeeting(db: Database.Database, m: Meeting): void {
  db.prepare(`
    INSERT INTO meetings (id, title, started_at, ended_at, duration_sec, notes, summary, action_items)
    VALUES (@id, @title, @startedAt, @endedAt, @durationSec, @notes, @summary, @actionItems)
  `).run({ ...m, summary: m.summary ?? null, actionItems: JSON.stringify(m.actionItems) });
}

export function getMeeting(db: Database.Database, id: string): Meeting | null {
  const row = db.prepare('SELECT * FROM meetings WHERE id = ?').get(id) as RawMeeting | undefined;
  return row ? rowToMeeting(row) : null;
}

export function listMeetings(db: Database.Database): Meeting[] {
  const rows = db.prepare('SELECT * FROM meetings ORDER BY started_at DESC').all() as RawMeeting[];
  return rows.map(rowToMeeting);
}

export function updateMeeting(
  db: Database.Database,
  id: string,
  fields: Partial<Pick<Meeting, 'endedAt' | 'durationSec' | 'summary' | 'actionItems'>>
): void {
  const sets: string[] = [];
  const values: Record<string, unknown> = { id };
  if (fields.endedAt !== undefined) { sets.push('ended_at = @endedAt'); values.endedAt = fields.endedAt; }
  if (fields.durationSec !== undefined) { sets.push('duration_sec = @durationSec'); values.durationSec = fields.durationSec; }
  if (fields.summary !== undefined) { sets.push('summary = @summary'); values.summary = fields.summary; }
  // action_items is stored as a JSON string; rowToMeeting parses it back.
  if (fields.actionItems !== undefined) { sets.push('action_items = @actionItems'); values.actionItems = JSON.stringify(fields.actionItems); }
  if (sets.length === 0) return;
  db.prepare(`UPDATE meetings SET ${sets.join(', ')} WHERE id = @id`).run(values);
}

export function updateMeetingNotes(db: Database.Database, id: string, notes: string): void {
  db.prepare('UPDATE meetings SET notes = ? WHERE id = ?').run(notes, id);
}

export function renameMeeting(db: Database.Database, id: string, title: string): void {
  db.prepare('UPDATE meetings SET title = ? WHERE id = ?').run(title, id);
}

export function deleteMeeting(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM meetings WHERE id = ?').run(id);
}
