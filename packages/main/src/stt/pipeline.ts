import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import type { BrowserWindow } from 'electron';
import type { AppSettings, Meeting, TranscriptSegment } from '@turingyde/transcript-core';
import { createAudioCapture } from '../audio/index';
import { transcribeAudioDeepgram } from './deepgram';
import { transcribeAudioGemini } from './gemini';
import { detectMicActivity, detectRemoteActivity, pinLocalSpeaker, dropPhantomRemoteSpeech } from './localSpeaker';
import { summarizeMeeting } from './summarize';
import { speechExtentSec, inferableSpeakerRenames } from './postprocess';
import { preprocessAudio } from './preprocess';
import { SAFE_ID } from '../ids';
import { recordMeeting } from '../drinks';

// Keys come from the environment only — never from settings, and never from the
// UI. env.ts populates it from a .env provisioned by whoever operates the
// install, which is the seam a metering proxy or a short-lived provisioned token
// takes over in a commercial deployment. Nothing in the client collects, stores
// or displays a credential.
function deepgramKey(): string {
  return (process.env.DEEPGRAM_API_KEY || '').trim();
}
function geminiKey(): string {
  return (process.env.GEMINI_API_KEY || '').trim();
}

// Probe a recording's channel count + duration (for retry — isStereo & timeout).
// Uses argv (no shell) so the file path can't be interpreted as a command.
function probeAudio(file: string): Promise<{ channels: number; durationSec: number }> {
  return new Promise(resolve => {
    const proc = spawn('ffprobe', [
      '-v', 'error', '-show_entries', 'stream=channels',
      '-show_entries', 'format=duration', '-of', 'default=nw=1', file,
    ]);
    let out = '';
    proc.stdout.on('data', (d: Buffer) => { out += d.toString(); });
    proc.on('error', () => resolve({ channels: 1, durationSec: 0 }));
    proc.on('close', () => {
      // ffprobe prints "key=value" lines (channels=2, duration=1365.9).
      const val = (key: string): string => {
        const line = out.split('\n').find(l => l.trim().startsWith(`${key}=`));
        return line ? line.split('=')[1].trim() : '';
      };
      const channels = parseInt(val('channels') || '1', 10) || 1;
      const durationSec = Math.round(parseFloat(val('duration') || '0')) || 0;
      resolve({ channels, durationSec });
    });
  });
}
import { getDb } from '../db/client';
import { insertMeeting, updateMeeting, updateMeetingNotes, getMeeting, deleteMeeting, renameMeeting } from '../db/meetings';
import { insertSegments, deleteSegmentsByMeeting, renameSegmentSpeakers } from '../db/segments';
import { writeAgentHook } from '../agentHook';
import { resolveTranscriptsDir } from '../transcriptsPath';
import { removeMeetingArtifacts } from '../artifacts';
import { raiseWindow } from '../meetingAlert';
import { loadSettings } from '../settings';
import { noteProblem } from '../bugReport';

export interface RecordingState {
  isRecording: boolean
  meetingId: string | null
  startedAt: number | null
}

export class RecordingPipeline {
  private state: RecordingState = { isRecording: false, meetingId: null, startedAt: null };
  private capture: ReturnType<typeof createAudioCapture> | null = null;
  // One AbortController per in-flight transcription job — stop() and
  // retryTranscription() can overlap, so a shared controller would let one job
  // clobber or cancel the other. cancelProcessing() aborts every active job.
  private activeJobs = new Set<AbortController>();
  // Set when cancel arrives during capture teardown, before the job's
  // controller exists; consumed by the next job start.
  private pendingCancel = false;
  // True for the whole of stop() — including the window before the job's
  // controller exists — so cancelProcessing() can tell "still working on it"
  // apart from "already finished".
  private stopInFlight = false;
  // The meeting the current record→transcribe round produced. "Stop & discard"
  // must still discard it when the click lands after the pipeline finished; a
  // 15-second recording transcribes in about a second, which is less time than
  // it takes to move the mouse. Cleared once discarded, and never points at a
  // meeting being re-transcribed (that one already exists on its own merits).
  private discardableMeetingId: string | null = null;
  // Set once per recording by abortDeadCapture, and read by start() to close the
  // window where a capture dies before start() has finished wiring it up.
  private deadCapture: { meetingId: string; reason: string } | null = null;

  constructor(
    private dataDir: string,
    private settings: AppSettings,
    private win: BrowserWindow | null
  ) {}

  getState(): RecordingState { return { ...this.state }; }

