import { app, BrowserWindow, Menu, Tray, Notification, nativeImage, dialog, shell, ipcMain } from 'electron';
import os from 'os';
import path from 'path';
import { loadEnvFiles } from './env';
import { getDb, closeDb } from './db/client';
import { loadSettings } from './settings';
import { RecordingPipeline } from './stt/pipeline';
import { registerIpcHandlers } from './ipc';
import { migrateTranscriptNames, rebuildIndex } from './agentHook';
import { writeAgentReadme } from './agentDocs';
import { resolveTranscriptsDir } from './transcriptsPath';
import { MeetingDetector, PulseSource, MacSource, WindowsSource, type SignalSource } from './meetingDetector';
import { alertMeeting, clearAttention } from './meetingAlert';
import { syncAutostart } from './autostart';
import { opensExternally } from './externalLinks';
import { bugReportUrl, formatDiagnostics, recentProblems } from './bugReport';


// Prevent multiple instances — second launch focuses the existing window and exits
if (!app.requestSingleInstanceLock()) {
  app.exit(0);
}

let mainWindow: BrowserWindow | null = null;
let pipeline: import('./stt/pipeline').RecordingPipeline | null = null;
let detector: MeetingDetector | null = null;
let tray: Tray | null = null;
// Closing the window hides Turingram to the tray so meeting detection keeps
// running — the whole point is that it catches a call you forgot to open the app
// for. Only an explicit Quit (tray menu or the app menu) actually exits.
let isQuitting = false;

function showWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) mainWindow = createWindow();
  else { mainWindow.show(); mainWindow.focus(); }
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 900,
    height: 680,
    minWidth: 600,
    minHeight: 500,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      // The preload uses only contextBridge + ipcRenderer, which work sandboxed
      // — there is no reason for the renderer to hold an unsandboxed process.
      sandbox: true,
    },
    titleBarStyle: 'hiddenInset',
    show: false,
  });

  // The renderer is our own bundle and nothing else. It never opens child
  // windows and never navigates; a transcript rendering an attacker-chosen
  // string must not be able to turn either into code execution or exfiltration.
  // No in-app windows, ever. A link to a host the app itself links to (a
  // provider's key page, a drink checkout) opens in the user's browser;
  // anything else, including a link inside transcript text, goes nowhere.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (opensExternally(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    const ok = process.env.NODE_ENV === 'development'
      ? url.startsWith('http://localhost:5173')
      : url === win.webContents.getURL(); // reload of our own page only
    if (!ok) e.preventDefault();
  });

  if (process.env.NODE_ENV === 'development') {
    win.loadURL('http://localhost:5173');
  } else {
    win.loadFile(path.join(process.resourcesPath, 'renderer', 'index.html'));
  }

  // When launched at login, start in the tray without popping the window — the
  // app is there to watch for calls, not to greet you. Linux and Windows pass
  // --hidden; a macOS login item cannot carry arguments, so macOS asks.
  const startHidden = process.argv.includes('--hidden') ||
    (process.platform === 'darwin' && app.getLoginItemSettings().wasOpenedAtLogin);
  win.once('ready-to-show', () => { if (!startHidden) win.show(); });

  win.webContents.on('context-menu', (_e, params) => {
    const items = [];
    if (params.selectionText) items.push({ label: 'Copy', role: 'copy' as const });
    if (params.isEditable) {
      items.push({ label: 'Cut', role: 'cut' as const });
      items.push({ label: 'Paste', role: 'paste' as const });
    }
    if (items.length > 0) Menu.buildFromTemplate(items).popup({ window: win });
  });

  // Once the user has actually looked at the prompt, stop shouting: drop the
  // always-on-top and the frame flash that alertMeeting turned on. Hiding counts
  // too, otherwise a prompt that was never clicked leaves the window pinned above
  // everything the next time it opens.
  win.on('focus', () => clearAttention(win));
  win.on('hide', () => clearAttention(win));

  win.on('close', (e) => {
    // Closing the window never exits — it hides to the tray so the detector
    // keeps watching for calls. Only an explicit Quit sets isQuitting.
    if (!isQuitting) {
      e.preventDefault();
      win.hide();
    }
  });

  return win;
}

// If a second instance launches, focus the existing window
app.on('second-instance', () => {
  showWindow();
});

