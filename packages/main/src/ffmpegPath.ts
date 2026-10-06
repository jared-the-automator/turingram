import path from 'path';
import fs from 'fs';
// Deliberately does NOT import electron. This module is called from
// preprocess.ts and localSpeaker.ts, which run under vitest with no electron
// runtime; reading `app.isPackaged` there threw, the caller swallowed it as a
// preprocessing failure, and three tests went red. process.resourcesPath is
// defined by Electron itself and undefined in plain Node, which is the same
// signal without the dependency.

// Every capture and preprocessing path shells out to ffmpeg. Until this module
// existed they all spawned a bare 'ffmpeg' and relied on it being on PATH,
// which is true on a Linux dev box and false on a stock macOS or Windows
// machine — so a packaged build installed, launched, and then failed at the
// first recording.
//
// Resolution order is bundled-then-system rather than the reverse. A binary we
// ship is the one we have tested against; picking up whatever the user happens
// to have installed would make behavior depend on their machine.
const BINARY = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';

let cached: string | null = null;

function candidates(): string[] {
  const out: string[] = [];
  // Packaged: electron-builder places it in Contents/Resources (mac) or
  // resources\ (win/linux) via extraResources, beside the Swift audio helper.
  if (process.resourcesPath) {
    out.push(path.join(process.resourcesPath, BINARY));
  }
  // Development: the same layout under packages/main/resources, which is where
  // build-swift already writes turingram-audio-helper.
  out.push(path.join(__dirname, '..', 'resources', BINARY));
  out.push(path.join(__dirname, '..', '..', 'resources', BINARY));
  return out;
}

/**
 * Absolute path to a bundled ffmpeg, or the bare name so the OS resolves it
 * from PATH. Never throws: a missing bundle degrades to the previous behavior
 * rather than taking down a recording that might otherwise have worked.
 */
export function ffmpegPath(): string {
  if (cached) return cached;
  for (const candidate of candidates()) {
    try {
      fs.accessSync(candidate, fs.constants.X_OK);
      cached = candidate;
      return cached;
    } catch {
      // Not here, or not executable — try the next one.
    }
  }
  cached = BINARY;
  return cached;
}

/** True when ffmpeg came from the bundle rather than from the user's PATH. */
export function isBundledFfmpeg(): boolean {
  return ffmpegPath() !== BINARY;
}

// Exposed for tests, which need to re-resolve after moving files around.
export function resetFfmpegPathCache(): void {
  cached = null;
}
