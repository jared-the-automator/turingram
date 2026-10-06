import fs from 'fs';

// Loads provider credentials from a .env file into process.env.
//
// Turingram does not collect API keys in its UI. Keys are provisioned by whoever
// operates the install — a .env dropped beside the app's data — which is the same
// seam a metering proxy or a short-lived provisioned token would occupy in a
// commercial deployment. The client stays a consumer of credentials it never owns
// or displays.
//
// Hand-rolled rather than dotenv, which was removed: it was declared in
// package.json, but electron-builder prunes against the ROOT package.json, so it
// never reached the asar and a top-level import killed the packaged app before it
// drew a window. This is a dozen lines and cannot go missing.

// Matches `KEY=value`, tolerating `export KEY=value`, surrounding whitespace, and
// single- or double-quoted values. Anything else on a line is ignored.
const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;

export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const m = LINE.exec(line);
    if (!m) continue;
    let value = m[2].trim();
    // Strip one matching pair of surrounding quotes; leave inner content alone.
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))) {
      value = value.slice(1, -1);
    } else {
      // Unquoted values may carry a trailing comment.
      const hash = value.indexOf(' #');
      if (hash !== -1) value = value.slice(0, hash).trim();
    }
    if (value) out[m[1]] = value;
  }
  return out;
}

// Applies the first readable file from `paths`, earlier entries winning.
//
// The file beats an already-exported variable, deliberately. A stale ambient
// GEMINI_API_KEY once shadowed the correct key in .env and the only symptom was
// Google's generic "API key not valid" — hours lost to a variable nobody
// remembered exporting. The file on disk is the thing a person just edited, so
// it is the thing that should win.
export function loadEnvFiles(paths: string[]): string[] {
  const loaded: string[] = [];
  // Keys claimed by an earlier file are not reassigned by a later one. Without
  // this the loop would apply files in order and the LAST one would win, which is
  // backwards: index.ts lists the operator-provisioned data-dir .env first
  // precisely so a leftover development .env cannot override it.
  const claimed = new Set<string>();
  for (const file of paths) {
    let text: string;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch {
      continue; // absent or unreadable — the next candidate, or none at all
    }
    for (const [key, value] of Object.entries(parseEnv(text))) {
      if (claimed.has(key)) continue;
      process.env[key] = value;
      claimed.add(key);
    }
    loaded.push(file);
  }
  return loaded;
}
