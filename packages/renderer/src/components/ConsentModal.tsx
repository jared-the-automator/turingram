import React, { useEffect, useState } from 'react';
import { useMeetings } from '../contexts/MeetingContext';
import { useSettings } from '../contexts/SettingsContext';

// The recording-consent gate. Every record request — the manual button and the
// auto-detect prompt — parks itself as pendingRecord; this component decides
// whether to show the reminder or start immediately (once the user has dismissed
// it). Dismissing requires ticking an acknowledgment that couples "don't remind
// me" with accepting responsibility for consent laws, so the opt-out is informed.
export default function ConsentModal() {
  const { pendingRecord, clearPendingRecord, startRecording } = useMeetings();
  const { settings, updateSettings } = useSettings();
  const [dontRemind, setDontRemind] = useState(false);
  const [ack, setAck] = useState(false);
  const [busy, setBusy] = useState(false);

  const dismissed = settings?.consentReminderDismissed ?? false;

  // Reset the checkboxes each time a fresh request opens the modal.
  useEffect(() => { if (pendingRecord) { setDontRemind(false); setAck(false); } }, [pendingRecord]);

  // If the reminder is already dismissed, start straight away — no modal flash.
  useEffect(() => {
    if (pendingRecord && dismissed && !busy) void go(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingRecord, dismissed]);

  if (!pendingRecord || dismissed) return null;

  async function go(disableFutureReminders: boolean) {
    if (busy) return;
    setBusy(true);
    const { title, proceed } = pendingRecord!;
    try {
      if (disableFutureReminders) await updateSettings({ consentReminderDismissed: true });
      await startRecording(title);
      proceed();
    } finally {
      setBusy(false);
      clearPendingRecord();
    }
  }

  // "Don't remind me again" is only allowed once responsibility is acknowledged.
  const canStart = !dontRemind || ack;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md bg-surface-hi border border-edge rounded-xl shadow-xl shadow-black/40 p-5 flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <h2 className="text-[14px] font-semibold text-hi">Before you record</h2>
          <p className="text-[12px] text-sub leading-relaxed">
            Let the other participants know they're being recorded. Recording-consent laws vary by
            jurisdiction — some require every party to agree — and you are responsible for complying
            with the ones that apply to you.
          </p>
        </div>

        <label className="flex items-start gap-2.5 cursor-pointer">
          <input type="checkbox" checked={dontRemind}
            onChange={e => { setDontRemind(e.target.checked); if (!e.target.checked) setAck(false); }}
            className="mt-0.5 accent-celeste shrink-0 w-4 h-4" />
          <span className="text-[12px] text-hi">Don't remind me again</span>
        </label>

        {dontRemind && (
          <label className="flex items-start gap-2.5 cursor-pointer -mt-1 pl-6">
            <input type="checkbox" checked={ack}
              onChange={e => setAck(e.target.checked)}
              className="mt-0.5 accent-celeste shrink-0 w-4 h-4" />
            <span className="text-[11px] text-sub leading-relaxed">
              I understand that I am solely responsible for obtaining any consent required by law
              before recording, and Turingram is not responsible for my use of it.
            </span>
          </label>
        )}

        <div className="flex items-center justify-end gap-2 pt-1">
          <button onClick={() => { clearPendingRecord(); }} disabled={busy}
            className="text-[12px] text-sub hover:text-hi px-3 py-1.5 transition-colors disabled:opacity-40">
            Cancel
          </button>
          <button onClick={() => go(dontRemind)} disabled={busy || !canStart}
            style={{ color: 'var(--color-base)' }}
            className="text-[12px] font-semibold bg-celeste hover:bg-celeste-hi px-4 py-1.5 rounded-md transition-colors disabled:opacity-40">
            {busy ? 'Starting…' : 'Start recording'}
          </button>
        </div>
      </div>
    </div>
  );
}
