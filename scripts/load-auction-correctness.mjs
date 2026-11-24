/**
 * Single-room correctness and behaviour scenario for AuctionArena's workerd
 * runtime. It drives the real room API, Durable Object and WebSockets:
 *
 * - 20 members (the hard room cap), eight claimed teams and a real start
 * - an approved Quick plan, then two lots in the approved order
 * - competing bids, a duplicate accepted receipt, an ID reuse and two
 *   unauthorized bid attempts
 * - a two-client reconnect and a full 20-client convergence check
 *
 * Usage:
 *   node scripts/load-auction-correctness.mjs --base=http://127.0.0.1:8802 \
 *     --key=<private.pem> --output=<report.json> [--mode=quick|none]
 */
import { createRequire } from 'node:module';
import { sign } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const require = createRequire(import.meta.url);
const WebSocket = require('ws');
const args = process.argv.slice(2);
function arg(name, fallback) {
  const found = args.find(item => item.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : fallback;
}
const base = arg('base', 'http://127.0.0.1:8802').replace(/\/$/, '');
const keyPath = arg('key', '');
const issuer = arg('issuer', 'https://local.auctionarena.test');
const output = arg('output', '');
const mode = arg('mode', 'quick');
const users = Math.min(20, Number(arg('users', '20')));
const lots = Number(arg('lots', '2'));
if (!keyPath) throw new Error('--key=<private PEM path> is required');
if (!['quick', 'standard', 'mega', 'none'].includes(mode)) throw new Error('--mode must be quick, standard, mega or none');
const privateKey = require('node:fs').readFileSync(resolve(keyPath), 'utf8');
const origin = new URL(base).origin;

const settings = {
  name: 'Correctness Auction', teamCount: 8, budget: 8000, minSquad: 2, maxSquad: 8,
  maxOverseas: 4, timerSeconds: 10, lateExtension: true, bidIncrement: 10,
  autoAdvance: true, resultSeconds: 2, spectators: true,
};

const http = { requests: 0, errors: 0, statuses: {}, samples: [] };
const violations = [];
const notes = [];
function violation(code, detail) { violations.push({ code, detail }); }
function round(value) { return Math.round(value * 100) / 100; }
function delay(ms) { return new Promise(resolveDelay => setTimeout(resolveDelay, ms)); }
function summarize(values) {
  if (!values.length) return { count: 0 };
  const sorted = [...values].sort((a, b) => a - b);
  const at = p => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
  return {
    count: values.length, min: round(sorted[0]), p50: round(at(0.5)), p95: round(at(0.95)),
    p99: round(at(0.99)), max: round(sorted.at(-1)),
    mean: round(values.reduce((sum, value) => sum + value, 0) / values.length),
  };
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
async function api(path, { method = 'GET', token, body, timeout = 30000 } = {}) {
  http.requests++;
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  try {
    const response = await fetch(base + path, {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeout),
    });
    const text = await response.text();
    let data; try { data = JSON.parse(text); } catch { data = text; }
    http.statuses[response.status] = (http.statuses[response.status] ?? 0) + 1;
    if (response.status >= 500) {
      http.errors++;
      if (http.samples.length < 10) http.samples.push({ path, status: response.status, data });
    }
    return { status: response.status, data, ms: 0 };
  } catch (error) {
    http.errors++;
    if (http.samples.length < 10) http.samples.push({ path, status: 'network', message: String(error) });
    throw error;
  }
}

class Client {
  constructor(socket, member) {
    this.socket = socket;
    this.member = member;
    this.version = -1;
    this.latest = null;
    this.versionTimes = new Map();
    this.errors = [];
    this.closed = null;
    this.waiters = [];
    socket.on('message', raw => this.onMessage(raw));
    socket.on('error', error => this.errors.push(String(error)));
    socket.on('close', (code, reason) => { this.closed = { code, reason: String(reason) }; });
  }
  onMessage(raw) {
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return; }
    if (message?.type !== 'snapshot' || !message.room || !Number.isSafeInteger(message.room.version)) return;
    this.version = message.room.version;
    this.latest = message.room;
    if (!this.versionTimes.has(message.room.version)) this.versionTimes.set(message.room.version, performance.now());
    for (const waiter of [...this.waiters]) {
      let matched = false;
      try { matched = waiter.predicate(this); } catch { matched = false; }
      if (matched) {
        clearTimeout(waiter.timer);
        this.waiters.splice(this.waiters.indexOf(waiter), 1);
        waiter.resolve(performance.now() - waiter.since);
      }
    }
  }
  waitFor(predicate, timeout = 25000, label = 'condition') {
    if (predicate(this)) return Promise.resolve(0);
    return new Promise((resolveWaiter, reject) => {
      const waiter = {
        predicate, since: performance.now(), resolve: resolveWaiter,
        timer: setTimeout(() => {
          const index = this.waiters.indexOf(waiter);
          if (index >= 0) this.waiters.splice(index, 1);
          reject(new Error(`${label} timeout for ${this.member.id} at version ${this.version}`));
        }, timeout),
      };
      this.waiters.push(waiter);
    });
  }
  waitForVersion(version, since, timeout = 20000) {
    if (this.versionTimes.has(version)) return Promise.resolve(this.versionTimes.get(version) - since);
    if (this.version >= version) return Promise.resolve(performance.now() - since);
    return this.waitFor(client => client.version >= version, timeout, `version ${version}`);
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

async function connect(member) {
  const ticket = await api(`/api/rooms/${member.roomCode}/ws-ticket`, { method: 'POST', token: member.token });
  if (ticket.status !== 200) throw new Error(`ticket failed ${ticket.status}: ${JSON.stringify(ticket.data)}`);
  const socket = new WebSocket(`${base.replace(/^http/, 'ws')}/ws?room=${member.roomCode}`, [`ticket.${ticket.data.ticket}`]);
  const client = new Client(socket, member);
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
  return client;
}

async function refresh(host, code) {
  const response = await api(`/api/rooms/${code}`, { token: host.token });
  if (response.status !== 200) throw new Error(`state failed ${response.status}: ${JSON.stringify(response.data)}`);
  return response.data.room;
}

async function perform(code, user, build, { retries = 4, retryCodes = ['STALE_VERSION'] } = {}) {
  let room = await refresh(user, code);
  for (let attempt = 0; attempt < retries; attempt++) {
    const action = { ...build(room), expectedVersion: room.version };
    const started = Date.now();
    const response = await api(`/api/rooms/${code}/actions`, { method: 'POST', token: user.token, body: action });
    const ms = Date.now() - started;
    if (response.status === 200) return { response, action, room: response.data.room, ms, attempts: attempt + 1 };
    const codeName = response.data?.code;
    if (response.status === 400 && retryCodes.includes(codeName) && attempt < retries - 1) {
      room = await refresh(user, code);
      await delay(50);
      continue;
    }
    return { response, action, room: response.data?.room ?? room, ms, attempts: attempt + 1 };
  }
  throw new Error('unreachable');
}

function nextBidAmount(room) {
  if (!room.currentBid) return room.players[room.currentPlayerIndex]?.basePrice ?? 0;
  const step = room.currentBid < 200 ? 10 : room.currentBid <= 500 ? 20 : 25;
  return room.currentBid + step;
}
function bidderFor(room, members, excludedTeamId = null) {
  const owners = room.teams
    .filter(team => team.ownerId && team.id !== excludedTeamId && team.id !== room.leadingTeamId)
    .map(team => ({ team, member: members.find(item => item.id === team.ownerId) }))
    .filter(item => item.member);
  return owners[0] ?? null;
}
async function waitConverged(clients, timeout = 15000) {
  const started = Date.now();
  let lastSignature = null, stableSince = null;
  while (Date.now() - started < timeout) {
    const versions = clients.map(client => client.version);
    const signature = versions.join(',');
    if (versions.every(version => version === versions[0])) {
      if (signature === lastSignature) {
        if (stableSince === null) stableSince = Date.now();
        if (Date.now() - stableSince >= 500) return Date.now() - started;
      } else { lastSignature = signature; stableSince = null; }
    } else { lastSignature = signature; stableSince = null; }
    await delay(100);
  }
  return null;
}
function comparable(room) {
  return JSON.stringify({
    version: room.version, status: room.status, currentPlayerIndex: room.currentPlayerIndex,
    currentBid: room.currentBid, leadingTeamId: room.leadingTeamId,
    players: room.players.map(player => [player.id, player.status, player.soldTo ?? null, player.soldPrice ?? null]),
    teams: room.teams.map(team => [team.id, team.budget, team.squad]),
    planSummary: room.planSummary ?? null,
    members: room.members.map(member => [member.id, member.connected, member.ready]),
  });
}
function checkRoomIntegrity(room, label) {
  const sold = room.players.filter(player => player.status === 'sold');
  const unsold = room.players.filter(player => player.status === 'unsold');
  const open = room.players.filter(player => player.status === 'open');
  const budgetTotal = room.teams.reduce((sum, team) => sum + team.budget + team.squad.reduce((s, pick) => s + pick.price, 0), 0);
  const expectedBudget = room.teams.length * room.settings.budget;
  if (budgetTotal !== expectedBudget) violation(`${label}.budget`, `budget total ${budgetTotal} vs ${expectedBudget}`);
  if (room.teams.some(team => team.budget < 0)) violation(`${label}.negative-budget`, 'a team budget is negative');
  if (room.teams.some(team => team.squad.length > room.settings.maxSquad)) violation(`${label}.squad-overflow`, 'a squad exceeds maxSquad');
  const squadIds = room.teams.flatMap(team => team.squad.map(pick => pick.playerId));
  if (new Set(squadIds).size !== squadIds.length) violation(`${label}.duplicate-squad-player`, 'a player appears in more than one squad');
  for (const player of sold) {
    const team = room.teams.find(item => item.id === player.soldTo);
    if (!player.soldTo || !player.soldPrice || !team) { violation(`${label}.sold`, `${player.id} missing team or price`); continue; }
    const pick = team.squad.find(item => item.playerId === player.id);
    if (!pick || pick.price !== player.soldPrice) violation(`${label}.sold`, `${player.id} squad price mismatch`);
  }
  for (const player of unsold) if (player.soldTo !== undefined || player.soldPrice !== undefined) violation(`${label}.unsold`, `${player.id} has sale fields`);
  if (room.status === 'LIVE' && open.length !== 1) violation(`${label}.open`, `${open.length} open players in LIVE`);
  if (room.status !== 'LIVE' && open.length !== 0) violation(`${label}.open`, `${open.length} open players in ${room.status}`);
  const versions = room.history.map(event => event.version);
  if (!versions.every((version, index) => index === 0 || version === versions[index - 1] + 1)) violation(`${label}.versions`, 'history versions are not contiguous');
  if (new Set(room.history.map(event => event.id)).size !== room.history.length) violation(`${label}.event-ids`, 'duplicate event ids');
  if (room.history.at(-1)?.version !== room.version) violation(`${label}.version`, `history ends at ${room.history.at(-1)?.version} but room is ${room.version}`);
  if (sold.length !== room.history.filter(event => event.type === 'sold').length) violation(`${label}.sold-events`, 'sold player count differs from sold events');
  if (unsold.length !== room.history.filter(event => event.type === 'unsold').length) violation(`${label}.unsold-events`, 'unsold player count differs from unsold events');
  return { sold: sold.length, unsold: unsold.length, open: open.length, budgetTotal, expectedBudget, teams: room.teams.length };
}

const report = {
  task: 'AUCTIONARENA-LOAD-TEST/correctness',
  generatedAt: new Date().toISOString(),
  environment: { node: process.version, platform: process.platform, base, origin, users, mode, lots, settings },
  setup: null, connections: null, plan: null, claims: null, lots: [], actions: null, broadcasts: null,
  reconnect: null, duplicate: null, idReuse: null, unauthorized: null, convergence: [], integrity: [],
  http: null, sockets: null, violations, notes,
};
let clients = [];
let members = [];
let code = null;
let heartbeat = null;
try {
  const host = { id: `correctness_host_${Date.now()}`, name: 'Correctness host' };
  host.token = tokenFor(host);
  const created = await api('/api/rooms', { method: 'POST', token: host.token, body: settings });
  if (created.status !== 201) throw new Error(`create failed ${created.status}: ${JSON.stringify(created.data)}`);
  code = created.data.room.code;
  const inviteToken = created.data.inviteToken;
  members = [{ ...host, roomCode: code }];
  for (let index = 1; index < users; index++) {
    const user = { id: `correctness_${index}_${Date.now()}`, name: `Correctness ${index}` };
    user.token = tokenFor(user);
    const joined = await api(`/api/rooms/${code}/join`, { method: 'POST', token: user.token, body: { inviteToken } });
    if (joined.status !== 200) throw new Error(`join ${index} failed ${joined.status}: ${JSON.stringify(joined.data)}`);
    members.push({ ...user, roomCode: code });
  }
  report.setup = { room: code, members: members.length, users, status: 'WAITING' };

  // The room hard-caps membership at 20. A 21st join is rejected with the same
  // private response as a bad invitation, so record the rejection and confirm
  // the room did not grow. This is why a single room cannot host 50+ users.
  if (users === 20) {
    const overflow = { id: `correctness_overflow_${Date.now()}`, name: 'Overflow' };
    overflow.token = tokenFor(overflow);
    const overflowJoin = await api(`/api/rooms/${code}/join`, { method: 'POST', token: overflow.token, body: { inviteToken } });
    const afterOverflow = await refresh(host, code);
    report.cap = {
      attempted: users + 1, status: overflowJoin.status, code: overflowJoin.data?.code ?? null,
      membersAfter: afterOverflow.members.length,
    };
    if (overflowJoin.status === 200) violation('cap.join', 'a 21st member joined a 20-member room');
    if (afterOverflow.members.length !== 20) violation('cap.members', `room has ${afterOverflow.members.length} members after overflow join`);
  }

  clients = await Promise.all(members.map(connect));
  report.connections = { attempted: members.length, connected: clients.filter(client => client.version >= 0).length };
  for (const member of members) member.client = clients[members.indexOf(member)];
  // Presence is refreshed by any socket message. The load harness uses 200 ms;
  // this scenario uses 1 s so the 10 s host-presence timeout cannot pause a lot
  // while the test is measuring a long settlement.
  heartbeat = setInterval(() => {
    for (const client of clients) {
      if (client.socket.readyState === 1) {
        try { client.socket.send(JSON.stringify({ type: 'heartbeat' })); } catch { /* closing */ }
      }
    }
  }, 1000);

  const claimStarted = Date.now();
  const claimLatencies = [];
  for (let index = 0; index < 8; index++) {
    const result = await perform(code, members[index], () => ({ id: `claim-${index}`, type: 'claim', teamId: `t${index + 1}` }));
    if (result.response.status !== 200) throw new Error(`claim ${index} failed ${result.response.status}: ${JSON.stringify(result.response.data)}`);
    claimLatencies.push(result.ms);
  }
  report.claims = { claimMs: Date.now() - claimStarted, latency: summarize(claimLatencies) };

  if (mode !== 'none') {
    const preview = await perform(code, host, () => ({ id: 'plan-preview', type: 'plan-preview', mode }));
    if (preview.response.status !== 200) throw new Error(`plan-preview failed ${preview.response.status}: ${JSON.stringify(preview.response.data)}`);
    const draft = await api(`/api/rooms/${code}/plan`, { token: host.token });
    if (draft.status !== 200) throw new Error(`plan read failed ${draft.status}: ${JSON.stringify(draft.data)}`);
    if (!draft.data.plan?.ok) throw new Error(`plan preview not ok: ${JSON.stringify(draft.data.plan)}`);
    if (draft.data.plan.approved) throw new Error('plan unexpectedly already approved');
    const approve = await perform(code, host, room => ({ id: 'plan-approve', type: 'plan-approve', planVersion: draft.data.plan.planVersion }), { retries: 5 });
    if (approve.response.status !== 200) throw new Error(`plan-approve failed ${approve.response.status}: ${JSON.stringify(approve.response.data)}`);
    const approved = await api(`/api/rooms/${code}/plan`, { token: host.token });
    if (approved.status !== 200 || !approved.data.plan?.approved) throw new Error(`approved plan read failed ${approved.status}`);
    const approvedOrder = approved.data.plan.sets.flatMap(set => set.players.map(player => player.id));
    const catalogOrder = approved.data.plan.poolIds;
    report.plan = {
      mode, planVersion: approved.data.plan.planVersion, catalogVersion: approved.data.plan.catalogVersion,
      selected: approvedOrder.length, sets: approved.data.plan.sets.map(set => ({ name: set.name, count: set.players.length })),
      adjustments: approved.data.plan.adjustments, approvedOrderSample: approvedOrder.slice(0, 5), poolIdSample: catalogOrder.slice(0, 5),
      catalogOrderCheck: 'not evaluated here; WP-H core tests cover the catalog-order snapshot rule',
    };
    const first = approve.response.data.room;
    if (!first) throw new Error('plan-approve did not return the opened room');
    if (Object.hasOwn(first, 'plan') || Object.hasOwn(first, 'planDraft') || Object.hasOwn(first, 'planPosition')) violation('plan.leak', 'snapshot contains plan fields');
    if (JSON.stringify(first).includes('orderedPlayerIds')) violation('plan.leak', 'snapshot contains orderedPlayerIds');
  } else {
    const start = await perform(code, host, () => ({ id: 'start', type: 'start' }));
    if (start.response.status !== 200) throw new Error(`start failed ${start.response.status}: ${JSON.stringify(start.response.data)}`);
    report.plan = { mode: 'none' };
  }

  let approvedOrder = null;
  if (report.plan?.selected > 0) {
    const planResponse = await api(`/api/rooms/${code}/plan`, { token: host.token });
    if (planResponse.status !== 200 || !planResponse.data.plan?.sets) throw new Error(`approved plan re-read failed ${planResponse.status}`);
    approvedOrder = planResponse.data.plan.sets.flatMap(set => set.players.map(player => player.id));
  }
  const actionLatencies = [];
  const deliveryLatencies = [];
  let accepted = 0;

  for (let lotIndex = 0; lotIndex < lots; lotIndex++) {
    const lotStarted = Date.now();
    let room = await refresh(host, code);
    if (room.status !== 'LIVE') {
      const advanced = await Promise.race([
        (async () => { for (let attempt = 0; attempt < 150; attempt++) { const state = await refresh(host, code); if (state.status === 'LIVE') return state; await delay(100); } return null; })(),
      ]);
      if (!advanced) throw new Error(`lot ${lotIndex + 1} did not open; status ${room.status}`);
      room = advanced;
    }
    const lotPlayer = room.players[room.currentPlayerIndex];
    if (!lotPlayer) throw new Error(`lot ${lotIndex + 1} has no current player`);
    if (approvedOrder && lotPlayer.id !== approvedOrder[lotIndex]) violation(`lot.${lotIndex + 1}.sequence`, `opened ${lotPlayer.id}, expected ${approvedOrder[lotIndex]}`);
    notes.push({ lot: lotIndex + 1, player: lotPlayer.id, name: lotPlayer.name, basePrice: lotPlayer.basePrice });

    const roundResults = [];
    for (let round = 0; round < 5; round++) {
      room = await refresh(host, code);
      if (room.status !== 'LIVE') break;
      const bidder = bidderFor(room, members);
      if (!bidder) break;
      const amount = nextBidAmount(room);
      const playerId = room.players[room.currentPlayerIndex].id;
      const started = Date.now();
      const deliveryStarted = performance.now();
      const response = await api(`/api/rooms/${code}/actions`, {
        method: 'POST', token: bidder.member.token,
        body: { id: `lot-${lotIndex}-bid-${round}`, expectedVersion: room.version, type: 'bid', playerId, amount },
      });
      const ms = Date.now() - started;
      actionLatencies.push(ms);
      if (response.status !== 200) {
        roundResults.push({ round, status: response.status, code: response.data?.code ?? null, amount });
        if (response.data?.code === 'TOO_LATE' || response.data?.code === 'STALE_PLAYER') break;
        if (response.data?.code === 'BID_CHANGED' || response.data?.code === 'ALREADY_LEADING' || response.data?.code === 'STALE_VERSION') { await delay(50); continue; }
        violation(`lot.${lotIndex + 1}.bid`, `unexpected ${response.status} ${response.data?.code}`);
        break;
      }
      accepted++;
      const version = response.data.room.version;
      roundResults.push({ round, status: 200, teamId: bidder.team.id, amount, version });
      const deliveries = await Promise.all(clients.map(async client => {
        try { return await client.waitForVersion(version, deliveryStarted); }
        catch (error) { violation(`lot.${lotIndex + 1}.delivery`, String(error)); return null; }
      }));
      for (const delivery of deliveries) if (delivery !== null) deliveryLatencies.push(delivery);

      if (round === 0) {
        const duplicateBody = { id: `lot-${lotIndex}-bid-0`, expectedVersion: room.version, type: 'bid', playerId, amount };
        const duplicate = await api(`/api/rooms/${code}/actions`, { method: 'POST', token: bidder.member.token, body: duplicateBody });
        report.duplicate = {
          status: duplicate.status, code: duplicate.data?.code ?? null,
          originalVersion: version, duplicateVersion: duplicate.data?.room?.version ?? null,
          versionDelta: duplicate.data?.room ? duplicate.data.room.version - version : null,
        };
        if (duplicate.status !== 200) violation('duplicate.receipt', `duplicate returned ${duplicate.status} ${duplicate.data?.code}`);
        if (duplicate.data?.room?.version !== version) violation('duplicate.version', `duplicate changed version ${version} -> ${duplicate.data?.room?.version}`);

        const reused = await api(`/api/rooms/${code}/actions`, {
          method: 'POST', token: bidder.member.token,
          body: { ...duplicateBody, amount: amount + 10 },
        });
        report.idReuse = { status: reused.status, code: reused.data?.code ?? null, version: reused.data?.room?.version ?? null };
        if (reused.status !== 400 || reused.data?.code !== 'ID_REUSED') violation('duplicate.id-reuse', `expected ID_REUSED, got ${reused.status} ${reused.data?.code}`);

        const spectator = members[10];
        const before = (await refresh(host, code)).version;
        const unauthorized = await api(`/api/rooms/${code}/actions`, {
          method: 'POST', token: spectator.token,
          body: { id: `unauthorized-${lotIndex}`, expectedVersion: before, type: 'bid', playerId, amount: amount + 20 },
        });
        const after = (await refresh(host, code)).version;
        report.unauthorized = {
          status: unauthorized.status, code: unauthorized.data?.code ?? null,
          versionBefore: before, versionAfter: after,
        };
        if (unauthorized.status !== 400 || unauthorized.data?.code !== 'NO_TEAM') violation('unauthorized.teamless', `expected NO_TEAM, got ${unauthorized.status} ${unauthorized.data?.code}`);
        if (before !== after) violation('unauthorized.version', `teamless bid changed version ${before} -> ${after}`);

        const outsider = { id: `correctness_outsider_${Date.now()}`, name: 'Outsider' };
        outsider.token = tokenFor(outsider);
        const outsiderResponse = await api(`/api/rooms/${code}/actions`, {
          method: 'POST', token: outsider.token,
          body: { id: `outsider-${lotIndex}`, expectedVersion: after, type: 'bid', playerId, amount: amount + 30 },
        });
        if (![403, 404].includes(outsiderResponse.status)) violation('unauthorized.outsider', `expected 403/404, got ${outsiderResponse.status} ${outsiderResponse.data?.code}`);
      }

      if (round === 1) {
        room = await refresh(host, code);
        if (room.status === 'LIVE') {
          const firstBidder = bidderFor(room, members);
          const secondBidder = bidderFor(room, members, firstBidder?.team.id ?? null);
          if (firstBidder && secondBidder) {
            const raceAmount = nextBidAmount(room);
            const racePlayer = room.players[room.currentPlayerIndex].id;
            const raceVersion = room.version;
            const raceStarted = Date.now();
            const raceDeliveryStarted = performance.now();
            const both = await Promise.all([
              api(`/api/rooms/${code}/actions`, { method: 'POST', token: firstBidder.member.token, body: { id: `race-${lotIndex}-a`, expectedVersion: raceVersion, type: 'bid', playerId: racePlayer, amount: raceAmount } }),
              api(`/api/rooms/${code}/actions`, { method: 'POST', token: secondBidder.member.token, body: { id: `race-${lotIndex}-b`, expectedVersion: raceVersion, type: 'bid', playerId: racePlayer, amount: raceAmount } }),
            ]);
            const winners = both.filter(item => item.status === 200);
            const losers = both.filter(item => item.status !== 200);
            report.race = { winners: winners.length, losers: losers.length, loserCodes: losers.map(item => item.data?.code) };
            if (winners.length !== 1 || losers.length !== 1) violation('race.resolution', `expected one winner, got ${winners.length}/${losers.length}`);
            if (winners.length === 1) {
              const raceVersionAfter = winners[0].data.room.version;
              const deliveries = await Promise.all(clients.map(async client => {
                try { return await client.waitForVersion(raceVersionAfter, raceDeliveryStarted); }
                catch (error) { violation('race.delivery', String(error)); return null; }
              }));
              for (const delivery of deliveries) if (delivery !== null) deliveryLatencies.push(delivery);
            }
          }
        }
      }
    }

    const settled = await Promise.all(clients.map(client => client.waitFor(client => client.latest?.status === 'RESULT', 25000, 'RESULT')
      .catch(error => { violation(`lot.${lotIndex + 1}.settlement`, String(error)); return null; })));
    const hostResult = clients[0].latest;
    if (!hostResult || hostResult.status !== 'RESULT') throw new Error(`lot ${lotIndex + 1} did not settle`);
    const settledVersion = hostResult.version;
    const convergence = await waitConverged(clients);
    const snapshots = clients.map(client => client.latest);
    const signatures = new Set(snapshots.map(comparable));
    const integrity = checkRoomIntegrity(hostResult, `lot.${lotIndex + 1}`);
    report.lots.push({
      lot: lotIndex + 1, player: lotPlayer.id, name: lotPlayer.name,
      rounds: roundResults, status: hostResult.status, version: settledVersion,
      soldTo: hostResult.players[hostResult.currentPlayerIndex]?.soldTo ?? null,
      soldPrice: hostResult.players[hostResult.currentPlayerIndex]?.soldPrice ?? null,
      convergenceMs: convergence, clientSignatures: signatures.size, clients: snapshots.length,
      integrity,
    });
    if (signatures.size !== 1) violation(`lot.${lotIndex + 1}.convergence`, `${signatures.size} different client views at the settled state`);
    report.convergence.push({ lot: lotIndex + 1, convergenceMs: convergence, signatures: signatures.size, clients: snapshots.length });
    if (settled.some(value => value === null)) violation(`lot.${lotIndex + 1}.settlement`, 'not every client saw RESULT');

    if (lotIndex < lots - 1) {
      await Promise.all(clients.map(client => client.waitFor(client => client.latest?.status === 'LIVE', 20000, 'next LIVE')
        .catch(error => { violation(`lot.${lotIndex + 1}.advance`, String(error)); return null; })));
      const nextRoom = clients[0].latest;
      if (nextRoom.currentPlayerIndex <= hostResult.currentPlayerIndex) violation(`lot.${lotIndex + 1}.advance`, `index did not advance: ${hostResult.currentPlayerIndex} -> ${nextRoom.currentPlayerIndex}`);
      if (approvedOrder && nextRoom.players[nextRoom.currentPlayerIndex]?.id !== approvedOrder[lotIndex + 1]) violation(`lot.${lotIndex + 2}.sequence`, 'next lot does not follow the approved order');
      await waitConverged(clients);
    }
  }

  // Reconnect two non-host, non-team members and verify they receive the
  // current authoritative state. This is deliberately after the last lot so
  // the check is about recovery, not about changing the settled result.
  const reconnectIndexes = [8, 9];
  const reconnectResults = [];
  for (const index of reconnectIndexes) {
    const member = members[index];
    const beforeVersion = clients[index].version;
    const closeStarted = performance.now();
    await clients[index].close();
    const closedMs = performance.now() - closeStarted;
    await delay(300);
    const reconnectStarted = performance.now();
    const replacement = await connect(member);
    const reconnectMs = performance.now() - reconnectStarted;
    const received = replacement.latest;
    reconnectResults.push({
      user: member.id, beforeVersion, afterVersion: replacement.version,
      closedMs: round(closedMs), pauseMs: 300, reconnectMs: round(reconnectMs), status: received?.status ?? null,
      connected: received?.members.find(item => item.id === member.id)?.connected ?? null,
    });
    if (replacement.version < beforeVersion) violation('reconnect.version', `${member.id} reconnected at ${replacement.version} < ${beforeVersion}`);
    if (!received?.members.find(item => item.id === member.id)?.connected) violation('reconnect.presence', `${member.id} is not marked connected`);
    clients[index] = replacement;
    member.client = replacement;
  }
  report.reconnect = { count: reconnectResults.length, latency: summarize(reconnectResults.map(item => item.reconnectMs)), results: reconnectResults };
  await waitConverged(clients);

  const finalRoom = await refresh(host, code);
  const end = await perform(code, host, room => ({ id: 'end', type: 'end' }));
  if (end.response.status !== 200) violation('end', `end returned ${end.response.status} ${end.response.data?.code}`);
  else if (!['COMPLETED', 'CLOSED'].includes(end.response.data.room.status)) violation('end.status', `unexpected end status ${end.response.data.room.status}`);
  await waitConverged(clients);
  const ended = clients[0].latest;
  const finalIntegrity = checkRoomIntegrity(ended, 'final');
  const finalSignatures = new Set(clients.map(client => comparable(client.latest)));
  report.integrity.push({ stage: 'final', ...finalIntegrity, clientSignatures: finalSignatures.size, clients: clients.length });
  if (finalSignatures.size !== 1) violation('final.convergence', `${finalSignatures.size} different client views at the end`);

  report.actions = { accepted, latency: summarize(actionLatencies), rounds: actionLatencies.length };
  report.broadcasts = { delivery: summarize(deliveryLatencies), missing: 0 };
  report.final = {
    status: ended?.status ?? null, version: ended?.version ?? null,
    sold: ended?.players.filter(player => player.status === 'sold').length ?? null,
    unsold: ended?.players.filter(player => player.status === 'unsold').length ?? null,
    completionReason: ended?.completion_reason ?? null,
  };
  report.http = { requests: http.requests, errors: http.errors, statuses: http.statuses, samples: http.samples };
  report.sockets = {
    connected: clients.filter(client => client.version >= 0).length,
    errors: clients.reduce((sum, client) => sum + client.errors.length, 0),
    closedEarly: clients.filter(client => client.closed && ![1000, 1001].includes(client.closed.code)).length,
    closedCodes: clients.filter(client => client.closed).reduce((counts, client) => ({ ...counts, [client.closed.code]: (counts[client.closed.code] ?? 0) + 1 }), {}),
  };
  report.pass = violations.length === 0 && http.errors === 0;
} catch (error) {
  report.failed = true;
  report.error = String(error);
  report.stack = error?.stack ?? null;
  report.pass = false;
} finally {
  if (heartbeat) clearInterval(heartbeat);
  await Promise.all(clients.map(client => client.close().catch(() => {})));
  report.http = report.http ?? { requests: http.requests, errors: http.errors, statuses: http.statuses, samples: http.samples };
  report.sockets = report.sockets ?? {
    connected: clients.filter(client => client.version >= 0).length,
    errors: clients.reduce((sum, client) => sum + client.errors.length, 0),
    closedEarly: clients.filter(client => client.closed && ![1000, 1001].includes(client.closed.code)).length,
  };
  report.finishedAt = new Date().toISOString();
  if (output) {
    const path = resolve(output);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(report, null, 2));
  }
  console.log(JSON.stringify({
    room: code, users, mode, lots,
    connected: report.connections?.connected ?? null,
    accepted: report.actions?.accepted ?? null,
    actionP95: report.actions?.latency?.p95 ?? null,
    broadcastP95: report.broadcasts?.delivery?.p95 ?? null,
    reconnectP95: report.reconnect?.latency?.p95 ?? null,
    plan: report.plan?.selected ?? null,
    finalStatus: report.final?.status ?? null,
    violations: violations.length,
    httpErrors: report.http?.errors ?? null,
    failed: report.failed ?? false,
    error: report.error ?? null,
  }));
  if (!report.pass) process.exitCode = 1;
}
