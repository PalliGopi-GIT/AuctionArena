import type { StoredRoom } from '../../room-runtime/src/record';
import { boundStoredRoom } from '../../room-runtime/src/record';
import { assertRoomTransition, assertSynchronousChange, assertSynchronousUpdate, type RoomChange, type RoomStorage } from './port';

/** Ephemeral adapter for tests and single-process use. Not durable across restarts. */
export class MemoryRoomStorage implements RoomStorage {
  private entry: StoredRoom | null = null;
  read() { return structuredClone(this.entry); }
  transaction<T>(update: (current: StoredRoom | null) => RoomChange<T>): T {
    assertSynchronousUpdate(update);
    const change = update(this.read()); assertSynchronousChange(change);
    const next = structuredClone(change.next); if (next) boundStoredRoom(next);
    assertRoomTransition(this.entry, next);
    this.entry = next; return change.result;
  }
}