  // Single dispatch point for stop() and retryTranscription(). Both used to
  // carry their own copy of this branch, so a fix in one silently missed the
  // other.
  private async runTranscription(
    processPath: string,
    meetingId: string,
    settings: AppSettings,
    participants: string,
    onProgress: (phase: string) => void,
    signal: AbortSignal,
  ): Promise<TranscriptSegment[]> {
    const engine = settings.transcriptionEngine;
    // Participant names are the highest-value recognition hints available —
    // they are exactly the proper nouns a general model gets wrong.
    const vocabulary = [
      ...(settings.vocabulary ?? []),
      ...participants.split(/[,\n]/).map(p => p.trim()).filter(Boolean),
    ];

    if (engine === 'gemini-free' || engine === 'gemini-paid') {
      const key = geminiKey();
      if (!key) throw new Error('No Gemini API key. Set GEMINI_API_KEY in the .env file in Turingram\'s data directory.');
      onProgress('Uploading audio to Gemini…');
      return transcribeAudioGemini(processPath, meetingId, key, signal);
    }
    // 'deepgram' is the default, and catches any unrecognized legacy saved value
    // (the removed 'local' and 'assemblyai') rather than failing on it.
    const key = deepgramKey();
    if (!key) throw new Error('No Deepgram API key. Set DEEPGRAM_API_KEY in the .env file in Turingram\'s data directory.');
    return transcribeAudioDeepgram(
      processPath, meetingId, key, { vocabulary, onProgress }, signal,
    );
  }

  // On a stereo capture the left channel IS the microphone and the right is the
  // far end, so whichever diarized speaker lines up with mic activity is the local
  // user (relabelled "You"), and anything attributed to a remote participant while
  // NO remote audio was arriving did not happen on the call and is dropped.
  // Two local ffmpeg passes, no extra API spend. Best-effort: a failure here must
  // never cost the transcript, so it falls back to the diarized labels.
  private async pinLocal(
    audioPath: string,
    segments: TranscriptSegment[],
    signal: AbortSignal,
  ): Promise<TranscriptSegment[]> {
    try {
      const [micRanges, remoteRanges] = await Promise.all([
        detectMicActivity(audioPath, signal),
        detectRemoteActivity(audioPath, signal),
      ]);
      const pinned = pinLocalSpeaker(segments, micRanges);
      // Order matters: the phantom test exempts the local speaker, so the local
      // speaker has to be identified first.
      return dropPhantomRemoteSpeech(pinned, remoteRanges, micRanges);
    } catch {
      return segments;
    }
  }

  // Best-effort: a summarization failure must never destroy a transcript the
  // user already paid to produce, so this swallows its own errors.
  private async generateSummary(
    meetingId: string,
    segments: TranscriptSegment[],
    settings: AppSettings,
    signal: AbortSignal,
  ): Promise<void> {
    const key = geminiKey();
    if (!key || segments.length === 0) return;
    try {
      this.win?.webContents.send('processing:progress', { phase: 'Writing summary…', meetingId });
      const db = getDb();
      // Read notes/title fresh: on the autostop path the renderer saves notes
      // separately, so they may have landed after stop() began.
      const before = getMeeting(db, meetingId);
      const { summary, actionItems, title, speakerNames } = await summarizeMeeting(
        segments, before?.notes ?? '', key, signal,
      );
      if (summary || actionItems.length > 0) {
        updateMeeting(db, meetingId, { summary: summary || null, actionItems });
      }
      // Auto-name the meeting from its content. At this point the title is still
      // the placeholder ("Meeting 11:57") or the detected call window's title
      // ("Zoom Workplace") — the rename UI only appears after processing. If it
      // changed while the summary was being written, a user beat us to it: keep
      // theirs.
      if (title && before && getMeeting(db, meetingId)?.title === before.title) {
        renameMeeting(db, meetingId, title);
      }
      // Apply inferred speaker names to still-anonymous "Speaker N" labels, in
      // the DB and in the in-memory segments the caller hands to the agent hook.
      const renames = inferableSpeakerRenames(speakerNames);
      if (Object.keys(renames).length > 0) {
        renameSegmentSpeakers(db, meetingId, renames);
        for (const seg of segments) {
          if (renames[seg.speakerLabel]) seg.speakerLabel = renames[seg.speakerLabel];
        }
      }
    } catch (err) {
      if (signal.aborted) return;
      this.logError(meetingId, err);
    }
  }

