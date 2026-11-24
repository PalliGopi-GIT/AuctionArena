import { useState } from 'react';

interface PlayerArtwork {
  id: string;
  name: string;
  role: string;
  image?: string | null;
  imageStatus?: string;
}

function PlayerPhoto({ src, eager }: { src: string; eager: boolean }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  return failed ? null : <img src={src} alt="" className={loaded ? 'player-photo loaded' : 'player-photo'}
    loading={eager ? 'eager' : 'lazy'} decoding={eager ? 'auto' : 'async'}
    onLoad={() => setLoaded(true)} onError={() => setFailed(true)} />;
}

export function PlayerIcon({ p, eager = false, compact = false }: { p: PlayerArtwork; eager?: boolean; compact?: boolean }) {
  const photo = p.imageStatus === 'bundled' ? p.image : null;
  return <div className={`player-art role-${p.role.toLowerCase()}${compact ? ' player-art-compact' : ''}`} aria-hidden="true">
    <div className="art-ring"/>
    <span className="player-number">{p.id.slice(1).padStart(2, '0')}</span>
    <div className="player-head"/><div className="player-body"/><div className="bat"/>
    <span className="art-initials">{p.name.split(' ').map(part => part[0]).join('')}</span>
    {photo && <PlayerPhoto key={p.id + photo} src={photo} eager={eager}/>}
  </div>;
}
