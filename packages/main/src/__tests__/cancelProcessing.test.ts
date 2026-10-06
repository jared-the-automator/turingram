import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { getDb, closeDb } from '../db/client';
import { insertMeeting, getMeeting } from '../db/meetings';
import { insertSegments } from '../db/segments';
import { RecordingPipeline } from '../stt/pipeline';
import { DEFAULT_SETTINGS } from '@turingyde/transcript-core';

// Skip the real ffmpeg pass so the mocked-retry test below reaches persistence.
vi.mock('../stt/preprocess', () => ({
  preprocessAudio: vi.fn(async (audioPath: string) => audioPath),
}));

// "Stop & discard" used to be honored only if an abort could still interrupt a
// running job. A 15-second recording transcribes in about a second, so the
// click routinely landed after the pipeline had already finished — and the
// recording the user asked to throw away was saved instead.
describe('RecordingPipeline.cancelProcessing after processing finished', () => {
  let dir: string;
  let pipeline: RecordingPipeline;
  const id = 'ffffffff-1111-2222-3333-444444444444';

  const hookName = '2023-11-14-meeting-14-03-1213-1213.json';

  const seedMeeting = () => {
    const db = getDb();
    insertMeeting(db, {
      id, title: 'Meeting 14:03', startedAt: 1_700_000_000_000,
      endedAt: 1_700_000_016_000, durationSec: 16, notes: '',
      summary: null, actionItems: [],
    });
    insertSegments(db, [{
      id: 's1', meetingId: id, speakerLabel: 'You',
      startTime: 0, endTime: 3, text: 'testing one two',
    }]);
    mkdirSync(path.join(dir, 'recordings'), { recursive: true });
    mkdirSync(path.join(dir, 'transcripts'), { recursive: true });
    writeFileSync(path.join(dir, 'recordings', `${id}.wav`), 'audio');
    // Named the way the app names them, with the id inside — that id, not the
    // filename, is what discarding matches on.
    writeFileSync(path.join(dir, 'transcripts', hookName), JSON.stringify({
      id, title: 'Meeting 14:03', startedAt: 1_700_000_000_000, durationSec: 16, segments: [],
    }));
  };

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'te-cancel-'));
    getDb(path.join(dir, 'meetings.db'));
    pipeline = new RecordingPipeline(dir, { ...DEFAULT_SETTINGS }, null);
  });
  afterEach(() => { closeDb(); rmSync(dir, { recursive: true, force: true }); });

  // The pipeline only knows the meeting is discardable if it started it, so the
  // test drives the same private state start() sets.
  const markDiscardable = () => {
    (pipeline as unknown as { discardableMeetingId: string | null }).discardableMeetingId = id;
  };

  it('discards the meeting the recording produced', () => {
    seedMeeting();
    markDiscardable();
    pipeline.cancelProcessing();
    expect(getMeeting(getDb(), id)).toBeFalsy();
  });

  it('takes the audio and transcript JSON with it', () => {
    seedMeeting();
    markDiscardable();
    pipeline.cancelProcessing();
    expect(existsSync(path.join(dir, 'recordings', `${id}.wav`))).toBe(false);
    expect(existsSync(path.join(dir, 'transcripts', hookName))).toBe(false);
  });

  it('tells the renderer the recording was cancelled', () => {
    seedMeeting();
    const send = vi.fn();
    const win = { webContents: { send } } as unknown as Parameters<typeof RecordingPipeline.prototype.constructor>[2];
    pipeline = new RecordingPipeline(dir, { ...DEFAULT_SETTINGS }, win as never);
    markDiscardable();
    pipeline.cancelProcessing();
    expect(send).toHaveBeenCalledWith('processing:progress', { phase: 'cancelled', meetingId: id });
  });

  it('discards only once — a second click cannot delete the next meeting', () => {
    seedMeeting();
    markDiscardable();
    pipeline.cancelProcessing();
    seedMeeting(); // a fresh recording lands under the same id
    pipeline.cancelProcessing();
    expect(getMeeting(getDb(), id)).toBeTruthy();
  });

  // Cancelling a re-transcription must leave the existing meeting alone: it was
  // not created by this round and still holds its previous transcript.
  it('will not discard a meeting that is only being re-transcribed', async () => {
    seedMeeting();
    markDiscardable();
    await pipeline.retryTranscription(id); // no audio pipeline runs; clears the flag
    pipeline.cancelProcessing();
    expect(getMeeting(getDb(), id)).toBeTruthy();
  });

  // Every step of the retry can swallow an abort (an aborted upload returns
  // empty, pinLocal catches its own errors). If the cancel lands mid-flight and
  // nothing throws, the retry used to fall through and DELETE the existing
  // transcript before replacing it with the aborted run's output.
  it('keeps the old transcript when a cancel is swallowed mid-retry', async () => {
    seedMeeting();
    // Stand in for a transcription during which the user clicks cancel and no
    // downstream step surfaces the abort.
    vi.spyOn(pipeline as never as { runTranscription: () => unknown }, 'runTranscription')
      .mockImplementation(async () => {
        pipeline.cancelProcessing();
        return [{ id: 'aborted-run', meetingId: id, speakerLabel: 'Speaker 0', startTime: 0, endTime: 1, text: 'partial' }];
      });
    const result = await pipeline.retryTranscription(id);
    expect(result).toBeNull();
    const db = getDb();
    const rows = db.prepare('SELECT id FROM segments WHERE meeting_id = ?').all(id) as { id: string }[];
    expect(rows.map(r => r.id)).toEqual(['s1']); // original transcript untouched
  });
});
