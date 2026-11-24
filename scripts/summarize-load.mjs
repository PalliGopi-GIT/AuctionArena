/**
 * Aggregates the per-level Worker load evidence into one PASS/FAIL summary.
 * Per-level files are authoritative; this script never invents a measurement.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const directory = resolve(process.argv[2] ?? 'docs/reports/evidence/WP-G-WORKERS-RUNTIME');
const levels = [100, 250, 500, 1000];
const TARGETS = { pingP95: 1000, broadcastP95: 2000, requestErrors: 0 };

const rows = [];
for (const users of levels) {
  const file = join(directory, `load-${users}.json`);
  let report;
  try { report = JSON.parse(readFileSync(file, 'utf8')); }
  catch { rows.push({ users, evidence: `load-${users}.json`, present: false, pass: false, failures: ['missing evidence'] }); continue; }
  const failures = [];
  const rooms = report.setup?.rooms ?? 0;
  const connected = report.connections?.connected ?? 0;
  const httpErrors = report.http?.errors ?? null;
  const pingErrors = report.ping?.errors ?? null;
  const socketErrors = report.sockets?.errors ?? null;
  const pingP95 = report.ping?.summary?.p95 ?? null;
  const broadcastP95 = report.broadcast?.deliverySummary?.p95 ?? null;
  const missing = report.broadcast?.missing ?? null;
  const accepted = report.actions?.accepted ?? 0;
  const expectedActions = rooms * (report.workload?.bidRounds ?? 0);
  const settled = (report.settlement ?? []).filter(room => room.status === 'RESULT' && !room.timeout).length;
  if (report.failed) failures.push(`harness error: ${report.error ?? 'unknown'}`);
  if (connected !== users) failures.push(`connected ${connected}/${users}`);
  if (httpErrors !== 0) failures.push(`http errors ${httpErrors}`);
  if (pingErrors !== 0) failures.push(`ping errors ${pingErrors}`);
  if (socketErrors !== 0) failures.push(`socket errors ${socketErrors}`);
  if (pingP95 === null || pingP95 > TARGETS.pingP95) failures.push(`ping p95 ${pingP95} ms`);
  if (broadcastP95 === null || broadcastP95 > TARGETS.broadcastP95) failures.push(`broadcast p95 ${broadcastP95} ms`);
  if (missing !== 0) failures.push(`missing broadcasts ${missing}`);
  if (settled !== rooms) failures.push(`settled ${settled}/${rooms}`);
  if (accepted !== expectedActions) failures.push(`accepted ${accepted}/${expectedActions} actions`);
  rows.push({
    users, evidence: `load-${users}.json`, present: true,
    rooms, connected, connectMs: report.connections?.connectMs ?? null,
    setupMs: report.setup?.setupMs ?? null,
    pingP95, pingP50: report.ping?.summary?.p50 ?? null, pingMax: report.ping?.summary?.max ?? null,
    actionP95: report.actions?.latencySummary?.p95 ?? null,
    broadcastP95, broadcastDelivered: report.broadcast?.deliverySummary?.count ?? null, missingBroadcasts: missing,
    acceptedActions: accepted, expectedActions,
    expectedConflicts: report.actions?.expectedConflicts ?? null,
    roomsSettled: settled, httpErrors, pingErrors, socketErrors,
    workerdCpuSeconds: report.memory?.workerd?.cpuSeconds ?? null,
    workerdPeakMb: report.memory?.workerd?.peakWorkingSet ? Math.round(report.memory.workerd.peakWorkingSet / 1048576) : null,
    harnessRssMb: report.memory?.harnessRss ? Math.round(report.memory.harnessRss / 1048576) : null,
    loopLagP95: report.loopLag?.summary?.p95 ?? null,
    generatedAt: report.generatedAt ?? null,
    pass: failures.length === 0, failures,
  });
}

const summary = {
  task: 'WP-G-WORKERS-RUNTIME',
  generatedAt: new Date().toISOString(),
  environment: 'local wrangler dev (workerd) with fresh persisted state per level; not a Cloudflare deployment',
  targets: TARGETS,
  note: 'Latency is measured by the Node harness over localhost. Action latency is reported but is not one of the stated pass criteria.',
  pass: rows.every(row => row.pass),
  levels: rows,
};
writeFileSync(join(directory, 'load-summary.json'), JSON.stringify(summary, null, 2));
console.log(JSON.stringify({ pass: summary.pass, levels: rows.map(row => ({ users: row.users, pass: row.pass, pingP95: row.pingP95, actionP95: row.actionP95, broadcastP95: row.broadcastP95, httpErrors: row.httpErrors, failures: row.failures })) }, null, 2));
