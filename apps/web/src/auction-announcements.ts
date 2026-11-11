import type { Room } from '../../../packages/shared/src/domain';

type Lane = 'polite' | 'urgent';
/** Architecture 10.1: coalesce shared updates; never read the ticking clock every second. */
export function createAuctionAnnouncer(publish: (lane: Lane, text: string) => void, clock = Date.now) {
  let roomCode = '', previousStatus = '', previousPlayer = '', previousConnected = false, description = '';
  let timerKey = '', announced = new Set<number>();
  let politeTimer: ReturnType<typeof setTimeout> | undefined, urgentTimer: ReturnType<typeof setTimeout> | undefined;
  let polite = '', urgent = '', urgentKind = '', lastUrgentKind = '', lastUrgentAt = -Infinity;
  const clearPolite = () => { clearTimeout(politeTimer); politeTimer = undefined; polite = ''; };
  const clearUrgent = () => { clearTimeout(urgentTimer); urgentTimer = undefined; urgent = ''; urgentKind = ''; };
  const reset = () => {
    clearPolite(); clearUrgent(); roomCode = ''; previousStatus = ''; previousPlayer = ''; previousConnected = false;
    description = ''; timerKey = ''; announced.clear(); lastUrgentKind = '';
    publish('polite', ''); publish('urgent', '');
  };
  const queue = (lane: Lane, text: string, kind = '') => {
    if (lane === 'polite') {
      polite = text;
      if (!politeTimer) politeTimer = setTimeout(() => { politeTimer = undefined; publish('polite', polite); polite = ''; }, 1000);
    } else {
      urgent = text; urgentKind = kind;
      if (!urgentTimer) urgentTimer = setTimeout(() => { urgentTimer = undefined; lastUrgentAt = clock(); lastUrgentKind = urgentKind; publish('urgent', urgent); urgent = ''; urgentKind = ''; }, Math.max(1000, 2000 - (clock() - lastUrgentAt)));
    }
  };
  return {
    update(room: Room | null, connected: boolean, serverNow: number) {
      if (!room) { if (roomCode) reset(); return; }
      if (room.code !== roomCode) { reset(); roomCode = room.code; }
      const player = room.players[room.currentPlayerIndex], lead = room.teams.find(team => team.id === room.leadingTeamId);
      if (!connected) {
        clearPolite();
        if (previousConnected) queue('urgent', 'Connection lost. Bidding is disabled while reconnecting.', 'connection');
      } else {
        if (urgentKind === 'connection') { clearUrgent(); publish('urgent', ''); }
        if ((!previousConnected && lastUrgentKind === 'connection') || (room.status !== 'PAUSED' && lastUrgentKind === 'pause')) {
          publish('urgent', ''); lastUrgentKind = '';
        }
        if (room.status === 'PAUSED' && (previousStatus !== 'PAUSED' || !previousConnected)) {
          clearPolite(); queue('urgent', `Auction paused. ${room.pauseReason || 'Wait for the host to resume.'}`, 'pause');
        } else if (room.status !== 'PAUSED' && urgentKind === 'pause') clearUrgent();
        if (player && ['sold', 'unsold'].includes(player.status) &&
            (room.status === 'RESULT' || previousStatus && previousStatus !== room.status) &&
            (previousStatus !== room.status || previousPlayer !== player.id)) {
          queue('urgent', player.status === 'sold'
            ? `Sold. ${player.name} to ${room.teams.find(team => team.id === player.soldTo)?.name || 'the winning team'} for ${player.soldPrice} lakh.`
            : `Unsold. No accepted bid for ${player.name}.`, 'result');
        }
        let next = '';
        if (room.status === 'WAITING') next = `Lobby. ${room.teams.filter(team => team.ownerId).length} of ${room.teams.length} teams claimed. ${room.members.filter(member => member.ready).length} participants ready.`;
        if (room.status === 'LIVE' && player) next = lead
          ? `Leading: ${lead.name} at ${room.currentBid} lakh for ${player.name}.`
          : `Bidding open for ${player.name}. Base price ${player.basePrice} lakh.`;
        if (room.status === 'COMPLETED' || room.status === 'CLOSED') next = room.status === 'CLOSED'
          ? 'Room closed before bidding started.' : `Auction complete. ${room.players.filter(item => item.status === 'sold').length} players signed. Results are available.`;
        let warning = '';
        const key = `${room.code}:${player?.id}:${room.deadline}`;
        if (key !== timerKey) { timerKey = key; announced = new Set(); }
        if (room.status === 'LIVE' && room.deadline !== null) {
          const remaining = Math.max(0, Math.ceil((room.deadline - serverNow) / 1000));
          for (const threshold of [10, 5]) if (remaining > 0 && remaining <= threshold && !announced.has(threshold)) {
            announced.add(threshold); warning = ` ${remaining} seconds remaining.`;
          }
        }
        if (next && (next !== description || warning || !previousConnected)) queue('polite', next + warning);
        description = next;
      }
      previousStatus = room.status; previousPlayer = player?.id || ''; previousConnected = connected;
    },
    dispose() { clearPolite(); clearUrgent(); },
  };
}
