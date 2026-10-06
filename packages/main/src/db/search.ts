import type Database from 'better-sqlite3';

export interface SearchResult {
  segmentId: string
  meetingId: string
  meetingTitle: string
  meetingStartedAt: number
  speakerName: string
  startTime: number
  text: string
  snippet: string
}

// FTS5 treats ", *, AND/OR/NOT, parens etc. as query syntax — raw user input
// like `mark"s` throws an fts5 syntax error. Quote each whitespace-separated
// term as a phrase (doubling embedded quotes) so any input is a valid query.
export function toFtsQuery(query: string): string {
  return query
    .split(/\s+/)
    .filter(Boolean)
    .map(term => `"${term.replace(/"/g, '""')}"`)
    .join(' ');
}

export function searchTranscripts(db: Database.Database, query: string): SearchResult[] {
  const fts = toFtsQuery(query);
  if (!fts) return [];
  return db.prepare(`
    SELECT
      s.id         AS segmentId,
      s.meeting_id AS meetingId,
      m.title      AS meetingTitle,
      m.started_at AS meetingStartedAt,
      s.speaker_name AS speakerName,
      s.start_time AS startTime,
      s.text       AS text,
      snippet(segments_fts, 0, '<mark>', '</mark>', '...', 10) AS snippet
    FROM segments_fts
    JOIN segments s ON s.rowid = segments_fts.rowid
    JOIN meetings m ON m.id = s.meeting_id
    WHERE segments_fts MATCH ?
    ORDER BY rank
  `).all(fts) as SearchResult[];
}
