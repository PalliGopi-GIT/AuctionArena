import { build, preview } from 'vite';

// Exercise the production bundle, including its actual HTTP/WebSocket proxy.
// This must never write to ./dist: that directory is the deployable staging
// artefact, and the E2E harness deliberately builds with an empty Clerk key.
const outDir = 'dist-e2e';
await build({ configLoader: 'runner', build: { outDir, emptyOutDir: true } });
const server = await preview({ configLoader: 'runner', build: { outDir }, preview: { host: '127.0.0.1', port: 5273, strictPort: true } });
const shutdown = () => server.httpServer.close(() => process.exit(0));
process.on('message', message => { if (message === 'shutdown') shutdown(); });
process.on('disconnect', shutdown);