app.whenReady().then(() => {
  const dataDir = app.getPath('userData');

  // Windows shows a toast only for an app whose id matches its Start menu
  // shortcut, and the NSIS installer names that shortcut with the appId.
  if (process.platform === 'win32') app.setAppUserModelId('com.turingyde.turingram');

  // Provider credentials, provisioned by whoever operates this install rather
  // than typed into the app. The data dir is the packaged app's location — drop a
  // .env beside meetings.db — and the repo root is the development one. First
  // file wins, and a file beats an already-exported variable.
  loadEnvFiles([
    path.join(dataDir, '.env'),
    path.resolve(app.getAppPath(), '.env'),
  ]);

  try {
    getDb(path.join(dataDir, 'meetings.db'));
  } catch (err) {
    // A native-module/DB failure here used to reject silently BEFORE the window
    // was created — the app kept running as an invisible process that ate the
    // single-instance lock, so clicking the launcher did nothing. Fail loudly.
    dialog.showErrorBox(
      'Turingram failed to start',
      `Could not open the meetings database:\n\n${err instanceof Error ? err.message : String(err)}`
    );
    app.exit(1);
    return;
  }
  const settings = loadSettings(dataDir);

  mainWindow = createWindow();

  pipeline = new RecordingPipeline(dataDir, settings, mainWindow);
  registerIpcHandlers(pipeline, dataDir, () => mainWindow);

  // Opens a pre-filled GitHub issue in the browser. The user reviews it there,
  // so nothing is sent from here.
  ipcMain.handle('app:report-bug', (_e, problem?: unknown) => {
    const diagnostics = formatDiagnostics({
      version: app.getVersion(),
      platform: process.platform,
      release: os.release(),
      arch: process.arch,
      electron: process.versions.electron,
      detection: detector?.status() ?? 'not available on this platform',
      problems: recentProblems(),
    });
    void shell.openExternal(bugReportUrl(diagnostics, typeof problem === 'string' ? problem : undefined));
  });

  // Keep the agent-facing folder self-describing, wherever the user has put it.
  // All three are idempotent, and they only ever touch the transcripts directory
  // itself — never anything else in a folder the user chose.
  try {
    const dir = resolveTranscriptsDir(dataDir, settings);
    migrateTranscriptNames(dir);
    rebuildIndex(dir);
    writeAgentReadme(dir);
  } catch (err) {
    // A folder we cannot document is not a reason to fail a launch.
    console.error('Could not refresh the transcripts index:', err);
  }

  // Transcription is API-driven as of 2026-07-22 — there is no local model to
  // pre-download and no diarization venv to warm up. Nothing to do here.

  // Remove any echo-cancel module left loaded by a previous crashed session.
  if (process.platform === 'linux') {
    import('./audio/linux').then(m => m.cleanupStaleEchoCancel()).catch(() => { /* non-fatal */ });
  }

  createTray();

  // Reconcile the login-autostart entry with the saved setting (and refresh its
  // Exec path in case the binary moved).
  syncAutostart(settings.launchAtLogin);

  // Watch for a conferencing app grabbing the mic and offer to record. Prompt
  // only — the detector never starts a recording itself. Each platform reads
  // the microphone from its own source: pactl on Linux, the Swift helper on
  // macOS, the privacy registry on Windows.
  const source = meetingSource();
  if (source) {
    detector = new MeetingDetector(
      () => loadSettings(dataDir).autoDetectMeetings,
      () => pipeline?.getState().isRecording ?? false,
      (c) => alertMeeting(
        {
          getWindow: () => mainWindow,
          openWindow: () => showWindow(),
          isWayland: process.env.XDG_SESSION_TYPE === 'wayland',
          notify: ({ title, body, onClick }) => {
            if (!Notification.isSupported()) return;
            const n = new Notification({ title, body });
            n.on('click', onClick);
            n.show();
          },
        },
        c,
      ),
      source,
    );
    detector.start();
  }
});

function meetingSource(): SignalSource | null {
  switch (process.platform) {
    case 'linux': return new PulseSource();
    case 'darwin': {
      const helper = app.isPackaged
        ? path.join(process.resourcesPath, 'turingram-audio-helper')
        : path.join(__dirname, '..', 'resources', 'turingram-audio-helper');
      return new MacSource(helper, 'com.turingyde.turingram');
    }
    // Our own recorder never trips it: detection is off while recording.
    case 'win32': return new WindowsSource(['Turingram.exe']);
    default: return null;
  }
}

// Restores the tray from the version that shipped and worked on this same
// Cinnamon machine before it was removed (git d8c79fa^ packages/main/src/tray.ts).
// The load-bearing detail is `nativeImage.createFromPath`, NOT a bare path string:
// a path string made Electron register a nameless-pixmap StatusNotifierItem that
// xapp-sn-watcher rendered as its broken-"!" glyph; the nativeImage path is what
// the working artifact used. Same Electron 41, same desktop — the tray renders.
function createTray(): void {
  try {
    const packaged = path.join(process.resourcesPath, 'icons', 'icon-32.png');
    const iconFile = app.isPackaged ? packaged : path.resolve(__dirname, '../assets/icon-32.png');
    const icon = nativeImage.createFromPath(iconFile);
    tray = new Tray(icon);
    tray.setToolTip('Turingram');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Open Turingram', click: () => showWindow() },
      { type: 'separator' },
      { label: 'Quit', click: () => { isQuitting = true; app.quit(); } },
    ]));
    tray.on('click', () => showWindow());
  } catch {
    // No system tray (some minimal WMs) — the app still runs and detection still
    // works; reopen via relaunch (single-instance shows the window) or the
    // meeting notification. Not fatal.
  }
}

// Do NOT quit when the window closes — the app lives in the tray and keeps
// detecting. Quitting is explicit (tray menu / before-quit teardown).
app.on('window-all-closed', () => { /* stay resident in the tray */ });

let tearingDown = false;
app.on('before-quit', (e) => {
  // Stop any active recording (cleans up PA modules, kills ffmpeg, restores the
  // default sink) before exit. This is async — without preventDefault the app
  // would exit mid-teardown and leave the echo-cancel module loaded.
  if (tearingDown) return;
  tearingDown = true;
  // Any pathway into before-quit (Ctrl+Q, app menu, tray Quit) is a real exit,
  // so the window's hide-on-close guard must stand down.
  isQuitting = true;
  e.preventDefault();
  detector?.stop();
  (pipeline?.forceStop() ?? Promise.resolve())
    .catch(() => { /* best effort */ })
    .finally(() => { try { closeDb(); } catch { /* ignore */ } app.exit(0); });
});
