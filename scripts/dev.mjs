import {spawn} from 'node:child_process';
const children=[];
// Explicit mode selection keeps .env.local Clerk keys from changing local-profile development.
for(const [file,args,env] of [['node',['--import','tsx','apps/api/src/index.ts'],{LOCAL_DEV_AUTH:'true',CLERK_SECRET_KEY:'',CLERK_JWT_KEY:'',CLERK_ISSUER:'',CLERK_WEBHOOK_SIGNING_SECRET:'',CLERK_INSTANCE_ID:''}],['node',['node_modules/vite/bin/vite.js','--host','127.0.0.1'],{VITE_CLERK_PUBLISHABLE_KEY:''}]]){
 const child=spawn(file,args,{stdio:'inherit',env:{...process.env,...env}});children.push(child);
 child.on('exit',code=>{if(code){for(const other of children)other.kill();process.exitCode=code}});
}
process.on('SIGINT',()=>{for(const child of children)child.kill()});
