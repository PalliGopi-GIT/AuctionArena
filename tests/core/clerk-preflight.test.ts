import { describe, it, expect } from 'vitest';
import { createServer, type Server, type RequestListener } from 'node:http';
import { probeClerkPreview } from '../../scripts/clerk-live-preflight';

async function withServer(handler: RequestListener, run: (baseURL: string) => Promise<void>) {
  const server: Server = createServer(handler);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test port');
  try { await run(`http://127.0.0.1:${address.port}`); }
  finally { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
}

describe('live Clerk preview diagnostics over real HTTP', () => {
  it('identifies a stopped preview as safe to start', async () => {
    let stoppedURL = '';
    await withServer((_req, res) => res.end(), async baseURL => { stoppedURL = baseURL; });
    expect(await probeClerkPreview(stoppedURL)).toMatchObject({ ready: false, canStart: true, code: 'PREVIEW_STOPPED' });
  });
  it('accepts an available Clerk-only preview', async () => {
    await withServer((_req, res) => res.end(JSON.stringify({ clerkConfigured: true, localDevAuth: false })), async baseURL => {
      expect(await probeClerkPreview(baseURL)).toEqual({ ready: true, canStart: false });
    });
  });
  it('does not start over an existing preview using local profiles', async () => {
    await withServer((_req, res) => res.end(JSON.stringify({ clerkConfigured: false, localDevAuth: true })), async baseURL => {
      expect(await probeClerkPreview(baseURL)).toMatchObject({ ready: false, canStart: false, code: 'PREVIEW_WRONG_AUTH_MODE' });
    });
  });
  it('reports HTTP errors instead of trying to start a competing server', async () => {
    await withServer((_req, res) => { res.statusCode = 503; res.end('private upstream detail'); }, async baseURL => {
      const result = await probeClerkPreview(baseURL);
      expect(result).toMatchObject({ canStart: false, code: 'PREVIEW_HTTP_ERROR' });
      expect(result.message).toContain('503'); expect(result.message).not.toContain('private');
    });
  });
  it('distinguishes HTML from a valid configuration response', async () => {
    await withServer((_req, res) => res.end('<html>unrelated server</html>'), async baseURL => {
      expect(await probeClerkPreview(baseURL)).toMatchObject({ canStart: false, code: 'PREVIEW_INVALID_RESPONSE' });
    });
  });
  it('does not start over an unresponsive server', async () => {
    await withServer(() => {}, async baseURL => {
      expect(await probeClerkPreview(baseURL, 30)).toMatchObject({ canStart: false, code: 'PREVIEW_TIMEOUT' });
    });
  });
});
