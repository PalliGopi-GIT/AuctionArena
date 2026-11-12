import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { Room, User } from '../../../packages/shared/src/domain';
import { completionReasons, validBidOnLadder } from '../../../packages/shared/src/domain';
import { bidReserve } from '../../../packages/shared/src/bid-rules';
import type { Settings, Action } from '../../../packages/shared/src/index';
import { applyAction, createRoom, event, RuleError, tick } from '../../../packages/engine/src/index';
import { normalizeProfileName, profileNameError, profileNameKey } from '../../../packages/shared/src/profile-rules';

interface StoredRoom { room:Room; inviteHash:string; inviteExpires:number; receipts:Record<string,{fingerprint:string}> }
interface ProfileRecord { name:string; fetchedAt:number; customName?:string; providerVersion?:number }
interface DeletionRecord { subject?:string; requestedAt:number; attempts:number; retryAt:number; providerDeleted:boolean; completedAt?:number }
interface Database {rooms:Record<string,StoredRoom>;sessions:Record<string,{user:User;expires:number}>;profiles?:Record<string,ProfileRecord>;deletions?:Record<string,DeletionRecord>}
export const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
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
 for(const {room} of Object.values(db.rooms)) {
  invariant(room.bidRule===undefined||room.bidRule==='tiered-v1','Bid rule');
  if(room.completion_reason!==undefined) {
   invariant(completionReasons.includes(room.completion_reason),'Completion reason');
   invariant(room.status==='CLOSED'?room.completion_reason==='HOST_CLOSED':room.status==='COMPLETED'&&room.completion_reason!=='HOST_CLOSED','Completion state');
  }
  const purchased=new Set<string>();
  invariant(new Set(room.players.map(p=>p.id)).size===room.players.length,'Player identity');
  invariant(new Set(room.teams.map(t=>t.id)).size===room.teams.length,'Team identity');
  for(const team of room.teams) {
   invariant(Number.isSafeInteger(team.budget)&&team.budget>=0&&team.budget+team.squad.reduce((sum,p)=>sum+p.price,0)===room.settings.budget,'Budget');
   invariant(team.squad.length<=room.settings.maxSquad,'Squad');
   for(const purchase of team.squad) {
    const player=room.players.find(p=>p.id===purchase.playerId);
    invariant(Number.isSafeInteger(purchase.price)&&purchase.price>0&&!purchased.has(purchase.playerId)&&player?.status==='sold'&&player.soldTo===team.id&&player.soldPrice===purchase.price,'Sale');
    purchased.add(purchase.playerId);
   }
  }
  for(const player of room.players) invariant(player.status==='sold'?purchased.has(player.id):player.soldTo===undefined&&player.soldPrice===undefined,'Sale');
  const open=room.players.filter(p=>p.status==='open');
  const active=room.status==='LIVE'||room.status==='PAUSED';
  invariant(open.length===(active?1:0),'Open lot');
  if(active) {
   const player=room.players[room.currentPlayerIndex];
   invariant(player?.status==='open','Current player');
   invariant(room.status==='LIVE'?Number.isFinite(room.deadline)&&room.deadline!==null:room.deadline===null&&Number.isFinite(room.pausedRemaining)&&room.pausedRemaining>=0,'Deadline');
   invariant(Number.isSafeInteger(room.currentBid)&&room.currentBid>=0,'Bid');
   if(room.leadingTeamId===null) invariant(room.currentBid===0,'Bid');
   else {
    const team=room.teams.find(t=>t.id===room.leadingTeamId);
    invariant(!!team?.ownerId&&room.members.some(m=>m.id===team?.ownerId),'Leader');
    invariant(!!team&&team.budget>=room.currentBid&&validBidOnLadder(room,player!.basePrice,room.currentBid)&&team.squad.length<room.settings.maxSquad,'Bid');
    const overseas=team!.squad.filter(s=>room.players.find(p=>p.id===s.playerId)?.overseas).length;
    const reserve=bidReserve(room,team!);
    invariant(team!.budget-room.currentBid>=reserve&&(!player!.overseas||overseas<room.settings.maxOverseas),'Bid eligibility');
   }
  }
 }
}
function advanceRoom(room:Room,now:number) {
 const host=room.members.find(m=>m.id===room.hostId);
 const absentAt=host?host.lastSeen+10000:now;
 for(const member of room.members) if(member.connected&&now-member.lastSeen>10000) {
  member.connected=false;event(room,now,'disconnected',member.name+' disconnected.',member.id);
 }
 const pause=(at:number)=>{room.pausedRemaining=Math.max(0,room.deadline!-at);room.deadline=null;room.status='PAUSED';room.pauseReason='Host disconnected. Waiting for the host to return.';event(room,now,'paused',room.pauseReason);};
 // A delayed scheduler must apply host expiry before a later bidding deadline.
 if(room.status==='LIVE'&&!host?.connected&&absentAt<room.deadline!)pause(Math.min(now,absentAt));
 tick(room,now);
 // Auto-advance may have opened another lot while the host was away.
 if(room.status==='LIVE'&&!host?.connected)pause(now);
}
/** Development adapter. Exactly one process may own this file. Never use on ECS. */
export class LocalRoomStore extends EventEmitter {
 private db:Database={rooms:{},sessions:{}};
 constructor(private path:string|null,private clock:()=>number=Date.now){super();if(path){try{this.db=JSON.parse(readFileSync(path,'utf8')) as Database;}catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')throw e;}validateRecovery(this.db);const next=structuredClone(this.db);for(const entry of Object.values(next.rooms)){for(const member of entry.room.members)member.connected=false;tick(entry.room,this.clock());if(entry.room.status==='LIVE'){entry.room.pausedRemaining=Math.max(0,entry.room.deadline!-this.clock());entry.room.deadline=null;entry.room.status='PAUSED';entry.room.pauseReason='Service restarted; host must resume';event(entry.room,this.clock(),'paused',entry.room.pauseReason);}}this.commit(next);}}
 private commit(next:Database){if(this.path){mkdirSync(dirname(this.path),{recursive:true});const temp=`${this.path}.tmp`;writeFileSync(temp,JSON.stringify(next),{encoding:'utf8',flush:true});renameSync(temp,this.path);}this.db=next;}
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
 get(code:string,user:User,heartbeat=false){this.active(user.id);const entry=this.db.rooms[code];if(!entry)throw new RuleError('ROOM_NOT_FOUND','Room unavailable. Check your invitation or ask the host for access.');if(entry.room.blockedUserIds?.includes(user.id))throw new RuleError('ROOM_BLOCKED','The host removed you from this room.');if(!entry.room.members.some(m=>m.id===user.id))throw new RuleError('ROOM_NOT_FOUND','Room unavailable. Check your invitation or ask the host for access.');if(heartbeat){this.sweep();const next=structuredClone(this.db);const room=next.rooms[code]!.room;const member=room.members.find(m=>m.id===user.id)!;const changed=!member.connected;member.lastSeen=this.clock();member.connected=true;if(changed)event(room,this.clock(),'connected',`${member.name} reconnected.`,user.id);this.commit(next);if(changed)this.emit('room',room);}return structuredClone(this.db.rooms[code]!.room);}
 create(user:User,settings:Settings){this.active(user.id);if(this.list(user).filter(r=>!['COMPLETED','CLOSED'].includes(r.status)).length>=10)throw new RuleError('ROOM_LIMIT','Local preview allows 10 active rooms per host.');let code;do{code=randomBytes(4).toString('hex').slice(0,6).toUpperCase();}while(this.db.rooms[code]);const token=randomBytes(32).toString('base64url');const room=createRoom(code,user,settings,this.clock());const next=structuredClone(this.db);next.rooms[code]={room,inviteHash:digest(token),inviteExpires:this.clock()+86400000,receipts:{}};this.commit(next);return {room:structuredClone(room),inviteToken:token};}
 join(code:string,user:User,token:string){this.active(user.id);const entry=this.db.rooms[code];if(!entry)throw new RuleError('ROOM_NOT_FOUND','Room unavailable. Check your invitation or ask the host for access.');if(entry.room.blockedUserIds?.includes(user.id))throw new RuleError('ROOM_BLOCKED','The host removed you from this room.');if(entry.room.members.some(m=>m.id===user.id))return this.get(code,user,true);if(entry.inviteExpires<=this.clock()||digest(token)!==entry.inviteHash)throw new RuleError('ROOM_NOT_FOUND','Room unavailable. Check your invitation or ask the host for access.');if(['COMPLETED','CLOSED'].includes(entry.room.status))throw new RuleError('ROOM_NOT_FOUND','Room unavailable. Check your invitation or ask the host for access.');if(entry.room.status!=='WAITING'&&!entry.room.settings.spectators)throw new RuleError('ROOM_NOT_FOUND','Room unavailable. Check your invitation or ask the host for access.');if(entry.room.members.filter(m=>!entry.room.blockedUserIds?.includes(m.id)).length>=20)throw new RuleError('ROOM_NOT_FOUND','Room unavailable. Check your invitation or ask the host for access.');const next=structuredClone(this.db);const room=next.rooms[code]!.room;room.members.push({...user,connected:true,ready:false,lastSeen:this.clock()});event(room,this.clock(),'joined',`${user.name} joined the room.`,user.id);this.commit(next);this.emit('room',room);return structuredClone(room);}
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
 action(code:string,user:User,action:Action){this.get(code,user);this.sweep();const entry=this.db.rooms[code]!;const key=`${user.id}:${action.id}`;const fingerprint=digest(JSON.stringify(action));if(entry.receipts[key]){if(entry.receipts[key]!.fingerprint!==fingerprint)throw new RuleError('ID_REUSED','Action ID was reused with different content.');return structuredClone(entry.room);}const room=applyAction(entry.room,user.id,action,this.clock());const next=structuredClone(this.db);next.rooms[code]!.room=room;next.rooms[code]!.receipts[key]={fingerprint};this.commit(next);this.emit('room',room);return structuredClone(room);}
 sweep(){const next=structuredClone(this.db);const changed:Room[]=[];const now=this.clock();for(const entry of Object.values(next.rooms)){const room=entry.room;const before=room.version;advanceRoom(room,now);if(room.version!==before)changed.push(room);}if(changed.length){this.commit(next);for(const room of changed)this.emit('room',room);}}
}
