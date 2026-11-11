// IPC allows the launcher to close its own API on Windows without shell process-tree tools.
process.on('message', message => { if (message === 'shutdown') process.exit(0); });
process.on('disconnect', () => process.exit(0));
await import('../apps/api/src/index.ts');
