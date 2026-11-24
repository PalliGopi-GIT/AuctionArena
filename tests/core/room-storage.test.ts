import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalRoomStore, digest } from '../../apps/realtime/src/store';
import { settingsSchema, type Action, nextBid } from '../../packages/shared/src/index';
import type { AuctionEvent, User } from '../../packages/shared/src/domain';
import { applyStoredAction, advanceRoom, boundStoredRoom, type StoredRoom } from '../../packages/room-runtime/src/record';
import { recoverRoomOnWake, validateRoomRecovery } from '../../packages/room-runtime/src/recovery';
import { MemoryRoomStorage } from '../../packages/storage/src/memory-room';
import { SqliteRoomStorage, ROOM_SCHEMA_VERSION } from '../../packages/storage/src/sqlite-room';
import { NodeSqliteDriver } from '../../packages/storage/src/node-sqlite';
import type { RoomStorage, SqlDriver } from '../../packages/storage/src/port';
import { HISTORY_LIMIT, LEGACY_RECEIPT_LIMIT, RECEIPT_LIMIT } from '../../packages/shared/src/room-sync';

const cleanups: (()=>void)[]=[];
afterEach(()=>{for(const cleanup of cleanups.splice(0).reverse())cleanup();});
function directory(){const path=mkdtempSync(join(tmpdir(),'aa-storage-'));cleanups.push(()=>rmSync(path,{recursive:true,force:true}));return path;}
function sqlite(path=':memory:'){const driver=new NodeSqliteDriver(path);cleanups.push(()=>driver.close());return {driver,storage:new SqliteRoomStorage(driver)};}

interface Fixture {
  reference: LocalRoomStore; host: User; guest: User; code: string; path: string;
  entry: StoredRoom; advance(ms:number):void; clock():number;
}
function seed(): Fixture {
  const path=join(directory(),'reference.json');let now=1000;const reference=new LocalRoomStore(path,()=>now);
  const host={id:'host',name:'Host'},guest={id:'guest',name:'Guest'};
  const created=reference.create(host,settingsSchema.parse({teamCount:2,minSquad:1,maxSquad:2,timerSeconds:10,autoAdvance:false,lateExtension:false}));
  reference.join(created.room.code,guest,created.inviteToken);
  const entry=JSON.parse(readFileSync(path,'utf8')).rooms[created.room.code] as StoredRoom;
  return {reference,host,guest,code:created.room.code,path,entry,advance:(ms:number)=>{now+=ms;},clock:()=>now};
}
type Kind='memory'|'sqlite-memory'|'sqlite-file';
interface Harness { storage: RoomStorage; reopen(): RoomStorage; driver?: SqlDriver }
function save(storage:RoomStorage,entry:StoredRoom){storage.transaction(()=>({next:structuredClone(entry),result:undefined}));}
function harness(kind:Kind,f:Fixture):Harness {
  if(kind==='memory'){const storage=new MemoryRoomStorage();save(storage,f.entry);return {storage,reopen:()=>storage};}
  const path=kind==='sqlite-file'?join(directory(),'room.sqlite'):':memory:';
  const first=sqlite(path);save(first.storage,f.entry);
  return {storage:first.storage,driver:first.driver,reopen:()=>{first.driver.close();return sqlite(path).storage;}};
}
function apply(storage:RoomStorage,f:Fixture,user:User,action:Action){return storage.transaction(entry=>{const next=applyStoredAction(entry!,user,action,f.clock(),digest(JSON.stringify(action)));return {next,result:next.room};});}
/** Drives the same action through the legacy file store and the adapter under test. */
function act(h:Harness,f:Fixture,user:User,input:Action){
  const action={...input,...(input.expectedVersion===undefined?{expectedVersion:h.storage.read()!.room.version}:{})} as Action;
  const expected=f.reference.action(f.code,user,action);
  expect(apply(h.storage,f,user,action)).toEqual(expected);
  expect(h.storage.read()!.room).toEqual(f.reference.get(f.code,f.host));
  return action;
}
function sweep(h:Harness,f:Fixture){
  h.storage.transaction(entry=>{if(entry){advanceRoom(entry.room,f.clock());boundStoredRoom(entry);}return {next:entry,result:undefined};});
  f.reference.sweep();
  expect(h.storage.read()!.room).toEqual(f.reference.get(f.code,f.host));
}
const kinds:Kind[]=['memory','sqlite-memory','sqlite-file'];

