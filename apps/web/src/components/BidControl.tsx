import { Zap } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { money, nextBid, type Room } from '../../../../packages/shared/src/domain';
import { BID_SAFETY_MARGIN_MS, bidRestriction, createBidDeadlineGuard } from '../../../../packages/shared/src/bid-rules';

interface Props {
  room: Room;
  userId: string | undefined;
  connected: boolean;
  serverOffset: number;
  busy: boolean;
  onBid: () => Promise<boolean>;
}

export function BidControl({ room, userId, connected, serverOffset, busy, onBid }: Props) {
  const submitting = useRef(false);
  const [, setDeadlineTick] = useState(0);
  const serverNow = Date.now() + serverOffset;
  useEffect(() => {
    if (room.status !== 'LIVE' || room.deadline === null) return;
    const delay = room.deadline - BID_SAFETY_MARGIN_MS - (Date.now() + serverOffset);
    if (delay <= 0) return;
    const timer = setTimeout(() => setDeadlineTick(value => value + 1), Math.ceil(delay));
    return () => clearTimeout(timer);
  }, [room.status, room.deadline, room.currentPlayerIndex, serverOffset]);
  const deadlineGuard = useRef<ReturnType<typeof createBidDeadlineGuard> | null>(null);
  if (!deadlineGuard.current) deadlineGuard.current = createBidDeadlineGuard();
  const deadlineLocked = deadlineGuard.current(room, serverNow);
  const restriction = busy ? { code: 'PENDING', message: 'Confirming your request. Please wait.' }
    : !connected ? { code: 'OFFLINE', message: 'Reconnecting to the room. Bidding is disabled until the server confirms the latest state.' }
    : bidRestriction(room, userId, serverNow) ?? (deadlineLocked ? { code: 'TOO_LATE', message: 'Bidding is closing. Wait for the confirmed result.' } : null);
  const mine = room.teams.find(team => team.ownerId === userId);
  const leading = !!mine && mine.id === room.leadingTeamId;
  return <>
    <button type="button" className="button bid-action" disabled={!!restriction} aria-describedby="bid-reason" onClick={async () => {
      const currentTime = Date.now() + serverOffset;
      if (submitting.current || busy || !connected || deadlineGuard.current!(room, currentTime) || bidRestriction(room, userId, currentTime)) return;
      submitting.current = true;
      try { await onBid(); } finally { submitting.current = false; }
    }}>
      {busy ? 'Confirming…' : leading ? 'You’re leading' : `Bid ${money(nextBid(room))}`} <Zap size={20} aria-hidden="true" />
    </button>
    <p id="bid-reason" className="fine-print">{restriction?.message ?? (room.settings.lateExtension
      ? 'Bids in the final 5 seconds reset the timer to 10 seconds, up to 5 times.'
      : 'The server confirms every bid before it appears.')}</p>
  </>;
}
