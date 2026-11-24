import { readFileSync } from 'node:fs';

/** Minimal RFC 4180 reader; the supplied catalog has no quoted cells but future edits may. */
export function parseCsv(text) {
  const rows = [];
  let row = [], cell = '', quoted = false;
  const source = text.replace(/^\uFEFF/, '');
  for (let index = 0; index < source.length; index++) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') { cell += '"'; index++; }
      else if (character === '"') quoted = false;
      else cell += character;
      continue;
    }
    if (character === '"') { quoted = true; continue; }
    if (character === ',') { row.push(cell); cell = ''; continue; }
    if (character === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; continue; }
    if (character === '\r') continue;
    cell += character;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(entries => entries.some(entry => entry.trim().length > 0));
}

export function readPlayerCsv(path) {
  const [header, ...rows] = parseCsv(readFileSync(path, 'utf8'));
  if (!header) throw new Error(`Catalog CSV is empty: ${path}`);
  return rows.map(entries => Object.fromEntries(header.map((name, index) => [name.trim(), (entries[index] ?? '').trim()])));
}
