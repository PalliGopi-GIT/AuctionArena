import type { StoredRoom } from '../../room-runtime/src/record';

export interface RoomChange<T> { next: StoredRoom | null; result: T }
/**
 * One room per storage instance. Reads and callbacks receive detached values.
 *
 * `transaction` maps directly to Durable Object `ctx.storage.transactionSync`:
 * the callback and every read/write it performs must stay synchronous. The
 * runtime adapter supplies the transaction boundary; this package never awaits.
 */
export interface RoomStorage {
  read(): StoredRoom | null;
  /** Synchronous atomic read/modify/write. An exception rolls back every write. */
  transaction<T>(update: (current: StoredRoom | null) => RoomChange<T>): T;
}
export type SqlValue = string | number | null;
/** Runtime adapter owns transaction semantics (e.g. DO storage.transactionSync). */
export interface SqlDriver {
  all(query: string, ...bindings: SqlValue[]): Record<string, SqlValue>[];
  run(query: string, ...bindings: SqlValue[]): void;
  transaction<T>(callback: () => T): T;
}
export function assertSynchronousUpdate<T>(update: (current: StoredRoom | null) => RoomChange<T>): void {
  if (typeof update !== 'function' || update.constructor?.name === 'AsyncFunction') {
    throw new Error('Room transactions must be synchronous.');
  }
}
export function assertSynchronousChange<T>(change: RoomChange<T>): void {
  if (!change || typeof change !== 'object' || !Object.prototype.hasOwnProperty.call(change, 'next') ||
      change.next === undefined || typeof (change as any).then === 'function' ||
      typeof (change.next as any)?.then === 'function' || typeof (change.result as any)?.then === 'function') {
    throw new Error('Room transactions must be synchronous.');
  }
}
/** A per-room instance may not change identity or move its version backwards. */
export function assertRoomTransition(previous: { room: Pick<StoredRoom['room'], 'code' | 'version'> } | null, next: StoredRoom | null): void {
  if (!next) return;
  if (!next.room || typeof next.room.code !== 'string' || !next.room.code) throw new Error('Invalid room state.');
  if (previous) {
    if (next.room.code !== previous.room.code) throw new Error('Room identity changed within its storage instance.');
    if (next.room.version < previous.room.version) throw new Error('Room version moved backwards.');
  }
}
