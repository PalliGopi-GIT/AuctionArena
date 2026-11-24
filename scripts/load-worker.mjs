import { text as readTextStream } from 'node:stream/consumers';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { cpus, totalmem, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { randomUUID, sign } from 'node:crypto';
import { performance, monitorEventLoopDelay, PerformanceObserver } from 'node:perf_hooks';
import { AsyncLocalStorage } from 'node:async_hooks';
import { channel } from 'node:diagnostics_channel';

const require = createRequire(import.meta.url);
const WebSocket = require('ws');
const args = process.argv.slice(2);
function arg(name, fallback) {
  const found = args.find(item => item.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
}
const base = arg('base', 'http://127.0.0.1:8787').replace(/\/$/, '');
const users = Number(arg('users', '100'));
const durationMs = Number(arg('duration', '40000'));
const roomSize = Number(arg('roomSize', '20'));
const timerSeconds = Number(arg('timerSeconds', '30'));
const mode = arg('mode', 'sample');
const depth = arg('depth', 'false') === 'true';
const separateStart = arg('separateStart', 'false') === 'true';
const bidSpreadMs = Number(arg('bidSpreadMs', '0'));
const traceEnabled = arg('trace', 'false') === 'true';
const strict = arg('strict', 'false') === 'true';
const isolateTraffic = arg('isolateTraffic', 'false') === 'true';
const peer = Number(arg('peer', '0')), peers = Number(arg('peers', '1'));
const barrier = arg('barrier', '');
const totalRooms = Number(arg('totalRooms', String(Math.ceil(users / roomSize))));
const roomOffset = Number(arg('roomOffset', '0'));
const cacheSnapshots = arg('cacheSnapshots', 'false') === 'true';
const compression = arg('compression', 'default');
if (!['default', 'small-plain', 'plain'].includes(compression)) throw new Error('Invalid local transport control.');
const connectConcurrency = Number(arg('connectConcurrency', '20'));
const setupConcurrency = Number(arg('setupConcurrency', '20'));
const bidRounds = Number(arg('bids', '8'));
const keyPath = arg('key', '');
const issuer = arg('issuer', 'https://local.auctionarena.test');
const output = arg('output', '');
const runLabel = arg('label', `worker-${users}`);
const target = new URL(base);
if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1' || target.origin !== base) {
  throw new Error('This harness requires an HTTP origin on 127.0.0.1.');
}
if (!Number.isSafeInteger(roomSize) || roomSize < 3 || roomSize > 20) throw new Error('--roomSize must be an integer from 3 to 20.');
if (!Number.isSafeInteger(users) || users < roomSize) throw new Error('--users must be an integer at least as large as --roomSize.');
if (!['sample', 'quick', 'standard', 'mega'].includes(mode)) throw new Error('--mode must be sample, quick, standard or mega.');
if (!Number.isSafeInteger(bidSpreadMs) || bidSpreadMs < 0 || bidSpreadMs >= timerSeconds * 1000) {
  throw new Error('--bidSpreadMs must be a nonnegative integer shorter than the lot timer.');
}
if (!keyPath) throw new Error('--key=<private PEM path> is required');
const privateKey = keyPath === '-' ? await readTextStream(process.stdin) : readFileSync(resolve(keyPath), 'utf8');
const origin = new URL(base).origin;
const clockAnchor = { wall: Date.now(), monotonic: performance.now() };
const clockNow = () => clockAnchor.wall + performance.now() - clockAnchor.monotonic;
const traces = { http: [], ping: [], broadcast: [], ramp: [], clock: [], bidTimer: [] };
const traceCounts = {}, traceSeeds = {};
function recordTrace(kind, value) {
  const list = traces[kind], limit = kind === 'http' ? 8192 : 1024;
  const count = traceCounts[kind] = (traceCounts[kind] ?? 0) + 1;
  if (!strict || list.length < limit) { list.push(value); return; }
  // Deterministic reservoir. Storage and instrumentation stay bounded while
  // the full end-to-end latency samples are retained independently.
  const seed = traceSeeds[kind] = (Math.imul(traceSeeds[kind] ?? 9103, 1664525) + 1013904223) >>> 0;
  const slot = Math.floor(seed / 2 ** 32 * count);
  if (slot < limit) list[slot] = value;
}
const snapshotCache = new Map();
const snapshotDecodes = { parsed: 0, reused: 0 };
let pendingHttp = 0, maxPendingHttp = 0;
async function synchronize(phase) {
  if (peers === 1) return;
  if (!barrier || !Number.isInteger(peer) || peer < 0 || peer >= peers) throw new Error('Invalid local barrier.');
  const ready = join(barrier, phase + '-' + peer);
  writeFileSync(ready + '.tmp', String(Date.now()), { flag: 'wx' });
  renameSync(ready + '.tmp', ready);
  const files = Array.from({ length: peers }, (_, i) => join(barrier, phase + '-' + i));
  const since = Date.now();
  while (!files.every(file => existsSync(file))) {
    if (existsSync(join(barrier, 'aborted')) || Date.now() - since > 120000) throw new Error('Local peer barrier failed at ' + phase);
    await delay(30);
  }
  const due = Math.max(...files.map(file => Number(readFileSync(file, 'utf8')))) + 250;
  await delay(Math.max(0, due - Date.now()));
}
function decodeSocketMessage(raw) {
  const text = raw.toString();
  const cacheable = cacheSnapshots && text.startsWith('{"type":"snapshot",');
  if (cacheable && snapshotCache.has(text)) {
    snapshotDecodes.reused++;
    return snapshotCache.get(text);
  }
  const message = JSON.parse(text);
  if (message?.type === 'snapshot') {
    snapshotDecodes.parsed++;
    // The local clients only read parsed frames. Identical frames from one room
    // broadcast can reuse the same object without skipping the version checks.
    if (cacheable && text.length <= 128 * 1024) {
      snapshotCache.set(text, message);
      if (snapshotCache.size > 128) snapshotCache.delete(snapshotCache.keys().next().value);
    }
  }
  return message;
}
const spans = new AsyncLocalStorage();
const requests = new WeakMap();
const pool = { opened: 0, open: 0, peakOpen: 0 };
if (strict) channel('undici:client:connected').subscribe(({ socket }) => {
  pool.opened++; pool.peakOpen = Math.max(pool.peakOpen, ++pool.open);
  socket.once('close', () => { pool.open--; });
});
if (traceEnabled) {
  channel('undici:request:create').subscribe(({ request }) => {
    const span = spans.getStore();
    if (span) { span.created = clockNow(); requests.set(request, span); }
  });
  for (const [event, field] of [['bodySent', 'bodySent'], ['headers', 'wireHeaders']]) {
    channel(`undici:request:${event}`).subscribe(({ request }) => {
      const span = requests.get(request);
      if (span) span[field] = clockNow();
    });
  }
}
function stamps(value, count) {
  const numbers = value?.split(',').map(Number);
  return numbers?.length === count && numbers.every(Number.isFinite) ? numbers : null;
}
async function checkClock(phase) {
  for (let i = 0; i < 12; i++) {
    const start = clockNow();
    const response = await fetch(base + '/api/health', { redirect: 'error', signal: AbortSignal.timeout(5000) });
    const received = clockNow();
    await response.text();
    const worker = stamps(response.headers.get('x-auction-local-worker'), 2);
    if (worker) traces.clock.push({ phase, start, received, worker, wallResidual: Date.now() - clockNow() });
  }
}

const settings = {
  name: 'Worker Load Auction', teamCount: 8, budget: 8000, minSquad: 2, maxSquad: 8,
  maxOverseas: 4, timerSeconds, lateExtension: true, bidIncrement: 10,
  autoAdvance: true, resultSeconds: 2, spectators: true,
};

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
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker));
  return results;
}
function b64url(value) { return Buffer.from(value).toString('base64url'); }
function tokenFor(user) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: 'local-test' }));
  const payload = b64url(JSON.stringify({
    sub: user.id, sid: `sess_${user.id}`, sts: 'active', iss: issuer, azp: origin,
    iat: now, nbf: now - 5, exp: now + 3600, name: user.name,
  }));
  const input = `${header}.${payload}`;
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url')}`;
}

