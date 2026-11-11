import { createClerkClient } from '@clerk/backend';
import { z } from 'zod';
import type { LocalRoomStore } from '../../realtime/src/store';
import { clerkProfileName } from './clerk-profile-name';

export type DeleteClerkUser = (verifiedSubject:string)=>Promise<void>;
export function clerkUserDeletion(secretKey?:string):DeleteClerkUser|undefined {
  if(!secretKey)return;
  const client=createClerkClient({secretKey});
  return async subject=>{try{await client.users.deleteUser(subject);}catch(error){if((error as {status?:number}).status!==404)throw error;}};
}
const webhookSchema=z.object({type:z.string(),timestamp:z.number().int().nonnegative(),
  data:z.object({id:z.string().startsWith('user_'),first_name:z.string().nullable().optional(),last_name:z.string().nullable().optional(),username:z.string().nullable().optional(),updated_at:z.number().int().nonnegative().optional()}).passthrough(),
}).passthrough();

export class Accounts {
  private running:Promise<void>|undefined;
  constructor(private store:LocalRoomStore,private remove?:DeleteClerkUser){}
  /** Caller must verify the raw webhook signature before passing any data here. */
  webhook(input:unknown){
    if(!input||typeof input!=='object'||!('type' in input)||!['user.created','user.updated','user.deleted'].includes(String(input.type)))return;
    const event=webhookSchema.parse(input),user=event.data;
    if(event.type==='user.deleted'){this.store.requestAccountDeletion(user.id,true);return;}
    this.store.projectProfile({id:user.id,name:clerkProfileName({id:user.id,firstName:user.first_name??null,lastName:user.last_name??null,username:user.username??null})},Date.now(),user.updated_at??event.timestamp);
  }
  /** Durable jobs survive process restarts; a failed remote deletion never grants access again. */
  process(){
    if(this.running)return this.running;
    this.running=this.drain().finally(()=>{this.running=undefined;});return this.running;
  }
  private async drain(){
    for(const job of this.store.pendingAccountDeletions().slice(0,10)){
      if(!job.subject)continue;
      let timeout:ReturnType<typeof setTimeout>|undefined;
      try{
        if(!job.providerDeleted){
          if(!this.remove)throw new Error('Deletion provider is unavailable');
          await Promise.race([this.remove(job.subject),new Promise<never>((_,reject)=>{timeout=setTimeout(()=>reject(new Error('Deletion timed out')),5000);})]);
        }
        this.store.completeAccountDeletion(job.subject);
      }catch{this.store.retryAccountDeletion(job.subject);}finally{clearTimeout(timeout);}
    }
  }
}
