import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { buildReadme, writeAgentReadme, README_FILE } from '../agentDocs';

describe('the transcripts README', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'te-docs-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('is written into the folder it describes', () => {
    writeAgentReadme(path.join(dir, 'transcripts'));
    expect(existsSync(path.join(dir, 'transcripts', README_FILE))).toBe(true);
  });

  it('names the actual path, not a placeholder', () => {
    writeAgentReadme(path.join(dir, 'transcripts'));
    const text = readFileSync(path.join(dir, 'transcripts', README_FILE), 'utf8');
    expect(text).toContain(path.join(dir, 'transcripts'));
  });

  // The two things an agent reading raw JSON has no way to infer, and both
  // produce confidently wrong summaries when guessed.
  it('explains the two units that are easy to confuse', () => {
    const text = buildReadme('/somewhere');
    expect(text).toContain('epoch milliseconds');
    expect(text).toContain('seconds from the start of the recording');
  });

  it('says who "You" is', () => {
    expect(buildReadme('/somewhere')).toMatch(/`You` is the user/);
  });

  // The user can point this folder at their own vault, so an agent arriving
  // here should not assume every file around it is Turingram's to read.
  it('warns that neighbouring files may not be ours', () => {
    expect(buildReadme('/somewhere')).toMatch(/not listed in `index\.json` is theirs/);
  });

  // Rewriting an unchanged file churns mtime, which anything watching the
  // directory sees as a new meeting arriving.
  it('does not rewrite when nothing changed', () => {
    writeAgentReadme(path.join(dir, 'transcripts'));
    const dest = path.join(dir, 'transcripts', README_FILE);
    writeFileSync(dest, buildReadme(path.join(dir, 'transcripts')));
    const before = readFileSync(dest, 'utf8');
    writeAgentReadme(path.join(dir, 'transcripts'));
    expect(readFileSync(dest, 'utf8')).toBe(before);
  });
});
