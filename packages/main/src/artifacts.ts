import fs from 'fs';
import path from 'path';
import { findHookFiles, rebuildIndex } from './agentHook';
import { SAFE_ID } from './ids';

// Everything a meeting leaves outside the database. A meeting that is deleted
// or discarded must take all of it: the agent-hook JSON is a full transcript
// readable by anything with filesystem access, so leaving it behind is a
// privacy leak, not merely disk growth.
// transcriptsDir is passed separately from dataDir because the user chooses
// where transcripts live — it is often not under the app's data directory at all.
export function removeMeetingArtifacts(dataDir: string, transcriptsDir: string, meetingId: string): void {
  if (!SAFE_ID.test(meetingId)) return;
  for (const p of [
    path.join(dataDir, 'recordings', `${meetingId}.wav`),
    path.join(dataDir, 'recordings', `${meetingId}_pre.wav`),
    // Transcripts are named for their title and date, both of which the user can
    // change, so the id inside each file is the only reliable way to find them.
    // Matching on the filename would strand the transcript of any renamed
    // meeting — deleted from the app, still fully readable on disk.
    ...findHookFiles(transcriptsDir, meetingId),
  ]) {
    try { fs.rmSync(p, { force: true }); } catch { /* best effort */ }
  }
  try { rebuildIndex(transcriptsDir); } catch { /* best effort */ }
}
