import { spawn, type ChildProcess } from 'node:child_process';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';

export default async function setup() {
  const children: ChildProcess[] = [];
  const log = 'docs/reports/evidence/WP1-E2E/servers.log';
  mkdirSync('docs/reports/evidence/WP1-E2E', { recursive: true });
  writeFileSync(log, '');
  async function stop() {
    await Promise.all(children.map(async child => {
      if (child.exitCode !== null) return;
      const closed = new Promise<void>(resolve => child.once('exit', () => resolve()));
      if (child.connected) child.send('shutdown');
      await Promise.race([closed, delay(5000)]);
      if (child.exitCode === null) child.kill();
      await closed;
    }));
  }
  try {
    for (const [args, url] of [
      [['--import', './scripts/register-typescript.mjs', 'scripts/e2e-api.mjs'], 'http://127.0.0.1:3101/api/health'],
      [['scripts/e2e-web.mjs'], 'http://127.0.0.1:5273'],
    ] as const) {
      const occupied = await fetch(url, { signal: AbortSignal.timeout(1000) }).then(() => true, () => false);
      if (occupied) throw new Error(`E2E port is already in use: ${url}`);
      const child = spawn(process.execPath, [...args], {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        env: { ...process.env, API_PORT: '3101', VITE_CLERK_PUBLISHABLE_KEY: '', CLERK_SECRET_KEY: '' },
      });
      children.push(child);
      child.stdout?.on('data', chunk => appendFileSync(log, chunk));
      child.stderr?.on('data', chunk => appendFileSync(log, chunk));
      let spawnError: Error | undefined;
      child.on('error', error => { spawnError = error; });
      const deadline = Date.now() + 120_000;
      while (true) {
        if (spawnError) throw spawnError;
        if (child.exitCode !== null) throw new Error(`E2E server exited (${child.exitCode}); see ${log}`);
        if (await fetch(url, { signal: AbortSignal.timeout(1000) }).then(r => r.ok, () => false)) break;
        if (Date.now() > deadline) throw new Error(`E2E server did not start: ${url}; see ${log}`);
        await delay(200);
      }
    }
    return stop;
  } catch (error) {
    await stop();
    throw error;
  }
}
