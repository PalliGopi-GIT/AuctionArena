import { useEffect, useState } from 'react';
import type { Room } from '../../../../packages/shared/src/domain';

// Only the countdown and its existing announcement region need clock updates.
export function useDisplayTime(offset: number, running: boolean) {
  const [, refresh] = useState(0);
  useEffect(() => {
    if (!running) return;
    const timer = window.setInterval(() => refresh(tick => tick + 1), 200);
    return () => window.clearInterval(timer);
  }, [running]);
  return Date.now() + offset;
}

export function AuctionClock({ room, offset }: { room: Room; offset: number }) {
  const now = useDisplayTime(offset, room.status === 'LIVE');
  const paused = room.status === 'PAUSED';
  const result = room.status === 'RESULT';
  const remaining = Math.max(0, Math.ceil((paused ? room.pausedRemaining : (room.deadline ?? now) - now) / 1000));
  return <div className={'countdown' + (room.status === 'LIVE' && remaining < 6 ? ' urgent' : '')}>
    <span>{result ? 'Lot result' : paused ? 'Timer paused' : 'Seconds remaining'}</span>
    <b>{result ? room.players[room.currentPlayerIndex]?.status : String(remaining).padStart(2, '0')}</b>
  </div>;
}
