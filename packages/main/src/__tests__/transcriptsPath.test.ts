import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import {
  defaultTranscriptsDir, resolveTranscriptsDir, moveTranscripts, checkWritableDir, ownedFiles,
} from '../transcriptsPath';

describe('resolveTranscriptsDir', () => {
  const dataDir = '/data';

  it('defaults to a folder inside the app data dir', () => {
    expect(resolveTranscriptsDir(dataDir)).toBe(path.join(dataDir, 'transcripts'));
    expect(resolveTranscriptsDir(dataDir, { transcriptsDir: null })).toBe(defaultTranscriptsDir(dataDir));
  });

  it('uses the chosen directory as given, not nested under it', () => {
    // The user picked their vault; transcripts go IN it, not in a subfolder
    // they did not ask for. Built with path.resolve rather than written as a
    // POSIX literal: on Windows a bare '/home/j/...' resolves against the
    // current drive, so the literal form failed on the Windows runner while
    // testing nothing about the behavior this case exists to pin.
    const chosen = path.resolve(path.join(path.sep, 'home', 'j', 'vault', 'meetings'));
    expect(resolveTranscriptsDir(dataDir, { transcriptsDir: chosen })).toBe(chosen);
  });

  it('resolves a relative setting to an absolute path', () => {
    expect(path.isAbsolute(resolveTranscriptsDir(dataDir, { transcriptsDir: 'notes' }))).toBe(true);
  });

  // A settings.json hand-edited to "" would otherwise resolve to the process cwd
  // and scatter transcripts wherever the app happened to be launched from.
  it('falls back to the default for an empty or whitespace setting', () => {
    expect(resolveTranscriptsDir(dataDir, { transcriptsDir: '' })).toBe(defaultTranscriptsDir(dataDir));
    expect(resolveTranscriptsDir(dataDir, { transcriptsDir: '   ' })).toBe(defaultTranscriptsDir(dataDir));
  });
});

// What a real transcript file minimally looks like — ownedFiles matches on this
// signature, not on the id alone.
const transcriptJson = (id: string) =>
  JSON.stringify({ id, startedAt: 1_700_000_000_000, segments: [] });

