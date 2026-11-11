import type { Settings } from './index';

export interface User { id: string; name: string }
export interface Member extends User { connected: boolean; ready: boolean; lastSeen: number }
export interface Player { id: string; name: string; country: string; role: 'Batter' | 'Bowler' | 'All-rounder' | 'Wicketkeeper'; basePrice: number; overseas: boolean; isSample: true; battingStyle: string; bowlingStyle: string; stats: {matches:number;runs:number;wickets:number;strikeRate:number}; status: 'upcoming'|'open'|'sold'|'unsold'; soldTo?:string; soldPrice?:number }
export interface Team { id: string; name: string; color: string; ownerId: string | null; budget: number; squad: {playerId:string;price:number}[] }
export interface AuctionEvent { id: string; version: number; at: number; type: string; text: string; actorId?:string }
export const completionReasons = ['POOL_EXHAUSTED', 'SQUADS_FULL', 'NO_AFFORDABLE_PLAYERS', 'HOST_ENDED', 'HOST_CLOSED'] as const;
export type CompletionReason = typeof completionReasons[number];
export const completionMessages: Record<CompletionReason, string> = {
  POOL_EXHAUSTED: 'Every player in the pool has been auctioned.',
  SQUADS_FULL: 'Every participating team has filled its squad.',
  NO_AFFORDABLE_PLAYERS: 'No participating team with squad space can afford a remaining player while keeping its minimum squad reserve.',
  HOST_ENDED: 'The host ended the auction. All accepted bids were settled.',
  HOST_CLOSED: 'The host closed the room before bidding started.',
};
export interface Room { code:string; name:string; hostId:string; status:'WAITING'|'LIVE'|'PAUSED'|'RESULT'|'COMPLETED'|'CLOSED'; settings:Settings; members:Member[]; teams:Team[]; players:Player[]; currentPlayerIndex:number; currentBid:number; leadingTeamId:string|null; deadline:number|null; pausedRemaining:number; resultAt:number|null; extensions:number; version:number; history:AuctionEvent[]; createdAt:number; pauseReason?:string; blockedUserIds?:string[]; completion_reason?:CompletionReason }
export const money = (lakhs:number) => lakhs >= 100 ? `₹${(lakhs/100).toFixed(2)} Cr` : `₹${lakhs} L`;
export function nextBid(room: Room) { return room.currentBid ? room.currentBid + room.settings.bidIncrement : room.players[room.currentPlayerIndex]?.basePrice ?? 0; }
export const teamNames = ['Mumbai Meteors','Chennai Cyclones','Bengaluru Blaze','Delhi Dragons','Kolkata Comets','Punjab Phoenix','Jaipur Jaguars','Hyderabad Hawks'];
export const teamColors = ['#45b7ff','#f5c451','#b594ff','#fb7185','#6ed8bc','#ff9257','#e5a0dc','#a3d35e'];
export function samplePlayers():Player[] { const names=['Arjun Rathore','Kabir Mehta','Liam Fletcher','Dev Malhotra','Ishaan Sethi','Noah Brooks','Rohan Desai','Vihaan Kapoor','Ethan Walsh','Aditya Nair','Zayn Siddiqui','Oliver Hayes','Aarav Menon','Dhruv Shah','Theo Bennett','Reyansh Rao','Samar Khanna','Finn Clarke','Yash Bhatia','Neel Joshi','Oscar Reed','Kunal Verma','Rishi Anand','Leo Morgan']; return names.map((name,i)=>({id:`p${i+1}`,name,country:i%3===2?'Australia':'India',role:(['Batter','Bowler','All-rounder','Wicketkeeper'] as const)[i%4]!,basePrice:[100,50,75,25][i%4]!,overseas:i%3===2,isSample:true,battingStyle:i%2?'Left-hand bat':'Right-hand bat',bowlingStyle:i%2?'Right-arm pace':'Off spin',stats:{matches:30+i*3,runs:240+i*93,wickets:8+i*2,strikeRate:125+i},status:'upcoming'})); }