  // Read fresh rather than cached: the user can repoint this in Settings while
  // the app runs, and the next transcript should land where they just said.
  private transcriptsDir(): string {
    return resolveTranscriptsDir(this.dataDir, loadSettings(this.dataDir));
  }

  async start(): Promise<string> {
    if (this.state.isRecording) throw new Error('Already recording');

    const { randomUUID } = await import('crypto');
    const meetingId = randomUUID();
    const startedAt = Date.now();
    this.deadCapture = null;

    insertMeeting(getDb(), {
      id: meetingId,
      title: `Meeting ${new Date(startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`,
      startedAt, endedAt: 0, durationSec: 0, notes: '', summary: null, actionItems: [],
    });

    try {
      this.capture = createAudioCapture(this.dataDir, this.settings.audioDeviceId);
      this.capture.on('error', (err) => {
        this.logError(meetingId, err);
        this.win?.webContents.send('recording:error', String(err));
        // The banner above is all this used to do, and the window it renders in
        // was hidden in the tray at the time. Ask the session whether the error
        // was terminal and end the recording here if it was.
        const reason = this.capture?.captureFailure();
        if (reason) void this.abortDeadCapture(meetingId, reason);
      });
      await this.capture.start();
    } catch (err) {
      // Capture never started — remove the ghost meeting row so it doesn't
      // pile up in the list as a permanent 0:00 entry.
      try { deleteMeeting(getDb(), meetingId); } catch { /* ignore */ }
      this.capture = null;
      throw err;
    }
    // The capture can die during start()'s own awaits — resolving the mic source
    // and settling the echo-cancel module take longer than an ffmpeg with a bad
    // argument takes to exit — so the handler above can fire before the state
    // below exists and find nothing to tear down. Ask once more now that it does,
    // and fail start() outright rather than returning a recording that is already
    // over.
    const bornDead = this.deadCaptureReason() ?? this.capture.captureFailure();
    if (bornDead) {
      await this.abortDeadCapture(meetingId, bornDead);
      throw new Error(bornDead);
    }
    this.capture.on('autostop', async () => {
      if (!this.state.isRecording) return;
      this.win?.webContents.send('recording:autostopped');
      // null: don't clobber notes — the renderer saves its typed notes when done.
      await this.stop(null).catch((err: Error) => {
        console.error('[turingram] autostop stop() failed:', err.message);
      });
    });

    this.state = { isRecording: true, meetingId, startedAt };
    this.discardableMeetingId = meetingId;
    return meetingId;
  }

  // notes === null means "leave existing notes untouched" (autostop path — the
  // user's typed notes live in the renderer and are saved separately).
  //
  // Thin wrapper so `stopInFlight` is cleared on every exit path, including the
  // early returns and throws inside runStop().
  async stop(notes: string | null, participants = ''): Promise<Meeting | null> {
    this.stopInFlight = true;
    try {
      return await this.runStop(notes, participants);
    } finally {
      this.stopInFlight = false;
    }
  }

