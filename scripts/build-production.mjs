#!/usr/bin/env node
/**
 * Production build with Clerk key validation.
 *
 * Vite inlines VITE_CLERK_PUBLISHABLE_KEY at build time, so a single dist/
 * cannot serve both staging and production. This script fails the build
 * unless a real pk_live_ key is present, and refuses to emit a bundle that
 * carries a sk_ secret or a development pk_test_ key.
 */
import { execSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const fail = message => { console.error(`\n  production build blocked: ${message}\n`); process.exit(1); };
const pass = message => console.log(`  ok  ${message}`);

const key = process.env.VITE_CLERK_PUBLISHABLE_KEY;
if (!key) {
  fail('VITE_CLERK_PUBLISHABLE_KEY is not set. Create .env.production.local with the pk_live_ key.');
}
if (!key.startsWith('pk_live_')) {
  fail(`VITE_CLERK_PUBLISHABLE_KEY must be a production key (pk_live_...), got "${key.slice(0, 8)}..."`);
}
if (key.length < 30) fail('VITE_CLERK_PUBLISHABLE_KEY looks truncated.');
pass('VITE_CLERK_PUBLISHABLE_KEY is a pk_live_ production key');

if (process.env.CLERK_SECRET_KEY?.startsWith('sk_')) {
  fail('CLERK_SECRET_KEY is set in the build environment. Secrets must never be present at build time.');
}
pass('no Clerk secret key in the build environment');

console.log('\n  building...\n');
// Stale bundles from a previous (possibly staging) build must not survive:
// Vite keeps old hashed files, and a pk_test_ bundle left behind would ship.
try { rmSync('dist', { recursive: true, force: true }); } catch { /* nothing to remove */ }
try {
  execSync('npx tsc --noEmit && npx vite build', { stdio: 'inherit', env: process.env });
} catch (error) {
  fail(`build command failed (exit ${error.status}).`);
}

const assets = join('dist', 'assets');
if (!existsSync(assets)) fail('dist/assets not found after build.');

const files = readdirSync(assets).filter(name => /\.(js|css|html)$/i.test(name));
let leaks = 0;
let sawPkLive = false;
// Match real key shapes only (>=20 chars after the prefix). Clerk's own source
// contains the literal text "pk_test_..." in error messages, which is not a key.
const REAL_SECRET = /\bsk_(?:test|live)_[A-Za-z0-9]{16,}/;
const REAL_TEST_KEY = /\bpk_test_[A-Za-z0-9+/]{20,}/;
for (const name of files) {
  const path = join(assets, name);
  if (!statSync(path).isFile()) continue;
  const content = readFileSync(path, 'utf8');
  if (REAL_SECRET.test(content)) { console.error(`  LEAK  ${name} contains a Clerk secret key`); leaks++; }
  if (/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(content)) { console.error(`  LEAK  ${name} contains a private key`); leaks++; }
  if (REAL_TEST_KEY.test(content)) { console.error(`  WRONG ${name} contains a development pk_test_ key`); leaks++; }
  if (content.includes(key)) sawPkLive = true;
}
if (leaks) fail(`${leaks} problem(s) found in dist/assets.`);
pass(`scanned ${files.length} built asset file(s): no secrets, no pk_test_`);

if (!sawPkLive) fail('the pk_live_ publishable key is not present in the built bundle.');
pass('the pk_live_ publishable key is embedded in the bundle');

const players = join('dist', 'assets', 'players');
const images = existsSync(players) ? readdirSync(players).filter(name => name.endsWith('.webp')).length : 0;
if (images === 0) fail('no player images found in dist/assets/players.');
pass(`${images} player images present in dist`);

console.log('\n  production build ready for `wrangler deploy --env production`\n');
