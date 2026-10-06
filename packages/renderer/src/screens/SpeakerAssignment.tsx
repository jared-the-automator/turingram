import React, { useEffect, useState } from 'react';
import type { Screen } from '../App';

interface Props { meetingId: string; onNavigate: (s: Screen) => void }

export default function SpeakerAssignment({ meetingId, onNavigate }: Props) {
  const [speakerLabels, setSpeakerLabels] = useState<string[]>([]);
  const [names, setNames] = useState<Record<string, string>>({});
  const [title, setTitle] = useState('');
  const [initialTitle, setInitialTitle] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    window.api.getSegments(meetingId).then(segments => {
      const unique = [...new Set(segments.map(s => s.speakerLabel))];
      setSpeakerLabels(unique);
      setNames(Object.fromEntries(unique.map(l => [l, ''])));
    });
    window.api.getMeeting(meetingId).then(m => {
      if (m) { setTitle(m.title); setInitialTitle(m.title); }
    });
  }, [meetingId]);

  async function handleSave() {
    setSaving(true);
    const t = title.trim();
    if (t && t !== initialTitle) await window.api.renameMeeting(meetingId, t);
    const map: Record<string, string> = {};
    for (const [label, name] of Object.entries(names)) {
      if (name.trim()) map[label] = name.trim();
    }
    if (Object.keys(map).length > 0) await window.api.assignSpeakers(meetingId, map);
    onNavigate({ name: 'transcript', meetingId });
  }

  return (
    <div className="flex flex-col h-screen bg-base">
      <header className="px-4 py-3 border-b border-edge flex items-center justify-between">
        <div>
          <h2 className="text-[13px] font-semibold text-hi">Name this meeting</h2>
          <p className="text-[11px] text-sub mt-px">Optional — rename the meeting and label its speakers</p>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-6">
        <div className="flex flex-col gap-5 max-w-sm">
          <div>
            <label className="block text-[10px] font-semibold text-muted uppercase tracking-widest mb-1.5">
              Meeting name
            </label>
            <input
              value={title}
              onChange={e => setTitle(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSave(); }}
              placeholder="Meeting name…"
              className="w-full bg-surface border border-edge-sub rounded-md px-3 py-2 text-[13px] text-hi placeholder:text-muted focus:outline-none focus:border-celeste transition-colors"
            />
          </div>

          {speakerLabels.length === 0 ? (
            <p className="text-[13px] text-sub">No speaker tracks found.</p>
          ) : (
            speakerLabels.map(label => (
              <div key={label}>
                <label className="block text-[10px] font-semibold text-muted uppercase tracking-widest mb-1.5">
                  {label}
                </label>
                <input
                  value={names[label] ?? ''}
                  onChange={e => setNames(n => ({ ...n, [label]: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') handleSave(); }}
                  placeholder="Enter name…"
                  className="w-full bg-surface border border-edge-sub rounded-md px-3 py-2 text-[13px] text-hi placeholder:text-muted focus:outline-none focus:border-celeste transition-colors"
                />
              </div>
            ))
          )}
        </div>
      </div>

      <div className="px-4 py-4 border-t border-edge flex gap-3">
        <button onClick={handleSave} disabled={saving}
          className="flex-1 bg-celeste hover:bg-celeste-hi disabled:opacity-40 text-base font-semibold text-[12px] font-medium py-2.5 rounded-md transition-colors">
          {saving ? 'Saving…' : 'Save & View Transcript'}
        </button>
        <button onClick={() => onNavigate({ name: 'transcript', meetingId })}
          className="px-5 bg-surface hover:bg-surface-hi border border-edge text-sub text-[12px] py-2.5 rounded-md transition-colors">
          Discard
        </button>
      </div>
    </div>
  );
}