  private async runStop(notes: string | null, participants = ''): Promise<Meeting | null> {
    if (!this.state.isRecording || !this.capture || !this.state.meetingId) {
      throw new Error('Not recording');
    }
    this.pendingCancel = false;

    const endedAt = Date.now();
    const durationSec = Math.round((endedAt - this.state.startedAt!) / 1000);
    const meetingId = this.state.meetingId;

    this.state = { isRecording: false, meetingId: null, startedAt: null };
    let captureResult;
    try {
      captureResult = await this.capture.stop();
    } catch (err) {
      // Capture produced no audio at all (mic ffmpeg never started). There is
      // nothing to transcribe and nothing to retry — remove the row start()
      // created rather than leaving a 0:00 ghost meeting in the list.
      this.discardMeeting(meetingId);
      this.win?.webContents.send('processing:progress', { phase: 'error', meetingId, error: String(err) });
      throw err;
    } finally {
      this.capture = null;
    }
    // Capture came back degraded — it recorded something, but less than it was
    // asked to. Routed through recording:error rather than logged, because the
    // transcript that follows will look finished and correct, and the user has no
    // other way to learn that half the room is missing from it.
    if (captureResult.warning) {
      console.warn('[turingram] capture degraded:', captureResult.warning);
      noteProblem(captureResult.warning);
      this.win?.webContents.send('recording:error', captureResult.warning);
    }
    // Name the audio by meeting ID so a failed transcription leaves a file we can
    // find and retry later (capture names it by timestamp).
    let audioPath = captureResult.audioPath;
    const namedPath = path.join(this.dataDir, 'recordings', `${meetingId}.wav`);
    try {
      if (audioPath !== namedPath && fs.existsSync(audioPath)) {
        fs.renameSync(audioPath, namedPath);
        audioPath = namedPath;
      }
    } catch { /* keep original path */ }

    const db = getDb();
    updateMeeting(db, meetingId, { endedAt, durationSec });
    if (notes !== null) updateMeetingNotes(db, meetingId, notes);

    // Skip transcription for very short recordings — a near-empty file is a
    // billed API call that comes back with nothing in it.
    if (durationSec < 2) {
      if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
      this.win?.webContents.send('processing:progress', { phase: 'done', meetingId });
      return getMeeting(db, meetingId)!;
    }

    // Every twelve recorded hours on an unpaid install, ask for a drink. Never
    // awaited: the ask must not delay or break the transcript.
    void recordMeeting(this.dataDir, durationSec)
      .then(line => { if (line) this.win?.webContents.send('drinks:nag', line); })
      .catch(err => console.error('Drinks ledger update failed:', err));

    this.win?.webContents.send('processing:progress', { phase: 'Transcribing...', meetingId });

    const job = new AbortController();
    this.activeJobs.add(job);
    if (this.pendingCancel) { this.pendingCancel = false; job.abort(); } // cancelled during capture teardown
    try {
      // Read fresh settings so model changes take effect without restart
      const currentSettings = loadSettings(this.dataDir);

      const t0 = Date.now();
      this.timeLog(`meeting ${meetingId} — ${durationSec}s audio, ${captureResult.isStereo ? 'stereo' : 'mono'}, engine=${currentSettings.transcriptionEngine}`);

      // Preprocess audio (silence removal + volume normalization) before upload.
      // processPath equals audioPath on failure — preprocessAudio handles its own cleanup.
      const processPath = await preprocessAudio(
        audioPath, meetingId, this.dataDir, captureResult.isStereo ? 2 : 1, job.signal,
      );

      let segments;
      try {
        segments = await this.runTranscription(
          processPath, meetingId, currentSettings, participants,
          (phase) => {
            this.win?.webContents.send('processing:progress', { phase, meetingId });
            this.timeLog(`  +${Math.round((Date.now() - t0) / 1000)}s ${phase}`);
          },
          job.signal,
        );
      } finally {
        // Always remove the temp preprocessed file; the original is handled by cleanupAudio.
        if (processPath !== audioPath && fs.existsSync(processPath)) {
          try { fs.unlinkSync(processPath); } catch { /* ignore */ }
        }
      }
      const elapsed = (Date.now() - t0) / 1000;
      this.timeLog(`  DONE in ${elapsed.toFixed(0)}s = ${(durationSec / Math.max(elapsed, 1)).toFixed(2)}x realtime, ${segments.length} segments`);

      // A cancel is only honored if something downstream throws on the signal.
      // Every step here can swallow it instead — an aborted upload returns an
      // empty result, the mic-pinning pass catches its own errors, preprocess
      // falls back — and the meeting would then be saved as if nothing
      // happened. Check the signal directly before anything is persisted.
      job.signal.throwIfAborted();

      if (captureResult.isStereo) {
        segments = await this.pinLocal(audioPath, segments, job.signal);
      }

      insertSegments(db, segments);
      this.trimDurationToSpeech(meetingId, segments);


      await this.generateSummary(meetingId, segments, currentSettings, job.signal);

      const meeting = getMeeting(db, meetingId)!;
      writeAgentHook(this.transcriptsDir(), meeting, segments);

      this.cleanupAudio(audioPath, currentSettings.keepRecordings);

      this.win?.webContents.send('processing:progress', { phase: 'done', meetingId });
      return meeting;
    } catch (err) {
      if (job.signal.aborted) {
        // User interrupted: discard the note entirely.
        this.discardMeeting(meetingId);
        if (audioPath && fs.existsSync(audioPath)) {
          try { fs.unlinkSync(audioPath); } catch { /* the rename may not have happened */ }
        }
        return null;
      }
      this.logError(meetingId, err);
      this.win?.webContents.send('processing:progress', { phase: 'error', meetingId, error: String(err) });
      throw err;
    } finally {
      this.activeJobs.delete(job);
    }
  }

