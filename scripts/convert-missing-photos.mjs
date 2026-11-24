/**
 * Convert the photographs that assets:ingest left as `unconverted`.
 *
 * The previous run failed on these files (all large PNGs). They are genuine
 * owner-supplied photographs, so converting them is a fidelity fix, not a new
 * asset. Output settings match scripts/assets-ingest.mjs (640px, WebP q82).
 */
import sharp from 'sharp';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const catalogPath = 'packages/catalog/src/data/catalog.json';
const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
const sourceDir = 'Assets/player-images';
const outputDir = 'public/assets/players';
const sourceFiles = readdirSync(sourceDir);

const pending = catalog.players.filter(player => player.imageStatus !== 'bundled');
const converted = [];
const skipped = [];

for (const player of pending) {
  const sourceFile = sourceFiles.find(file => file.startsWith(player.id + '_'));
  if (!sourceFile) { skipped.push({ id: player.id, name: player.name, reason: 'no source photograph' }); continue; }
  const target = join(outputDir, player.id + '.webp');
  try {
    await sharp(join(sourceDir, sourceFile))
      .resize(640, 640, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 82 })
      .toFile(target);
    player.image = '/assets/players/' + player.id + '.webp';
    player.imageStatus = 'bundled';
    converted.push({ id: player.id, name: player.name, source: sourceFile });
  } catch (error) {
    skipped.push({ id: player.id, name: player.name, reason: 'convert failed: ' + String(error).slice(0, 80) });
  }
}

if (converted.length) writeFileSync(catalogPath, JSON.stringify(catalog, null, 2) + '\n', 'utf8');

const counts = {};
for (const player of catalog.players) counts[player.imageStatus] = (counts[player.imageStatus] ?? 0) + 1;
console.log(JSON.stringify({
  converted: converted.length,
  convertedIds: converted.map(c => c.id),
  stillWithoutPhoto: skipped,
  catalogImageStatus: counts,
  webpOnDisk: readdirSync(outputDir).filter(f => f.endsWith('.webp')).length,
}, null, 2));
