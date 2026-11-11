import './register-typescript.mjs';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { chromium, expect } from '@playwright/test';
import { createClerkClient } from '@clerk/backend';
import { clerkDevelopmentConfig } from './clerk-config.ts';
import { probeClerkPreview } from './clerk-live-preflight.ts';

const approved=process.argv.includes('--create-test-users'),preflightOnly=process.argv.includes('--preflight-only');
console.log('Plan: two purpose-marked synthetic development users, password and email-code challenges, desktop/mobile API identity, one private test room, unique app names, reload and deletion of the synthetic guest. No existing auction fixture or instance setting changes.');
console.log('Retries reuse only this test’s tagged users/room and reset only their test passwords. Google OAuth, MFA, disabled multi-session switching and real-device results remain separate checks.');
if(!approved&&!preflightOnly){console.log('Not run: explicit approval is required before --create-test-users. --preflight-only starts/stops an isolated preview without creating Clerk users.');process.exit(0);}
if(existsSync('.env.local'))process.loadEnvFile('.env.local');
const config=clerkDevelopmentConfig(process.env),issuer='https://quality-labrador-8216.clerk.accounts.dev';
if(config.env.CLERK_ISSUER!==issuer)throw new Error('Selected development instance does not match.');
const baseURL='http://127.0.0.1:5573',directory='docs/reports/evidence/WP1-AUTH-COVERAGE',path=`${directory}/challenges.json`;
mkdirSync(directory,{recursive:true});
const previous=existsSync(path)?JSON.parse(readFileSync(path,'utf8')):undefined;
if(approved&&previous?.status==='passed_for_selected_scope'){console.log('The selected live scope already passed. No accounts or fixtures were replayed.');process.exit(0);}
const report={at:new Date().toISOString(),status:'not-run',stage:'preflight',instance:'ins_3LlP2P5dv6hhyDKp3h6huKBFkFd',testUsers:previous?.testUsers??{},roomCode:previous?.roomCode,checks:[],remaining:['Google OAuth completion','MFA configuration and challenge','Direct multi-session switch (disabled in instance)','Human Android/accessibility checks','Live webhook delivery']};
const save=()=>writeFileSync(preflightOnly?`${directory}/challenge-preflight.json`:path,JSON.stringify(report,null,2));
const stage=name=>{report.stage=name;save();console.log('Checking: '+name);};
const passed=name=>{report.checks.push(name);save();};
let preview,browser,client;const sessions=new Set();
async function stopPreview(){if(!preview||preview.exitCode!==null)return;await new Promise(resolve=>{const timer=setTimeout(()=>{preview.kill();resolve();},7000);preview.once('exit',()=>{clearTimeout(timer);resolve();});if(preview.connected)preview.send('shutdown');else preview.kill();});}
try{
  if((await probeClerkPreview(baseURL,1000)).ready)throw new Error('ISOLATED_PREVIEW_ALREADY_RUNNING');
  preview=spawn(process.execPath,['scripts/dev-clerk.mjs'],{windowsHide:true,stdio:['ignore','pipe','pipe','ipc'],env:{...config.env,API_PORT:'3401',WEB_PORT:'5573',ALLOWED_ORIGINS:baseURL,DATA_FILE:'.data/auctionarena-clerk-challenges.json',CLERK_PREVIEW_KIND:'challenges',CLERK_WEBHOOK_SIGNING_SECRET:''}});
  preview.stdout.on('data',()=>{});preview.stderr.on('data',()=>{});let startupError;preview.on('error',error=>{startupError=error;});
  const deadline=Date.now()+120000;while(!(await probeClerkPreview(baseURL,1000)).ready){if(startupError||preview.exitCode!==null||Date.now()>deadline)throw new Error('ISOLATED_PREVIEW_START_FAILED');await new Promise(resolve=>setTimeout(resolve,300));}
  if(preflightOnly){report.status='preflight-passed';report.stage='complete';save();console.log('Isolated preview preflight passed. No Clerk user or room was created.');}
  else{
    client=createClerkClient({secretKey:config.env.CLERK_SECRET_KEY});const instance=await client.instance.get();
    if(instance.id!==report.instance||instance.environmentType!=='development')throw new Error('INSTANCE_MISMATCH');
    const passwords={},users={},purpose='auctionarena-auth-challenge-test';
    stage('prepare only the approved synthetic identities');
    for(const role of ['host','guest']){
      passwords[role]=randomBytes(24).toString('base64url')+'Aa1!';
      if(report.testUsers[role]){
        const user=await client.users.getUser(report.testUsers[role]);
        if(user.privateMetadata.purpose!==purpose||user.privateMetadata.role!==role)throw new Error('FIXTURE_OWNERSHIP_MISMATCH');
        users[role]=await client.users.updateUser(user.id,{password:passwords[role]});
      }else{
        users[role]=await client.users.createUser({emailAddress:[`arena-auth-${Date.now()}-${role}+clerk_test@example.com`],password:passwords[role],firstName:'AuctionArena',lastName:`Auth ${role}`,privateMetadata:{purpose,role}});
        report.testUsers[role]=users[role].id;save();
      }
    }
    browser=await chromium.launch({channel:'chrome',headless:true});
    async function context(viewport){const context=await browser.newContext({baseURL,viewport});const token=await client.testingTokens.createTestingToken();await context.route(`${issuer}/v1/**`,async route=>{const url=new URL(route.request().url());url.searchParams.set('__clerk_testing_token',token.token);await route.continue({url:url.toString()});});const page=await context.newPage();page.setDefaultTimeout(20000);await page.goto('/');await page.waitForFunction(()=>window.Clerk?.loaded,undefined,{timeout:45000});return {context,page};}
    async function signIn(page,role,strategy){
      const identifier=users[role].emailAddresses[0].emailAddress;
      const result=await page.evaluate(async({identifier,password,strategy})=>{
        const clerk=window.Clerk;
        let attempt=await clerk.client.signIn.create(strategy==='password'?{strategy:'password',identifier,password}:{identifier});
        if(strategy==='email_code'){
          const factor=attempt.supportedFirstFactors?.find(item=>item.strategy==='email_code');if(!factor)throw new Error('EMAIL_CODE_UNAVAILABLE');
          await attempt.prepareFirstFactor({strategy:'email_code',emailAddressId:factor.emailAddressId});attempt=await attempt.attemptFirstFactor({strategy:'email_code',code:'424242'});
        }
        // Password device trust may require a separate email challenge even in a test context.
        if(attempt.status==='needs_second_factor'){
          const factor=attempt.supportedSecondFactors?.find(item=>item.strategy==='email_code');if(!factor)throw new Error('ADDITIONAL_FACTOR_REQUIRES_REVIEW');
          await attempt.prepareSecondFactor({strategy:'email_code',emailAddressId:factor.emailAddressId});attempt=await attempt.attemptSecondFactor({strategy:'email_code',code:'424242'});
        }
        if(attempt.status!=='complete'||!attempt.createdSessionId)throw new Error('CHALLENGE_INCOMPLETE');
        await clerk.setActive({session:attempt.createdSessionId});return {session:attempt.createdSessionId,user:clerk.user?.id};
      },{identifier,password:passwords[role],strategy});
      if(result.user!==users[role].id)throw new Error('BROWSER_IDENTITY_MISMATCH');sessions.add(result.session);
      await expect(page.getByRole('button',{name:'Profile',exact:true})).toBeVisible();
    }
    async function request(page,path,body,method=body?'POST':'GET'){
      return page.evaluate(async({path,body,method})=>{const token=await window.Clerk.session.getToken({skipCache:true});const response=await fetch('/api'+path,{method,headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`,'X-Auction-Subject':window.Clerk.user.id},body:body?JSON.stringify(body):undefined});return {status:response.status,body:await response.json()};},{path,body,method});
    }
    const desktop=await context({width:1440,height:1000}),mobile=await context({width:390,height:844});
    stage('real password challenge on desktop and email-code challenge on mobile');await signIn(desktop.page,'host','password');await signIn(mobile.page,'guest','email_code');
    for(const [page,role]of [[desktop.page,'host'],[mobile.page,'guest']]){const me=await request(page,'/me');expect(me.status).toBe(200);expect(me.body.user.id).toBe(users[role].id);}
    passed('Real frontend SDK password/email-code challenges completed with matching API identities; no sign-in ticket used');
    stage('create or reopen the isolated private test room');
    if(!report.roomCode){const created=await request(desktop.page,'/rooms',{name:'Auth challenge room'});expect(created.status).toBe(201);report.roomCode=created.body.room.code;report.inviteRetainedPrivately=false;save();const joined=await request(mobile.page,`/rooms/${report.roomCode}/join`,{inviteToken:created.body.inviteToken});expect(joined.status).toBe(200);}
    const room=await request(desktop.page,`/rooms/${report.roomCode}`);expect(room.body.room.hostId).toBe(users.host.id);
    for(const page of [desktop.page,mobile.page]){await page.goto(`/?room=${report.roomCode}`);await expect(page.getByRole('heading',{name:'Auth challenge room',exact:true})).toBeVisible();}
    stage('edit a unique application name and preserve it on reload');
    const name='Auth Captain '+users.host.id.slice(-8);await desktop.page.getByRole('button',{name:'Profile',exact:true}).click();await desktop.page.getByLabel('Display name',{exact:true}).fill(name);await desktop.page.getByRole('button',{name:'Save display name',exact:true}).click();await expect.poll(async()=>(await request(desktop.page,'/me')).body.user.name).toBe(name);
    await desktop.page.reload();await desktop.page.getByRole('button',{name:'Profile',exact:true}).click();await expect(desktop.page.getByLabel('Display name',{exact:true})).toHaveValue(name);await desktop.page.screenshot({path:`${directory}/challenge-profile.png`});await desktop.page.getByRole('button',{name:'Close dialog'}).click();
    passed('Verified-subject application name edit and reload passed');
    stage('close the test room and delete only the tagged synthetic guest');
    if(!['COMPLETED','CLOSED'].includes(room.body.room.status)){const ended=await request(desktop.page,`/rooms/${report.roomCode}/actions`,{id:crypto.randomUUID(),type:'end'});expect(ended.status).toBe(200);}
    const checkedGuest=await client.users.getUser(users.guest.id);if(checkedGuest.privateMetadata.purpose!==purpose||checkedGuest.privateMetadata.role!=='guest')throw new Error('DELETION_FIXTURE_MISMATCH');
    await mobile.page.getByRole('button',{name:'Profile',exact:true}).click();await mobile.page.getByLabel('Type DELETE MY ACCOUNT').fill('DELETE MY ACCOUNT');await mobile.page.getByRole('button',{name:'Delete my account',exact:true}).click();await expect(mobile.page.getByRole('button',{name:'Sign in',exact:true})).toBeVisible();
    await expect.poll(async()=>{try{await client.users.getUser(users.guest.id);return false;}catch(error){if(error.status===404)return true;throw error;}},{timeout:20000}).toBe(true);
    await expect.poll(async()=>JSON.stringify((await request(desktop.page,`/rooms/${report.roomCode}`)).body.room)).toContain('Deleted player');
    passed('Guest deletion completed at Clerk; shared test-room records are anonymized and accessible to the host');
    await mobile.context.close();
    const mobilePassword=await context({width:390,height:844});await signIn(mobilePassword.page,'host','password');expect((await request(mobilePassword.page,'/me')).body.user.id).toBe(users.host.id);await mobilePassword.context.close();
    passed('Real password challenge also completed in the mobile viewport');
    report.status='passed_for_selected_scope';report.stage='complete';save();console.log('Selected password/email/profile/deletion scope passed. OAuth/MFA/direct-switch/human-device/webhook checks remain open.');
  }
}catch(error){report.status='failed';report.failureCode=/^[A-Z_]+$/.test(error.message)?error.message:'LIVE_CHALLENGE_CHECK_FAILED';save();console.error(`Challenge check failed at ${report.stage}. See ${preflightOnly?'challenge-preflight':'challenges'}.json for redacted status. Existing tagged fixtures are retained; no additional fixture is created on retry.`);process.exitCode=1;}
finally{
  if(client)for(const id of sessions){try{await client.sessions.revokeSession(id);}catch{/* Guest deletion may have revoked it already; never log SDK payloads. */}}
  await browser?.close();await stopPreview();
}
