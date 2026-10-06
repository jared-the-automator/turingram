import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { applySchema } from '../schema';

describe('applySchema', () => {
  let db: Database.Database;

  beforeEach(() => { db = new Database(':memory:'); });
  afterEach(() => { db.close(); });

  it('creates meetings table', () => {
    applySchema(db);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    expect(tables.map(t => t.name)).toContain('meetings');
  });

  it('creates segments table', () => {
    applySchema(db);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    expect(tables.map(t => t.name)).toContain('segments');
  });

  it('creates segments_fts virtual table', () => {
    applySchema(db);
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
    expect(tables.map(t => t.name)).toContain('segments_fts');
  });

  it('is idempotent — can be called twice without error', () => {
    applySchema(db);
    expect(() => applySchema(db)).not.toThrow();
  });
});
