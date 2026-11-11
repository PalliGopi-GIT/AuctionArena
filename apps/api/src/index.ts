import { serve } from '@hono/node-server';
import { WebSocketServer } from 'ws';
import { resolve } from 'node:path';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { createApp } from './app';
import { attachRoomSocket } from './room-socket';
import { LocalRoomStore } from '../../realtime/src/store';

if(process.env.NODE_ENV==='production')throw new Error('Local file adapter cannot run in production. Configure the AWS adapters before deployment.');
const dataFile=resolve(process.env.DATA_FILE??'.data/auctionarena.json');
const lockFile=`${dataFile}.lock`;
mkdirSync(dirname(dataFile),{recursive:true});
if(existsSync(lockFile)){const pid=Number(readFileSync(lockFile,'utf8'));let active=true;try{process.kill(pid,0);}catch(error){if((error as NodeJS.ErrnoException).code==='ESRCH')active=false;}if(active)throw new Error('Another process owns the local database. Stop it before starting another API.');unlinkSync(lockFile);}
const lock=openSync(lockFile,'wx');writeFileSync(lock,String(process.pid));closeSync(lock);
process.on('exit',()=>{try{unlinkSync(lockFile);}catch{/* already removed */}});
const store=new LocalRoomStore(dataFile);
const {app,consumeTicket,processAccounts}=createApp(store,{localDevAuth:process.env.LOCAL_DEV_AUTH==='true',clerkSecret:process.env.CLERK_SECRET_KEY,clerkJwtKey:process.env.CLERK_JWT_KEY,clerkIssuer:process.env.CLERK_ISSUER,clerkWebhookSecret:process.env.CLERK_WEBHOOK_SIGNING_SECRET,clerkInstanceId:process.env.CLERK_INSTANCE_ID,allowedOrigins:(process.env.ALLOWED_ORIGINS??'http://localhost:5173,http://127.0.0.1:5173').split(',')});
const server=serve({fetch:app.fetch,port:Number(process.env.API_PORT??3001),hostname:'127.0.0.1'});
const wss=new WebSocketServer({noServer:true,maxPayload:4096});
server.on('upgrade',(req,socket,head)=>{const url=new URL(req.url??'/', 'http://localhost');const protocol=req.headers['sec-websocket-protocol']?.split(',').map((s:string)=>s.trim()).find((s:string)=>s.startsWith('ticket.'));const ticket=consumeTicket(protocol?.slice(7)??'');if(url.pathname!=='/ws'||!ticket){socket.destroy();return;}wss.handleUpgrade(req,socket,head,ws=>attachRoomSocket(store,ticket.code,ticket.user,ws));});
const timer=setInterval(()=>{try{store.sweep();}catch(e){console.error('Persistence unavailable; no state broadcast',e);}},250);
const accountTimer=setInterval(()=>{void processAccounts().catch(()=>console.error('Account cleanup unavailable; durable jobs remain pending.'));},1000);
process.on('SIGINT',()=>{clearInterval(timer);clearInterval(accountTimer);wss.close();server.close();process.exit(0);});
console.log('AuctionArena local API listening on http://127.0.0.1:'+String(process.env.API_PORT??3001));
