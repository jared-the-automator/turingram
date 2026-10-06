import React, { useState, useRef, useEffect } from 'react';
import TuringramLogo from '../components/TuringramLogo';
import type { Screen } from '../App';
import { useMeetings } from '../contexts/MeetingContext';
import { useSettings } from '../contexts/SettingsContext';
import type { Meeting } from '@turingyde/transcript-core';

interface Props { onNavigate: (s: Screen) => void }

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  return m < 1 ? '<1 min' : `${m} min`;
}

function groupByDate(meetings: Meeting[]): Record<string, Meeting[]> {
  const today = new Date().toDateString();
  const yesterday = new Date(Date.now() - 86_400_000).toDateString();
  const groups: Record<string, Meeting[]> = {};
  for (const m of meetings) {
    const d = new Date(m.startedAt).toDateString();
    const label = d === today ? 'Today' : d === yesterday ? 'Yesterday' : new Date(m.startedAt).toLocaleDateString();
    if (!groups[label]) groups[label] = [];
    groups[label].push(m);
  }
  return groups;
}

function parseSnippet(snippet: string): React.ReactNode[] {
  const parts = snippet.split(/<mark>|<\/mark>/);
  return parts.map((part, i) =>
    i % 2 === 1
      ? <mark key={i} className="bg-celeste/20 text-celeste rounded-[2px] px-0.5">{part}</mark>
      : <span key={i}>{part}</span>
  );
}

interface MeetingRowProps {
  meeting: Meeting;
  onOpen: () => void;
  onRename: (title: string) => Promise<void>;
  onDelete: () => Promise<void>;
  confirmBeforeDelete: boolean;
  selectionMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
}

