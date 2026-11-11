import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';

const started=Date.now();
const args=['--import','./scripts/register-typescript.mjs','--test','tests/local/core.test.mjs','tests/local/connection.test.mjs','tests/local/management.test.mjs','tests/local/results.test.mjs','tests/local/completion.test.mjs'];
const result=spawnSync(process.execPath,args,{encoding:'utf8',timeout:90000});
const output=(result.stdout??'')+(result.stderr??'');
const count=name=>Number(output.match(new RegExp(`^# ${name} (\\d+)`,'m'))?.[1]??0);
const evidence={task:'WP1-ROOM-COMPLETION',commit:null,command:'node scripts/test-local.mjs',exitCode:result.status??1,tests:{passed:count('pass'),failed:count('fail'),skipped:count('skipped')},durationMs:Date.now()-started,runner:'Node 22 local real engine/store, room management/results, and fake-transport client tests',at:new Date().toISOString(),concurrencyScenario:{rooms:10,simulatedMembers:200,competingIntents:2000,sockets:0},limitations:'No dependencies mocked in engine/store. Client transport uses fake sockets. Does not exercise HTTP, real WebSockets, React, Clerk, mobile browsers, AWS, distributed writers or production capacity.'};
const directory='docs/reports/evidence/WP1-ROOM-COMPLETION';mkdirSync(directory,{recursive:true});
writeFileSync(`${directory}/local-tests.tap`,output);
writeFileSync(`${directory}/local-tests.json`,JSON.stringify(evidence,null,2));
console.log(JSON.stringify(evidence,null,2));
if(result.status!==0)console.error(output,result.error??'');
process.exitCode=evidence.exitCode;
