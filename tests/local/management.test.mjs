import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalRoomStore } from '../../apps/realtime/src/store.ts';
import { applyAction } from '../../packages/engine/src/index.ts';
import { settingsErrors } from '../../packages/shared/src/settings-rules.ts';

const defaults={name:'Management arena',teamCount:4,budget:8000,minSquad:2,maxSquad:8,maxOverseas:4,timerSeconds:30,lateExtension:true,bidIncrement:10,autoAdvance:false,resultSeconds:5,spectators:true};
const host={id:'host',name:'Host'},guest={id:'guest',name:'Guest'},third={id:'third',name:'Third'};
let sequence=0;
const intent=(type,extra={})=>({id:`management-${++sequence}`,type,...extra});
function fixture(path=null) {
 let now=100000;const store=new LocalRoomStore(path,()=>now);
 const {room,inviteToken}=store.create(host,defaults);const code=room.code;
 store.join(code,guest,inviteToken);
 store.action(code,host,intent('claim',{teamId:'t1'}));
 store.action(code,guest,intent('claim',{teamId:'t2'}));
 return {store,code,inviteToken,now:()=>now,advance:ms=>{now+=ms;},get:()=>store.get(code,host),action:(user,type,extra)=>store.action(code,user,intent(type,extra))};
}
const fails=(fn,code)=>assert.throws(fn,error=>error.code===code);

