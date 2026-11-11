import { test } from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { connectRoom, isCurrentSnapshot } from '../../apps/web/src/room-connection.ts';

const snapshot=(code='ABC',version=1,serverNow=100)=>({room:{code,version},serverNow});
class FakeSocket {
 readyState=1;
 sent=[];
 close(code=1000){this.readyState=3;this.onclose?.({code});}
 send(data){this.sent.push(data);}
 message(value){this.onmessage?.({data:JSON.stringify(value)});}
}
async function until(predicate){for(let i=0;i<100&&!predicate();i++)await delay(5);assert.ok(predicate(),'condition must be reached');}

test('snapshot guard rejects other rooms, older versions, and older equal-version responses',()=>{
 const current=snapshot('ABC',4,400);
 assert.equal(isCurrentSnapshot(current,snapshot('OTHER',9,900),'ABC'),false);
 assert.equal(isCurrentSnapshot(current,snapshot('ABC',3,500),'ABC'),false);
 assert.equal(isCurrentSnapshot(current,snapshot('ABC',4,300),'ABC'),false);
 assert.equal(isCurrentSnapshot(current,snapshot('ABC',5,500),'ABC'),true);
 assert.equal(isCurrentSnapshot(current,snapshot('ABC',4,500),'ABC'),true);
});
test('dropped socket gets a fresh ticket and resumes delivery',async()=>{
 const sockets=[],tickets=[],received=[],states=[];
 const stop=connectRoom({code:'ABC',retryMs:5,pollMs:1000,request:async path=>path.endsWith('ws-ticket')?{ticket:`ticket-${tickets.length}`} : snapshot(),socket:ticket=>{tickets.push(ticket);const s=new FakeSocket();sockets.push(s);return s;},snapshot:d=>received.push(d),connection:s=>states.push(s)});
 try {await until(()=>sockets.length===1);sockets[0].close();await until(()=>sockets.length===2);assert.notEqual(tickets[0],tickets[1]);sockets[1].message(snapshot('ABC',2,200));assert.equal(received.at(-1).room.version,2);assert.ok(states.includes(false));}
 finally {stop();}
});
test('dispose ignores an in-flight old-room poll and ticket',async()=>{
 let resolvePoll,resolveTicket;const received=[],sockets=[];
 const stop=connectRoom({code:'ABC',request:path=>new Promise(resolve=>{if(path.endsWith('ws-ticket'))resolveTicket=resolve;else resolvePoll=resolve;}),socket:()=>{sockets.push(1);return new FakeSocket();},snapshot:d=>received.push(d),connection:()=>{}});
 stop();resolvePoll(snapshot());resolveTicket({ticket:'late'});await delay(10);assert.equal(received.length,0);assert.equal(sockets.length,0);
});
test('poll fallback remains live and does not overlap slow requests',async()=>{
 let pollCount=0,resolvePoll;const received=[];
 const stop=connectRoom({code:'ABC',pollMs:5,retryMs:1000,request:path=>{if(path.endsWith('ws-ticket'))return Promise.reject(new Error('offline'));pollCount++;return new Promise(resolve=>{resolvePoll=resolve;});},socket:()=>new FakeSocket(),snapshot:d=>received.push(d),connection:()=>{}});
 try {await delay(25);assert.equal(pollCount,1);resolvePoll(snapshot());await until(()=>pollCount===2);assert.equal(received.length,1);}
 finally {stop();resolvePoll(snapshot());}
});
test('wrong-room socket message is ignored and retry stops on disposal',async()=>{
 const sockets=[],received=[];
 const stop=connectRoom({code:'ABC',retryMs:30,pollMs:1000,request:async path=>path.endsWith('ws-ticket')?{ticket:'t'}:snapshot(),socket:()=>{const s=new FakeSocket();sockets.push(s);return s;},snapshot:d=>received.push(d),connection:()=>{}});
 await until(()=>sockets.length===1);const before=received.length;sockets[0].message(snapshot('OTHER'));assert.equal(received.length,before);sockets[0].close();stop();await delay(50);assert.equal(sockets.length,1);
});
