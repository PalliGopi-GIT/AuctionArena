import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { planAuction } from '../packages/catalog/src/planner.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(readFileSync(join(root, 'packages', 'catalog', 'src', 'data', 'catalog.json'), 'utf8'));
const outputDirectory = join(root, 'exports');
mkdirSync(outputDirectory, { recursive: true });

// Documented fixed review seed. These CSVs are generated exports, not permanent sequences.
const seed = 'wp-h-review-2026-11-19';
const rules = { teamCount: 8, minSquad: 3, maxSquad: 12, maxOverseas: 4 };
const modes = [['quick', 80], ['standard', 120], ['mega', 250]];
const cell = value => {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

for (const [mode, size] of modes) {
  const result = planAuction({ catalog, mode, seed, rules });
  if (!result.ok) {
    console.error(`${mode}: BLOCKED — ${result.blockedReason}`);
    process.exitCode = 1;
    continue;
  }
  const byId = new Map(catalog.players.map(player => [player.id, player]));
  const lines = ['position,set name,player ID,name,role,tier,marquee flag,base price,image reference'];
  let position = 0;
  for (const set of result.sets) {
    for (const id of set.playerIds) {
      const player = byId.get(id);
      position++;
      lines.push([position, set.name, id, player.name, player.role, player.tier, player.marquee ? 'yes' : 'no', player.basePrice, player.image ?? ''].map(cell).join(','));
    }
  }
  const target = join(outputDirectory, `auction-order-${size}.csv`);
  writeFileSync(target, lines.join('\n') + '\n');
  console.log(`${mode}: ${position} players, ${result.sets.length} sets, ${result.adjustments.length} adjustment(s) -> ${relative(root, target).replaceAll('\\', '/')}`);
  for (const adjustment of result.adjustments) console.log(`  - ${adjustment.message}`);
}
