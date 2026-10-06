import { ipcMain, app, shell, dialog } from 'electron';
import type { BrowserWindow } from 'electron';
import fs from 'fs';
import path from 'path';
import type { AppSettings } from '@turingyde/transcript-core';
import type { RecordingPipeline } from './stt/pipeline';
import { loadSettings, saveSettings } from './settings';
import { setAutostart } from './autostart';
import { getDb } from './db/client';
import { listMeetings, getMeeting, renameMeeting, deleteMeeting, updateMeetingNotes } from './db/meetings';
import { getSegments, deleteSegmentsByMeeting, renameSegmentSpeakers } from './db/segments';
import { searchTranscripts } from './db/search';
import { listAudioDevices } from './audio/index';
import { exportMeeting, ALLOWED_FORMATS, type ExportFormat } from './export';
import { writeAgentHook, rebuildIndex, migrateTranscriptNames, INDEX_FILE } from './agentHook';
import { writeAgentReadme, README_FILE } from './agentDocs';
import {
  resolveTranscriptsDir, defaultTranscriptsDir, moveTranscripts, checkWritableDir, ownedFiles,
} from './transcriptsPath';
import { removeMeetingArtifacts } from './artifacts';
import { SAFE_ID } from './ids';
import { readKeyStatus, reloadKeys, saveKeys, envPath, type KeyName } from './byoKeys';
import { drinkState, redeem } from './drinks';

