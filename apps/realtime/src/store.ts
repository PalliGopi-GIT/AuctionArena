import { recoverRoomOnWake, validateRoomRecovery } from '../../../packages/room-runtime/src/recovery';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { isDeletableRoomStatus, type Room, type User } from '../../../packages/shared/src/domain';
import type { Settings, Action } from '../../../packages/shared/src/index';
import { applyAction, createRoom, event, RuleError } from '../../../packages/engine/src/index';
import { normalizeProfileName, profileNameError, profileNameKey } from '../../../packages/shared/src/profile-rules';
import { HEARTBEAT_FLUSH_MS, SNAPSHOT_EVENTS, roomSnapshot, type HistoryPage } from '../../../packages/shared/src/room-sync';
import { advanceRoom, applyStoredAction, boundStoredRoom, type StoredRoom } from '../../../packages/room-runtime/src/record';
import { withPlanSeed } from '../../../packages/catalog/src/room-plan';

interface ProfileRecord { name:string; fetchedAt:number; customName?:string; providerVersion?:number }
interface DeletionRecord { subject?:string; requestedAt:number; attempts:number; retryAt:number; providerDeleted:boolean; completedAt?:number }
interface Database {rooms:Record<string,StoredRoom>;sessions:Record<string,{user:User;expires:number}>;profiles?:Record<string,ProfileRecord>;deletions?:Record<string,DeletionRecord>}
export const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
/**
 * Mirrors advanceRoom's change conditions. Over-approximating is safe: a false
 * positive clones and advances, while a false negative would lose a deadline.
 * Most heartbeats and reads have no due room, so this avoids cloning the whole
 * development database on every request.
 */
