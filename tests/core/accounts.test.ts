import { describe, expect, it, vi } from 'vitest';
import { createHmac, generateKeyPairSync, randomBytes, sign } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EventEmitter } from 'node:events';
import { createApp } from '../../apps/api/src/app';
import { Accounts } from '../../apps/api/src/accounts';
import { LocalRoomStore, digest } from '../../apps/realtime/src/store';
import { attachRoomSocket } from '../../apps/api/src/room-socket';
import { ClerkProfiles } from '../../apps/api/src/clerk-profiles';
import { settingsSchema } from '../../packages/shared/src/index';

const host={id:'user_host',name:'Original Host'},guest={id:'user_guest',name:'Original Guest'};
const origin='http://127.0.0.1:5173',issuer='https://accounts-test.clerk.accounts.dev';
const keys=generateKeyPairSync('rsa',{modulusLength:2048});
const jwtKey=keys.publicKey.export({format:'pem',type:'spki'}).toString();
function jwt(age:unknown=0,sub=host.id){const now=Math.floor(Date.now()/1000);const body=[{alg:'RS256',typ:'JWT',kid:'account-test'},{sub,sid:'sess_account_test',iss:issuer,azp:origin,iat:now,nbf:now-1,exp:now+60,fva:[age,-1]}].map(x=>Buffer.from(JSON.stringify(x)).toString('base64url')).join('.');return body+'.'+sign('RSA-SHA256',Buffer.from(body),keys.privateKey).toString('base64url');}
const auth=(token:string)=>({Authorization:`Bearer ${token}`,'Content-Type':'application/json'});
const signingKey=randomBytes(32),secret='whsec_'+signingKey.toString('base64');
function delivery(event:unknown,changes:Record<string,string>={},seconds=Math.floor(Date.now()/1000)){
  const body=JSON.stringify(event),id='msg_account_test';
  const signature=createHmac('sha256',signingKey).update(`${id}.${seconds}.${body}`).digest('base64');
  return {method:'POST',body,headers:{'Content-Type':'application/json','svix-id':id,'svix-timestamp':String(seconds),'svix-signature':`v1,${signature}`,...changes}};
}
function roomFixture(path:string|null=null){let now=100000;const store=new LocalRoomStore(path,()=>now);const created=store.create(host,settingsSchema.parse({autoAdvance:false}));store.join(created.room.code,guest,created.inviteToken);store.action(created.room.code,host,{id:'claim-h',type:'claim',teamId:'t1'});store.action(created.room.code,guest,{id:'claim-g',type:'claim',teamId:'t2'});return {store,code:created.room.code,advance:(ms:number)=>{now+=ms;}};}

