/**
 * Aggregates AUCTIONARENA-LOAD-TEST evidence. Per-level files are authoritative;
 * this script never invents a measurement. It writes load-summary.json next to
 * the per-level evidence and prints a compact table.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const directory = resolve(process.argv[2] ?? 'docs/reports/evidence/AUCTIONARENA-LOAD-TEST');
const levels = [100, 250, 500, 1000];
const TARGETS = { pingP95: 1000, broadcastP95: 2000, errors: 0 };
const mb = value => value === null || value === undefined ? null : Math.round(value / 1048576);

function readJson(file) {
  try { return JSON.parse(readFileSync(file, 'utf8')); }
  catch { return null; }
}

const rows = [];
for (const users of levels) {
  const harnessFile = join(directory, `load-${users}.json`);
  const integrityFile = join(directory, `integrity-${users}.json`);
  const report = readJson(harnessFile);
  const integrity = readJson(integrityFile);
  const failures = [];
  if (!report) {
    rows.push({ users, present: false, pass: false, failures: ['missing harness evidence'] });
    continue;
  }
  const rooms = report.setup?.rooms ?? 0;
  const expectedRooms = Math.ceil(users / 20);
  const connected = report.connections?.connected ?? 0;
  const attempted = report.connections?.attempted ?? 0;
  const httpErrors = report.http?.errors ?? null;
  const pingErrors = report.ping?.errors ?? null;
  const actionErrors = report.actions?.errors ?? null;
  const socketErrors = report.sockets?.errors ?? null;
  const closedEarly = report.sockets?.closedEarly ?? null;
  const missing = report.broadcast?.missing ?? null;
  const accepted = report.actions?.accepted ?? 0;
  const expectedActions = rooms * (report.workload?.bidRounds ?? 0);
  const settled = (report.settlement ?? []).filter(room => room.status === 'RESULT' && !room.timeout);
  const pingP95 = report.ping?.summary?.p95 ?? null;
  const broadcastP95 = report.broadcast?.deliverySummary?.p95 ?? null;

  if (report.failed) failures.push(`harness error: ${report.error ?? 'unknown'}`);
  if (attempted !== users) failures.push(`attempted ${attempted}/${users}`);
  if (connected !== attempted) failures.push(`connected ${connected}/${attempted}`);
  if (rooms !== expectedRooms) failures.push(`rooms ${rooms}/${expectedRooms}`);
  if (httpErrors !== TARGETS.errors) failures.push(`http errors ${httpErrors}`);
  if (pingErrors !== TARGETS.errors) failures.push(`ping errors ${pingErrors}`);
  if (actionErrors !== TARGETS.errors) failures.push(`action errors ${actionErrors}`);
  if (socketErrors !== TARGETS.errors) failures.push(`socket errors ${socketErrors}`);
  if (closedEarly !== TARGETS.errors) failures.push(`sockets closed early ${closedEarly}`);
  if (missing !== TARGETS.errors) failures.push(`missing broadcasts ${missing}`);
  if (accepted !== expectedActions) failures.push(`accepted ${accepted}/${expectedActions}`);
  if (report.actions?.expectedConflicts !== rooms) failures.push(`race conflicts ${report.actions?.expectedConflicts}/${rooms}`);
  if (settled.length !== rooms) failures.push(`settled ${settled.length}/${rooms}`);
  if (pingP95 === null || pingP95 > TARGETS.pingP95) failures.push(`ping p95 ${pingP95} ms`);
  if (broadcastP95 === null || broadcastP95 > TARGETS.broadcastP95) failures.push(`broadcast p95 ${broadcastP95} ms`);
  if (!report.memory?.workerd) failures.push('missing workerd memory sample');
  if (!integrity) failures.push('missing integrity evidence');
  else {
    if (!integrity.pass) failures.push(`integrity: ${integrity.problems?.length ?? 0} problems, ${integrity.errors?.length ?? 0} errors`);
    if (integrity.rooms !== expectedRooms) failures.push(`integrity rooms ${integrity.rooms}/${expectedRooms}`);
  }

  const afterDeadline = settled
    .map(room => room.lastDeliveryAfterDeadline)
    .filter(value => typeof value === 'number');
  rows.push({
    users, present: true, rooms, expectedRooms,
    connected, attempted,
    httpErrors,
    setupMs: report.setup?.setupMs ?? null,
    connectMs: report.connections?.connectMs ?? null,
    claimMs: report.claims?.claimMs ?? null,
    pingP50: report.ping?.summary?.p50 ?? null,
    pingP95, pingP99: report.ping?.summary?.p99 ?? null, pingMax: report.ping?.summary?.max ?? null,
    pingErrors,
    acceptedActions: accepted, expectedActions,
    actionP50: report.actions?.latencySummary?.p50 ?? null,
    actionP95: report.actions?.latencySummary?.p95 ?? null,
    actionP99: report.actions?.latencySummary?.p99 ?? null,
    actionErrors, expectedConflicts: report.actions?.expectedConflicts ?? null,
    broadcastDelivered: report.broadcast?.deliverySummary?.count ?? null,
    broadcastP50: report.broadcast?.deliverySummary?.p50 ?? null,
    broadcastP95, broadcastP99: report.broadcast?.deliverySummary?.p99 ?? null,
    missingBroadcasts: missing,
    roomsSettled: settled.length,
    worstResultDeliveryAfterDeadlineMs: afterDeadline.length ? Math.max(...afterDeadline) : null,
    workerdCpuSeconds: report.memory?.workerd?.cpuSeconds ?? null,
    workerdPeakMb: mb(report.memory?.workerd?.peakWorkingSet),
    workerdMeanMb: mb(report.memory?.workerd?.meanWorkingSet),
    harnessRssMb: mb(report.memory?.harnessRss),
    loopLagP95: report.loopLag?.summary?.p95 ?? null,
    loopLagMax: report.loopLag?.summary?.max ?? null,
    integrityRooms: integrity?.rooms ?? null,
    integrityProblems: integrity?.problems?.length ?? null,
    integrityPass: integrity?.pass ?? null,
    generatedAt: report.generatedAt ?? null,
    pass: failures.length === 0,
    failures,
  });
}

const highestStable = rows.filter(row => row.pass).reduce((highest, row) => Math.max(highest, row.users), 0);
const summary = {
  task: 'AUCTIONARENA-LOAD-TEST',
  generatedAt: new Date().toISOString(),
  environment: 'local wrangler dev (workerd) with fresh persisted state per level; not a Cloudflare deployment',
  targets: TARGETS,
  note: 'Latency is measured by the Node harness over localhost. Action latency is the HTTP bid acknowledgement; broadcast latency is the WebSocket delivery of that accepted version to every room member.',
  highestVerifiedStableUsers: highestStable,
  pass: rows.every(row => row.pass),
  levels: rows,
};
writeFileSync(join(directory, 'load-summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({
  pass: summary.pass,
  highestVerifiedStableUsers: highestStable,
  levels: rows.map(row => ({
    users: row.users, pass: row.pass, rooms: row.rooms,
    connected: `${row.connected ?? '?'}/${row.attempted ?? '?'}`,
    pingP95: row.pingP95, actionP95: row.actionP95, broadcastP95: row.broadcastP95,
    httpErrors: row.httpErrors ?? null, actionErrors: row.actionErrors ?? null,
    integrityPass: row.integrityPass, failures: row.failures,
  })),
}, null, 2));
if (!summary.pass) process.exitCode = 1;
