import { useEffect, useRef, useState } from 'react';
import type { Room } from '../../../../packages/shared/src/domain';
import { createAuctionAnnouncer } from '../auction-announcements';
import { useDisplayTime } from './AuctionClock';

export function AuctionAnnouncements({ room, connected, offset }: { room: Room | null; connected: boolean; offset: number }) {
  const serverNow = useDisplayTime(offset, room?.status === 'LIVE');
  const [polite, setPolite] = useState(''), [urgent, setUrgent] = useState('');
  const announcer = useRef<ReturnType<typeof createAuctionAnnouncer> | null>(null);
  useEffect(() => {
    const instance = createAuctionAnnouncer((lane, text) => (lane === 'polite' ? setPolite : setUrgent)(text));
    announcer.current = instance;
    return () => { instance.dispose(); announcer.current = null; };
  }, []);
  useEffect(() => { announcer.current?.update(room, connected, serverNow); }, [room, connected, serverNow]);
  return <div className="sr-only">
    <p role="status" aria-live="polite" aria-atomic="true" aria-label="Auction updates">{polite}</p>
    <p aria-live="assertive" aria-atomic="true" data-auction-alerts="true">{urgent}</p>
  </div>;
}
