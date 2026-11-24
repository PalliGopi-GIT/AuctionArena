// Windows loopback performance experiments. Real credentials are never loaded.
import { spawn, spawnSync } from 'node:child_process';
import { generateKeyPairSync, createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, openSync, closeSync } from 'node:fs';
import { availableParallelism, cpus, freemem, tmpdir, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { strictVerdict } from './strict-load-verdict.mjs';

const args = Object.fromEntries(process.argv.slice(2).map(s => {
  const i = s.indexOf('=');
  if (!s.startsWith('--') || i < 3) throw new Error('Use --name=value arguments.');
  return [s.slice(2, i), s.slice(i + 1)];
}));
const integer = (key, fallback, min, max) => {
  const n = Number(args[key] ?? fallback);
  if (!Number.isInteger(n) || n < min || n > max) throw new Error('Invalid ' + key);
  return n;
};
const users = integer('users', 1000, 10, 3000), rooms = users / 10;
const instances = integer('instances', 1, 1, 10), peers = integer('generators', instances, instances, 20);
const basePort = integer('port', 9140, 1024, 65535 - instances);
const ramp = integer('ramp', 20, peers, 100);
const mode = args.mode ?? 'quick';
const depth = args.depth === 'true';
const sharedDirectory = args.sharedDirectory === 'true';
const dedicatedDirectory = args.dedicatedDirectory === 'true';
if (dedicatedDirectory && !sharedDirectory) throw new Error('A dedicated Directory requires sharedDirectory=true.');
const controls = args.controls === 'true';
const compression = args.compression ?? 'default';
if (!['default', 'small-plain', 'plain'].includes(compression)) throw new Error('Invalid compression control.');
const serverCompression = args.serverCompression ?? 'default';
if (!['default', 'plain'].includes(serverCompression)) throw new Error('Invalid server compression control.');
const profile = args.profile === 'true';
if (profile && (instances !== 1 || peers !== 1 || basePort >= 65435)) throw new Error('CPU profiling requires one local runtime and generator.');
const topology = args.affinity ?? 'default';
if (!['default', 'split'].includes(topology) || topology === 'split' && (instances !== 1 || peers !== 1)) throw new Error('Split affinity requires a single server and generator.');
if (!['quick', 'standard', 'mega'].includes(mode) || !Number.isInteger(rooms) || rooms < peers || peers % instances) throw new Error('Invalid workload geometry.');
if (process.platform !== 'win32' || !args.bundle || !args.modules || !args.output) throw new Error('Supply --bundle, --modules (installed Miniflare directory), and a new --output on Windows.');
const bundle = resolve(args.bundle), modules = resolve(args.modules), output = resolve(args.output);
if (existsSync(output)) throw new Error('Evidence directory already exists.');
if (!existsSync(bundle) || !existsSync(join(modules, 'package.json'))) throw new Error('Supply an existing Worker bundle and installed Miniflare directory.');
const scripts = dirname(fileURLToPath(import.meta.url));
const readJson = path => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
const save = (path, data) => writeFileSync(path, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
const floor = 1536 * 2 ** 20;
if (freemem() < floor) throw new Error('Insufficient free physical memory before start.');
const stray = spawnSync('tasklist.exe', ['/FI', 'IMAGENAME eq workerd.exe', '/FO', 'CSV', '/NH'], { windowsHide: true, encoding: 'utf8' });
if (stray.status !== 0 || /"workerd\.exe"/i.test(stray.stdout)) throw new Error('Unable to establish a clean workerd process baseline.');
mkdirSync(output, { recursive: true });
const privateDir = mkdtempSync(join(tmpdir(), 'arena-room-bench-'));
const marks = join(privateDir, 'barriers');
mkdirSync(marks);
const pair = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { format: 'pem', type: 'pkcs8' }, publicKeyEncoding: { format: 'pem', type: 'spki' } });
const processes = [], runtimes = [], generators = [], states = [], host = [];
const experiment = { users, rooms, roomSize: 10, instances, generators: peers, mode, depth, ramp, controls, sharedDirectory, dedicatedDirectory, profile, compression, serverCompression, affinity: topology,
  bundleSha256: createHash('sha256').update(readFileSync(bundle)).digest('hex'), node: process.version,
  host: { cpu: cpus()[0]?.model, logicalProcessors: availableParallelism(), totalBytes: totalmem(), memoryFloorBytes: floor },
  started: new Date().toISOString(), syntheticState: privateDir, pass: false };
