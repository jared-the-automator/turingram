import { describe, it, expect } from 'vitest';
import { bugReportUrl, formatDiagnostics, noteProblem, recentProblems, scrubHome } from '../bugReport';

const diag = {
  version: '0.1.0', platform: 'darwin', release: '23.4.0', arch: 'arm64', electron: '41.0.0',
  detection: 'off, needs macOS 14.2 or later', problems: [] as string[],
};

describe('bug report', () => {
  it('replaces the home directory so a path does not publish the user name', () => {
    expect(scrubHome('cannot open /Users/ana/Library/x.wav', '/Users/ana')).toBe('cannot open ~/Library/x.wav');
  });

  it('keeps only the last five problems, one line each', () => {
    for (let i = 0; i < 7; i++) noteProblem(`error ${i}\nstack line`);
    const kept = recentProblems();
    expect(kept).toHaveLength(5);
    expect(kept[0]).toMatch(/error 2$/);
    expect(kept.join('')).not.toContain('stack line');
  });

  it('lays out the diagnostics and says when there are no errors', () => {
    const text = formatDiagnostics(diag);
    expect(text).toContain('OS: darwin 23.4.0 (arm64)');
    expect(text).toContain('Meeting detection: off, needs macOS 14.2 or later');
    expect(text).toMatch(/Recent errors:\n {2}none/);
  });

  it('fills the issue form fields and titles it with the error being reported', () => {
    const url = new URL(bugReportUrl('Turingram 0.1.0', 'ffmpeg exited with code 1\nmore detail'));
    expect(url.origin + url.pathname).toBe('https://github.com/jared-the-automator/turingram/issues/new');
    expect(url.searchParams.get('template')).toBe('bug_report.yml');
    expect(url.searchParams.get('diagnostics')).toBe('Turingram 0.1.0');
    expect(url.searchParams.get('title')).toBe('ffmpeg exited with code 1');
    expect(url.searchParams.get('what')).toContain('more detail');
  });

  it('stays short enough for GitHub to accept', () => {
    const long = formatDiagnostics({ ...diag, problems: Array(5).fill('x'.repeat(2000)) });
    expect(bugReportUrl(long, 'y'.repeat(5000)).length).toBeLessThan(8192 * 2);
    expect(long.length).toBeLessThanOrEqual(4000);
  });
});