describe('application profile ownership and naming',()=>{
  it('normalizes compatibility characters, whitespace and case for uniqueness',()=>{
    const store=new LocalRoomStore(null);expect(store.setDisplayName(host,'  Ａrena   Captain  ').name).toBe('Arena Captain');
    expect(()=>store.setDisplayName(guest,'arena captain')).toThrow('already in use');
    expect(store.profile(guest.id)).toBeUndefined();
    for(const name of ['ab','x'.repeat(31),'bad\u0000name','<script>','bad\u202ename'])expect(()=>store.setDisplayName(guest,name)).toThrow();
    expect(store.setDisplayName(guest,'தமிழ் வீரர்').name).toBe('தமிழ் வீரர்');
  });
  it('accepts exactly one competing name claim without partially renaming the loser',async()=>{
    const store=new LocalRoomStore(null);const result=await Promise.allSettled([host,guest].map(async user=>store.setDisplayName(user,'Same Captain')));
    expect(result.filter(x=>x.status==='fulfilled')).toHaveLength(1);
    expect([store.profile(host.id),store.profile(guest.id)].filter(Boolean)).toHaveLength(1);
  });
  it('preserves custom names across provider refreshes and separates colliding provider names',()=>{
    const store=new LocalRoomStore(null);store.setDisplayName(host,'Captain Arena');store.projectProfile({...host,name:'Provider Name'},100,100);
    expect(store.profile(host.id)?.user.name).toBe('Captain Arena');
    store.projectProfile({...guest,name:'Captain Arena'},100,100);
    expect(store.profile(guest.id)?.user.name).not.toBe('Captain Arena');
    store.projectProfile({...guest,name:'Older Name'},101,99);
    expect(store.profile(guest.id)?.user.name).not.toBe('Older Name');
  });
  it('rejects forged profile ownership through HTTP and updates room names without auction mutations',async()=>{
    const store=new LocalRoomStore(null);const session=store.session('Local Captain');const room=store.create(session.user,settingsSchema.parse({})).room;
    const {app}=createApp(store,{localDevAuth:true});
    const request=(body:unknown)=>app.request('/api/me',{method:'PATCH',headers:auth(session.token),body:JSON.stringify(body)});
    expect((await request({displayName:'New Captain',userId:guest.id})).status).toBe(400);
    const response=await request({displayName:'New Captain'});expect(response.status).toBe(200);
    const renamed=store.get(room.code,session.user);expect(renamed.members[0]?.name).toBe('New Captain');
    expect(renamed.teams).toEqual(room.teams);expect(renamed.hostId).toBe(session.user.id);expect(renamed.version).toBe(room.version+1);
    expect(store.authenticate(session.token)?.name).toBe('New Captain');
  });
  it('denies a stale account assertion before a profile update or deletion can mutate another subject',async()=>{
    const store=new LocalRoomStore(null),session=store.session('Current Captain');const {app}=createApp(store,{localDevAuth:true});
    for(const method of ['PATCH','DELETE']){
      const response=await app.request('/api/me',{method,headers:{...auth(session.token),'X-Auction-Subject':'different-user'},body:JSON.stringify(method==='PATCH'?{displayName:'Wrong Rename'}:{confirmation:'DELETE MY ACCOUNT'})});
      expect(response.status).toBe(409);expect((await response.json()).code).toBe('ACCOUNT_CHANGED');
    }
    expect(store.profile(session.user.id)).toBeUndefined();expect(store.accountUnavailable(session.user.id)).toBe(false);
  });
});

describe('signed Clerk webhook synchronization',()=>{
  const event=(type='user.updated',version=200)=>({type,object:'event',instance_id:'ins_expected',timestamp:version,data:{id:guest.id,first_name:'Synced',last_name:'Guest',username:null,updated_at:version}});
  function fixture(){const store=new LocalRoomStore(null);return {store,...createApp(store,{localDevAuth:false,clerkWebhookSecret:secret,clerkInstanceId:'ins_expected'})};}
  it('requires a configured signing secret and rejects tampering, old signatures and wrong instances',async()=>{
    const {app,store}=fixture();
    for(const input of [delivery(event(),{'svix-signature':'v1,invalid'}),delivery(event(),{},Math.floor(Date.now()/1000)-600),delivery({...event(),instance_id:'ins_foreign'})])expect((await app.request('/api/webhooks/clerk',input)).status).toBe(400);
    expect(store.profile(guest.id)).toBeUndefined();
    const disabled=createApp(store,{localDevAuth:false});expect((await disabled.app.request('/api/webhooks/clerk',delivery(event()))).status).toBe(503);
  });
  it('persists a valid delivery, ignores duplicate/older updates and preserves a custom name',async()=>{
    const {app,store}=fixture();expect((await app.request('/api/webhooks/clerk',delivery(event()))).status).toBe(200);
    expect(store.profile(guest.id)?.user.name).toBe('Synced Guest');
    for(const version of [200,199])await app.request('/api/webhooks/clerk',delivery({...event('user.updated',version),data:{...event().data,first_name:'Older',updated_at:version}}));
    expect(store.profile(guest.id)?.user.name).toBe('Synced Guest');
    store.setDisplayName(guest,'My Arena Name');await app.request('/api/webhooks/clerk',delivery(event('user.updated',300)));
    expect(store.profile(guest.id)?.user.name).toBe('My Arena Name');
  });
  it('accepts larger signed provider payloads while rejecting invalid user events',async()=>{
    const {app}=fixture();expect((await app.request('/api/webhooks/clerk',delivery({...event(),private_metadata:{ignored:'x'.repeat(5000)}}))).status).toBe(200);
    expect((await app.request('/api/webhooks/clerk',delivery({...event(),data:{id:'not-a-user'}}))).status).toBe(400);
  });
  it('never resurrects a deleted subject when older signed events arrive later',async()=>{
    const {app,store,processAccounts}=fixture();await app.request('/api/webhooks/clerk',delivery(event()));
    await app.request('/api/webhooks/clerk',delivery(event('user.deleted',300)));await processAccounts();
    await app.request('/api/webhooks/clerk',delivery(event('user.created',100)));
    expect(store.accountUnavailable(guest.id)).toBe(true);expect(store.profile(guest.id)).toBeUndefined();expect(store.pendingAccountDeletions()).toEqual([]);
  });
});