function needsAdvance(room:Room,now:number){
 const host=room.members.find(member=>member.id===room.hostId);
 for(const member of room.members)if(member.connected&&now-member.lastSeen>10000)return true;
 if(room.status==='LIVE'){
  if(!host?.connected)return true;
  if(room.deadline!==null&&now>=room.deadline)return true;
 }
 if(room.status==='RESULT'&&room.settings.autoAdvance&&room.resultAt!==null&&now>=room.resultAt)return true;
 return false;
}
function validateRecovery(db:Database) {
 if(!db.rooms||!db.sessions)throw new Error('Invalid local database schema; refusing to start.');
 const invariant=(condition:boolean,message:string)=>{if(!condition)throw new Error(message+' invariant failed; refusing to start.');};
 if(db.profiles!==undefined) {
  invariant(!!db.profiles&&typeof db.profiles==='object'&&!Array.isArray(db.profiles),'Profile schema');
  for(const [id,profile] of Object.entries(db.profiles)) invariant(!!id&&!!profile&&typeof profile.name==='string'&&!!profile.name.trim()&&Array.from(profile.name).length<=60&&Number.isFinite(profile.fetchedAt)&&profile.fetchedAt>=0,'Profile');
  for(const profile of Object.values(db.profiles)) {
   invariant(profile.customName===undefined||!profileNameError(profile.customName),'Custom profile');
   invariant(profile.providerVersion===undefined||Number.isFinite(profile.providerVersion)&&profile.providerVersion>=0,'Provider version');
  }
 }
 if(db.deletions!==undefined) {
  invariant(!!db.deletions&&typeof db.deletions==='object'&&!Array.isArray(db.deletions),'Deletion schema');
  for(const [key,job] of Object.entries(db.deletions)) invariant(/^[a-f0-9]{64}$/.test(key)&&!!job&&Number.isFinite(job.requestedAt)&&job.requestedAt>=0&&Number.isSafeInteger(job.attempts)&&job.attempts>=0&&Number.isFinite(job.retryAt)&&typeof job.providerDeleted==='boolean'&&(job.completedAt===undefined?typeof job.subject==='string'&&digest(job.subject)===key:Number.isFinite(job.completedAt)&&job.subject===undefined),'Deletion');
 }
 for(const {room} of Object.values(db.rooms))validateRoomRecovery(room);
}
/** Development adapter. Exactly one process may own this file. */
export class LocalRoomStore extends EventEmitter {
 private db:Database={rooms:{},sessions:{}};
 private heartbeatDirty=false;
 private lastFlush=0;
 constructor(private path:string|null,private clock:()=>number=Date.now){super();if(path){try{this.db=JSON.parse(readFileSync(path,'utf8')) as Database;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}validateRecovery(this.db);const next=structuredClone(this.db);for(const entry of Object.values(next.rooms))recoverRoomOnWake(entry.room,this.clock());this.commit(next);}}
 private commit(next:Database){
  for(const entry of Object.values(next.rooms))boundStoredRoom(entry);
  if(this.path){mkdirSync(dirname(this.path),{recursive:true});const temp=`${this.path}.tmp`;writeFileSync(temp,JSON.stringify(next),{encoding:'utf8',flush:true});renameSync(temp,this.path);}this.db=next;this.heartbeatDirty=false;this.lastFlush=this.clock();
 }
 session(name:string){const token=randomBytes(32).toString('base64url');const user={id:`local_${randomBytes(12).toString('hex')}`,name};const next=structuredClone(this.db);next.sessions[digest(token)]={user,expires:this.clock()+7*86400000};this.commit(next);return {token,user};}
 authenticate(token:string){const session=this.db.sessions[digest(token)];return session&&session.expires>this.clock()&&!this.accountUnavailable(session.user.id)?session.user:null;}
 accountUnavailable(userId:string){return !!this.db.deletions?.[digest(userId)];}
 private active(userId:string){if(this.accountUnavailable(userId))throw new RuleError('ACCOUNT_DELETED','This account no longer has access.');}
 profile(userId:string){const saved=this.db.profiles?.[userId];return saved?{user:{id:userId,name:saved.name},fetchedAt:saved.fetchedAt}:undefined;}
 /** Called only with a profile resolved for the authenticated subject by the API. */
 projectProfile(user:User,fetchedAt:number,providerVersion?:number){
  if(this.accountUnavailable(user.id))return;
  if(!user.id||!user.name.trim()||Array.from(user.name).length>60||!Number.isFinite(fetchedAt)||fetchedAt<0)throw new Error('Invalid profile projection.');
  const previous=this.db.profiles?.[user.id];
  if(providerVersion!==undefined&&previous?.providerVersion!==undefined&&providerVersion<=previous.providerVersion)return;
  const next=structuredClone(this.db);next.profiles??={};
  let name=previous?.customName||normalizeProfileName(user.name);
  const taken=(candidate:string)=>Object.entries(next.profiles!).some(([id,p])=>id!==user.id&&profileNameKey(p.name)===profileNameKey(candidate));
  if(taken(name)){const suffix=digest(user.id).slice(0,12);name=Array.from(name).slice(0,45).join('')+' · '+suffix;}
  user={id:user.id,name};
  next.profiles[user.id]={...previous,name,fetchedAt,...(providerVersion===undefined?{}:{providerVersion})};
  const changed:Room[]=[];
  for(const entry of Object.values(next.rooms)) {
   const member=entry.room.members.find(item=>item.id===user.id);
   if(member&&member.name!==user.name){member.name=user.name;event(entry.room,this.clock(),'profile_updated','A participant updated their display name.');changed.push(entry.room);}
  }
  this.commit(next);for(const room of changed)this.emit('room',room);
 }
 setDisplayName(user:User,input:unknown){
  this.active(user.id);const error=profileNameError(input);if(error)throw new RuleError('INVALID_NAME',error);
  const name=normalizeProfileName(input as string),key=profileNameKey(name);
  if(Object.entries(this.db.profiles??{}).some(([id,p])=>id!==user.id&&profileNameKey(p.name)===key)||Object.values(this.db.sessions).some(s=>s.user.id!==user.id&&profileNameKey(s.user.name)===key))throw new RuleError('NAME_TAKEN','That display name is already in use. Choose another.');
  const next=structuredClone(this.db);next.profiles??={};next.profiles[user.id]={...next.profiles[user.id],name,customName:name,fetchedAt:next.profiles[user.id]?.fetchedAt??0};
  for(const session of Object.values(next.sessions))if(session.user.id===user.id)session.user.name=name;
  const changed:Room[]=[];for(const entry of Object.values(next.rooms)){const member=entry.room.members.find(m=>m.id===user.id);if(member&&member.name!==name){member.name=name;event(entry.room,this.clock(),'profile_updated','A participant updated their display name.');changed.push(entry.room);}}
  this.commit(next);for(const room of changed)this.emit('room',room);return {id:user.id,name};
 }
 requestAccountDeletion(userId:string,providerDeleted=false){
  const key=digest(userId),old=this.db.deletions?.[key];if(old?.completedAt!==undefined)return;
  const next=structuredClone(this.db);next.deletions??={};next.deletions[key]={subject:userId,requestedAt:old?.requestedAt??this.clock(),attempts:old?.attempts??0,retryAt:0,providerDeleted:providerDeleted||old?.providerDeleted||false};
  for(const [token,session] of Object.entries(next.sessions))if(session.user.id===userId)delete next.sessions[token];
  this.commit(next);this.emit('access-ended',userId);
 }
 pendingAccountDeletions(){return Object.entries(this.db.deletions??{}).filter(([,job])=>job.completedAt===undefined&&job.retryAt<=this.clock()).map(([key,job])=>({key,...job}));}
 retryAccountDeletion(userId:string){const next=structuredClone(this.db),job=next.deletions?.[digest(userId)];if(!job||job.completedAt!==undefined)return;job.attempts++;job.retryAt=this.clock()+Math.min(3600000,1000*2**Math.min(job.attempts,12));this.commit(next);}
 completeAccountDeletion(userId:string){
  const next=structuredClone(this.db),job=next.deletions?.[digest(userId)];if(!job||job.completedAt!==undefined)return;
  const anonymousId='deleted_'+digest(userId),changed:Room[]=[];
  const identityEvents=new Set(['joined','left','member_removed','team_claimed','ready','disconnected','connected']);
  for(const [code,entry] of Object.entries(next.rooms)){
   let room=entry.room;const member=room.members.find(m=>m.id===userId);
   const related=!!member||room.blockedUserIds?.includes(userId)||room.history.some(item=>item.actorId===userId);
   const legacy=room.history.some(item=>identityEvents.has(item.type)&&!item.actorId);
   if(!related&&!legacy)continue;
   if(member&&room.members.length===1){delete next.rooms[code];continue;}
   if(room.hostId===userId&&!['COMPLETED','CLOSED'].includes(room.status)){room=applyAction(room,userId,{id:'account-deleted',type:'end'},this.clock());entry.room=room;}
   for(const item of room.members)if(item.id===userId){item.id=anonymousId;item.name='Deleted player';item.connected=false;item.ready=false;item.lastSeen=0;}
   if(room.hostId===userId)room.hostId=anonymousId;
   for(const team of room.teams)if(team.ownerId===userId)team.ownerId=anonymousId;
   room.blockedUserIds=room.blockedUserIds?.map(id=>id===userId?anonymousId:id);
   // Actor IDs allow targeted redaction after a rename or lobby leave. Legacy identity prose
   // has no reliable author; conservatively redact it while preserving financial bid/sale details.
   for(const history of room.history){
    if(history.actorId===userId||identityEvents.has(history.type)&&!history.actorId)history.text='Participant details removed after account deletion.';
    history.text=history.text.split(userId).join(anonymousId);
    if(history.actorId===userId)history.actorId=anonymousId;
   }
   for(const receipt of Object.keys(entry.receipts))if(receipt.startsWith(userId+':'))delete entry.receipts[receipt];
   event(room,this.clock(),related?'account_deleted':'privacy_updated','Personal details were removed. Accepted sales are preserved.');changed.push(room);
  }
  if(next.profiles)delete next.profiles[userId];delete job.subject;job.completedAt=this.clock();job.providerDeleted=true;
  this.commit(next);for(const room of changed)this.emit('room',room);
 }
 list(user:User){this.active(user.id);return Object.values(this.db.rooms).filter(e=>!e.room.blockedUserIds?.includes(user.id)&&e.room.members.some(m=>m.id===user.id)).map(e=>structuredClone(e.room));}
 get(code:string,user:User,heartbeat=false){this.active(user.id);const entry=this.db.rooms[code];if(!entry)throw new RuleError('ROOM_NOT_FOUND','Room unavailable. Check your invitation or ask the host for access.');if(entry.room.blockedUserIds?.includes(user.id))throw new RuleError('ROOM_BLOCKED','The host removed you from this room.');if(!entry.room.members.some(m=>m.id===user.id))throw new RuleError('ROOM_NOT_FOUND','Room unavailable. Check your invitation or ask the host for access.');if(heartbeat){this.sweep();const current=this.db.rooms[code]!.room.members.find(m=>m.id===user.id)!;if(current.connected){current.lastSeen=this.clock();this.heartbeatDirty=true;return structuredClone(this.db.rooms[code]!.room);}const next=structuredClone(this.db);const room=next.rooms[code]!.room;const member=room.members.find(m=>m.id===user.id)!;const changed=!member.connected;member.lastSeen=this.clock();member.connected=true;if(changed)event(room,this.clock(),'connected',`${member.name} reconnected.`,user.id);this.commit(next);if(changed)this.emit('room',room);}return structuredClone(this.db.rooms[code]!.room);}
 create(user:User,settings:Settings){this.active(user.id);if(this.list(user).filter(r=>!['COMPLETED','CLOSED'].includes(r.status)).length>=10)throw new RuleError('ROOM_LIMIT','Local preview allows 10 active rooms per host.');let code;do{code=randomBytes(4).toString('hex').slice(0,6).toUpperCase();}while(this.db.rooms[code]);const token=randomBytes(32).toString('base64url');const room=createRoom(code,user,settings,this.clock());const next=structuredClone(this.db);next.rooms[code]={room,inviteHash:digest(token),inviteExpires:this.clock()+86400000,receipts:{}};this.commit(next);return {room:structuredClone(room),inviteToken:token};}
 join(code:string,user:User,token?:string){this.active(user.id);const entry=this.db.rooms[code];if(!entry)throw new RuleError('ROOM_NOT_FOUND','Room unavailable. Check your invitation or ask the host for access.');if(entry.room.blockedUserIds?.includes(user.id))throw new RuleError('ROOM_BLOCKED','The host removed you from this room.');if(entry.room.members.some(m=>m.id===user.id))return this.get(code,user,true);if(token&&(entry.inviteExpires<=this.clock()||digest(token)!==entry.inviteHash))throw new RuleError('ROOM_NOT_FOUND','Room unavailable. Check your invitation or ask the host for access.');if(['COMPLETED','CLOSED'].includes(entry.room.status))throw new RuleError('ROOM_NOT_FOUND','Room unavailable. Check your invitation or ask the host for access.');if(entry.room.status!=='WAITING'&&!entry.room.settings.spectators)throw new RuleError('ROOM_NOT_FOUND','Room unavailable. Check your invitation or ask the host for access.');if(entry.room.members.filter(m=>!entry.room.blockedUserIds?.includes(m.id)).length>=20)throw new RuleError('ROOM_NOT_FOUND','Room unavailable. Check your invitation or ask the host for access.');const next=structuredClone(this.db);const room=next.rooms[code]!.room;room.members.push({...user,connected:true,ready:false,lastSeen:this.clock()});event(room,this.clock(),'joined',`${user.name} joined the room.`,user.id);this.commit(next);this.emit('room',room);return structuredClone(room);}
 rotateInvite(code:string,user:User) {
  const existing=this.get(code,user);
  if(existing.hostId!==user.id)throw new RuleError('HOST_ONLY','Only the host can renew the invitation.');
  if(existing.status==='COMPLETED'||existing.status==='CLOSED')throw new RuleError('ROOM_ENDED','This auction has ended.');
  const token=randomBytes(32).toString('base64url');
  const next=structuredClone(this.db);const entry=next.rooms[code]!;
  entry.inviteHash=digest(token);entry.inviteExpires=this.clock()+86400000;
  event(entry.room,this.clock(),'invite_renewed','Host renewed the invitation. Previous links no longer admit new members.');
  this.commit(next);this.emit('room',entry.room);
  return {room:structuredClone(entry.room),inviteToken:token};
 }
 /** Permanently remove an ended room. A missing room is treated as already deleted. */
 deleteRoom(code:string,user:User){
  this.active(user.id);
  const entry=this.db.rooms[code];
  if(!entry)return {deleted:true,alreadyDeleted:true};
  if(entry.room.hostId!==user.id)throw new RuleError('HOST_ONLY','Only the host can delete this room.');
  if(!isDeletableRoomStatus(entry.room.status))throw new RuleError('ROOM_ACTIVE','Only completed or closed rooms can be deleted.');
  const next=structuredClone(this.db);delete next.rooms[code];this.commit(next);this.emit('room-deleted',code);
  return {deleted:true,alreadyDeleted:false};
 }
 action(code:string,user:User,action:Action){this.get(code,user);this.sweep();const entry=this.db.rooms[code]!;
  // The fingerprint uses the client payload so a retry stays idempotent; the
  // server-only seed is injected afterwards.
  const fingerprint=digest(JSON.stringify(action));
  const prepared=withPlanSeed(action,()=>randomBytes(16).toString('hex'));
  const updated=applyStoredAction(entry,user,prepared,this.clock(),fingerprint);if(updated===entry)return structuredClone(entry.room);
  const next=structuredClone(this.db);next.rooms[code]=updated;this.commit(next);this.emit('room',updated.room);return structuredClone(updated.room);
 }
 history(code:string,user:User,before?:number,limit=100):HistoryPage{
  const room=this.get(code,user);
  if(!Number.isSafeInteger(limit)||limit<1||limit>100||before!==undefined&&(!Number.isSafeInteger(before)||before<0))throw new RuleError('INVALID_CURSOR','Invalid history page.');
  const eligible=room.history.filter(item=>before===undefined||item.version<before);
  const events=eligible.slice(-limit).reverse();
  return {events,nextBefore:eligible.length>events.length?events.at(-1)!.version:null,truncated:!!room.historyTruncated};
 }
 sync(code:string,user:User,afterVersion:number){
  const room=this.get(code,user,true);
  if(!Number.isSafeInteger(afterVersion)||afterVersion<0)throw new RuleError('INVALID_CURSOR','Invalid replay version.');
  const events=room.history.filter(item=>item.version>afterVersion);
  const resetRequired=afterVersion>room.version||afterVersion<(room.history[0]?.version??room.version+1)-1||events.length>SNAPSHOT_EVENTS;
  const snapshot=roomSnapshot(room);
  const overBudget=new TextEncoder().encode(JSON.stringify({room:snapshot,events})).byteLength>124*1024;
  return {room:snapshot,replay:{afterVersion,resetRequired:resetRequired||overBudget,events:resetRequired||overBudget?[]:events}};
 }
 sweep(){const now=this.clock();if(!(this.heartbeatDirty&&now-this.lastFlush>=HEARTBEAT_FLUSH_MS)&&!Object.values(this.db.rooms).some(entry=>needsAdvance(entry.room,now)))return;const next=structuredClone(this.db);const changed:Room[]=[];for(const entry of Object.values(next.rooms)){const room=entry.room;const before=room.version;advanceRoom(room,now);if(room.version!==before)changed.push(room);}if(changed.length||this.heartbeatDirty&&now-this.lastFlush>=HEARTBEAT_FLUSH_MS){this.commit(next);for(const room of changed)this.emit('room',room);}}
}