function MeetingRow({ meeting, onOpen, onRename, onDelete, confirmBeforeDelete, selectionMode, selected, onToggleSelect }: MeetingRowProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [draftTitle, setDraftTitle] = useState(meeting.title);
  const inputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => { if (renaming) inputRef.current?.focus(); }, [renaming]);

  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpen]);

  async function commitRename() {
    const trimmed = draftTitle.trim();
    if (trimmed && trimmed !== meeting.title) await onRename(trimmed);
    else setDraftTitle(meeting.title);
    setRenaming(false);
  }

  if (confirmDelete) {
    return (
      <div className="px-4 py-3 border-b border-edge-sub flex items-center gap-3 bg-surface">
        <span className="text-xs text-sub flex-1 truncate">Delete "{meeting.title}"?</span>
        <button onClick={() => onDelete()} className="text-xs text-danger hover:opacity-80 px-2 py-1 transition-opacity">Delete</button>
        <button onClick={() => setConfirmDelete(false)} className="text-xs text-muted hover:text-sub px-2 py-1 transition-colors">Cancel</button>
      </div>
    );
  }

  if (selectionMode) {
    return (
      <button onClick={onToggleSelect}
        className="w-full border-b border-edge-sub flex items-center gap-3 px-4 py-3 text-left hover:bg-surface transition-colors">
        <input type="checkbox" checked={selected} readOnly
          className="accent-celeste shrink-0 w-4 h-4 pointer-events-none" />
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-medium text-hi truncate leading-snug">{meeting.title}</div>
          <div className="text-[11px] text-sub mt-0.5 tabular">
            {new Date(meeting.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            {meeting.durationSec > 0 && <> · {formatDuration(meeting.durationSec)}</>}
          </div>
        </div>
      </button>
    );
  }

  return (
    <div className="border-b border-edge-sub flex items-stretch group hover:bg-surface transition-colors duration-100">
      {renaming ? (
        <div className="flex-1 px-4 py-2.5 flex items-center">
          <input ref={inputRef} value={draftTitle}
            onChange={e => setDraftTitle(e.target.value)}
            onBlur={commitRename}
            onKeyDown={e => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') { setDraftTitle(meeting.title); setRenaming(false); } }}
            className="flex-1 bg-surface-hi border border-celeste rounded px-2.5 py-1 text-[13px] text-hi focus:outline-none" />
        </div>
      ) : (
        <button onClick={onOpen} className="flex-1 text-left px-4 py-3 flex items-center gap-3 min-w-0">
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-medium text-hi truncate leading-snug">{meeting.title}</div>
            <div className="text-[11px] text-sub mt-0.5 tabular">
              {new Date(meeting.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              {meeting.durationSec > 0 && <> · {formatDuration(meeting.durationSec)}</>}
            </div>
          </div>
        </button>
      )}

      <div ref={menuRef} className="relative flex items-center px-2">
        <button onClick={() => setMenuOpen(o => !o)}
          className="w-6 h-6 flex items-center justify-center text-muted hover:text-sub opacity-0 group-hover:opacity-100 transition-all duration-100 rounded text-base leading-none">
          ⋯
        </button>
        {menuOpen && (
          <div className="absolute right-0 top-7 z-10 bg-surface-hi border border-edge rounded-md shadow-xl py-1 min-w-32">
            <button onClick={() => { setMenuOpen(false); setRenaming(true); setDraftTitle(meeting.title); }}
              className="w-full text-left px-3 py-1.5 text-[12px] text-sub hover:text-hi hover:bg-surface transition-colors">
              Rename
            </button>
            <button onClick={() => { setMenuOpen(false); if (confirmBeforeDelete) setConfirmDelete(true); else onDelete(); }}
              className="w-full text-left px-3 py-1.5 text-[12px] text-danger hover:bg-surface transition-colors">
              Delete
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function MeetingList({ onNavigate }: Props) {
  const { meetings, isRecording, processingMeetingId, processingPhase, cancelProcessing, requestRecording, search, clearSearch, searchResults, renameMeeting, deleteMeeting, deleteMeetings } = useMeetings();
  const { settings } = useSettings();
  const confirmBeforeDelete = settings?.confirmBeforeDelete ?? true;
  const [query, setQuery] = useState('');
  const [selectionMode, setSelectionMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkConfirm, setBulkConfirm] = useState(false);

  function exitSelection() {
    setSelectionMode(false);
    setSelected(new Set());
    setBulkConfirm(false);
  }

  function toggleSelect(id: string) {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // Search is hidden in selection mode, so the visible list is always `meetings`
  // — select-all can never quietly select rows that are filtered out of view.
  const allSelected = meetings.length > 0 && selected.size === meetings.length;

  function toggleSelectAll() {
    setSelected(allSelected ? new Set() : new Set(meetings.map(m => m.id)));
  }

  async function runBulkDelete() {
    await deleteMeetings([...selected]);
    exitSelection();
  }

  function requestBulkDelete() {
    if (selected.size === 0) return;
    if (confirmBeforeDelete) setBulkConfirm(true);
    else runBulkDelete();
  }

  async function handleQueryChange(e: React.ChangeEvent<HTMLInputElement>) {
    setQuery(e.target.value);
    if (e.target.value) await search(e.target.value); else clearSearch();
  }

  function handleNewMeeting() {
    // Goes through the consent gate; it navigates once recording actually starts.
    requestRecording(undefined, () => onNavigate({ name: 'recording' }));
  }

  const groups = groupByDate(meetings);

  return (
    <div className="flex flex-col h-screen bg-base">
      <header className="flex items-center justify-between px-4 py-3 border-b border-edge">
        <div className="flex items-center gap-2">
          <TuringramLogo size={20} />
          <span className="font-display text-[13px] tracking-wide text-celeste">Turingram</span>
        </div>
        <div className="flex items-center gap-2">
          {selectionMode ? (
            <button onClick={exitSelection}
              className="text-[11px] text-sub hover:text-hi px-2 py-1 transition-colors">
              Done
            </button>
          ) : (
            <>
              {meetings.length > 0 && (
                <button onClick={() => setSelectionMode(true)}
                  className="text-[11px] text-sub hover:text-hi px-2 py-1 transition-colors">
                  Select
                </button>
              )}
              <button onClick={() => onNavigate({ name: 'settings' })}
                className="text-[11px] text-sub hover:text-hi px-2 py-1 transition-colors">
                Settings
              </button>
              <button onClick={handleNewMeeting} disabled={isRecording}
                className="text-[11px] font-medium bg-celeste hover:bg-celeste-hi disabled:opacity-40 text-base px-3 py-1.5 rounded-md transition-colors font-semibold">
                {isRecording ? '● Recording' : '+ New Meeting'}
              </button>
            </>
          )}
        </div>
      </header>

      {selectionMode && (
        <div className="px-4 py-2 border-b border-edge-sub flex items-center gap-3 bg-surface">
          {bulkConfirm ? (
            <>
              <span className="text-[12px] text-sub flex-1">Delete {selected.size} meeting{selected.size !== 1 ? 's' : ''}?</span>
              <button onClick={runBulkDelete} className="text-[12px] text-danger hover:opacity-80 px-2 py-1 transition-opacity">Delete</button>
              <button onClick={() => setBulkConfirm(false)} className="text-[12px] text-muted hover:text-sub px-2 py-1 transition-colors">Cancel</button>
            </>
          ) : (
            <>
              <span className="text-[12px] text-sub flex-1">{selected.size} selected</span>
              <button onClick={toggleSelectAll}
                className="text-[12px] text-sub hover:text-hi px-2 py-1 transition-colors">
                {allSelected ? 'Deselect all' : `Select all${meetings.length ? ` (${meetings.length})` : ''}`}
              </button>
              <button onClick={requestBulkDelete} disabled={selected.size === 0}
                className="text-[12px] text-danger hover:opacity-80 disabled:opacity-30 px-2 py-1 transition-opacity">
                Delete selected
              </button>
            </>
          )}
        </div>
      )}

      {!selectionMode && (
        <div className="px-4 py-2.5 border-b border-edge-sub">
          <input value={query} onChange={handleQueryChange}
            placeholder="Search transcripts..."
            className="w-full bg-surface border border-edge-sub rounded-md px-3 py-1.5 text-[12px] text-hi placeholder:text-muted focus:outline-none focus:border-edge transition-colors" />
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {searchResults && !selectionMode ? (
          <div>
            <div className="px-4 py-2 text-[10px] font-medium text-muted uppercase tracking-widest border-b border-edge-sub">
              {searchResults.length} result{searchResults.length !== 1 ? 's' : ''}
            </div>
            {searchResults.map(r => (
              <button key={r.segmentId}
                onClick={() => onNavigate({ name: 'transcript', meetingId: r.meetingId })}
                className="w-full text-left px-4 py-3 hover:bg-surface border-b border-edge-sub transition-colors">
                <div className="text-[11px] text-sub mb-1">{r.meetingTitle} · {new Date(r.meetingStartedAt).toLocaleDateString()}</div>
                <div className="text-[13px] text-hi leading-relaxed">{parseSnippet(r.snippet)}</div>
              </button>
            ))}
          </div>
        ) : (
          <div>
            {processingPhase && (
              <div className="px-4 py-3 border-b border-edge-sub flex items-center gap-3">
                <span className="animate-pulse text-[12px] text-sub flex-1 truncate">{processingPhase}</span>
                <button onClick={() => cancelProcessing()}
                  className="text-[11px] text-danger hover:opacity-80 px-2 py-1 transition-opacity shrink-0">
                  Stop &amp; discard
                </button>
              </div>
            )}
            {Object.entries(groups).map(([label, group]) => (
              <div key={label}>
                <div className="px-4 pt-4 pb-1.5 text-[10px] font-semibold text-muted uppercase tracking-widest">{label}</div>
                {group.map(m => (
                  <MeetingRow key={m.id} meeting={m}
                    onOpen={() => onNavigate({ name: 'transcript', meetingId: m.id })}
                    onRename={title => renameMeeting(m.id, title)}
                    onDelete={() => deleteMeeting(m.id)}
                    confirmBeforeDelete={confirmBeforeDelete}
                    selectionMode={selectionMode}
                    selected={selected.has(m.id)}
                    onToggleSelect={() => toggleSelect(m.id)} />
                ))}
              </div>
            ))}
            {meetings.length === 0 && !processingMeetingId && (
              <div className="px-4 py-16 text-center">
                <p className="text-[13px] text-sub">No recordings yet.</p>
                <p className="text-[11px] text-muted mt-1">Hit New Meeting to start.</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