const httpStats = { requests: 0, errors: 0, statuses: {}, errorSamples: [] };
const serverTiming = new Map();
async function api(path, { method = 'GET', token, body, timeout = 30000 } = {}) {
  httpStats.requests++;
  const started = Date.now();
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  maxPendingHttp = Math.max(maxPendingHttp, ++pendingHttp);
  try {
    const span = traceEnabled && body?.type === 'bid' ? { id: body.id, start: clockNow() } : null;
    const fetchRequest = () => fetch(base + path, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeout), redirect: 'error',
    });
    const response = await (span ? spans.run(span, fetchRequest) : fetchRequest());
    if (span) span.headers = clockNow();
    const text = await response.text();
    if (span) span.body = clockNow();
    for (const entry of response.headers.get('server-timing')?.split(',') ?? []) {
      const match = /^\s*(\w+);dur=(\d+(?:\.\d+)?)\s*$/.exec(entry);
      if (!match) continue;
      if (!serverTiming.has(match[1])) serverTiming.set(match[1], []);
      serverTiming.get(match[1]).push(Number(match[2]));
    }
    let data; try { data = JSON.parse(text); } catch { data = text; }
    if (span) {
      span.parsed = clockNow();
      span.status = response.status;
      span.version = data?.room?.version ?? null;
      span.worker = stamps(response.headers.get('x-auction-local-worker'), 2);
      span.room = stamps(response.headers.get('x-auction-local-trace'), 4);
      recordTrace('http', span);
    }
    httpStats.statuses[response.status] = (httpStats.statuses[response.status] ?? 0) + 1;
    if (response.status >= 500) {
      httpStats.errors++;
      if (httpStats.errorSamples.length < 10) httpStats.errorSamples.push({ path, status: response.status, ...compactError(data) });
    }
    return { status: response.status, data, ms: Date.now() - started };
  } catch (error) {
    httpStats.errors++;
    if (httpStats.errorSamples.length < 10) httpStats.errorSamples.push({ path, status: 'network', message: String(error) });
    throw error;
  } finally { pendingHttp--; }
}

