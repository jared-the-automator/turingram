import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { removeMeetingArtifacts } from '../artifacts';

describe('removeMeetingArtifacts', () => {
  let dir: string;
  const id = 'a1b2c3d4';
  const hookName = '2026-05-28-client-call-0100-0142.json';

  // Transcripts are named for their title and date, so the fixture uses a real
  // name — the id lives inside the file, which is what deletion has to match on.
  const writeHook = (name: string, hookId: string) =>
    writeFileSync(path.join(dir, 'transcripts', name), JSON.stringify({
      id: hookId, title: 'Client call', startedAt: 1748394000000,
      durationSec: 2520, segments: [],
    }));

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'te-artifacts-'));
    mkdirSync(path.join(dir, 'recordings'), { recursive: true });
    mkdirSync(path.join(dir, 'transcripts'), { recursive: true });
    writeFileSync(path.join(dir, 'recordings', `${id}.wav`), 'audio');
    writeFileSync(path.join(dir, 'recordings', `${id}_pre.wav`), 'audio');
    writeHook(hookName, id);
  });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  // The JSON is a full transcript readable by anything on the filesystem —
  // a discarded meeting leaving it behind is a privacy leak, not just clutter.
  it('removes audio, preprocessed audio, and the transcript JSON', () => {
    removeMeetingArtifacts(dir, path.join(dir, 'transcripts'), id);
    expect(existsSync(path.join(dir, 'recordings', `${id}.wav`))).toBe(false);
    expect(existsSync(path.join(dir, 'recordings', `${id}_pre.wav`))).toBe(false);
    expect(existsSync(path.join(dir, 'transcripts', hookName))).toBe(false);
  });

  // The filename follows a title the user can change, so deletion cannot match
  // on it. Matching by name would leave a deleted meeting fully readable on disk
  // for anyone who had ever renamed it — the exact leak this function prevents.
  it('deletes the transcript however the file happens to be named', () => {
    rmSync(path.join(dir, 'transcripts', hookName));
    writeHook('some-title-the-user-picked-later.json', id);
    removeMeetingArtifacts(dir, path.join(dir, 'transcripts'), id);
    expect(existsSync(path.join(dir, 'transcripts', 'some-title-the-user-picked-later.json'))).toBe(false);
  });

  it('leaves other meetings alone', () => {
    writeHook('2026-05-28-someone-else-0300-0330.json', 'other');
    removeMeetingArtifacts(dir, path.join(dir, 'transcripts'), id);
    expect(existsSync(path.join(dir, 'transcripts', '2026-05-28-someone-else-0300-0330.json'))).toBe(true);
  });

  it('does not throw when the files are already gone', () => {
    removeMeetingArtifacts(dir, path.join(dir, 'transcripts'), id);
    expect(() => removeMeetingArtifacts(dir, path.join(dir, 'transcripts'), id)).not.toThrow();
  });

  it('refuses ids that could escape the data directory', () => {
    removeMeetingArtifacts(dir, path.join(dir, 'transcripts'), '../../etc');
    expect(existsSync(path.join(dir, 'recordings', `${id}.wav`))).toBe(true);
  });
});
