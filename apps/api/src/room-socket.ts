import type { Room, User } from '../../../packages/shared/src/domain';
import { RuleError } from '../../../packages/engine/src/index';
import type { LocalRoomStore } from '../../realtime/src/store';

interface RoomSocket {
  readyState: number;
  bufferedAmount: number;
  send: (data: string) => unknown;
  close: (code?: number, reason?: string) => unknown;
  on: (event: string, listener: (...args: any[]) => void) => unknown;
}

/** Re-authorize each delivery, including sockets admitted before a removal. */
export function attachRoomSocket(store: LocalRoomStore, code: string, user: User, socket: RoomSocket, clock = Date.now) {
  const fail = (error: unknown) => {
    const denied = error instanceof RuleError && ['FORBIDDEN', 'ROOM_BLOCKED', 'ROOM_NOT_FOUND','ACCOUNT_DELETED'].includes(error.code);
    socket.close(denied ? 1008 : 1011, denied ? 'Room access ended' : 'Persistence unavailable');
  };
  const send = (room: Room) => {
    if (room.code !== code || socket.readyState !== 1) return false;
    try { store.get(code, user); } catch (error) { fail(error); return false; }
    if (socket.bufferedAmount > 256 * 1024) { socket.close(1013, 'Slow connection; reconnect'); return false; }
    socket.send(JSON.stringify({ type: 'snapshot', room, serverNow: clock() }));
    return true;
  };
  try { if (!send(store.get(code, user, true))) return; }
  catch (error) { fail(error); return; }
  store.on('room', send);
  const accessEnded=(subject:string)=>{if(subject===user.id)socket.close(1008,'Account access ended');};
  store.on('access-ended',accessEnded);
  socket.on('message', (raw: unknown) => {
    try {
      store.get(code, user, true);
      let message: { type?: unknown; clientSentAt?: unknown };
      try { message = JSON.parse(String(raw)); } catch { return; }
      if (message && message.type === 'ping' && typeof message.clientSentAt === 'number' && Number.isSafeInteger(message.clientSentAt) && message.clientSentAt >= 0 && socket.readyState === 1) {
        if (socket.bufferedAmount > 256 * 1024) { socket.close(1013, 'Slow connection; reconnect'); return; }
        socket.send(JSON.stringify({ type: 'pong', clientSentAt: message.clientSentAt, serverNow: clock() }));
      }
    } catch (error) { fail(error); }
  });
  socket.on('error', () => socket.close());
  socket.on('close', () => {store.off('room', send);store.off('access-ended',accessEnded);});
}
