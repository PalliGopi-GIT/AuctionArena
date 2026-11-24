import { join } from 'node:path';

// Windows MAX_PATH is 260 including the terminating null, so a created path can
// be at most 259 characters. Wrangler's per-object Durable Object SQLite name
// is 64 hex characters plus its suffix.
export const WINDOWS_MAX_PATH = 259;
const OBJECT_ID = '0'.repeat(64);
const LONGEST_SUFFIX = '.sqlite-wal';

export function doObjectDirectory(stateRoot, workerName, className) {
  return join(stateRoot, 'v3', 'do', `${workerName}-${className}`);
}

/**
 * Returns the first path that would exceed the Windows limit, or null when the
 * configuration fits (or when the platform does not enforce MAX_PATH).
 */
export function findDoStatePathProblem({
  stateRoot,
  workerName,
  classNames,
  platform = process.platform,
  maxLength = WINDOWS_MAX_PATH,
}) {
  if (platform !== 'win32') return null;
  let worst = null;
  for (const className of classNames) {
    const expected = join(doObjectDirectory(stateRoot, workerName, className), `${OBJECT_ID}${LONGEST_SUFFIX}`);
    if (expected.length <= maxLength) continue;
    if (!worst || expected.length > worst.length) worst = { className, path: expected, length: expected.length, limit: maxLength };
  }
  if (!worst) return null;
  return {
    ...worst,
    message: [
      `Durable Object SQLite path is ${worst.length} characters; Windows allows at most ${worst.limit}.`,
      `Expected file: ${worst.path}`,
      `Durable Object class: ${worst.className}`,
      'workerd cannot create this file and reports the failure as "internal error".',
      'Use a shorter --persist-to directory (for example under %LOCALAPPDATA%\\Temp) or enable Windows long-path support.',
    ].join('\n'),
  };
}

export function stripJsonComments(text) {
  let output = '';
  let quote = '';
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    const next = text[index + 1];
    if (quote) {
      output += character;
      if (character === '\\') { output += next ?? ''; index++; }
      else if (character === quote) quote = '';
      continue;
    }
    if (character === '"') { quote = character; output += character; continue; }
    if (character === '/' && next === '/') {
      while (index < text.length && text[index] !== '\n') index++;
      output += '\n';
      continue;
    }
    if (character === '/' && next === '*') {
      index += 2;
      while (index < text.length && !(text[index] === '*' && text[index + 1] === '/')) index++;
      index++;
      output += ' ';
      continue;
    }
    output += character;
  }
  return output;
}

export function durableObjectClasses(config, environmentName) {
  const environment = environmentName ? config.env?.[environmentName] : undefined;
  if (environmentName && !environment) throw new Error(`Unknown Wrangler environment: ${environmentName}`);
  const workerName = environment?.name ?? config.name;
  if (!workerName) throw new Error('Wrangler config has no worker name.');
  const bindings = environment?.durable_objects?.bindings ?? config.durable_objects?.bindings ?? [];
  const classNames = [...new Set(bindings.map(binding => binding?.class_name).filter(name => typeof name === 'string' && name.length > 0))];
  if (classNames.length === 0) throw new Error('Wrangler config declares no Durable Object classes.');
  return { workerName, classNames };
}
