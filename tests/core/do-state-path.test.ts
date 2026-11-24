import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  WINDOWS_MAX_PATH,
  doObjectDirectory,
  durableObjectClasses,
  findDoStatePathProblem,
  stripJsonComments,
} from '../../scripts/lib/do-state-path.mjs';

const workerName = 'auctionarena';
const classNames = ['RoomDurableObject', 'DirectoryDurableObject'];
// State root measured in the failing Windows reproduction. Appending Wrangler's
// 64-hex object database name produces a 282-character path.
const failingRoot = 'C:\\Users\\palli\\AppData\\Local\\Temp\\commandcode\\C--Users-palli-OneDrive-Desktop-IPL-AUCTION\\1e45fd2f-9781-4d6a-a247-8ca762a5af6a\\scratchpad\\orig-repro\\brand-new-state';

describe('Durable Object state path preflight', () => {
  it('builds the per-object SQLite location used by Wrangler', () => {
    expect(doObjectDirectory('C:\\state', workerName, 'RoomDurableObject')).toBe('C:\\state\\v3\\do\\auctionarena-RoomDurableObject');
  });

  it('accepts a state root that fits the Windows limit', () => {
    expect(findDoStatePathProblem({
      stateRoot: 'C:\\Users\\dev\\AppData\\Local\\Temp\\auctionarena-state', workerName, classNames, platform: 'win32',
    })).toBeNull();
  });

  it('reports the verified long-path failure instead of letting workerd mask it', () => {
    expect(failingRoot).toHaveLength(164);
    const problem = findDoStatePathProblem({ stateRoot: failingRoot, workerName, classNames, platform: 'win32' });
    expect(problem).not.toBeNull();
    expect(problem!.className).toBe('DirectoryDurableObject');
    expect(problem!.length).toBe(282);
    expect(problem!.limit).toBe(WINDOWS_MAX_PATH);
    expect(problem!.path.endsWith('.sqlite-wal')).toBe(true);
    expect(problem!.message).toContain('--persist-to');
    expect(problem!.message).toContain('internal error');
    expect(problem!.message).toContain('DirectoryDurableObject');
  });

  it('accepts the longest path Windows can create and rejects one character more', () => {
    const root = 'C:\\state';
    let accepted = '';
    let rejected = '';
    for (let index = 0; index < 400; index++) {
      const candidate = root + 'a'.repeat(index);
      if (findDoStatePathProblem({ stateRoot: candidate, workerName, classNames, platform: 'win32' })) {
        rejected = candidate;
        accepted = root + 'a'.repeat(index - 1);
        break;
      }
    }
    expect(accepted).not.toBe('');
    expect(rejected).not.toBe('');
    expect(rejected).toBe(accepted + 'a');
    expect(findDoStatePathProblem({ stateRoot: accepted, workerName, classNames, platform: 'win32' })).toBeNull();
    expect(findDoStatePathProblem({ stateRoot: rejected, workerName, classNames, platform: 'win32' })!.length).toBe(WINDOWS_MAX_PATH + 1);
  });

  it('does not apply the Windows limit on other platforms', () => {
    expect(findDoStatePathProblem({
      stateRoot: `\\\\server\\${'a'.repeat(400)}`, workerName, classNames, platform: 'linux',
    })).toBeNull();
  });

  it('reads the real Wrangler config, including URL comments and environment names', () => {
    const config = JSON.parse(stripJsonComments(readFileSync('wrangler.jsonc', 'utf8')));
    expect(durableObjectClasses(config)).toEqual({ workerName: 'auctionarena', classNames: ['RoomDurableObject', 'DirectoryDurableObject'] });
    expect(durableObjectClasses(config, 'staging').workerName).toBe('auctionarena-staging');
  });
});
