import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { webcrypto } from 'crypto';
import {
  loadLedger, saveLedger, recordMeeting, redeem, drinkState, verifyToken, nagLine, NAG_EVERY_SEC,
} from '../drinks';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'drinks-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const b64url = (bytes: ArrayBuffer | Uint8Array) => Buffer.from(bytes as ArrayBuffer).toString('base64url');

// Signs the way the Worker does, with a throwaway key.
async function minter() {
  const pair = await webcrypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']) as CryptoKeyPair;
  const pub = b64url(await webcrypto.subtle.exportKey('spki', pair.publicKey));
  const mint = async (install: string, tier = 'beer') => {
    const body = new TextEncoder().encode(JSON.stringify({ install, tier, iat: 1 }));
    const sig = await webcrypto.subtle.sign({ name: 'Ed25519' }, pair.privateKey, body);
    return `${b64url(body)}.${b64url(sig)}`;
  };
  return { pub, mint };
}

describe('ledger', () => {
  it('creates a turingram_ install id once and keeps it', () => {
    const first = loadLedger(dir).install;
    expect(first).toMatch(/^turingram_[0-9a-f-]{36}$/);
    expect(loadLedger(dir).install).toBe(first);
  });

  it('starts over from a corrupt file rather than throwing', () => {
    fs.writeFileSync(path.join(dir, 'drinks.json'), '{not json');
    expect(loadLedger(dir).recordedSec).toBe(0);
  });
});

describe('the ask', () => {
  it('waits for the first twelve recorded hours', async () => {
    expect(await recordMeeting(dir, NAG_EVERY_SEC - 1)).toBeNull();
    expect(await recordMeeting(dir, 1)).toMatch(/12 hours/);
  });

  it('asks again only after another twelve hours', async () => {
    expect(await recordMeeting(dir, NAG_EVERY_SEC + 600)).not.toBeNull();
    expect(await recordMeeting(dir, NAG_EVERY_SEC - 1)).toBeNull();
    expect(await recordMeeting(dir, 1)).not.toBeNull();
  });

  it('never asks a paid install', async () => {
    const { pub, mint } = await minter();
    expect(await redeem(dir, await mint(loadLedger(dir).install), pub)).toBe(true);
    expect(await recordMeeting(dir, NAG_EVERY_SEC * 3, pub)).toBeNull();
  });

  it('counts meetings and quotes true numbers', () => {
    const ledger = { ...loadLedger(dir), recordedSec: 13 * 3600, meetings: 1, nags: 1 };
    expect(nagLine(ledger)).toBe('1 meeting, 13 hours, every word written down. A coffee would go down well.');
  });
});

describe('tokens', () => {
  it('unlocks the install it was bought for and reports the tier', async () => {
    const { pub, mint } = await minter();
    const install = loadLedger(dir).install;
    expect(await redeem(dir, await mint(install, 'wine'), pub)).toBe(true);
    expect((await drinkState(dir, pub)).bought).toBe('A decent glass of wine');
  });

  it("refuses another install's token and stores nothing", async () => {
    const { pub, mint } = await minter();
    expect(await redeem(dir, await mint('turingram_someone-else'), pub)).toBe(false);
    expect(loadLedger(dir).token).toBeUndefined();
  });

  it('refuses a token signed by a different key', async () => {
    const { mint } = await minter();
    const other = await minter();
    expect(await verifyToken(await mint(loadLedger(dir).install), loadLedger(dir).install, other.pub)).toBeUndefined();
  });

  it('refuses malformed tokens', async () => {
    const { pub } = await minter();
    for (const bad of ['', 'abc', 'a.b.c', '!!!.???']) {
      expect(await verifyToken(bad, loadLedger(dir).install, pub)).toBeUndefined();
    }
  });

  it('a stored token that no longer verifies does not count as bought', async () => {
    saveLedger(dir, { ...loadLedger(dir), token: 'forged.token' });
    expect((await drinkState(dir)).bought).toBeNull();
  });
});

describe('checkout', () => {
  it('tags every tier link with this install', async () => {
    const { tiers } = await drinkState(dir);
    const install = loadLedger(dir).install;
    expect(tiers).toHaveLength(5);
    for (const t of tiers) {
      expect(t.url).toMatch(/^https:\/\/buy\.stripe\.com\//);
      expect(new URL(t.url).searchParams.get('client_reference_id')).toBe(install);
    }
  });
});
