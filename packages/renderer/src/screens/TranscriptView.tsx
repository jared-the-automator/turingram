import React, { useEffect, useState, useRef } from 'react';
import type { Screen } from '../App';
import type { Meeting, TranscriptSegment } from '@turingyde/transcript-core';
import { useMeetings } from '../contexts/MeetingContext';
import SegmentList from '../components/SegmentList';

interface Props { meetingId: string; onNavigate: (s: Screen) => void }

export default function TranscriptView({ meetingId, onNavigate }: Props) {
  const { renameMeeting, deleteMeeting } = useMeetings();
  const [meeting, setMeeting] = useState<Meeting | null>(null);
  const [segments, setSegments] = useState<TranscriptSegment[]>([]);
  // Summary first: it is what the meeting was for. The transcript is the evidence
  // behind it, which is the second thing you want, not the first.
  const [tab, setTab] = useState<'summary' | 'transcript' | 'notes'>('summary');
  const [exporting, setExporting] = useState(false);
  const [exportPath, setExportPath] = useState<string | null>(null);
  const [exportFormat, setExportFormat] = useState<'md' | 'txt' | 'json' | 'srt'>('md');
  const [editingTitle, setEditingTitle] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [editingNotes, setEditingNotes] = useState(false);
  const [notes, setNotes] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  const [hasAudio, setHasAudio] = useState(false);
  const [copied, setCopied] = useState(false);
  const titleInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    window.api.getMeeting(meetingId).then(m => { setMeeting(m); setNotes(m?.notes ?? ''); });
    window.api.getSegments(meetingId).then(setSegments);
    window.api.hasAudio(meetingId).then(setHasAudio);
  }, [meetingId]);

  useEffect(() => { if (editingTitle) titleInputRef.current?.focus(); }, [editingTitle]);

  async function commitRename() {
    const trimmed = draftTitle.trim();
    if (trimmed && meeting && trimmed !== meeting.title) {
      await renameMeeting(meetingId, trimmed);
      setMeeting(m => m ? { ...m, title: trimmed } : m);
    }
    setEditingTitle(false);
  }

  async function handleDelete() {
    await deleteMeeting(meetingId);
    onNavigate({ name: 'list' });
  }

  async function handleRetry() {
    setRetrying(true);
    setRetryError(null);
    try {
      const m = await window.api.retryTranscription(meetingId);
      if (m) {
        setMeeting(m);
        setSegments(await window.api.getSegments(meetingId));
        setHasAudio(await window.api.hasAudio(meetingId));
      } else {
        setRetryError('Couldn’t transcribe — the saved audio may be gone, or the transcription service is unreachable. Check your connection and try again.');
      }
    } finally {
      setRetrying(false);
    }
  }

  async function handleExport() {
    setExporting(true);
    try { const p = await window.api.exportMeeting(meetingId, exportFormat); setExportPath(p); }
    finally { setExporting(false); }
  }

  async function saveNotes() {
    await window.api.updateNotes(meetingId, notes);
    setMeeting(m => m ? { ...m, notes } : m);
    setEditingNotes(false);
  }

  function handleCopyTranscript() {
    const text = segments.map(seg => {
      const h = Math.floor(seg.startTime / 3600);
      const m = Math.floor((seg.startTime % 3600) / 60);
      const s = Math.floor(seg.startTime % 60);
      const mmss = `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
      const ts = h > 0 ? `${h}:${mmss}` : mmss;
      return `${ts} ${seg.speakerLabel}\n${seg.text}`;
    }).join('\n\n');
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  if (!meeting) {
    return <div className="flex items-center justify-center h-screen text-sub text-[13px]">Loading…</div>;
  }

  const durationMin = Math.floor(meeting.durationSec / 60);
  const dateStr = new Date(meeting.startedAt).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });

  return (
    <div className="flex flex-col h-screen bg-base">
      <header className="flex items-center gap-3 px-4 py-3 border-b border-edge">
        <button onClick={() => onNavigate({ name: 'list' })}
          style={{ color: 'var(--color-base)' }}
          className="w-8 h-8 flex items-center justify-center bg-celeste hover:bg-celeste-hi rounded-md text-xl font-bold transition-colors shrink-0 leading-none">
          ←
        </button>
        <div className="flex-1 min-w-0">
          {editingTitle ? (
            <input ref={titleInputRef} value={draftTitle}
              onChange={e => setDraftTitle(e.target.value)}
              onBlur={commitRename}
              onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') setEditingTitle(false); }}
              className="w-full bg-surface-hi border border-celeste rounded px-2 py-0.5 text-[13px] font-medium text-hi focus:outline-none" />
          ) : (
            <button onClick={() => { setDraftTitle(meeting.title); setEditingTitle(true); }}
              className="text-left w-full hover:opacity-70 transition-opacity">
              <h2 className="text-[13px] font-semibold text-hi truncate">{meeting.title}</h2>
            </button>
          )}
          <p className="text-[11px] text-sub mt-px">{dateStr} · {durationMin < 1 ? '<1' : durationMin} min · {segments.length} segments</p>
        </div>
      </header>

      <div className="flex gap-5 px-4 border-b border-edge-sub">
        {(['summary', 'transcript', 'notes'] as const).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`text-[11px] font-medium py-2.5 border-b-2 capitalize transition-colors ${
              tab === t
                ? 'border-celeste text-hi'
                : 'border-transparent text-sub hover:text-hi'
            }`}>
            {t}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-5">
        {tab === 'summary' ? (
          <div className="flex flex-col gap-6">
            {meeting.summary ? (
              <div className="text-[13px] text-hi leading-relaxed whitespace-pre-wrap">{meeting.summary}</div>
            ) : (
              <p className="text-[13px] text-sub">
                {segments.length > 0
                  ? 'No summary for this meeting.'
                  : 'No summary yet — there is no transcript to summarize.'}
              </p>
            )}

            {meeting.actionItems.length > 0 && (
              <div className="flex flex-col gap-2">
                <h3 className="text-[10px] font-semibold text-muted uppercase tracking-widest">
                  Action items
                </h3>
                <ul className="flex flex-col gap-2">
                  {meeting.actionItems.map((item, i) => (
                    <li key={i} className="flex gap-2.5 items-baseline">
                      <span className="text-celeste text-[11px] shrink-0 leading-relaxed">▸</span>
                      <div className="min-w-0">
                        <div className="text-[13px] text-hi leading-relaxed">{item.text}</div>
                        {(item.owner || item.deadline) && (
                          <div className="text-[11px] text-sub mt-0.5">
                            {[item.owner, item.deadline].filter(Boolean).join(' · ')}
                          </div>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : tab === 'transcript' ? (
          segments.length > 0
            ? <SegmentList segments={segments} />
            : (
              <div className="flex flex-col items-start gap-3">
                <p className="text-[13px] text-sub">No transcript yet.</p>
                <button onClick={handleRetry} disabled={retrying}
                  className="text-[12px] font-medium bg-celeste hover:bg-celeste-hi disabled:opacity-40 text-base px-3 py-1.5 rounded-md transition-colors">
                  {retrying ? 'Transcribing…' : 'Retry transcription'}
                </button>
                {retrying && <p className="text-[11px] text-muted">This can take a while for a long meeting — you can leave this screen and come back.</p>}
                {retryError && <p className="text-[11px] text-danger max-w-sm leading-relaxed">{retryError}</p>}
              </div>
            )
        ) : (
          editingNotes ? (
            <div className="h-full flex flex-col gap-3">
              <textarea value={notes} onChange={e => setNotes(e.target.value)}
                className="flex-1 bg-surface border border-edge rounded-lg px-3 py-2.5 text-[13px] text-hi resize-none focus:outline-none focus:border-edge leading-relaxed" />
              <div className="flex gap-2 shrink-0">
                <button onClick={saveNotes}
                  className="text-[11px] font-medium bg-celeste hover:bg-celeste-hi text-base text-white px-3 py-1.5 rounded-md transition-colors">
                  Save
                </button>
                <button onClick={() => { setNotes(meeting.notes); setEditingNotes(false); }}
                  className="text-[11px] bg-surface hover:bg-surface-hi border border-edge text-sub px-3 py-1.5 rounded-md transition-colors">
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div>
              <pre className="text-[13px] text-hi whitespace-pre-wrap font-sans leading-relaxed mb-5 max-w-[65ch]">
                {meeting.notes || <span className="text-sub">No notes recorded.</span>}
              </pre>
              <button onClick={() => setEditingNotes(true)}
                className="text-[11px] text-sub hover:text-hi border border-edge-sub rounded px-2.5 py-1 transition-colors">
                Edit notes
              </button>
            </div>
          )
        )}
      </div>

      <div className="px-4 py-3 border-t border-edge flex items-center gap-2">
        <select
          value={exportFormat}
          onChange={e => setExportFormat(e.target.value as typeof exportFormat)}
          className="bg-surface border border-edge-sub rounded px-2 py-1 text-[11px] text-sub focus:outline-none focus:border-celeste transition-colors">
          <option value="md">Markdown</option>
          <option value="txt">Plain text</option>
          <option value="json">JSON</option>
          <option value="srt">SRT</option>
        </select>
        <button onClick={handleExport} disabled={exporting}
          className="text-[11px] text-sub hover:text-hi disabled:opacity-40 px-2.5 py-1 border border-edge-sub rounded transition-colors">
          {exporting ? 'Exporting…' : 'Export'}
        </button>

        {segments.length > 0 && (
          <button onClick={handleCopyTranscript}
            className="text-[11px] text-sub hover:text-hi px-2.5 py-1 border border-edge-sub rounded transition-colors">
            {copied ? 'Copied!' : 'Copy transcript'}
          </button>
        )}

        {hasAudio && segments.length > 0 && (
          <button onClick={handleRetry} disabled={retrying}
            title="Re-run transcription on the saved audio — picks up your current vocabulary list, and replaces this transcript"
            className="text-[11px] text-sub hover:text-hi disabled:opacity-40 px-2.5 py-1 border border-edge-sub rounded transition-colors">
            {retrying ? 'Re-transcribing…' : 'Re-transcribe'}
          </button>
        )}

        {confirmDelete ? (
          <div className="flex items-center gap-2 ml-1">
            <span className="text-[11px] text-sub">Delete this recording?</span>
            <button onClick={handleDelete} className="text-[11px] text-danger hover:opacity-80 px-2 py-1 transition-opacity">Delete</button>
            <button onClick={() => setConfirmDelete(false)} className="text-[11px] text-sub hover:text-hi px-2 py-1 transition-colors">Cancel</button>
          </div>
        ) : (
          <button onClick={() => setConfirmDelete(true)}
            className="text-[11px] text-sub hover:text-danger px-2.5 py-1 border border-edge-sub rounded transition-colors">
            Delete
          </button>
        )}

        {exportPath && (
          <div className="flex items-center gap-2 ml-auto min-w-0">
            <span className="text-[11px] text-celeste shrink-0">Saved to Downloads</span>
            <span className="text-[11px] text-sub truncate max-w-40" title={exportPath}>{exportPath.split('/').pop()}</span>
            <button onClick={() => window.api.revealFile(exportPath)}
              className="text-[11px] text-sub hover:text-hi px-2 py-0.5 border border-edge-sub rounded transition-colors shrink-0">
              Show
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
