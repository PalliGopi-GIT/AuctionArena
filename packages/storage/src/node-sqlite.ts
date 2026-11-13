import { DatabaseSync } from 'node:sqlite';
import type { SqlDriver, SqlValue } from './port';

/** Local parity-test adapter only. Production uses the Durable Object transaction API. */
export class NodeSqliteDriver implements SqlDriver {
  private db: DatabaseSync;
  private closed = false;
  private active = false;
  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
  }
  all(query: string, ...bindings: SqlValue[]) { return this.db.prepare(query).all(...bindings) as Record<string, SqlValue>[]; }
  run(query: string, ...bindings: SqlValue[]) { this.db.prepare(query).run(...bindings); }
  transaction<T>(callback: () => T): T {
    if (this.active) throw new Error('Nested SQLite transactions are unsupported.');
    this.db.exec('BEGIN IMMEDIATE'); this.active = true;
    try { const value = callback(); this.db.exec('COMMIT'); return value; }
    catch (error) { this.db.exec('ROLLBACK'); throw error; }
    finally { this.active = false; }
  }
  close() { if (!this.closed) { this.db.close(); this.closed = true; } }
}
