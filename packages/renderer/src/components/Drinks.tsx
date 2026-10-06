import React, { useEffect, useState } from 'react';
import type { DrinkState } from '@turingyde/transcript-core';
import type { Screen } from '../App';
import { useMeetings } from '../contexts/MeetingContext';

// The drink ask and the drinks panel. The schedule lives in the main process
// (drinks.ts): every twelve recorded hours it sends 'drinks:nag' with a line,
// unless this install has a verified token. There is no setting that silences
// it. "Later" clears the card until the next twelve hours.

const dollars = (cents: number) => `$${cents / 100}`;
const shortName = (id: string) => id.charAt(0).toUpperCase() + id.slice(1);

function TierLinks({ tiers, compact }: { tiers: DrinkState['tiers']; compact?: boolean }) {
  // target=_blank reaches setWindowOpenHandler, which opens the checkout in the
  // user's browser. Each url already carries this install's id.
  return (
    <div className="flex flex-wrap gap-1.5">
      {tiers.map(t => (
        <a key={t.id} href={t.url} target="_blank" rel="noreferrer"
          className="px-2.5 py-1.5 rounded-md border border-edge-sub bg-surface hover:bg-surface-hi text-[11px] font-medium text-hi transition-colors">
          {compact ? shortName(t.id) : t.label} · {dollars(t.amount)}
        </a>
      ))}
    </div>
  );
}

export function DrinkNag({ onNavigate }: { onNavigate: (s: Screen) => void }) {
  const { isRecording } = useMeetings();
  const [line, setLine] = useState<string | null>(null);
  const [state, setState] = useState<DrinkState | null>(null);

  useEffect(() => window.api.onDrinkNag(l => {
    setLine(l);
    window.api.getDrinkState().then(setState).catch(() => setState(null));
  }), []);

  if (!line || !state || state.bought || isRecording) return null;

  return (
    <div className="fixed bottom-4 left-4 z-50 w-80 max-w-[calc(100vw-2rem)] animate-[fadeIn_0.15s_ease-out]">
      <div className="bg-surface-hi border border-edge rounded-xl shadow-lg shadow-black/30 p-4 flex flex-col gap-3">
        <div className="text-[12px] font-medium text-hi">{line}</div>
        <TierLinks tiers={state.tiers} compact />
        <div className="flex items-center gap-2 justify-end">
          <button onClick={() => { setLine(null); onNavigate({ name: 'settings' }); }}
            className="text-[11px] text-sub hover:text-hi px-2.5 py-1.5 transition-colors">
            I already bought one
          </button>
          <button onClick={() => setLine(null)}
            style={{ color: 'var(--color-base)' }}
            className="text-[11px] font-semibold bg-celeste hover:bg-celeste-hi px-3 py-1.5 rounded-md transition-colors">
            Later
          </button>
        </div>
      </div>
    </div>
  );
}

export function DrinksPanel() {
  const [state, setState] = useState<DrinkState | null>(null);
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { window.api.getDrinkState().then(setState).catch(() => setState(null)); }, []);

  async function redeem() {
    setBusy(true);
    setError(null);
    try {
      if (await window.api.redeemDrink(token.trim())) {
        setToken('');
        setState(await window.api.getDrinkState());
      } else {
        setError('That token did not verify on this computer. A token works only on the install that bought it.');
      }
    } finally {
      setBusy(false);
    }
  }

  if (!state) return null;

  if (state.bought) {
    return (
      <div className="text-[11px] text-sub">
        You bought the developer {state.bought.charAt(0).toLowerCase() + state.bought.slice(1)}. Cheers.
        Turingram will not ask again on this computer.
      </div>
    );
  }

  const hours = Math.floor(state.recordedSec / 3600);
  return (
    <div className="flex flex-col gap-3">
      <div className="text-[11px] text-sub">
        Turingram is free and open source. After every 12 hours of recording, it asks you to buy
        the developer a drink. Buying one stops the asking on this computer for good. So far you
        have recorded {hours} {hours === 1 ? 'hour' : 'hours'} in {state.meetings} {state.meetings === 1 ? 'meeting' : 'meetings'}.
      </div>

      <TierLinks tiers={state.tiers} />

      <div className="flex flex-col gap-1.5">
        <span className="text-[12px] font-medium text-hi">Already bought one?</span>
        <div className="flex items-center gap-2">
          <input
            value={token}
            onChange={e => setToken(e.target.value)}
            placeholder="Paste the token from the thank-you page"
            spellCheck={false}
            autoComplete="off"
            className="flex-1 min-w-0 bg-surface border border-edge-sub rounded-lg px-3 py-2 text-[12px] text-hi placeholder:text-muted focus:outline-none focus:border-edge transition-colors"
          />
          <button onClick={redeem} disabled={busy || !token.trim()}
            style={{ color: 'var(--color-base)' }}
            className="px-2.5 py-1.5 rounded-md bg-celeste hover:bg-celeste-hi text-[11px] font-medium transition-colors disabled:opacity-50">
            {busy ? 'Checking…' : 'Redeem'}
          </button>
        </div>
        {error && <div className="text-[11px] text-danger">{error}</div>}
      </div>
    </div>
  );
}
