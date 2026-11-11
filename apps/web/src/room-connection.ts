import type { Room } from '../../../packages/shared/src/domain';

export interface Snapshot { room: Room; serverNow: number }
export function isCurrentSnapshot(current: Snapshot | null, incoming: Snapshot, code: string) {
  return incoming.room.code === code && (!current || current.room.code !== code ||
    (incoming.room.version >= current.room.version && incoming.serverNow >= current.serverNow));
}

/** One room subscription. Disposal invalidates every pending response and retry. */
export function connectRoom(options: {
  code: string;
  request: (path: string, body?: unknown) => Promise<any>;
  socket: (ticket: string) => WebSocket;
  snapshot: (snapshot: Snapshot) => void;
  connection: (connected: boolean) => void;
  accessLost?: (message: string) => void;
  pollMs?: number;
  retryMs?: number;
}) {
  let stopped = false;
  let polling = false;
  let socket: WebSocket | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let interval: ReturnType<typeof setInterval> | undefined;
  let retryDelay = options.retryMs ?? 1000;
  const path = `/rooms/${options.code}`;
  const stop = () => { stopped = true; clearInterval(interval); clearTimeout(retry); socket?.close(); };
  const deny = (message: string) => { if (stopped) return; stop(); options.connection(false); options.accessLost?.(message); };
  const denied = (error: unknown) => {
    const code = (error as { code?: string })?.code;
    if (code && ['ROOM_BLOCKED', 'FORBIDDEN', 'ROOM_NOT_FOUND', 'SESSION_EXPIRED', 'UNAUTHORIZED'].includes(code)) {
      deny(error instanceof Error ? error.message : 'Your access to this room has ended.');
      return true;
    }
    return false;
  };
  const accept = (data: Snapshot) => {
    if (!stopped && data.room?.code === options.code) options.snapshot(data);
  };
  async function poll() {
    if (stopped || polling) return;
    polling = true;
    try { accept(await options.request(path)); }
    catch (error) { if (!denied(error) && !stopped) options.connection(false); }
    finally { polling = false; }
  }
  function reconnect() {
    if (stopped || retry) return;
    retry = setTimeout(() => { retry = undefined; void open(); }, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 8000);
  }
  async function open() {
    try {
      const { ticket } = await options.request(`${path}/ws-ticket`, {});
      if (stopped) return;
      socket = options.socket(ticket);
      socket.onopen = () => { retryDelay = options.retryMs ?? 1000; };
      socket.onmessage = event => {
        if (stopped) return;
        try { const data = JSON.parse(event.data); if (data.room) accept(data); }
        catch { options.connection(false); socket?.close(); }
      };
      socket.onclose = event => {
        if (stopped) return;
        if (event.code === 1008) { deny('Your access to this room has ended.'); return; }
        options.connection(false); void poll(); reconnect();
      };
      socket.onerror = () => socket?.close();
    } catch (error) { if (!denied(error)) reconnect(); }
  }
  options.connection(false);
  void poll();
  void open();
  interval = setInterval(() => {
    void poll();
    if (socket?.readyState === 1) socket.send(JSON.stringify({ type: 'ping' }));
  }, options.pollMs ?? 2000);
  return stop;
}
