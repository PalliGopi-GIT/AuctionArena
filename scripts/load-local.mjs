import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { cpus, totalmem } from 'node:os';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
function arg(name, fallback) {
  const found = args.find(item => item.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
}
const levels = arg('users', '100,500,1000').split(',').map(Number).filter(value => Number.isInteger(value) && value > 0);
const durationMs = Number(arg('duration', '10000'));
const pollMs = Number(arg('poll', '2000'));
const connectConcurrency = Number(arg('connectConcurrency', '20'));
const output = arg('output', '');
const maxMembers = 20;

function round(value) { return Math.round(value * 100) / 100; }
function delay(ms) { return new Promise(resolveDelay => setTimeout(resolveDelay, ms)); }
function summarize(values) {
  if (!values.length) return { count: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = p => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
  return {
    count: values.length, min: round(sorted[0]), p50: round(at(0.5)), p95: round(at(0.95)),
    p99: round(at(0.99)), max: round(sorted[sorted.length - 1]),
    mean: round(values.reduce((sum, value) => sum + value, 0) / values.length),
  };
}
async function mapLimit(items, limit, callback) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await callback(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}
function freePort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolvePort(address.port));
    });
  });
}
async function api(base, path, { method = 'GET', token, body } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(base + path, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!response.ok) {
    const error = new Error(`${method} ${path} returned ${response.status}`);
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

class Client {
  constructor(ws, meta) {
    this.ws = ws;
    this.meta = meta;
    this.version = -1;
    this.messages = 0;
    this.errors = [];
    this.closed = null;
    this.waiters = [];
    this.pending = new Map();
    this.sequence = 0;
    ws.on('message', raw => this.onMessage(raw));
    ws.on('error', error => this.errors.push(String(error)));
    ws.on('close', (code, reason) => { this.closed = { code, reason: String(reason) }; });
  }
  onMessage(raw) {
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return; }
    this.messages++;
    if (message?.type === 'snapshot' && message.room && Number.isSafeInteger(message.room.version)) {
      this.version = message.room.version;
      for (const waiter of [...this.waiters]) {
        if (this.version >= waiter.version) {
          clearTimeout(waiter.timer);
          this.waiters.splice(this.waiters.indexOf(waiter), 1);
          waiter.resolve(performance.now());
        }
      }
    }
    if (message?.type === 'pong') {
      const pending = this.pending.get(message.clientSentAt);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(message.clientSentAt);
        pending.resolve(performance.now() - pending.sentAt);
      }
    }
  }
  waitForVersion(version, timeout = 15_000) {
    if (this.version >= version) return Promise.resolve(performance.now());
    return new Promise((resolveWaiter, reject) => {
      const waiter = {
        version,
        resolve: resolveWaiter,
        timer: setTimeout(() => {
          const index = this.waiters.indexOf(waiter);
          if (index >= 0) this.waiters.splice(index, 1);
          reject(new Error(`snapshot version ${version} not received`));
        }, timeout),
      };
      this.waiters.push(waiter);
    });
  }
  ping() {
    const key = this.sequence++;
    return new Promise((resolvePing, reject) => {
      const sentAt = performance.now();
      const timer = setTimeout(() => {
        this.pending.delete(key);
        reject(new Error('pong timeout'));
      }, 15_000);
      this.pending.set(key, {
        sentAt,
        resolve: latency => { clearTimeout(timer); resolvePing(latency); },
      });
      try { this.ws.send(JSON.stringify({ type: 'ping', clientSentAt: key })); }
      catch (error) {
        clearTimeout(timer);
        this.pending.delete(key);
        reject(error);
      }
    });
  }
  close() {
    return new Promise(resolveClose => {
      if (this.ws.readyState === WebSocket.CLOSED) return resolveClose();
      const timer = setTimeout(() => {
        try { this.ws.terminate(); } catch { /* already closed */ }
        resolveClose();
      }, 2000);
      this.ws.once('close', () => { clearTimeout(timer); resolveClose(); });
      try { this.ws.close(); } catch { clearTimeout(timer); resolveClose(); }
    });
  }
}

