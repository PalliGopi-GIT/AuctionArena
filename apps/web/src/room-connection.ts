import type { Room } from '../../../packages/shared/src/domain';

export interface Snapshot { room: Room; serverNow: number; clockOffset?: number }
export function clockOffset(serverNow: number, sentAt: number, receivedAt: number) {
  return serverNow - (sentAt + (receivedAt - sentAt) / 2);
}

/** The Worker resolves the room from the query string and rechecks it against the signed ticket. */
export function socketUrl(protocol: string, host: string, roomCode: string) {
  return `${protocol === 'https:' ? 'wss' : 'ws'}://${host}/ws?room=${encodeURIComponent(roomCode)}`;
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
  let opening = 0;
  let generation = 0;
  let onlineHandler: (() => void) | undefined;
  const clock = options.clock ?? Date.now;
  let pingAt: number | undefined;
  let lastPingAt = 0;
  let lastVersion: number | undefined;
  const path = `/rooms/${options.code}`;
  const stop = () => {
    stopped = true; clearInterval(interval); clearTimeout(retry);
    if (onlineHandler && typeof window !== 'undefined') window.removeEventListener('online', onlineHandler);
    socket?.close();
  };
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
    if (!stopped && data.room?.code === options.code && (lastVersion === undefined || data.room.version >= lastVersion)) { lastVersion=data.room.version; options.snapshot(data); }
  };
  async function poll() {
    if (stopped || polling) return;
    polling = true;
    const sentAt = clock();
    try {
      const data: Snapshot = await options.request(lastVersion===undefined ? path : `${path}/sync?afterVersion=${lastVersion}`);
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
  /**
   * Regaining connectivity must not wait out the backoff, and a socket that was
   * open when the network dropped can look alive to the browser. Replace it.
   */
  function resume() {
    if (stopped) return;
    retryDelay = options.retryMs ?? 1000;
    if (retry) { clearTimeout(retry); retry = undefined; }
    if (socket && socket.readyState !== 3) {
      socket.onclose = null;
      try { socket.close(); } catch { /* already closed */ }
    }
    socket = undefined; pingAt = undefined;
    generation++; opening = 0;
    void open();
    void poll();
  }
  function ping() {
    if (socket?.readyState !== 1) return;
    pingAt = clock(); lastPingAt = pingAt;
    socket.send(JSON.stringify({ type: 'ping', clientSentAt: pingAt }));
  }
  async function open() {
    if (stopped || opening) return;
    const attempt = ++generation;
    opening = attempt;
    try {
      const { ticket } = await options.request(`${path}/ws-ticket`, {});
      if (stopped || attempt !== generation) return;
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
    } catch (error) { if (!denied(error) && attempt === generation) reconnect(); }
    finally { if (opening === attempt) opening = 0; }
  }
  if (typeof window !== 'undefined') {
    onlineHandler = () => resume();
    window.addEventListener('online', onlineHandler);
  }
  options.connection(false);
  void poll();
  void open();
  interval = setInterval(() => {
    if (socket?.readyState === 1) {
      // The socket carries every state change. Polling only resumes when the
      // socket is unavailable, so a connected room makes no HTTP reads.
      if (pingAt !== undefined && clock() - pingAt > 10000) { socket.close(); return; }
      if (clock() - lastPingAt >= 30000) ping();
      else socket.send(JSON.stringify({ type: 'heartbeat' }));
    } else {
      void poll();
    }
  }, options.pollMs ?? 2000);
  return stop;
}
