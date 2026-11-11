import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

// Host-only read: no config mutation, account creation, password, MFA or provider changes.
const directory='docs/reports/evidence/WP1-AUTH-COVERAGE';
mkdirSync(directory,{recursive:true});
const report={at:new Date().toISOString(),status:'not-run',application:'app_3LlP2OcDruOfpacg7AYHbOGU7jj',instance:'development',settings:[],challengesVerified:[]};
const save=()=>writeFileSync(`${directory}/readiness.json`,JSON.stringify(report,null,2));
try{
  const npx=join(dirname(process.execPath),'node_modules','npm','bin','npx-cli.js');
  if(!existsSync(npx))throw new Error('NPX_NOT_FOUND');
  const result=spawnSync(process.execPath,[npx,'--yes','clerk@latest','config','pull','--app',report.application,'--instance','dev'],{encoding:'utf8',windowsHide:true,timeout:90000,maxBuffer:2*1024*1024,env:{...process.env,CLERK_MODE:'agent'}});
  if(result.status!==0)throw new Error('CLI_CONFIG_READ_FAILED');
  const output=result.stdout.trim();
  const config=JSON.parse(output.slice(output.indexOf('{'),output.lastIndexOf('}')+1));
  const allowedString=/^(password|email_code|email_link|phone_code|totp|backup_code|passkey|oauth_[a-z0-9_]+)$/;
  function inspect(value,path=[]){
    if(value&&typeof value==='object')for(const [key,item]of Object.entries(value))inspect(item,[...path,key]);
    else if(/password|email|phone|totp|mfa|second.factor|oauth|social|multi.session|passkey/i.test(path.join('.'))&&(typeof value==='boolean'||typeof value==='string'&&allowedString.test(value)))report.settings.push({path:path.join('.'),value});
  }
  inspect(config);report.status='inspected_not_challenge_verified';save();
  console.log('Read development sign-in settings. No accounts or settings changed.');
  console.log(`Saved ${report.settings.length} safe configuration flags. Evidence: ${directory}/readiness.json`);
  console.log('Password/OTP/OAuth/MFA completion still needs separate live challenge tests.');
}catch(error){report.status='failed';report.failureCode=['NPX_NOT_FOUND','CLI_CONFIG_READ_FAILED'].includes(error.message)?error.message:'CONFIG_RESPONSE_UNRECOGNIZED';save();console.error('Readiness check failed: '+report.failureCode+'. No raw configuration or credential output was saved.');process.exitCode=1;}