describe('moveTranscripts', () => {
  let root: string;
  let from: string;
  let to: string;

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'te-move-'));
    from = path.join(root, 'old');
    to = path.join(root, 'new');
    mkdirSync(from, { recursive: true });
    writeFileSync(path.join(from, 'a.json'), transcriptJson('a'));
    writeFileSync(path.join(from, 'b.json'), transcriptJson('b'));
    writeFileSync(path.join(from, 'README.md'), 'docs');
  });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  // Leaving them behind would strand every past meeting in a folder the user has
  // just said they do not look in.
  it('takes the transcripts and their docs with it', () => {
    expect(moveTranscripts(from, to)).toEqual({ moved: 3, failed: [] });
    expect(fs.readdirSync(to).sort()).toEqual(['README.md', 'a.json', 'b.json']);
    expect(fs.readdirSync(from)).toEqual([]);
  });

  it('preserves contents, not just names', () => {
    moveTranscripts(from, to);
    expect(readFileSync(path.join(to, 'a.json'), 'utf8')).toBe(transcriptJson('a'));
  });

  it('creates the destination when it does not exist yet', () => {
    expect(existsSync(to)).toBe(false);
    moveTranscripts(from, to);
    expect(existsSync(to)).toBe(true);
  });

  it('does nothing when the source and destination are the same', () => {
    expect(moveTranscripts(from, from)).toEqual({ moved: 0, failed: [] });
    expect(fs.readdirSync(from)).toHaveLength(3);
  });

  it('does nothing when there is no source folder yet', () => {
    expect(moveTranscripts(path.join(root, 'nope'), to)).toEqual({ moved: 0, failed: [] });
  });

  // A vault on another drive is the expected case, not an edge case — rename()
  // fails with EXDEV across filesystems and the copy fallback has to carry it.
  it('falls back to copy when rename crosses a filesystem boundary', () => {
    const realRename = fs.renameSync;
    const spy = vi.spyOn(fs, 'renameSync').mockImplementation(() => {
      const err = new Error('cross-device link') as NodeJS.ErrnoException;
      err.code = 'EXDEV';
      throw err;
    });
    try {
      expect(moveTranscripts(from, to)).toEqual({ moved: 3, failed: [] });
      expect(readFileSync(path.join(to, 'b.json'), 'utf8')).toBe(transcriptJson('b'));
      expect(fs.readdirSync(from)).toEqual([]);
    } finally {
      spy.mockRestore();
      expect(fs.renameSync).toBe(realRename);
    }
  });

  // The destination is a folder the user chose — a vault, a project directory —
  // so it holds their own work. Reset to default must not drag their notes into
  // the app's data directory, where they would never think to look for them.
  it('leaves files it did not write where they are', () => {
    writeFileSync(path.join(from, 'my-thoughts.md'), 'mine');
    writeFileSync(path.join(from, 'budget.json'), '{"rent":1200}');
    mkdirSync(path.join(from, 'projects'));

    expect(moveTranscripts(from, to).moved).toBe(3);
    expect(fs.readdirSync(from).sort()).toEqual(['budget.json', 'my-thoughts.md', 'projects']);
    expect(fs.readdirSync(to).sort()).toEqual(['README.md', 'a.json', 'b.json']);
  });

  // One unwritable file must not strand the other thirty-two.
  it('reports the files it could not move and keeps going', () => {
    const spy = vi.spyOn(fs, 'renameSync').mockImplementation(((src: fs.PathLike, dest: fs.PathLike) => {
      if (String(src).endsWith('b.json')) throw new Error('EACCES');
      return fs.copyFileSync(src as string, dest as string);
    }) as typeof fs.renameSync);
    try {
      const result = moveTranscripts(from, to);
      expect(result.failed).toEqual(['b.json']);
      expect(result.moved).toBe(2);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('ownedFiles', () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(path.join(tmpdir(), 'te-owned-')); });
  afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

  it('claims the index, the README, and any JSON shaped like a transcript', () => {
    writeFileSync(path.join(dir, 'index.json'), '{"count":0,"meetings":[]}');
    writeFileSync(path.join(dir, 'README.md'), 'docs');
    writeFileSync(path.join(dir, '2026-05-28-client-call-0100-0142.json'), transcriptJson('h1'));
    expect(ownedFiles(dir).sort()).toEqual([
      '2026-05-28-client-call-0100-0142.json', 'README.md', 'index.json',
    ]);
  });

  // Someone else's JSON in the same folder — a config, an export from another
  // tool — is none of our business. A string "id" alone is not enough: package
  // manifests and API dumps carry those too.
  it('claims nothing else, whatever its extension', () => {
    writeFileSync(path.join(dir, 'notes.md'), 'mine');
    writeFileSync(path.join(dir, 'tsconfig.json'), '{"compilerOptions":{}}');
    writeFileSync(path.join(dir, 'half-written.json'), '{ not json');
    writeFileSync(path.join(dir, 'numeric-id.json'), '{"id":42}');
    writeFileSync(path.join(dir, 'api-dump.json'), '{"id":"cus_123","object":"customer"}');
    expect(ownedFiles(dir)).toEqual([]);
  });

  it('returns nothing for a folder that is not there', () => {
    expect(ownedFiles(path.join(dir, 'gone'))).toEqual([]);
  });
});

describe('checkWritableDir', () => {
  let root: string;
  beforeEach(() => { root = mkdtempSync(path.join(tmpdir(), 'te-check-')); });
  afterEach(() => { rmSync(root, { recursive: true, force: true }); });

  it('accepts a writable directory', () => {
    expect(checkWritableDir(root)).toBeNull();
  });

  it('creates a directory that does not exist yet', () => {
    const fresh = path.join(root, 'vault', 'meetings');
    expect(checkWritableDir(fresh)).toBeNull();
    expect(existsSync(fresh)).toBe(true);
  });

  it('leaves no probe file behind', () => {
    checkWritableDir(root);
    expect(fs.readdirSync(root)).toEqual([]);
  });

  // Failing here means the user finds out while the picker is still open,
  // instead of every future transcript vanishing silently.
  it('rejects a path that is a file', () => {
    const file = path.join(root, 'notes.txt');
    writeFileSync(file, 'x');
    expect(checkWritableDir(file)).toBeTruthy();
  });

  // Skipped on Windows, where the setup cannot be built: Node's chmod maps only
  // to the read-only attribute and only for files, so a 0o500 directory stays
  // writable and the probe succeeds. Skipping keeps the POSIX coverage honest
  // rather than weakening the assertion to something that passes everywhere.
  it.skipIf(process.platform === 'win32')('rejects a directory it cannot write to', () => {
    const locked = path.join(root, 'locked');
    mkdirSync(locked);
    fs.chmodSync(locked, 0o500);
    try {
      expect(checkWritableDir(locked)).toBe('That folder is not writable.');
    } finally {
      fs.chmodSync(locked, 0o700);
    }
  });
});