class Client {
  constructor(socket, member) {
    this.socket = socket;
    this.member = member;
    this.version = -1;
    this.versionTimes = new Map();
    this.versionTraces = new Map();
    this.messages = 0;
    this.errors = [];
    this.closed = null;
    this.waiters = [];
    this.pending = new Map();
    this.sequence = 0;
    this.resultAt = null;
    this.resultRoom = null;
    this.heartbeats = 0;
    socket.on('message', raw => this.onMessage(raw));
    socket.on('error', error => this.errors.push(String(error)));
    socket.on('close', (code, reason) => { this.closed = { code, reason: String(reason) }; });
  }
  onMessage(raw) {
    const entered = traceEnabled ? clockNow() : 0;
    let message;
    try { message = decodeSocketMessage(raw); } catch { if (strict) this.errors.push('invalid JSON frame'); return; }
    this.messages++;
    if (message?.type === 'snapshot' && message.room && Number.isSafeInteger(message.room.version)) {
      const at = Date.now();
      this.version = message.room.version;
      if (depth) {
        this.depthState = message.room;
        this.depthPeakBytes = Math.max(this.depthPeakBytes ?? 0, raw.length);
        if (message.room.status === 'RESULT') {
          const settled = message.room.players[message.room.currentPlayerIndex];
          (this.depthSales ??= new Map()).set(settled.id, [settled.status, settled.soldTo, settled.soldPrice, message.room.version]);
        }
      }
      const observed = performance.now();
      if (!this.versionTimes.has(message.room.version)) this.versionTimes.set(message.room.version, observed);
      if (traceEnabled && Number.isFinite(message.localScheduledAt) && !this.versionTraces.has(message.room.version)) {
        this.versionTraces.set(message.room.version, { entered, decoded: clockNow(), scheduled: message.localScheduledAt, bytes: raw.length });
      }
      if (this.resultAt === null && message.room.status === 'RESULT') {
        const { status, currentBid, leadingTeamId, players, currentPlayerIndex } = message.room;
        const player = players[currentPlayerIndex];
        this.resultAt = at;
        this.resultRoom = { status, currentBid, leadingTeamId, playerId: player?.id,
          playerStatus: player?.status, soldPrice: player?.soldPrice ?? null, soldTo: player?.soldTo ?? null };
      }
      for (const waiter of [...this.waiters]) {
        if (message.room.version === waiter.version) {
          clearTimeout(waiter.timer);
          this.waiters.splice(this.waiters.indexOf(waiter), 1);
          waiter.resolve(observed - waiter.since);
        }
      }
    }
    if (message?.type === 'pong') {
      const pending = this.pending.get(message.clientSentAt);
      if (pending) {
        clearTimeout(pending.timer);
        this.pending.delete(message.clientSentAt);
        if (traceEnabled) recordTrace('ping', { sent: pending.traceSent, entered, decoded: clockNow(),
          ingress: message.localIngressAt ?? null, pong: message.serverNow,
          flushed: pending.flushed ?? null, clientBuffer: pending.clientBuffer, serverBuffer: message.localBufferedBytes ?? null });
        pending.resolve(performance.now() - pending.sentAt);
      }
    }
  }
  waitForVersion(version, since, timeout = 20000) {
    if (this.versionTimes.has(version)) return Promise.resolve(this.versionTimes.get(version) - since);
    return new Promise((resolveWaiter, reject) => {
      const waiter = {
        version, since, resolve: resolveWaiter,
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
      }, 15000);
      const pending = {
        sentAt,
        ...(traceEnabled ? { traceSent: clockNow(), clientBuffer: this.socket.bufferedAmount } : {}),
        resolve: latency => { clearTimeout(timer); resolvePing(latency); },
      };
      this.pending.set(key, pending);
      try {
        this.socket.send(JSON.stringify({ type: 'ping', clientSentAt: key }), { compress: compression !== 'small-plain' },
          traceEnabled ? error => { if (!error) pending.flushed = clockNow(); } : undefined);
      }
      catch (error) {
        clearTimeout(timer);
        this.pending.delete(key);
        reject(error);
      }
    });
  }
  heartbeat() {
    if (this.socket.readyState !== WebSocket.OPEN) return false;
    try { this.socket.send(JSON.stringify({ type: 'heartbeat' }), { compress: compression !== 'small-plain' }); this.heartbeats++; return true; }
    catch { return false; }
  }
  close() {
    return new Promise(resolveClose => {
      if (this.socket.readyState === WebSocket.CLOSED) return resolveClose();
      const timer = setTimeout(() => {
        try { this.socket.terminate(); } catch { /* already closed */ }
        resolveClose();
      }, 2000);
      this.socket.once('close', () => { clearTimeout(timer); resolveClose(); });
      try { this.socket.close(); } catch { clearTimeout(timer); resolveClose(); }
    });
  }
}

/**
 * Ping callbacks and timers share this generator's event loop. Delay here
 * contributes to the observation alongside runtime and host scheduling.
 */
function loopLagSampler(intervalMs = 10) {
  const gc = { count: 0, durationMs: 0, maxMs: 0 };
  function observeGc(entries) {
    for (const entry of entries) { gc.count++; gc.durationMs += entry.duration; gc.maxMs = Math.max(gc.maxMs, entry.duration); }
  }
  const observer = strict ? new PerformanceObserver(list => observeGc(list.getEntries())) : null;
  observer?.observe({ entryTypes: ['gc'] });
  const lags = [];
  let last = Date.now();
  const timer = setInterval(() => {
    const now = Date.now();
    lags.push(Math.max(0, now - last - intervalMs));
    last = now;
  }, intervalMs);
  const delay = monitorEventLoopDelay({ resolution: intervalMs });
  delay.enable();
  const wall = performance.now(), cpu = process.cpuUsage(), elu = performance.eventLoopUtilization();
  const samples = [];
  let lastCpu = cpu, lastWall = wall;
  const sampler = setInterval(() => {
    const at = performance.now(), current = process.cpuUsage();
    samples.push({ at: clockNow(), intervalMs: at - lastWall,
      cpuMs: (current.user + current.system - lastCpu.user - lastCpu.system) / 1000,
      rss: process.memoryUsage().rss });
    lastWall = at; lastCpu = current;
  }, 1000);
  return { stop() {
    clearInterval(timer); clearInterval(sampler); delay.disable();
    if (observer) { observeGc(observer.takeRecords()); observer.disconnect(); }
    const used = process.cpuUsage(cpu);
    return { samples: lags.length, summary: summarize(lags), cpuSamples: samples, ...(observer ? { gc } : {}),
      wallMs: performance.now() - wall, cpuMs: (used.user + used.system) / 1000,
      eventLoopUtilization: performance.eventLoopUtilization(elu).utilization,
      nativeDelayMs: { p50: delay.percentile(50) / 1e6, p95: delay.percentile(95) / 1e6,
        p99: delay.percentile(99) / 1e6, max: delay.max / 1e6 } };
  } };
}
function memorySampler(label) {
  if (process.platform !== 'win32') return { stop: async () => null };
  // Raw samples stay outside the repository; the per-level JSON carries the summary.
  const stem = join(tmpdir(), `auctionarena-load-${label}-${process.pid}-${randomUUID()}`);
  const csv = `${stem}-memory.csv`;
  const stopFile = `${stem}-memory.stop`;
  const script = `
$csv='${csv.replace(/'/g, "''")}'; $stop='${stopFile.replace(/'/g, "''")}';
while (!(Test-Path $stop)) {
  $p = Get-Process -Name workerd -ErrorAction SilentlyContinue;
  if ($p) {
    $ws = ($p | Measure-Object WorkingSet64 -Sum).Sum;
    $cpu = ($p | Measure-Object CPU -Sum).Sum;
    $parts = @($p | ForEach-Object { "$($_.Id):$($_.CPU):$($_.WorkingSet64)${strict ? ':$((($_.Threads | ForEach-Object { $_.TotalProcessorTime.TotalSeconds }) | Measure-Object -Maximum).Maximum)' : ''}" }) -join ';';
    "$([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()),$ws,$cpu,$parts" | Add-Content -Path $csv;
  }
  Start-Sleep -Milliseconds 1000;
}`;
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, stdio: 'ignore' });
  return {
    async stop() {
      try { writeFileSync(stopFile, 'stop'); } catch { /* ignore */ }
      await Promise.race([new Promise(resolveExit => child.once('exit', resolveExit)), delay(3000)]);
      if (!existsSync(csv)) return null;
      const rows = readFileSync(csv, 'utf8').split(/\r?\n/).filter(Boolean).map(line => {
        const [at, rss, cpu, processes] = line.split(',');
        return [Number(at), Number(rss), Number(cpu), (processes ?? '').split(';').filter(Boolean).map(item => item.split(':').map(Number))];
      }).filter(row => row.slice(0, 3).every(Number.isFinite));
      if (!rows.length) return null;
      return {
        samples: rows.length,
        peakWorkingSet: Math.max(...rows.map(row => row[1])),
        meanWorkingSet: Math.round(rows.reduce((sum, row) => sum + row[1], 0) / rows.length),
        lastWorkingSet: rows.at(-1)[1],
        cpuSeconds: round(rows.at(-1)[2] - rows[0][2]),
        ...(traceEnabled ? { rawSamples: rows } : {}),
      };
    },
  };
}

