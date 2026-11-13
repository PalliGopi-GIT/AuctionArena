import type { Room } from '../../shared/src/domain';
import { completionReasons, validBidOnLadder } from '../../shared/src/domain';
import { bidReserve } from '../../shared/src/bid-rules';

export function validateRoomRecovery(room: Room) {
 const invariant=(condition:boolean,message:string)=>{if(!condition)throw new Error(message+' invariant failed; refusing to start.');};
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
