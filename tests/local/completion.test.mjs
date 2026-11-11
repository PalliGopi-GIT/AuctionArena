import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createRoom, applyAction, settle, tick } from '../../packages/engine/src/index.ts';
import { bidRestriction } from '../../packages/shared/src/bid-rules.ts';
import { nextBid } from '../../packages/shared/src/domain.ts';
import { LocalRoomStore } from '../../apps/realtime/src/store.ts';
import { deriveAuctionResults } from '../../packages/results/src/index.ts';

const host = { id: 'host', name: 'Host' }, guest = { id: 'guest', name: 'Guest' };
const settings = { name: 'Completion', teamCount: 3, budget: 200, minSquad: 1, maxSquad: 8, maxOverseas: 4, timerSeconds: 10, lateExtension: false, bidIncrement: 10, autoAdvance: false, resultSeconds: 2, spectators: true };
let sequence = 0;
const intent = (type, extra = {}) => ({ id: `completion-${++sequence}`, type, ...extra });
function lobby(overrides = {}) {
  let room = createRoom('FINISH', host, { ...settings, ...overrides }, 100000);
  room.members.push({ ...guest, connected: true, ready: false, lastSeen: 100000 });
  room = applyAction(room, host.id, intent('claim', { teamId: 't1' }), 100000);
  return applyAction(room, guest.id, intent('claim', { teamId: 't2' }), 100000);
}
const start = (room = lobby()) => applyAction(room, host.id, intent('start'), 100000);
function result(overrides = {}) { const room = start(lobby(overrides)); settle(room, room.deadline); return room; }
const next = room => applyAction(room, host.id, intent('next'), 120000);

test('unaffordable remaining players end the auction without changing their outcomes', () => {
  const room = result();
  room.teams[0].budget = 24; room.teams[1].budget = 24;
  const before = structuredClone(room);
  const finished = next(room);
  assert.equal(finished.status, 'COMPLETED');
  assert.equal(finished.completion_reason, 'NO_AFFORDABLE_PLAYERS');
  assert.equal(finished.deadline, null); assert.equal(finished.resultAt, null);
  assert.equal(finished.players.filter(p => p.status === 'upcoming').length, 23);
  assert.equal(finished.players.filter(p => p.status === 'unsold').length, 1);
  assert.deepEqual(room, before);
  const summary = deriveAuctionResults(finished);
  assert.equal(summary.completionReason, 'NO_AFFORDABLE_PLAYERS');
  assert.match(summary.completionMessage, /afford a remaining player/);
});

test('an exact-price cheaper player later in the pool keeps the auction open', () => {
  const room = result(); room.teams[0].budget = 25; room.teams[1].budget = 0;
  const continued = next(room);
  assert.equal(continued.status, 'LIVE');
  assert.equal(continued.players[continued.currentPlayerIndex].basePrice, 50);
  assert.equal(continued.completion_reason, undefined);
});

test('minimum squad reserve is included in affordability and accepts the exact boundary', () => {
  const room = result({ minSquad: 2 }); room.teams[0].budget = 49; room.teams[1].budget = 0;
  assert.equal(next(room).completion_reason, 'NO_AFFORDABLE_PLAYERS');
  room.teams[0].budget = 50;
  assert.equal(next(room).status, 'LIVE');
});

test('wealth in full teams and unclaimed teams cannot keep an auction open', () => {
  const room = result(); room.teams[0].squad = Array.from({ length: 8 }, (_, i) => ({ playerId: `old${i}`, price: 1 })); room.teams[1].budget = 24;
  assert.equal(next(room).completion_reason, 'NO_AFFORDABLE_PLAYERS');
});

test('all participating squads full records the full-squad reason', () => {
  const room = result({ maxSquad: 2 });
  for (const team of room.teams.slice(0, 2)) team.squad = [{ playerId: 'old1', price: 1 }, { playerId: 'old2', price: 1 }];
  const finished = next(room);
  assert.equal(finished.completion_reason, 'SQUADS_FULL');
  assert.match(deriveAuctionResults(finished).completionMessage, /filled its squad/);
});

test('removed historical owners do not keep an unaffordable room open', () => {
  const room = result(); room.teams[0].budget = 24; room.blockedUserIds = [guest.id];
  const finished = next(room);
  assert.equal(finished.completion_reason, 'NO_AFFORDABLE_PLAYERS');
  assert.deepEqual(finished.teams[1], room.teams[1]);
});

test('disconnected owners still count because they can reconnect', () => {
  const room = result(); room.teams[0].budget = 0; room.members[1].connected = false;
  assert.equal(next(room).status, 'LIVE');
});

test('an overseas cap does not invent a financial completion reason', () => {
  const room = result({ maxOverseas: 0 });
  for (const player of room.players.slice(1)) player.overseas = true;
  assert.equal(next(room).status, 'LIVE');
});

test('pool exhaustion completes despite unmet minimums and has priority over financial checks', () => {
  const room = result({ minSquad: 2 }); room.players = room.players.slice(0, 1);
  const finished = next(room);
  assert.equal(finished.completion_reason, 'POOL_EXHAUSTED');
  assert.equal(deriveAuctionResults(finished).teams[0].minimumMissing, 2);
});

test('automatic completion waits for result display and emits one final event', () => {
  const room = result({ autoAdvance: true }); room.teams[0].budget = 0; room.teams[1].budget = 0;
  const due = room.resultAt;
  tick(room, due - 1); assert.equal(room.status, 'RESULT');
  tick(room, due); assert.equal(room.completion_reason, 'NO_AFFORDABLE_PLAYERS');
  const finished = structuredClone(room); tick(room, due + 10000); settle(room, due + 10000);
  assert.deepEqual(room, finished);
  assert.equal(room.history.filter(e => e.type === 'completed').length, 1);
});

