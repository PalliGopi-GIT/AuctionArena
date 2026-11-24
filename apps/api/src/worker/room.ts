import type { User } from '../../../../packages/shared/src/domain';
import type { DurableObjectStubLike, WorkerEnv } from './types';

export const ROOM_CODE_PATTERN = /^[A-F0-9]{6}$/;
export const PRIVATE_ROOM_MESSAGE = 'Room unavailable. Check your invitation or ask the host for access.';
/** Normalize before idFromName so invalid/private probes never reach an object. */
export function normalizeRoomCode(value: string | undefined | null): string | null {
  if (!value) return null;
  const code = value.toUpperCase();
  return ROOM_CODE_PATTERN.test(code) ? code : null;
}
export function roomStub(env: WorkerEnv, code: string): DurableObjectStubLike {
  return env.ROOM.get(env.ROOM.idFromName(code));
}
const INTERNAL_HEADERS = ['authorization', 'cookie', 'x-auction-subject', 'x-auction-user-id',
  'x-auction-user-name', 'x-auction-room-code', 'x-auction-request-id', 'x-auction-operation',
  'x-auction-local-forward-at'];
/**
 * Headers are trusted only because a room object is reachable through this
 * Worker binding. Client-supplied copies are removed before forwarding.
 */
export function internalHeaders(request: Request, user: User | null, code: string, requestId: string): Headers {
  const headers = new Headers(request.headers);
  for (const name of INTERNAL_HEADERS) headers.delete(name);
  headers.set('X-Auction-Room-Code', code);
  headers.set('X-Auction-Request-Id', requestId);
  if (user) {
    headers.set('X-Auction-User-Id', user.id);
    headers.set('X-Auction-User-Name', encodeURIComponent(user.name));
  }
  return headers;
}
export async function forwardToRoom(stub: DurableObjectStubLike, request: Request, headers: Headers, body?: string): Promise<Response> {
  const init: RequestInit & { duplex?: 'half' } = { method: request.method, headers };
  if (body !== undefined) init.body = body;
  else if (request.method !== 'GET' && request.method !== 'HEAD' && request.body) {
    init.body = request.body;
    init.duplex = 'half';
  }
  return stub.fetch(new Request(request.url, init));
}
