import React, { useState, useEffect, useRef } from 'react';
import type { Screen } from '../App';
import { useMeetings } from '../contexts/MeetingContext';
import AudioLevel from '../components/AudioLevel';

interface Props { onNavigate: (s: Screen) => void }

function pad(n: number) { return String(n).padStart(2, '0'); }

export default function ActiveRecording({ onNavigate }: Props) {
  const { stopRecording, cancelProcessing, processingMeetingId, processingPhase, processingError, clearProcessingError, recordingError, clearRecordingError, captureFailed, clearCaptureFailed } = useMeetings();
  const [notes, setNotes] = useState('');
  const [participants, setParticipants] = useState('');
  const [elapsed, setElapsed] = useState(0);
  const [stopping, setStopping] = useState(false);
  const [autoStopped, setAutoStopped] = useState(false);
  const startRef = useRef(Date.now());

  useEffect(() => {
    if (stopping) return;
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - startRef.current) / 1000)), 1000);
    return () => clearInterval(id);
  }, [stopping]);

  useEffect(() => {
    if (processingMeetingId && stopping) {
      // Autostop finishes the meeting in the main process without the notes the
      // user typed here — persist them before leaving the screen.
      const saveNotes = autoStopped && notes.trim()
        ? window.api.updateNotes(processingMeetingId, notes)
        : Promise.resolve();
      saveNotes.catch(() => { /* notes are best-effort at this point */ })
        .finally(() => onNavigate({ name: 'speakers', meetingId: processingMeetingId }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- notes/autoStopped deliberately not deps: fire once when processing completes
  }, [processingMeetingId, stopping, onNavigate]);

  useEffect(() => {
    const unsub = window.api.onRecordingAutostopped(() => {
      setAutoStopped(true);
      setStopping(true);
    });
    return unsub;
  }, []);

  async function handleStop() {
    setStopping(true);
    await stopRecording(notes, participants);
  }

  async function handleCancel() {
    await cancelProcessing();
    onNavigate({ name: 'list' });
  }

  function handleErrorDismiss() {
    clearProcessingError();
    onNavigate({ name: 'list' });
  }

  const h = Math.floor(elapsed / 3600);
  const m = Math.floor((elapsed % 3600) / 60);
  const s = elapsed % 60;
  const timer = h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;

  function handleCaptureFailureDismiss() {
    clearCaptureFailed();
    onNavigate({ name: 'list' });
  }

  // Read from context rather than subscribing here. The capture can die while
  // start() is still running, which is before this screen has mounted, so a
  // listener owned by this component would miss the only notice it gets.
  if (captureFailed) {
    return (
      <div className="flex flex-col h-screen bg-base items-center justify-center gap-5 px-8">
        <div className="text-[11px] font-medium text-danger uppercase tracking-widest">Recording failed</div>
        <div className="text-[12px] text-sub text-center max-w-xs leading-relaxed">{captureFailed}</div>
        <div className="text-[11px] text-muted text-center max-w-xs leading-relaxed">
          Nothing was recorded and the empty meeting has been removed.
        </div>
        <button onClick={handleCaptureFailureDismiss}
          className="text-[12px] bg-surface hover:bg-surface-hi border border-edge text-sub hover:text-hi px-4 py-2 rounded-md transition-colors">
          Back to meetings
        </button>
        <button onClick={() => void window.api.reportBug(captureFailed ?? undefined)}
          className="text-[11px] text-muted hover:text-sub underline underline-offset-2 transition-colors">
          Report this problem
        </button>
      </div>
    );
  }

  if (processingError && stopping) {
    return (
      <div className="flex flex-col h-screen bg-base items-center justify-center gap-5 px-8">
        <div className="text-[11px] font-medium text-danger uppercase tracking-widest">Transcription failed</div>
        <div className="text-[12px] text-sub text-center max-w-xs leading-relaxed">{processingError}</div>
        <button onClick={handleErrorDismiss}
          className="text-[12px] bg-surface hover:bg-surface-hi border border-edge text-sub hover:text-hi px-4 py-2 rounded-md transition-colors">
          Back to meetings
        </button>
        <button onClick={() => void window.api.reportBug(processingError ?? undefined)}
          className="text-[11px] text-muted hover:text-sub underline underline-offset-2 transition-colors">
          Report this problem
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-base">
      <header className="flex items-center justify-between px-4 py-3 border-b border-edge">
        <div className="flex items-center gap-3">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-celeste opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-celeste" />
          </span>
          <span className="font-display tabular text-2xl text-celeste tracking-tight">{timer}</span>
        </div>
        {stopping ? (
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-sub animate-pulse truncate max-w-[180px]">{processingPhase ?? 'Processing…'}</span>
            <button onClick={handleCancel}
              className="text-[11px] font-medium text-danger hover:opacity-80 px-2 py-1.5 transition-opacity shrink-0">
              Stop &amp; discard
            </button>
          </div>
        ) : (
          <button onClick={handleStop}
            className="text-[11px] font-medium bg-surface hover:bg-surface-hi border border-edge text-sub hover:text-hi px-3 py-1.5 rounded-md transition-colors">
            ■ Stop
          </button>
        )}
      </header>

      {recordingError && (
        <div className="flex items-center justify-between px-4 py-2 bg-surface border-b border-danger/40 text-[11px] text-danger">
          <span>Recording problem: {recordingError}</span>
          <button
            onClick={clearRecordingError}
            className="ml-4 text-muted hover:text-sub transition-colors shrink-0"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {autoStopped && (
        <div className="flex items-center justify-between px-4 py-2 bg-surface border-b border-edge text-[11px] text-sub">
          <span>Recording stopped — no audio detected for 2 minutes.</span>
          <button
            onClick={() => setAutoStopped(false)}
            className="ml-4 text-muted hover:text-sub transition-colors shrink-0"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      <div className="px-4 py-3 border-b border-edge-sub">
        <AudioLevel />
      </div>

      <div className="flex-1 flex flex-col px-4 py-4 gap-2">
        <div className="flex flex-col gap-1.5">
          <label className="text-[10px] font-semibold text-muted uppercase tracking-widest">
            Who&apos;s on this call?{' '}
            <span className="normal-case font-normal">(optional)</span>
          </label>
          <input
            type="text"
            value={participants}
            onChange={e => setParticipants(e.target.value)}
            disabled={stopping}
            placeholder="e.g. Mark, Sarah Lee"
            className="bg-surface border border-edge-sub rounded-lg px-3 py-2 text-[13px] text-hi placeholder:text-muted focus:outline-none focus:border-edge disabled:opacity-40 transition-colors"
          />
        </div>
        <label className="text-[10px] font-semibold text-muted uppercase tracking-widest">
          Notes{' '}
          <span className="normal-case font-normal">(optional)</span>
        </label>
        <textarea
          value={notes}
          onChange={e => setNotes(e.target.value)}
          disabled={stopping}
          placeholder="Jot key points while you listen…"
          className="flex-1 bg-surface border border-edge-sub rounded-lg p-3 text-[13px] text-hi placeholder:text-muted resize-none focus:outline-none focus:border-edge disabled:opacity-40 transition-colors leading-relaxed"
        />
        {/* Notes are not a scratchpad — summarize.ts tells the model to treat
            them as the spine of the summary and organize around them. That is a
            big behaviour to leave invisible, so the UI says it. */}
        <p className="text-[10px] text-muted leading-relaxed">
          Whatever you write here steers the summary — the model organizes around your
          notes instead of deciding for itself what mattered. Saved with the meeting
          and included in exports. Transcript appears when you stop.
        </p>
      </div>
    </div>
  );
}