async function setupRooms() {
  const started = Date.now();
  const roomCount = Math.ceil(users / roomSize);
  const baseSize = Math.floor(users / roomCount);
  const extra = users % roomCount;
  const specs = Array.from({ length: roomCount }, (_, index) => ({ index, size: baseSize + (index < extra ? 1 : 0) }));
  let userSequence = 0;
  const rooms = await mapLimit(specs, setupConcurrency, async spec => {
    const hostUser = { id: `load_${runLabel}_${userSequence++}`, name: `Load ${runLabel} host ${spec.index + 1}` };
    hostUser.token = tokenFor(hostUser);
    const created = await api('/api/rooms', { method: 'POST', token: hostUser.token, body: settings });
    if (created.status !== 201) throw new Error(`create failed ${created.status}: ${JSON.stringify(created.data)}`);
    const room = {
      code: created.data.room.code, inviteToken: created.data.inviteToken, index: spec.index,
      size: spec.size, host: hostUser, members: [{ ...hostUser, roomCode: created.data.room.code }],
      latest: created.data.room,
    };
    return room;
  });
  const memberSpecs = [];
  for (const room of rooms) for (let index = 1; index < room.size; index++) memberSpecs.push({ room, index });
  await mapLimit(memberSpecs, setupConcurrency, async ({ room, index }) => {
    const user = { id: `load_${runLabel}_${userSequence++}`, name: `Load ${runLabel} ${room.code} ${index}` };
    user.token = tokenFor(user);
    const joined = await api(`/api/rooms/${room.code}/join`, { method: 'POST', token: user.token, body: { inviteToken: room.inviteToken } });
    if (joined.status !== 200) throw new Error(`join failed ${joined.status}: ${JSON.stringify(joined.data)}`);
    room.members.push({ ...user, roomCode: room.code });
    room.latest = joined.data.room;
  });
  return { rooms, setupMs: Date.now() - started, roomCount, membersPerRoom: rooms.map(room => room.members.length) };
}

async function connectAll(rooms, activeClients) {
  const members = rooms.flatMap(room => room.members);
  const started = Date.now();
  const clients = await mapLimit(members, connectConcurrency, async member => {
    const begin = traceEnabled ? clockNow() : 0;
    const ticket = await api(`/api/rooms/${member.roomCode}/ws-ticket`, { method: 'POST', token: member.token });
    if (ticket.status !== 200) throw new Error(`ticket failed ${ticket.status}: ${JSON.stringify(ticket.data)}`);
    const socket = new WebSocket(`${base.replace(/^http/, 'ws')}/ws?room=${member.roomCode}`, [`ticket.${ticket.data.ticket}`],
      { perMessageDeflate: compression !== 'plain' });
    const upgrade = traceEnabled ? clockNow() : 0;
    const client = new Client(socket, member);
    activeClients.push(client);
    await new Promise((resolveClient, reject) => {
      const timer = setTimeout(() => {
        try { socket.terminate(); } catch { /* already closed */ }
        reject(new Error(`connect timeout for ${member.id}`));
      }, 30000);
      socket.once('open', () => {
        const poll = setInterval(() => {
          if (client.version >= 0) { clearInterval(poll); clearTimeout(timer); resolveClient(); }
        }, 5);
        socket.once('close', code => {
          if (client.version < 0) { clearInterval(poll); clearTimeout(timer); reject(new Error(`closed before snapshot (${code})`)); }
        });
      });
      socket.once('error', error => { clearTimeout(timer); reject(error); });
    });
    member.client = client;
    if (traceEnabled) recordTrace('ramp', { begin, upgrade, ready: clockNow() });
    return client;
  });
  return { clients, connectMs: Date.now() - started };
}

