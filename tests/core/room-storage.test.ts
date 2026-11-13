import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalRoomStore, digest } from '../../apps/realtime/src/store';
import { settingsSchema, type Action, nextBid } from '../../packages/shared/src/index';
import { applyStoredAction, advanceRoom, boundStoredRoom, type StoredRoom } from '../../packages/room-runtime/src/record';
import { MemoryRoomStorage } from '../../packages/storage/src/memory-room';
import { SqliteRoomStorage } from '../../packages/storage/src/sqlite-room';
import { NodeSqliteDriver } from '../../packages/storage/src/node-sqlite';
import type { RoomStorage, SqlDriver } from '../../packages/storage/src/port';

const cleanups: (()=>void)[]=[];
afterEach(()=>{for(const cleanup of cleanups.splice(0).reverse())cleanup();});
function directory(){const path=mkdtempSync(join(tmpdir(),'aa-storage-'));cleanups.push(()=>rmSync(path,{recursive:true,force:true}));return path;}
function sqlite(path=':memory:'){const driver=new NodeSqliteDriver(path);cleanups.push(()=>driver.close());return {driver,storage:new SqliteRoomStorage(driver)};}
function seed(){const path=join(directory(),'reference.json');let now=1000;const reference=new LocalRoomStore(path,()=>now);
 const host={id:'host',name:'Host'},guest={id:'guest',name:'Guest'};
 const created=reference.create(host,settingsSchema.parse({teamCount:2,minSquad:1,maxSquad:2,timerSeconds:10,autoAdvance:false,lateExtension:false}));
 reference.join(created.room.code,guest,created.inviteToken);
 return {reference,host,guest,code:created.room.code,entry:JSON.parse(readFileSync(path,'utf8')).rooms[created.room.code] as StoredRoom,advance:(ms:number)=>{now+=ms;},clock:()=>now};
}
function save(storage:RoomStorage,entry:StoredRoom){storage.transaction(()=>({next:entry,result:undefined}));}
describe('room storage port and SQLite parity',()=>{
 for(const kind of ['memory','sqlite'] as const){
  it(`${kind}: agrees with the file store for bids, duplicate actions and settlement`,()=>{
   const f=seed(),storage=kind==='memory'?new MemoryRoomStorage():sqlite().storage;save(storage,f.entry);
   function action(user:typeof f.host,input:Action){
    const current=storage.read()!;const full={expectedVersion:current.room.version,...input};
    const expected=f.reference.action(f.code,user,full);
    const actual=storage.transaction(entry=>{const next=applyStoredAction(entry!,user,full,f.clock(),digest(JSON.stringify(full)));return {next,result:next.room};});
    expect(actual).toEqual(expected);return full;
   }
   action(f.host,{id:'claim1',type:'claim',teamId:'t1'});action(f.guest,{id:'claim2',type:'claim',teamId:'t2'});
   action(f.host,{id:'start',type:'start'});
   const room=storage.read()!.room;const bid=action(f.guest,{id:'bid',type:'bid',amount:nextBid(room),playerId:room.players[0]!.id});
   action(f.guest,bid); // retained receipt wins over the stale expectedVersion
   f.advance(10000);f.reference.sweep();
   for(let i=0;i<2;i++)storage.transaction(entry=>{advanceRoom(entry!.room,f.clock());boundStoredRoom(entry!);return {next:entry,result:undefined};});
   const settled=storage.read()!.room;expect(settled).toEqual(f.reference.get(f.code,f.host));
   expect(settled.teams[1]!.squad).toHaveLength(1);expect(settled.history.filter(e=>e.type==='sold')).toHaveLength(1);
  });
  it(`${kind}: isolates reads, rolls back throws and rejects asynchronous callbacks`,()=>{
   const storage=kind==='memory'?new MemoryRoomStorage():sqlite().storage,f=seed();save(storage,f.entry);
   storage.read()!.room.name='uncommitted';expect(storage.read()!.room.name).toBe(f.entry.room.name);
   expect(()=>storage.transaction(entry=>{entry!.room.name='failed';throw new Error('abort');})).toThrow('abort');
   expect(()=>storage.transaction((async()=>({next:null,result:0})) as any)).toThrow(/synchronous/);
   expect(storage.read()).toEqual(f.entry);
  });
 }
 it('recovers SQLite state, event order and receipts across a database reopen',()=>{
  const path=join(directory(),'room.sqlite'),f=seed(),first=sqlite(path);save(first.storage,f.entry);
  const action:Action={id:'claim',type:'claim',teamId:'t1',expectedVersion:f.entry.room.version};
  first.storage.transaction(entry=>({next:applyStoredAction(entry!,f.host,action,f.clock(),digest(JSON.stringify(action))),result:undefined}));
  const expected=first.storage.read();first.driver.close();const reopened=sqlite(path).storage;
  expect(reopened.read()).toEqual(expected);
  reopened.transaction(entry=>({next:applyStoredAction(entry!,f.host,action,f.clock(),digest(JSON.stringify(action))),result:undefined}));
  expect(reopened.read()).toEqual(expected);
 });
 it('rolls back state, events and receipts when a SQL write fails midway',()=>{
  const f=seed(),{driver,storage}=sqlite();save(storage,f.entry);let writes=0,fail=false;
  const faulty:SqlDriver={all:(sql,...args)=>driver.all(sql,...args),transaction:fn=>driver.transaction(fn),run:(sql,...args)=>{if(fail&&++writes===3)throw new Error('disk fault');driver.run(sql,...args);}};
  const wrapper=new SqliteRoomStorage(faulty);fail=true;
  expect(()=>wrapper.transaction(entry=>({next:applyStoredAction(entry!,f.host,{id:'claim',type:'claim',teamId:'t1'},f.clock(),'fingerprint'),result:undefined}))).toThrow('disk fault');
  expect(storage.read()).toEqual(f.entry);
 });
 it('rejects unknown schema versions without rewriting existing data',()=>{
  const {driver,storage}=sqlite(),f=seed();save(storage,f.entry);driver.run('UPDATE room_schema SET version = 999');
  expect(()=>new SqliteRoomStorage(driver)).toThrow(/schema version/);
  expect(storage.read()).toEqual(f.entry);expect(driver.all('SELECT version FROM room_schema')[0]!.version).toBe(999);
 });
 it('retains legacy receipts and redacts stored history updates transactionally',()=>{
  const {storage}=sqlite(),f=seed();f.entry.receipts['host:legacy']={fingerprint:'legacy'};save(storage,f.entry);
  storage.transaction(entry=>{entry!.room.history[0]!.text='Participant details removed.';return {next:entry,result:undefined};});
  expect(storage.read()!.room.history[0]!.text).toBe('Participant details removed.');expect(storage.read()!.receipts['host:legacy']).toEqual({fingerprint:'legacy'});
 });
});
