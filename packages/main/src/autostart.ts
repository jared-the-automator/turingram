import fs from 'fs';
import os from 'os';
import path from 'path';
import { app } from 'electron';

// Launch Turingram with the user's session so meeting detection is already
// watching before they join a call — the whole point of the feature. Done with a
// freedesktop autostart .desktop file (the mechanism Cinnamon/GNOME/KDE all read,
// and the same one Flameshot, Surfshark et al. use here) rather than Electron's
// setLoginItemSettings, whose Linux support is patchy.

const AUTOSTART_DIR = path.join(os.homedir(), '.config', 'autostart');
const DESKTOP_FILE = path.join(AUTOSTART_DIR, 'turingram.desktop');

// Exec is parsed by the desktop-entry rules, not a shell: an unquoted path with
// a space (an AppImage in "~/My Apps/") splits into a nonexistent command and
// the entry silently never launches. Quote unless the path is plainly safe;
// inside quotes the spec reserves `"`, `` ` ``, `$` and `\`.
export function quoteExecPath(p: string): string {
  if (/^[A-Za-z0-9/._+-]+$/.test(p)) return p;
  return `"${p.replace(/["`$\\]/g, ch => `\\${ch}`)}"`;
}

// The binary to relaunch. An AppImage extracts to a temp mount, so its execPath
// is useless across reboots — APPIMAGE holds the real .AppImage path. A deb/rpm
// install has a stable execPath (/opt/Turingram/turingram-workspace).
function launcherCommand(): string {
  const bin = process.env.APPIMAGE || process.execPath;
  // --hidden starts in the tray without popping the window on every login.
  return `${quoteExecPath(bin)} --hidden`;
}

export function isAutostartEnabled(): boolean {
  try { return fs.existsSync(DESKTOP_FILE); } catch { return false; }
}

// Writes or removes the autostart entry to match `enabled`. Best-effort: a
// failure here must not break startup, so it is caught and reported false.
export function setAutostart(enabled: boolean): boolean {
  try {
    if (!enabled) {
      if (fs.existsSync(DESKTOP_FILE)) fs.unlinkSync(DESKTOP_FILE);
      return true;
    }
    fs.mkdirSync(AUTOSTART_DIR, { recursive: true });
    const entry = [
      '[Desktop Entry]',
      'Type=Application',
      'Name=Turingram',
      'Comment=Meeting transcription — watches for calls in the background',
      `Exec=${launcherCommand()}`,
      'Icon=turingram-workspace',
      'Terminal=false',
      'X-GNOME-Autostart-enabled=true',
      '',
    ].join('\n');
    fs.writeFileSync(DESKTOP_FILE, entry);
    return true;
  } catch (err) {
    console.error('[turingram] autostart update failed:', (err as Error).message);
    return false;
  }
}

// Reconciles the on-disk autostart entry with the saved setting on every launch,
// and refreshes the Exec line so it never points at a stale path (e.g. after an
// AppImage moves). Only touches the file when it is enabled and packaged — an
// unpackaged dev run must never register the dev binary to autostart.
export function syncAutostart(enabled: boolean): void {
  if (!app.isPackaged) return;
  if (enabled) setAutostart(true);
  else if (isAutostartEnabled()) setAutostart(false);
}