function compactError(data) {
  if (!data || typeof data !== 'object') return data;
  return { code: data.code, message: data.message, requestId: data.requestId };
}
async function claimAndStart(rooms) {
  const started = Date.now();
  const claimLatencies = [];
  const errors = [];
  const claimRetries = [];
  async function claim(room) {
    const owners = room.members.slice(0, 8);
    const state = await api(`/api/rooms/${room.code}`, { token: room.host.token });
    if (state.status !== 200) { errors.push({ room: room.code, status: state.status, ...compactError(state.data) }); return; }
    let latest = state.data.room;
    for (const [index, owner] of owners.entries()) {
      let claimed = false;
      for (let attempt = 0; attempt < 5 && !claimed; attempt++) {
        const response = await api(`/api/rooms/${room.code}/actions`, {
          method: 'POST', token: owner.token,
          body: { id: `claim-${room.code}-${index}`, expectedVersion: latest.version, type: 'claim', teamId: `t${index + 1}` },
        });
        claimLatencies.push(response.ms);
        if (response.status === 200) { latest = response.data.room; claimed = true; break; }
        if (response.status === 400 && response.data?.code === 'STALE_VERSION') {
          claimRetries.push({ room: room.code, attempt, index });
          const refreshed = await api(`/api/rooms/${room.code}`, { token: room.host.token });
          if (refreshed.status !== 200) { errors.push({ room: room.code, status: refreshed.status, ...compactError(refreshed.data) }); break; }
          latest = refreshed.data.room;
          await delay(50);
          continue;
        }
        errors.push({ room: room.code, status: response.status, ...compactError(response.data) });
        break;
      }
      if (!claimed) return;
    }
    if (mode !== 'sample') {
      const preview = await api(`/api/rooms/${room.code}/actions`, {
        method: 'POST', token: room.host.token,
        body: { id: `plan-${room.code}`, type: 'plan-preview', mode },
      });
      if (preview.status !== 200) { errors.push({ room: room.code, status: preview.status, ...compactError(preview.data) }); return; }
      latest = preview.data.room;
    }
    room.latest = latest;
    return latest;
  }
  async function start(room, latest) {
    if (!latest) return;
    let startedRoom = null;
    for (let attempt = 0; attempt < 5 && !startedRoom; attempt++) {
      const start = await api(`/api/rooms/${room.code}/actions`, {
        method: 'POST', token: room.host.token,
        body: { id: `start-${room.code}`, expectedVersion: latest.version,
          ...(mode === 'sample' ? { type: 'start' } : { type: 'plan-approve', planVersion: 1 }) },
      });
      if (start.status === 200) { startedRoom = start.data.room; break; }
      if (start.status === 400 && start.data?.code === 'STALE_VERSION') {
        const refreshed = await api(`/api/rooms/${room.code}`, { token: room.host.token });
        if (refreshed.status !== 200) { errors.push({ room: room.code, status: refreshed.status, ...compactError(refreshed.data) }); break; }
        latest = refreshed.data.room;
        await delay(50);
        continue;
      }
      errors.push({ room: room.code, status: start.status, ...compactError(start.data) });
      break;
    }
    if (!startedRoom) { errors.push({ room: room.code, code: 'START_FAILED' }); return; }
    room.latest = startedRoom;
    room.deadline = startedRoom.deadline;
    room.startAt = Date.now();
  }
  if (separateStart) {
    const states = await mapLimit(rooms, setupConcurrency, claim);
    await synchronize('claimed');
    await Promise.all(rooms.map((room, index) => start(room, states[index])));
  } else {
    await Promise.all(rooms.map(async room => start(room, await claim(room))));
  }
  const starts = rooms.map(room => room.startAt).filter(Number.isFinite);
  return { claimMs: Date.now() - started, claimLatencies, claimRetries, errors,
    startedRooms: starts.length, startSpreadMs: starts.length ? Math.max(...starts) - Math.min(...starts) : null };
}

function nextBidAmount(room) {
  if (!room.currentBid) return room.players[room.currentPlayerIndex]?.basePrice ?? 0;
  const step = room.currentBid < 200 ? 10 : room.currentBid <= 500 ? 20 : 25;
  return room.currentBid + step;
}

