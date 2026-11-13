import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalRoomStore } from '../../apps/realtime/src/store';
import { settingsSchema, type Action } from '../../packages/shared/src/index';
import { HISTORY_LIMIT, LEGACY_RECEIPT_LIMIT, RECEIPT_LIMIT, SNAPSHOT_EVENTS, roomSnapshot } from '../../packages/shared/src/room-sync';
import { attachRoomSocket } from '../../apps/api/src/room-socket';
import { createApp } from '../../apps/api/src/app';

const host={id:'host',name:'Host'};
function fixture(){let now=1000;const store=new LocalRoomStore(null,()=>now);const {room}=store.create(host,settingsSchema.parse({}));store.action(room.code,host,{id:"claim",type:"claim",teamId:"t1",expectedVersion:0});return {store,code:room.code,advance:(ms:number)=>{now+=ms;}};}
describe('bounded local persistence and delivery',()=>{
 it('batches frequent heartbeats but uses their latest time for host presence',()=>{
  const f=fixture(),commit=vi.spyOn(f.store as any,'commit');
  for(let i=0;i<100;i++){f.advance(5);f.store.get(f.code,host,true);}
  expect(commit.mock.calls.length).toBeLessThanOrEqual(1);
  f.advance(1000);f.store.sweep();expect(commit.mock.calls.length).toBeLessThanOrEqual(2);
  expect(f.store.get(f.code,host).members[0]!.connected).toBe(true);
 },90000);
 it('bounds a large history and versioned receipts without replaying an evicted action',()=>{
  const f=fixture();const old={id:'old',type:'ready',expectedVersion:1} as Action;f.store.action(f.code,host,old);
  for(let i=0;i<Math.max(HISTORY_LIMIT,RECEIPT_LIMIT)+5;i++){const version=f.store.get(f.code,host).version;f.store.action(f.code,host,{id:`r${i}`,type:'ready',expectedVersion:version} as Action);}
  const before=f.store.get(f.code,host);expect(before.history).toHaveLength(HISTORY_LIMIT);
  expect(Object.keys((f.store as any).db.rooms[f.code].receipts).length).toBe(RECEIPT_LIMIT);
  expect(()=>f.store.action(f.code,host,old)).toThrow(/changed/);expect(f.store.get(f.code,host)).toEqual(before);
  expect(roomSnapshot(before).history).toHaveLength(SNAPSHOT_EVENTS);
 },90000);
 it('retains legacy deduplication while bounding new versioned receipts',()=>{
  const f=fixture(),old={id:'legacy',type:'ready'} as Action;f.store.action(f.code,host,old);
  const entry=(f.store as any).db.rooms[f.code];for(let i=0;i<RECEIPT_LIMIT+2;i++)entry.receipts[`synthetic-${i}`]={fingerprint:'retained',expectedVersion:0};
  f.store.action(f.code,host,{id:'current',type:'ready',expectedVersion:f.store.get(f.code,host).version});
  const version=f.store.get(f.code,host).version;f.store.action(f.code,host,old);expect(f.store.get(f.code,host).version).toBe(version);
 });
 it('pages history without overlap and resets replay outside retention',()=>{
  const f=fixture(),room=(f.store as any).db.rooms[f.code].room;
  room.history=Array.from({length:HISTORY_LIMIT+10},(_,i)=>({id:`event-${i+1}`,version:i+1,at:1000,type:'ready',text:'Ready'}));room.version=room.history.length;
  f.store.action(f.code,host,{id:'latest',type:'ready',expectedVersion:room.version});
  const first=f.store.history(f.code,host,undefined,30),second=f.store.history(f.code,host,first.nextBefore!,30);
  expect(first.events).toHaveLength(30);expect(second.events).toHaveLength(30);
  expect(new Set([...first.events,...second.events].map(e=>e.id)).size).toBe(60);
  expect(first.truncated).toBe(true);expect(f.store.sync(f.code,host,0).replay.resetRequired).toBe(true);
  const version=f.store.get(f.code,host).version;expect(f.store.sync(f.code,host,version-2).replay.events).toHaveLength(2);
 });
 it('rechecks access for history and replay and caps page sizes',()=>{
  const f=fixture();expect(()=>f.store.history(f.code,{id:'stranger',name:'Other'})).toThrow(/unavailable/);
  expect(()=>f.store.sync(f.code,{id:'stranger',name:'Other'},0)).toThrow(/unavailable/);
  expect(()=>f.store.history(f.code,host,undefined,101)).toThrow(/page/);
 });
 it('sends bounded snapshots on a real store event and never private block lists',()=>{
  const f=fixture();for(let i=0;i<SNAPSHOT_EVENTS+10;i++)f.store.action(f.code,host,{id:`v${i}`,type:'ready'});
  const socket=Object.assign(new EventEmitter(),{readyState:1,bufferedAmount:0,send:vi.fn(),close:vi.fn()});attachRoomSocket(f.store,f.code,host,socket);
  const payload=JSON.parse(socket.send.mock.calls.at(-1)![0]);expect(payload.room.history).toHaveLength(SNAPSHOT_EVENTS);
  expect(payload.room.blockedUserIds).toBeUndefined();expect(Buffer.byteLength(JSON.stringify(payload))).toBeLessThan(128*1024);socket.emit('close');
 });
 it('returns identical privacy errors for inaccessible history and sync routes',async()=>{
  const f=fixture(),session=f.store.session('Other'),{app}=createApp(f.store,{localDevAuth:true});
  for(const suffix of ['/history','/sync?afterVersion=0']){
   const request=(code:string)=>app.request(`/api/rooms/${code}${suffix}`,{headers:{Authorization:`Bearer ${session.token}`}});
   const a=await request(f.code),b=await request('MISSING');const x=await a.json(),y=await b.json();
   expect(a.status).toBe(404);expect(a.status).toBe(b.status);expect(x.code).toBe(y.code);expect(x.message).toBe(y.message);
  }
 });
 it('preserves version and duplicate protection after receipt eviction and file recovery',()=>{
  const directory=mkdtempSync(join(tmpdir(),'auctionarena-bounds-'));
  try {
   const path=join(directory,'state.json'),store=new LocalRoomStore(path,()=>1000);
   const {room}=store.create(host,settingsSchema.parse({}));const old={id:'claim',type:'claim',teamId:'t1',expectedVersion:0} as Action;
   store.action(room.code,host,old);
   const entry=(store as any).db.rooms[room.code];for(let i=0;i<RECEIPT_LIMIT;i++)entry.receipts[`fixture-${i}`]={fingerprint:'fixture',expectedVersion:0};
   store.action(room.code,host,{id:'ready',type:'ready',expectedVersion:1});
   const recovered=new LocalRoomStore(path,()=>1000),before=recovered.get(room.code,host);
   expect(()=>recovered.action(room.code,host,old)).toThrow(/changed/);
   expect(recovered.get(room.code,host)).toEqual(before);expect(before.teams[0]!.ownerId).toBe(host.id);
  }finally{rmSync(directory,{recursive:true,force:true});}
 });
 it('refuses further legacy receipts at the cap while allowing a versioned client',()=>{
  const f=fixture(),entry=(f.store as any).db.rooms[f.code];
  for(let i=0;i<LEGACY_RECEIPT_LIMIT;i++)entry.receipts[`fixture-${i}`]={fingerprint:'fixture'};
  expect(()=>f.store.action(f.code,host,{id:'legacy-new',type:'ready'})).toThrow(/Refresh/);
  expect(()=>f.store.action(f.code,host,{id:'versioned',type:'ready',expectedVersion:entry.room.version})).not.toThrow();
 });
 it('preserves blocked team-owner attribution and refuses an oversized state',()=>{
  const f=fixture(),room=f.store.get(f.code,host);room.blockedUserIds=[host.id,'old-block'];
  expect(roomSnapshot(room).members[0]!.name).toBe(host.name);expect(roomSnapshot(room).blockedUserIds).toEqual([host.id]);
  room.name='x'.repeat(128*1024);expect(()=>roomSnapshot(room)).toThrow(/size budget/);
 });
});
