import type Database from 'better-sqlite3';
import type { TranscriptSegment } from '@turingyde/transcript-core';

interface RawSegment {
  id: string; meeting_id: string; speaker_name: string;
  start_time: number; end_time: number; text: string;
}

function rowToSegment(row: RawSegment): TranscriptSegment {
  return {
    id: row.id, meetingId: row.meeting_id, speakerLabel: row.speaker_name,
    startTime: row.start_time, endTime: row.end_time, text: row.text,
  };
}

export function insertSegments(db: Database.Database, segments: TranscriptSegment[]): void {
  const insert = db.prepare(`
    INSERT INTO segments (id, meeting_id, speaker_name, start_time, end_time, text)
    VALUES (@id, @meetingId, @speakerLabel, @startTime, @endTime, @text)
  `);
  db.transaction((segs: TranscriptSegment[]) => {
    for (const s of segs) insert.run(s);
  })(segments);
}

export function deleteSegmentsByMeeting(db: Database.Database, meetingId: string): void {
  db.prepare('DELETE FROM segments WHERE meeting_id = ?').run(meetingId);
}

export function renameSegmentSpeakers(
  db: Database.Database,
  meetingId: string,
  map: Record<string, string>
): void {
  const update = db.prepare(
    'UPDATE segments SET speaker_name = ? WHERE meeting_id = ? AND speaker_name = ?'
  );
  db.transaction(() => {
    for (const [oldLabel, newLabel] of Object.entries(map)) {
      if (newLabel.trim()) update.run(newLabel.trim(), meetingId, oldLabel);
    }
  })();
}

export function getSegments(db: Database.Database, meetingId: string): TranscriptSegment[] {
  const rows = db.prepare(
    'SELECT * FROM segments WHERE meeting_id = ? ORDER BY start_time ASC'
  ).all(meetingId) as RawSegment[];
  return rows.map(rowToSegment);
}
