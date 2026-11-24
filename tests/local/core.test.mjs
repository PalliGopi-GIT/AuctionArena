import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { LocalRoomStore } from '../../apps/realtime/src/store.ts';
import { applyAction, settle } from '../../packages/engine/src/index.ts';

const settings = {name:'Test arena',teamCount:4,budget:8000,minSquad:2,maxSquad:8,maxOverseas:4,timerSeconds:30,lateExtension:true,bidIncrement:10,autoAdvance:false,resultSeconds:5,spectators:true};
const host={id:'host',name:'Host'},guest={id:'guest',name:'Guest'};
let sequence=0;
const intent=(type,extra={})=>({id:`test-${++sequence}`,type,...extra});
function fixture(overrides={},path=null) {
 let now=100000;const store=new LocalRoomStore(path,()=>now);
 const created=store.create(host,{...settings,...overrides});const code=created.room.code;
 store.join(code,guest,created.inviteToken);
 store.action(code,host,intent('claim',{teamId:'t1'}));store.action(code,guest,intent('claim',{teamId:'t2'}));
 return {store,code,invite:created.inviteToken,get:()=>store.get(code,host),now:()=>now,advance:ms=>{now+=ms;},action:(user,type,extra)=>store.action(code,user,intent(type,extra)),start:()=>store.action(code,host,intent('start'))};
}
const bid=(f,user=guest,amount=100)=>f.action(user,'bid',{playerId:'p1',amount});
const fails=(fn,code)=>assert.throws(fn,e=>e.code===code);
function disk(fn){const dir=mkdtempSync(join(tmpdir(),'auctionarena-local-'));try{return fn(join(dir,'room.json'));}finally{rmSync(dir,{recursive:true,force:true});}}
function corrupt(path,mutate){const data=JSON.parse(readFileSync(path,'utf8'));mutate(Object.values(data.rooms)[0].room);writeFileSync(path,JSON.stringify(data));}

