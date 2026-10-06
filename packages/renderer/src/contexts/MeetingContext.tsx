import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import type { Meeting } from '@turingyde/transcript-core';

interface SearchResult {
  segmentId: string; meetingId: string; meetingTitle: string;
  meetingStartedAt: number; text: string; snippet: string;
}

interface MeetingContextValue {
  meetings: Meeting[]
  isRecording: boolean
  processingMeetingId: string | null
  processingPhase: string | null
  processingError: string | null
  recordingError: string | null
  // The capture never opened a device, or it died before anything was written.
  // Distinct from recordingError, which is a problem the recording survived:
  // this one means there is no recording and the meeting has been thrown away.
  captureFailed: string | null
  clearRecordingError: () => void
  clearProcessingError: () => void
  clearCaptureFailed: () => void
  refresh: () => Promise<void>
  startRecording: (title?: string) => Promise<void>
  // Route a record request through the consent reminder. `proceed` runs after the
  // recording actually starts (used to navigate to the recording screen).
  requestRecording: (title: string | undefined, proceed: () => void) => void
  pendingRecord: { title?: string; proceed: () => void } | null
  clearPendingRecord: () => void
  stopRecording: (notes: string, participants?: string) => Promise<void>
  cancelProcessing: () => Promise<void>
  renameMeeting: (id: string, title: string) => Promise<void>
  deleteMeeting: (id: string) => Promise<void>
  deleteMeetings: (ids: string[]) => Promise<void>
  searchResults: SearchResult[] | null
  search: (query: string) => Promise<void>
  clearSearch: () => void
}

const MeetingContext = createContext<MeetingContextValue | null>(null);

export function MeetingProvider({ children }: { children: React.ReactNode }) {
  const [meetings, setMeetings] = useState<Meeting[]>([]);
  const [isRecording, setIsRecording] = useState(false);
  const [processingMeetingId, setProcessingMeetingId] = useState<string | null>(null);
  const [processingPhase, setProcessingPhase] = useState<string | null>(null);
  const [processingError, setProcessingError] = useState<string | null>(null);
  const [recordingError, setRecordingError] = useState<string | null>(null);
  const [captureFailed, setCaptureFailed] = useState<string | null>(null);
  const [searchResults, setSearchResults] = useState<SearchResult[] | null>(null);
  const [pendingRecord, setPendingRecord] = useState<{ title?: string; proceed: () => void } | null>(null);

  const refresh = useCallback(async () => {
    setMeetings(await window.api.listMeetings());
  }, []);

  useEffect(() => {
    refresh();
    window.api.getRecordingState().then(s => setIsRecording(s.isRecording));
    const unsub = window.api.onProcessingProgress(data => {
      setProcessingPhase(data.phase);
      if (data.phase === 'done' && data.meetingId) {
        setProcessingMeetingId(data.meetingId);
        setProcessingPhase(null);
        refresh();
      } else if (data.phase === 'error') {
        setProcessingError(data.error ?? 'Transcription failed');
        setProcessingPhase(null);
        refresh();
      } else if (data.phase === 'cancelled') {
        setProcessingPhase(null);
        refresh();
      }
    });
    // Capture failures mid-recording (mic unplugged, ffmpeg died) used to be
    // emitted into the void — surface them.
    const unsubErr = window.api.onRecordingError(message => {
      setRecordingError(message);
    });
    // The capture died and the main process has already ended the recording and
    // thrown the empty meeting away. Get this side out of the recording state it
    // is still displaying, or the timer keeps counting up over nothing.
    const unsubFailed = window.api.onRecordingFailed(message => {
      setIsRecording(false);
      setProcessingPhase(null);
      setCaptureFailed(message);
      refresh();
    });
    return () => { unsub(); unsubErr(); unsubFailed(); };
  }, [refresh]);

  // An optional title lets auto-detect name the meeting up front (from the call
  // window's title) instead of the default "Meeting HH:MM".
  const startRecording = useCallback(async (title?: string) => {
    setProcessingMeetingId(null);
    setProcessingError(null);
    setCaptureFailed(null);
    let id: string;
    try {
      id = await window.api.startRecording();
    } catch (err) {
      // A capture that dies inside start() throws here rather than arriving on
      // the recording:failed channel, and this is the only place that can catch
      // it: the consent modal renders nothing at all once the reminder has been
      // dismissed, so there is no dialog left to show it in. Turn it into state
      // the recording screen can render, and leave isRecording false.
      setCaptureFailed(String(err instanceof Error ? err.message : err));
      return;
    }
    if (title && id) await window.api.renameMeeting(id, title);
    setIsRecording(true);
  }, []);

  // Entry point for both the manual "New Meeting" button and the auto-detect
  // prompt. It parks the request as pendingRecord; the consent modal decides
  // whether to show the reminder or start immediately (when the user has
  // dismissed it), then proceed() navigates to the recording screen.
  const requestRecording = useCallback((title: string | undefined, proceed: () => void) => {
    setPendingRecord({ title, proceed });
  }, []);
  const clearPendingRecord = useCallback(() => setPendingRecord(null), []);

  const stopRecording = useCallback(async (notes: string, participants = '') => {
    setIsRecording(false);
    await window.api.stopRecording(notes, participants);
  }, []);

  const cancelProcessing = useCallback(async () => {
    await window.api.cancelProcessing();
  }, []);

  const renameMeeting = useCallback(async (id: string, title: string) => {
    await window.api.renameMeeting(id, title);
    await refresh();
  }, [refresh]);

  const deleteMeeting = useCallback(async (id: string) => {
    await window.api.deleteMeeting(id);
    await refresh();
  }, [refresh]);

  const deleteMeetings = useCallback(async (ids: string[]) => {
    for (const id of ids) await window.api.deleteMeeting(id);
    await refresh();
  }, [refresh]);

  // Queries resolve out of order while the user types ("meet" can come back
  // after "meeting"); only the latest request may set state, or the results
  // flash back to a stale, shorter query.
  const searchSeq = useRef(0);
  const search = useCallback(async (query: string) => {
    const seq = ++searchSeq.current;
    if (!query.trim()) { setSearchResults(null); return; }
    const results = await window.api.searchMeetings(query);
    if (seq === searchSeq.current) setSearchResults(results);
  }, []);

  const clearSearch = useCallback(() => { searchSeq.current++; setSearchResults(null); }, []);
  const clearProcessingError = useCallback(() => setProcessingError(null), []);
  const clearRecordingError = useCallback(() => setRecordingError(null), []);
  const clearCaptureFailed = useCallback(() => setCaptureFailed(null), []);

  return (
    <MeetingContext.Provider value={{
      meetings, isRecording, processingMeetingId, processingPhase,
      processingError, clearProcessingError,
      recordingError, clearRecordingError,
      captureFailed, clearCaptureFailed,
      refresh, startRecording, requestRecording, pendingRecord, clearPendingRecord,
      stopRecording, cancelProcessing, renameMeeting, deleteMeeting, deleteMeetings,
      searchResults, search, clearSearch,
    }}>
      {children}
    </MeetingContext.Provider>
  );
}

export function useMeetings(): MeetingContextValue {
  const ctx = useContext(MeetingContext);
  if (!ctx) throw new Error('useMeetings must be inside MeetingProvider');
  return ctx;
}