async function bidWorkload(rooms, onAction, onDelivery) {
  const actionLatencies = [];
  const deliveryLatencies = [];
  const missing = [];
  const errors = [];
  const expectedConflicts = [];
  let accepted = 0;
  const launch = clockNow();
  async function delivered(member, version, since, traceId) {
    deliveryLatencies.push(await member.client.waitForVersion(version, since));
    const receipt = member.client.versionTraces.get(version);
    if (traceEnabled && receipt) recordTrace('broadcast', { id: traceId, version, ...receipt });
  }
  await Promise.all(rooms.map(async (room, index) => {
    // Interleave the rooms of all local generators across the original spread.
    const slot = peers === 1 ? index : roomOffset + index * peers;
    const waitMs = Math.floor(slot * bidSpreadMs / totalRooms);
    if (bidSpreadMs) await delay(waitMs);
    if (traceEnabled) recordTrace('bidTimer', { due: launch + waitMs, fired: clockNow() });
    for (let round = 0; round < bidRounds; round++) {
      if (room.latest.status !== 'LIVE') break;
      const amount = nextBidAmount(room.latest);
      const playerId = room.latest.players[room.latest.currentPlayerIndex]?.id;
      if (!playerId) break;
      const bidders = room.members.slice(0, 2);
      const bidder = room.latest.leadingTeamId === 't1' ? bidders[1] : bidders[0];
      if (!bidder) break;
      const started = performance.now();
      let response;
      try {
        response = await api(`/api/rooms/${room.code}/actions`, {
          method: 'POST', token: bidder.token,
          body: { id: `bid-${room.code}-${round}`, expectedVersion: room.latest.version, type: 'bid', playerId, amount },
        });
      } catch (error) {
        errors.push({ room: room.code, round, message: String(error) });
        break;
      }
      actionLatencies.push(performance.now() - started);
      if (response.status !== 200) {
        errors.push({ room: room.code, round, status: response.status, ...compactError(response.data) });
        if (response.data?.room) room.latest = response.data.room;
        continue;
      }
      accepted++;
      room.latest = response.data.room;
      onAction?.(response.data.room);
      const version = response.data.room.version;
      await Promise.all(room.members.map(async member => {
        if (!member.client) return;
        try { await delivered(member, version, started, `bid-${room.code}-${round}`); }
        catch (error) { missing.push({ room: room.code, user: member.id, version, message: String(error) }); }
      }));
      onDelivery?.(response.data.room, deliveryLatencies);
      if (round === 2 && room.latest.status === 'LIVE') {
        const next = nextBidAmount(room.latest);
        const nextPlayer = room.latest.players[room.latest.currentPlayerIndex]?.id;
        const owners = room.members.slice(0, 3);
        const eligible = owners.filter((_, index) => `t${index + 1}` !== room.latest.leadingTeamId);
        const raceStarted = performance.now();
        const both = await Promise.all(eligible.slice(0, 2).map((candidate, index) => api(`/api/rooms/${room.code}/actions`, {
          method: 'POST', token: candidate.token,
          body: { id: `race-${room.code}-${index}`, expectedVersion: room.latest.version, type: 'bid', playerId: nextPlayer, amount: next },
        }).catch(error => ({ status: 'network', data: { message: String(error) } }))));
        const winners = both.filter(item => item.status === 200);
        const conflicts = both.filter(item => item.status !== 200);
        if (winners.length === 1 && conflicts.length === 1 && conflicts[0].status === 400 && conflicts[0].data?.code === 'STALE_VERSION') {
          expectedConflicts.push({ room: room.code, code: conflicts[0].data?.code });
          room.latest = winners[0].data.room;
          const winningIndex = both.indexOf(winners[0]);
          await Promise.all(room.members.map(async member => {
            if (!member.client) return;
            try { await delivered(member, room.latest.version, raceStarted, `race-${room.code}-${winningIndex}`); }
            catch (error) { missing.push({ room: room.code, user: member.id, version: room.latest.version, message: String(error) }); }
          }));
        } else {
          errors.push({ room: room.code, round, message: 'conflict race did not resolve to exactly one accepted bid', statuses: both.map(item => item.status) });
        }
      }
    }
  }));
  return {
    accepted, actionSummary: summarize(actionLatencies), deliverySummary: summarize(deliveryLatencies),
    ...(strict ? { actionLatencies, deliveryLatencies } : {}),
    missing, errors, expectedConflicts,
  };
}

function startHeartbeats(clients) {
  const heartbeatEvery = 200;
  let next = 0;
  const timer = setInterval(() => {
    const slice = Math.ceil(clients.length / 10);
    for (let index = 0; index < slice; index++) {
      clients[next++ % clients.length].heartbeat();
    }
  }, heartbeatEvery);
  return () => clearInterval(timer);
}

async function steadyPings(clients, windowMs) {
  const latencies = [];
  const errors = [];
  const started = Date.now();
  const initialHeartbeats = clients.reduce((n,c)=>n+c.heartbeats,0);
  const pingSlice = Math.max(1, Math.floor(clients.length / 50));
  let tick = 0;
  let pingSequence = 0;
  const inflight = new Map();
  const timer = setInterval(() => {
    if (Date.now() - started < windowMs - 3000) {
      for (let index = 0; index < pingSlice; index++) {
        const client = clients[(tick * pingSlice + index) % clients.length];
        if (inflight.has(client)) continue;
        inflight.set(client, client.ping().then(latency => latencies.push(latency))
          .catch(error => errors.push(String(error))).finally(() => inflight.delete(client)));
        pingSequence++;
      }
    }
    tick++;
  }, 200);
  await delay(windowMs);
  clearInterval(timer);
  const actualWindowMs = Date.now() - started;
  const windowHeartbeats = clients.reduce((n,c)=>n+c.heartbeats,0)-initialHeartbeats;
  await Promise.all(inflight.values());
  return { windowMs: actualWindowMs, windowHeartbeats, latencies, errors, pingSequence, heartbeats: clients.reduce((sum, client) => sum + client.heartbeats, 0) };
}

// Factorial dispatch control on the same open sockets before the timed auction.
// Each leg uses the same fixed slots and waits for every issued probe to finish.
// These read-only observations never count as auction traffic or a capacity pass.
async function trafficControls(rooms, clients) {
  const results = [];
  const modes = ['http', 'ws', 'combined', 'half-rate', 'half-rooms', 'half-rooms', 'half-rate', 'combined', 'ws', 'http'];
  for (const mode of modes) {
    const heartbeat = startHeartbeats(clients);
    await delay(2200);
    heartbeat();
    const http = [], ping = [], pending = new Set();
    let errors = 0, peakPending = 0, heartbeats = 0, nextRoom = 0, nextPing = 0, nextBeat = 0;
    const loop = loopLagSampler();
    const start = performance.now();
    function monitor(promise, values) {
      const task = promise.then(value => values.push(value)).catch(() => { errors++; }).finally(() => pending.delete(task));
      pending.add(task); peakPending = Math.max(peakPending, pending.size);
    }
    for (let tick = 0; tick < 30; tick++) {
      await delay(Math.max(0, start + tick * 200 - performance.now()));
      if (mode === 'half-rate' && tick % 2) continue;
      if (mode !== 'http') {
        for (let i = 0; i < Math.ceil(clients.length / 10); i++) if (clients[nextBeat++ % clients.length].heartbeat()) heartbeats++;
        for (let i = 0; i < Math.max(1, Math.floor(clients.length / 50)); i++) monitor(clients[nextPing++ % clients.length].ping(), ping);
      }
      if (mode !== 'ws') {
        // Ten HTTP bid intents per room over forty seconds on the combined auction.
        const count = Math.floor((tick + 1) * rooms.length / 20) - Math.floor(tick * rooms.length / 20);
        for (let i = 0; i < count; i++) {
          const activeRooms = mode === 'half-rooms' ? Math.ceil(rooms.length / 2) : rooms.length;
          const room = rooms[nextRoom++ % activeRooms], before = performance.now();
          monitor(api(`/api/rooms/${room.code}/history?limit=1`, { token: room.host.token }).then(r => {
            if (r.status !== 200) throw new Error('history control failed');
            return performance.now() - before;
          }), http);
        }
      }
    }
    await Promise.all(pending);
    results.push({ mode, http: summarize(http), ping: summarize(ping), errors, peakPending, heartbeats,
      durationMs: performance.now() - start, node: loop.stop(), endedAt: Date.now() });
    // These pings are separate from the paired auction traces.
    traces.ping.length = 0;
    traceCounts.ping = 0;
  }
  return results;
}