function startServer(port) {
  const log = [];
  const memory = [];
  const child = spawn(process.execPath, ['--import', 'tsx', 'scripts/load-api.mjs'], {
    cwd: repoRoot,
    env: { ...process.env, LOAD_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    windowsHide: true,
  });
  const record = chunk => {
    for (const line of chunk.toString().split(/\r?\n/)) if (line.trim()) log.push(line.trim());
    if (log.length > 300) log.splice(0, log.length - 300);
  };
  child.stdout.on('data', record);
  child.stderr.on('data', record);
  child.on('message', message => {
    if (message?.type === 'memory') memory.push({ at: Date.now(), rss: message.rss, heapUsed: message.heapUsed, external: message.external });
  });
  return { child, log, memory };
}
async function waitForHealth(base, server) {
  const deadline = Date.now() + 120_000;
  while (true) {
    if (server.child.exitCode !== null) throw new Error(`load server exited (${server.child.exitCode}): ${server.log.slice(-10).join(' | ')}`);
    const healthy = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1000) }).then(response => response.ok, () => false);
    if (healthy) return;
    if (Date.now() > deadline) throw new Error(`load server did not become healthy: ${server.log.slice(-10).join(' | ')}`);
    await delay(200);
  }
}
async function stopServer(server) {
  if (server.child.exitCode !== null) return;
  const closed = new Promise(resolveClose => server.child.once('exit', resolveClose));
  if (server.child.connected) server.child.send('shutdown');
  await Promise.race([closed, delay(5000)]);
  if (server.child.exitCode === null) server.child.kill();
  await closed;
}

async function setupLevel(base, users) {
  const started = performance.now();
  const roomCount = Math.ceil(users / maxMembers);
  const baseSize = Math.floor(users / roomCount);
  const extra = users % roomCount;
  const specs = Array.from({ length: roomCount }, (_, index) => ({
    index, size: baseSize + (index < extra ? 1 : 0),
  }));
  const rooms = await mapLimit(specs, 4, async spec => {
    const host = await api(base, '/api/dev/session', { method: 'POST', body: { name: `load-${users}-host-${spec.index + 1}` } });
    const created = await api(base, '/api/rooms', { method: 'POST', token: host.token, body: { name: `Load ${users} room ${spec.index + 1}` } });
    return { code: created.room.code, inviteToken: created.inviteToken, host, size: spec.size, members: [{ ...host, roomCode: created.room.code }] };
  });
  const memberSpecs = [];
  for (const room of rooms) {
    for (let index = 1; index < room.size; index++) memberSpecs.push({ room, index });
  }
  await mapLimit(memberSpecs, 8, async ({ room, index }) => {
    const member = await api(base, '/api/dev/session', { method: 'POST', body: { name: `load-${users}-${room.code}-${index}` } });
    await api(base, `/api/rooms/${room.code}/join`, { method: 'POST', token: member.token, body: { inviteToken: room.inviteToken } });
    room.members.push({ ...member, roomCode: room.code });
  });
  return { rooms, setupMs: performance.now() - started, roomCount, membersPerRoom: rooms.map(room => room.members.length) };
}

async function connectAll(base, rooms) {
  const members = rooms.flatMap(room => room.members);
  const started = performance.now();
  const clients = await mapLimit(members, connectConcurrency > 0 ? connectConcurrency : members.length, async member => {
    const ticket = await api(base, `/api/rooms/${member.roomCode}/ws-ticket`, { method: 'POST', token: member.token });
    return await new Promise((resolveClient, reject) => {
      const ws = new WebSocket(`${base.replace('http', 'ws')}/ws`, [`ticket.${ticket.ticket}`]);
      const client = new Client(ws, member);
      const timer = setTimeout(() => {
        clearInterval(poll);
        try { ws.terminate(); } catch { /* already closed */ }
        reject(new Error('connect timeout'));
      }, 30_000);
      const poll = setInterval(() => {
        if (client.version >= 0) {
          clearInterval(poll);
          clearTimeout(timer);
          resolveClient(client);
        }
      }, 5);
      ws.once('error', error => {
        clearInterval(poll);
        clearTimeout(timer);
        reject(error);
      });
      ws.once('close', code => {
        if (client.version < 0) {
          clearInterval(poll);
          clearTimeout(timer);
          reject(new Error(`closed before snapshot (${code})`));
        }
      });
    });
  });
  return { clients, connectMs: performance.now() - started };
}