test('manual mode holds the final result until the host advances', () => {
  const room = result(); room.teams[0].budget = 0; room.teams[1].budget = 0;
  tick(room, room.resultAt + 10000); assert.equal(room.status, 'RESULT');
  assert.equal(next(room).completion_reason, 'NO_AFFORDABLE_PLAYERS');
});

test('host end settles a paused leading bid before recording the reason', () => {
  let room = start();
  room = applyAction(room, guest.id, intent('bid', { playerId: 'p1', amount: 100 }), 100001);
  room = applyAction(room, host.id, intent('pause'), 100002);
  const finished = applyAction(room, host.id, intent('end'), 100003);
  assert.equal(finished.completion_reason, 'HOST_ENDED');
  assert.equal(finished.players[0].status, 'sold');
  assert.equal(finished.teams[1].budget, 100);
  assert.deepEqual(finished.teams[1].squad, [{ playerId: 'p1', price: 100 }]);
  assert.equal(finished.players[1].status, 'upcoming');
});

test('closing before start records a distinct reason and no false results', () => {
  const closed = applyAction(lobby(), host.id, intent('end'), 100001);
  assert.equal(closed.status, 'CLOSED'); assert.equal(closed.completion_reason, 'HOST_CLOSED');
  assert.equal(deriveAuctionResults(closed).totalSpent, 0);
});

const restrictions = [
  ['full squad', room => { room.teams[1].squad = Array.from({ length: 8 }, () => ({ playerId: 'old', price: 1 })); }, 'SQUAD_FULL'],
  ['overseas cap', room => { room.settings.maxOverseas = 0; room.players[0].overseas = true; }, 'OVERSEAS_LIMIT'],
  ['purse too small', room => { room.teams[1].budget = 99; }, 'INSUFFICIENT_BUDGET'],
  ['minimum reserve', room => { room.settings.minSquad = 2; room.teams[1].budget = 124; }, 'INSUFFICIENT_BUDGET'],
  ['already leading', room => { room.leadingTeamId = 't2'; room.currentBid = 100; }, 'ALREADY_LEADING'],
  ['paused room', room => { room.status = 'PAUSED'; room.deadline = null; }, 'NOT_LIVE'],
  ['expired deadline', room => { room.deadline = 100001; }, 'TOO_LATE'],
];
for (const [name, change, code] of restrictions) test(`bid explanation matches server rejection: ${name}`, () => {
  const room = start(); change(room);
  const reason = bidRestriction(room, guest.id, 100001);
  assert.equal(reason?.code, code); assert.ok(reason.message.length > 10);
  assert.throws(() => applyAction(room, guest.id, intent('bid', { playerId: 'p1', amount: nextBid(room) }), 100001), error => error.code === code);
});

test('a valid exact-price bid needs no explanation and both spectator and result states do', () => {
  const room = start(); room.teams[1].budget = 100;
  assert.equal(bidRestriction(room, guest.id, 100001), null);
  assert.equal(bidRestriction(room, 'spectator', 100001).code, 'NO_TEAM');
  settle(room, room.deadline);
  assert.equal(bidRestriction(room, guest.id, 100001).code, 'NOT_LIVE');
});

test('affordability reason, final sales and idempotency survive file recovery; old results still load', () => {
  const directory = resolve(mkdtempSync(join(tmpdir(), 'auctionarena-completion-')));
  const file = join(directory, 'rooms.json');
  try {
    let now = 100000;
    let store = new LocalRoomStore(file, () => now);
    const { room, inviteToken } = store.create(host, { ...settings, teamCount: 2 });
    const code = room.code;
    store.join(code, guest, inviteToken);
    const action = (who, type, extra) => store.action(code, who, intent(type, extra));
    action(host, 'claim', { teamId: 't1' }); action(guest, 'claim', { teamId: 't2' }); action(host, 'start');
    // A real bidding ladder empties the guest purse on player one.
    for (let amount = 100; amount <= 200; amount += 10) action(amount % 20 === 0 ? guest : host, 'bid', { playerId: 'p1', amount });
    now += 10000; store.sweep(); store.get(code, host, true);
    for (let index = 1; index <= 5; index++) {
      action(host, 'next'); const current = store.get(code, host);
      if (index !== 4) action(host, 'bid', { playerId: current.players[index].id, amount: current.players[index].basePrice });
      now += 10000; store.sweep(); store.get(code, host, true);
    }
    const finish = intent('next'); store.action(code, host, finish);
    const confirmed = store.get(code, host);
    assert.equal(confirmed.completion_reason, 'NO_AFFORDABLE_PLAYERS');
    assert.deepEqual(confirmed.teams.map(team => team.budget), [0, 0]);
    store = new LocalRoomStore(file, () => now);
    assert.equal(store.get(code, guest).completion_reason, 'NO_AFFORDABLE_PLAYERS');
    store.action(code, host, finish);
    assert.equal(store.get(code, host).history.filter(e => e.type === 'completed').length, 1);
    assert.equal(deriveAuctionResults(store.get(code, host)).totalSpent, 400);
    const saved = JSON.parse(readFileSync(file, 'utf8'));
    delete saved.rooms[code].room.completion_reason;
    writeFileSync(file, JSON.stringify(saved));
    store = new LocalRoomStore(file, () => now);
    assert.equal(deriveAuctionResults(store.get(code, host)).completionReason, null);
    saved.rooms[code].room.completion_reason = 'invented'; writeFileSync(file, JSON.stringify(saved));
    assert.throws(() => new LocalRoomStore(file, () => now), /Completion reason invariant/);
  } finally {
    assert.equal(resolve(file).startsWith(directory + '\\') || resolve(file).startsWith(directory + '/'), true);
    rmSync(directory, { recursive: true, force: true });
  }
});
