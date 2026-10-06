import fs from 'fs';
import path from 'path';
import { randomUUID, webcrypto } from 'crypto';
import type { DrinkState, DrinkTierId } from '@turingyde/transcript-core';

// Buying the developer a drink.
//
// Turingram is free. Every twelve hours of recording it asks for a drink, and
// paying stops the asking on this install, forever. There is no setting that
// stops it — that is the whole business model, written here once so it cannot
// drift. The flow, the signing key and the Worker are shared with agent-stage
// (see docs/drinks.md in that repo); only the Payment Links are Turingram's own.
//
// The checkout carries client_reference_id=<install>. The Worker confirms the
// payment with Stripe and signs {install, tier, iat} with an Ed25519 key that
// exists only in its secret store. This file ships the public half, so a token
// is checked offline and only on the install it was bought for.

const DRINK_PUBLIC_KEY = 'MCowBQYDK2VwAyEANIataAfTbJU47xq41UQ_Va4DOJ6UTD7ZLAfJc2sk8j0';

export const TIERS: ReadonlyArray<{ id: DrinkTierId; label: string; amount: number; link: string }> = [
  { id: 'coffee', label: 'A fancy cup of coffee', amount: 400, link: 'https://buy.stripe.com/7sYfZi2Nz17Lg2JfZEf3a05' },
  { id: 'beer', label: 'A nice cold beer', amount: 800, link: 'https://buy.stripe.com/bJefZi2NzeYBeYF6p4f3a06' },
  { id: 'wine', label: 'A decent glass of wine', amount: 1600, link: 'https://buy.stripe.com/3cI4gA9bX3fTbMtcNsf3a07' },
  { id: 'cocktail', label: 'A big city cocktail', amount: 2400, link: 'https://buy.stripe.com/8x214o0Fr3fTeYF6p4f3a08' },
  { id: 'champagne', label: 'A glass of good Champagne', amount: 4800, link: 'https://buy.stripe.com/00wcN69bX03H8Ah14Kf3a09' },
];

/** Recorded time between asks, the first one included. */
export const NAG_EVERY_SEC = 12 * 3600;

const FILE = 'drinks.json';

export interface Ledger {
  /** turingram_<uuid>. The Worker reads the prefix to know which app paid. */
  install: string;
  recordedSec: number;
  meetings: number;
  nags: number;
  /** recordedSec at the last ask */
  nagAtSec: number;
  token?: string;
}

function file(dataDir: string): string {
  return path.join(dataDir, FILE);
}

function fresh(): Ledger {
  return { install: `turingram_${randomUUID()}`, recordedSec: 0, meetings: 0, nags: 0, nagAtSec: 0 };
}

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);

export function loadLedger(dataDir: string): Ledger {
  try {
    const raw = JSON.parse(fs.readFileSync(file(dataDir), 'utf8')) as Partial<Ledger>;
    if (typeof raw.install === 'string' && raw.install.startsWith('turingram_')) {
      return {
        install: raw.install,
        recordedSec: num(raw.recordedSec),
        meetings: num(raw.meetings),
        nags: num(raw.nags),
        nagAtSec: num(raw.nagAtSec),
        token: typeof raw.token === 'string' ? raw.token : undefined,
      };
    }
  } catch { /* missing or unreadable: start a new ledger */ }
  const made = fresh();
  saveLedger(dataDir, made);
  return made;
}

export function saveLedger(dataDir: string, ledger: Ledger): void {
  const tmp = `${file(dataDir)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(ledger, null, 2));
  fs.renameSync(tmp, file(dataDir));
}

export function nextNagAt(ledger: Ledger): number {
  return ledger.nags === 0 ? NAG_EVERY_SEC : ledger.nagAtSec + NAG_EVERY_SEC;
}

export function nagDue(ledger: Ledger, unlocked: boolean): boolean {
  return !unlocked && ledger.recordedSec >= nextNagAt(ledger);
}

function plural(n: number, one: string): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : `${one}s`}`;
}

