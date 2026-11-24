import { type Room, type User, type CompletionReason, auctionModeLabels, auctionModeRules, completionMessages, money, nextBid, samplePlayers, teamColors, teamNames } from '../../shared/src/domain';
import { bidReserve, purchaseRestriction } from '../../shared/src/bid-rules';
import type { Action, Settings } from '../../shared/src/index';
import { settingsErrors, normalizedSettings } from '../../shared/src/settings-rules';
import { catalog } from '../../catalog/src/index';
import { approvePlan } from '../../catalog/src/room-plan';

export class RuleError extends Error { constructor(public code:string,message:string) { super(message); } }
const requireRule=(condition:unknown,code:string,message:string):void=>{if(!condition)throw new RuleError(code,message);};
export function event(room:Room,now:number,type:string,text:string,actorId?:string) { room.version++; room.history.push({id:`${room.code}-${room.version}`,version:room.version,at:now,type,text,...(actorId?{actorId}:{})}); }
export function createRoom(code:string,user:User,settings:Settings,now:number):Room { const errors=settingsErrors(settings);requireRule(!errors.length,'INVALID_SETTINGS',errors.join(' '));settings=normalizedSettings(settings);return {code,name:settings.name,hostId:user.id,status:'WAITING',settings,bidRule:'tiered-v1',members:[{...user,connected:true,ready:false,lastSeen:now}],teams:teamNames.slice(0,settings.teamCount).map((name,i)=>({id:`t${i+1}`,name,color:teamColors[i]!,ownerId:null,budget:settings.budget,squad:[]})),players:samplePlayers(),currentPlayerIndex:-1,currentBid:0,leadingTeamId:null,deadline:null,pausedRemaining:0,resultAt:null,extensions:0,version:0,history:[],createdAt:now}; }
/** Authoritative pre-start checks: pool size, nationality capacity and purse reserve. */
export function startProblems(room:Room):string[] {
 const problems:string[]=[];
 const participating=room.teams.filter(team=>team.ownerId&&!room.blockedUserIds?.includes(team.ownerId));
 if(participating.length<2)problems.push('At least two teams must be claimed.');
 if(room.settings.minSquad>room.settings.maxSquad)problems.push('Minimum squad cannot exceed maximum squad.');
 if(!room.players.length)problems.push('The player pool is empty.');
 else {
  const needed=participating.length*room.settings.minSquad;
  if(room.players.length<needed)problems.push(`The player pool has ${room.players.length} players but ${participating.length} teams need ${needed} to reach the minimum squad.`);
  const cheapest=Math.min(...room.players.map(player=>player.basePrice));
  for(const team of participating){
   const remaining=Math.max(0,room.settings.minSquad-team.squad.length);
   const reserve=remaining*cheapest;
   if(team.budget<reserve)problems.push(`${team.name} needs ${money(reserve)} to reach the minimum squad but has ${money(team.budget)}.`);
  }
  const minIndian=Math.max(0,room.settings.minSquad-room.settings.maxOverseas);
  const indian=room.players.filter(player=>!player.overseas).length;
  if(indian<participating.length*minIndian)problems.push(`The player pool needs ${participating.length*minIndian} Indian players for ${participating.length} teams but has ${indian}.`);
 }
 if(room.settings.mode){
  const rules=auctionModeRules[room.settings.mode];
  if(room.settings.minSquad!==rules.squad||room.settings.maxSquad!==rules.squad||room.settings.maxOverseas!==rules.maxOverseas||room.settings.budget!==rules.purse||room.settings.timerSeconds!==rules.timerSeconds)problems.push(`${auctionModeLabels[room.settings.mode]} mode rules do not match the saved room settings.`);
 }
 return problems;
}
function requireStartValid(room:Room) {const problems=startProblems(room);requireRule(!problems.length,'START_BLOCKED',problems.join(' '));}
function complete(room:Room,now:number,reason:CompletionReason) {
 room.status=reason==='HOST_CLOSED'?'CLOSED':'COMPLETED';
 room.completion_reason=reason;
 delete room.recallRound;
 room.deadline=null;room.resultAt=null;room.pausedRemaining=0;room.pauseReason=undefined;
 event(room,now,'completed',completionMessages[reason]);
}
/** Follow the approved plan without reordering room.players (which snapshots expose). */
function plannedNext(room:Room) {
 const plan=room.plan!;
 const byId=new Map(room.players.map(player=>[player.id,player]));
 let position=(room.planPosition??-1)+1, nextIndex=-1;
 const remaining=[];
 for(;position<plan.orderedPlayerIds.length;position++) {
  const player=byId.get(plan.orderedPlayerIds[position]!);
  if(player?.status!=='upcoming')continue;
  if(nextIndex<0){nextIndex=room.players.indexOf(player);room.planPosition=position;}
  remaining.push(player);
 }
 return {nextIndex,remaining};
}
function approveRoomPlan(room:Room,now:number,userId:string) {
 const draft=room.planDraft;
 requireRule(draft,'PLAN_REQUIRED','Generate and review an auction plan before starting.');
 requireRule(!room.settings.mode||draft!.mode===room.settings.mode,'MODE_LOCKED',`This room uses the ${auctionModeLabels[room.settings.mode!]} auction mode. Generate a plan in that mode.`);
 const approved=approvePlan(room,catalog,draft!,now,userId);
 requireRule(approved.ok,'PLAN_INFEASIBLE',approved.blockedReason??'The selected auction mode cannot be used with this catalog.');
 room.players=approved.players!;room.plan=approved.plan!;room.planDraft=undefined;room.planPosition=-1;
 room.plan.recallEnabled=true;
 room.currentPlayerIndex=-1;room.currentBid=0;room.leadingTeamId=null;
 event(room,now,'plan_approved',`Host approved the ${auctionModeLabels[draft!.mode]} auction plan (${approved.plan!.orderedPlayerIds.length} players).`,userId);
}
function recallEligible(room:Room,player:Room['players'][number]) {
 return player.status==='unsold' && player.soldTo===undefined && player.soldPrice===undefined &&
  !room.teams.some(team=>team.squad.some(purchase=>purchase.playerId===player.id)) &&
  room.teams.some(team=>team.ownerId&&!room.blockedUserIds?.includes(team.ownerId)&&!purchaseRestriction(room,team,player,player.basePrice));
}
function openLot(room:Room,now:number,index:number) {
 room.currentPlayerIndex=index;room.currentBid=0;room.leadingTeamId=null;room.extensions=0;room.status='LIVE';room.deadline=now+room.settings.timerSeconds*1000;room.resultAt=null;room.players[index]!.status='open';event(room,now,'player_open',`${room.players[index]!.name} is open for bidding.`);
}
function openRecallNext(room:Room,now:number) {
 const round=room.recallRound;
 if(round?.status!=='active')return;
 while(++round.index<round.playerIds.length) {
  const index=room.players.findIndex(player=>player.id===round.playerIds[round.index]);
  if(index>=0&&recallEligible(room,room.players[index]!)){openLot(room,now,index);return;}
 }
 complete(room,now,'POOL_EXHAUSTED');
}
function openNext(room:Room,now:number) {
 if(room.recallRound?.status==='active'){openRecallNext(room,now);return;}
 const participating=room.teams.filter(team=>team.ownerId&&!room.blockedUserIds?.includes(team.ownerId));
 const planned=room.plan?plannedNext(room):null;
 const remaining=planned?planned.remaining:room.players.slice(room.currentPlayerIndex+1).filter(player=>player.status==='upcoming');
 const nextIndex=planned?planned.nextIndex:room.currentPlayerIndex+1;
 // Decide between lots so an accepted bid always settles before early completion.
 if(!remaining.length){complete(room,now,'POOL_EXHAUSTED');return;}
 if(participating.length>0&&participating.every(team=>team.squad.length>=room.settings.maxSquad)){complete(room,now,'SQUADS_FULL');return;}
 const cheapest=Math.min(...remaining.map(player=>player.basePrice));
 if(!participating.some(team=>team.squad.length<room.settings.maxSquad&&team.budget-cheapest>=bidReserve(room,team))){complete(room,now,'NO_AFFORDABLE_PLAYERS');return;}
 openLot(room,now,nextIndex);
}
export function settle(room:Room,now:number) { if(room.status!=='LIVE'||room.deadline===null||now<room.deadline)return; const player=room.players[room.currentPlayerIndex]!;if(player.status!=='open')return; if(room.leadingTeamId) {const team=room.teams.find(t=>t.id===room.leadingTeamId)!;team.budget-=room.currentBid;team.squad.push({playerId:player.id,price:room.currentBid});player.status='sold';player.soldTo=team.id;player.soldPrice=room.currentBid;event(room,now,'sold',`${player.name} sold to ${team.name} for ${money(room.currentBid)}.`);} else {player.status='unsold';event(room,now,'unsold',`${player.name} went unsold.`);}room.status='RESULT';room.deadline=null;room.resultAt=now+room.settings.resultSeconds*1000;
 if(room.plan?.recallEnabled&&!room.recallRound&&!room.players.some(player=>player.status==='upcoming')&&room.players.some(player=>recallEligible(room,player))) {
  room.recallRound={status:'offered'};
  room.resultAt=null;
 }
}
export function tick(room:Room,now:number) { settle(room,now); if(room.status==='RESULT'&&room.settings.autoAdvance&&room.resultAt!==null&&now>=room.resultAt)openNext(room,now); }
export function applyAction(original:Room,userId:string,action:Action,now:number):Room { const room=structuredClone(original);requireRule(!room.blockedUserIds?.includes(userId),'ROOM_BLOCKED','The host removed you from this room.');const member=room.members.find(m=>m.id===userId);requireRule(member,'NOT_MEMBER','You are not a member of this room.');const host=room.hostId===userId;const team=room.teams.find(t=>t.ownerId===userId);
 switch(action.type) {
 case 'update-settings': {
  requireRule(host,'HOST_ONLY','Only the host can edit room settings.');
  requireRule(room.status==='WAITING','SETTINGS_FROZEN','Room settings cannot change after the auction starts.');
  const errors=settingsErrors(action.settings);requireRule(!errors.length,'INVALID_SETTINGS',errors.join(' '));
  const next=normalizedSettings(action.settings);
  requireRule(next.mode===room.settings.mode,'MODE_LOCKED','The auction mode is fixed when the room is created.');
  requireRule(!room.teams.slice(next.teamCount).some(t=>t.ownerId),'TEAM_CLAIMED','A claimed team would be removed. Ask its owner to change teams first.');
  const before=room.settings;
  room.teams=teamNames.slice(0,next.teamCount).map((name,i)=>({id:'t'+(i+1),name,color:teamColors[i]!,ownerId:room.teams[i]?.ownerId??null,budget:next.budget,squad:[]}));
  room.settings=next;room.name=next.name;
  for(const participant of room.members)participant.ready=false;
  const changed=Object.keys(next).filter(key=>before[key as keyof Settings]!==next[key as keyof Settings]).join(', ');
  event(room,now,'settings_changed','Host updated room settings'+(changed?': '+changed:'')+'. Review the rules and mark ready again.');
  break;
 }
 case 'leave': {
  requireRule(!host,'HOST_CANNOT_LEAVE','The host must close the room instead of leaving.');
  requireRule(room.status==='WAITING','ALREADY_STARTED','You can only leave membership before the auction starts. Your team remains safe if you disconnect.');
  if(team)team.ownerId=null;
  room.members=room.members.filter(m=>m.id!==userId);
  event(room,now,'left',member!.name+' left the lobby.',userId);
  break;
 }
 case 'remove-member': {
  requireRule(host,'HOST_ONLY','Only the host can remove a participant.');
  requireRule(room.status!=='COMPLETED'&&room.status!=='CLOSED','ROOM_ENDED','This auction has ended.');
  requireRule(action.memberId!==room.hostId,'CANNOT_REMOVE_HOST','The host cannot be removed. Close the room to end it.');
  const target=room.members.find(m=>m.id===action.memberId);
  requireRule(target,'MEMBER_NOT_FOUND','That participant is no longer in this room.');
  requireRule(!room.blockedUserIds?.includes(action.memberId),'MEMBER_ALREADY_REMOVED','That participant has already been removed.');
  room.blockedUserIds=[...(room.blockedUserIds??[]),action.memberId];
  target!.connected=false;target!.ready=false;
  if(room.status==='WAITING')for(const candidate of room.teams)if(candidate.ownerId===action.memberId)candidate.ownerId=null;
  event(room,now,'member_removed','Host removed and blocked '+target!.name+'. Existing auction results are preserved.',target!.id);
  break;
 }

 case 'claim': {requireRule(room.status==='WAITING','ALREADY_STARTED','Teams can only be changed in the lobby.');const target=room.teams.find(t=>t.id===action.teamId);requireRule(target,'TEAM_NOT_FOUND','That team does not exist.');requireRule(!target!.ownerId||target!.ownerId===userId,'TEAM_TAKEN','Another participant already claimed this team.');if(team)team.ownerId=null;target!.ownerId=userId;member!.ready=false;event(room,now,'team_claimed',`${member!.name} claimed ${target!.name}.`,userId);break;}
 case 'ready':requireRule(room.status==='WAITING'&&team,'NOT_IN_LOBBY','Claim a team in the lobby first.');member!.ready=!member!.ready;event(room,now,'ready',`${member!.name} is ${member!.ready?'ready':'not ready'}.`,userId);break;
 case 'start':requireRule(host,'HOST_ONLY','Only the host can start the auction.');requireRule(room.status==='WAITING','INVALID_STATE','The auction has already started.');requireRule(room.teams.filter(t=>t.ownerId).length>=2,'NOT_ENOUGH_TEAMS','At least two teams must be claimed.');requireRule(member!.connected,'HOST_OFFLINE','The host must be connected.');if(room.planDraft&&!room.plan)approveRoomPlan(room,now,userId);requireStartValid(room);openNext(room,now);break;
 case 'plan-preview': {
  requireRule(host,'HOST_ONLY','Only the host can preview the auction plan.');
  requireRule(room.status==='WAITING','PLAN_LOCKED','The auction plan cannot change after the auction starts.');
  requireRule(!room.plan,'PLAN_LOCKED','The auction plan is already approved.');
  requireRule(!room.settings.mode||action.mode===room.settings.mode,'MODE_LOCKED',`This room uses the ${auctionModeLabels[room.settings.mode!]} auction mode.`);
  if(room.planDraft?.mode===action.mode&&room.planDraft.catalogVersion===catalog.catalogVersion)break;
  const seed=action.seed;requireRule(seed,'SERVER_SEED_REQUIRED','The server must generate the plan seed.');
  const planVersion=(room.planDraft?.planVersion??0)+1;
  room.planDraft={catalogVersion:catalog.catalogVersion,mode:action.mode,seed:seed!,planVersion};
  event(room,now,'plan_previewed',`Host generated a ${auctionModeLabels[action.mode]} auction plan preview.`,userId);
  break;
 }
 case 'plan-regenerate': {
  requireRule(host,'HOST_ONLY','Only the host can regenerate the auction plan.');
  requireRule(room.status==='WAITING','PLAN_LOCKED','The auction plan cannot change after the auction starts.');
  requireRule(!room.plan,'PLAN_LOCKED','The auction plan is already approved.');
  requireRule(!room.settings.mode||action.mode===room.settings.mode,'MODE_LOCKED',`This room uses the ${auctionModeLabels[room.settings.mode!]} auction mode.`);
  const seed=action.seed;requireRule(seed,'SERVER_SEED_REQUIRED','The server must generate the plan seed.');
  const planVersion=(room.planDraft?.planVersion??0)+1;
  room.planDraft={catalogVersion:catalog.catalogVersion,mode:action.mode,seed:seed!,planVersion};
  event(room,now,'plan_regenerated',`Host regenerated the ${auctionModeLabels[action.mode]} auction plan preview.`,userId);
  break;
 }
 case 'plan-approve': {
  requireRule(host,'HOST_ONLY','Only the host can approve the auction plan.');
  requireRule(room.status==='WAITING','PLAN_LOCKED','The auction plan cannot change after the auction starts.');
  const draft=room.planDraft;requireRule(draft,'PLAN_REQUIRED','Generate and review an auction plan before starting.');
  requireRule(action.planVersion===draft!.planVersion,'STALE_PLAN','The plan preview changed. Review the latest preview.');
  requireRule(room.teams.filter(t=>t.ownerId).length>=2,'NOT_ENOUGH_TEAMS','At least two teams must be claimed.');
  requireRule(member!.connected,'HOST_OFFLINE','The host must be connected.');
  approveRoomPlan(room,now,userId);requireStartValid(room);openNext(room,now);break;
 }
 case 'bid': {requireRule(room.recallRound?.status!=='active'||action.expectedVersion!==undefined,'VERSION_REQUIRED','Refresh the auction before bidding in a recall lot.');requireRule(room.status==='LIVE','NOT_LIVE','Bidding is not live.');requireRule(room.deadline!==null&&now<room.deadline,'TOO_LATE','The deadline has passed. Wait for the confirmed result.');const player=room.players[room.currentPlayerIndex]!;requireRule(player.id===action.playerId&&player.status==='open','STALE_PLAYER','The player has changed. Review the latest state.');requireRule(team,'NO_TEAM','Claim a team before bidding.');requireRule(room.leadingTeamId!==team!.id,'ALREADY_LEADING','Your team is already leading.');requireRule(action.amount===nextBid(room),'BID_CHANGED','Another bid was accepted first or the amount is invalid. Review the next bid.');const restriction=purchaseRestriction(room,team!,player,action.amount);if(restriction)throw new RuleError(restriction.code,restriction.message);room.currentBid=action.amount;room.leadingTeamId=team!.id;if(room.settings.lateExtension&&room.deadline!-now<=5000&&room.extensions<5){room.deadline=now+10000;room.extensions++;event(room,now,'timer_extended','Late bid accepted. Timer extended to 10 seconds.');}event(room,now,'bid',`${team!.name} bid ${money(action.amount)}.`);break;}
 case 'pause':requireRule(host,'HOST_ONLY','Only the host can pause.');requireRule(room.status==='LIVE','INVALID_STATE','Only a live lot can be paused.');requireRule(room.deadline!==null&&now<room.deadline,'TOO_LATE','This lot has ended.');room.pausedRemaining=room.deadline!-now;room.deadline=null;room.status='PAUSED';room.pauseReason='Host paused the auction';event(room,now,'paused',room.pauseReason);break;
 case 'resume':requireRule(host,'HOST_ONLY','Only the host can resume.');requireRule(member!.connected,'HOST_OFFLINE','Reconnect before resuming the auction.');requireRule(room.status==='PAUSED','INVALID_STATE','The auction is not paused.');room.status='LIVE';room.deadline=now+room.pausedRemaining;room.pauseReason=undefined;event(room,now,'resumed','Host resumed the auction.');break;
 case 'start-recall': {
  requireRule(host,'HOST_ONLY','Only the host can start the recall round.');
  requireRule(member!.connected,'HOST_OFFLINE','Reconnect before starting the recall round.');
  requireRule(room.status==='RESULT'&&room.recallRound?.status==='offered'&&room.plan?.recallEnabled,'RECALL_UNAVAILABLE','Recall is available once, after the initial order finishes.');
  const eligible=new Set(room.players.filter(player=>recallEligible(room,player)).map(player=>player.id));
  const playerIds=room.plan!.orderedPlayerIds.filter(id=>eligible.has(id));
  requireRule(playerIds.length,'RECALL_UNAVAILABLE','No unsold players can be recalled under the current rules.');
  room.recallRound={status:'active',playerIds,index:-1};
  event(room,now,'recall_started',`Host started a recall round with ${playerIds.length} eligible unsold players.`,userId);
  openRecallNext(room,now);
  break;
 }
 case 'next':requireRule(host,'HOST_ONLY','Only the host can advance.');requireRule(member!.connected,'HOST_OFFLINE','Reconnect before opening the next player.');requireRule(room.status==='RESULT','INVALID_STATE','Finish the current player before advancing.');openNext(room,now);break;
 case 'end':requireRule(host,'HOST_ONLY','Only the host can end the auction.');requireRule(room.status!=='COMPLETED'&&room.status!=='CLOSED','INVALID_STATE','The auction has already ended.');if(room.status==='LIVE'||room.status==='PAUSED'){room.status='LIVE';room.deadline=now;settle(room,now);}complete(room,now,room.currentPlayerIndex<0?'HOST_CLOSED':'HOST_ENDED');break;
 }
 return room;
}
