import type { StoredRoom, Receipt } from '../../room-runtime/src/record';
import { boundStoredRoom } from '../../room-runtime/src/record';
import type { AuctionEvent } from '../../shared/src/domain';
import { assertRoomTransition, assertSynchronousChange, assertSynchronousUpdate, type RoomChange, type RoomStorage, type SqlDriver } from './port';

export const ROOM_SCHEMA_VERSION = 1;
interface StoredRows {
  state: string | null;
  events: Map<number, string>;
  receipts: Map<string, string>;
}
/** SQLite schema v1: financial state, recent events and receipts commit together. */
export class SqliteRoomStorage implements RoomStorage {
  constructor(private sql: SqlDriver) {
    this.ensureSchema();
  }
  /**
   * Idempotent schema creation. A permanent room deletion clears all Durable
   * Object storage, so the empty room schema is recreated before the object can
   * serve an idempotent retry or a later room that reuses the code.
   */
  ensureSchema() {
    this.sql.transaction(() => {
      this.sql.run('CREATE TABLE IF NOT EXISTS room_schema (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL)');
      const version = this.sql.all('SELECT version FROM room_schema WHERE id=1')[0]?.version;
      if (version !== undefined && version !== ROOM_SCHEMA_VERSION) throw new Error(`Unsupported room schema version: ${version}`);
      this.sql.run('CREATE TABLE IF NOT EXISTS room_state (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL)');
      this.sql.run('CREATE TABLE IF NOT EXISTS room_events (version INTEGER PRIMARY KEY, data TEXT NOT NULL)');
      this.sql.run('CREATE TABLE IF NOT EXISTS room_receipts (id TEXT PRIMARY KEY, ordinal INTEGER NOT NULL UNIQUE, data TEXT NOT NULL)');
      this.sql.run('INSERT OR IGNORE INTO room_schema (id, version) VALUES (1, ?)', ROOM_SCHEMA_VERSION);
    });
  }
  read(): StoredRoom | null { return this.readRecord(); }
  private readRecord(original?: StoredRows): StoredRoom | null {
    const state = this.sql.all('SELECT data FROM room_state WHERE id=1')[0]; if (!state) return null;
    const data = String(state.data);
    if (original) original.state = data;
    const entry = JSON.parse(data) as StoredRoom;
    entry.room.history = this.sql.all('SELECT data FROM room_events ORDER BY version').map(row => {
      const json = String(row.data), event = JSON.parse(json) as AuctionEvent;
      original?.events.set(event.version, json);
      return event;
    });
    entry.receipts = Object.fromEntries(this.sql.all('SELECT id, data FROM room_receipts ORDER BY ordinal').map(row => {
      const id = String(row.id), json = String(row.data);
      original?.receipts.set(id, json);
      return [id, JSON.parse(json) as Receipt];
    }));
    return entry;
  }
  transaction<T>(update: (current: StoredRoom | null) => RoomChange<T>): T {
    assertSynchronousUpdate(update);
    return this.sql.transaction(() => {
      // SQL returns detached values. Keep its immutable bytes for the write diff
      // and the original identity for the transition guard before handing the
      // freshly parsed record to a callback that may mutate it in place.
      const original: StoredRows = { state: null, events: new Map(), receipts: new Map() };
      const current = this.readRecord(original);
      const identity = current && { room: { code: current.room.code, version: current.room.version } };
      const change = update(current);
      assertSynchronousChange(change);
      const value = change.next;
      // Retention replaces the history array and removes receipt keys. Isolate
      // those containers so it cannot mutate the caller's result or input.
      const next = value && { ...value, room: { ...value.room }, receipts: { ...value.receipts } };
      if (next) boundStoredRoom(next);
      assertRoomTransition(identity, next);
      this.write(original, next); return change.result;
    });
  }
  private write(original: StoredRows, next: StoredRoom | null) {
    if (!next) { this.sql.run('DELETE FROM room_events'); this.sql.run('DELETE FROM room_receipts'); this.sql.run('DELETE FROM room_state'); return; }
    const { history, ...room } = next.room;
    const state = JSON.stringify({ room, inviteHash: next.inviteHash, inviteExpires: next.inviteExpires });
    if (state !== original.state) this.sql.run('INSERT INTO room_state (id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data', state);
    const retained = new Set(history.map(event => event.version));
    for (const version of original.events.keys()) if (!retained.has(version)) this.sql.run('DELETE FROM room_events WHERE version=?', version);
    for (const event of history) {
      const data = JSON.stringify(event);
      if (original.events.get(event.version) !== data) this.sql.run('INSERT INTO room_events (version, data) VALUES (?, ?) ON CONFLICT(version) DO UPDATE SET data=excluded.data', event.version, data);
    }
    for (const id of original.receipts.keys()) if (!Object.prototype.hasOwnProperty.call(next.receipts, id)) this.sql.run('DELETE FROM room_receipts WHERE id=?', id);
    let ordinal = Number(this.sql.all('SELECT COALESCE(MAX(ordinal), 0) AS ordinal FROM room_receipts')[0]!.ordinal);
    for (const [id, receipt] of Object.entries(next.receipts)) {
      const data = JSON.stringify(receipt), old = original.receipts.get(id);
      if (old === undefined) this.sql.run('INSERT INTO room_receipts (id, ordinal, data) VALUES (?, ?, ?)', id, ++ordinal, data);
      else if (old !== data) this.sql.run('UPDATE room_receipts SET data=? WHERE id=?', data, id);
    }
  }
}
