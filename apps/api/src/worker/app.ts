import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { bodyLimit } from 'hono/body-limit';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { z } from 'zod';
import { settingsSchema } from '../../../../packages/shared/src/index';
import { normalizeProfileName, profileNameError } from '../../../../packages/shared/src/profile-rules';
import { RuleError } from '../../../../packages/engine/src/index';
import { allowedOrigins, verifyClerkIdentity } from '../clerk-auth';
import { clerkUserDeletion, clerkUserRename } from '../accounts';
import {
  completeDeletion, DirectoryClientError, exportUser, isUserDeleted, listUserRooms,
  markProviderDeleted, requestAccountDeletion, retryDeletion,
} from './directory';
import { forwardToRoom, internalHeaders, normalizeRoomCode, PRIVATE_ROOM_MESSAGE, roomStub } from './room';
import { signSocketTicket, verifySocketTicket } from './ticket';
import type { IdentityVerifier, VerifiedIdentity, WorkerContext, WorkerEnv } from './types';

export interface WorkerAppOptions {
  /** Injectable for local tests; production uses the real Clerk SDK verifier. */
  verify?: IdentityVerifier;
  generateCode?: () => string;
  now?: () => number;
  rateLimit?: number;
  /** Injectable for tests and for a future non-Clerk identity provider. */
  deleteIdentity?: (userId: string, env: WorkerEnv) => Promise<void>;
  /** Display-name updates; defaults to the Clerk Backend API when a secret key exists. */
  renameIdentity?: (userId: string, name: string, env: WorkerEnv) => Promise<void>;
  /** Defaults to true when the real Clerk verifier is used. */
  requireReverification?: boolean;
}
const PUBLIC_PATHS = new Set(['/api/health', '/api/config']);
const DEFAULT_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'];
function requestId() { return crypto.randomUUID().replace(/-/g, '').slice(0, 16); }
function originsFor(env: WorkerEnv): string[] {
  const raw = env.ALLOWED_ORIGINS?.trim();
  return allowedOrigins(raw ? raw.split(',').map(value => value.trim()).filter(Boolean) : DEFAULT_ORIGINS);
}
function generateRoomCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(3));
  return Array.from(bytes).map(byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
}
const defaultVerify: IdentityVerifier = async (token, env) => {
  const identity = await verifyClerkIdentity(token, {
    secretKey: env.CLERK_SECRET_KEY, jwtKey: env.CLERK_JWT_KEY, issuer: env.CLERK_ISSUER, authorizedParties: originsFor(env),
  });
  return { ...identity.user, ...(identity.firstFactorAge === undefined ? {} : { firstFactorAge: identity.firstFactorAge }) };
};
export function createWorkerApp(options: WorkerAppOptions = {}) {
  const app = new Hono<WorkerContext>();
  const verifier = options.verify ?? defaultVerify;
  const requiresConfig = !options.verify;
  const requireReverification = options.requireReverification ?? requiresConfig;
  const nextCode = options.generateCode ?? generateRoomCode;
  const now = options.now ?? Date.now;
  const limitPerSecond = options.rateLimit ?? 25;
  const deleteIdentity = options.deleteIdentity ?? (async (userId, env) => {
    const remove = clerkUserDeletion(env.CLERK_SECRET_KEY);
    if (!remove) throw new DirectoryClientError(503, 'DELETION_UNAVAILABLE', 'Account deletion is not configured.');
    await remove(userId);
  });
  const renameIdentity = options.renameIdentity ?? (async (userId, name, env) => {
    const rename = clerkUserRename(env.CLERK_SECRET_KEY);
    if (!rename) throw new DirectoryClientError(503, 'PROFILE_UPDATE_UNAVAILABLE', 'Display name updates are not configured.');
    await rename(userId, name);
  });
  const directoryFailure = (c: Context<WorkerContext>, error: unknown) => {
    if (error instanceof DirectoryClientError) {
      const status = error.status === 503 ? 503 : error.status >= 400 && error.status < 500 ? error.status : 502;
      return c.json({ code: error.code, message: error.message, requestId: c.get('requestId') }, status as ContentfulStatusCode);
    }
    console.error('Worker directory request failed', c.get('requestId'), (error as Error).message);
    return c.json({ code: 'SERVICE_ERROR', message: 'The service could not complete this request.', requestId: c.get('requestId') }, 500);
  };
  // Best effort per isolate. It is not a global quota; a durable limiter is future work.
  const buckets = new Map<string, { at: number; count: number }>();
  const rateLimited = (userId: string) => {
    const at = now(), bucket = buckets.get(userId);
    if (!bucket || at - bucket.at > 1000) { buckets.set(userId, { at, count: 1 }); return false; }
    bucket.count++;
    if (buckets.size > 10000) buckets.clear();
    return bucket.count > limitPerSecond;
  };
  const privateRoom = (c: Context<WorkerContext>) => c.json({
    code: 'ROOM_NOT_FOUND', message: PRIVATE_ROOM_MESSAGE, requestId: c.get('requestId'),
  }, 404);
  const forwardRoom = (c: Context<WorkerContext>) => {
    const code = normalizeRoomCode(c.req.param('code'));
    if (!code) return privateRoom(c);
    const request = c.req.raw;
    const headers = internalHeaders(request, c.get('user'), code, c.get('requestId'));
    if (c.env.LOCAL_BID_TIMING === '1' && request.method === 'POST' && c.req.path.endsWith('/actions')) {
      headers.set('X-Auction-Local-Forward-At', String(Date.now()));
    }
    return forwardToRoom(roomStub(c.env, code), request, headers);
  };

  app.use('*', async (c, next) => {
    const measure = c.env.LOCAL_BID_TIMING === '1';
    const ingress = measure ? Date.now() : 0;
    c.set('requestId', requestId());
    await next();
    if (measure && (c.req.path === '/api/health' || c.res.headers.has('X-Auction-Local-Trace'))) {
      c.header('X-Auction-Local-Worker', `${ingress},${Date.now()}`);
    }
  });
  app.use('/api/*', async (c, next) => {
    try { originsFor(c.env); } catch { return c.json({ code: 'CONFIGURATION_ERROR', message: 'Allowed origins are not configured.' }, 503); }
    await next();
  });
  app.use('/api/*', cors({ origin: (origin, c) => originsFor(c.env).includes(origin) ? origin : undefined }));
  app.use('/api/*', bodyLimit({
    maxSize: 4096,
    onError: c => c.json({ code: 'PAYLOAD_TOO_LARGE', message: 'Request body exceeds the allowed size.', requestId: c.get('requestId') }, 413),
  }));
  app.onError((error, c) => {
    const id = c.get('requestId') ?? requestId();
    if (error instanceof RuleError) return c.json({ code: error.code, message: error.message, requestId: id },
      error.code === 'ROOM_NOT_FOUND' ? 404
        : ['FORBIDDEN', 'ROOM_BLOCKED', 'HOST_ONLY'].includes(error.code) ? 403
          : error.code === 'ROOM_ACTIVE' ? 409 : 400);
    if (error instanceof z.ZodError) return c.json({ code: 'INVALID_INPUT', message: error.issues.map(issue => issue.message).join('; '), requestId: id }, 400);
    console.error('Worker request failed', id, (error as Error).message);
    return c.json({ code: 'SERVICE_ERROR', message: 'The service could not confirm this action. Please reconnect.', requestId: id }, 500);
  });

  app.get('/api/health', c => c.json({ ok: true, mode: 'cloudflare-worker', maxMembers: 20 }));
  app.get('/api/config', c => c.json({ localDevAuth: false, clerkConfigured: !!(c.env.CLERK_SECRET_KEY || c.env.CLERK_JWT_KEY) }));

  app.use('/api/*', async (c, next) => {
    if (PUBLIC_PATHS.has(c.req.path)) return next();
    const authorization = c.req.header('Authorization');
    if (!authorization?.startsWith('Bearer ')) return c.json({ code: 'UNAUTHORIZED', message: 'Sign in to continue.' }, 401);
    if (requiresConfig && !c.env.CLERK_SECRET_KEY && !c.env.CLERK_JWT_KEY) {
      return c.json({ code: 'AUTH_NOT_CONFIGURED', message: 'Authentication is not configured.' }, 503);
    }
    const measure = c.env.LOCAL_BID_TIMING === '1' && c.req.method === 'POST' && c.req.path.endsWith('/actions');
    const started = measure ? performance.now() : 0;
    let verified: VerifiedIdentity;
    try { verified = await verifier(authorization.slice(7), c.env); }
    catch { return c.json({ code: 'SESSION_EXPIRED', message: 'Your session expired. Please sign in again.' }, 401); }
    if (!verified?.id || typeof verified.name !== 'string' || !verified.name.trim()) {
      return c.json({ code: 'SESSION_EXPIRED', message: 'Your session expired. Please sign in again.' }, 401);
    }
    const expectedSubject = c.req.header('X-Auction-Subject');
    if (expectedSubject && expectedSubject !== verified.id) {
      return c.json({ code: 'ACCOUNT_CHANGED', message: 'Account changed. Reopen this action from the current account.' }, 409);
    }
    if (rateLimited(verified.id)) return c.json({ code: 'RATE_LIMITED', message: 'Too many requests. Please wait a moment.' }, 429);
    c.set('user', { id: verified.id, name: verified.name });
    c.set('firstFactorAge', verified.firstFactorAge);
    const forwarded = measure ? performance.now() : 0;
    await next();
    const roomTiming = measure ? c.res.headers.get('Server-Timing') : null;
    if (roomTiming) c.header('Server-Timing', `${roomTiming}, auth;dur=${(forwarded - started).toFixed(3)}, worker_forward;dur=${(performance.now() - forwarded).toFixed(3)}`);
  });

  app.get('/api/me', async c => {
    const user = c.get('user');
    if (!c.env.DIRECTORY) return c.json({ user, rooms: [] });
    try {
      if (await isUserDeleted(c.env, user.id)) {
        return c.json({ code: 'ACCOUNT_DELETED', message: 'This account no longer has access.', requestId: c.get('requestId') }, 410);
      }
      return c.json({ user, rooms: await listUserRooms(c.env, user.id) });
    } catch (error) { return directoryFailure(c, error); }
  });

  // The browser edits display names with PATCH /api/me. The provider owns the
  // name so the next session token carries it into room membership and actions.
  app.patch('/api/me', async c => {
    let input: unknown;
    try { input = await c.req.json(); } catch { input = undefined; }
    const parsed = z.object({ displayName: z.string() }).strict().safeParse(input);
    if (!parsed.success) {
      return c.json({ code: 'INVALID_INPUT', message: 'Enter a display name.', requestId: c.get('requestId') }, 400);
    }
    const name = normalizeProfileName(parsed.data.displayName);
    const invalid = profileNameError(name);
    if (invalid) {
      return c.json({ code: 'INVALID_NAME', message: invalid, requestId: c.get('requestId') }, 400);
    }
    const user = c.get('user');
    try { await renameIdentity(user.id, name, c.env); }
    catch (error) { return directoryFailure(c, error); }
    // Existing room labels are updated through the same binding. The provider
    // name is already authoritative; a lagging projection is reported, not fatal.
    let pendingRooms: string[] = [];
    if (c.env.DIRECTORY) {
      try {
        const rooms = await listUserRooms(c.env, user.id);
        const results = await Promise.all(rooms.map(async room => {
          try {
            const response = await roomStub(c.env, room.code).fetch(new Request(
              `https://room.internal/internal/users/${encodeURIComponent(user.id)}/profile`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  'X-Auction-Operation': 'update-profile',
                  'X-Auction-Request-Id': c.get('requestId'),
                },
                body: JSON.stringify({ name }),
              }));
            return response.ok ? null : room.code;
          } catch { return room.code; }
        }));
        pendingRooms = results.filter((code): code is string => code !== null);
      } catch (error) {
        console.error('Worker profile fan-out failed', c.get('requestId'), (error as Error).message);
      }
    }
    return c.json({ user: { id: user.id, name }, ...(pendingRooms.length ? { pendingRooms } : {}) });
  });

  app.get('/api/me/export', async c => {
    if (!c.env.DIRECTORY) {
      return c.json({ code: 'EXPORT_UNAVAILABLE', message: 'Account export is not configured.', requestId: c.get('requestId') }, 503);
    }
    const user = c.get('user');
    try {
      const exported = await exportUser(c.env, user.id, user.name, now());
      const date = new Date(now()).toISOString().slice(0, 10);
      return c.body(JSON.stringify(exported, null, 2), 200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Disposition': `attachment; filename="auctionarena-export-${date}.json"`,
        'Cache-Control': 'no-store',
      });
    } catch (error) { return directoryFailure(c, error); }
  });

  // Deletion is deliberately explicit: a fresh first factor, a typed confirmation,
  // no active hosted room, then provider deletion before room fan-out.
  app.delete('/api/me', async c => {
    const user = c.get('user');
    if (requireReverification && (c.get('firstFactorAge') === undefined || c.get('firstFactorAge')! >= 5)) {
      return c.json({ clerk_error: {
        type: 'forbidden', reason: 'reverification-error',
        metadata: { reverification: { level: 'first_factor', afterMinutes: 5 } },
      } }, 403);
    }
    let input: unknown;
    try { input = await c.req.json(); }
    catch { return c.json({ code: 'CONFIRMATION_REQUIRED', message: 'Type DELETE MY ACCOUNT to confirm.', requestId: c.get('requestId') }, 400); }
    const confirmation = z.object({ confirmation: z.literal('DELETE MY ACCOUNT') }).strict().safeParse(input);
    if (!confirmation.success) {
      return c.json({ code: 'CONFIRMATION_REQUIRED', message: 'Type DELETE MY ACCOUNT to confirm.', requestId: c.get('requestId') }, 400);
    }
    if (!c.env.DIRECTORY || (!options.deleteIdentity && !c.env.CLERK_SECRET_KEY)) {
      return c.json({ code: 'DELETION_UNAVAILABLE', message: 'Account deletion is not configured.', requestId: c.get('requestId') }, 503);
    }
    try {
      if (!await isUserDeleted(c.env, user.id)) {
        const rooms = await listUserRooms(c.env, user.id);
        if (rooms.some(room => room.role === 'host' && !['COMPLETED', 'CLOSED'].includes(room.status))) {
          return c.json({ code: 'ACTIVE_HOSTED_ROOMS', message: 'End or close your hosted auctions before deleting your account.', requestId: c.get('requestId') }, 409);
        }
      }
      let job = await requestAccountDeletion(c.env, user.id, now());
      if (job.completedAt !== null) {
        return c.json({ accepted: true, message: 'Account deletion is queued. Access has ended.', completed: true }, 202);
      }
      if (job.rooms.some(room => room.role === 'host' && !['COMPLETED', 'CLOSED'].includes(room.status))) {
        return c.json({ code: 'ACTIVE_HOSTED_ROOMS', message: 'End or close your hosted auctions before deleting your account.', requestId: c.get('requestId') }, 409);
      }
      if (!job.providerDeleted) {
        try { await deleteIdentity(user.id, c.env); }
        catch (error) {
          await retryDeletion(c.env, user.id, now());
          return directoryFailure(c, error instanceof DirectoryClientError ? error
            : new DirectoryClientError(502, 'DELETION_INCOMPLETE', 'Account access has ended, but the identity provider could not be updated yet.'));
        }
        job = await markProviderDeleted(c.env, user.id, now());
      }
      const removedRooms: string[] = [], failed: string[] = [];
      for (const room of job.rooms) {
        try {
          const response = await roomStub(c.env, room.code).fetch(new Request(
            `https://room.internal/internal/users/${encodeURIComponent(user.id)}/delete`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'X-Auction-Operation': 'delete-user',
                'X-Auction-Request-Id': c.get('requestId'),
              },
            }));
          if (!response.ok) { failed.push(room.code); continue; }
          const result = await response.json() as { removed?: unknown; missing?: unknown };
          if (result.removed === true || result.missing === true) removedRooms.push(room.code);
        } catch { failed.push(room.code); }
      }
      if (failed.length) {
        await retryDeletion(c.env, user.id, now());
        return c.json({
          code: 'DELETION_INCOMPLETE', message: 'Account access has ended, but some rooms could not be updated yet.',
          pendingRooms: failed, requestId: c.get('requestId'),
        }, 502);
      }
      const completed = await completeDeletion(c.env, user.id, removedRooms, now());
      return c.json({ accepted: true, message: 'Account deletion is queued. Access has ended.', completed: completed.completedAt !== null }, 202);
    } catch (error) { return directoryFailure(c, error); }
  });

  app.post('/api/rooms', async c => {
    const raw = await c.req.text();
    let parsed: unknown;
    try { parsed = JSON.parse(raw); }
    catch { return c.json({ code: 'INVALID_INPUT', message: 'Request body must be valid JSON.', requestId: c.get('requestId') }, 400); }
    const settings = settingsSchema.parse(parsed);
    const body = JSON.stringify(settings), request = c.req.raw;
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = normalizeRoomCode(nextCode());
      if (!code) throw new Error('Room code generator produced an invalid code.');
      const response = await forwardToRoom(roomStub(c.env, code), request,
        internalHeaders(request, c.get('user'), code, c.get('requestId')), body);
      if (response.status !== 409) return response;
    }
    return c.json({ code: 'ROOM_CODE_UNAVAILABLE', message: 'Could not allocate a room code. Try again.', requestId: c.get('requestId') }, 503);
  });
  app.post('/api/rooms/:code/join', forwardRoom);
  app.get('/api/rooms/:code', forwardRoom);
  app.delete('/api/rooms/:code', async c => {
    const code = normalizeRoomCode(c.req.param('code'));
    if (!code) return privateRoom(c);
    const headers = internalHeaders(c.req.raw, c.get('user'), code, c.get('requestId'));
    headers.set('X-Auction-Operation', 'delete-room');
    // The room object owns ownership/status checks, the storage wipe and the
    // idempotent directory cleanup. A retry reaches it again as already deleted.
    return forwardToRoom(roomStub(c.env, code), c.req.raw, headers);
  });
  app.get('/api/rooms/:code/history', forwardRoom);
  app.get('/api/rooms/:code/plan', forwardRoom);
  app.get('/api/rooms/:code/plan/export', forwardRoom);
  app.get('/api/rooms/:code/sync', forwardRoom);
  app.post('/api/rooms/:code/actions', forwardRoom);
  app.post('/api/rooms/:code/invite', forwardRoom);
  app.post('/api/rooms/:code/ws-ticket', async c => {
    const code = normalizeRoomCode(c.req.param('code'));
    if (!code) return privateRoom(c);
    if (!c.env.WS_TICKET_SECRET) return c.json({ code: 'SOCKET_NOT_CONFIGURED', message: 'Socket tickets are not configured.' }, 503);
    const user = c.get('user'), request = c.req.raw;
    const headers = internalHeaders(request, user, code, c.get('requestId'));
    headers.set('X-Auction-Operation', 'authorize');
    const authorized = await forwardToRoom(roomStub(c.env, code), new Request(request.url, { method: 'GET' }), headers);
    if (!authorized.ok) return authorized;
    const ticket = await signSocketTicket(c.env.WS_TICKET_SECRET, { room: code, sub: user.id, name: user.name, exp: now() + 30000 });
    return c.json({ ticket });
  });

  // The ticket, not a bearer header, authorizes the socket. The object rechecks membership.
  app.get('/ws', async c => {
    const code = normalizeRoomCode(c.req.query('room'));
    if (!code) return privateRoom(c);
    if (!c.env.WS_TICKET_SECRET) return c.json({ code: 'SOCKET_NOT_CONFIGURED', message: 'Socket tickets are not configured.' }, 503);
    const protocol = c.req.header('Sec-WebSocket-Protocol')?.split(',').map(value => value.trim()).find(value => value.startsWith('ticket.'));
    const ticket = await verifySocketTicket(c.env.WS_TICKET_SECRET, protocol?.slice(7) ?? '', now());
    if (!ticket || ticket.room !== code) return c.json({ code: 'UNAUTHORIZED', message: 'Socket ticket is invalid or expired.' }, 401);
    const request = c.req.raw;
    return forwardToRoom(roomStub(c.env, code), request, internalHeaders(request, { id: ticket.sub, name: ticket.name }, code, c.get('requestId')));
  });

  app.all('/api/*', c => c.json({ code: 'NOT_FOUND', message: 'Not found.', requestId: c.get('requestId') }, 404));
  app.all('*', c => c.env.ASSETS.fetch(c.req.raw));
  return app;
}
