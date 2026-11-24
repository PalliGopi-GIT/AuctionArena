import { z } from 'zod';
import type { Room, User } from '../../../../packages/shared/src/domain';
import type { SqlDriver } from '../../../../packages/storage/src/port';
import { DirectoryError, SqliteRoomDirectory, type DeletionJob } from '../../../../packages/directory/src/index';
import type { DoStorage } from './room-do';

export interface DirectoryStateLike { storage: DoStorage }
function doDriver(storage: DoStorage): SqlDriver {
  return {
    all: (query, ...bindings) => storage.sql.exec(query, ...bindings).toArray(),
    run: (query, ...bindings) => { storage.sql.exec(query, ...bindings).toArray(); },
    transaction: callback => storage.transactionSync(callback),
  };
}
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}
function errorResponse(error: unknown): Response {
  if (error instanceof DirectoryError) {
    const status = error.code === 'ACCOUNT_DELETED' ? 410 : error.code === 'DELETION_NOT_FOUND' ? 404 : 400;
    return json({ code: error.code, message: error.message }, status);
  }
  if (error instanceof z.ZodError) return json({ code: 'INVALID_INPUT', message: error.issues.map(issue => issue.message).join('; ') }, 400);
  console.error('Directory object request failed', (error as Error).message);
  return json({ code: 'SERVICE_ERROR', message: 'The directory could not complete this request.' }, 500);
}
function decodeSegment(value: string): string | null {
  try { const decoded = decodeURIComponent(value); return decoded ? decoded : null; } catch { return null; }
}
function time(value: unknown): number {
  const parsed = Number(value ?? Date.now());
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new DirectoryError('INVALID_DIRECTORY_STATE', 'A valid timestamp is required.');
  return parsed;
}
async function body(request: Request): Promise<Record<string, unknown>> {
  try { const parsed = await request.json(); return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}; }
  catch { throw new DirectoryError('INVALID_DIRECTORY_STATE', 'Request body must be valid JSON.'); }
}
function roomFrom(value: unknown): Room {
  const room = value as Room;
  if (!room || typeof room !== 'object' || typeof room.code !== 'string' || !Array.isArray(room.members) || !Array.isArray(room.players) || !Array.isArray(room.teams) || !Number.isSafeInteger(room.version) || !Number.isSafeInteger(room.createdAt)) {
    throw new DirectoryError('INVALID_DIRECTORY_STATE', 'A valid room snapshot is required.');
  }
  return room;
}

/**
 * One global SQLite-backed projection for discovery, archives, export and
 * deletion. Room objects remain the only writers of live auction state. Every
 * room-originated write is idempotent and version-guarded, so delayed outbox
 * deliveries are harmless.
 */
export class DirectoryDurableObject {
  readonly directory: SqliteRoomDirectory;
  constructor(private ctx: DirectoryStateLike) {
    this.directory = new SqliteRoomDirectory(doDriver(ctx.storage));
  }
  async fetch(request: Request): Promise<Response> {
    try {
      const internal = request.headers.get('X-Auction-Internal');
      if (internal !== 'room' && internal !== 'worker') {
        return json({ code: 'FORBIDDEN', message: 'Internal access only.' }, 403);
      }
      const url = new URL(request.url), path = url.pathname;
      if (path === '/internal/rooms' && request.method === 'POST') {
        const input = await body(request);
        const participants = Array.isArray(input.participants)
          ? input.participants.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 200)
          : [];
        return json({ room: this.directory.upsertRoom(roomFrom(input.room), time(input.now), participants) });
      }
      const roomRemove = /^\/internal\/rooms\/([A-F0-9]{6})\/remove$/.exec(path);
      if (roomRemove && request.method === 'POST') {
        const input = await body(request), version = Number(input.version);
        if (!Number.isSafeInteger(version) || version < 0) {
          return json({ code: 'INVALID_INPUT', message: 'A valid room version is required.' }, 400);
        }
        return json({ removed: this.directory.removeRoom(roomRemove[1]!, version) });
      }
      const roomDelete = /^\/internal\/rooms\/([A-F0-9]{6})\/delete$/.exec(path);
      if (roomDelete && request.method === 'POST') {
        const input = await body(request);
        return json({ deleted: true, removed: this.directory.deleteRoom(roomDelete[1]!, time(input.now)) });
      }
      const roomArchive = /^\/internal\/rooms\/([A-F0-9]{6})\/archive$/.exec(path);
      if (roomArchive && request.method === 'POST') {
        const input = await body(request), archive = this.directory.archive(roomFrom(input.room), time(input.now));
        return archive ? json({ archive }) : json({ code: 'NOT_ENDED', message: 'Only completed rooms can be archived.' }, 409);
      }
      const userRooms = /^\/internal\/users\/([^/]+)\/rooms$/.exec(path);
      if (userRooms && request.method === 'GET') {
        const userId = decodeSegment(userRooms[1]!);
        if (!userId) return json({ code: 'INVALID_INPUT', message: 'A user ID is required.' }, 400);
        return json({ rooms: this.directory.listRooms(userId) });
      }
      const userExport = /^\/internal\/users\/([^/]+)\/export$/.exec(path);
      if (userExport && request.method === 'GET') {
        const userId = decodeSegment(userExport[1]!), name = decodeSegment(url.searchParams.get('name') ?? '');
        if (!userId || !name) return json({ code: 'INVALID_INPUT', message: 'A user ID and name are required.' }, 400);
        const user: User = { id: userId, name };
        return json(this.directory.exportUser(user, time(url.searchParams.get('now') ?? undefined)));
      }
      const userDeleted = /^\/internal\/users\/([^/]+)\/deleted$/.exec(path);
      if (userDeleted && request.method === 'GET') {
        const userId = decodeSegment(userDeleted[1]!);
        if (!userId) return json({ code: 'INVALID_INPUT', message: 'A user ID is required.' }, 400);
        return json({ deleted: this.directory.isDeleted(userId) });
      }
      const deletion = /^\/internal\/users\/([^/]+)\/deletion(?:\/(provider|retry|complete))?$/.exec(path);
      if (deletion) {
        const userId = decodeSegment(deletion[1]!), action = deletion[2];
        if (!userId) return json({ code: 'INVALID_INPUT', message: 'A user ID is required.' }, 400);
        if (!action && request.method === 'GET') {
          const job = this.directory.deletionJob(userId);
          return job ? json({ job }) : json({ code: 'DELETION_NOT_FOUND', message: 'Account deletion job was not found.' }, 404);
        }
        if (request.method !== 'POST') return json({ code: 'NOT_FOUND', message: 'Not found.' }, 404);
        const input = await body(request), at = time(input.now);
        let job: DeletionJob;
        if (action === 'provider') job = this.directory.markProviderDeleted(userId, at);
        else if (action === 'retry') job = this.directory.retryDeletion(userId, at);
        else if (action === 'complete') {
          const removed = Array.isArray(input.removedRooms) ? input.removedRooms.filter((code): code is string => typeof code === 'string') : [];
          job = this.directory.completeDeletion(userId, at, removed);
        } else job = this.directory.requestDeletion(userId, at);
        return json({ job });
      }
      return json({ code: 'NOT_FOUND', message: 'Not found.' }, 404);
    } catch (error) { return errorResponse(error); }
  }
}
