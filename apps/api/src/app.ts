import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import { verifyWebhook } from '@clerk/backend/webhooks';
import { allowedOrigins, verifyClerkIdentity } from './clerk-auth';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import { actionSchema, settingsSchema, type User } from '../../../packages/shared/src/index';
import { RuleError } from '../../../packages/engine/src/index';
import { LocalRoomStore } from '../../realtime/src/store';
import { ClerkProfiles, clerkProfileLookup, type ClerkProfileLookup } from './clerk-profiles';
import { Accounts, clerkUserDeletion, type DeleteClerkUser } from './accounts';

export interface AppOptions {
  localDevAuth:boolean; clerkSecret?:string; clerkJwtKey?:string; clerkIssuer?:string;
  allowedOrigins?:string[]; clerkProfileLookup?:ClerkProfileLookup;
  clerkWebhookSecret?:string; clerkInstanceId?:string; deleteClerkUser?:DeleteClerkUser;
}
export function createApp(store:LocalRoomStore,options:AppOptions) {
  const origins=allowedOrigins(options.allowedOrigins);
  const profiles=new ClerkProfiles(store,options.clerkProfileLookup??clerkProfileLookup(options.clerkSecret));
  const remover=options.deleteClerkUser??clerkUserDeletion(options.clerkSecret);
  const accounts=new Accounts(store,remover);
  const app=new Hono<{Variables:{user:User;localIdentity:boolean;firstFactorAge:number|undefined}}>();
  const tickets=new Map<string,{user:User;code:string;expires:number}>();
  const limits=new Map<string,{at:number;count:number}>();
  app.use('/api/*',cors({origin:origins}));
  app.use('/api/*',(c,next)=>bodyLimit({maxSize:c.req.path==='/api/webhooks/clerk'?65536:4096,
    onError:c=>c.json({code:'PAYLOAD_TOO_LARGE',message:'Request body exceeds the allowed size.',requestId:randomBytes(8).toString('hex')},413)})(c,next));
  app.onError((error,c)=>{
    const requestId=randomBytes(8).toString('hex');
    if(error instanceof RuleError)return c.json({code:error.code,message:error.message,requestId},['FORBIDDEN','ROOM_BLOCKED','HOST_ONLY'].includes(error.code)?403:400);
    if(error instanceof z.ZodError)return c.json({code:'INVALID_INPUT',message:error.issues.map(i=>i.message).join('; '),requestId},400);
    console.error('Request failed',requestId,error.message);
    return c.json({code:'SERVICE_ERROR',message:'The service could not confirm this action. Please reconnect.',requestId},500);
  });
  app.get('/api/health',c=>c.json({ok:true,mode:'single-process-local',maxMembers:20}));
  app.get('/api/config',c=>c.json({localDevAuth:options.localDevAuth,clerkConfigured:!!(options.clerkSecret||options.clerkJwtKey)}));
  app.post('/api/webhooks/clerk',async c=>{
    if(!options.clerkWebhookSecret)return c.json({code:'WEBHOOK_DISABLED',message:'Webhook delivery is not configured.'},503);
    let delivery;
    try{delivery=await verifyWebhook(c.req.raw,{signingSecret:options.clerkWebhookSecret});}
    catch{return c.json({code:'INVALID_SIGNATURE',message:'Webhook verification failed.'},400);}
    if(options.clerkInstanceId&&delivery.instance_id!==options.clerkInstanceId)return c.json({code:'WRONG_INSTANCE',message:'Webhook verification failed.'},400);
    accounts.webhook(delivery);
    return c.json({received:true});
  });
  app.post('/api/dev/session',async c=>{
    if(!options.localDevAuth)return c.json({code:'DISABLED',message:'Local preview accounts are disabled.'},403);
    const body=z.object({name:z.string().trim().min(2).max(32)}).strict().parse(await c.req.json());
    return c.json(store.session(body.name));
  });
  app.use('/api/*',async(c,next)=>{
    const auth=c.req.header('Authorization');
    if(!auth?.startsWith('Bearer '))return c.json({code:'UNAUTHORIZED',message:'Sign in to continue.'},401);
    const token=auth.slice(7);let user=options.localDevAuth?store.authenticate(token):null;
    const localIdentity=!!user;let clerk=false;let firstFactorAge:number|undefined;
    if(!user&&(options.clerkSecret||options.clerkJwtKey)){
      try{const identity=await verifyClerkIdentity(token,{secretKey:options.clerkSecret,jwtKey:options.clerkJwtKey,issuer:options.clerkIssuer,authorizedParties:origins});user=identity.user;firstFactorAge=identity.firstFactorAge;clerk=true;}
      catch{return c.json({code:'SESSION_EXPIRED',message:'Your session expired. Please sign in again.'},401);}
    }
    if(!user)return c.json({code:'SESSION_EXPIRED',message:'Your session expired. Please sign in again.'},401);
    // This is a consistency assertion, never an identity source: JWT/session verification above owns identity.
    const expectedSubject=c.req.header('X-Auction-Subject');
    if(expectedSubject&&expectedSubject!==user.id)return c.json({code:'ACCOUNT_CHANGED',message:'Account changed. Reopen this action from the current account.'},409);
    if(store.accountUnavailable(user.id))return c.json({code:'ACCOUNT_DELETED',message:'This account no longer has access.'},401);
    const now=Date.now();let limit=limits.get(user.id);
    if(!limit||now-limit.at>1000){limit={at:now,count:0};limits.set(user.id,limit);}
    if(++limit.count>25)return c.json({code:'RATE_LIMITED',message:'Too many requests. Please wait a moment.'},429);
    if(clerk)user=await profiles.resolve(user,c.req.method==='GET'||c.req.path==='/api/rooms'||c.req.path.endsWith('/join'));
    // A deletion can arrive during a profile lookup. Recheck before granting access.
    if(store.accountUnavailable(user.id))return c.json({code:'ACCOUNT_DELETED',message:'This account no longer has access.'},401);
    c.set('user',user);c.set('localIdentity',localIdentity);c.set('firstFactorAge',firstFactorAge);await next();
  });
  app.get('/api/me',c=>c.json({user:c.get('user'),rooms:store.list(c.get('user'))}));
  app.patch('/api/me',async c=>{
    const body=z.object({displayName:z.string()}).strict().parse(await c.req.json());
    return c.json({user:store.setDisplayName(c.get('user'),body.displayName)});
  });
  app.delete('/api/me',async c=>{
    if(!c.get('localIdentity')&&(c.get('firstFactorAge')===undefined||c.get('firstFactorAge')!>=5)){
      // Clerk useReverification consumes this documented error envelope and retries with a fresh token.
      return c.json({clerk_error:{type:'forbidden',reason:'reverification-error',metadata:{reverification:{level:'first_factor',afterMinutes:5}}}},403);
    }
    z.object({confirmation:z.literal('DELETE MY ACCOUNT')}).strict().parse(await c.req.json());
    if(!c.get('localIdentity')&&!remover)return c.json({code:'DELETION_UNAVAILABLE',message:'Account deletion is not configured.'},503);
    const user=c.get('user');
    if(store.list(user).some(room=>room.hostId===user.id&&!['COMPLETED','CLOSED'].includes(room.status)))return c.json({code:'ACTIVE_HOSTED_ROOMS',message:'End or close your hosted auctions before deleting your account.'},409);
    store.requestAccountDeletion(user.id,c.get('localIdentity'));
    return c.json({accepted:true,message:'Account deletion is queued. Access has ended.'},202);
  });
  app.post('/api/rooms',async c=>c.json({...store.create(c.get('user'),settingsSchema.parse(await c.req.json())),serverNow:Date.now()},201));
  app.post('/api/rooms/:code/join',async c=>{const body=z.object({inviteToken:z.string().max(200)}).strict().parse(await c.req.json());return c.json({room:store.join(c.req.param('code').toUpperCase(),c.get('user'),body.inviteToken),serverNow:Date.now()});});
  app.get('/api/rooms/:code',c=>c.json({room:store.get(c.req.param('code').toUpperCase(),c.get('user'),true),serverNow:Date.now()}));
  app.post('/api/rooms/:code/invite',c=>c.json({...store.rotateInvite(c.req.param('code').toUpperCase(),c.get('user')),serverNow:Date.now()}));
  app.post('/api/rooms/:code/actions',async c=>{
    const code=c.req.param('code').toUpperCase(),user=c.get('user');store.get(code,user);
    try{const action=actionSchema.parse(await c.req.json());const room=store.action(code,user,action);return c.json(action.type==='leave'?{left:true,serverNow:Date.now()}:{room,serverNow:Date.now()});}
    catch(error){if(error instanceof RuleError)return c.json({code:error.code,message:error.message,requestId:randomBytes(8).toString('hex'),room:store.get(code,user),serverNow:Date.now()},400);throw error;}
  });
  app.post('/api/rooms/:code/ws-ticket',c=>{const code=c.req.param('code').toUpperCase();store.get(code,c.get('user'));for(const [key,value] of tickets)if(value.expires<=Date.now())tickets.delete(key);const ticket=randomBytes(32).toString('base64url');tickets.set(ticket,{user:c.get('user'),code,expires:Date.now()+30000});return c.json({ticket});});
  return {app,processAccounts:()=>accounts.process(),consumeTicket(token:string){const ticket=tickets.get(token);tickets.delete(token);return ticket&&ticket.expires>Date.now()&&!store.accountUnavailable(ticket.user.id)?ticket:null;}};
}
