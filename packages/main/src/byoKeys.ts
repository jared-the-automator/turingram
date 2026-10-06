import fs from 'fs';
import path from 'path';
import { parseEnv } from './env';

// Bring-your-own-key provisioning for pre-release testers.
//
// env.ts is deliberate: the app consumes credentials it never owns, so a
// commercial install can hand it a short-lived token from a metering proxy and
// nothing in the UI has to change. That stance is right and it stays. What it
// assumed was an operator — somebody who knows the app has a data directory and
// can find it. A tester on macOS cannot: ~/Library is hidden in Finder by
// default, so "drop a .env beside the app's data" is an instruction they cannot
// carry out, and every one of them stalls before recording anything.
//
// So this writes the same .env env.ts already reads, rather than inventing a
// second credential path. The file on disk stays the source of truth; the UI is
// just a way to author it.

export const KEY_NAMES = ['DEEPGRAM_API_KEY', 'GEMINI_API_KEY'] as const;
export type KeyName = (typeof KEY_NAMES)[number];

export interface KeyStatus {
  /** Whether each key currently resolves, by name. Never the values. */
  present: Record<KeyName, boolean>;
  /** The .env this writes to, shown so a tester can edit it by hand instead. */
  envPath: string;
}

export function envPath(dataDir: string): string {
  return path.join(dataDir, '.env');
}

export function readKeyStatus(dataDir: string, env: NodeJS.ProcessEnv = process.env): KeyStatus {
  const present = {} as Record<KeyName, boolean>;
  for (const name of KEY_NAMES) present[name] = !!(env[name] || '').trim();
  return {
    present,
    envPath: envPath(dataDir),
  };
}

// A key with a newline in it would write a second assignment into the file and
// could set any variable the process later reads. Everything else is left to
// the provider: rejecting a key on shape guesses at a format Deepgram is free
// to change, and the failure mode is a tester who cannot paste a valid key.
export function isWritableValue(value: string): boolean {
  return value.trim().length > 0 && !/[\r\n]/.test(value);
}

const assignment = (name: string) =>
  new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=`);

/**
 * Rewrites `updates` into the .env text, replacing an existing assignment in
 * place and appending anything new. Every other line survives byte for byte —
 * a tester who hand-wrote a comment or a variable this app has never heard of
 * keeps it, and the file stays theirs to edit.
 */
export function applyToEnvText(text: string, updates: Partial<Record<KeyName, string>>): string {
  const lines = text.split(/\r?\n/);
  const appended: string[] = [];

  for (const [name, value] of Object.entries(updates) as [KeyName, string][]) {
    const re = assignment(name);
    const at = lines.findIndex(line => re.test(line));
    // Quoted, because a key is opaque and an unquoted value would lose
    // everything after a ' #' to parseEnv's trailing-comment rule.
    const written = `${name}="${value.trim()}"`;
    if (at === -1) appended.push(written);
    else lines[at] = written;
  }

  // An empty file splits to [''], and a file ending in a newline splits to a
  // trailing '', so appending without this puts a blank line above the key or
  // leaves one behind. Only the tail is touched; blank lines the tester put
  // between their own entries stay where they are.
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();

  return `${[...lines, ...appended].join('\n')}\n`;
}

/**
 * Writes the keys and applies them to this process, so a tester who just pasted
 * a key can record immediately instead of restarting the app to find out
 * whether it took.
 *
 * Returns the refreshed status. Throws on an unusable value rather than writing
 * a file the loader will silently skip.
 */
export function saveKeys(
  dataDir: string,
  updates: Partial<Record<KeyName, string>>,
  env: NodeJS.ProcessEnv = process.env,
): KeyStatus {
  const clean: Partial<Record<KeyName, string>> = {};
  for (const [name, value] of Object.entries(updates) as [KeyName, string][]) {
    if (!KEY_NAMES.includes(name)) throw new Error(`Unknown key: ${name}`);
    if (!isWritableValue(value)) throw new Error(`${name} is empty or contains a line break.`);
    clean[name] = value.trim();
  }

  const file = envPath(dataDir);
  let existing = '';
  try {
    existing = fs.readFileSync(file, 'utf8');
  } catch {
    existing = '';
  }

  fs.mkdirSync(dataDir, { recursive: true });
  // 0600 from the moment it exists. Writing then chmod-ing leaves a window
  // where another account on the machine can read the key.
  fs.writeFileSync(file, applyToEnvText(existing, clean), { mode: 0o600 });
  try {
    fs.chmodSync(file, 0o600); // pre-existing file: the mode above does not apply
  } catch { /* best effort — a filesystem without modes is not a reason to fail */ }

  for (const [name, value] of Object.entries(clean) as [KeyName, string][]) {
    env[name] = value;
  }

  return readKeyStatus(dataDir, env);
}

/** Re-reads the .env from disk, for a tester who edited it by hand. */
export function reloadKeys(dataDir: string, env: NodeJS.ProcessEnv = process.env): KeyStatus {
  try {
    const parsed = parseEnv(fs.readFileSync(envPath(dataDir), 'utf8'));
    for (const name of KEY_NAMES) {
      if (parsed[name]) env[name] = parsed[name];
    }
  } catch { /* absent file: status simply reports what is already in the env */ }
  return readKeyStatus(dataDir, env);
}
