import './register-typescript.mjs';
import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { build, preview } from 'vite';
import { clerkDevelopmentConfig } from './clerk-config.ts';

// Load privately at runtime. Never print .env.local or credential values.
if (existsSync('.env.local')) process.loadEnvFile('.env.local');
const config = clerkDevelopmentConfig(process.env);
for (const port of [config.apiPort, config.webPort]) {
  const probe = createServer();
  await new Promise((resolve, reject) => { probe.once('error', () => reject(new Error(`Port ${port} is in use. Stop the existing server or choose different development ports.`))); probe.listen(port, '127.0.0.1', resolve); });
  await new Promise(resolve => probe.close(resolve));
}
Object.assign(process.env, config.env);
// Serve the real bundle, using runner config loading in restricted Windows environments.
// Keep this preview separate from the local-profile/E2E bundle in dist/.
const outDir = process.env.CLERK_PREVIEW_KIND === 'challenges' ? '.data/clerk-challenge-preview' : '.data/clerk-preview';
await build({ configLoader: 'runner', build: { outDir } });
const api = spawn(process.execPath, ['--import', './scripts/register-typescript.mjs', 'scripts/clerk-api.mjs'], {
  windowsHide: true, env: config.env, stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
});
let frontend;
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true; process.exitCode = code;
  frontend?.httpServer.close();
  if (api.connected) api.send('shutdown');
  const timeout = setTimeout(() => { api.kill(); process.exit(code); }, 5000);
  timeout.unref();
}
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
process.on('message', message => { if (message === 'shutdown') stop(); });
process.on('disconnect', () => stop());
api.on('error', () => { console.error('Clerk API failed to start.'); stop(1); });
api.on('exit', code => { if (!stopping) { console.error('Clerk API stopped.'); stop(code || 1); } });
try {
  const deadline = Date.now() + 15000;
  while (true) {
    if (stopping) throw new Error('Clerk API could not start.');
    if (await fetch(`http://127.0.0.1:${config.apiPort}/api/health`, { signal: AbortSignal.timeout(1000) }).then(r => r.ok, () => false)) break;
    if (Date.now() > deadline) throw new Error('Clerk API did not become ready.');
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  frontend = await preview({ configLoader: 'runner', build: { outDir }, preview: { host: '127.0.0.1', port: config.webPort, strictPort: true } });
  console.log(`AuctionArena Clerk development preview: http://127.0.0.1:${config.webPort}`);
  console.log('Local test-profile sign-in is disabled. Re-run this command after editing the frontend.');
} catch (error) { console.error(error.message); stop(1); }
