import type { StoredRoom } from '../../room-runtime/src/record';

export interface RoomChange<T> { next: StoredRoom | null; result: T }
/** One room per storage instance. Reads and callbacks receive detached values. */
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
export function assertSynchronousChange<T>(change: RoomChange<T>): void {
  if (!change || !Object.prototype.hasOwnProperty.call(change, 'next') ||
      typeof (change as any).then === 'function' || typeof (change.result as any)?.then === 'function') {
    throw new Error('Room transactions must be synchronous.');
  }
}
