#!/usr/bin/env node
/**
 * Pre-deployment guard for the deployed frontend bundle.
 *
 * Vite inlines VITE_CLERK_PUBLISHABLE_KEY at build time, so a dist/ built with
 * an empty key silently ships an app whose sign-in modal says "Account sign-in
 * requires Clerk configuration." That is exactly how the staging regression
 * happened: the E2E harness rebuilt ./dist with an empty key and that artefact
 * was deployed. This check fails a deployment before it reaches Cloudflare.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const expected = process.env.VITE_CLERK_PUBLISHABLE_KEY?.trim() || '';
const fail = message => { console.error(`\n  deploy blocked: ${message}\n`); process.exit(1); };
const pass = message => console.log(`  ok  ${message}`);

const assets = join('dist', 'assets');
if (!existsSync(assets)) fail('dist/assets is missing. Run `npm run build` first.');

const js = readdirSync(assets).filter(name => name.endsWith('.js') && statSync(join(assets, name)).isFile());
if (!js.length) fail('dist/assets contains no JavaScript bundle.');

let sawClerkKey = false;
let sawSecret = false;
for (const name of js) {
  const content = readFileSync(join(assets, name), 'utf8');
  // Clerk's own vendored source contains the literal "pk_test_..." inside error
  // messages, so require a real key shape (>=20 characters after the prefix).
  if (/\bpk_(?:test|live)_[A-Za-z0-9+/]{20,}/.test(content)) sawClerkKey = true;
  if (/\bsk_(?:test|live)_[A-Za-z0-9]{16,}/.test(content)) sawSecret = true;
}

if (sawSecret) fail('the built bundle contains a Clerk secret key. Never inline sk_* in a frontend build.');
if (!sawClerkKey) {
  fail('the built bundle has no Clerk publishable key, so sign-in would be unavailable.\n'
    + '        Rebuild with the key present, e.g. `npm run build` with .env.local loaded,');
}
pass('the built bundle embeds a Clerk publishable key');
pass(`scanned ${js.length} bundle file(s): no Clerk secret key`);
console.log('\n  frontend bundle is deployable\n');
