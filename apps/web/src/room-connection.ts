import type { Room } from '../../../packages/shared/src/domain';

export interface Snapshot { room: Room; serverNow: number; clockOffset?: number }
export function clockOffset(serverNow: number, sentAt: number, receivedAt: number) {
  return serverNow - (sentAt + (receivedAt - sentAt) / 2);
}
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
  clock?: () => number;
  syncClock?: (offset: number) => void;
  pollMs?: number;
  retryMs?: number;
}) {
  let stopped = false;
  let polling = false;
  let socket: WebSocket | undefined;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let interval: ReturnType<typeof setInterval> | undefined;
  let retryDelay = options.retryMs ?? 1000;
  const clock = options.clock ?? Date.now;
  let pingAt: number | undefined;
  let lastPingAt = 0;
  const path = `/rooms/${options.code}`;
  const stop = () => { stopped = true; clearInterval(interval); clearTimeout(retry); socket?.close(); };
  const deny = (message: string) => { if (stopped) return; stop(); options.connection(false); options.accessLost?.(message); };
  const denied = (error: unknown) => {
    const code = (error as { code?: string })?.code;
    if (code && ['ROOM_BLOCKED', 'FORBIDDEN', 'ROOM_NOT_FOUND', 'SESSION_EXPIRED', 'UNAUTHORIZED', 'ACCOUNT_DELETED'].includes(code)) {
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
    const sentAt = clock();
    try {
      const data: Snapshot = await options.request(path);
      const receivedAt = clock();
      if (!stopped && data.room?.code === options.code && Number.isFinite(data.serverNow) && receivedAt >= sentAt) {
        // The HTTP adapter starts its measurement after token retrieval, excluding auth-provider latency.
        options.syncClock?.(Number.isFinite(data.clockOffset) ? data.clockOffset! : clockOffset(data.serverNow, sentAt, receivedAt));
      }
      accept(data);
    }
    catch (error) { if (!denied(error) && !stopped) options.connection(false); }
    finally { polling = false; }
  }
  function reconnect() {
    if (stopped || retry) return;
    retry = setTimeout(() => { retry = undefined; void open(); }, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 8000);
  }
  function ping() {
    if (socket?.readyState !== 1) return;
    pingAt = clock(); lastPingAt = pingAt;
    socket.send(JSON.stringify({ type: 'ping', clientSentAt: pingAt }));
  }
  async function open() {
    try {
      const { ticket } = await options.request(`${path}/ws-ticket`, {});
      if (stopped) return;
      socket = options.socket(ticket);
      socket.onopen = () => { retryDelay = options.retryMs ?? 1000; pingAt = undefined; ping(); };
      socket.onmessage = event => {
        if (stopped) return;
        try {
          const data = JSON.parse(event.data);
          if (data.type === 'pong' && pingAt !== undefined && data.clientSentAt === pingAt && Number.isFinite(data.serverNow)) {
            const receivedAt = clock();
            if (receivedAt >= pingAt) options.syncClock?.(clockOffset(data.serverNow, pingAt, receivedAt));
            pingAt = undefined;
          }
          if (data.room) accept(data);
        }
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
    if (socket?.readyState === 1) {
      if (clock() - lastPingAt >= 30000) ping();
      else socket.send(JSON.stringify({ type: 'heartbeat' }));
    }
  }, options.pollMs ?? 2000);
  return stop;
}
