import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Never open the developer's .data/auctionarena.json during browser tests.
const directory = mkdtempSync(join(tmpdir(), 'auctionarena-e2e-'));
process.env.DATA_FILE = join(directory, 'rooms.json');
process.env.LOCAL_DEV_AUTH = 'true';
process.env.CLERK_SECRET_KEY = '';
process.env.CLERK_JWT_KEY = '';
process.env.CLERK_WEBHOOK_SIGNING_SECRET = '';
process.env.CLERK_INSTANCE_ID = '';
process.env.API_PORT = '3101';
process.env.ALLOWED_ORIGINS = 'http://127.0.0.1:5273';
process.on('exit', () => rmSync(directory, { recursive: true, force: true }));
process.on('SIGTERM', () => process.exit(0));
process.on('message', message => { if (message === 'shutdown') process.exit(0); });
process.on('disconnect', () => process.exit(0));
await import('../apps/api/src/index.ts');
