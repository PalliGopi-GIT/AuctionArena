import type { StoredRoom, Receipt } from '../../room-runtime/src/record';
import { boundStoredRoom } from '../../room-runtime/src/record';
import type { AuctionEvent } from '../../shared/src/domain';
import { assertSynchronousChange, type RoomChange, type RoomStorage, type SqlDriver } from './port';

/** SQLite schema v1: financial state, recent events and receipts commit together. */
export class SqliteRoomStorage implements RoomStorage {
  constructor(private sql: SqlDriver) {
    sql.transaction(() => {
      sql.run('CREATE TABLE IF NOT EXISTS room_schema (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL)');
      const version = sql.all('SELECT version FROM room_schema WHERE id=1')[0]?.version;
      if (version !== undefined && version !== 1) throw new Error(`Unsupported room schema version: ${version}`);
      sql.run('CREATE TABLE IF NOT EXISTS room_state (id INTEGER PRIMARY KEY CHECK(id=1), data TEXT NOT NULL)');
      sql.run('CREATE TABLE IF NOT EXISTS room_events (version INTEGER PRIMARY KEY, data TEXT NOT NULL)');
      sql.run('CREATE TABLE IF NOT EXISTS room_receipts (id TEXT PRIMARY KEY, ordinal INTEGER NOT NULL UNIQUE, data TEXT NOT NULL)');
      sql.run('INSERT OR IGNORE INTO room_schema (id, version) VALUES (1, 1)');
    });
  }
  read(): StoredRoom | null {
    const state = this.sql.all('SELECT data FROM room_state WHERE id=1')[0]; if (!state) return null;
    const entry = JSON.parse(String(state.data)) as StoredRoom;
    entry.room.history = this.sql.all('SELECT data FROM room_events ORDER BY version').map(row => JSON.parse(String(row.data)) as AuctionEvent);
    entry.receipts = Object.fromEntries(this.sql.all('SELECT id, data FROM room_receipts ORDER BY ordinal').map(row => [String(row.id), JSON.parse(String(row.data)) as Receipt]));
    return entry;
  }
  transaction<T>(update: (current: StoredRoom | null) => RoomChange<T>): T {
    return this.sql.transaction(() => {
      const current = this.read(), change = update(structuredClone(current)); assertSynchronousChange(change);
      const next = structuredClone(change.next); if (next) boundStoredRoom(next);
      this.write(current, next); return change.result;
    });
  }
  private write(previous: StoredRoom | null, next: StoredRoom | null) {
    if (!next) { this.sql.run('DELETE FROM room_events'); this.sql.run('DELETE FROM room_receipts'); this.sql.run('DELETE FROM room_state'); return; }
    const { history, ...room } = next.room;
    const state = JSON.stringify({ room, inviteHash: next.inviteHash, inviteExpires: next.inviteExpires });
    const oldState = previous ? JSON.stringify({ room: Object.fromEntries(Object.entries(previous.room).filter(([key]) => key !== 'history')), inviteHash: previous.inviteHash, inviteExpires: previous.inviteExpires }) : null;
    if (state !== oldState) this.sql.run('INSERT INTO room_state (id, data) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data', state);
    const oldEvents = new Map(previous?.room.history.map(event => [event.version, JSON.stringify(event)]) ?? []);
    const retained = new Set(history.map(event => event.version));
    for (const version of oldEvents.keys()) if (!retained.has(version)) this.sql.run('DELETE FROM room_events WHERE version=?', version);
    for (const event of history) {
      const data = JSON.stringify(event);
      if (oldEvents.get(event.version) !== data) this.sql.run('INSERT INTO room_events (version, data) VALUES (?, ?) ON CONFLICT(version) DO UPDATE SET data=excluded.data', event.version, data);
    }
    for (const id of Object.keys(previous?.receipts ?? {})) if (!Object.prototype.hasOwnProperty.call(next.receipts, id)) this.sql.run('DELETE FROM room_receipts WHERE id=?', id);
    let ordinal = Number(this.sql.all('SELECT COALESCE(MAX(ordinal), 0) AS ordinal FROM room_receipts')[0]!.ordinal);
    for (const [id, receipt] of Object.entries(next.receipts)) {
      const data = JSON.stringify(receipt), old = previous?.receipts[id];
      if (!old) this.sql.run('INSERT INTO room_receipts (id, ordinal, data) VALUES (?, ?, ?)', id, ++ordinal, data);
      else if (JSON.stringify(old) !== data) this.sql.run('UPDATE room_receipts SET data=? WHERE id=?', data, id);
    }
  }
}
