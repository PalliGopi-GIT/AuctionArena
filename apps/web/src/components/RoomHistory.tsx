import { useEffect, useRef, useState } from 'react';
import type { Room } from '../../../../packages/shared/src/domain';
import type { HistoryPage } from '../../../../packages/shared/src/room-sync';

/** One bounded page at a time; room/identity changes unmount and discard pending responses. */
export function RoomHistory({ room, request, revision }: {
  room: Room;
  request: (path: string) => Promise<HistoryPage>;
  revision: number;
}) {
  const [page,setPage]=useState<HistoryPage>({events:room.history.slice().reverse(),nextBefore:null,truncated:!!room.historyTruncated});
  const [before,setBefore]=useState<number>();
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const requester=useRef(request);requester.current=request;
  useEffect(()=>{
    let active=true;setBusy(true);setError('');
    requester.current(`/rooms/${room.code}/history${before===undefined?'':`?before=${before}`}`).then(value=>{if(active)setPage(value);}).catch(reason=>{if(active)setError(reason instanceof Error?reason.message:'History unavailable.');}).finally(()=>{if(active)setBusy(false);});
    return()=>{active=false;};
  },[room.code,room.version,before,revision]);
  return <section className="panel history"><h2>Every move, on record.</h2>
    {page.truncated&&<p className="fine-print">Recent history is retained. Older activity has expired; accepted sales remain in results.</p>}
    {error&&<p role="alert">{error}</p>}
    {page.events.map(event=><div key={event.id}><span>{new Date(event.at).toLocaleTimeString()}</span><p>{event.text}</p><small>#{event.version}</small></div>)}
    <button type="button" className="button secondary" disabled={busy||page.nextBefore===null} onClick={()=>setBefore(page.nextBefore!)}>Older activity</button>
    {before!==undefined&&<button type="button" className="text-button" disabled={busy} onClick={()=>setBefore(undefined)}>Latest activity</button>}
  </section>;
}