export function registerIpcHandlers(
  pipeline: RecordingPipeline,
  dataDir: string,
  _getWindow: () => BrowserWindow | null
): void {
  ipcMain.handle('recording:start', async () => pipeline.start());
  ipcMain.handle('recording:stop', async (_, notes: string, participants: string = '') =>
    pipeline.stop(notes, participants));
  ipcMain.handle('recording:cancel-processing', () => pipeline.cancelProcessing());
  ipcMain.handle('meetings:retry', (_, id: string) => pipeline.retryTranscription(id));
  ipcMain.handle('meetings:has-audio', (_, id: string) =>
    SAFE_ID.test(id) && fs.existsSync(path.join(dataDir, 'recordings', `${id}.wav`)));
  ipcMain.handle('recording:state', () => pipeline.getState());

  ipcMain.handle('meetings:list', () => listMeetings(getDb()));
  ipcMain.handle('meetings:get', (_, id: string) => getMeeting(getDb(), id));
  ipcMain.handle('meetings:segments', (_, id: string) => getSegments(getDb(), id));
  ipcMain.handle('meetings:search', (_, query: string) => searchTranscripts(getDb(), query));

  // The agentHook JSON is the product — an external agent reads it, not the DB.
  // Any edit that changes what the transcript "says" (title, notes, speaker
  // names) must be reflected there, or the consumer sees stale labels forever.
  const refreshAgentHook = (id: string) => {
    const db = getDb();
    const meeting = getMeeting(db, id);
    if (!meeting) return;
    const segments = getSegments(db, id);
    if (segments.length > 0) writeAgentHook(resolveTranscriptsDir(dataDir, loadSettings(dataDir)), meeting, segments);
  };

  ipcMain.handle('meetings:rename', (_, id: string, title: string) => {
    renameMeeting(getDb(), id, title);
    refreshAgentHook(id);
  });

  ipcMain.handle('meetings:delete', (_, id: string) => {
    const db = getDb();
    deleteSegmentsByMeeting(db, id);
    deleteMeeting(db, id);
    // Remove the on-disk artifacts too — a deleted meeting must not leave its
    // audio or transcript behind (privacy + unbounded disk growth).
    removeMeetingArtifacts(dataDir, resolveTranscriptsDir(dataDir, loadSettings(dataDir)), id);
  });

  ipcMain.handle('meetings:update-notes', (_, id: string, notes: string) => {
    updateMeetingNotes(getDb(), id, notes);
    refreshAgentHook(id);
  });

  ipcMain.handle('meetings:assign-speakers', (_, meetingId: string, map: Record<string, string>) => {
    renameSegmentSpeakers(getDb(), meetingId, map);
    refreshAgentHook(meetingId);
  });

  ipcMain.handle('meetings:export', async (_, meetingId: string, format: string = 'md') => {
    if (!ALLOWED_FORMATS.includes(format as ExportFormat)) throw new Error(`Invalid export format: ${format}`);
    const meeting = getMeeting(getDb(), meetingId);
    const segments = getSegments(getDb(), meetingId);
    if (!meeting) throw new Error(`Meeting not found: ${meetingId}`);
    return exportMeeting(app.getPath('downloads'), meeting, segments, format as ExportFormat);
  });

  // Only reveal paths this app hands out — exports (downloads) and the
  // transcripts folder. A compromised renderer should not get a generic
  // "open the file manager anywhere" primitive out of the main process.
  ipcMain.handle('shell:reveal', (_, filePath: string) => {
    const target = path.resolve(String(filePath));
    const roots = [app.getPath('downloads'), resolveTranscriptsDir(dataDir, loadSettings(dataDir))];
    const inside = roots.some(root => {
      const rel = path.relative(root, target);
      return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
    });
    if (inside) shell.showItemInFolder(target);
  });

  // Where to point your agents. The path is the whole answer, so it is returned
  // rather than rendered in the main process — Settings shows it verbatim.
  const agentInfo = () => {
    const dir = resolveTranscriptsDir(dataDir, loadSettings(dataDir));
    // Count what a folder change would actually move. In a user's own vault,
    // counting every .json here would claim their files as ours in the UI.
    const fileCount = ownedFiles(dir)
      .filter(f => f !== INDEX_FILE && f !== README_FILE).length;
    return {
      dir,
      indexPath: path.join(dir, INDEX_FILE),
      readmePath: path.join(dir, README_FILE),
      isDefault: dir === defaultTranscriptsDir(dataDir),
      fileCount,
    };
  };
  ipcMain.handle('agent:info', agentInfo);

  // Moves the transcripts to a directory of the user's choosing — typically one
  // their agents already read, which is the entire point. Returns null when the
  // picker is cancelled, or an error string the UI shows without changing
  // anything: a destination that cannot be written to must fail while the user
  // is still looking at it, not silently swallow every future transcript.
  const setTranscriptsDir = (target: string | null) => {
    const from = resolveTranscriptsDir(dataDir, loadSettings(dataDir));
    const to = target === null ? defaultTranscriptsDir(dataDir) : path.resolve(target);
    if (from === to) return { ok: true, info: agentInfo() };

    const problem = checkWritableDir(to);
    if (problem) return { ok: false, error: problem };

    const { failed } = moveTranscripts(from, to);
    const current = { ...loadSettings(dataDir), transcriptsDir: target };
    saveSettings(dataDir, current);

    // Re-document at the new location: the README names its own directory, and
    // it is the thing an agent arriving there actually reads.
    migrateTranscriptNames(to);
    rebuildIndex(to);
    writeAgentReadme(to);

    return {
      ok: true,
      info: agentInfo(),
      error: failed.length ? `${failed.length} file(s) could not be moved and are still in the old folder.` : undefined,
    };
  };

  ipcMain.handle('agent:choose-dir', async () => {
    const win = _getWindow();
    const result = win
      ? await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled || result.filePaths.length === 0) return null;
    return setTranscriptsDir(result.filePaths[0]);
  });

  ipcMain.handle('agent:reset-dir', () => setTranscriptsDir(null));

  ipcMain.handle('settings:get', () => loadSettings(dataDir));
  ipcMain.handle('settings:update', (_, patch: Partial<AppSettings>) => {
    // transcriptsDir only changes through agent:choose-dir / agent:reset-dir,
    // which validate the destination and move the files. A generic patch would
    // repoint the setting with neither, stranding every transcript.
    const { transcriptsDir: _ignored, ...safe } = patch;
    const current = loadSettings(dataDir);
    saveSettings(dataDir, { ...current, ...safe });
    // The login-autostart entry is a file on disk, not just a stored flag —
    // apply it the moment the toggle changes, not only at next boot.
    if (Object.prototype.hasOwnProperty.call(patch, 'launchAtLogin')) {
      setAutostart(!!patch.launchAtLogin);
    }
  });

  ipcMain.handle('audio:devices', async () => listAudioDevices());

  // Only ever presence by name, never a value. A renderer that can read back a
  // key it just wrote turns one XSS into credential exfiltration, and nothing in
  // the UI needs the string once it has been saved.
  ipcMain.handle('drinks:state', () => drinkState(dataDir));
  ipcMain.handle('drinks:redeem', async (_, token: unknown) =>
    typeof token === 'string' && token.length < 4096 && await redeem(dataDir, token));

  ipcMain.handle('keys:status', () => readKeyStatus(dataDir));
  ipcMain.handle('keys:reload', () => reloadKeys(dataDir));
  ipcMain.handle('keys:save', (_, updates: Record<string, string>) =>
    saveKeys(dataDir, updates as Partial<Record<KeyName, string>>));
  ipcMain.handle('keys:reveal-env', () => {
    const file = envPath(dataDir);
    // showItemInFolder on a path that does not exist opens nothing at all, which
    // reads as a dead button to the one person who most needs it to work.
    if (!fs.existsSync(file)) fs.writeFileSync(file, '', { mode: 0o600 });
    shell.showItemInFolder(file);
  });
}
