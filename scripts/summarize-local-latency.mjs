import { readFileSync } from 'node:fs';

const report = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const { http, ping, broadcast, clock, ramp, bidTimer } = report.traces ?? {};
if (!http || !clock?.length) throw new Error('Expected a traced local load report with clock probes.');

function stats(values) {
  const samples = values.filter(Number.isFinite).sort((a, b) => a - b);
  const at = p => samples.length ? Math.round(samples[Math.ceil(p * samples.length) - 1] * 1000) / 1000 : null;
  return { count: samples.length, p50: at(.5), p95: at(.95), p99: at(.99), max: at(1) };
}
function difference(end, start) { return typeof end === 'number' && typeof start === 'number' ? end - start : NaN; }
function clockBounds(phase) {
  const probes = clock.filter(probe => probe.phase === phase);
  const best = [...probes].sort((a, b) => (a.received - a.start) - (b.received - b.start))[0];
  return best ? {
    count: probes.length, bestRttMs: difference(best.received, best.start),
    offsetLowerMs: best.worker[1] - best.received - 1,
    offsetUpperMs: best.worker[0] - best.start + 1,
    maxWallDriftMs: Math.max(...probes.map(probe => Math.abs(probe.wallResidual))),
  } : null;
}

const good = http.filter(span => span.status === 200);
const ids = new Map(good.map(span => [span.id, span]));
const latePing = [...ping].sort((a, b) => (b.entered - b.sent) - (a.entered - a.sent)).slice(0, Math.ceil(ping.length * .05));
const firstPing = ping.reduce((start, item) => Math.min(start, item.sent), Infinity);
const pingWindow = p => Math.floor((p.sent - firstPing) / 5000);
function pingStages(samples) {
  return {
    elapsed: stats(samples.map(p => p.entered - p.sent)),
    nodeSendFlush: stats(samples.map(p => difference(p.flushed, p.sent))),
    sendToIngress: stats(samples.map(p => difference(p.ingress, p.sent))),
    ingressToPong: stats(samples.map(p => difference(p.pong, p.ingress))),
    outsidePongHandler: stats(samples.map(p => (p.entered - p.sent) - difference(p.pong, p.ingress))),
    pongToNodeCallback: stats(samples.map(p => difference(p.entered, p.pong))),
    nodeDecode: stats(samples.map(p => p.decoded - p.entered)),
    serverBufferedBytes: stats(samples.map(p => p.serverBuffer)),
    clientBufferedBytes: stats(samples.map(p => p.clientBuffer)),
  };
}
const workerSamples = report.memory?.workerd?.rawSamples ?? [];
const perProcess = new Map();
for (let i = 1; i < workerSamples.length; i++) {
  const [at, , , processes] = workerSamples[i];
  const [previousAt, , , previous] = workerSamples[i - 1];
  if (at <= previousAt) continue;
  for (const [pid, cpu, rss, hottestThread] of processes) {
    const before = previous.find(row => row[0] === pid);
    if (!before) continue;
    if (!perProcess.has(pid)) perProcess.set(pid, { cores: [], rss: [], busiestThread: [] });
    perProcess.get(pid).cores.push((cpu - before[1]) * 1000 / (at - previousAt));
    perProcess.get(pid).rss.push(rss / 2 ** 20);
    if (Number.isFinite(hottestThread) && Number.isFinite(before[3]) && hottestThread >= before[3]) {
      perProcess.get(pid).busiestThread.push((hottestThread - before[3]) * 1000 / (at - previousAt));
    }
  }
}
const result = {
  users: report.environment.users, rooms: report.setup?.rooms,
  clock: { before: clockBounds('before'), after: clockBounds('after') },
  httpMs: {
    createdToBodySent: stats(good.map(p => difference(p.bodySent, p.created))),
    startToWorkerIngress: stats(good.map(p => difference(p.worker?.[0], p.start))),
    bodySentToWorkerIngress: stats(good.map(p => difference(p.worker?.[0], p.bodySent))),
    workerIngressToForward: stats(good.map(p => difference(p.room?.[0], p.worker?.[0]))),
    forwardToRoomCallback: stats(good.map(p => difference(p.room?.[1], p.room?.[0]))),
    roomCallbackToReady: stats(good.map(p => difference(p.room?.[2], p.room?.[1]))),
    roomCallbackToReply: stats(good.map(p => difference(p.room?.[3], p.room?.[1]))),
    roomReplyToWorkerReply: stats(good.map(p => difference(p.worker?.[1], p.room?.[3]))),
    workerReplyToNodeWireHeaders: stats(good.map(p => difference(p.wireHeaders, p.worker?.[1]))),
    nodeWireHeadersToFetchHeaders: stats(good.map(p => difference(p.headers, p.wireHeaders))),
    nodeBodyRead: stats(good.map(p => difference(p.body, p.headers))),
    nodeBodyParse: stats(good.map(p => difference(p.parsed, p.body))),
  },
  broadcastMs: {
    sentToScheduled: stats(broadcast.map(p => difference(p.scheduled, ids.get(p.id)?.start))),
    scheduledToNodeCallback: stats(broadcast.map(p => p.entered - p.scheduled)),
    nodeDecode: stats(broadcast.map(p => p.decoded - p.entered)),
  },
  broadcastBytes: stats(broadcast.map(p => p.bytes)),
  pingMs: pingStages(ping),
  pingSlowestFivePercent: pingStages(latePing),
  pingWindows: [...new Set(ping.map(pingWindow))].sort((a, b) => a - b).map(window => ({
    fromFirstPingMs: window * 5000,
    rtt: stats(ping.filter(p => pingWindow(p) === window).map(p => p.entered - p.sent)),
  })),
  bidTimerLatenessMs: stats(bidTimer.map(p => p.fired - p.due)),
  rampMs: {
    ticket: stats(ramp.map(p => p.upgrade - p.begin)),
    upgradeToReady: stats(ramp.map(p => p.ready - p.upgrade)),
  },
  node: {
    averageCores: report.loopLag.cpuMs / report.loopLag.wallMs,
    cpuCoresPerSample: stats(report.loopLag.cpuSamples.map(p => p.cpuMs / p.intervalMs)),
    rssMiB: stats(report.loopLag.cpuSamples.map(p => p.rss / 2 ** 20)),
    eventLoopUtilization: report.loopLag.eventLoopUtilization,
    eventLoopDelayMs: report.loopLag.nativeDelayMs,
  },
  workerd: [...perProcess].map(([pid, p]) => ({ pid, cores: stats(p.cores), rssMiB: stats(p.rss),
    busiestThreadCores: stats(p.busiestThread) })),
};
console.log(JSON.stringify(result, null, 2));