if (topology === 'split') {
  experiment.masks = { server: integer('serverMask', 1, 1, Number.MAX_SAFE_INTEGER), generator: integer('clientMask', 4, 1, Number.MAX_SAFE_INTEGER) };
  if (BigInt(experiment.masks.server) & BigInt(experiment.masks.generator)) throw new Error('Affinity groups must be disjoint.');
}

function start(name, file, argv, cwd, input) {
  const log = openSync(join(privateDir, name + '.log'), 'wx');
  let child;
  try { child = spawn(file, argv, { cwd, windowsHide: true, stdio: name.startsWith('runtime-') ? ['pipe', log, log, 'ipc'] : ['pipe', log, log],
    env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' } }); } finally { closeSync(log); }
  processes.push(child);
  child.stdin.on('error', () => {}); // Child exit is checked by its owner.
  child.stdin.end(input);
  const done = new Promise((resolveDone, reject) => { child.once('error', reject); child.once('exit', resolveDone); });
  done.catch(() => {});
  return { child, done };
}
function terminate(child) {
  if (child.exitCode === null && child.signalCode === null && child.pid) {
    spawnSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
  }
}
function stop() { for (const child of [...processes].reverse()) terminate(child); }
function interrupted() { stop(); process.exit(130); }
process.once('SIGINT', interrupted); process.once('SIGTERM', interrupted);
function setMask(pid, mask) {
  const cmd = `$p=Get-Process -Id ${pid} -ErrorAction Stop; $p.ProcessorAffinity=[IntPtr]${mask}; if ($p.ProcessorAffinity.ToInt64() -ne ${mask}) { exit 2 }`;
  if (spawnSync('powershell.exe', ['-NoProfile', '-Command', cmd], { windowsHide: true }).status !== 0) throw new Error('Unable to verify affinity');
}
let watch, hardwareFailure, directoryOwner;
const runtimeProcesses = () => directoryOwner ? [...runtimes, directoryOwner] : runtimes;
const guard = new Promise((_, reject) => { hardwareFailure = reject; });
guard.catch(() => {});
function sample() {
  const ticks = cpus().reduce((a, c) => { a.idle += c.times.idle; a.total += Object.values(c.times).reduce((s,v) => s + v, 0); return a; }, { idle: 0, total: 0 });
  host.push({ at: Date.now(), free: freemem(), ...ticks });
  const earlier = host.at(-16);
  if (earlier && ticks.total > earlier.total && (ticks.idle - earlier.idle) / (ticks.total - earlier.total) < 0.05) {
    hardwareFailure(new Error('Host CPU exceeded 95 percent across 15 sampling intervals.'));
  }
  if (host.at(-1).free < floor) hardwareFailure(new Error('Host reached the free physical memory guard.'));
}
try {
  sample(); watch = setInterval(sample, 1000);
  if (dedicatedDirectory) {
    const port = basePort + instances;
    const state = join(privateDir, 'directory-state');
    const vars = `CLERK_ISSUER=https://local.auctionarena.test
CLERK_JWT_KEY="${pair.publicKey.trim()}"
WS_TICKET_SECRET=${randomBytes(32).toString('hex')}
LOCAL_BID_TIMING=1
`;
    directoryOwner = start('runtime-directory', process.execPath, [
      join(scripts, 'serve-local-load-bundle.mjs'), modules, bundle, state, '-', String(port), '', serverCompression, 'owner'
    ], dirname(bundle), vars);
    directoryOwner.state = state;
    directoryOwner.child.on('message', message => {
      if (message?.kind !== 'reply' || !runtimes[message.peer]?.child.connected) return;
      runtimes[message.peer].observeReply(message);
      runtimes[message.peer].child.send(message);
    });
    for (let attempt = 0; ; attempt++) {
      if (directoryOwner.child.exitCode !== null || attempt >= 100) throw new Error('Dedicated Directory startup failed.');
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/health`, { redirect:'error', signal:AbortSignal.timeout(1200) });
        if (response.ok && existsSync(state)) break;
      } catch { /* startup */ }
      await Promise.race([sleep(200), guard]);
    }
    const query = `(Get-CimInstance Win32_Process -Filter "ParentProcessId=${directoryOwner.child.pid} AND Name='workerd.exe'").ProcessId`;
    const pid = Number(spawnSync('powershell.exe', ['-NoProfile','-Command',query], {windowsHide:true,encoding:'utf8'}).stdout.trim());
    if (!pid) throw new Error('Cannot identify dedicated Directory workerd.');
    (experiment.runtimePids ??= []).push(pid);
  }
  for (let i = 0; i < instances; i++) {
    const port = basePort + i, state = join(privateDir, 'state-' + i);
    states.push(state);
    const vars = `CLERK_ISSUER=https://local.auctionarena.test\nCLERK_JWT_KEY="${pair.publicKey.trim()}"\nWS_TICKET_SECRET=${randomBytes(32).toString('hex')}\nLOCAL_BID_TIMING=1\n`;
    const proc = start('runtime-' + i, process.execPath, [join(scripts, 'serve-local-load-bundle.mjs'), modules, bundle, state, '-', String(port), profile ? String(port + 100) : '', serverCompression, sharedDirectory ? (!dedicatedDirectory && i === 0 ? 'owner' : 'peer') : ''], dirname(bundle), vars);
    runtimes.push(proc);
    const inFlightDirectory = new Map();
    const pipeMetrics = { peer:i, requests:0, pending:0, peakPending:0, samples:[] };
    if (sharedDirectory && (dedicatedDirectory || i > 0)) (experiment.directoryRelay ??= []).push(pipeMetrics);
    if (sharedDirectory) proc.child.on('message', m => {
      if ((dedicatedDirectory || i > 0) && m?.kind === 'pipe-metrics') {
        (experiment.directoryPipe ??= []).push({peer:i, requests:m.requests, peakPending:m.peakPending, samples:m.samples});
      }
      if ((dedicatedDirectory || i > 0) && m?.kind === 'directory' && (directoryOwner ?? runtimes[0]).child.connected) {
        pipeMetrics.requests++;
        pipeMetrics.pending++;
        pipeMetrics.peakPending = Math.max(pipeMetrics.peakPending, pipeMetrics.pending);
        if (m.id % 16 === 0 && pipeMetrics.samples.length < 512) {
          const projection = m.url === 'https://directory.internal/internal/rooms';
          inFlightDirectory.set(m.id, { started:performance.now(), queuedAt:projection ? JSON.parse(m.body).now : undefined });
        }
        (directoryOwner ?? runtimes[0]).child.send({...m,peer:i});
      }
      if (!dedicatedDirectory && i === 0 && m?.kind === 'reply' && runtimes[m.peer]?.child.connected) {
        runtimes[m.peer].observeReply(m);
        runtimes[m.peer].child.send(m);
      }
    });
    proc.observeReply = m => {
      pipeMetrics.pending--;
      const sample = inFlightDirectory.get(m.id);
      if (!sample) return;
      inFlightDirectory.delete(m.id);
      pipeMetrics.samples.push({ownerRoundTripMs:performance.now()-sample.started,
        ...(Number.isSafeInteger(sample.queuedAt) ? { enqueueToOwnerReplyMs:Date.now()-sample.queuedAt } : {})});
    };
    for (let attempts = 0; ; attempts++) {
      if (proc.child.exitCode !== null || attempts >= 100) throw new Error('Local runtime startup failed on port ' + port);
      try {
        const response = await fetch(`http://127.0.0.1:${port}/api/health`, { redirect: 'error', signal: AbortSignal.timeout(1200) });
        if (response.ok && (await response.json()).maxMembers === 20 && existsSync(state)) break;
      } catch { /* startup */ }
      await Promise.race([sleep(200), guard]);
    }
    // Only the workerd child of this Miniflare process is eligible for affinity.
    const cmd = `(Get-CimInstance Win32_Process -Filter "ParentProcessId=${proc.child.pid} AND Name='workerd.exe'").ProcessId`;
    const workerdPid = Number(spawnSync('powershell.exe', ['-NoProfile', '-Command', cmd], { windowsHide: true, encoding: 'utf8' }).stdout.trim());
    if (!workerdPid) throw new Error('Cannot identify local workerd PID');
    (experiment.runtimePids ??= []).push(workerdPid);
    if (topology === 'split') setMask(workerdPid, experiment.masks.server);
  }
  for (let i = 0; i < peers; i++) {
    const localRooms = Math.floor(rooms / peers) + Number(i < rooms % peers);
    const instance = i % instances, port = basePort + instance;
    const balanced = n => Math.floor(n / peers) + Number(i < n % peers);
    const gen = start('generator-' + i, process.execPath, [join(scripts, 'load-worker.mjs'), '--base=http://127.0.0.1:' + port,
      '--users=' + localRooms * 10, '--roomSize=10', '--bidSpreadMs=' + (depth ? 0 : 40000), '--duration=70000', '--timerSeconds=' + (depth ? 10 : 60), '--depth=' + depth,
      '--bids=8', '--separateStart=true', '--strict=true', '--trace=true', '--mode=' + (depth && i % 2 ? 'standard' : mode), '--isolateTraffic=' + controls,
      '--compression=' + compression,
      ...(profile ? ['--inspectPort=' + (port + 100)] : []),
      '--connectConcurrency=' + balanced(ramp), '--setupConcurrency=' + balanced(20),
      '--peers=' + peers, '--peer=' + i, '--totalRooms=' + rooms, '--roomOffset=' + i, '--barrier=' + marks,
      '--label=' + (peers === 1 ? 'auctionarena-' + users : 'arena-' + users + '-g' + i),
      '--key=-', '--output=' + join(output, 'load-' + i + '.json')], scripts, pair.privateKey);
    if (topology === 'split') setMask(gen.child.pid, experiment.masks.generator);
    generators.push(gen);
  }
  await Promise.race([guard, ...runtimeProcesses().map(p => p.done.then(() => { throw new Error('Runtime exited during workload'); })),
    Promise.all(generators.map(async (p, i) => {
      const exit = await p.done, report = readJson(join(output, 'load-' + i + '.json'));
      if (exit !== 0 || !report.sockets) {
        writeFileSync(join(marks, 'aborted'), 'failed');
        throw new Error('Local generator ' + i + ' did not complete its workload. See raw evidence.');
      }
    }))]);
  for (const p of runtimeProcesses()) p.child.send('shutdown');
  // Miniflare flushes and closes its workerd children before the SQLite
  // inspector opens their files. Killing the launcher can leave locked WALs.
  const graceful = await Promise.race([Promise.all(runtimeProcesses().map(p => p.done)).then(codes => codes.every(c => c === 0)), sleep(10000, false, { ref: false })]);
  if (!graceful) throw new Error('Local runtimes failed to close cleanly before SQLite inspection.');
  for (const pid of experiment.runtimePids) {
    const end = Date.now() + 5000;
    for (;;) {
      try { process.kill(pid, 0); } catch (e) { if (e.code === 'ESRCH') break; throw e; }
      if (Date.now() >= end) throw new Error('Owned workerd still running at SQLite inspection.');
      await sleep(100);
    }
  }
  const reports = generators.map((_, i) => readJson(join(output, 'load-' + i + '.json')));
  const integrity = [];
  for (let i = 0; i < instances; i++) {
    const expected = reports.reduce((n, report, peer) => n + (peer % instances === i ? report.setup.rooms : 0), 0);
    let data;
    for (let attempt = 0; attempt < 3; attempt++) {
      const verify = spawnSync(process.execPath, ['--no-warnings', join(scripts, 'check-load-integrity.mjs'), states[i], String(expected), '--private-wal-copy', ...(sharedDirectory ? ['--directory'] : [])], { encoding: 'utf8', maxBuffer: 32 * 2 ** 20, windowsHide: true });
      data = JSON.parse(verify.stdout);
      const transient = !data.pass && !data.problems.length && data.errors.length &&
        data.errors.every(e => /disk I\/O error|database is locked|database is busy/i.test(e.error));
      if (!transient || attempt === 2) break;
      save(join(output, 'integrity-' + i + '-attempt-' + (attempt + 1) + '.json'), data);
      await sleep(500 * (attempt + 1));
    }
    integrity.push(data); save(join(output, 'integrity-' + i + '.json'), data);
  }
  let directoryIntegrity;
  if (directoryOwner) {
    const verify = spawnSync(process.execPath, ['--no-warnings', join(scripts,'check-load-integrity.mjs'),
      directoryOwner.state, '0', '--private-wal-copy', '--directory'], {encoding:'utf8',maxBuffer:32*2**20,windowsHide:true});
    directoryIntegrity = JSON.parse(verify.stdout);
    save(join(output,'integrity-directory.json'), directoryIntegrity);
  }
  if (depth) {
    experiment.diagnostic = 'full-auction wall-clock soak';
    experiment.fullAuctions = reports.flatMap(r=>r.fullAuctions ?? []);
    experiment.pass = integrity.every(r=>r.pass) && experiment.fullAuctions.length===rooms &&
      reports.every(r=>!r.failed && !r.http.errors && !r.sockets.closedEarly && !r.sockets.errors && r.connections.connected===r.setup.rooms*10) &&
      experiment.fullAuctions.every(a=>{
        const row=integrity.flatMap(r=>r.roomDetails).find(r=>r.code===a.code);
        return a.members===10 && a.lots===({quick:80,standard:120})[a.mode] &&
          row?.status==='COMPLETED' && row.soldPlayers===a.sold && row.unsoldPlayers===a.unsold;
      });
  } else Object.assign(experiment, strictVerdict(reports, integrity, rooms, instances, { sharedDirectory, directoryIntegrity }));
} catch (error) { experiment.failure = error.message; }
finally {
  clearInterval(watch); stop();
  for (const [i, state] of states.entries()) {
    const path = join(output, 'integrity-' + i + '.json');
    if (existsSync(state) && !existsSync(path)) {
      let expected = 0;
      for (let j = i; j < peers; j += instances) expected += Math.floor(rooms / peers) + Number(j < rooms % peers);
      const result = spawnSync(process.execPath, ['--no-warnings', join(scripts, 'check-load-integrity.mjs'), state, String(expected)], { encoding: 'utf8', maxBuffer: 32 * 2 ** 20, windowsHide: true });
      try { save(path, JSON.parse(result.stdout)); } catch { experiment.integrityUnavailable = true; }
    }
  }
  experiment.ended = new Date().toISOString(); experiment.hostSamples = host;
  save(join(output, 'experiment.json'), experiment);
  console.log(JSON.stringify({ users, instances, peers, pass: experiment.pass, measurements: experiment.latency,
    failures: experiment.failures?.slice(0, 8) ?? experiment.failure }));
}
if (!experiment.pass) process.exitCode = 1;
