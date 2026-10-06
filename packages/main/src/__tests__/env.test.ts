import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { parseEnv, loadEnvFiles } from '../env';

describe('parseEnv', () => {
  it('reads plain KEY=value pairs', () => {
    expect(parseEnv('DEEPGRAM_API_KEY=abc123\nGEMINI_API_KEY=xyz'))
      .toEqual({ DEEPGRAM_API_KEY: 'abc123', GEMINI_API_KEY: 'xyz' });
  });

  it('ignores comments and blank lines', () => {
    expect(parseEnv('# a comment\n\n  \nKEY=value\n')).toEqual({ KEY: 'value' });
  });

  it('tolerates export prefixes and surrounding whitespace', () => {
    expect(parseEnv('  export  KEY =  value  ')).toEqual({ KEY: 'value' });
  });

  it('strips one pair of surrounding quotes', () => {
    expect(parseEnv('A="dq"\nB=\'sq\'')).toEqual({ A: 'dq', B: 'sq' });
  });

  it('keeps characters that appear inside a key, like = and #', () => {
    // Real API keys contain base64 padding and other punctuation.
    expect(parseEnv('K=abc==\nJ="tok#en"')).toEqual({ K: 'abc==', J: 'tok#en' });
  });

  it('drops a trailing comment from an unquoted value', () => {
    expect(parseEnv('K=value # trailing note')).toEqual({ K: 'value' });
  });

  it('skips entries with an empty value rather than setting a blank key', () => {
    expect(parseEnv('EMPTY=\nSET=x')).toEqual({ SET: 'x' });
  });

  it('ignores malformed lines', () => {
    expect(parseEnv('not an assignment\n=novalue\n9BAD=x\nOK=1')).toEqual({ OK: '1' });
  });
});

describe('loadEnvFiles', () => {
  const dirs: string[] = [];
  const mk = () => { const d = mkdtempSync(path.join(tmpdir(), 'te-env-')); dirs.push(d); return d; };
  afterEach(() => {
    dirs.splice(0).forEach(d => rmSync(d, { recursive: true, force: true }));
    delete process.env.TG_TEST_KEY;
    delete process.env.TG_TEST_OTHER;
  });

  it('loads a file and reports which paths it used', () => {
    const dir = mk();
    writeFileSync(path.join(dir, '.env'), 'TG_TEST_KEY=from-file');
    const used = loadEnvFiles([path.join(dir, '.env')]);
    expect(process.env.TG_TEST_KEY).toBe('from-file');
    expect(used).toEqual([path.join(dir, '.env')]);
  });

  it('skips missing files without throwing', () => {
    const dir = mk();
    expect(loadEnvFiles([path.join(dir, 'nope.env')])).toEqual([]);
  });

  // The whole point of the ordering: a stale exported variable once shadowed the
  // real key and the only symptom was a generic "API key not valid".
  it('lets the file override an already-exported variable', () => {
    const dir = mk();
    process.env.TG_TEST_KEY = 'stale-ambient';
    writeFileSync(path.join(dir, '.env'), 'TG_TEST_KEY=correct');
    loadEnvFiles([path.join(dir, '.env')]);
    expect(process.env.TG_TEST_KEY).toBe('correct');
  });

  // Order is load-bearing: index.ts lists the operator-provisioned data-dir .env
  // FIRST so a leftover development .env cannot silently override production
  // credentials. A naive implementation applies files in sequence and lets the
  // last one win, which is exactly backwards.
  it('lets the first file win over a later one', () => {
    const first = mk(); const second = mk();
    writeFileSync(path.join(first, '.env'), 'TG_TEST_KEY=from-first');
    writeFileSync(path.join(second, '.env'), 'TG_TEST_KEY=from-second\nTG_TEST_OTHER=only-in-second');
    loadEnvFiles([path.join(first, '.env'), path.join(second, '.env')]);
    expect(process.env.TG_TEST_KEY).toBe('from-first');
    // A later file still contributes keys the earlier one did not define.
    expect(process.env.TG_TEST_OTHER).toBe('only-in-second');
  });
});