async function steadyState(base, clients, rooms, windowMs, intervalMs) {
  const pollLatencies = [];
  const pollErrors = [];
  const pingLatencies = [];
  const pingErrors = [];
  const started = performance.now();
  const pingWindow = Math.min(5000, windowMs / 2);
  const tasks = clients.map((client, index) => (async () => {
    const pingAt = started + (index / Math.max(1, clients.length)) * pingWindow;
    let nextPoll = started + (index / Math.max(1, clients.length)) * intervalMs;
    let pinged = false;
    while (performance.now() < started + windowMs) {
      const now = performance.now();
      const nextEvent = Math.min(nextPoll, pinged ? Infinity : pingAt);
      if (nextEvent > now) await delay(Math.min(nextEvent - now, 100));
      if (!pinged && performance.now() >= pingAt) {
        pinged = true;
        try { pingLatencies.push(await client.ping()); }
        catch (error) { pingErrors.push(String(error)); }
      }
      if (performance.now() >= nextPoll) {
        const requestStarted = performance.now();
        try {
          await api(base, `/api/rooms/${client.meta.roomCode}/sync?afterVersion=${client.version}`, { token: client.meta.token });
          pollLatencies.push(performance.now() - requestStarted);
        } catch (error) { pollErrors.push(String(error)); }
        nextPoll += intervalMs;
      }
    }
  })());
  const broadcast = (async () => {
    await delay(Math.min(3000, Math.max(500, windowMs / 3)));
    return broadcastRound(base, rooms);
  })();
  await Promise.all(tasks);
  return {
    windowMs: performance.now() - started,
    poll: { summary: summarize(pollLatencies), errors: pollErrors.length, errorSamples: pollErrors.slice(0, 5) },
    ping: { summary: summarize(pingLatencies), errors: pingErrors.length, errorSamples: pingErrors.slice(0, 5) },
    broadcast: await broadcast,
  };
}

async function broadcastRound(base, rooms) {
  const actionLatencies = [];
  const deliveryLatencies = [];
  const missing = [];
  const errors = [];
  await Promise.all(rooms.map(async room => {
    const started = performance.now();
    let response;
    try {
      response = await api(base, `/api/rooms/${room.code}/actions`, {
        method: 'POST', token: room.host.token,
        body: { id: `load-claim-${room.code}`, type: 'claim', teamId: 't1' },
      });
      actionLatencies.push(performance.now() - started);
    } catch (error) {
      errors.push({ code: room.code, status: error.status, message: String(error) });
      return;
    }
    const version = response.room?.version;
    if (!Number.isSafeInteger(version)) {
      errors.push({ code: room.code, message: 'action response omitted room version' });
      return;
    }
    const roomClients = room.members.map(member => member.client).filter(Boolean);
    await Promise.all(roomClients.map(async client => {
      try {
        const deliveredAt = await client.waitForVersion(version, 15_000);
        deliveryLatencies.push(deliveredAt - started);
      } catch (error) {
        missing.push({ code: room.code, user: client.meta.user?.id ?? null, message: String(error) });
      }
    }));
  }));
  return {
    actions: rooms.length,
    actionSummary: summarize(actionLatencies),
    deliverySummary: summarize(deliveryLatencies),
    missing: missing.length,
    missingSamples: missing.slice(0, 5),
    errors: errors.length,
    errorSamples: errors.slice(0, 5),
  };
}