  // The stored duration is wall time from arm to stop, which overstates the
  // meeting whenever recording outlived the talking (autostop's 2-minute wait,
  // or an app holding the mic open past the call). Once the transcript exists,
  // the last word's timestamp is the better clock — shrink to it, never grow.
  private trimDurationToSpeech(meetingId: string, segments: TranscriptSegment[]): void {
    const db = getDb();
    const speechEnd = speechExtentSec(segments);
    const stored = getMeeting(db, meetingId)?.durationSec ?? 0;
    if (speechEnd > 0 && speechEnd < stored) {
      updateMeeting(db, meetingId, { durationSec: speechEnd });
    }
  }

  // Interrupt in-progress transcriptions and discard the note(s).
  cancelProcessing(): void {
    if (this.activeJobs.size > 0) {
      for (const job of this.activeJobs) job.abort();
      return;
    }
    // stop() is still tearing down capture, so the job controller does not
    // exist yet — it aborts the moment it is created.
    if (this.stopInFlight || this.state.isRecording) {
      this.pendingCancel = true;
      return;
    }
    // Nothing is in flight: transcription already finished between the click
    // and this call. The button still means "throw this recording away", so
    // honor it rather than letting a race decide.
    if (this.discardableMeetingId) this.discardMeeting(this.discardableMeetingId);
  }

  private deadCaptureReason(): string | null {
    return this.deadCapture?.reason ?? null;
  }

  // End a recording whose capture died, at the moment it died.
  //
  // The alternative is what shipped: on 2026-08-05 the bundled ffmpeg had no
  // pulse input device, so it exited on its first line, wrote nothing, and —
  // because autostop is driven by silencedetect events parsed off that same
  // ffmpeg's stderr — could never fire. The app sat there claiming to record for
  // nearly five hours and only admitted otherwise when someone opened the window
  // and pressed stop. Nothing was lost that time because nothing was ever
  // captured, which is exactly the condition captureFailure() insists on before
  // it returns a reason.
  //
  // The window is raised rather than notified: this machine's desktop
  // notifications are switched off (memory `cinnamon-notifications-unreliable`),
  // and a message the user never sees is what produced the five hours.
  private async abortDeadCapture(meetingId: string, reason: string): Promise<void> {
    if (this.deadCapture?.meetingId === meetingId) return;
    this.deadCapture = { meetingId, reason };
    this.logError(meetingId, new Error(reason));

    const capture = this.capture;
    this.capture = null;
    this.state = { isRecording: false, meetingId: null, startedAt: null };
    // Throws here by design — a capture with no audio is what stop() reports as
    // an error. Called anyway for its teardown: on Linux it is what restores the
    // default sink and unloads the echo-cancel module, which has to happen
    // whether or not anything was recorded.
    try { await capture?.stop(); } catch { /* no audio, as established */ }

    this.discardMeeting(meetingId);
    this.win?.webContents.send('recording:failed', reason);
    raiseWindow(this.win, process.env.XDG_SESSION_TYPE === 'wayland');
  }

  // Remove a meeting and everything it left on disk, and tell the renderer.
  private discardMeeting(meetingId: string): void {
    if (this.discardableMeetingId === meetingId) this.discardableMeetingId = null;
    try {
      const db = getDb();
      deleteSegmentsByMeeting(db, meetingId);
      deleteMeeting(db, meetingId);
    } catch (err) {
      this.logError(meetingId, err);
    }
    removeMeetingArtifacts(this.dataDir, this.transcriptsDir(), meetingId);
    this.win?.webContents.send('processing:progress', { phase: 'cancelled', meetingId });
  }

  // Persist the real transcription error so failures are diagnosable after the fact.
  private logError(meetingId: string, err: unknown): void {
    const detail = err instanceof Error ? (err.stack ?? err.message) : String(err);
    const line = `[${new Date().toISOString()}] meeting ${meetingId}: ${detail}\n`;
    try { fs.appendFileSync(path.join(this.dataDir, 'transcription-errors.log'), line); } catch { /* ignore */ }
    console.error('[turingram]', line.trim());
    noteProblem(err instanceof Error ? err.message : String(err));
  }

  // Keep the audio when the user wants to re-transcribe with other models (or
  // debug); otherwise delete it — the transcript is the artifact.
  private cleanupAudio(audioPath: string, keep: boolean): void {
    if (process.env.TURINGRAM_DEBUG || keep) return;
    if (fs.existsSync(audioPath)) { try { fs.unlinkSync(audioPath); } catch { /* ignore */ } }
  }

