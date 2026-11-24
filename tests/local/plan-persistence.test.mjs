import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalRoomStore } from '../../apps/realtime/src/store.ts';
import { buildPlanPreview, planCsv } from '../../packages/catalog/src/room-plan.ts';
import { catalog } from '../../packages/catalog/src/index.ts';
import { roomSnapshot } from '../../packages/shared/src/room-sync.ts';

const settings={name:'Plan arena',teamCount:4,budget:8000,minSquad:2,maxSquad:8,maxOverseas:4,timerSeconds:30,lateExtension:true,bidIncrement:10,autoAdvance:false,resultSeconds:5,spectators:true};
const host={id:'host',name:'Host'},guest={id:'guest',name:'Guest'};
let sequence=0;
const intent=(type,extra={})=>({id:`plan-${++sequence}`,type,...extra});
const fails=(fn,code)=>assert.throws(fn,error=>error.code===code);

test('approved plan survives restart, stays immutable and keeps snapshots order-blind',()=>{
 const dir=mkdtempSync(join(tmpdir(),'auctionarena-plan-'));
 const path=join(dir,'rooms.json');
 try{
  let now=100000;
  let store=new LocalRoomStore(path,()=>now);
  const created=store.create(host,settings);const code=created.room.code;
  store.join(code,guest,created.inviteToken);
  store.action(code,host,intent('claim',{teamId:'t1'}));
  store.action(code,guest,intent('claim',{teamId:'t2'}));
  const draft=store.action(code,host,intent('plan-preview',{mode:'standard'}));
  assert.equal(draft.planDraft?.mode,'standard');
  assert.match(draft.planDraft.seed,/^[0-9a-f]{32}$/,'the store must inject a server seed');
  const preview=buildPlanPreview(draft,catalog);
  assert.equal(preview.ok,true);
  assert.equal(preview.counts.total,120);
  const ordered=preview.sets.flatMap(set=>set.players.map(player=>player.id));
  const approved=store.action(code,host,intent('plan-approve',{planVersion:draft.planDraft.planVersion}));
  assert.equal(approved.status,'LIVE');
  assert.deepEqual(approved.plan.orderedPlayerIds,ordered);
  assert.deepEqual(approved.plan.setBoundaries.map(set=>set.count),preview.sets.map(set=>set.count));
  assert.equal(approved.players[approved.currentPlayerIndex].id,ordered[0]);
  const savedPlan=structuredClone(approved.plan);
  const snapshot=roomSnapshot(approved);
  assert.equal(snapshot.plan,undefined);
  assert.equal(snapshot.planDraft,undefined);
  assert.equal(snapshot.planPosition,undefined);
  assert.equal(snapshot.planSummary?.total,120);
  assert.equal(snapshot.planSummary?.setName,preview.sets[0].name);
  assert.ok(!JSON.stringify(snapshot).includes('orderedPlayerIds'));
  assert.ok(!JSON.stringify(snapshot).includes(savedPlan.seed));
  fails(()=>store.action(code,host,intent('plan-regenerate',{mode:'quick'})),'PLAN_LOCKED');
  fails(()=>store.action(code,host,intent('plan-approve',{planVersion:savedPlan.planVersion})),'PLAN_LOCKED');
  const csv=planCsv(approved).trim().split('\n');
  assert.equal(csv.length,121);
  assert.equal(csv[1].split(',')[2],ordered[0]);
  // A new store on the same file is the local-server restart path.
  now+=1000;
  store=new LocalRoomStore(path,()=>now);
  const recovered=store.get(code,host);
  assert.deepEqual(recovered.plan,savedPlan);
  // Wake-up pauses a live lot because the host is not connected; the plan is untouched.
  assert.equal(recovered.status,'PAUSED');
  assert.equal(recovered.currentPlayerIndex,approved.currentPlayerIndex);
  assert.equal(recovered.currentBid,approved.currentBid);
  assert.equal(recovered.players[recovered.currentPlayerIndex].id,ordered[0]);
  // Participants may read the room but never the order.
  const participant=roomSnapshot(store.get(code,guest));
  assert.equal(participant.plan,undefined);
  assert.ok(!JSON.stringify(participant).includes('orderedPlayerIds'));
 }finally{rmSync(dir,{recursive:true,force:true});}
});

test('a stale preview version cannot approve a newer plan',()=>{
 const store=new LocalRoomStore(null,()=>100000);
 const created=store.create(host,settings);const code=created.room.code;
 store.join(code,guest,created.inviteToken);
 store.action(code,host,intent('claim',{teamId:'t1'}));
 store.action(code,guest,intent('claim',{teamId:'t2'}));
 const first=store.action(code,host,intent('plan-preview',{mode:'quick'}));
 store.action(code,host,intent('plan-regenerate',{mode:'standard'}));
 fails(()=>store.action(code,host,intent('plan-approve',{planVersion:first.planDraft.planVersion})),'STALE_PLAN');
 assert.equal(store.get(code,host).plan,undefined);
});
