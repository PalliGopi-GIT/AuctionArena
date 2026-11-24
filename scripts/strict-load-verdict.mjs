function percentiles(values) {
  if (!values.length || !values.every(n => Number.isFinite(n) && n >= 0)) return { count: 0 };
  const ordered = values.toSorted((a, b) => a - b);
  const at = fraction => ordered[Math.ceil(ordered.length * fraction) - 1];
  return { count: ordered.length, p50: at(.5), p95: at(.95), p99: at(.99) };
}

// Use the original observations. Averaging percentiles across generators can
// conceal a failing room owner, even when the pooled latency appears healthy.
export function strictVerdict(reports, integrity, rooms, instances, { sharedDirectory = false, directoryIntegrity } = {}) {
  const failures = [], codes = new Set();
  const check = (condition, description) => { if (!condition) failures.push(description); };
  function latencies(group, label) {
    const result = {};
    for (const [name, limit] of [['bid', 1000], ['broadcast', 1000], ['ping', 500]]) {
      const stats = percentiles(group.flatMap(r => r.samples?.[name] ?? []));
      check(stats.count > 0 && stats.p95 < limit, label + ' ' + name + ' p95 ' + (stats.p95 ?? 'missing'));
      result[name] = stats;
    }
    return result;
  }
  let accepted = 0, deliveries = 0, settled = 0, races = 0;
  const errors = { http: 0, actions: 0, ping: 0, sockets: 0, closedEarly: 0 };
  for (const [index, report] of reports.entries()) {
    const roomCount = report.setup.rooms, users = roomCount * 10, data = integrity[index % instances];
    const roomByCode = new Map(data.roomDetails.map(room => [room.code, room]));
    const where = 'generator ' + index + ' ';
    check(!report.failed, where + 'harness failed');
    check(report.connections.attempted === users && report.connections.connected === users && report.sockets.connected === users
      && report.setup.membersPerRoom.length === roomCount && report.setup.membersPerRoom.every(n => n === 10), where + 'connections or membership');
    check(report.claims.startedRooms === roomCount && report.claims.errors === 0, where + 'claim/start');
    for (const [name, n] of Object.entries({ http: report.http.errors, actions: report.actions.errors, ping: report.ping.errors, sockets: report.sockets.errors, closedEarly: report.sockets.closedEarly })) {
      check(n === 0, where + name + ' ' + n); errors[name] += n;
    }
    accepted += report.actions.accepted; races += report.actions.expectedConflicts;
    deliveries += report.broadcast.deliverySummary.count;
    check(report.actions.accepted === roomCount * 8 && report.samples?.bid?.length === roomCount * 8, where + 'main bid count');
    check(report.actions.expectedConflicts === roomCount && report.actions.conflictCodes.length === roomCount
      && report.actions.conflictCodes.every(code => code === 'STALE_VERSION'), where + 'race outcomes');
    check(report.broadcast.missing === 0 && report.broadcast.deliverySummary.count === roomCount * 90
      && report.samples?.broadcast?.length === roomCount * 90, where + 'exact version deliveries');
    check(report.samples?.ping?.length > 0 && report.samples.ping.length === report.ping.messages, where + 'ping accounting');
    check(report.settlement.length === roomCount, where + 'settlement count');
    const names = { quick: 80, standard: 120, mega: 250 };
    for (const result of report.settlement) {
      const persisted = roomByCode.get(result.room);
      check(!codes.has(result.room), 'duplicate room ownership ' + result.room); codes.add(result.room);
      const ok = result.status === 'RESULT' && result.clients === 10 && result.expectedClients === 10 && !result.diverged
        && result.expectedSale && persisted?.firstSold?.id === result.playerId && persisted.firstSold.price === result.soldPrice
        && persisted.firstSold.team === result.soldTo && persisted.soldPlayers === 1 && persisted.bidEvents === 9
        && persisted.members === 10 && persisted.players === names[report.workload.mode];
      if (ok) settled++; else check(false, 'first sale / durable outcome ' + result.room);
    }
  }
  check(codes.size === rooms, 'distinct room count');
  check(integrity.length === instances && integrity.every(r => r.pass) && integrity.reduce((s,r) => s + r.rooms, 0) === rooms, 'SQLite integrity');
  if (sharedDirectory) {
    if (directoryIntegrity) check(directoryIntegrity.pass && directoryIntegrity.rooms === 0, 'dedicated Directory SQLite integrity');
    const directories = [...integrity, ...(directoryIntegrity ? [directoryIntegrity] : [])].flatMap(r => r.directories ?? []);
    const rows = directories[0] ?? [];
    const projected = new Set(rows.map(r => r.code));
    check(directories.length === 1 && rows.length === rooms && projected.size === rooms &&
      rows.every(r => codes.has(r.code) && r.members === 10 && r.memberships === 10), 'shared Directory projections');
  }
  const overlapMs = Math.min(...reports.map(r => r.activityEnd)) - Math.max(...reports.map(r => r.activityStart));
  check(overlapMs >= 69000, 'simultaneous activity window');
  const perInstance = integrity.map((_, i) => latencies(reports.filter((r, j) => j % instances === i), 'runtime ' + i));
  const latency = latencies(reports, 'pooled');
  return { pass: failures.length === 0, failures, latency, perInstance, overlapMs, accepted, races, deliveries, settled, errors };
}
