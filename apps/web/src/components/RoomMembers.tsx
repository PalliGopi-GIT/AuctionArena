import type { Room, User } from '../../../../packages/shared/src/domain';

interface Props {
  room: Room;
  user: User;
  disabled: boolean;
  onEdit: () => void;
  onLeave: () => void;
  onClose: () => void;
  onRemove: (user: User) => void;
}

export function RoomMembers({ room, user, disabled, onEdit, onLeave, onClose, onRemove }: Props) {
  const host = room.hostId === user.id;
  const ended = room.status === 'COMPLETED' || room.status === 'CLOSED';
  const blocked = new Set(room.blockedUserIds ?? []);
  const members = room.members.filter(member => !blocked.has(member.id));
  return <section className="panel room-members" aria-labelledby="members-title">
    <div className="panel-heading">
      <div><span className="eyebrow">YOUR AUCTION CIRCLE</span><h2 id="members-title">In the room <span className="muted">{members.length}</span></h2></div>
      <span className="tag">{members.filter(member => member.connected).length} CONNECTED</span>
    </div>
    <ul className="member-list">
      {members.map(member => {
        const team = room.teams.find(item => item.ownerId === member.id);
        return <li key={member.id}>
          <span className="member-avatar" aria-hidden="true" style={{ borderColor: team?.color }}>{member.name.slice(0, 1).toUpperCase()}</span>
          <div className="member-detail"><strong>{member.name}{member.id === user.id ? ' (you)' : ''}</strong><small>{team?.name ?? (room.status === 'WAITING' ? 'Choosing a team' : 'Spectator')}{member.id === room.hostId ? ' · Host' : ''}</small></div>
          <span className="member-presence">{member.connected ? (room.status === 'WAITING' && member.ready ? 'Ready' : 'Connected') : 'Disconnected'}</span>
          {host && member.id !== user.id && !ended && <button className="text-button" disabled={disabled} onClick={() => onRemove(member)} aria-label={`Remove and block ${member.name}`}>Remove</button>}
        </li>;
      })}
    </ul>
    {room.status === 'WAITING' && <div className="member-actions">
      {host ? <><button className="button secondary" disabled={disabled} onClick={onEdit}>Edit room rules</button><button className="text-button" disabled={disabled} onClick={onClose}>Close room</button></> : <button className="text-button" disabled={disabled} onClick={onLeave}>Leave lobby</button>}
      <p className="fine-print">Rules and teams are locked when bidding begins. Ready indicators help the host plan; two claimed teams are required to start.</p>
    </div>}
    {blocked.size > 0 && <p className="fine-print">{blocked.size} participant{blocked.size === 1 ? '' : 's'} removed. Earlier auction activity remains on record.</p>}
  </section>;
}