test('invited friends share state; code alone can join, an invalid token cannot, and outsider reads are rejected',()=>{const f=fixture();assert.deepEqual(f.get(),f.store.get(f.code,guest));assert.ok(f.store.join(f.code,{id:'x',name:'X'}).members.some(m=>m.id==='x'));fails(()=>f.store.join(f.code,{id:'y',name:'Y'},'wrong-token'),'ROOM_NOT_FOUND');fails(()=>f.store.get(f.code,{id:'z',name:'Z'}),'ROOM_NOT_FOUND');assert.ok(!JSON.stringify(f.get()).includes(f.invite));});
test('two competing claims accept exactly one owner',async()=>{const f=fixture();const results=await Promise.allSettled([host,guest].map(user=>Promise.resolve().then(()=>f.action(user,'claim',{teamId:'t3'}))));assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.get().teams.filter(t=>t.id==='t3'&&t.ownerId).length,1);});
test('same-price competing bids accept one position',async()=>{const f=fixture();f.start();const results=await Promise.allSettled([host,guest].map(user=>Promise.resolve().then(()=>bid(f,user))));assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.get().history.filter(e=>e.type==='bid').length,1);});
test('deadline rejects a bid even before the timer sweep',()=>{const f=fixture();const room=f.start();fails(()=>applyAction(room,guest.id,intent('bid',{playerId:'p1',amount:100}),room.deadline),'TOO_LATE');});
test('minimum squad reserve prevents overspending',()=>{const f=fixture({budget:200});const room=f.start();room.currentBid=190;room.leadingTeamId='t1';fails(()=>applyAction(room,guest.id,intent('bid',{playerId:'p1',amount:200}),f.now()),'INSUFFICIENT_BUDGET');});
test('spectators cannot bid and guests cannot pause',()=>{const f=fixture();const watcher={id:'watch',name:'Watcher'};f.store.join(f.code,watcher,f.invite);f.start();fails(()=>bid(f,watcher),'NO_TEAM');fails(()=>f.action(guest,'pause'),'HOST_ONLY');});
test('leading team cannot outbid itself or use a stale player',()=>{const f=fixture();f.start();bid(f);fails(()=>bid(f,guest,110),'ALREADY_LEADING');fails(()=>f.action(host,'bid',{playerId:'p2',amount:110}),'STALE_PLAYER');});
test('squad and overseas limits reject ineligible bids',()=>{const f=fixture({maxOverseas:0});const room=f.start();room.players[0].overseas=true;fails(()=>applyAction(room,guest.id,intent('bid',{playerId:'p1',amount:100}),f.now()),'OVERSEAS_LIMIT');room.players[0].overseas=false;room.teams[1].squad=Array.from({length:8},(_,i)=>({playerId:`old-${i}`,price:1}));fails(()=>applyAction(room,guest.id,intent('bid',{playerId:'p1',amount:100}),f.now()),'SQUAD_FULL');});
test('late bid updates one shared deadline',()=>{const f=fixture();const room=f.start();const accepted=applyAction(room,guest.id,intent('bid',{playerId:'p1',amount:100}),room.deadline-1000);assert.equal(accepted.deadline,room.deadline+9000);assert.equal(accepted.extensions,1);});
test('settlement updates squad, sale and budget exactly once',()=>{const f=fixture();f.start();const room=bid(f);settle(room,room.deadline);const saved=structuredClone(room);settle(room,f.now()+90000);assert.deepEqual(room,saved);assert.equal(room.teams[1].budget,7900);assert.deepEqual(room.teams[1].squad,[{playerId:'p1',price:100}]);assert.equal(room.players[0].soldTo,'t2');});
test('no bids produce an unsold result without a charge',()=>{const f=fixture();const room=f.start();settle(room,room.deadline);assert.equal(room.players[0].status,'unsold');assert.ok(room.teams.every(t=>t.budget===8000));});
test('duplicate action is harmless and changed ID content is rejected',()=>{const f=fixture();f.start();const action=intent('bid',{playerId:'p1',amount:100});f.store.action(f.code,guest,action);f.store.action(f.code,guest,action);assert.equal(f.get().history.filter(e=>e.type==='bid').length,1);fails(()=>f.store.action(f.code,guest,{...action,amount:110}),'ID_REUSED');});
test('delayed sweep pauses at host grace expiry before a later deadline',()=>{const f=fixture();f.start();bid(f);f.advance(31000);f.store.sweep();assert.equal(f.get().status,'PAUSED');assert.equal(f.get().pausedRemaining,20000);assert.equal(f.get().players[0].status,'open');assert.equal(f.get().teams[1].budget,8000);});
test('reconnecting host cannot erase elapsed disconnection before sweep',()=>{const f=fixture();f.start();f.advance(31000);f.store.get(f.code,host,true);assert.equal(f.get().status,'PAUSED');assert.equal(f.get().members[0].connected,true);const resumed=f.action(host,'resume');assert.equal(resumed.deadline,f.now()+20000);});
test('participant bid cannot bypass overdue host pause',()=>{const f=fixture();f.start();f.advance(11000);fails(()=>bid(f),'NOT_LIVE');assert.equal(f.get().status,'PAUSED');});
test('offline host cannot resume and inflate paused time',()=>{const f=fixture();f.start();f.advance(11000);f.store.sweep();f.advance(60000);fails(()=>f.action(host,'resume'),'HOST_OFFLINE');assert.equal(f.get().pausedRemaining,20000);f.store.get(f.code,host,true);f.action(host,'resume');f.store.sweep();assert.equal(f.get().deadline,f.now()+20000);});
test('offline host cannot manually advance to a new lot',()=>{const f=fixture({timerSeconds:10});f.start();f.advance(11000);f.store.sweep();fails(()=>f.action(host,'next'),'HOST_OFFLINE');assert.equal(f.get().currentPlayerIndex,0);f.store.get(f.code,host,true);const next=f.action(host,'next');assert.equal(next.currentPlayerIndex,1);assert.equal(next.deadline,f.now()+10000);});
test('a deadline at host grace expiry still settles the earlier lot',()=>{const f=fixture({timerSeconds:10});f.start();bid(f);f.advance(11000);f.store.sweep();assert.equal(f.get().status,'RESULT');assert.equal(f.get().players[0].status,'sold');});
test('auto-advance with absent host pauses new lot with full time',()=>{const f=fixture({timerSeconds:10,autoAdvance:true,resultSeconds:20});f.start();f.advance(10000);f.store.sweep();f.advance(21000);f.store.sweep();assert.equal(f.get().status,'PAUSED');assert.equal(f.get().currentPlayerIndex,1);assert.equal(f.get().pausedRemaining,10000);});
test('refresh and reconnect preserve ownership and accepted bid',()=>{const f=fixture();f.start();const accepted=bid(f);assert.equal(f.store.get(f.code,guest).deadline,accepted.deadline);f.advance(11000);f.store.sweep();const room=f.store.get(f.code,guest,true);assert.equal(room.teams[1].ownerId,guest.id);assert.equal(room.currentBid,100);assert.equal(room.members[1].connected,true);});
test('restart recovers bid, host-end settles once, completed results reopen',()=>disk(path=>{const f=fixture({},path);f.start();bid(f);let store=new LocalRoomStore(path,f.now);assert.equal(store.get(f.code,host).status,'PAUSED');store.action(f.code,host,intent('end'));store=new LocalRoomStore(path,f.now);const room=store.get(f.code,guest);assert.equal(room.status,'COMPLETED');assert.equal(room.teams[1].budget,7900);assert.equal(room.teams[1].squad.length,1);}));
test('recovery rejects a sold player missing from its squad',()=>disk(path=>{fixture({},path);corrupt(path,r=>Object.assign(r.players[0],{status:'sold',soldTo:'t1',soldPrice:100}));assert.throws(()=>new LocalRoomStore(path),/Sale invariant/);}));
test('recovery rejects an unaffordable saved leading bid before settlement',()=>disk(path=>{const f=fixture({},path);f.start();corrupt(path,r=>{r.currentBid=8010;r.leadingTeamId='t1';});assert.throws(()=>new LocalRoomStore(path,()=>999999),/Bid invariant/);}));
test('recovery rejects a mismatched open-player index',()=>disk(path=>{const f=fixture({},path);f.start();corrupt(path,r=>{r.currentPlayerIndex=1;});assert.throws(()=>new LocalRoomStore(path),/Current player invariant/);}));
test('recovery rejects a budget which does not reconcile',()=>disk(path=>{fixture({},path);corrupt(path,r=>{r.teams[0].budget=-1;});assert.throws(()=>new LocalRoomStore(path),/Budget invariant/);}));
test('10 rooms / 200 simulated members isolate 2,000 competing intents',async()=>{
 const store=new LocalRoomStore(null,()=>100000);
 const rooms=Array.from({length:10},(_,r)=>{const users=Array.from({length:20},(_,i)=>({id:`${r}-${i}`,name:`Fan ${i}`}));const created=store.create(users[0],{...settings,teamCount:8});for(const user of users.slice(1))store.join(created.room.code,user,created.inviteToken);for(let i=0;i<8;i++)store.action(created.room.code,users[i],intent('claim',{teamId:`t${i+1}`}));store.action(created.room.code,users[0],intent('start'));return {code:created.room.code,users};});
 const results=await Promise.allSettled(rooms.flatMap(r=>Array.from({length:200},(_,i)=>Promise.resolve().then(()=>store.action(r.code,r.users[i%20],intent('bid',{playerId:'p1',amount:100}))))));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,10);
 for(const r of rooms){const state=store.get(r.code,r.users[0]);assert.equal(state.members.length,20);assert.equal(state.history.filter(e=>e.type==='bid').length,1);assert.equal(state.currentBid,100);}
});
