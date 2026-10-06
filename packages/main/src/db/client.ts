import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { applySchema } from './schema';

let _db: Database.Database | null = null;

export function getDb(dbPath?: string): Database.Database {
  if (_db) return _db;
  const resolvedPath = dbPath ?? defaultDbPath();
  fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
  _db = new Database(resolvedPath);
  _db.pragma('journal_mode = WAL');
  _db.pragma('foreign_keys = ON');
  applySchema(_db);
  return _db;
}

export function closeDb(): void {
  _db?.close();
  _db = null;
}

// Only reachable when getDb() is called without a path before the app has
// resolved its userData dir — which the app never does. The old fallback here
// pointed at `.config/turingram` (the real dir is `turingram-workspace`) and
// degraded to a literal './~' with no HOME, silently creating a second, empty
// database. Fail loudly instead: a caller without a path is a bug.
function defaultDbPath(): string {
  const base = process.env.TURINGRAM_DATA_DIR;
  if (!base) throw new Error('getDb() called before a database path was provided (set TURINGRAM_DATA_DIR or pass the path)');
  return path.join(base, 'meetings.db');
}