/**
 * The ask, quoting the ledger. Rotates so the fifth ask is not word for word
 * the first, and every line is a true statement about this install.
 */
export function nagLine(ledger: Ledger): string {
  const hours = plural(Math.floor(ledger.recordedSec / 3600), 'hour');
  const meetings = plural(ledger.meetings, 'meeting');
  const lines = [
    `Turingram has recorded ${hours} of your meetings. Buy me a drink?`,
    `${meetings}, ${hours}, every word written down. A coffee would go down well.`,
    `${hours} of meetings recorded. I'm not counting. I am absolutely counting.`,
    `${meetings} transcribed and zero drinks. Buy me one?`,
    `${hours} of other people talking, and I wrote it all down. My round is never. Yours could be now.`,
  ];
  return lines[ledger.nags % lines.length];
}

function b64urlDecode(text: string): Uint8Array {
  return new Uint8Array(Buffer.from(text, 'base64url'));
}

/** The install's claim, or undefined: a bad signature and a wrong install look the same. */
export async function verifyToken(
  token: string,
  install: string,
  publicKey = DRINK_PUBLIC_KEY,
): Promise<{ tier: DrinkTierId } | undefined> {
  const [head, tail, ...rest] = token.trim().split('.');
  if (!head || !tail || rest.length) return undefined;
  try {
    const body = b64urlDecode(head);
    const claim = JSON.parse(Buffer.from(body).toString('utf8')) as { install?: unknown; tier?: unknown };
    if (claim.install !== install) return undefined;
    const tier = TIERS.find(t => t.id === claim.tier)?.id;
    if (!tier) return undefined;
    const key = await webcrypto.subtle.importKey('spki', b64urlDecode(publicKey), { name: 'Ed25519' }, false, ['verify']);
    const ok = await webcrypto.subtle.verify({ name: 'Ed25519' }, key, b64urlDecode(tail), body);
    return ok ? { tier } : undefined;
  } catch {
    return undefined;
  }
}

function checkoutUrl(link: string, install: string): string {
  const url = new URL(link);
  url.searchParams.set('client_reference_id', install);
  return url.toString();
}

export async function drinkState(dataDir: string, publicKey = DRINK_PUBLIC_KEY): Promise<DrinkState> {
  const ledger = loadLedger(dataDir);
  const claim = ledger.token ? await verifyToken(ledger.token, ledger.install, publicKey) : undefined;
  return {
    recordedSec: ledger.recordedSec,
    meetings: ledger.meetings,
    bought: claim ? TIERS.find(t => t.id === claim.tier)!.label : null,
    tiers: TIERS.map(t => ({ id: t.id, label: t.label, amount: t.amount, url: checkoutUrl(t.link, ledger.install) })),
  };
}

/**
 * Adds a finished recording to the ledger. Returns the ask when this recording
 * crossed the next twelve-hour mark on an unpaid install, and marks it asked,
 * so the next one is another twelve hours away.
 */
export async function recordMeeting(dataDir: string, seconds: number, publicKey = DRINK_PUBLIC_KEY): Promise<string | null> {
  const ledger = loadLedger(dataDir);
  ledger.recordedSec += Math.max(0, Math.round(seconds));
  ledger.meetings += 1;
  let line: string | null = null;
  const unlocked = !!ledger.token && !!(await verifyToken(ledger.token, ledger.install, publicKey));
  if (nagDue(ledger, unlocked)) {
    line = nagLine(ledger);
    ledger.nags += 1;
    ledger.nagAtSec = ledger.recordedSec;
  }
  saveLedger(dataDir, ledger);
  return line;
}

/** Stores a token that verifies for this install. Anything else changes nothing. */
export async function redeem(dataDir: string, token: string, publicKey = DRINK_PUBLIC_KEY): Promise<boolean> {
  const ledger = loadLedger(dataDir);
  if (!(await verifyToken(token, ledger.install, publicKey))) return false;
  ledger.token = token.trim();
  saveLedger(dataDir, ledger);
  return true;
}
