import React, { useState, useEffect } from 'react';
import type { AgentInfo, KeyStatus } from '@turingyde/transcript-core';
import type { Screen } from '../App';
import { useSettings } from '../contexts/SettingsContext';
import { DrinksPanel } from '../components/Drinks';

interface Props { onNavigate: (s: Screen) => void }

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="py-4 border-b border-edge-sub last:border-0">
      <h3 className="text-[10px] font-semibold text-muted uppercase tracking-widest mb-3">{title}</h3>
      {children}
    </div>
  );
}

// Turingram's claim is that your transcripts stay on your machine and stay yours
// to read. Nothing in the app said where they are, so the claim was unverifiable by
// the people it was aimed at.
//
// The answer is not to teach every agent where Turingram keeps its files — it is
// to let the files live where the user already tells their agents to look. A
// notes vault, a project folder. Then "look in the vault" needs no setup at all,
// and it works for agents this app has never heard of.
function AgentAccess() {
  const [info, setInfo] = useState<AgentInfo | null>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () => window.api.getAgentInfo().then(setInfo).catch(() => setInfo(null));
  useEffect(() => { load(); }, []);

  function handleCopy() {
    if (!info) return;
    navigator.clipboard.writeText(info.dir).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  async function change(pick: boolean) {
    setBusy(true);
    setError(null);
    try {
      // null means the user closed the picker without choosing — not an error,
      // and nothing should change on screen.
      const result = pick ? await window.api.chooseTranscriptsDir() : await window.api.resetTranscriptsDir();
      if (!result) return;
      if (result.info) setInfo(result.info);
      setError(result.error ?? null);
    } finally {
      setBusy(false);
    }
  }

  if (!info) return null;

  return (
    <div className="flex flex-col gap-3">
      <div className="text-[11px] text-sub">
        Every meeting is also written here as JSON, so your own tools can read it.
        The folder carries an <code className="text-hi">index.json</code> listing every
        meeting and a <code className="text-hi">README.md</code> explaining the format,
        so an agent you point at it can find its way without being told how.
      </div>

      <div className="flex items-center gap-2">
        <code className="flex-1 min-w-0 truncate bg-surface border border-edge-sub rounded-md px-2 py-1.5 text-[11px] text-hi"
          title={info.dir}>
          {info.dir}
        </code>
        <button onClick={handleCopy}
          className="shrink-0 px-2.5 py-1.5 rounded-md border border-edge-sub bg-surface hover:bg-surface-hi text-[11px] font-medium text-hi transition-colors">
          {copied ? 'Copied' : 'Copy'}
        </button>
        <button onClick={() => window.api.revealFile(info.readmePath)}
          className="shrink-0 px-2.5 py-1.5 rounded-md border border-edge-sub bg-surface hover:bg-surface-hi text-[11px] font-medium text-hi transition-colors">
          Open
        </button>
      </div>

      <div className="flex items-center gap-2">
        <button onClick={() => change(true)} disabled={busy}
          style={{ color: 'var(--color-base)' }}
          className="px-2.5 py-1.5 rounded-md bg-celeste hover:bg-celeste-hi text-[11px] font-medium transition-colors disabled:opacity-50">
          {busy ? 'Moving…' : 'Change folder…'}
        </button>
        {!info.isDefault && (
          <button onClick={() => change(false)} disabled={busy}
            className="px-2.5 py-1.5 rounded-md border border-edge-sub bg-surface hover:bg-surface-hi text-[11px] font-medium text-hi transition-colors disabled:opacity-50">
            Reset to default
          </button>
        )}
        {/* Says what the button will actually do to files that already exist,
            before it does it. */}
        <span className="text-[10px] text-muted">
          {info.fileCount === 0
            ? 'No transcripts yet'
            : `Moves ${info.fileCount} existing transcript${info.fileCount === 1 ? '' : 's'}`}
        </span>
      </div>

      {error && <div className="text-[11px] text-danger">{error}</div>}

      {!info.isDefault && (
        // These are recordings of real conversations with named third parties.
        // A synced folder is a legitimate choice and often the point — but it
        // should be a choice made knowingly.
        <div className="text-[10px] text-muted">
          Transcripts now live outside Turingram. If that folder syncs to a cloud
          service, your meeting transcripts go with it.
        </div>
      )}
    </div>
  );
}

// Turingram runs on the user's own provider accounts, and the keys reach the
// app through a .env in its data directory. On macOS that directory is under
// ~/Library, which Finder hides by default, so "put a file there" is an
// instruction most users cannot follow. This authors that file for them.
function ProviderKeys() {
  const [status, setStatus] = useState<KeyStatus | null>(null);
  const [deepgram, setDeepgram] = useState('');
  const [gemini, setGemini] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => { window.api.getKeyStatus().then(setStatus).catch(() => setStatus(null)); }, []);

  async function save() {
    const updates: Record<string, string> = {};
    if (deepgram.trim()) updates.DEEPGRAM_API_KEY = deepgram.trim();
    if (gemini.trim()) updates.GEMINI_API_KEY = gemini.trim();
    if (Object.keys(updates).length === 0) return;

    setBusy(true);
    setError(null);
    try {
      setStatus(await window.api.saveKeys(updates));
      // Clearing the inputs is the point, not tidiness: a key left sitting in a
      // text field is a key on screen during the screen-share this app records.
      setDeepgram('');
      setGemini('');
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!status) return null;

  const field = (
    label: string,
    href: string,
    value: string,
    onChange: (v: string) => void,
    present: boolean,
    required: boolean,
  ) => (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className="text-[12px] font-medium text-hi">{label}</span>
        {present
          ? <span className="text-[10px] font-semibold text-celeste">Set</span>
          : <span className="text-[10px] text-muted">{required ? 'Required' : 'Optional'}</span>}
        <a href={href} target="_blank" rel="noreferrer"
          className="ml-auto text-[10px] text-sub hover:text-hi underline transition-colors">
          Get a key
        </a>
      </div>
      <input
        type="password"
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={present ? 'Paste a new key to replace it' : 'Paste your key'}
        spellCheck={false}
        autoComplete="off"
        className="bg-surface border border-edge-sub rounded-lg px-3 py-2 text-[12px] text-hi placeholder:text-muted focus:outline-none focus:border-edge transition-colors"
      />
    </div>
  );

  return (
    <Section title="Provider keys">
    <div className="flex flex-col gap-3">
      <div className="text-[11px] text-sub">
        Turingram runs on your own provider accounts. Deepgram transcribes and separates the
        speakers, which is what a recording needs to become a transcript. Gemini writes the
        summary and the action items, and everything else works without it.
      </div>

      {field('Deepgram', 'https://console.deepgram.com/signup', deepgram, setDeepgram,
        status.present.DEEPGRAM_API_KEY, true)}
      {field('Gemini', 'https://aistudio.google.com/apikey', gemini, setGemini,
        status.present.GEMINI_API_KEY, false)}

      <div className="flex items-center gap-2">
        <button onClick={save} disabled={busy || (!deepgram.trim() && !gemini.trim())}
          style={{ color: 'var(--color-base)' }}
          className="px-2.5 py-1.5 rounded-md bg-celeste hover:bg-celeste-hi text-[11px] font-medium transition-colors disabled:opacity-50">
          {busy ? 'Saving…' : 'Save keys'}
        </button>
        <button onClick={() => window.api.revealEnvFile()}
          className="px-2.5 py-1.5 rounded-md border border-edge-sub bg-surface hover:bg-surface-hi text-[11px] font-medium text-hi transition-colors">
          Show the file
        </button>
        <button onClick={() => window.api.reloadKeys().then(setStatus)}
          className="px-2.5 py-1.5 rounded-md border border-edge-sub bg-surface hover:bg-surface-hi text-[11px] font-medium text-hi transition-colors">
          Re-read it
        </button>
        {saved && <span className="text-[10px] font-semibold text-celeste">Saved</span>}
      </div>

      {error && <div className="text-[11px] text-danger">{error}</div>}

      <div className="text-[10px] text-muted">
        Keys are written to <code className="text-sub">{status.envPath}</code>, readable only by
        you, and are never shown again once saved. They take effect right away, so you can
        record without restarting. Your provider bills you directly for what you send.
      </div>
    </div>
    </Section>
  );
}

export default function Settings({ onNavigate }: Props) {
  const { settings, audioDevices, updateSettings } = useSettings();
  const [vocabularyText, setVocabularyText] = useState('');

  useEffect(() => {
    if (settings) {
      setVocabularyText((settings.vocabulary ?? []).join(', '));
    }
  }, [settings?.vocabulary]);

  function handleVocabularySave() {
    const parsed = vocabularyText
      .split(/[,\n]+/)
      .map(s => s.trim())
      .filter(Boolean);
    updateSettings({ vocabulary: parsed });
  }

  if (!settings) return null;

  return (
    <div className="flex flex-col h-screen bg-base">
      <header className="flex items-center gap-3 px-4 py-3 border-b border-edge">
        <button onClick={() => onNavigate({ name: 'list' })}
          style={{ color: 'var(--color-base)' }}
          className="w-8 h-8 flex items-center justify-center bg-celeste hover:bg-celeste-hi rounded-md text-xl font-bold transition-colors shrink-0 leading-none">
          ←
        </button>
        <h2 className="text-[13px] font-semibold text-hi">Settings</h2>
      </header>

      <div className="flex-1 overflow-y-auto px-4">
        <Section title="Appearance">
          <div className="flex flex-col gap-2">
            <div className="text-[12px] font-medium text-hi">Theme</div>
            <div className="grid grid-cols-2 gap-2">
              {([
                { value: 'dark', label: 'Dark' },
                { value: 'light', label: 'Light' },
              ] as const).map(t => {
                const active = (settings.theme ?? 'dark') === t.value;
                return (
                  <button key={t.value}
                    onClick={() => updateSettings({ theme: t.value })}
                    className={`rounded-lg border p-3 text-left transition-colors ${
                      active ? 'border-celeste bg-celeste/8' : 'border-edge-sub bg-surface hover:bg-surface-hi'
                    }`}>
                    <div className="flex items-center gap-2">
                      {/* Swatch previews each theme's base + accent regardless of the active theme. */}
                      <span className="flex h-4 w-6 overflow-hidden rounded border border-edge-sub shrink-0">
                        <span className="flex-1" style={{ background: t.value === 'dark' ? 'oklch(0.10 0.040 277)' : 'oklch(0.99 0.004 250)' }} />
                        <span className="w-2" style={{ background: t.value === 'dark' ? 'oklch(0.85 0.17 162)' : 'oklch(0.50 0.150 252)' }} />
                      </span>
                      <span className="text-[12px] font-medium text-hi">{t.label}</span>
                      {active && <span className="ml-auto text-[10px] font-semibold text-celeste">Active</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        </Section>

        <ProviderKeys />

        <Section title="Buy me a drink">
          <DrinksPanel />
        </Section>

        <Section title="For your agents">
          <AgentAccess />
        </Section>

        <Section title="Vocabulary">
          <div className="flex flex-col gap-2">
            <div className="text-[12px] font-medium text-hi">Vocabulary hints</div>
            <div className="text-[11px] text-sub mt-0.5">
              Proper nouns to expect — company names, product names, people. These are sent as
              recognition hints, and they are the words transcription most often gets wrong.
              Participant names you enter when stopping a recording are added automatically.
              Comma or newline separated.
            </div>
            <textarea
              value={vocabularyText}
              onChange={e => setVocabularyText(e.target.value)}
              onBlur={handleVocabularySave}
              rows={4}
              className="bg-surface border border-edge-sub rounded-lg px-3 py-2 text-[12px] text-hi placeholder:text-muted resize-none focus:outline-none focus:border-edge transition-colors"
              placeholder="Turingram, HubSpot, Zoom..."
            />
          </div>
        </Section>

        <Section title="Microphone">
          <div className="flex flex-col gap-2">
            <div className="text-[11px] text-sub">
              Which input you are speaking into. The other side of the call is always captured from
              system audio, so there is nothing to choose there.
            </div>
            <select
              value={settings.audioDeviceId ?? ''}
              onChange={e => updateSettings({ audioDeviceId: e.target.value || null })}
              className="w-full bg-surface border border-edge-sub rounded-md px-3 py-2 text-[12px] text-hi focus:outline-none focus:border-celeste transition-colors">
              <option value="">System default</option>
              {audioDevices.map(d => (
                <option key={d.id} value={d.id}>{d.name}{d.isDefault ? ' (default)' : ''}</option>
              ))}
            </select>
          </div>
        </Section>

        <Section title="Meetings">
          <label className="flex items-center justify-between gap-3 cursor-pointer">
            <div>
              <div className="text-[12px] font-medium text-hi">Detect meetings</div>
              <div className="text-[11px] text-sub mt-0.5">When a call app opens your microphone, offer to record it. Only ever asks — it never records on its own.</div>
            </div>
            <input type="checkbox"
              checked={settings.autoDetectMeetings ?? true}
              onChange={e => updateSettings({ autoDetectMeetings: e.target.checked })}
              className="accent-celeste shrink-0 w-4 h-4" />
          </label>

          <label className="flex items-center justify-between gap-3 cursor-pointer mt-3">
            <div>
              <div className="text-[12px] font-medium text-hi">Launch at login</div>
              <div className="text-[11px] text-sub mt-0.5">Start Turingram automatically when you log in, hidden in the tray or menu bar, so it's already watching for meetings.</div>
            </div>
            <input type="checkbox"
              checked={settings.launchAtLogin ?? false}
              onChange={e => updateSettings({ launchAtLogin: e.target.checked })}
              className="accent-celeste shrink-0 w-4 h-4" />
          </label>

          <label className="flex items-center justify-between gap-3 cursor-pointer mt-3">
            <div>
              <div className="text-[12px] font-medium text-hi">Confirm before deleting</div>
              <div className="text-[11px] text-sub mt-0.5">Ask before removing a meeting. Turn off to delete immediately.</div>
            </div>
            <input type="checkbox"
              checked={settings.confirmBeforeDelete ?? true}
              onChange={e => updateSettings({ confirmBeforeDelete: e.target.checked })}
              className="accent-celeste shrink-0 w-4 h-4" />
          </label>

          <label className="flex items-center justify-between gap-3 cursor-pointer mt-3">
            <div>
              <div className="text-[12px] font-medium text-hi">Keep audio recordings</div>
              <div className="text-[11px] text-sub mt-0.5">Retain each recording so you can re-transcribe it with a different model. Uses disk space (~4 MB/min).</div>
            </div>
            <input type="checkbox"
              checked={settings.keepRecordings ?? false}
              onChange={e => updateSettings({ keepRecordings: e.target.checked })}
              className="accent-celeste shrink-0 w-4 h-4" />
          </label>
        </Section>

      </div>
    </div>
  );
}
