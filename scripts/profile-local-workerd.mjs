// Collect only CPU stack names, sample counts and heap sizes from a loopback
// test isolate. No response bodies, source code, variables or credentials.
export async function profileLocalWorkerd(port) {
  const root = '127.0.0.1:' + port;
  const response = await fetch('http://' + root + '/json/list', { redirect: 'error', signal: AbortSignal.timeout(3000) });
  const targets = await response.json();
  const target = targets.find(t => t.webSocketDebuggerUrl && !/core:entry|core:loopback/.test(t.id));
  if (!target) throw new Error('No local application inspector target.');
  const url = new URL(target.webSocketDebuggerUrl);
  if (url.protocol !== 'ws:' || !['127.0.0.1', 'localhost'].includes(url.hostname) || url.port !== String(port)) throw new Error('Unexpected inspector endpoint.');
  const socket = new WebSocket(url), pending = new Map();
  let seq = 0;
  try {
    await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('Inspector connection timed out')), 3000); socket.onopen = () => { clearTimeout(t); res(); }; socket.onerror = () => { clearTimeout(t); rej(new Error('Inspector connection failed')); }; });
    socket.onmessage = e => {
      const msg = JSON.parse(e.data), waiter = pending.get(msg.id);
      if (waiter) { pending.delete(msg.id); clearTimeout(waiter.timer); if (msg.error) waiter.reject(new Error(msg.error.message)); else waiter.resolve(msg.result); }
    };
    function call(method, params = {}) {
      const id = ++seq;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error('Inspector timed out on ' + method)); }, 5000);
        pending.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method, params }));
      });
    }
    const heap = () => call('Runtime.getHeapUsage').catch(() => null);
    const before = await heap();
    await call('Profiler.enable'); await call('Profiler.setSamplingInterval', { interval: 2000 }); await call('Profiler.start');
    return async () => {
      try {
        const { profile } = await call('Profiler.stop'), after = await heap();
        const byId = new Map(profile.nodes.map(n => [n.id, n]));
        const parents = new Map(profile.nodes.flatMap(n => (n.children ?? []).map(id => [id, n.id])));
        const stacks = new Map();
        for (const id of profile.samples ?? []) {
          const names = []; let cursor = id;
          while (cursor && names.length < 8) { names.push(byId.get(cursor)?.callFrame.functionName || '(anonymous)'); cursor = parents.get(cursor); }
          const name = names.join(' <- '); stacks.set(name, (stacks.get(name) ?? 0) + 1);
        }
        return { samples: profile.samples?.length, heapBefore: before, heapAfter: after,
          topStacks: [...stacks].sort((a,b) => b[1] - a[1]).slice(0, 40) };
      } finally { socket.close(); }
    };
  } catch (error) { socket.close(); throw error; }
}