async function settlement(rooms, timeoutMs = 20000) {
  const results = [];
  await Promise.all(rooms.map(async room => {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const clients = room.members.map(member => member.client).filter(Boolean);
      const resultClients = clients.filter(client => client.resultRoom);
      if (clients.length === room.size && resultClients.length === room.size) {
        const first = Math.min(...resultClients.map(client => client.resultAt));
        const last = Math.max(...resultClients.map(client => client.resultAt));
        const resultRoom = resultClients[0].resultRoom;
        results.push({
          room: room.code, clients: resultClients.length, expectedClients: clients.length,
          firstDeliveryAfterDeadline: room.deadline ? first - room.deadline : null,
          lastDeliveryAfterDeadline: room.deadline ? last - room.deadline : null,
          ...resultRoom,
          expectedSale: resultRoom?.playerStatus === 'sold' && resultRoom.playerId === room.latest.players[room.latest.currentPlayerIndex]?.id
            && resultRoom.soldPrice === room.latest.currentBid && resultRoom.soldTo === room.latest.leadingTeamId,
          diverged: new Set(resultClients.map(client => JSON.stringify(client.resultRoom))).size !== 1,
        });
        return;
      }
      await delay(200);
    }
    results.push({ room: room.code, timeout: true });
  }));
  return results;
}

// A separate real-time diagnostic. Its longer auction and sparse bids have
// their own verdict and never count as a capacity stage.
async function completePlan(room) {
  const total = {quick:80, standard:120}[mode];
  if (!total) throw Error('Full-depth diagnostic requires Quick or Standard');
  const expected = new Map(), clients = room.members.map(m=>m.client);
  const timeout = Date.now() + total*(timerSeconds+settings.resultSeconds+5)*1000;
  let sold=0, lastVersion=0;
  while (expected.size < total || !clients.every(c=>c.depthSales?.size===total)) {
    if (Date.now()>timeout || clients.some(c=>c.closed || c.errors.length)) throw Error('Incomplete auction depth or closed socket');
    const state=clients[0].depthState;
    if (state?.status==='LIVE' && state.version>lastVersion) {
      const player=state.players[state.currentPlayerIndex];
      if (!expected.has(player.id)) {
        const index=expected.size;
        if(index%5===0) {
          const ownerIndex=sold%8, owner=room.members[ownerIndex];
          const bid=await api('/api/rooms/'+room.code+'/actions',{method:'POST',token:owner.token,
            body:{type:'bid',id:'depth-'+index,playerId:player.id,amount:player.basePrice,expectedVersion:state.version}});
          if(bid.status!==200) throw Error('Depth bid failed '+bid.status+' '+bid.data?.code);
          await Promise.all(clients.map(c=>c.waitForVersion(bid.data.room.version,performance.now())));
          expected.set(player.id,['sold','t'+(ownerIndex+1),player.basePrice]);sold++;
        } else expected.set(player.id,['unsold',null,null]);
      }
      lastVersion=state.version;
    }
    await delay(100);
  }
  for(const [id,[status,team,price]] of expected) {
    const version=clients[0].depthSales.get(id)[3];
    for(const client of clients) {
      const actual=client.depthSales.get(id);
      if(actual[0]!==status || (actual[1]??null)!==team || (actual[2]??null)!==price || actual[3]!==version)
        throw Error('Settlement divergence at '+id);
    }
  }
  const end=await api('/api/rooms/'+room.code+'/actions',{method:'POST',token:room.host.token,body:{type:'end',id:'depth-end'}});
  if(end.status!==200 || end.data.room.status!=='COMPLETED')throw Error('Completion failed');
  await Promise.all(clients.map(c=>c.waitForVersion(end.data.room.version,performance.now())));
  return {code:room.code,mode,lots:expected.size,sold,unsold:expected.size-sold,members:clients.length,
    peakFrameBytes:Math.max(...clients.map(c=>c.depthPeakBytes)),completedVersion:end.data.room.version};
}

