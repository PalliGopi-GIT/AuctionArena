import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

// Isolated npm resolution probe only. No CDK app, AWS SDK call, credential or main-project install.
if(!process.argv.includes('--install-probe')){
  console.log('Plan: install CDK 2.276.0 in .data/cdk-bundle-probe with a scoped minimatch 11.0.1 override, inspect the copy actually resolved by CDK, and check glob compatibility/security bounds.');
  console.log('Main package.json/lockfile and AWS resources remain untouched. Run with --install-probe from the host to download packages.');
  process.exit(0);
}
const root=resolve('.'),directory=join(root,'docs/reports/evidence/WP1-CDK-BUNDLE-FIX'),probe=join(root,'.data/cdk-bundle-probe');
mkdirSync(directory,{recursive:true});mkdirSync(probe,{recursive:true});
const lock=JSON.parse(readFileSync(join(root,'package-lock.json'),'utf8'));
const report={at:new Date().toISOString(),status:'not-run',awsOperations:false,mainDependenciesChanged:false};
const dependencyHashes=()=>Object.fromEntries(['package.json','package-lock.json'].map(file=>[file,createHash('sha256').update(readFileSync(join(root,file))).digest('hex')]));
report.mainDependencyHashesBefore=dependencyHashes();
const save=()=>{report.mainDependencyHashesAfter=dependencyHashes();report.mainDependenciesChanged=JSON.stringify(report.mainDependencyHashesBefore)!==JSON.stringify(report.mainDependencyHashesAfter);writeFileSync(join(directory,'probe.json'),JSON.stringify(report,null,2));};
const npm=join(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
function run(args){return spawnSync(process.execPath,[npm,...args,'--cache',join(probe,'.npm-cache')],{encoding:'utf8',windowsHide:true,timeout:180000,maxBuffer:2*1024*1024});}
try{
  writeFileSync(join(probe,'package.json'),JSON.stringify({name:'auctionarena-cdk-bundle-probe',private:true,dependencies:{'aws-cdk-lib':'2.276.0',constructs:lock.packages['node_modules/constructs'].version},overrides:{'aws-cdk-lib':{minimatch:'11.0.1'}}},null,2));
  const startedAt=Date.now();
  const installed=run(['install','--prefix',probe,'--ignore-scripts','--no-fund','--fetch-retries=0','--fetch-timeout=15000']);
  // Persist safe diagnostics only: npm output can contain registry URLs or credentials.
  report.install={exitCode:installed.status,signal:installed.signal,errorCode:installed.error?.code??null,durationMs:Date.now()-startedAt,npmErrorCodes:[...new Set((installed.stderr??'').match(/\b(?:EACCES|EPERM|ECONNREFUSED|ECONNRESET|ENETUNREACH|EAI_AGAIN|ENOTFOUND|ETIMEDOUT|ENOTCACHED)\b/g)??[])],failureSyscalls:[...new Set([...(installed.stderr??'').matchAll(/\bsyscall\s+(connect|open|mkdir|scandir|stat|unlink|rename)\b/g)].map(match=>match[1]))]};
  if(installed.status!==0)throw new Error('PROBE_INSTALL_FAILED');
  const requireFromCdk=createRequire(join(probe,'node_modules/aws-cdk-lib/package.json'));
  const modulePath=requireFromCdk.resolve('minimatch');let location=dirname(modulePath),pkg;
  for(let count=0;count<8;count++){try{const candidate=JSON.parse(readFileSync(join(location,'package.json'),'utf8'));if(candidate.name==='minimatch'){pkg=candidate;break;}}catch{}location=dirname(location);}
  report.resolvedMinimatchVersion=pkg?.version??'unknown';
  if(pkg?.version!=='11.0.1'){
    report.status='override_not_applied';save();console.log('The published bundle still resolves minimatch '+report.resolvedMinimatchVersion+'. The isolated override did not fix it; main dependencies are unchanged.');process.exit(0);
  }
  const worker=`const m=require(process.argv[1]);const cases=[['src/index.ts','**/*.ts',{},true],['src/index.css','**/*.ts',{},false],['src/.private.ts','**/*.ts',{dot:true},true],['src/index.ts','*.ts',{matchBase:true},true],['node_modules/pkg/index.js','node_modules/**',{},true],['src/index.ts','!node_modules/**',{},true]];for(const [path,pattern,options,expected]of cases)if(m.minimatch(path,pattern,options)!==expected)throw Error('Glob mismatch');let bounded=false;try{new m.Minimatch(Array(40).fill('**/..').join('/'),{optimizationLevel:2,braceExpandMax:64});}catch(error){if(error instanceof RangeError)bounded=true;else throw error;}if(!bounded)throw Error('Amplification limit not observed');console.log('Glob semantics and amplification bound passed');`;
  const checked=spawnSync(process.execPath,['-e',worker,modulePath],{encoding:'utf8',windowsHide:true,timeout:10000,maxBuffer:1024*1024});
  if(checked.status!==0)throw new Error('GLOB_COMPATIBILITY_OR_BOUND_FAILED');
  const audited=run(['audit','--json','--prefix',probe]);const audit=JSON.parse(audited.stdout);
  if(!audit.metadata?.vulnerabilities)throw new Error('PROBE_AUDIT_FAILED');report.audit=audit.metadata.vulnerabilities;
  report.status='isolated_glob_probe_passed';report.requiresCdkIntegrationVerification=true;save();console.log('Isolated override and glob checks passed. Full CDK integration verification is still required before applying this to the app. Evidence: docs/reports/evidence/WP1-CDK-BUNDLE-FIX/probe.json');
}catch(error){report.status='failed';report.failureCode=/^[A-Z_]+$/.test(error.message)?error.message:'PROBE_UNAVAILABLE';save();console.error('Bundle probe failed: '+report.failureCode+'. Main dependencies are unchanged.');process.exitCode=1;}
