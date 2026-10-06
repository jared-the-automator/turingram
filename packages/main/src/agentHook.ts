import fs from 'fs';
import path from 'path';
import type { Meeting, TranscriptSegment, AgentHook } from '@turingyde/transcript-core';
import { meetingBaseName } from './naming';

// The transcripts directory is the product's machine-readable surface: an
// external agent reads it, the app never does. Everything here exists to make a
// folder someone else's tooling can navigate without being told how.
//
// Every function here takes the resolved directory rather than the app's data
// dir, because the user chooses where this folder lives — see transcriptsPath.ts.

export function buildAgentHook(meeting: Meeting, segments: TranscriptSegment[]): AgentHook {
  return {
    id: meeting.id,
    title: meeting.title,
    startedAt: meeting.startedAt,
    endedAt: meeting.endedAt,
    durationSec: meeting.durationSec,
    notes: meeting.notes,
    summary: meeting.summary,
    actionItems: meeting.actionItems,
    segments: segments.map(s => ({
      speaker: s.speakerLabel,
      startTime: s.startTime,
      endTime: s.endTime,
      text: s.text,
    })),
  };
}

export interface IndexEntry {
  id: string;
  file: string;
  title: string;
  date: string;
  startedAt: number;
  durationSec: number;
  speakers: string[];
}

// Reads every hook file back and rebuilds index.json from what is actually on
// disk. Rebuilt rather than incrementally patched: the files are the truth, so a
// hand-deleted file or a half-finished write can never leave the index claiming
// a transcript that is not there. 33 small files is nothing next to being wrong.
export function rebuildIndex(dir: string): IndexEntry[] {
  if (!fs.existsSync(dir)) return [];

  const entries: IndexEntry[] = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.json') || file === INDEX_FILE) continue;
    const hook = readHook(path.join(dir, file));
    if (!hook) continue;
    entries.push({
      id: hook.id,
      file,
      title: hook.title,
      date: new Date(hook.startedAt).toISOString(),
      startedAt: hook.startedAt,
      durationSec: hook.durationSec,
      speakers: [...new Set((hook.segments ?? []).map(s => s.speaker))],
    });
  }
  entries.sort((a, b) => b.startedAt - a.startedAt);

  writeAtomic(path.join(dir, INDEX_FILE), JSON.stringify({
    // No generatedAt: a timestamp would rewrite this file on every rebuild even
    // when nothing changed, which shows up as noise in anything watching it.
    count: entries.length,
    meetings: entries,
  }, null, 2));
  return entries;
}

export const INDEX_FILE = 'index.json';

function readHook(filePath: string): AgentHook | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return typeof parsed?.id === 'string' ? parsed as AgentHook : null;
  } catch {
    return null;
  }
}

// Every file in the directory currently holding this meeting, whatever it is
// called. Renaming a meeting changes its filename, so the id inside the file —
// not the name on it — is the only reliable way to find a meeting's transcript.
export function findHookFiles(dir: string, meetingId: string): string[] {
  if (!fs.existsSync(dir)) return [];
  const hits: string[] = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.json') || file === INDEX_FILE) continue;
    const full = path.join(dir, file);
    if (readHook(full)?.id === meetingId) hits.push(full);
  }
  return hits;
}

// Two meetings can share a title and a start minute. Rare, but clobbering one
// with the other silently destroys a transcript, so suffix instead.
function uniqueFileName(dir: string, base: string, meetingId: string): string {
  for (let n = 1; ; n++) {
    const name = n === 1 ? `${base}.json` : `${base}-${n}.json`;
    const full = path.join(dir, name);
    if (!fs.existsSync(full) || readHook(full)?.id === meetingId) return name;
  }
}

export function writeAgentHook(dir: string, meeting: Meeting, segments: TranscriptSegment[]): void {
  fs.mkdirSync(dir, { recursive: true });

  const hook = buildAgentHook(meeting, segments);
  const name = uniqueFileName(dir, meetingBaseName(meeting), meeting.id);
  const dest = path.join(dir, name);

  writeAtomic(dest, JSON.stringify(hook, null, 2));

  // A rename changes the title, so it changes the filename. Drop whatever this
  // meeting used to be called, or the folder accumulates stale duplicates that
  // an agent would read as separate meetings.
  for (const stale of findHookFiles(dir, meeting.id)) {
    if (path.resolve(stale) !== path.resolve(dest)) {
      try { fs.rmSync(stale, { force: true }); } catch { /* best effort */ }
    }
  }

  rebuildIndex(dir);
}

// This file's whole purpose is to be read by an external agent that can race a
// direct write and see truncated JSON.
function writeAtomic(dest: string, content: string): void {
  const tmp = `${dest}.tmp`;
  fs.writeFileSync(tmp, content);
  fs.renameSync(tmp, dest);
}

// One-time move from the old <uuid>.json names. Works purely from file contents,
// so it needs no database and is safe to run on every launch.
export function migrateTranscriptNames(dir: string): number {
  if (!fs.existsSync(dir)) return 0;

  let moved = 0;
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.json') || file === INDEX_FILE) continue;
    const full = path.join(dir, file);
    const hook = readHook(full);
    if (!hook) continue;
    // Already named for its content — leave it be.
    if (file !== `${hook.id}.json`) continue;

    const name = uniqueFileName(dir, meetingBaseName(hook), hook.id);
    try {
      fs.renameSync(full, path.join(dir, name));
      moved++;
    } catch { /* best effort — a failed rename leaves a readable file behind */ }
  }
  return moved;
}