  // Append a timing line to <dataDir>/transcription-timing.log so a real
  // transcription's wall-clock and per-phase timing can be reviewed afterward.
  private timeLog(line: string): void {
    const stamped = `[${new Date().toISOString()}] ${line}`;
    try { fs.appendFileSync(path.join(this.dataDir, 'transcription-timing.log'), `${stamped}\n`); } catch { /* ignore */ }
    if (process.env.TURINGRAM_DEBUG) console.error('[turingram timing]', stamped);
  }

  // Re-transcribe a meeting whose audio was retained (transcription failed or was
  // never run). Keeps the meeting + audio on failure so it can be retried again.
  async retryTranscription(meetingId: string): Promise<Meeting | null> {
    if (!SAFE_ID.test(meetingId)) return null;
    // Cancelling a re-transcription must never delete the meeting: it existed
    // before the retry and keeps its old transcript on failure.
    this.discardableMeetingId = null;
    const db = getDb();
    const audioPath = path.join(this.dataDir, 'recordings', `${meetingId}.wav`);
    if (!fs.existsSync(audioPath)) {
      this.win?.webContents.send('processing:progress', { phase: 'error', meetingId, error: 'No saved audio to retry — the recording is gone.' });
      return null;
    }

    const { channels, durationSec } = await probeAudio(audioPath);
    const job = new AbortController();
    this.activeJobs.add(job);
    this.win?.webContents.send('processing:progress', { phase: 'Transcribing...', meetingId });
    try {
      const currentSettings = loadSettings(this.dataDir);
      const t0 = Date.now();
      this.timeLog(`retry ${meetingId} — ${durationSec}s audio, ${channels >= 2 ? 'stereo' : 'mono'}, engine=${currentSettings.transcriptionEngine}`);

      // Preprocess audio (silence removal + volume normalization) before upload.
      // processPath equals audioPath on failure — preprocessAudio handles its own cleanup.
      const processPath = await preprocessAudio(
        audioPath, meetingId, this.dataDir, channels, job.signal,
      );

      let segments;
      try {
        segments = await this.runTranscription(
          processPath, meetingId, currentSettings, '',
          (phase) => {
            this.win?.webContents.send('processing:progress', { phase, meetingId });
            this.timeLog(`  +${Math.round((Date.now() - t0) / 1000)}s ${phase}`);
          },
          job.signal,
        );
      } finally {
        // Always remove the temp preprocessed file; the original is handled by cleanupAudio.
        if (processPath !== audioPath && fs.existsSync(processPath)) {
          try { fs.unlinkSync(processPath); } catch { /* ignore */ }
        }
      }
      const elapsed = (Date.now() - t0) / 1000;
      this.timeLog(`  DONE in ${elapsed.toFixed(0)}s = ${(durationSec / Math.max(elapsed, 1)).toFixed(2)}x realtime, ${segments.length} segments`);

      if (channels >= 2) {
        segments = await this.pinLocal(audioPath, segments, job.signal);
      }

      // Same reasoning as runStop: every step above can swallow an abort
      // (empty upload result, pinLocal catches its own errors), and here the
      // stakes are higher — persisting would first DELETE the existing
      // transcript the retry was supposed to leave untouched on cancel.
      job.signal.throwIfAborted();

      deleteSegmentsByMeeting(db, meetingId); // replace any partial/empty result
      insertSegments(db, segments);
      this.trimDurationToSpeech(meetingId, segments);


      await this.generateSummary(meetingId, segments, currentSettings, job.signal);
      const meeting = getMeeting(db, meetingId)!;
      writeAgentHook(this.transcriptsDir(), meeting, segments);
      this.cleanupAudio(audioPath, currentSettings.keepRecordings);

      this.win?.webContents.send('processing:progress', { phase: 'done', meetingId });
      return meeting;
    } catch (err) {
      // Keep the audio + meeting so the user can retry again (or pick a faster model).
      const cancelled = job.signal.aborted;
      const phase = cancelled ? 'cancelled' : 'error';
      if (!cancelled) this.logError(meetingId, err);
      this.win?.webContents.send('processing:progress', { phase, meetingId, error: cancelled ? undefined : String(err) });
      return null;
    } finally {
      this.activeJobs.delete(job);
    }
  }

  // Best-effort teardown for app exit — stops capture and any transcription.
  async forceStop(): Promise<void> {
    this.pendingCancel = true;
    for (const job of this.activeJobs) job.abort();
    if (!this.state.isRecording || !this.capture) return;
    this.state = { isRecording: false, meetingId: null, startedAt: null };
    try { await this.capture.stop(); } catch { /* best effort */ } finally { this.capture = null; }
  }
}
