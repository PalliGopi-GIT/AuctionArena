/**
 * Read-only integrity check for rooms persisted by the workerd load runs.
 *
 * Usage: node scripts/check-load-integrity.mjs <state-dir> [expected-rooms]
 *
 * The state directory is the --persist-to directory used by `wrangler dev`.
 * Every SQLite file with a `room_state` table is treated as one room. The
 * checker never writes to the database and never invents a room.
 */
import { DatabaseSync } from 'node:sqlite';
import { copyFileSync, existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const root = resolve(process.argv[2] ?? '');
const expectedRooms = process.argv[3] === undefined ? null : Number(process.argv[3]);
if (!process.argv[2]) throw new Error('usage: check-load-integrity.mjs <state-dir> [expected-rooms]');
// Used only after all locally owned runtimes have exited. The database and WAL
// form the durable state. SQLite rebuilds its process-local SHM index on the
// private copy, avoiding stale Windows mappings on the original files.
const scratch = process.argv.includes('--private-wal-copy') ? mkdtempSync(join(tmpdir(), 'arena-verify-wal-')) : null;
let serial = 0;

function sqliteFiles(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...sqliteFiles(path));
    else if (entry.name.endsWith('.sqlite')) files.push(path);
  }
  return files;
}

function tableNames(db) {
  return db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => String(row.name));
}