test('host changes waiting rules, budgets and name; claims survive and readiness resets',()=>{
 const f=fixture();f.action(host,'ready');f.action(guest,'ready');
 const settings={...defaults,name:'  Saturday Final  ',budget:9000,teamCount:6,timerSeconds:45};
 const room=f.action(host,'update-settings',{settings});
 assert.equal(room.name,'Saturday Final');assert.equal(room.settings.name,room.name);
 assert.equal(room.teams.length,6);assert.equal(room.teams[0].ownerId,host.id);assert.equal(room.teams[1].ownerId,guest.id);
 assert.ok(room.teams.every(t=>t.budget===9000&&t.squad.length===0));assert.ok(room.members.every(m=>!m.ready));
 assert.equal(room.history.at(-1).type,'settings_changed');
 assert.equal(f.store.get(f.code,guest).settings.timerSeconds,45);
});
test('only host edits settings; live settings stay frozen',()=>{
 const f=fixture();fails(()=>f.action(guest,'update-settings',{settings:defaults}),'HOST_ONLY');
 f.action(host,'start');const before=f.get();fails(()=>f.action(host,'update-settings',{settings:{...defaults,budget:20000}}),'SETTINGS_FROZEN');
 assert.deepEqual(f.get(),before);
});
test('shrinking teams cannot drop a claim; unclaimed tails may be removed',()=>{
 const f=fixture();f.action(guest,'claim',{teamId:'t4'});
 fails(()=>f.action(host,'update-settings',{settings:{...defaults,teamCount:2}}),'TEAM_CLAIMED');
 f.action(guest,'claim',{teamId:'t2'});assert.equal(f.action(host,'update-settings',{settings:{...defaults,teamCount:2}}).teams.length,2);
});
test('actor revalidates settings without trusting transport schemas',()=>{
 const f=fixture();for(const settings of [{...defaults,budget:NaN},{...defaults,teamCount:11},{...defaults,minSquad:4,maxSquad:2},{...defaults,teamCount:8,minSquad:4},{...defaults,name:'  '},{...defaults,spectators:'yes'},{...defaults,extra:123}]) {
  fails(()=>applyAction(f.get(),host.id,intent('update-settings',{settings}),f.now()),'INVALID_SETTINGS');
 }
 const incomplete={...defaults};delete incomplete.budget;
 assert.ok(settingsErrors(incomplete).length>0);
 fails(()=>new LocalRoomStore(null).create(host,incomplete),'INVALID_SETTINGS');
});
test('lobby participant leaves, frees claim and loses access but can rejoin by invitation',()=>{
 const f=fixture();const room=f.action(guest,'leave');assert.ok(!room.members.some(m=>m.id===guest.id));assert.equal(room.teams[1].ownerId,null);
 assert.equal(room.history.at(-1).type,'left');fails(()=>f.store.get(f.code,guest),'ROOM_NOT_FOUND');assert.equal(f.store.list(guest).length,0);
 f.store.join(f.code,guest,f.inviteToken);assert.ok(f.store.get(f.code,guest).members.some(m=>m.id===guest.id));
});
test('host cannot leave and membership cannot be abandoned after start',()=>{
 const f=fixture();fails(()=>f.action(host,'leave'),'HOST_CANNOT_LEAVE');f.action(host,'start');
 fails(()=>f.action(guest,'leave'),'ALREADY_STARTED');assert.equal(f.get().teams[1].ownerId,guest.id);
});
test('host removal blocks reads, heartbeat, actions, list and reentry and frees lobby team',()=>{
 const f=fixture();const room=f.action(host,'remove-member',{memberId:guest.id});
 assert.equal(room.teams[1].ownerId,null);assert.ok(room.blockedUserIds.includes(guest.id));
 assert.equal(room.members.find(m=>m.id===guest.id).connected,false);assert.equal(room.history.at(-1).type,'member_removed');
 fails(()=>f.store.get(f.code,guest),'ROOM_BLOCKED');fails(()=>f.store.get(f.code,guest,true),'ROOM_BLOCKED');
 fails(()=>f.action(guest,'claim',{teamId:'t2'}),'ROOM_BLOCKED');fails(()=>f.store.join(f.code,guest,f.inviteToken),'ROOM_BLOCKED');
 assert.equal(f.store.list(guest).length,0);f.store.join(f.code,third,f.inviteToken);f.action(third,'claim',{teamId:'t2'});
 assert.equal(f.get().teams[1].ownerId,third.id);
});
test('participant removal requires host authority and cannot target host',()=>{
 const f=fixture();fails(()=>f.action(guest,'remove-member',{memberId:host.id}),'HOST_ONLY');
 fails(()=>f.action(host,'remove-member',{memberId:host.id}),'CANNOT_REMOVE_HOST');
 fails(()=>f.action(host,'remove-member',{memberId:'missing'}),'MEMBER_NOT_FOUND');
});
test('removal during bidding preserves accepted bid, ownership, budget and eventual sale',()=>{
 const f=fixture();f.action(host,'start');f.action(guest,'bid',{playerId:'p1',amount:100});
 const before=f.get();const removed=f.action(host,'remove-member',{memberId:guest.id});
 assert.deepEqual(removed.teams,before.teams);assert.equal(removed.currentBid,100);assert.equal(removed.leadingTeamId,'t2');
 f.action(host,'end');const result=f.get();assert.equal(result.players[0].soldTo,'t2');assert.equal(result.teams[1].ownerId,guest.id);
 assert.equal(result.teams[1].budget,7900);assert.deepEqual(result.teams[1].squad,[{playerId:'p1',price:100}]);
 assert.equal(result.members.find(m=>m.id===guest.id).name,'Guest');
});
test('removal is idempotent for repeated action id',()=>{
 const f=fixture();const action=intent('remove-member',{memberId:guest.id});f.store.action(f.code,host,action);f.store.action(f.code,host,action);
 assert.equal(f.get().history.filter(e=>e.type==='member_removed').length,1);
 fails(()=>f.action(host,'remove-member',{memberId:guest.id}),'MEMBER_ALREADY_REMOVED');
});
test('removed members do not consume active room capacity',()=>{
 const f=fixture();for(let i=0;i<18;i++)f.store.join(f.code,{id:`fan-${i}`,name:`Fan ${i}`},f.inviteToken);
 fails(()=>f.store.join(f.code,third,f.inviteToken),'ROOM_NOT_FOUND');f.action(host,'remove-member',{memberId:guest.id});
 f.store.join(f.code,third,f.inviteToken);assert.equal(f.get().members.filter(m=>!f.get().blockedUserIds.includes(m.id)).length,20);
});
test('renew invitation requires host and revokes old links without expelling existing members',()=>{
 const f=fixture();fails(()=>f.store.rotateInvite(f.code,guest),'HOST_ONLY');const renewed=f.store.rotateInvite(f.code,host);
 assert.notEqual(renewed.inviteToken,f.inviteToken);assert.equal(renewed.room.history.at(-1).type,'invite_renewed');
 fails(()=>f.store.join(f.code,third,f.inviteToken),'ROOM_NOT_FOUND');f.store.join(f.code,third,renewed.inviteToken);
 assert.equal(f.store.get(f.code,guest).code,f.code);assert.ok(!JSON.stringify(renewed.room).includes(renewed.inviteToken));
});
test('expired invite at exact expiry is refused and host can replace it',()=>{
 const f=fixture();f.advance(86400000);fails(()=>f.store.join(f.code,third,f.inviteToken),'ROOM_NOT_FOUND');
 const renewed=f.store.rotateInvite(f.code,host);f.store.join(f.code,third,renewed.inviteToken);assert.equal(f.get().members.length,3);
});
test('renewal cannot bypass a room block or reopen an ended room',()=>{
 const f=fixture();f.action(host,'remove-member',{memberId:guest.id});const renewed=f.store.rotateInvite(f.code,host);
 fails(()=>f.store.join(f.code,guest,renewed.inviteToken),'ROOM_BLOCKED');f.action(host,'end');
 fails(()=>f.store.rotateInvite(f.code,host),'ROOM_ENDED');
 fails(()=>f.action(host,'remove-member',{memberId:guest.id}),'ROOM_ENDED');
});
test('restart persists new settings, blocks and invitation hash without leaking raw token',()=>{
 const directory=mkdtempSync(join(tmpdir(),'auctionarena-management-'));
 try {
  const path=join(directory,'state.json');const f=fixture(path);
  f.action(host,'update-settings',{settings:{...defaults,budget:6000}});f.action(host,'remove-member',{memberId:guest.id});
  const renewed=f.store.rotateInvite(f.code,host);const saved=readFileSync(path,'utf8');assert.ok(!saved.includes(renewed.inviteToken));
  const recovered=new LocalRoomStore(path,f.now);assert.equal(recovered.get(f.code,host).teams[0].budget,6000);
  fails(()=>recovered.get(f.code,guest),'ROOM_BLOCKED');fails(()=>recovered.join(f.code,third,f.inviteToken),'ROOM_NOT_FOUND');
  recovered.join(f.code,third,renewed.inviteToken);assert.equal(recovered.get(f.code,third).code,f.code);
 } finally {rmSync(directory,{recursive:true,force:true});}
});
