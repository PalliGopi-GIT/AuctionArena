import { Zap } from 'lucide-react';
import { money, nextBid, type Room } from '../../../../packages/shared/src/domain';
import { bidRestriction } from '../../../../packages/shared/src/bid-rules';

interface Props {
  room: Room;
  userId: string | undefined;
  connected: boolean;
  serverNow: number;
  busy: boolean;
  onBid: () => void;
}

export function BidControl({ room, userId, connected, serverNow, busy, onBid }: Props) {
  const restriction = busy ? { code: 'PENDING', message: 'Confirming your request. Please wait.' }
    : !connected ? { code: 'OFFLINE', message: 'Reconnecting to the room. Bidding is disabled until the server confirms the latest state.' }
    : bidRestriction(room, userId, serverNow);
  const mine = room.teams.find(team => team.ownerId === userId);
  const leading = !!mine && mine.id === room.leadingTeamId;
  return <>
    <button type="button" className="button" disabled={!!restriction} aria-describedby="bid-reason" onClick={onBid}>
      {busy ? 'Confirming…' : leading ? 'You’re leading' : `Bid ${money(nextBid(room))}`} <Zap size={20} aria-hidden="true" />
    </button>
    <p id="bid-reason" className="fine-print">{restriction?.message ?? (room.settings.lateExtension
      ? 'Bids in the final 5 seconds reset the timer to 10 seconds, up to 5 times.'
      : 'The server confirms every bid before it appears.')}</p>
  </>;
}