describe('room storage port and legacy parity',()=>{
 for(const kind of kinds){
  it(`${kind}: matches the legacy file store through a full auction`,()=>{
   const f=seed(),h=harness(kind,f);
   act(h,f,f.host,{id:'claim1',type:'claim',teamId:'t1'});
   act(h,f,f.guest,{id:'claim2',type:'claim',teamId:'t2'});
   act(h,f,f.guest,{id:'ready1',type:'ready'});
   act(h,f,f.host,{id:'start',type:'start'});
   const room=h.storage.read()!.room;
   const bid=act(h,f,f.guest,{id:'bid1',type:'bid',amount:nextBid(room),playerId:room.players[0]!.id});
   act(h,f,f.guest,bid); // retained receipt wins over the now-stale expected version
   act(h,f,f.host,{id:'pause1',type:'pause'});
   act(h,f,f.host,{id:'resume1',type:'resume'});
   f.advance(10000);sweep(h,f);
   act(h,f,f.host,{id:'next1',type:'next'});
   act(h,f,f.host,{id:'end1',type:'end'});
   const settled=h.storage.read()!;
   expect(settled.room.status).toBe('COMPLETED');
   expect(settled.room.teams[1]!.squad).toHaveLength(1);
   expect(settled.room.history.filter(item=>item.type==='sold')).toHaveLength(1);
   expect(settled.receipts).toEqual((f.reference as any).db.rooms[f.code].receipts);
  });
  it(`${kind}: isolates reads, rolls back throws and rejects asynchronous callbacks`,()=>{
   const storage=kind==='memory'?new MemoryRoomStorage():sqlite().storage,f=seed();save(storage,f.entry);
   storage.read()!.room.name='uncommitted';expect(storage.read()!.room.name).toBe(f.entry.room.name);
   expect(()=>storage.transaction(entry=>{entry!.room.name='failed';throw new Error('abort');})).toThrow('abort');
   expect(()=>storage.transaction((async()=>({next:null,result:0})) as any)).toThrow(/synchronous/);
   expect(()=>storage.transaction(()=>({next:undefined,result:0} as any))).toThrow(/synchronous/);
   expect(storage.read()).toEqual(f.entry);
  });
  it(`${kind}: rejects stale, future and reused action IDs without mutating`,()=>{
   const f=seed(),h=harness(kind,f),version=h.storage.read()!.room.version,before=h.storage.read();
   for(const expectedVersion of [version-1,version+1]){
    expect(()=>apply(h.storage,f,f.host,{id:`stale-${expectedVersion}`,type:'claim',teamId:'t1',expectedVersion})).toThrow(/changed/);
    expect(h.storage.read()).toEqual(before);
   }
   const accepted=act(h,f,f.host,{id:'claim1',type:'claim',teamId:'t1'});
   const committed=h.storage.read();
   const reused:Action={id:'claim1',type:'claim',teamId:'t2',...(accepted.expectedVersion===undefined?{}:{expectedVersion:accepted.expectedVersion})};
   expect(()=>h.storage.transaction(entry=>({next:applyStoredAction(entry!,f.host,reused,f.clock(),'different-fingerprint'),result:undefined}))).toThrow(/reused/);
   expect(h.storage.read()).toEqual(committed);
  });
  it(`${kind}: evicts old receipts without making their actions re-executable`,()=>{
   const f=seed(),h=harness(kind,f);
   const old=act(h,f,f.host,{id:'old',type:'claim',teamId:'t1'});
   h.storage.transaction(entry=>{for(let i=0;i<RECEIPT_LIMIT-1;i++)entry!.receipts[`synthetic-${i}`]={fingerprint:'retained',expectedVersion:0};return {next:entry,result:undefined};});
   const referenceEntry=(f.reference as any).db.rooms[f.code] as StoredRoom;
   for(let i=0;i<RECEIPT_LIMIT-1;i++)referenceEntry.receipts[`synthetic-${i}`]={fingerprint:'retained',expectedVersion:0};
   expect(Object.keys(h.storage.read()!.receipts)).toHaveLength(RECEIPT_LIMIT);
   act(h,f,f.host,{id:'ready1',type:'ready'});
   const after=h.storage.read()!;
   expect(after.receipts['host:old']).toBeUndefined();
   expect(Object.keys(after.receipts)).toHaveLength(RECEIPT_LIMIT);
   const before=structuredClone(after);
   expect(()=>apply(h.storage,f,f.host,old)).toThrow(/changed/);
   expect(h.storage.read()).toEqual(before);
   expect(()=>f.reference.action(f.code,f.host,old)).toThrow(/changed/);
  });
  it(`${kind}: refuses new legacy receipts at the cap while allowing a versioned client`,()=>{
   const f=seed(),h=harness(kind,f);
   h.storage.transaction(entry=>{for(let i=0;i<LEGACY_RECEIPT_LIMIT;i++)entry!.receipts[`legacy-${i}`]={fingerprint:'legacy'};return {next:entry,result:undefined};});
   const version=h.storage.read()!.room.version;
   expect(()=>apply(h.storage,f,f.host,{id:'new-legacy',type:'ready'})).toThrow(/Refresh/);
   expect(h.storage.read()!.room.version).toBe(version);
   expect(()=>apply(h.storage,f,f.host,{id:'versioned',type:'claim',teamId:'t1',expectedVersion:version})).not.toThrow();
   expect(h.storage.read()!.room.teams[0]!.ownerId).toBe('host');
  });
  it(`${kind}: refuses room identity changes and backwards versions`,()=>{
   const f=seed(),h=harness(kind,f),before=h.storage.read();
   expect(()=>h.storage.transaction(entry=>({next:{...entry!,room:{...entry!.room,code:'OTHER'}},result:undefined}))).toThrow(/identity/);
   expect(()=>h.storage.transaction(entry=>({next:{...entry!,room:{...entry!.room,version:entry!.room.version-1}},result:undefined}))).toThrow(/backwards/);
   expect(h.storage.read()).toEqual(before);
  });
 }
 it('SQLite retains the original identity and detaches a mutable transaction result',()=>{
   const f=seed(), { storage }=sqlite(); save(storage,f.entry);
   expect(()=>storage.transaction(entry=>{entry!.room.code='OTHER';return {next:entry,result:null};})).toThrow(/identity/);
   expect(()=>storage.transaction(entry=>{entry!.room.version--;return {next:entry,result:null};})).toThrow(/backwards/);
   const result=storage.transaction(entry=>{
     entry!.room.history[0]!.text='updated event';
     for(let i=0;i<=RECEIPT_LIMIT;i++)entry!.receipts['v:'+i]={fingerprint:'test',expectedVersion:i};
     return {next:entry,result:entry!};
   });
   expect(Object.hasOwn(result.receipts,'v:0')).toBe(true);
   expect(Object.hasOwn(storage.read()!.receipts,'v:0')).toBe(false);
   result.room.history[0]!.text='later edit';
   expect(storage.read()!.room.history[0]!.text).toBe('updated event');
 });
 it('rolls back state, events and receipts at every SQL write boundary',()=>{
  const f=seed(),{driver,storage}=sqlite();save(storage,f.entry);
  let writes=0,failAt=0;
  const faulty:SqlDriver={all:(query,...args)=>driver.all(query,...args),transaction:callback=>driver.transaction(callback),
   run:(query,...args)=>{if(failAt&&++writes===failAt)throw new Error('disk fault');driver.run(query,...args);}};
  const wrapper=new SqliteRoomStorage(faulty);
  const action:Action={id:'claim',type:'claim',teamId:'t1',expectedVersion:f.entry.room.version};
  const before=storage.read();let failures=0,succeeded=false;
  for(let at=1;at<=12;at++){
   writes=0;failAt=at;
   try{wrapper.transaction(entry=>({next:applyStoredAction(entry!,f.host,action,f.clock(),'fingerprint'),result:undefined}));}
   catch(error){expect((error as Error).message).toBe('disk fault');expect(storage.read()).toEqual(before);failures++;continue;}
   expect(failures).toBe(at-1);succeeded=true;break;
  }
  expect(succeeded).toBe(true);expect(failures).toBeGreaterThan(0);
  expect(wrapper.read()!.room.teams[0]!.ownerId).toBe('host');
  expect(wrapper.read()!.receipts['host:claim']).toBeDefined();
 });
 it('physically deletes a removed history row and rolls the delete back on a write failure',()=>{
  const f=seed(),{driver,storage}=sqlite();save(storage,f.entry);
  const target=f.entry.room.history.find(event=>event.type==='joined')!;
  expect(target).toBeDefined();
  const count=()=>Number(driver.all('SELECT COUNT(*) AS count FROM room_events')[0]!.count);
  const before=count();
  storage.transaction(entry=>{entry!.room.history=entry!.room.history.filter(event=>event.id!==target.id);return {next:entry,result:undefined};});
  expect(count()).toBe(before-1);
  expect(storage.read()!.room.history.some(event=>event.id===target.id)).toBe(false);

  save(storage,f.entry);
  const committed=storage.read();
  const faulty:SqlDriver={all:(query,...args)=>driver.all(query,...args),transaction:callback=>driver.transaction(callback),
   run:(query,...args)=>{if(query.startsWith('DELETE FROM room_events'))throw new Error('disk fault');driver.run(query,...args);}};
  const wrapper=new SqliteRoomStorage(faulty);
  expect(()=>wrapper.transaction(entry=>{entry!.room.history=entry!.room.history.filter(event=>event.id!==target.id);return {next:entry,result:undefined};})).toThrow('disk fault');
  expect(storage.read()).toEqual(committed);
  expect(count()).toBe(before);
 });
 it('keeps a retried action idempotent across a database reopen',()=>{
  const f=seed(),h=harness('sqlite-file',f);
  const action=act(h,f,f.host,{id:'claim',type:'claim',teamId:'t1'});
  const version=h.storage.read()!.room.version;
  act(h,f,f.host,action);
  expect(h.storage.read()!.room.version).toBe(version);
  const reopened=h.reopen(),afterReopen={storage:reopened,reopen:()=>reopened};
  const before=reopened.read();
  act(afterReopen,f,f.host,action);
  expect(reopened.read()).toEqual(before);
 });
 it('recovers a live room on wake exactly like the legacy file store',()=>{
  const f=seed();
  f.reference.action(f.code,f.host,{id:'claim1',type:'claim',teamId:'t1',expectedVersion:f.entry.room.version});
  f.reference.action(f.code,f.guest,{id:'claim2',type:'claim',teamId:'t2',expectedVersion:f.reference.get(f.code,f.guest).version});
  f.reference.action(f.code,f.host,{id:'start',type:'start',expectedVersion:f.reference.get(f.code,f.host).version});
  f.reference.action(f.code,f.guest,{id:'bid1',type:'bid',playerId:'p1',amount:100,expectedVersion:f.reference.get(f.code,f.guest).version});
  const before=JSON.parse(readFileSync(f.path,'utf8')).rooms[f.code] as StoredRoom;
  const expected=new LocalRoomStore(f.path,f.clock).get(f.code,f.host);
  expect(expected.status).toBe('PAUSED');
  const path=join(directory(),'room.sqlite'),first=sqlite(path);save(first.storage,before);first.driver.close();
  const reopened=sqlite(path).storage;
  reopened.transaction(entry=>{validateRoomRecovery(entry!.room);recoverRoomOnWake(entry!.room,f.clock());boundStoredRoom(entry!);return {next:entry,result:undefined};});
  expect(reopened.read()!.room).toEqual(expected);
  expect(reopened.read()!.room.members.every(member=>!member.connected)).toBe(true);
 });
 it('settles an elapsed deadline on wake instead of pausing it',()=>{
  const f=seed();
  f.reference.action(f.code,f.host,{id:'claim1',type:'claim',teamId:'t1',expectedVersion:f.entry.room.version});
  f.reference.action(f.code,f.guest,{id:'claim2',type:'claim',teamId:'t2',expectedVersion:f.reference.get(f.code,f.guest).version});
  f.reference.action(f.code,f.host,{id:'start',type:'start',expectedVersion:f.reference.get(f.code,f.host).version});
  f.reference.action(f.code,f.guest,{id:'bid1',type:'bid',playerId:'p1',amount:100,expectedVersion:f.reference.get(f.code,f.guest).version});
  const before=JSON.parse(readFileSync(f.path,'utf8')).rooms[f.code] as StoredRoom;
  f.advance(10000);
  const expected=new LocalRoomStore(f.path,f.clock).get(f.code,f.host);
  expect(expected.status).toBe('RESULT');expect(expected.players[0]!.status).toBe('sold');
  const path=join(directory(),'room.sqlite'),first=sqlite(path);save(first.storage,before);first.driver.close();
  const reopened=sqlite(path).storage;
  reopened.transaction(entry=>{recoverRoomOnWake(entry!.room,f.clock());boundStoredRoom(entry!);return {next:entry,result:undefined};});
  expect(reopened.read()!.room).toEqual(expected);
 });
 it('bounds retained events in SQLite and keeps the truncation marker across reopen',()=>{
  const f=seed(),h=harness('sqlite-file',f),entry=h.storage.read()!;
  entry.room.history=Array.from({length:HISTORY_LIMIT+5},(_,i)=>({id:`event-${i+1}`,version:i+1,at:1000,type:'ready',text:'Ready'} as AuctionEvent));
  entry.room.version=entry.room.history.length;
  h.storage.transaction(()=>({next:entry,result:undefined}));
  const saved=h.storage.read()!;
  expect(saved.room.history).toHaveLength(HISTORY_LIMIT);
  expect(saved.room.history[0]!.version).toBe(6);
  expect(saved.room.historyTruncated).toBe(true);
  expect(h.driver!.all('SELECT COUNT(*) AS count FROM room_events')[0]!.count).toBe(HISTORY_LIMIT);
  const reopened=h.reopen().read()!;
  expect(reopened).toEqual(saved);
 });
 it('rejects unknown schema versions without rewriting existing data',()=>{
  const {driver,storage}=sqlite(),f=seed();save(storage,f.entry);driver.run('UPDATE room_schema SET version = ?',ROOM_SCHEMA_VERSION+998);
  expect(()=>new SqliteRoomStorage(driver)).toThrow(/schema version/);
  expect(storage.read()).toEqual(f.entry);expect(driver.all('SELECT version FROM room_schema')[0]!.version).toBe(ROOM_SCHEMA_VERSION+998);
 });
 it('retains legacy receipts and redacts stored history updates transactionally',()=>{
  const {storage}=sqlite(),f=seed();f.entry.receipts['host:legacy']={fingerprint:'legacy'};save(storage,f.entry);
  storage.transaction(entry=>{entry!.room.history[0]!.text='Participant details removed.';return {next:entry,result:undefined};});
  expect(storage.read()!.room.history[0]!.text).toBe('Participant details removed.');expect(storage.read()!.receipts['host:legacy']).toEqual({fingerprint:'legacy'});
 });
});
