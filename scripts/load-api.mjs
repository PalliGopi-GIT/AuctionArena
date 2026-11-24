import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// The load harness must never open the developer's private .data file.
const directory = mkdtempSync(join(tmpdir(), 'auctionarena-load-'));
process.env.DATA_FILE = join(directory, 'rooms.json');
process.env.LOCAL_DEV_AUTH = 'true';
process.env.CLERK_SECRET_KEY = '';
process.env.CLERK_JWT_KEY = '';
process.env.CLERK_ISSUER = '';
process.env.CLERK_WEBHOOK_SIGNING_SECRET = '';
process.env.CLERK_INSTANCE_ID = '';
process.env.API_PORT = process.env.LOAD_PORT ?? '3217';
process.env.ALLOWED_ORIGINS = 'http://127.0.0.1:5273';

const timer = setInterval(() => {
  const memory = process.memoryUsage();
  process.send?.({ type: 'memory', rss: memory.rss, heapUsed: memory.heapUsed, external: memory.external });
}, 500);

let stopping = false;
function cleanup() {
  clearInterval(timer);
  try { rmSync(directory, { recursive: true, force: true }); } catch { /* best effort */ }
}
function stop() {
  if (stopping) return;
  stopping = true;
  cleanup();
  process.exit(0);
}
process.on('exit', cleanup);
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
process.on('message', message => { if (message === 'shutdown') stop(); });
process.on('disconnect', stop);

await import('../apps/api/src/index.ts');
