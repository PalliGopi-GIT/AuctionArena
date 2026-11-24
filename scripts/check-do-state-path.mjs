import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { durableObjectClasses, findDoStatePathProblem, stripJsonComments } from './lib/do-state-path.mjs';

function argument(name, fallback) {
  const prefix = `--${name}=`;
  const inline = process.argv.find(value => value.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

const stateRoot = resolve(argument('state', '.wrangler/state'));
const configPath = resolve(argument('config', 'wrangler.jsonc'));
const environmentName = argument('env', '');
let config;
try {
  config = JSON.parse(stripJsonComments(readFileSync(configPath, 'utf8')));
} catch (error) {
  console.error(`Cannot read Wrangler config ${configPath}: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
if (config) {
  try {
    const { workerName, classNames } = durableObjectClasses(config, environmentName || undefined);
    const problem = findDoStatePathProblem({ stateRoot, workerName, classNames });
    if (problem) {
      console.error(problem.message);
      process.exitCode = 1;
    } else if (process.platform === 'win32') {
      console.log(`Durable Object state paths fit the Windows limit: ${stateRoot}`);
    } else {
      console.log(`Durable Object state path check skipped on ${process.platform}: ${stateRoot}`);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
