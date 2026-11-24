import { chromium } from '@playwright/test';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readPlayerCsv } from './lib/csv.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const assetsDir = join(root, 'Assets');
const csvPath = join(assetsDir, 'ipl_player_pool_250_clean.csv');
const manifestPath = join(root, 'packages', 'catalog', 'src', 'data', 'assets.json');
const playerOutput = join(root, 'public', 'assets', 'players');
const logoOutput = join(root, 'public', 'assets', 'teams');
const imageExtensions = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const teamNames = ['Mumbai Meteors', 'Chennai Cyclones', 'Bengaluru Blaze', 'Delhi Dragons', 'Kolkata Comets', 'Punjab Phoenix', 'Jaipur Jaguars', 'Hyderabad Hawks'];

const normalize = value => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const stripId = value => value.replace(/^[a-z]\d+[\s_-]+/i, '');

function walk(directory) {
  if (!existsSync(directory)) return [];
  const output = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const full = join(directory, entry.name);
    if (entry.isDirectory()) output.push(...walk(full));
    else if (entry.isFile()) output.push(full);
  }
  return output;
}

function loadPrevious() {
  try { return JSON.parse(readFileSync(manifestPath, 'utf8')); }
  catch { return null; }
}

async function convert(page, source, target) {
  await page.goto(pathToFileURL(source).href);
  const encoded = await page.evaluate(async () => {
    const image = document.querySelector('img');
    if (!image) throw new Error('The browser did not render the image.');
    await image.decode();
    const maximum = 640;
    const scale = Math.min(1, maximum / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('The browser could not create a canvas context.');
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return { data: canvas.toDataURL('image/webp', 0.82).split(',')[1], width: canvas.width, height: canvas.height };
  });
  writeFileSync(target, Buffer.from(encoded.data, 'base64'));
  return { width: encoded.width, height: encoded.height };
}

const rows = readPlayerCsv(csvPath);
const previous = loadPrevious();
mkdirSync(playerOutput, { recursive: true });
mkdirSync(logoOutput, { recursive: true });
mkdirSync(dirname(manifestPath), { recursive: true });

const imageFiles = walk(join(assetsDir, 'player-images')).filter(file => imageExtensions.has(extname(file).toLowerCase()));
const byBase = new Map(imageFiles.map(file => [basename(file).toLowerCase(), file]));
const byId = new Map(), byName = new Map();
for (const file of imageFiles) {
  const base = basename(file, extname(file));
  const idMatch = /^([a-z]\d+)[\s_-]+/i.exec(base);
  if (idMatch) {
    const id = idMatch[1].toUpperCase();
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(file);
  }
  const key = normalize(stripId(base));
  if (key) {
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key).push(file);
  }
}

const players = {}, missing = [], unconverted = [], ambiguous = [], usedFiles = new Set();
const conversions = [];
const isSvg = file => {
  const header = readFileSync(file).subarray(0, 256).toString('utf8').trimStart().toLowerCase();
  return header.startsWith('<svg') || header.startsWith('<?xml') && header.includes('<svg');
};
for (const row of rows) {
  const id = row.seed_id;
  let candidates = [];
  if (row.image_file) {
    const exact = byBase.get(basename(row.image_file).toLowerCase());
    if (exact) candidates = [exact];
  }
  if (!candidates.length && byId.has(id)) candidates = byId.get(id);
  if (!candidates.length && byName.has(normalize(row.name))) candidates = byName.get(normalize(row.name));
  candidates = [...new Set(candidates)].filter(file => {
    const match = /^([a-z]\d+)[\s_-]+/i.exec(basename(file, extname(file)));
    return !match || match[1].toUpperCase() === id;
  });
  if (candidates.length > 1) {
    ambiguous.push(id);
    players[id] = { status: 'missing', path: null, sourceFile: null, sourceBytes: null, sourceModified: null, outputBytes: null, width: null, height: null, license: 'UNRECORDED', provenance: 'owner-supplied', credit: 'No image bundled; ambiguous source files.' };
    continue;
  }
  if (!candidates.length) {
    missing.push(id);
    players[id] = { status: 'missing', path: null, sourceFile: null, sourceBytes: null, sourceModified: null, outputBytes: null, width: null, height: null, license: 'UNRECORDED', provenance: 'owner-supplied', credit: 'No image supplied; initials avatar used.' };
    continue;
  }
  const source = candidates[0];
  const sourceStats = statSync(source);
  const sourceRelative = relative(assetsDir, source).replaceAll('\\', '/');
  if (isSvg(source)) {
    unconverted.push(id);
    players[id] = {
      status: 'unconverted', path: null, sourceFile: sourceRelative,
      sourceBytes: sourceStats.size, sourceModified: sourceStats.mtimeMs,
      outputBytes: null, width: null, height: null,
      license: 'UNRECORDED', provenance: 'owner-supplied',
      credit: 'Source file is an SVG placeholder rather than a player photograph; initials avatar used.',
    };
    usedFiles.add(source);
    continue;
  }
  const target = join(playerOutput, `${id}.webp`);
  const prior = previous?.players?.[id];
  const upToDate = prior?.status === 'bundled' && prior.sourceFile === sourceRelative &&
    prior.sourceBytes === sourceStats.size && prior.sourceModified === sourceStats.mtimeMs &&
    prior.outputBytes !== null && existsSync(target) && statSync(target).size === prior.outputBytes;
  if (upToDate) {
    players[id] = { ...prior };
    usedFiles.add(source);
    continue;
  }
  conversions.push({ id, source, sourceRelative, sourceBytes: sourceStats.size, sourceModified: sourceStats.mtimeMs, target });
  usedFiles.add(source);
}

