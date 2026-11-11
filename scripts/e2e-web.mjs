import { build, preview } from 'vite';

// Exercise the production bundle, including its actual HTTP/WebSocket proxy.
await build({ configLoader: 'runner' });
const server = await preview({ configLoader: 'runner', preview: { host: '127.0.0.1', port: 5273, strictPort: true } });
const shutdown = () => server.httpServer.close(() => process.exit(0));
process.on('message', message => { if (message === 'shutdown') shutdown(); });
process.on('disconnect', shutdown);
