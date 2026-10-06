import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  applyToEnvText, isWritableValue, readKeyStatus, saveKeys, reloadKeys, envPath,
} from '../byoKeys';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'byokeys-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('isWritableValue', () => {
  it('rejects empty and whitespace-only values', () => {
    expect(isWritableValue('')).toBe(false);
    expect(isWritableValue('   ')).toBe(false);
  });

  it('rejects a value carrying a line break, which would set a second variable', () => {
    expect(isWritableValue('abc\nGEMINI_API_KEY=stolen')).toBe(false);
    expect(isWritableValue('abc\r\nx=1')).toBe(false);
  });

  it('accepts an ordinary key', () => {
    expect(isWritableValue('a-plausible-key')).toBe(true);
  });
});

describe('applyToEnvText', () => {
  it('appends to an empty file', () => {
    expect(applyToEnvText('', { DEEPGRAM_API_KEY: 'abc' })).toBe('DEEPGRAM_API_KEY="abc"\n');
  });

  it('replaces an existing assignment in place rather than appending a second', () => {
    const out = applyToEnvText('DEEPGRAM_API_KEY="old"\nOTHER=1\n', { DEEPGRAM_API_KEY: 'new' });
    expect(out).toContain('DEEPGRAM_API_KEY="new"');
    expect(out).not.toContain('old');
    expect(out.match(/DEEPGRAM_API_KEY/g)).toHaveLength(1);
  });

  it('replaces an `export KEY=` form too', () => {
    const out = applyToEnvText('export DEEPGRAM_API_KEY=old\n', { DEEPGRAM_API_KEY: 'new' });
    expect(out.match(/DEEPGRAM_API_KEY/g)).toHaveLength(1);
    expect(out).toContain('DEEPGRAM_API_KEY="new"');
  });

  it('leaves comments and unrelated variables byte for byte', () => {
    const before = '# my notes\nSOMETHING_ELSE=keep me\n\nDEEPGRAM_API_KEY=old\n';
    const out = applyToEnvText(before, { DEEPGRAM_API_KEY: 'new' });
    expect(out).toContain('# my notes');
    expect(out).toContain('SOMETHING_ELSE=keep me');
  });

  it('quotes the value so a key containing " #" survives the loader', () => {
    const out = applyToEnvText('', { DEEPGRAM_API_KEY: 'abc #def' });
    expect(out).toBe('DEEPGRAM_API_KEY="abc #def"\n');
  });

  it('writes both keys in one pass', () => {
    const out = applyToEnvText('', { DEEPGRAM_API_KEY: 'a', GEMINI_API_KEY: 'b' });
    expect(out).toContain('DEEPGRAM_API_KEY="a"');
    expect(out).toContain('GEMINI_API_KEY="b"');
  });
});

describe('readKeyStatus', () => {
  it('reports presence by name and never the value', () => {
    const status = readKeyStatus(dir, { DEEPGRAM_API_KEY: 'secret-value' } as NodeJS.ProcessEnv);
    expect(status.present.DEEPGRAM_API_KEY).toBe(true);
    expect(status.present.GEMINI_API_KEY).toBe(false);
    expect(JSON.stringify(status)).not.toContain('secret-value');
  });

  it('treats a whitespace-only key as absent', () => {
    const status = readKeyStatus(dir, { DEEPGRAM_API_KEY: '   ' } as NodeJS.ProcessEnv);
    expect(status.present.DEEPGRAM_API_KEY).toBe(false);
  });
});

describe('saveKeys', () => {
  it('writes the file, applies to the env, and reports presence', () => {
    const env = {} as NodeJS.ProcessEnv;
    const status = saveKeys(dir, { DEEPGRAM_API_KEY: 'abc' }, env);
    expect(fs.readFileSync(envPath(dir), 'utf8')).toContain('DEEPGRAM_API_KEY="abc"');
    expect(env.DEEPGRAM_API_KEY).toBe('abc');
    expect(status.present.DEEPGRAM_API_KEY).toBe(true);
  });

  it('takes effect without a restart, so a paste is immediately usable', () => {
    const env = {} as NodeJS.ProcessEnv;
    expect(readKeyStatus(dir, env).present.DEEPGRAM_API_KEY).toBe(false);
    saveKeys(dir, { DEEPGRAM_API_KEY: 'abc' }, env);
    expect(readKeyStatus(dir, env).present.DEEPGRAM_API_KEY).toBe(true);
  });

  // POSIX only. Windows has no mode bits behind fs.chmod — NTFS protects the
  // file with the profile ACL instead, and statSync reports a synthesized 0666,
  // so asserting 0600 there tests Node's emulation rather than our code.
  const posix = it.skipIf(process.platform === 'win32');

  posix('creates the file readable only by its owner', () => {
    saveKeys(dir, { DEEPGRAM_API_KEY: 'abc' }, {} as NodeJS.ProcessEnv);
    expect(fs.statSync(envPath(dir)).mode & 0o777).toBe(0o600);
  });

  posix('tightens the mode on a .env that already existed world-readable', () => {
    fs.writeFileSync(envPath(dir), 'OTHER=1\n', { mode: 0o644 });
    fs.chmodSync(envPath(dir), 0o644);
    saveKeys(dir, { DEEPGRAM_API_KEY: 'abc' }, {} as NodeJS.ProcessEnv);
    expect(fs.statSync(envPath(dir)).mode & 0o777).toBe(0o600);
  });

  it('preserves a hand-written variable it does not manage', () => {
    fs.writeFileSync(envPath(dir), 'OTHER_SETTING="keep-me"\n');
    saveKeys(dir, { DEEPGRAM_API_KEY: 'abc' }, {} as NodeJS.ProcessEnv);
    expect(fs.readFileSync(envPath(dir), 'utf8')).toContain('OTHER_SETTING="keep-me"');
  });

  it('refuses a value with a line break instead of writing a second assignment', () => {
    expect(() => saveKeys(dir, { DEEPGRAM_API_KEY: 'a\nOTHER_SETTING=stolen' }, {} as NodeJS.ProcessEnv))
      .toThrow(/line break/);
    expect(fs.existsSync(envPath(dir))).toBe(false);
  });

  it('refuses an unknown variable name', () => {
    expect(() => saveKeys(dir, { PATH: '/tmp' } as never, {} as NodeJS.ProcessEnv)).toThrow(/Unknown key/);
  });

  it('refuses an empty value', () => {
    expect(() => saveKeys(dir, { DEEPGRAM_API_KEY: '  ' }, {} as NodeJS.ProcessEnv)).toThrow(/empty/);
  });
});

describe('reloadKeys', () => {
  it('picks up a .env the tester edited by hand', () => {
    fs.writeFileSync(envPath(dir), 'DEEPGRAM_API_KEY=typed-by-hand\n');
    const env = {} as NodeJS.ProcessEnv;
    expect(reloadKeys(dir, env).present.DEEPGRAM_API_KEY).toBe(true);
    expect(env.DEEPGRAM_API_KEY).toBe('typed-by-hand');
  });

  it('is a no-op when there is no file', () => {
    const env = {} as NodeJS.ProcessEnv;
    expect(reloadKeys(dir, env).present.DEEPGRAM_API_KEY).toBe(false);
  });
});
