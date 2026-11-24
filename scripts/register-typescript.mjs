import { registerHooks, stripTypeScriptTypes } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Node 22 local test loader: executes actual TypeScript, with no dependency stubs.
registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith('.') && context.parentURL) {
      const url = new URL(specifier, context.parentURL);
      if (!/\.[a-z]+$/i.test(url.pathname) && existsSync(fileURLToPath(url) + '.ts')) {
        return next(url.href + '.ts', context);
      }
    }
    return next(specifier, context);
  },
  load(url, context, next) {
    if (url.endsWith('.ts')) return {
      format: 'module', shortCircuit: true,
      source: stripTypeScriptTypes(readFileSync(fileURLToPath(url), 'utf8'), { mode: 'transform' }),
    };
    // Node's default JSON loader requires an import attribute. The catalog
    // imports its generated JSON with a plain default import, so serve it as a
    // module here instead of changing application code for one test loader.
    if (url.endsWith('.json')) return {
      format: 'module', shortCircuit: true,
      source: `export default ${readFileSync(fileURLToPath(url), 'utf8')};`,
    };
    return next(url, context);
  },
});