const outputPath = output ? resolve(output) : '';
if (outputPath) mkdirSync(dirname(outputPath), { recursive: true });
const memory = peer === 0 ? memorySampler(runLabel) : { stop: async () => null };
const report = {
  task: 'WP-G-WORKERS-RUNTIME',
  generatedAt: new Date().toISOString(),
  label: runLabel,
  environment: {
    node: process.version, platform: process.platform, arch: process.arch,
    cpus: cpus().length, totalMemory: totalmem(), base, roomSize, users,
  },
  workload: { durationMs, roomSize, connectConcurrency, setupConcurrency, bidRounds, timerSeconds, mode, separateStart, bidSpreadMs, cacheSnapshots, compression },
  setup: null, connections: null, claims: null, ping: null, actions: null, broadcast: null,
  settlement: null, http: null, sockets: null, memory: null, loopLag: null,
};
let clients = [];
let stopHeartbeats = () => {};
let loopLag;
try {
  if (traceEnabled) await checkClock('before');
  const setup = await setupRooms();
  report.setup = { rooms: setup.roomCount, membersPerRoom: setup.membersPerRoom, setupMs: setup.setupMs };
  stopHeartbeats = startHeartbeats(clients);
  const connected = await connectAll(setup.rooms, clients);
  report.connections = {
    attempted: clients.length, connected: clients.filter(client => client.version >= 0).length,
    connectMs: connected.connectMs,
    ...(strict ? { extensions: [...new Set(clients.map(c => c.socket.extensions || 'none'))] } : {}),
  };
  if (isolateTraffic) {
    stopHeartbeats();
    report.controls = await trafficControls(setup.rooms, clients);
    stopHeartbeats = startHeartbeats(clients);
  }
  const claims = await claimAndStart(setup.rooms);
  report.claims = { claimMs: claims.claimMs, startedRooms: claims.startedRooms, startSpreadMs: claims.startSpreadMs,
    claimSummary: summarize(claims.claimLatencies), retries: claims.claimRetries.length, retrySamples: claims.claimRetries.slice(0, 5), errors: claims.errors.length, errorSamples: claims.errors.slice(0, 5) };
  if (claims.errors.length || claims.startedRooms !== setup.roomCount) throw new Error('Claim/start did not succeed for every room.');
  await synchronize('started');
  maxPendingHttp = 0;
  let stopProfile;
  if (arg('inspectPort', '')) {
    try { const { profileLocalWorkerd } = await import('./profile-local-workerd.mjs'); stopProfile = await profileLocalWorkerd(Number(arg('inspectPort'))); }
    catch (e) { report.profileError = e.message; }
  }
  report.activityStart = Date.now();
  const wire = () => clients.reduce((total, client) => {
    total.read += client.socket._socket?.bytesRead ?? 0; total.written += client.socket._socket?.bytesWritten ?? 0; return total;
  }, { read: 0, written: 0 });
  const wireBefore = strict ? wire() : null;
  if (depth) {
    report.fullAuctions=await Promise.all(setup.rooms.map(completePlan));
    report.activityEnd=Date.now();
  } else {
  const workload = bidWorkload(setup.rooms, null, null);
  const ping = steadyPings(clients, durationMs);
  loopLag = loopLagSampler();
  const [bids, pings] = await Promise.all([workload, ping]);
  report.loopLag = loopLag.stop();
  report.activityEnd = Date.now();
  if (wireBefore) {
    const after = wire();
    report.socketWireBytes = { read: after.read - wireBefore.read, written: after.written - wireBefore.written };
  }
  if (stopProfile) {
    try { report.cpuProfile = await stopProfile(); } catch (e) { report.profileError = e.message; }
  }
  loopLag = null;
  report.ping = { summary: summarize(pings.latencies), errors: pings.errors.length, errorSamples: pings.errors.slice(0, 5), messages: pings.pingSequence, heartbeats: pings.heartbeats, windowMs: pings.windowMs, windowHeartbeats: pings.windowHeartbeats };
  report.actions = { accepted: bids.accepted, latencySummary: bids.actionSummary, errors: bids.errors.length, errorSamples: bids.errors.slice(0, 5), expectedConflicts: bids.expectedConflicts.length, conflictCodes: bids.expectedConflicts.map(item => item.code) };
  report.broadcast = { deliverySummary: bids.deliverySummary, missing: bids.missing.length, missingSamples: bids.missing.slice(0, 5) };
  if (strict) {
    report.samples = { bid: bids.actionLatencies, broadcast: bids.deliveryLatencies, ping: pings.latencies };
    report.maxPendingHttp = maxPendingHttp;
    report.httpPool = { ...pool };
  }
  report.settlement = await settlement(setup.rooms);
  }
  // Quick and Standard have different wall-clock lengths. Each depth diagnostic
  // verifies all members before finishing. Capacity peers still share the barrier.
  if (!depth) await synchronize('settled');
  report.http = { requests: httpStats.requests, errors: httpStats.errors, statuses: httpStats.statuses, errorSamples: httpStats.errorSamples };
  report.serverTiming = Object.fromEntries([...serverTiming].map(([key, samples]) => [key, summarize(samples)]));
  report.sockets = {
    connected: clients.filter(client => client.version >= 0).length,
    errors: clients.reduce((sum, client) => sum + client.errors.length, 0),
    closedEarly: clients.filter(client => client.closed || client.socket.readyState !== WebSocket.OPEN).length,
    closedCodes: clients.filter(client => client.closed).reduce((map, client) => { map[client.closed.code] = (map[client.closed.code] ?? 0) + 1; return map; }, {}),
    errorSamples: clients.flatMap(client => client.errors).slice(0, 5),
  };
  if (traceEnabled) await checkClock('after');
} catch (error) {
  report.failed = true;
  report.error = String(error);
  report.stack = error?.stack ?? null;
} finally {
  if (loopLag) report.loopLag = loopLag.stop();
  stopHeartbeats();
  await Promise.all(clients.map(client => client.close()));
  report.memory = { workerd: await memory.stop(), harnessRss: process.memoryUsage().rss };
  report.finishedAt = new Date().toISOString();
  report.snapshotDecodes = snapshotDecodes;
  if (traceEnabled) {
    if (strict) report.traceCounts = traceCounts;
    report.traces = traces;
  }
  if (outputPath) writeFileSync(outputPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({
    users, rooms: report.setup?.rooms ?? null, setupMs: report.setup?.setupMs ?? null,
    connectMs: report.connections?.connectMs ?? null, connected: report.connections?.connected ?? null,
    pingP95: report.ping?.summary?.p95 ?? null, pingErrors: report.ping?.errors ?? null,
    actions: report.actions?.accepted ?? null, actionP95: report.actions?.latencySummary?.p95 ?? null,
    broadcastP95: report.broadcast?.deliverySummary?.p95 ?? null, broadcastMissing: report.broadcast?.missing ?? null,
    loopLagP95: report.loopLag?.summary?.p95 ?? null, loopLagMax: report.loopLag?.summary?.max ?? null,
    httpErrors: report.http?.errors ?? null, statuses: report.http?.statuses ?? null,
    failed: report.failed ?? false,
  }));
}
