import React, { useEffect, useState } from 'react';
import type { Screen } from '../App';
import { useMeetings } from '../contexts/MeetingContext';

interface Detected { app: string; title: string }
interface Props { onNavigate: (s: Screen) => void }

// A prompt — never an automatic recording. When the main process detects a
// conferencing app on the mic it sends 'meeting:detected'; this offers Start /
// Ignore. Start is the only path that ever arms the recorder.
export default function MeetingToast({ onNavigate }: Props) {
  const { requestRecording, isRecording } = useMeetings();
  const [detected, setDetected] = useState<Detected | null>(null);

  useEffect(() => {
    return window.api.onMeetingDetected((c) => setDetected(c));
  }, []);

  // If a recording is already running (e.g. the user hit Start), drop any
  // pending prompt — there is nothing to offer.
  useEffect(() => { if (isRecording) setDetected(null); }, [isRecording]);

  if (!detected || isRecording) return null;

  function accept() {
    const d = detected!;
    setDetected(null);
    // Consent gate first; it navigates to the recording screen once started.
    requestRecording(d.title, () => onNavigate({ name: 'recording' }));
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 w-80 max-w-[calc(100vw-2rem)] animate-[fadeIn_0.15s_ease-out]">
      <div className="bg-surface-hi border border-edge rounded-xl shadow-lg shadow-black/30 p-4 flex flex-col gap-3">
        <div className="flex items-start gap-2">
          <span className="mt-0.5 shrink-0 w-2 h-2 rounded-full bg-celeste animate-pulse" />
          <div className="min-w-0">
            <div className="text-[12px] font-medium text-hi">You're in a {detected.app} call</div>
            <div className="text-[11px] text-sub truncate">{detected.title}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 justify-end">
          <button onClick={() => setDetected(null)}
            className="text-[11px] text-sub hover:text-hi px-2.5 py-1.5 transition-colors">
            Ignore
          </button>
          <button onClick={accept}
            style={{ color: 'var(--color-base)' }}
            className="text-[11px] font-semibold bg-celeste hover:bg-celeste-hi px-3 py-1.5 rounded-md transition-colors">
            Record it
          </button>
        </div>
      </div>
    </div>
  );
}
