import { text } from 'node:stream/consumers';
import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseEnv } from 'node:util';

const [moduleDirectory, bundle, state, vars, rawPort, rawInspector, compressionFlag, directoryRole] = process.argv.slice(2);
const port = Number(rawPort);
if (!moduleDirectory || !bundle || !state || !vars || !Number.isInteger(port) || port < 1024 || port > 65535) {
  throw new Error('Provide Miniflare module directory, local bundle, new state path, synthetic vars and loopback port.');
}
if (existsSync(state)) throw new Error('Direct load runtime requires fresh state.');
if (rawInspector && (!Number.isInteger(Number(rawInspector)) || Number(rawInspector) < 1024 || Number(rawInspector) > 65535)) throw new Error('Invalid local inspector port.');
const env = parseEnv(vars === '-' ? await text(process.stdin) : readFileSync(vars, 'utf8'));
if (env.CLERK_ISSUER !== 'https://local.auctionarena.test' || env.CLERK_SECRET_KEY || !env.CLERK_JWT_KEY || !env.WS_TICKET_SECRET) {
  throw new Error('Only the synthetic local authenticator is allowed.');
}
const { Miniflare, convertV4MiniflareOptions, Log, LogLevel } = createRequire(import.meta.url)(resolve(moduleDirectory));
// A private process pipe carries only Directory requests from test runtime 1
// to runtime 0. No internal HTTP route is published on either listener.
const pending = new Map();
let sequence = 0;
let peakPending = 0;
const pipeSamples = [];
// Sample at most 512 round trips. Retain only elapsed times and operation kind.
function observeDirectory(id, url, started, body, ownerMs) {
  if (id % 16 || pipeSamples.length >= 512) return;
  const sample = { kind: url.pathname === '/internal/rooms' ? 'upsert' : 'other',
    roundTripMs: performance.now() - started, ownerStubMs: ownerMs };
  if (sample.kind === 'upsert' && body) {
    const queuedAt = JSON.parse(body).now;
    if (Number.isSafeInteger(queuedAt)) sample.enqueueToReplyMs = Date.now() - queuedAt;
  }
  pipeSamples.push(sample);
}
const wrapper = `
 import app, { RoomDurableObject as Room, DirectoryDurableObject } from './original.mjs';
 export { DirectoryDurableObject };
 function bindings(env) {
   return { ...env, DIRECTORY: { idFromName(name) { if(name!=='global') throw Error('Unexpected Directory name');return name; }, get(){return env.LOCAL_DIRECTORY_PIPE;} } };
 }
 export class RoomDurableObject extends Room { constructor(ctx,env){super(ctx,bindings(env));} }
 export default { fetch(req,env,ctx){return app.fetch(req,bindings(env),ctx);} };
`;
const remoteOptions = directoryRole === 'peer' ? {
 modules: [
   {type:'ESModule',path:'entry.mjs',contents:wrapper},
   {type:'ESModule',path:'original.mjs',contents:readFileSync(bundle,'utf8')},
 ],
 serviceBindings: { async LOCAL_DIRECTORY_PIPE(request) {
   if (pending.size >= 512) return new Response(null,{status:503});
   const url = new URL(request.url);
   if (url.hostname !== 'directory.internal' || !url.pathname.startsWith('/internal/')) throw Error('Invalid Directory destination');
   const id = ++sequence, body = request.method === 'POST' ? await request.text() : undefined;
   const started = performance.now();
   const reply = new Promise((resolve,reject) => {
     const timer=setTimeout(()=>{ pending.delete(id); reject(Error('Directory pipe deadline')); },10000);
     pending.set(id,result=>{clearTimeout(timer);resolve(result);});
   });
   peakPending = Math.max(peakPending, pending.size);
   process.send({kind:'directory',id,url:url.href,method:request.method,caller:request.headers.get('x-auction-internal'),body});
   const result=await reply;
   observeDirectory(id, url, started, body, result.ownerStubMs);
   return new Response(result.body,{status:result.status,headers:{'content-type':'application/json'}});
 } }
} : { modules:true, scriptPath:resolve(bundle) };
const local = new Miniflare(convertV4MiniflareOptions({
  host: '127.0.0.1', port, cf: false,
  ...(rawInspector ? { inspectorHost: '127.0.0.1', inspectorPort: Number(rawInspector) } : {}),
  log: new Log(LogLevel.WARN),
  resourcePersistencePath: resolve(state),
  telemetry: { enabled: false },
  ...remoteOptions,
  compatibilityDate: '2026-11-13', compatibilityFlags: ['nodejs_compat', ...(compressionFlag === 'plain' ? ['no_web_socket_compression'] : [])],
  bindings: {
    CLERK_ISSUER: env.CLERK_ISSUER, CLERK_JWT_KEY: env.CLERK_JWT_KEY,
    WS_TICKET_SECRET: env.WS_TICKET_SECRET, LOCAL_BID_TIMING: env.LOCAL_BID_TIMING ?? '0',
    ALLOWED_ORIGINS: `http://127.0.0.1:${port}`,
  },
  durableObjects: {
    ROOM: { className: 'RoomDurableObject', useSQLite: true },
    DIRECTORY: { className: 'DirectoryDurableObject', useSQLite: true },
  },
}));
await local.ready;
if (directoryRole === 'owner') {
  const ns = await local.getDurableObjectNamespace('DIRECTORY');
  const directory = ns.get(ns.idFromName('global'));
  process.on('message', async m => {
    if (m?.kind !== 'directory') return;
    try {
      const start = performance.now();
      const response=await directory.fetch(m.url,{method:m.method,headers:{'content-type':'application/json','x-auction-internal':m.caller},body:m.body});
      process.send({kind:'reply',peer:m.peer,id:m.id,status:response.status,body:await response.text(),ownerStubMs:performance.now()-start});
    } catch { process.send({kind:'reply',peer:m.peer,id:m.id,status:503,body:'{}'}); }
  });
}
if(directoryRole==='peer') process.on('message',m=>{
  if(m?.kind!=='reply')return;
  pending.get(m.id)?.(m);pending.delete(m.id);
});
async function shutdown() {
  if (directoryRole === 'peer' && process.connected) {
    await new Promise(resolve => process.send({kind:'pipe-metrics', requests:sequence, peakPending, samples:pipeSamples}, resolve));
  }
  await local.dispose();
  process.exit(0);
}
process.on('message', message => { if (message === 'shutdown') void shutdown(); });
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, shutdown);
}
