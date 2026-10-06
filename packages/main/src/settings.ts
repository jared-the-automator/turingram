import fs from 'fs';
import path from 'path';
import type { AppSettings } from '@turingyde/transcript-core';
import { DEFAULT_SETTINGS } from '@turingyde/transcript-core';

const VALID_ENGINES = new Set(['deepgram', 'gemini-free', 'gemini-paid']);

// Values that flow into subprocess args or dispatch must come from the known
// set — a corrupted/hand-edited settings.json must not produce garbage engine
// states. (The whisperModel path-safety check went away with the model field
// itself: nothing builds `ggml-*.bin` paths from settings any more.)
function sanitize(settings: AppSettings): AppSettings {
  const s = { ...settings };
  if (s.transcriptionEngine && !VALID_ENGINES.has(s.transcriptionEngine)) {
    s.transcriptionEngine = DEFAULT_SETTINGS.transcriptionEngine;
  }
  return s;
}

export function loadSettings(dataDir: string): AppSettings {
  const filePath = path.join(dataDir, 'settings.json');
  if (!fs.existsSync(filePath)) return { ...DEFAULT_SETTINGS };
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return sanitize({ ...DEFAULT_SETTINGS, ...raw });
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(dataDir: string, settings: AppSettings): void {
  fs.mkdirSync(dataDir, { recursive: true });
  // Atomic write — a crash mid-write must not corrupt settings.json, which
  // would silently reset every setting on the next load. (API keys are not at
  // stake — they live in .env, never in settings.)
  const dest = path.join(dataDir, 'settings.json');
  const tmp = `${dest}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(sanitize(settings), null, 2));
  fs.renameSync(tmp, dest);
}
