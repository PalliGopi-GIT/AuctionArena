/** Isolated projection burst. No auth material, account bindings or user state. */
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { cpus, freemem } from 'node:os';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { applyAction, createRoom, settle } from '../packages/engine/src/index.ts';
import { settingsSchema } from '../packages/shared/src/index.ts';
import { roomSnapshot } from '../packages/shared/src/room-sync.ts';
import { catalog } from '../packages/catalog/src/index.ts';
import { approvePlan } from '../packages/catalog/src/room-plan.ts';

const [modules, output] = process.argv.slice(2);
const { Miniflare, convertV4MiniflareOptions } = createRequire(import.meta.url)(resolve(modules));
const source = await build({ stdin: { contents: `
import { DirectoryDurableObject } from './apps/api/src/worker/directory-do';
export class MeasuredDirectory extends DirectoryDurableObject {
  async fetch(req) {
    const start = Date.now();
    if (new URL(req.url).pathname === '/clock') return new Response(String(start));
    const result = await super.fetch(req);
    result.headers.set('x-entered-ms', String(start));
    result.headers.set('x-duration-ms', String(Date.now()-start));
    return result;
  }
}
export default {fetch(){return new Response(null,{status:404})}};
`, resolveDir: process.cwd() }, bundle:true, format:'esm', write:false });
function distribution(values) {
  const sorted = values.toSorted((a,b)=>a-b);
  return Object.fromEntries([50,95,99].map(p=>['p'+p, sorted[Math.ceil(values.length*p/100)-1]]));
}
const result = { trials:[], snapshots:[] };
function fixture(index, size) {
  const code = (0xB00000+index).toString(16).toUpperCase();
  const host = {id:'host-'+code,name:'Auction host'};
  const room = createRoom(code,host,settingsSchema.parse({}),1700000000000);
  for(let n=1;n<size;n++)room.members.push({...room.members[0],id:code+'-'+n,name:'Member '+n});
  return room;
}
for(const size of [10,20]) {
  const room = fixture(0,size);
  const plan = approvePlan(room,catalog,{mode:'mega',seed:'repeatable-snapshot',planVersion:1},room.createdAt,room.hostId);
  if(plan.players?.length!==250) throw Error('Mega plan fixture failed');
  room.players=plan.players;room.plan=plan.plan;
  result.snapshots.push({size,mode:'mega',history:0,bytes:Buffer.byteLength(JSON.stringify(roomSnapshot(room)))});
}
// Measure snapshots of actual engine states across a complete catalog plan.
for (const size of [10,20]) {
 let room=fixture(0,size), serial=0, now=room.createdAt;
 function act(user, action){room=applyAction(room,user,{id:'depth-'+(++serial),...action},now);}
 for(let n=0;n<room.teams.length;n++)act(room.members[n].id,{type:'claim',teamId:room.teams[n].id});
 act(room.hostId,{type:'plan-preview',mode:'mega',seed:'repeatable-snapshot'});
 act(room.hostId,{type:'plan-approve',planVersion:1});
 let maxBytes=0;
 for(let n=0;n<250;n++){
   if(room.status!=='LIVE' || room.players[room.currentPlayerIndex].id!==room.plan.orderedPlayerIds[n])throw Error('Unexpected lot');
   const player=room.players[room.currentPlayerIndex];
   if(n%10===0) {
     const team=room.teams[Math.floor(n/10)%room.teams.length];
     act(team.ownerId,{type:'bid',amount:player.basePrice,playerId:player.id,expectedVersion:room.version});
   }
   now=room.deadline;settle(room,now);
   maxBytes=Math.max(maxBytes,Buffer.byteLength(JSON.stringify(roomSnapshot(room))));
   if(n<249){now=room.resultAt;act(room.hostId,{type:'next'});}
 }
 result.snapshots.push({size,mode:'mega',lots:250,sold:room.players.filter(p=>p.status==='sold').length,
   history:roomSnapshot(room).history.length,maxBytes});
}
if(process.argv.includes('--snapshots-only')){
 writeFileSync(output,JSON.stringify(result.snapshots,null,2),{flag:'wx'});
 process.exit(0);
}
const ticks=()=>cpus().reduce((acc,c)=>[acc[0]+c.times.idle,acc[1]+Object.values(c.times).reduce((s,v)=>s+v,0)],[0,0]);
let samples=[], guard;
function sample(){
  samples.push(ticks()); if(samples.length>16)samples.shift();
  if(freemem()<1536*2**20)guard='free memory floor';
  if(samples.length===16 && (samples.at(-1)[0]-samples[0][0])/(samples.at(-1)[1]-samples[0][1])<.05)guard='host CPU';
}
sample();
const timer=setInterval(sample,1000);
try {
 for(let repeat=0;repeat<2;repeat++) {
  if(guard)throw Error(guard);
  const mf=new Miniflare(convertV4MiniflareOptions({host:'127.0.0.1',port:0,cf:false,modules:true,script:source.outputFiles[0].text,compatibilityDate:'2026-11-13',durableObjects:{DIRECTORY:{className:'MeasuredDirectory',useSQLite:true}}}));
  try {
   const ns=await mf.getDurableObjectNamespace('DIRECTORY'), stub=ns.get(ns.idFromName('global'));
   let best={rttMs:Infinity};
   for(let i=0;i<7;i++){
     const t=Date.now(), res=await stub.fetch('http://directory/clock'), clock=Number(await res.text()), end=Date.now();
     if(end-t<best.rttMs)best={rttMs:end-t,offsetMs:clock-(end+t)/2};
   }
   (result.clocks??=[]).push(best);
   for(const [version,step] of ['create','joined','invite','start','end'].entries()){
    const latency=[],duration=[],dispatch=[],age=[];let cursor=0,errors=0,active=0,peak=0;
    async function lane(){
     while(cursor<500 && !guard) {
      const room=fixture(cursor++,version===0?1:10);room.version=version+1;
      if(step==='start')room.status='LIVE';
      if(step==='end')room.status='COMPLETED';
      else room.players=[]; // Active Directory projection omits the live player pool.
      const issued=Date.now();
      active++; peak=Math.max(peak,active);
      const start=performance.now();
      try {
       const res=await stub.fetch('http://directory/internal/rooms',{method:'POST',headers:{'x-auction-internal':'room'},body:JSON.stringify({room,now:issued})});
       const data=await res.json();
       if(!res.ok || data.room?.code!==room.code || data.room?.version!==room.version || data.room.memberCount!==room.members.length)errors++;
       const entry=Number(res.headers.get('x-entered-ms')), elapsed=Number(res.headers.get('x-duration-ms'));
       duration.push(elapsed);
       dispatch.push(entry-best.offsetMs-issued);
       age.push(entry+elapsed-best.offsetMs-issued);
      } catch {errors++;}
      latency.push(performance.now()-start);active--;
     }
    }
    await Promise.all(Array.from({length:32},lane));
    result.trials.push({repeat,step,requests:latency.length,errors,peakClientOutstanding:peak,roundTripMs:distribution(latency),callbackWallMs:distribution(duration),inferredDispatchMs:distribution(dispatch),syntheticProjectionAgeMs:distribution(age)});
    if(guard || errors || latency.length!==500)throw Error(guard || 'projection verification failed');
   }
  } finally {await mf.dispose();}
 }
} catch(e) {result.failure=e.message;process.exitCode=1;}
finally {clearInterval(timer);writeFileSync(output,JSON.stringify(result,null,2),{flag:'wx'});}