let browser = null;
let page = null;
if (conversions.length) {
  try { browser = await chromium.launch({ channel: 'chrome' }); }
  catch { browser = await chromium.launch(); }
  page = await browser.newPage({ viewport: { width: 900, height: 1200 } });
  try {
    const failed = [];
    for (const [index, item] of conversions.entries()) {
      try {
        const result = await convert(page, item.source, item.target);
        const outputBytes = statSync(item.target).size;
        players[item.id] = {
          status: 'bundled', path: `/assets/players/${item.id}.webp`, sourceFile: item.sourceRelative,
          sourceBytes: item.sourceBytes, sourceModified: item.sourceModified, outputBytes,
          width: result.width, height: result.height,
          license: 'UNRECORDED', provenance: 'owner-supplied',
          credit: 'Owner-supplied image; license and attribution were not recorded.',
        };
      } catch (error) {
        failed.push(item.id);
        missing.push(item.id);
        players[item.id] = {
          status: 'missing', path: null, sourceFile: item.sourceRelative,
          sourceBytes: item.sourceBytes, sourceModified: item.sourceModified,
          outputBytes: null, width: null, height: null,
          license: 'UNRECORDED', provenance: 'owner-supplied',
          credit: `Source image could not be converted: ${error instanceof Error ? error.message : String(error)}`,
        };
        console.warn(`  could not convert ${item.id} (${item.sourceRelative}): ${error instanceof Error ? error.message : String(error)}`);
      }
      if ((index + 1) % 25 === 0 || index === conversions.length - 1) console.log(`  converted ${index + 1}/${conversions.length}`);
    }
    if (failed.length) console.warn(`  conversion failures: ${failed.length} (${failed.join(', ')})`);
  } finally {
    await page.close();
    await browser.close();
  }
}

const unmatchedFiles = imageFiles.filter(file => !usedFiles.has(file)).map(file => relative(assetsDir, file).replaceAll('\\', '/'));

const logoFiles = walk(join(assetsDir, 'team-logos')).filter(file => ['.svg', '.png', '.webp', '.jpg', '.jpeg'].includes(extname(file).toLowerCase()));
const matchedLogos = {}, unmatchedLogos = [];
for (const file of logoFiles) {
  const base = normalize(basename(file, extname(file)));
  const teamIndex = teamNames.findIndex(name => normalize(name) === base);
  const idMatch = /^t([1-8])$/.exec(base);
  const teamId = idMatch ? `t${idMatch[1]}` : teamIndex >= 0 ? `t${teamIndex + 1}` : null;
  if (!teamId) { unmatchedLogos.push(relative(assetsDir, file).replaceAll('\\', '/')); continue; }
  const target = join(logoOutput, `${teamId}${extname(file).toLowerCase()}`);
  copyFileSync(file, target);
  matchedLogos[teamId] = {
    status: 'bundled', path: `/assets/teams/${teamId}${extname(file).toLowerCase()}`, sourceFile: relative(assetsDir, file).replaceAll('\\', '/'),
    license: 'UNRECORDED', provenance: 'owner-supplied', credit: 'Owner-supplied logo; license and attribution were not recorded.',
  };
}

const sortedPlayers = Object.fromEntries(Object.keys(players).sort().map(id => [id, players[id]]));
const manifest = {
  source: 'Assets',
  generatedBy: 'npm.cmd run assets:ingest',
  players: sortedPlayers,
  missing,
  unconverted,
  ambiguous,
  unmatchedFiles,
  logos: { matched: matchedLogos, unmatched: unmatchedLogos, provenance: 'owner-supplied' },
};
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');

const bundled = Object.values(sortedPlayers).filter(entry => entry.status === 'bundled');
const bytes = bundled.reduce((sum, entry) => sum + (entry.outputBytes ?? 0), 0);
console.log('assets:ingest');
console.log(`  catalog rows: ${rows.length}`);
console.log(`  photos matched: ${bundled.length} (converted ${conversions.length}, up to date ${bundled.length - conversions.length})`);
console.log(`  placeholder/unsupported: ${unconverted.length}${unconverted.length ? ` (${unconverted.join(', ')})` : ''}`);
console.log(`  photos missing: ${missing.length}${missing.length ? ` (${missing.join(', ')})` : ''}`);
console.log(`  ambiguous: ${ambiguous.length}${ambiguous.length ? ` (${ambiguous.join(', ')})` : ''}`);
console.log(`  unmatched image files: ${unmatchedFiles.length}`);
console.log(`  logos matched: ${Object.keys(matchedLogos).length}; unmatched: ${unmatchedLogos.length}`);
console.log(`  bundle: ${bundled.length} files, ${(bytes / 1024 / 1024).toFixed(2)} MB`);
console.log(`  manifest: ${relative(root, manifestPath).replaceAll('\\', '/')}`);
