import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';

// Read-only staging gate. It never prints or copies a secret value; it reports
// names and shapes only. Run before `wrangler deploy --env staging`.
const root = process.cwd();
const argv = process.argv.slice(2);
const configOnly = argv.includes('--config-only');
const remote = argv.includes('--remote');
const wranglerArg = argv.find(value => value.startsWith('--wrangler='))?.slice('--wrangler='.length);
const passes = [];
const warnings = [];
const failures = [];

function pass(name) { passes.push(name); }
function fail(name, detail) { failures.push(detail ? `${name}: ${detail}` : name); }
function warn(name) { warnings.push(name); }

function stripComments(text) {
  let output = '', index = 0, inString = false;
  while (index < text.length) {
    const character = text[index], next = text[index + 1];
    if (inString) {
      output += character;
      if (character === '\\') { output += next ?? ''; index += 2; continue; }
      if (character === '"') inString = false;
      index++;
      continue;
    }
    if (character === '"') { inString = true; output += character; index++; continue; }
    if (character === '/' && next === '/') {
      while (index < text.length && text[index] !== '\n') index++;
      continue;
    }
    if (character === '/' && next === '*') {
      index += 2;
      while (index < text.length && !(text[index] === '*' && text[index + 1] === '/')) index++;
      index += 2;
      continue;
    }
    output += character;
    index++;
  }
  return output;
}

function removeTrailingCommas(text) {
  let output = '', index = 0, inString = false;
  while (index < text.length) {
    const character = text[index];
    if (inString) {
      output += character;
      if (character === '\\') { output += text[index + 1] ?? ''; index += 2; continue; }
      if (character === '"') inString = false;
      index++;
      continue;
    }
    if (character === '"') { inString = true; output += character; index++; continue; }
    if (character === ',') {
      let lookahead = index + 1;
      while (lookahead < text.length && /\s/.test(text[lookahead])) lookahead++;
      if (text[lookahead] === '}' || text[lookahead] === ']') { index++; continue; }
    }
    output += character;
    index++;
  }
  return output;
}

function readConfig(path) {
  return JSON.parse(removeTrailingCommas(stripComments(readFileSync(path, 'utf8'))));
}

const PLACEHOLDER = /^(?:<.*>|\$\{.*\}|changeme|change-me|replace(?:-me)?|todo|tbd|example|your[-_ ].*|x{4,}|\*+)$/i;
function isPlaceholder(value) {
  const trimmed = value.trim();
  return !trimmed
    || PLACEHOLDER.test(trimmed)
    || /example\.(?:com|org|net)/i.test(trimmed)
    || /<(?:[^>]+)>/.test(trimmed)
    || /REPLACE|CHANGEME|TODO|YOUR[_-]/i.test(trimmed);
}

function validIssuer(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.origin === value && !url.search && !url.hash;
  } catch { return false; }
}

function validOrigins(value) {
  const origins = value.split(',').map(item => item.trim()).filter(Boolean);
  if (!origins.length) return false;
  return origins.every(origin => {
    if (origin === '*') return false;
    try {
      const url = new URL(origin);
      return url.protocol === 'https:' && url.origin === origin;
    } catch { return false; }
  });
}

const requirements = [
  { name: 'CLERK_SECRET_KEY', valid: value => /^sk_(?:test|live)_\S{8,}$/.test(value), shape: 'sk_test_/sk_live_ key' },
  { name: 'CLERK_JWT_KEY', valid: value => value.includes('BEGIN PUBLIC KEY') && value.includes('END PUBLIC KEY') && value.length > 100, shape: 'PEM public key' },
  { name: 'WS_TICKET_SECRET', valid: value => /^\S{32,4096}$/.test(value), shape: '32+ non-space characters' },
  { name: 'CLERK_ISSUER', valid: validIssuer, shape: 'exact https origin' },
  { name: 'ALLOWED_ORIGINS', valid: validOrigins, shape: 'comma-separated exact https origins' },
];

const configPath = join(root, 'wrangler.jsonc');
let config;
try {
  config = readConfig(configPath);
  pass('wrangler.jsonc parses');
} catch (error) {
  fail('wrangler.jsonc parses', error.message);
  report();
  process.exit(1);
}

const staging = config.env?.staging;
if (!staging) fail('env.staging exists');
else pass('env.staging exists');

if (config.name === 'auctionarena') pass('top-level Worker is auctionarena');
else fail('top-level Worker name', `expected auctionarena, found ${String(config.name)}`);

if (staging?.name === 'auctionarena-staging') pass('staging Worker is auctionarena-staging');
else fail('staging Worker name', `expected auctionarena-staging, found ${String(staging?.name)}`);
if (staging?.name && staging.name === config.name) fail('staging Worker is distinct from production');

if (config.main === 'apps/api/src/worker/index.ts') pass('Worker entry is apps/api/src/worker/index.ts');
else fail('Worker entry', `unexpected main ${String(config.main)}`);

if (config.assets?.binding === 'ASSETS' && config.assets?.directory === './dist') pass('ASSETS binding points at ./dist');
else fail('ASSETS binding', 'expected binding ASSETS and directory ./dist');
if (existsSync(join(root, 'dist', 'index.html'))) pass('dist build exists');
else fail('dist build exists', 'run npm run build before deploying');

const expectedBindings = new Map([['ROOM', 'RoomDurableObject'], ['DIRECTORY', 'DirectoryDurableObject']]);
const bindings = staging?.durable_objects?.bindings;
if (!Array.isArray(bindings)) {
  fail('staging durable_objects.bindings', 'missing; Wrangler does not inherit them into environments');
} else {
  for (const [name, className] of expectedBindings) {
    const binding = bindings.find(item => item.name === name);
    if (!binding) fail(`staging binding ${name}`, 'missing');
    else if (binding.class_name !== className) fail(`staging binding ${name}`, `expected ${className}, found ${String(binding.class_name)}`);
    else pass(`staging binding ${name} -> ${className}`);
  }
  if (bindings.length !== expectedBindings.size) fail('staging has no extra object bindings', `found ${bindings.length}`);
}

