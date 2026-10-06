// One meeting, one name. The export in Downloads and the agent-hook JSON in the
// transcripts folder describe the same conversation, so they share a base name
// and differ only by extension — a person who exported a call can find its JSON
// without a lookup table, and an agent can match the two without opening either.
//
// Shape: 2026-07-30-crm-sync-review-1157-1259
// The slug sits between the two runs of digits so the name stays readable
// instead of collapsing into one long number.

export interface Named {
  title: string;
  startedAt: number;
  durationSec?: number;
  endedAt?: number;
}

export function slugify(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'meeting';
}

// durationSec is trimmed to actual speech, so start+duration beats endedAt
// (which includes any silent tail the recorder sat through). Transcripts written
// before durationSec existed have neither, and arithmetic on undefined yields a
// filename ending in NaNNaN — so fall back, then give up gracefully.
function endMs(meeting: Named): number {
  const { startedAt, durationSec, endedAt } = meeting;
  if (typeof durationSec === 'number' && isFinite(durationSec) && durationSec > 0) {
    return startedAt + durationSec * 1000;
  }
  if (typeof endedAt === 'number' && isFinite(endedAt) && endedAt > startedAt) return endedAt;
  return startedAt;
}

export function meetingBaseName(meeting: Named): string {
  const start = new Date(meeting.startedAt);
  const end = new Date(endMs(meeting));
  const date = `${start.getFullYear()}-${pad(start.getMonth() + 1, 2)}-${pad(start.getDate(), 2)}`;
  const hhmm = (d: Date) => `${pad(d.getHours(), 2)}${pad(d.getMinutes(), 2)}`;
  return `${date}-${slugify(meeting.title)}-${hhmm(start)}-${hhmm(end)}`;
}

export function pad(n: number, width: number): string {
  return String(n).padStart(width, '0');
}
