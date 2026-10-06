import fs from 'fs';
import path from 'path';
import type { AppSettings } from '@turingyde/transcript-core';
import { INDEX_FILE } from './agentHook';
import { README_FILE } from './agentDocs';

// The transcripts folder exists to be read by tools that are not this app, and
// those tools are already pointed somewhere: a notes vault, a project directory,
// whatever the user says "look in" when they ask an agent for something. Letting
// them choose the destination is what makes that work with no setup at all —
// cheaper than teaching every agent where Turingram happens to keep its files,
// and it works for agents this app has never heard of.

export function defaultTranscriptsDir(dataDir: string): string {
  return path.join(dataDir, 'transcripts');
}

export function resolveTranscriptsDir(dataDir: string, settings?: Pick<AppSettings, 'transcriptsDir'>): string {
  const chosen = settings?.transcriptsDir;
  return typeof chosen === 'string' && chosen.trim() !== ''
    ? path.resolve(chosen)
    : defaultTranscriptsDir(dataDir);
}

export interface MoveResult {
  moved: number;
  failed: string[];
}

// Files Turingram put here, and nothing else. The destination is a folder the
// user chose — a notes vault, a project directory — so it is full of their own
// work. Moving the folder's whole contents on a later "reset to default" would
// drag their notes into the app's data directory. We only ever take back what we
// wrote: the index, the README, and JSON files carrying a meeting id.
export function ownedFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(name => {
    if (name === INDEX_FILE || name === README_FILE) return true;
    if (!name.endsWith('.json')) return false;
    try {
      // The full transcript signature, not just an id — plenty of files that
      // are not ours carry a string "id" (package manifests, API dumps).
      const parsed = JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
      return typeof parsed?.id === 'string'
        && typeof parsed?.startedAt === 'number'
        && Array.isArray(parsed?.segments);
    } catch {
      return false;
    }
  });
}

// Moves the transcripts from one directory into another when the user changes
// the destination. Leaving them behind would strand every past meeting somewhere
// the user has just said they do not look.
export function moveTranscripts(from: string, to: string): MoveResult {
  const src = path.resolve(from);
  const dest = path.resolve(to);
  const result: MoveResult = { moved: 0, failed: [] };
  if (src === dest || !fs.existsSync(src)) return result;

  fs.mkdirSync(dest, { recursive: true });
  for (const name of ownedFiles(src)) {
    try {
      moveOne(path.join(src, name), path.join(dest, name));
      result.moved++;
    } catch {
      // Keep going: one unwritable file must not strand the other thirty-two.
      result.failed.push(name);
    }
  }
  return result;
}

// A vault on another drive, an encrypted home, a network mount — rename() fails
// across filesystems with EXDEV, and the whole point of this feature is letting
// people pick a directory somewhere else. Fall back to copy-then-delete.
function moveOne(src: string, dest: string): void {
  try {
    fs.renameSync(src, dest);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EXDEV') throw err;
    fs.copyFileSync(src, dest);
    fs.rmSync(src, { force: true });
  }
}

// A destination has to be a directory we can actually write to. Checked before
// the setting is saved, so a bad choice fails while the user is still looking at
// the picker rather than silently swallowing every transcript afterwards.
export function checkWritableDir(dir: string): string | null {
  const target = path.resolve(dir);
  try {
    fs.mkdirSync(target, { recursive: true });
  } catch {
    return 'That folder could not be created.';
  }
  if (!fs.statSync(target).isDirectory()) return 'That path is not a folder.';
  try {
    const probe = path.join(target, '.turingram-write-test');
    fs.writeFileSync(probe, '');
    fs.rmSync(probe, { force: true });
  } catch {
    return 'That folder is not writable.';
  }
  return null;
}
