import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPlayerCsv } from './lib/csv.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const csvPath = join(root, 'Assets', 'ipl_player_pool_250_clean.csv');
const manifestPath = join(root, 'packages', 'catalog', 'src', 'data', 'assets.json');
const catalogPath = join(root, 'packages', 'catalog', 'src', 'data', 'catalog.json');
const roles = new Set(['Wicketkeeper', 'Batter', 'All-rounder', 'Bowler']);
const tiers = new Set(['A', 'B', 'C', 'D', 'E']);

const rows = readPlayerCsv(csvPath);
const problems = [];
const ids = new Set(), names = new Set();
const players = [];
for (const [index, row] of rows.entries()) {
  const line = index + 2;
  const id = row.seed_id;
  if (!id) { problems.push(`Row ${line}: missing seed_id.`); continue; }
  if (ids.has(id)) problems.push(`Row ${line}: duplicate player ID ${id}.`);
  ids.add(id);
  const normalizedName = (row.name ?? '').trim().toLowerCase();
  if (!normalizedName) problems.push(`Row ${line} (${id}): missing name.`);
  else if (names.has(normalizedName)) problems.push(`Row ${line} (${id}): duplicate name ${row.name}.`);
  names.add(normalizedName);
  if (!roles.has(row.role)) problems.push(`Row ${line} (${id}): unknown role ${JSON.stringify(row.role)}.`);
  if (!tiers.has(row.tier)) problems.push(`Row ${line} (${id}): unknown tier ${JSON.stringify(row.tier)}.`);
  const basePrice = Number(row.base_price_lakh);
  if (!Number.isInteger(basePrice) || basePrice <= 0) problems.push(`Row ${line} (${id}): base price must be a positive integer.`);
  if (row.overseas !== 'true' && row.overseas !== 'false') problems.push(`Row ${line} (${id}): overseas must be true or false.`);
  if (!row.country) problems.push(`Row ${line} (${id}): missing country.`);
  if (problems.length > 40) break;
  players.push({
    id, name: row.name, country: row.country, overseas: row.overseas === 'true',
    role: row.role, tier: row.tier, basePrice, marquee: row.tier === 'A',
    battingStyle: row.batting_style || 'Unknown', bowlingStyle: row.bowling_style || 'Unknown',
  });
}

if (problems.length) {
  console.error('catalog:build failed validation:');
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exitCode = 1;
} else {
  const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : null;
  if (!manifest) console.warn('catalog:build warning: no assets manifest; every player uses the fallback portrait.');
  for (const player of players) {
    const asset = manifest?.players?.[player.id];
    player.image = asset?.status === 'bundled' ? asset.path : null;
    player.imageStatus = asset?.status === 'bundled' ? 'bundled' : asset?.status === 'unconverted' ? 'unconverted' : 'missing';
  }
  players.sort((left, right) => left.id.localeCompare(right.id));
  const fingerprint = createHash('sha256').update(JSON.stringify(players.map(player => ({
    id: player.id, name: player.name, country: player.country, overseas: player.overseas,
    role: player.role, tier: player.tier, basePrice: player.basePrice,
    battingStyle: player.battingStyle, bowlingStyle: player.bowlingStyle, marquee: player.marquee,
  })))).digest('hex').slice(0, 8);
  const catalog = {
    catalogVersion: `real-v1-${fingerprint}`,
    source: 'Assets/ipl_player_pool_250_clean.csv',
    generatedBy: 'npm.cmd run catalog:build',
    players,
  };
  mkdirSync(dirname(catalogPath), { recursive: true });
  writeFileSync(catalogPath, JSON.stringify(catalog, null, 2) + '\n');
  const count = (key, value) => players.filter(player => player[key] === value).length;
  console.log('catalog:build');
  console.log(`  catalogVersion: ${catalog.catalogVersion}`);
  console.log(`  players: ${players.length}`);
  console.log(`  tiers: A ${count('tier', 'A')} B ${count('tier', 'B')} C ${count('tier', 'C')} D ${count('tier', 'D')} E ${count('tier', 'E')}`);
  console.log(`  roles: WK ${count('role', 'Wicketkeeper')} BAT ${count('role', 'Batter')} AR ${count('role', 'All-rounder')} BOWL ${count('role', 'Bowler')}`);
  console.log(`  overseas: ${players.filter(player => player.overseas).length}; domestic: ${players.filter(player => !player.overseas).length}`);
  console.log(`  photos bundled: ${players.filter(player => player.imageStatus === 'bundled').length}; placeholders: ${players.filter(player => player.imageStatus === 'unconverted').length}; fallback: ${players.filter(player => player.imageStatus === 'missing').length}`);
  console.log(`  output: ${relative(root, catalogPath).replaceAll('\\', '/')}`);
}