function readRoom(path) {
  let db;
  try {
    let inspected = path;
    if (scratch) {
      inspected = join(scratch, (++serial) + '.sqlite');
      copyFileSync(path, inspected);
      if (existsSync(path + '-wal')) copyFileSync(path + '-wal', inspected + '-wal');
    }
    db = new DatabaseSync(inspected, { readOnly: !scratch });
    db.exec('PRAGMA query_only=ON');
    db.exec('PRAGMA busy_timeout=2000');
    const tables = tableNames(db);
    if (process.argv.includes('--directory') && tables.includes('dir_rooms')) {
      if (db.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok') throw Error('Directory integrity failed.');
      return { projections: db.prepare(`SELECT r.code, r.member_count AS members, count(m.user_id) AS memberships
        FROM dir_rooms r LEFT JOIN dir_memberships m ON m.code=r.code GROUP BY r.code ORDER BY r.code`).all() };
    }
    if (!tables.includes('room_state')) return null;
    if (db.prepare('PRAGMA quick_check').get()?.quick_check !== 'ok') throw new Error('SQLite quick_check failed.');
    const state = db.prepare('SELECT data FROM room_state WHERE id=1').get();
    if (!state) return null;
    const entry = JSON.parse(String(state.data));
    const events = db.prepare('SELECT data FROM room_events ORDER BY version').all()
      .map(row => JSON.parse(String(row.data)));
    const receipts = db.prepare('SELECT id, data FROM room_receipts ORDER BY ordinal').all()
      .map(row => ({ id: String(row.id), data: JSON.parse(String(row.data)) }));
    return { path, entry, events, receipts };
  } catch (error) {
    return { path, error: String(error) };
  } finally {
    try { db?.close(); } catch { /* already closed */ }
  }
}

function checkRoom({ path, entry, events, receipts }) {
  const room = entry.room;
  const problems = [];
  const soldPlayers = room.players.filter(player => player.status === 'sold');
  const unsoldPlayers = room.players.filter(player => player.status === 'unsold');
  const openPlayers = room.players.filter(player => player.status === 'open');
  const soldEvents = events.filter(event => event.type === 'sold');
  const unsoldEvents = events.filter(event => event.type === 'unsold');
  const bidEvents = events.filter(event => event.type === 'bid');
  const versions = events.map(event => event.version);
  const contiguous = versions.every((version, index) => index === 0 || version === versions[index - 1] + 1);
  const uniqueEventIds = new Set(events.map(event => event.id)).size === events.length;
  const uniqueReceipts = new Set(receipts.map(receipt => receipt.id)).size === receipts.length;
  const squadPlayers = room.teams.flatMap(team => team.squad.map(pick => ({ team, ...pick })));
  const squadIds = squadPlayers.map(pick => pick.playerId);
  const duplicateSquadPlayers = squadIds.filter((id, index) => squadIds.indexOf(id) !== index);
  const budgetTotal = room.teams.reduce((sum, team) => sum + team.budget + team.squad.reduce((s, pick) => s + pick.price, 0), 0);
  const expectedBudget = room.teams.length * room.settings.budget;
  const negativeBudget = room.teams.filter(team => team.budget < 0);
  const overSquad = room.teams.filter(team => team.squad.length > room.settings.maxSquad);

  if (soldPlayers.length !== soldEvents.length) problems.push(`sold players ${soldPlayers.length} vs sold events ${soldEvents.length}`);
  if (unsoldPlayers.length !== unsoldEvents.length) problems.push(`unsold players ${unsoldPlayers.length} vs unsold events ${unsoldEvents.length}`);
  if (new Set(events.map(event => event.id)).size !== events.length) problems.push('duplicate event ids');
  if (!uniqueEventIds) problems.push('duplicate event ids');
  if (!uniqueReceipts) problems.push('duplicate receipt ids');
  if (!contiguous) problems.push('event versions not contiguous');
  if (room.version !== (events.at(-1)?.version ?? 0)) problems.push(`room version ${room.version} vs last event ${events.at(-1)?.version ?? 0}`);
  if (budgetTotal !== expectedBudget) problems.push(`budget total ${budgetTotal} vs ${expectedBudget}`);
  for (const team of room.teams) {
    if (team.budget + team.squad.reduce((n, pick) => n + pick.price, 0) !== room.settings.budget) problems.push('individual budget ' + team.id);
    for (const pick of team.squad) {
      const player = room.players.find(item => item.id === pick.playerId);
      if (player?.status !== 'sold' || player.soldTo !== team.id || player.soldPrice !== pick.price) problems.push('unmatched purchase ' + pick.playerId);
    }
  }
  if (negativeBudget.length) problems.push(`negative budgets: ${negativeBudget.map(team => team.id).join(',')}`);
  if (overSquad.length) problems.push(`squads over max: ${overSquad.map(team => team.id).join(',')}`);
  if (duplicateSquadPlayers.length) problems.push(`duplicate squad players: ${[...new Set(duplicateSquadPlayers)].join(',')}`);
  if (room.status === 'LIVE' && openPlayers.length !== 1) problems.push(`live room has ${openPlayers.length} open players`);
  if (room.status === 'LIVE' && room.deadline === null) problems.push('live room has no deadline');
  if (room.status === 'PAUSED' && openPlayers.length !== 1) problems.push(`paused room has ${openPlayers.length} open players`);
  if (room.status === 'PAUSED' && room.deadline !== null) problems.push('paused room still has a deadline');
  if (['RESULT', 'COMPLETED', 'CLOSED'].includes(room.status) && openPlayers.length !== 0) problems.push(`${room.status} room has ${openPlayers.length} open players`);
  if (room.status === 'WAITING' && openPlayers.length !== 0) problems.push(`waiting room has ${openPlayers.length} open players`);
  if (room.status === 'RESULT' && room.resultAt === null) problems.push('result room has no resultAt');

  // The engine keeps the winning bid fields on the current lot until openNext
  // resets them, so a settled room must agree with its current player rather
  // than report zero.
  const current = room.currentPlayerIndex >= 0 ? room.players[room.currentPlayerIndex] : null;
  if (current && ['RESULT', 'COMPLETED', 'CLOSED'].includes(room.status)) {
    if (current.status === 'sold') {
      if (current.soldTo !== room.leadingTeamId) problems.push(`current sold player ${current.id} soldTo ${current.soldTo} vs leading ${room.leadingTeamId}`);
      if (current.soldPrice !== room.currentBid) problems.push(`current sold player ${current.id} price ${current.soldPrice} vs current bid ${room.currentBid}`);
    } else if (current.status === 'unsold') {
      if (room.currentBid !== 0 || room.leadingTeamId !== null) problems.push(`current unsold player ${current.id} has a live bid`);
    } else {
      problems.push(`settled room current player ${current.id} is ${current.status}`);
    }
  }
  if (room.status === 'COMPLETED' && room.completion_reason === undefined) problems.push('completed room has no completion_reason');
  if (room.status === 'CLOSED' && room.completion_reason === undefined) problems.push('closed room has no completion_reason');

  for (const player of soldPlayers) {
    if (!player.soldTo || !player.soldPrice) { problems.push(`sold player ${player.id} missing soldTo/soldPrice`); continue; }
    const team = room.teams.find(item => item.id === player.soldTo);
    if (!team) { problems.push(`sold player ${player.id} points at missing team ${player.soldTo}`); continue; }
    const pick = team.squad.find(item => item.playerId === player.id);
    if (!pick) problems.push(`sold player ${player.id} missing from ${team.id} squad`);
    else if (pick.price !== player.soldPrice) problems.push(`sold player ${player.id} squad price ${pick.price} vs ${player.soldPrice}`);
  }
  for (const player of unsoldPlayers) {
    if (player.soldTo !== undefined || player.soldPrice !== undefined) problems.push(`unsold player ${player.id} has sale fields`);
  }

  // A receipt is written for every accepted action. The version guard is a
  // useful sanity check; legacy receipts may omit expectedVersion.
  for (const receipt of receipts) {
    if (!receipt.id.includes(':')) problems.push(`receipt id without user prefix: ${receipt.id}`);
    const expected = receipt.data?.expectedVersion;
    if (expected !== undefined && expected > room.version) problems.push(`receipt ${receipt.id} expects future version ${expected}`);
  }

  // Approved plans: every ordered id must exist once, and every opened player
  // must follow the approved order. This is the persistence-level sequence check.
  if (room.plan) {
    const ordered = room.plan.orderedPlayerIds;
    if (new Set(ordered).size !== ordered.length) problems.push('plan order has duplicate player ids');
    const playerIds = new Set(room.players.map(player => player.id));
    const missing = ordered.filter(id => !playerIds.has(id));
    if (missing.length) problems.push(`plan order references ${missing.length} missing players`);
    const opened = events.filter(event => event.type === 'player_open');
    const openedIds = opened.map(event => {
      const player = room.players.find(item => event.text.startsWith(item.name));
      return player?.id ?? null;
    });
    const expectedOpened = ordered.slice(0, openedIds.length);
    if (openedIds.some((id, index) => id !== expectedOpened[index])) problems.push('opened player sequence differs from approved plan');
  }

  return {
    path,
    code: room.code,
    status: room.status,
    version: room.version,
    members: room.members.length,
    teams: room.teams.length,
    players: room.players.length,
    events: events.length,
    receipts: receipts.length,
    bidEvents: bidEvents.length,
    soldPlayers: soldPlayers.length,
    firstSold: soldPlayers.length === 1 ? { id: soldPlayers[0].id, price: soldPlayers[0].soldPrice, team: soldPlayers[0].soldTo } : null,
    unsoldPlayers: unsoldPlayers.length,
    openPlayers: openPlayers.length,
    budgetTotal,
    expectedBudget,
    problems,
  };
}

const files = sqliteFiles(root);
const rooms = [];
const errors = [], directories = [];
for (const file of files) {
  const read = readRoom(file);
  if (!read) continue;
  if (read.error) { errors.push({ path: file, error: read.error }); continue; }
  if (read.projections) directories.push(read.projections);
  else rooms.push(checkRoom(read));
}

const problems = rooms.flatMap(room => room.problems.map(problem => ({ code: room.code, problem })));
const result = {
  stateDir: root,
  inspection: scratch ? 'private copy of SQLite database and WAL after runtime exit' : 'read-only source',
  ...(process.argv.includes('--directory') ? { directories } : {}),
  sqliteFiles: files.length,
  rooms: rooms.length,
  expectedRooms,
  roomCountMatches: expectedRooms === null ? null : rooms.length === expectedRooms,
  statuses: rooms.reduce((counts, room) => ({ ...counts, [room.status]: (counts[room.status] ?? 0) + 1 }), {}),
  totals: {
    soldPlayers: rooms.reduce((sum, room) => sum + room.soldPlayers, 0),
    unsoldPlayers: rooms.reduce((sum, room) => sum + room.unsoldPlayers, 0),
    bidEvents: rooms.reduce((sum, room) => sum + room.bidEvents, 0),
    events: rooms.reduce((sum, room) => sum + room.events, 0),
    receipts: rooms.reduce((sum, room) => sum + room.receipts, 0),
  },
  problems,
  errors,
  pass: problems.length === 0 && errors.length === 0 && (expectedRooms === null || rooms.length === expectedRooms),
  roomDetails: rooms.map(({ problems: roomProblems, ...room }) => ({ ...room, problems: roomProblems })),
};
console.log(JSON.stringify(result, null, 2));
if (!result.pass) process.exitCode = 1;