describe('durable account deletion',()=>{
  it('requires fresh signed first-factor verification and exact confirmation',async()=>{
    const store=new LocalRoomStore(null),remove=vi.fn(async()=>{});const {app}=createApp(store,{localDevAuth:false,clerkJwtKey:jwtKey,clerkIssuer:issuer,allowedOrigins:[origin],deleteClerkUser:remove});
    for(const age of [6,-1,'0',null]){const response=await app.request('/api/me',{method:'DELETE',headers:auth(jwt(age)),body:JSON.stringify({confirmation:'DELETE MY ACCOUNT'})});expect(response.status).toBe(403);}
    expect((await app.request('/api/me',{method:'DELETE',headers:auth(jwt()),body:JSON.stringify({confirmation:'DELETE MY ACCOUNT',userId:guest.id})})).status).toBe(400);
    expect(store.pendingAccountDeletions()).toEqual([]);expect(remove).not.toHaveBeenCalled();
  });
  it('queues only the verified subject and denies private reads and admission tickets immediately',async()=>{
    const {store,code}=roomFixture();const remove=vi.fn(async()=>{});const {app,processAccounts,consumeTicket}=createApp(store,{localDevAuth:false,clerkJwtKey:jwtKey,clerkIssuer:issuer,allowedOrigins:[origin],deleteClerkUser:remove});
    const headers=auth(jwt(0,guest.id)),ticket=await(await app.request(`/api/rooms/${code}/ws-ticket`,{method:'POST',headers})).json() as {ticket:string};
    const response=await app.request('/api/me',{method:'DELETE',headers,body:JSON.stringify({confirmation:'DELETE MY ACCOUNT'})});expect(response.status).toBe(202);
    expect((await app.request(`/api/rooms/${code}`,{headers})).status).toBe(401);expect(consumeTicket(ticket.ticket)).toBeNull();
    expect(remove).not.toHaveBeenCalled();await processAccounts();expect(remove).toHaveBeenCalledExactlyOnceWith(guest.id);
  });
  it('requires active hosts to end their rooms before requesting deletion',async()=>{
    const {store}=roomFixture();const {app}=createApp(store,{localDevAuth:false,clerkJwtKey:jwtKey,clerkIssuer:issuer,allowedOrigins:[origin],deleteClerkUser:async()=>{}});
    expect((await app.request('/api/me',{method:'DELETE',headers:auth(jwt()),body:JSON.stringify({confirmation:'DELETE MY ACCOUNT'})})).status).toBe(409);
    expect(store.accountUnavailable(host.id)).toBe(false);
  });
  it('closes already admitted sockets as soon as deletion is queued',()=>{
    const {store,code}=roomFixture();class Socket extends EventEmitter{readyState=1;bufferedAmount=0;send=vi.fn();close=vi.fn(()=>{this.readyState=3;this.emit('close');});}
    const socket=new Socket();attachRoomSocket(store,code,guest,socket);store.requestAccountDeletion(guest.id,true);
    expect(socket.close).toHaveBeenCalledWith(1008,'Account access ended');expect(store.listenerCount('access-ended')).toBe(0);expect(()=>store.get(code,guest)).toThrow('no longer has access');
  });
  it('retries failed provider deletion after restart without restoring account access',async()=>{
    const dir=mkdtempSync(join(tmpdir(),'arena-accounts-'));try{
      const path=join(dir,'db.json');let now=100000;let store=new LocalRoomStore(path,()=>now);store.setDisplayName(guest,'Pending Guest');store.requestAccountDeletion(guest.id);
      await new Accounts(store,async()=>{throw new Error('private provider failure');}).process();expect(store.pendingAccountDeletions()).toEqual([]);
      now+=3000;store=new LocalRoomStore(path,()=>now);const remove=vi.fn(async()=>{});await new Accounts(store,remove).process();
      expect(remove).toHaveBeenCalledExactlyOnceWith(guest.id);expect(store.accountUnavailable(guest.id)).toBe(true);expect(store.profile(guest.id)).toBeUndefined();expect(readFileSync(path,'utf8')).not.toContain(guest.id);
    }finally{rmSync(dir,{recursive:true,force:true});}
  });
  it('preserves accepted sales, scrubs earlier names and completes an externally deleted host once',async()=>{
    const {store,code}=roomFixture();store.action(code,host,{id:'start',type:'start'});store.action(code,guest,{id:'bid',type:'bid',amount:100,playerId:'p1'});store.setDisplayName(guest,'Renamed Guest');
    store.requestAccountDeletion(host.id,true);await new Accounts(store).process();const result=store.get(code,guest);
    expect(result.status).toBe('COMPLETED');expect(result.teams[1]?.squad).toEqual([{playerId:'p1',price:100}]);expect(result.teams[1]?.budget).toBe(7900);expect(JSON.stringify(result)).not.toContain(host.id);
    const version=result.version;store.requestAccountDeletion(host.id,true);await new Accounts(store).process();expect(store.get(code,guest).version).toBe(version);
  });
  it('does not let an in-flight Backend profile lookup recreate deleted profile data',async()=>{
    const store=new LocalRoomStore(null);let release!:(value:{id:string;firstName:string;lastName:null;username:null})=>void;
    const profiles=new ClerkProfiles(store,()=>new Promise(resolve=>{release=resolve;}));const pending=profiles.resolve(guest,true);await Promise.resolve();store.requestAccountDeletion(guest.id,true);await new Accounts(store).process();release({id:guest.id,firstName:'Old name',lastName:null,username:null});await pending;expect(store.profile(guest.id)).toBeUndefined();
  });
  it('redacts a departed participant and their previous name without exposing their subject',async()=>{
    const {store,code}=roomFixture();store.setDisplayName(guest,'Changed Guest');store.action(code,guest,{id:'leave-guest',type:'leave'});
    store.requestAccountDeletion(guest.id,true);await new Accounts(store).process();const result=JSON.stringify(store.get(code,host));
    expect(result).not.toContain(guest.id);expect(result).not.toContain('Original Guest');expect(result).not.toContain('Changed Guest');
  });
  it('coalesces concurrent deletion workers',async()=>{
    const store=new LocalRoomStore(null);store.requestAccountDeletion(guest.id);let release!:()=>void;const remove=vi.fn(()=>new Promise<void>(resolve=>{release=resolve;}));const accounts=new Accounts(store,remove);const first=accounts.process(),second=accounts.process();expect(first).toBe(second);release();await Promise.all([first,second]);expect(remove).toHaveBeenCalledTimes(1);
  });
});