const expectedMigrations = [['v1', 'RoomDurableObject'], ['v2', 'DirectoryDurableObject']];
// Migrations are inherited by named environments; use an explicit staging
// override if one is ever added, otherwise validate the top-level list.
const migrations = staging?.migrations ?? config.migrations;
if (!Array.isArray(migrations)) {
  fail('staging migrations', 'missing at the top level and on env.staging');
} else {
  for (const [tag, className] of expectedMigrations) {
    const migration = migrations.find(item => item.tag === tag);
    if (!migration) fail(`staging migration ${tag}`, 'missing');
    else if (!migration.new_sqlite_classes?.includes(className)) fail(`staging migration ${tag}`, `expected new_sqlite_classes to include ${className}`);
    else pass(`staging migration ${tag} creates ${className} in SQLite`);
  }
  if (migrations.some(item => item.new_classes?.length)) fail('all migrations are SQLite-backed', 'found new_classes');
}

const forbiddenBindings = ['r2_buckets', 'd1_databases', 'kv_namespaces', 'queues', 'vectorize', 'hyperdrive'];
const presentForbidden = forbiddenBindings.filter(key => config[key] || staging?.[key]);
if (presentForbidden.length) fail('no additional storage bindings', `found ${presentForbidden.join(', ')}`);
else pass('no R2, D1, KV, queue, vectorize or hyperdrive bindings');

const configVars = { ...(staging?.vars ?? {}) };
const secretLooking = Object.keys(configVars).filter(key => /(?:SECRET|TOKEN|PRIVATE|PASSWORD|ACCESS_KEY|JWT_KEY)/i.test(key));
if (secretLooking.length) fail('no secret-looking values in wrangler vars', secretLooking.join(', '));
else pass('no secret-looking values in wrangler vars');

if (!configOnly) {
  for (const requirement of requirements) {
    const value = process.env[requirement.name] ?? configVars[requirement.name];
    if (!value) fail(`env ${requirement.name}`, 'missing');
    else if (isPlaceholder(value)) fail(`env ${requirement.name}`, 'placeholder value');
    else if (!requirement.valid(value)) fail(`env ${requirement.name}`, `expected ${requirement.shape}`);
    else pass(`env ${requirement.name} present (${requirement.shape})`);
  }

  const dist = join(root, 'dist');
  if (existsSync(dist)) {
    const files = [];
    const walk = directory => {
      for (const entry of readdirSync(directory)) {
        const path = join(directory, entry), stat = statSync(path);
        if (stat.isDirectory()) walk(path);
        else if (/\.(?:js|mjs|css|html|json|map|txt)$/i.test(entry)) files.push(path);
      }
    };
    walk(dist);
    const patterns = [
      ['private key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
      ['Clerk secret key', /\bsk_(?:test|live)_[A-Za-z0-9]/],
      ['AWS secret access key', /(?:AWS_SECRET_ACCESS_KEY|SECRET_ACCESS_KEY)\s*[:=]\s*['"][A-Za-z0-9/+]{20,}/],
      ['Worker secret name', /\b(?:CLERK_SECRET_KEY|CLERK_JWT_KEY|WS_TICKET_SECRET)\b/],
    ];
    let leaks = 0;
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      for (const [label, pattern] of patterns) {
        if (pattern.test(content)) {
          fail(`dist/${relative(root, file)}`, `contains ${label}`);
          leaks++;
        }
      }
    }
    if (!leaks) pass(`dist scanned (${files.length} files, no secret patterns)`);
  }
}

if (remote) {
  const binary = wranglerArg ?? process.env.WRANGLER_BIN;
  if (!binary) {
    fail('remote secret check', 'pass --wrangler=<path> or set WRANGLER_BIN');
  } else {
    const command = process.platform === 'win32' && /\.cmd$/i.test(binary) ? `"${binary}"` : binary;
    const result = spawnSync(command, ['secret', 'list', '--env', 'staging', '--format', 'json'], {
      cwd: root, encoding: 'utf8', shell: process.platform === 'win32', timeout: 120000,
      env: { ...process.env, CI: '1', WRANGLER_SEND_METRICS: 'false' },
    });
    if (result.status !== 0) {
      fail('remote secret check', 'wrangler secret list failed; authenticate and retry');
    } else {
      let names = [];
      try {
        const output = result.stdout.trim();
        const parsed = JSON.parse(output.slice(output.indexOf('['), output.lastIndexOf(']') + 1));
        names = parsed.map(item => item.name);
      } catch {
        names = [...result.stdout.matchAll(/"name"\s*:\s*"([^"]+)"/g)].map(match => match[1]);
      }
      for (const name of ['CLERK_SECRET_KEY', 'CLERK_JWT_KEY', 'WS_TICKET_SECRET']) {
        if (names.includes(name)) pass(`remote secret ${name} exists`);
        else fail(`remote secret ${name}`, 'missing in staging');
      }
    }
  }
}

report();
process.exit(failures.length ? 1 : 0);

function report() {
  console.log('AuctionArena staging preflight');
  for (const name of passes) console.log(`PASS  ${name}`);
  for (const name of warnings) console.log(`WARN  ${name}`);
  for (const name of failures) console.log(`FAIL  ${name}`);
  const suffix = failures.length ? `${failures.length} failed` : 'all checks passed';
  console.log(`Result: ${suffix}${configOnly ? ' (config only)' : ''}${remote ? ' (including remote secrets)' : ''}`);
}
