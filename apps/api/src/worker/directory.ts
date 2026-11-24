import type { DeletionJob, DirectoryExport, RoomListing } from '../../../../packages/directory/src/index';
import type { DurableObjectStubLike, WorkerEnv } from './types';

/** The directory is an internal binding; requests never come from a client. */
const INTERNAL_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'X-Auction-Internal': 'worker',
};

export class DirectoryClientError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

function stub(env: WorkerEnv): DurableObjectStubLike {
  if (!env.DIRECTORY) {
    throw new DirectoryClientError(503, 'DIRECTORY_UNAVAILABLE', 'The account directory is not configured.');
  }
  return env.DIRECTORY.get(env.DIRECTORY.idFromName('global'));
}

async function call<T>(env: WorkerEnv, path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(INTERNAL_HEADERS);
  if (init.headers) new Headers(init.headers).forEach((value, key) => headers.set(key, value));
  let response: Response;
  try {
    response = await stub(env).fetch(new Request(`https://directory.internal${path}`, { ...init, headers }));
  } catch {
    throw new DirectoryClientError(502, 'DIRECTORY_UNAVAILABLE', 'The account directory is unavailable.');
  }
  let body: Record<string, unknown> = {};
  try { body = await response.json() as Record<string, unknown>; }
  catch { /* A malformed response is handled below. */ }
  if (!response.ok) {
    const code = typeof body.code === 'string' ? body.code : 'DIRECTORY_ERROR';
    const message = typeof body.message === 'string' ? body.message : 'The account directory could not complete this request.';
    throw new DirectoryClientError(response.status, code, message);
  }
  return body as T;
}

function listings(body: { rooms?: unknown }): RoomListing[] {
  if (!Array.isArray(body.rooms)) {
    throw new DirectoryClientError(502, 'DIRECTORY_UNAVAILABLE', 'The account directory returned an invalid response.');
  }
  return body.rooms as RoomListing[];
}
function job(body: { job?: unknown }): DeletionJob {
  if (!body.job || typeof body.job !== 'object') {
    throw new DirectoryClientError(502, 'DIRECTORY_UNAVAILABLE', 'The account directory returned an invalid deletion job.');
  }
  return body.job as DeletionJob;
}

export async function listUserRooms(env: WorkerEnv, userId: string): Promise<RoomListing[]> {
  return listings(await call<{ rooms?: unknown }>(env, `/internal/users/${encodeURIComponent(userId)}/rooms`));
}
export async function deleteRoom(env: WorkerEnv, code: string, now: number): Promise<void> {
  await call<{ deleted?: unknown }>(env, `/internal/rooms/${code}/delete`, {
    method: 'POST', body: JSON.stringify({ now }),
  });
}
export async function isUserDeleted(env: WorkerEnv, userId: string): Promise<boolean> {
  const body = await call<{ deleted?: unknown }>(env, `/internal/users/${encodeURIComponent(userId)}/deleted`);
  return body.deleted === true;
}
export async function exportUser(env: WorkerEnv, userId: string, name: string, now: number): Promise<DirectoryExport> {
  return call<DirectoryExport>(env,
    `/internal/users/${encodeURIComponent(userId)}/export?name=${encodeURIComponent(name)}&now=${now}`);
}
export async function requestAccountDeletion(env: WorkerEnv, userId: string, now: number): Promise<DeletionJob> {
  return job(await call<{ job?: unknown }>(env, `/internal/users/${encodeURIComponent(userId)}/deletion`, {
    method: 'POST', body: JSON.stringify({ now }),
  }));
}
export async function markProviderDeleted(env: WorkerEnv, userId: string, now: number): Promise<DeletionJob> {
  return job(await call<{ job?: unknown }>(env, `/internal/users/${encodeURIComponent(userId)}/deletion/provider`, {
    method: 'POST', body: JSON.stringify({ now }),
  }));
}
export async function retryDeletion(env: WorkerEnv, userId: string, now: number): Promise<DeletionJob> {
  return job(await call<{ job?: unknown }>(env, `/internal/users/${encodeURIComponent(userId)}/deletion/retry`, {
    method: 'POST', body: JSON.stringify({ now }),
  }));
}
export async function completeDeletion(env: WorkerEnv, userId: string, removedRooms: string[], now: number): Promise<DeletionJob> {
  return job(await call<{ job?: unknown }>(env, `/internal/users/${encodeURIComponent(userId)}/deletion/complete`, {
    method: 'POST', body: JSON.stringify({ now, removedRooms }),
  }));
}
