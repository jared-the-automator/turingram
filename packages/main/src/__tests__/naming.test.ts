import { describe, it, expect } from 'vitest';
import { meetingBaseName, slugify } from '../naming';

// A fixed wall-clock start, built locally so the expected clock times in these
// assertions hold in any timezone.
const at = (h: number, m: number) => new Date(2026, 6, 30, h, m, 0, 0).getTime();

describe('slugify', () => {
  it('lowercases and hyphenates', () => {
    expect(slugify('Acme Wealth Partners')).toBe('acme-wealth-partners');
  });

  it('collapses runs of punctuation rather than emitting empty segments', () => {
    expect(slugify('Q3 -- roadmap /// review')).toBe('q3-roadmap-review');
  });

  it('trims leading and trailing separators', () => {
    expect(slugify('  ...Kickoff!  ')).toBe('kickoff');
  });

  // An untitled meeting must still produce a usable name, not a bare date pair.
  it('falls back for a title with nothing usable in it', () => {
    expect(slugify('!!!')).toBe('meeting');
    expect(slugify('')).toBe('meeting');
  });

  // The slug lands in a filename, so it cannot carry a separator.
  it('never produces a path separator', () => {
    expect(slugify('reports/2026/final')).toBe('reports-2026-final');
    expect(slugify('../../etc/passwd')).toBe('etc-passwd');
  });
});

describe('meetingBaseName', () => {
  it('reads as date, title, then start and end times', () => {
    expect(meetingBaseName({ title: 'CRM sync review', startedAt: at(11, 57), durationSec: 7320 }))
      .toBe('2026-07-30-crm-sync-review-1157-1359');
  });

  it('zero-pads so names sort correctly', () => {
    expect(meetingBaseName({ title: 'Standup', startedAt: at(9, 5), durationSec: 300 }))
      .toBe('2026-07-30-standup-0905-0910');
  });

  // Prefers speech duration over endedAt, which includes any silent tail the
  // recorder sat through before it stopped.
  it('uses durationSec, not endedAt, when both are present', () => {
    expect(meetingBaseName({
      title: 'Call', startedAt: at(10, 0), durationSec: 600, endedAt: at(11, 30),
    })).toBe('2026-07-30-call-1000-1010');
  });

  // 32 of the 33 transcripts on disk in July 2026 predate durationSec. Without a
  // fallback every one of them migrated to a filename ending in "NaNNaN".
  it('falls back to endedAt on a transcript written before durationSec existed', () => {
    expect(meetingBaseName({ title: 'Old call', startedAt: at(20, 9), endedAt: at(20, 41) }))
      .toBe('2026-07-30-old-call-2009-2041');
  });

  it('falls back again when there is no end at all', () => {
    expect(meetingBaseName({ title: 'Fragment', startedAt: at(20, 9) }))
      .toBe('2026-07-30-fragment-2009-2009');
  });

  it('ignores a nonsensical duration rather than naming a file NaN', () => {
    for (const durationSec of [NaN, -60, Infinity]) {
      expect(meetingBaseName({ title: 'Call', startedAt: at(10, 0), durationSec, endedAt: at(10, 30) }))
        .toBe('2026-07-30-call-1000-1030');
    }
  });

  it('never contains NaN, whatever it is handed', () => {
    expect(meetingBaseName({ title: '', startedAt: at(0, 0), durationSec: NaN, endedAt: NaN }))
      .not.toContain('NaN');
  });
});
