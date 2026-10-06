import os from 'os';

// "Report a problem" opens a GitHub issue form with the facts a bug report
// always needs already filled in. Nothing leaves the machine until the user
// reads the form and submits it, and they can edit or delete any of it first.

export const NEW_ISSUE_URL = 'https://github.com/jared-the-automator/turingram/issues/new';

// GitHub refuses very long URLs, and the diagnostics are the part that can grow.
const MAX_DIAGNOSTICS = 4000;
const MAX_PROBLEMS = 5;

const recent: string[] = [];

// Keeps the last few errors so a report can carry them. Called wherever the app
// already tells the user something went wrong.
export function noteProblem(message: string): void {
  recent.push(`${new Date().toISOString()}  ${message.trim().split('\n')[0]}`);
  if (recent.length > MAX_PROBLEMS) recent.shift();
}

export function recentProblems(): string[] {
  return [...recent];
}

// An error message can carry a file path, and a path can carry the user's name.
export function scrubHome(text: string, home = os.homedir()): string {
  return home ? text.split(home).join('~') : text;
}

export interface Diagnostics {
  version: string
  platform: string
  release: string
  arch: string
  electron: string
  detection: string
  problems: string[]
}

export function formatDiagnostics(d: Diagnostics): string {
  const lines = [
    `Turingram ${d.version}`,
    `OS: ${d.platform} ${d.release} (${d.arch})`,
    `Electron: ${d.electron}`,
    `Meeting detection: ${d.detection}`,
    'Recent errors:',
    ...(d.problems.length ? d.problems.map(p => `  ${p}`) : ['  none']),
  ];
  return scrubHome(lines.join('\n')).slice(0, MAX_DIAGNOSTICS);
}

// `problem` is the error the user was looking at when they chose to report it.
export function bugReportUrl(diagnostics: string, problem?: string): string {
  const params = new URLSearchParams({ template: 'bug_report.yml', diagnostics });
  if (problem) {
    const first = scrubHome(problem.trim().split('\n')[0]).slice(0, 120);
    params.set('title', first);
    params.set('what', scrubHome(problem.trim()).slice(0, 1000));
  }
  return `${NEW_ISSUE_URL}?${params.toString()}`;
}
