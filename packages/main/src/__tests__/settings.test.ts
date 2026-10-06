import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { loadSettings, saveSettings } from '../settings';
import { DEFAULT_SETTINGS } from '@turingyde/transcript-core';

describe('settings', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'te-settings-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('returns defaults when no file exists', () => {
    const s = loadSettings(dir);
    expect(s.transcriptionEngine).toBe('deepgram');
    expect(s.keepRecordings).toBe(false);
    expect(s.confirmBeforeDelete).toBe(true);
  });

  it('persists and reloads settings', () => {
    saveSettings(dir, { ...DEFAULT_SETTINGS, transcriptionEngine: 'gemini-paid', keepRecordings: true });
    const s = loadSettings(dir);
    expect(s.transcriptionEngine).toBe('gemini-paid');
    expect(s.keepRecordings).toBe(true);
  });

  it('merges saved file with defaults for missing keys', () => {
    writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ keepRecordings: true }));
    const s = loadSettings(dir);
    expect(s.keepRecordings).toBe(true);
    expect(s.transcriptionEngine).toBe('deepgram');
    expect(s.vocabulary).toContain('Turingram');
  });

  it('returns defaults when settings file is corrupt', () => {
    writeFileSync(path.join(dir, 'settings.json'), 'not-json');
    const s = loadSettings(dir);
    expect(s.transcriptionEngine).toBe('deepgram');
  });

  it('vocabulary defaults to seeded list and round-trips', () => {
    const s = loadSettings(dir);
    expect(Array.isArray(s.vocabulary)).toBe(true);
    expect(s.vocabulary.length).toBeGreaterThan(0);
    expect(s.vocabulary).toContain('Turingram');

    saveSettings(dir, { ...s, vocabulary: ['Initech', 'Acme'] });
    const s2 = loadSettings(dir);
    expect(s2.vocabulary).toEqual(['Initech', 'Acme']);
  });

  it('resets an unknown transcriptionEngine to the default', () => {
    writeFileSync(path.join(dir, 'settings.json'),
      JSON.stringify({ ...DEFAULT_SETTINGS, transcriptionEngine: 'skynet' }));
    expect(['deepgram', 'gemini-free', 'gemini-paid']).toContain(loadSettings(dir).transcriptionEngine);
  });
});
