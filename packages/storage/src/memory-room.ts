import type { StoredRoom } from '../../room-runtime/src/record';
import { boundStoredRoom } from '../../room-runtime/src/record';
import { assertSynchronousChange, type RoomChange, type RoomStorage } from './port';

export class MemoryRoomStorage implements RoomStorage {
  private entry: StoredRoom | null = null;
  read() { return structuredClone(this.entry); }
  transaction<T>(update: (current: StoredRoom | null) => RoomChange<T>): T {
    const change = update(this.read()); assertSynchronousChange(change);
    const next = structuredClone(change.next); if (next) boundStoredRoom(next);
    this.entry = next; return change.result;
  }
}