async function runLevel(users) {
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  const server = startServer(port);
  let clients = [];
  const level = { users, port };
  try {
    await waitForHealth(base, server);
    const setup = await setupLevel(base, users);
    level.rooms = setup.roomCount;
    level.membersPerRoom = setup.membersPerRoom;
    level.setupMs = round(setup.setupMs);
    const connected = await connectAll(base, setup.rooms);
    clients = connected.clients;
    level.connectMs = round(connected.connectMs);
    level.workload = { durationMs, pollMs, connectConcurrency };
    const byKey = new Map(clients.map(client => [`${client.meta.roomCode}:${client.meta.user.id}`, client]));
    for (const room of setup.rooms) for (const member of room.members) {
      member.client = byKey.get(`${room.code}:${member.user.id}`);
    }

    const steady = await steadyState(base, clients, setup.rooms, durationMs, pollMs);
    level.steady = { windowMs: round(steady.windowMs) };
    level.ping = steady.ping;
    level.stateRead = steady.poll;
    level.broadcast = steady.broadcast;
    level.memory = {
      serverMaxRss: server.memory.length ? Math.max(...server.memory.map(item => item.rss)) : null,
      serverMaxHeap: server.memory.length ? Math.max(...server.memory.map(item => item.heapUsed)) : null,
      harnessRss: process.memoryUsage().rss,
    };
    level.sockets = {
      connected: clients.length,
      errors: clients.reduce((sum, client) => sum + client.errors.length, 0),
      closedEarly: clients.filter(client => client.closed).length,
      errorSamples: clients.flatMap(client => client.errors).slice(0, 5),
    };
  } finally {
    await Promise.all(clients.map(client => client.close()));
    await stopServer(server);
    level.serverLog = server.log.slice(-20);
  }
  return level;
}

const report = {
  task: 'WP-F-MEASURED-LOAD',
  generatedAt: new Date().toISOString(),
  environment: {
    node: process.version, platform: process.platform, arch: process.arch,
    cpus: cpus().length, totalMemory: totalmem(),
  },
  levels,
  durationMs,
  pollMs,
  connectConcurrency,
  maxMembersPerRoom: maxMembers,
  results: [],
  limitations: [
    'Runs the single-process local Node runtime with file-backed JSON state, not Cloudflare Workers, Durable Objects or SQLite-backed object storage',
    'Uses local development sessions and an isolated temporary data file; no Clerk, private data, deployment or cloud resource is involved',
    'Client and server share one machine, so CPU, disk and event-loop contention are not representative of Cloudflare placement',
    'The local runtime caps a room at 20 members and a host at 10 active rooms; rooms are sized to the cap',
    'Ping/pong measures socket liveness, not auction action throughput; broadcast uses one host claim per room',
    'No production capacity, cost or latency claim is made',
  ],
};
for (const users of levels) {
  const started = Date.now();
  try {
    const level = await runLevel(users);
    level.durationMs = Date.now() - started;
    report.results.push(level);
    console.log(JSON.stringify({
      users: level.users, rooms: level.rooms, setupMs: level.setupMs, connectMs: level.connectMs,
      pingP95: level.ping.summary.p95 ?? null,
      stateP95: level.stateRead?.summary.p95 ?? null,
      broadcastP95: level.broadcast?.deliverySummary.p95 ?? null,
      errors: (level.ping.errors ?? 0) + (level.stateRead?.errors ?? 0) + (level.broadcast?.errors ?? 0) + (level.broadcast?.missing ?? 0),
    }));
  } catch (error) {
    report.results.push({ users, failed: true, durationMs: Date.now() - started, error: String(error), stack: error?.stack ?? null });
    console.log(JSON.stringify({ users, failed: true, error: String(error) }));
  }
}
if (output) {
  mkdirSync(dirname(resolve(output)), { recursive: true });
  writeFileSync(output, JSON.stringify(report, null, 2));
}
