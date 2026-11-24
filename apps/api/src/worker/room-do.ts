import { z } from 'zod';
import { isDeletableRoomStatus, type Room, type User } from '../../../../packages/shared/src/domain';
import { actionSchema, settingsSchema } from '../../../../packages/shared/src/index';
import { normalizeProfileName, profileNameError } from '../../../../packages/shared/src/profile-rules';
import { createRoom, event, RuleError } from '../../../../packages/engine/src/index';
import { advanceRoom, applyStoredAction, type StoredRoom } from '../../../../packages/room-runtime/src/record';
import { recoverRoomOnWake, validateRoomRecovery } from '../../../../packages/room-runtime/src/recovery';
import { anonymizeUserInRoom } from '../../../../packages/room-runtime/src/deletion';
import { SNAPSHOT_EVENTS, roomSnapshot, type HistoryPage } from '../../../../packages/shared/src/room-sync';
import { catalog } from '../../../../packages/catalog/src/index';
import { buildPlanPreview, planCsv, withPlanSeed } from '../../../../packages/catalog/src/room-plan';
import type { SqlDriver, SqlValue } from '../../../../packages/storage/src/port';
import { SqliteRoomStorage } from '../../../../packages/storage/src/sqlite-room';
import type { DurableObjectNamespaceLike } from './types';

const ROOM_CODE_PATTERN = /^[A-F0-9]{6}$/;
const PRIVATE_ROOM_MESSAGE = 'Room unavailable. Check your invitation or ask the host for access.';
const INVITE_TTL_MS = 86400000;
const MAX_MEMBERS = 20;
const HEARTBEAT_TIMEOUT_MS = 10000;
const encoder = new TextEncoder();

export interface DoSqlCursor { toArray(): Record<string, SqlValue>[] }
export interface DoSql { exec(query: string, ...bindings: SqlValue[]): DoSqlCursor }
export interface DoStorage {
  sql: DoSql;
  transactionSync<T>(callback: () => T): T;
  setAlarm(at: number): Promise<void>;
  deleteAlarm(): Promise<void>;
  getAlarm(): Promise<number | null>;
  /** Durable Object storage primitive: removes SQL, alarms and key-value data. */
  deleteAll(): Promise<void>;
}
export interface WebSocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  readyState: number;
  bufferedAmount?: number;
  serializeAttachment?(value: unknown): void;
  deserializeAttachment?(): unknown;
}
export interface DurableObjectStateLike {
  storage: DoStorage;
  acceptWebSocket(socket: WebSocketLike, tags?: string[]): void;
  getWebSockets(tag?: string): WebSocketLike[];
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
}
interface WebSocketPairLike { 0: WebSocketLike; 1: WebSocketLike }
interface SocketAttachment { userId: string; name: string }
export interface RoomDurableObjectEnv { DIRECTORY?: DurableObjectNamespaceLike; LOCAL_BID_TIMING?: string }
type BidTiming = Record<string, number>;
interface LocalActionTrace {
  forwardAt: number;
  receivedAt: number;
  readyAt: number;
}

function json(body: unknown, status = 200, requestId?: string): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...(requestId ? { 'X-Auction-Request-Id': requestId } : {}) },
  });
}
function privateRoom(requestId?: string): Response {
  return json({ code: 'ROOM_NOT_FOUND', message: PRIVATE_ROOM_MESSAGE, ...(requestId ? { requestId } : {}) }, 404);
}
function requestIdOf(request: Request): string {
  return request.headers.get('X-Auction-Request-Id') ?? crypto.randomUUID().replace(/-/g, '').slice(0, 16);
}
function requestUser(request: Request): User | null {
  const id = request.headers.get('X-Auction-User-Id');
  const encoded = request.headers.get('X-Auction-User-Name');
  if (!id || !encoded) return null;
  try {
    const name = decodeURIComponent(encoded).trim();
    return name ? { id, name: name.slice(0, 60) } : null;
  } catch { return null; }
}
function headerRoomCode(request: Request): string | null {
  const code = request.headers.get('X-Auction-Room-Code');
  return code && ROOM_CODE_PATTERN.test(code) ? code : null;
}
function pathRoomCode(pathname: string): string | null {
  const match = /^\/api\/rooms\/([A-Fa-f0-9]{6})(?:\/|$)/.exec(pathname);
  return match ? match[1]!.toUpperCase() : null;
}
function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function randomToken(): string { return base64url(crypto.getRandomValues(new Uint8Array(32))); }
async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
}
async function jsonBody(request: Request): Promise<unknown> {
  try { return await request.json(); }
  catch { throw new RuleError('INVALID_INPUT', 'Request body must be valid JSON.'); }
}
function doDriver(storage: DoStorage): SqlDriver {
  return {
    all: (query, ...bindings) => storage.sql.exec(query, ...bindings).toArray(),
    run: (query, ...bindings) => { storage.sql.exec(query, ...bindings).toArray(); },
    transaction: callback => storage.transactionSync(callback),
  };
}
/** The cross-room index needs members, teams and results, not event history. */
function indexRoom(room: Room): Room {
  return { ...room, history: [], players: isDeletableRoomStatus(room.status) ? room.players : [] };
}
function heartbeat(room: Room, user: User, now: number, presence?: ReadonlyMap<string, number>) {
  advanceRoom(room, now, presence);
  const member = room.members.find(item => item.id === user.id);
  if (!member) throw new RuleError('ROOM_NOT_FOUND', PRIVATE_ROOM_MESSAGE);
  if (!member.connected) {
    member.connected = true;
    event(room, now, 'connected', `${member.name} reconnected.`, user.id);
  }
  member.lastSeen = now;
}
/** One alarm slot: the next lot deadline, result advance, or host-absence check. */
function nextAlarmAt(room: Room, now: number): number | null {
  if (room.status === 'LIVE' && room.deadline !== null) {
    const host = room.members.find(member => member.id === room.hostId);
    const hostCheck = host?.connected ? host.lastSeen + HEARTBEAT_TIMEOUT_MS : now;
    return Math.max(now + 1, Math.min(room.deadline, hostCheck + 1));
  }
  if (room.status === 'RESULT' && room.settings.autoAdvance && room.resultAt !== null) {
    return Math.max(now + 1, room.resultAt);
  }
  return null;
}
function socketPair(): WebSocketPairLike {
  const Pair = (globalThis as unknown as { WebSocketPair?: new () => WebSocketPairLike }).WebSocketPair;
  if (typeof Pair !== 'function') throw new Error('WebSocketPair is unavailable in this runtime.');
  return new Pair();
}
function errorStatus(code: string): number {
  if (code === 'ROOM_NOT_FOUND') return 404;
  if (code === 'ROOM_ACTIVE' || code === 'ROOM_DELETING') return 409;
  return ['FORBIDDEN', 'ROOM_BLOCKED', 'HOST_ONLY'].includes(code) ? 403 : 400;
}

/**
 * One Durable Object instance owns one room. Authoritative state is always in
 * SQLite; memory is only a cache between requests. Every mutation is a
 * synchronous transaction so a duplicate request or alarm cannot apply twice.
 */
export class RoomDurableObject {
  readonly storage: SqliteRoomStorage;
  readonly ready: Promise<void>;
  /** Socket liveness between durable writes; entries are seeded on wake. */
  private readonly presence = new Map<string, number>();
  /** Last alarm instant written to storage; re-arming an unchanged time is a no-op. */
  private alarmAt: number | null | undefined = undefined;
  /** In-flight deletions block code reuse until the directory tombstone is durable. */
  private deletions = 0;
  constructor(private ctx: DurableObjectStateLike, private env: RoomDurableObjectEnv = {}) {
    this.storage = new SqliteRoomStorage(doDriver(ctx.storage));
    this.ensureOutbox();
    this.ready = ctx.blockConcurrencyWhile(() => this.recover());
  }
  private ensureOutbox() {
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS room_directory_outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, kind TEXT NOT NULL, payload TEXT NOT NULL, created_at INTEGER NOT NULL)');
  }
  private async recover() {
    const now = Date.now(), current = this.storage.read(), live = this.liveUserIds();
    this.seedPresence(now);
    if (!current) return;
    validateRoomRecovery(current.room);
    this.storage.transaction(entry => {
      if (!entry) return { next: null, result: null };
      recoverRoomOnWake(entry.room, now, live);
      this.enqueueDirectory('upsert', entry.room, entry.receipts);
      return { next: entry, result: null };
    });
    await this.scheduleAlarm();
    await this.flushDirectory();
  }
  /** Hibernated sockets survive but this object's memory does not. */
  private liveUserIds(): Set<string> {
    const ids = new Set<string>();
    for (const socket of this.ctx.getWebSockets()) {
      if (socket.readyState !== 1) continue;
      const attachment = socket.deserializeAttachment?.() as SocketAttachment | undefined;
      if (attachment?.userId) ids.add(attachment.userId);
    }
    return ids;
  }
  private seedPresence(now: number) {
    for (const userId of this.liveUserIds()) if (!this.presence.has(userId)) this.presence.set(userId, now);
  }
  /**
   * One room per object means only its newest projection is worth sending.
   * Participants include former members and history authors so a later account
   * deletion can still find every room that retains their details.
   */
  private enqueueDirectory(kind: 'upsert' | 'remove', room: Room, receipts: Record<string, unknown> = {}) {
    if (!this.env.DIRECTORY) return;
    const now = Date.now(), participants = new Set<string>();
    for (const member of room.members) participants.add(member.id);
    for (const id of room.blockedUserIds ?? []) participants.add(id);
    for (const item of room.history) if (item.actorId) participants.add(item.actorId);
    for (const key of Object.keys(receipts)) {
      const separator = key.indexOf(':');
      if (separator > 0) participants.add(key.slice(0, separator));
    }
    const payload = kind === 'remove'
      ? { code: room.code, version: room.version, now }
      : { room: indexRoom(room), participants: [...participants], now };
    this.ctx.storage.sql.exec('DELETE FROM room_directory_outbox');
    this.ctx.storage.sql.exec('INSERT INTO room_directory_outbox (kind, payload, created_at) VALUES (?, ?, ?)', kind, JSON.stringify(payload), now);
  }
  private hasDirectoryOutbox(): boolean {
    return this.ctx.storage.sql.exec('SELECT 1 AS present FROM room_directory_outbox LIMIT 1').toArray().length > 0;
  }
  /**
   * Deliver the newest projection. Flushes are serialized so a remove can never
   * be overtaken by a stale upsert that was already in flight.
   */
  private async flushDirectory(): Promise<void> {
    if (!this.env.DIRECTORY) return;
    while (this.flushing) await this.flushing;
    if (!this.hasDirectoryOutbox()) return;
    this.flushing = this.drainDirectory().finally(() => { this.flushing = null; });
    await this.flushing;
  }
  private flushing: Promise<void> | null = null;
  private async drainDirectory(): Promise<void> {
    try {
      for (let batch = 0; batch < 5; batch++) {
        const rows = this.ctx.storage.sql.exec('SELECT id, kind, payload FROM room_directory_outbox ORDER BY id LIMIT 20').toArray();
        if (!rows.length) return;
        const stub = this.env.DIRECTORY!.get(this.env.DIRECTORY!.idFromName('global'));
        for (const row of rows) {
          const payload = JSON.parse(String(row.payload)) as { room?: Room; code?: string };
          const code = payload.room?.code ?? payload.code;
          if (!code) return;
          const path = row.kind === 'remove' ? `/internal/rooms/${code}/remove` : '/internal/rooms';
          const response = await stub.fetch(new Request(`https://directory.internal${path}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Auction-Internal': 'room' },
            body: JSON.stringify(payload),
          }));
          // A 4xx is permanent (for example an invalid version); retrying it would
          // block every later update. Keep 5xx and transport failures for a retry.
          if (!response.ok && response.status < 500) {
            console.error('Discarding invalid directory outbox entry', row.id, response.status);
            this.ctx.storage.sql.exec('DELETE FROM room_directory_outbox WHERE id=?', row.id);
            continue;
          }
          if (!response.ok) return;
          this.ctx.storage.sql.exec('DELETE FROM room_directory_outbox WHERE id=?', row.id);
        }
      }
    } catch {
      // The outbox stays durable and will be retried by a later request or alarm.
    }
  }
  private async scheduleAlarm(now = Date.now(), room?: Room | null) {
    const current = room === undefined ? this.storage.read()?.room ?? null : room;
    const at = current ? nextAlarmAt(current, now) : null;
    if (this.alarmAt !== undefined && this.alarmAt === at) return;
    if (at === null) await this.ctx.storage.deleteAlarm();
    else await this.ctx.storage.setAlarm(at);
    this.alarmAt = at;
  }
  /** Advances due work and returns the room it read, changed or not. */
  private advance(now: number, authorize?: (entry: StoredRoom | null) => void): { room: Room; changed: boolean } | null {
    let outcome: { room: Room; changed: boolean } | null = null;
    this.storage.transaction(entry => {
      authorize?.(entry);
      if (!entry) return { next: null, result: null };
      const before = entry.room.version;
      advanceRoom(entry.room, now, this.presence);
      const changed = entry.room.version !== before;
      if (changed) this.enqueueDirectory('upsert', entry.room, entry.receipts);
      outcome = { room: entry.room, changed };
      return { next: entry, result: null };
    });
    return outcome;
  }
  private async advanceAndBroadcast(now: number, authorize?: (entry: StoredRoom | null) => void): Promise<boolean> {
    const outcome = this.advance(now, authorize);
    await this.scheduleAlarm(now, outcome ? outcome.room : null);
    if (outcome?.changed) this.broadcast(outcome.room);
    return outcome?.changed ?? false;
  }
  private broadcast(room?: Room, timing?: BidTiming) {
    const current = room ?? this.storage.read()?.room;
    if (!current) return;
    const started = timing ? performance.now() : 0;
    const snapshot = roomSnapshot(current);
    const scheduledAt = Date.now();
    const message = JSON.stringify({ type: 'snapshot', room: snapshot, serverNow: scheduledAt,
      ...(timing ? { localScheduledAt: scheduledAt } : {}) });
    const serialized = timing ? performance.now() : 0;
    if (timing) timing.snapshot = serialized - started;
    let maxBuffered: number | undefined;
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = socket.deserializeAttachment?.() as SocketAttachment | undefined;
      if (!attachment?.userId) { socket.close(1008, 'Room access ended'); continue; }
      const member = current.members.find(item => item.id === attachment.userId);
      if (!member || current.blockedUserIds?.includes(attachment.userId)) {
        socket.close(1008, 'Room access ended'); continue;
      }
      if ((socket.bufferedAmount ?? 0) > 256 * 1024) { socket.close(1013, 'Slow connection; reconnect'); continue; }
      try {
        socket.send(message);
        if (timing && socket.bufferedAmount !== undefined) maxBuffered = Math.max(maxBuffered ?? 0, socket.bufferedAmount);
      } catch { try { socket.close(1011, 'Persistence unavailable'); } catch { /* closed */ } }
    }
    if (timing) {
      timing.fanout = performance.now() - serialized;
      if (maxBuffered !== undefined) timing.max_buffer_bytes = maxBuffered;
    }
  }
  private errorResponse(error: unknown, requestId: string): Response {
    if (error instanceof RuleError) {
      return json({ code: error.code, message: error.message, requestId }, errorStatus(error.code), requestId);
    }
    if (error instanceof z.ZodError) {
      return json({ code: 'INVALID_INPUT', message: error.issues.map(issue => issue.message).join('; '), requestId }, 400, requestId);
    }
    console.error('Room object request failed', requestId, (error as Error).message);
    return json({ code: 'SERVICE_ERROR', message: 'The service could not confirm this action. Please reconnect.', requestId }, 500, requestId);
  }
  async fetch(request: Request): Promise<Response> {
    const forwarded = this.env.LOCAL_BID_TIMING === '1' ? request.headers.get('X-Auction-Local-Forward-At') : null;
    const receivedAt = forwarded ? Date.now() : 0;
    await this.ready;
    const trace = forwarded ? { forwardAt: Number(forwarded), receivedAt, readyAt: Date.now() } : undefined;
    const requestId = requestIdOf(request);
    try {
      const url = new URL(request.url), code = headerRoomCode(request);
      const profileMatch = /^\/internal\/users\/([^/]+)\/profile$/.exec(url.pathname);
      if (profileMatch && request.method === 'POST' && request.headers.get('X-Auction-Operation') === 'update-profile') {
        return await this.handleProfileUpdate(decodeURIComponent(profileMatch[1]!), request, requestId);
      }
      const deleteMatch = /^\/internal\/users\/([^/]+)\/delete$/.exec(url.pathname);
      if (deleteMatch && request.method === 'POST' && request.headers.get('X-Auction-Operation') === 'delete-user') {
        return await this.handleDeleteUser(decodeURIComponent(deleteMatch[1]!), requestId);
      }
      if (url.pathname === '/ws') return await this.handleSocket(request, code, requestId);
      if (!code) return privateRoom(requestId);
      if (url.pathname === '/api/rooms' && request.method === 'POST') return await this.handleCreate(request, code, requestId);
      const pathCode = pathRoomCode(url.pathname);
      if (pathCode && pathCode !== code) return privateRoom(requestId);
      if (url.pathname === `/api/rooms/${code}` && request.method === 'DELETE') {
        // Only the Worker may reach this path; the operation header is stripped
        // from client requests and re-added by the Worker route.
        if (request.headers.get('X-Auction-Operation') !== 'delete-room') return privateRoom(requestId);
        return await this.handleDeleteRoom(code, request, requestId);
      }
      if (request.headers.get('X-Auction-Operation') === 'authorize') return this.handleAuthorize(code, request, requestId);
      if (url.pathname === `/api/rooms/${code}` && request.method === 'GET') return await this.handleState(code, request, requestId);
      if (url.pathname === `/api/rooms/${code}/join` && request.method === 'POST') return await this.handleJoin(code, request, requestId);
      if (url.pathname === `/api/rooms/${code}/history` && request.method === 'GET') return this.handleHistory(code, request, requestId);
      if (url.pathname === `/api/rooms/${code}/plan` && request.method === 'GET') return this.handlePlan(code, request, requestId);
      if (url.pathname === `/api/rooms/${code}/plan/export` && request.method === 'GET') return this.handlePlanExport(code, request, requestId);
      if (url.pathname === `/api/rooms/${code}/sync` && request.method === 'GET') return await this.handleSync(code, request, requestId);
      if (url.pathname === `/api/rooms/${code}/actions` && request.method === 'POST') return await this.handleAction(code, request, requestId, trace);
      if (url.pathname === `/api/rooms/${code}/invite` && request.method === 'POST') return await this.handleInvite(code, request, requestId);
      if (url.pathname === '/api/rooms' || url.pathname.startsWith('/api/rooms/')) return privateRoom(requestId);
      return json({ code: 'NOT_FOUND', message: 'Not found.', requestId }, 404, requestId);
    } catch (error) { return this.errorResponse(error, requestId); }
  }
  private requireUser(request: Request): User {
    const user = requestUser(request);
    if (!user) throw new RuleError('FORBIDDEN', 'A verified room identity is required.');
    return user;
  }
  private async handleCreate(request: Request, code: string, requestId: string): Promise<Response> {
    // A create can interleave with a deletion at an await point. Reusing the
    // code before the directory tombstone is durable would let the deletion
    // hide the new room permanently.
    if (this.deletions > 0) {
      return json({ code: 'ROOM_DELETING', message: 'This room is being deleted. Try again in a moment.' }, 409, requestId);
    }
    const user = this.requireUser(request);
    const settings = settingsSchema.parse(await jsonBody(request));
    const token = randomToken(), inviteHash = await sha256Hex(token), now = Date.now();
    const room = this.storage.transaction(entry => {
      if (entry) return { next: entry, result: null };
      const created = createRoom(code, user, settings, now);
      this.enqueueDirectory('upsert', created);
      return { next: { room: created, inviteHash, inviteExpires: now + INVITE_TTL_MS, receipts: {} }, result: created };
    });
    if (!room) return json({ code: 'ROOM_EXISTS', message: 'Room code is already allocated.' }, 409, requestId);
    await this.scheduleAlarm(now, room);
    await this.flushDirectory();
    return json({ room: roomSnapshot(room), inviteToken: token, serverNow: Date.now() }, 201, requestId);
  }
  private handleAuthorize(code: string, request: Request, requestId: string): Response {
    const user = this.requireUser(request), entry = this.storage.read();
    if (!entry || entry.room.code !== code) return privateRoom(requestId);
    try { authorizeMember(entry, user); } catch (error) { return this.errorResponse(error, requestId); }
    return json({ ok: true }, 200, requestId);
  }
  private async handleState(code: string, request: Request, requestId: string): Promise<Response> {
    const user = this.requireUser(request);
    const now = Date.now();
    const room = this.storage.transaction(entry => {
      if (!entry || entry.room.code !== code) throw new RuleError('ROOM_NOT_FOUND', PRIVATE_ROOM_MESSAGE);
      authorizeMember(entry, user);
      this.presence.set(user.id, now);
      heartbeat(entry.room, user, now, this.presence);
      return { next: entry, result: entry.room };
    });
    await this.scheduleAlarm(now, room);
    void this.flushDirectory().catch(() => {});
    return json({ room: roomSnapshot(room), serverNow: Date.now() }, 200, requestId);
  }
  private async handleJoin(code: string, request: Request, requestId: string): Promise<Response> {
    const user = this.requireUser(request);
    const body = z.object({ inviteToken: z.string().max(200).optional() }).strict().parse(await jsonBody(request));
    const tokenHash = body.inviteToken ? await sha256Hex(body.inviteToken) : null, now = Date.now();
    const room = this.storage.transaction(entry => {
      if (!entry || entry.room.code !== code) throw new RuleError('ROOM_NOT_FOUND', PRIVATE_ROOM_MESSAGE);
      const current = entry.room;
      if (current.blockedUserIds?.includes(user.id)) throw new RuleError('ROOM_BLOCKED', 'The host removed you from this room.');
      if (current.members.some(member => member.id === user.id)) {
        this.presence.set(user.id, now);
        heartbeat(current, user, now, this.presence);
        this.enqueueDirectory('upsert', current, entry.receipts);
        return { next: entry, result: current };
      }
      if (tokenHash && (entry.inviteExpires <= now || tokenHash !== entry.inviteHash)) throw new RuleError('ROOM_NOT_FOUND', PRIVATE_ROOM_MESSAGE);
      if (['COMPLETED', 'CLOSED'].includes(current.status)) throw new RuleError('ROOM_NOT_FOUND', PRIVATE_ROOM_MESSAGE);
      if (current.status !== 'WAITING' && !current.settings.spectators) throw new RuleError('ROOM_NOT_FOUND', PRIVATE_ROOM_MESSAGE);
      if (current.members.filter(member => !current.blockedUserIds?.includes(member.id)).length >= MAX_MEMBERS) throw new RuleError('ROOM_NOT_FOUND', PRIVATE_ROOM_MESSAGE);
      current.members.push({ ...user, connected: true, ready: false, lastSeen: now });
      event(current, now, 'joined', `${user.name} joined the room.`, user.id);
      this.enqueueDirectory('upsert', current, entry.receipts);
      return { next: entry, result: current };
    });
    await this.scheduleAlarm(now, room);
    this.broadcast(room);
    await this.flushDirectory();
    return json({ room: roomSnapshot(room), serverNow: Date.now() }, 200, requestId);
  }
  private handleHistory(code: string, request: Request, requestId: string): Response {
    const user = this.requireUser(request), entry = this.storage.read();
    if (!entry || entry.room.code !== code) return privateRoom(requestId);
    try { authorizeMember(entry, user); } catch (error) { return this.errorResponse(error, requestId); }
    const url = new URL(request.url), rawLimit = url.searchParams.get('limit');
    const limit = rawLimit === null ? 100 : Number(rawLimit);
    const rawBefore = url.searchParams.get('before');
    const before = rawBefore === null ? undefined : Number(rawBefore);
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100 || before !== undefined && (!Number.isSafeInteger(before) || before < 0)) {
      return json({ code: 'INVALID_CURSOR', message: 'Invalid history page.', requestId }, 400, requestId);
    }
    const eligible = entry.room.history.filter(item => before === undefined || item.version < before);
    const events = eligible.slice(-limit).reverse();
    const page: HistoryPage = { events, nextBefore: eligible.length > events.length ? events.at(-1)!.version : null, truncated: !!entry.room.historyTruncated };
    return json(page, 200, requestId);
  }
  private handlePlan(code: string, request: Request, requestId: string): Response {
    const user = this.requireUser(request), entry = this.storage.read();
    if (!entry || entry.room.code !== code) return privateRoom(requestId);
    try { authorizeMember(entry, user); } catch (error) { return this.errorResponse(error, requestId); }
    if (entry.room.hostId !== user.id) return this.errorResponse(new RuleError('HOST_ONLY', 'Only the host can review the auction plan.'), requestId);
    if (!entry.room.plan && !entry.room.planDraft) return this.errorResponse(new RuleError('PLAN_REQUIRED', 'Generate and review an auction plan first.'), requestId);
    return json({ plan: buildPlanPreview(entry.room, catalog), serverNow: Date.now() }, 200, requestId);
  }
  private handlePlanExport(code: string, request: Request, requestId: string): Response {
    const user = this.requireUser(request), entry = this.storage.read();
    if (!entry || entry.room.code !== code) return privateRoom(requestId);
    try { authorizeMember(entry, user); } catch (error) { return this.errorResponse(error, requestId); }
    if (entry.room.hostId !== user.id) return this.errorResponse(new RuleError('HOST_ONLY', 'Only the host can export the auction plan.'), requestId);
    if (!entry.room.plan) return this.errorResponse(new RuleError('PLAN_REQUIRED', 'Approve an auction plan before exporting it.'), requestId);
    return new Response(planCsv(entry.room), {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="auction-order-${code}.csv"`,
        'X-Auction-Request-Id': requestId,
      },
    });
  }
  private async handleSync(code: string, request: Request, requestId: string): Promise<Response> {
    const user = this.requireUser(request);
    const now = Date.now();
    const room = this.storage.transaction(entry => {
      if (!entry || entry.room.code !== code) throw new RuleError('ROOM_NOT_FOUND', PRIVATE_ROOM_MESSAGE);
      authorizeMember(entry, user);
      this.presence.set(user.id, now);
      heartbeat(entry.room, user, now, this.presence);
      return { next: entry, result: entry.room };
    });
    await this.scheduleAlarm(now, room);
    const afterVersion = Number(new URL(request.url).searchParams.get('afterVersion'));
    if (!Number.isSafeInteger(afterVersion) || afterVersion < 0) {
      return json({ code: 'INVALID_CURSOR', message: 'Invalid replay version.', requestId }, 400, requestId);
    }
    void this.flushDirectory().catch(() => {});
    const events = room.history.filter(item => item.version > afterVersion);
    const resetRequired = afterVersion > room.version || afterVersion < (room.history[0]?.version ?? room.version + 1) - 1 || events.length > SNAPSHOT_EVENTS;
    const snapshot = roomSnapshot(room);
    const overBudget = encoder.encode(JSON.stringify({ room: snapshot, events })).byteLength > 124 * 1024;
    return json({ room: snapshot, replay: { afterVersion, resetRequired: resetRequired || overBudget, events: resetRequired || overBudget ? [] : events }, serverNow: Date.now() }, 200, requestId);
  }
  private async handleAction(code: string, request: Request, requestId: string, trace?: LocalActionTrace): Promise<Response> {
    const user = this.requireUser(request), action = actionSchema.parse(await jsonBody(request));
    const timing: BidTiming | undefined = this.env.LOCAL_BID_TIMING === '1' && action.type === 'bid' ? {} : undefined;
    let measuredAt = timing ? performance.now() : 0;
    const mark = (name: string) => {
      if (!timing) return;
      const ended = performance.now();
      timing[name] = ended - measuredAt;
      measuredAt = ended;
    };
    const now = Date.now();
    // Check access before advancing, using the same read as the advancement.
    await this.advanceAndBroadcast(now, entry => {
      if (!entry || entry.room.code !== code) throw new RuleError('ROOM_NOT_FOUND', PRIVATE_ROOM_MESSAGE);
      authorizeMember(entry, user);
    });
    mark('advance');
    // Fingerprint the client payload so retries stay idempotent, then add the
    // server-generated seed. Clients never choose it.
    const fingerprint = JSON.stringify(action);
    const prepared = withPlanSeed(action, () => randomToken());
    let updated: Room;
    try {
      updated = this.storage.transaction(entry => {
        if (!entry || entry.room.code !== code) throw new RuleError('ROOM_NOT_FOUND', PRIVATE_ROOM_MESSAGE);
        authorizeMember(entry, user);
        const next = applyStoredAction(entry, user, prepared, now, fingerprint);
        this.enqueueDirectory('upsert', next.room, next.receipts);
        return { next, result: next.room };
      });
    } catch (error) {
      if (error instanceof RuleError && !['ROOM_NOT_FOUND', 'ROOM_BLOCKED', 'FORBIDDEN'].includes(error.code)) {
        const room = this.storage.read()?.room;
        await this.flushDirectory();
        return json({
          code: error.code, message: error.message, requestId,
          ...(room ? { room: roomSnapshot(room), serverNow: Date.now() } : {}),
        }, 400, requestId);
      }
      throw error;
    }
    mark('commit');
    await this.scheduleAlarm(now, updated);
    mark('alarm');
    this.broadcast(updated, timing);
    mark('broadcast');
    // Bids must not wait on the single global directory object. The durable
    // outbox converges on a later request or alarm; membership/status changes
    // still flush before responding because /api/me reads the projection.
    if (['leave', 'remove-member', 'end', 'update-settings', 'plan-approve'].includes(action.type)) await this.flushDirectory();
    else void this.flushDirectory().catch(() => {});
    mark('outbox_launch');
    if (action.type === 'leave') return json({ left: true, serverNow: Date.now() }, 200, requestId);
    const response = json({ room: roomSnapshot(updated), serverNow: Date.now() }, 200, requestId);
    mark('response');
    if (timing) response.headers.set('Server-Timing', Object.entries(timing).map(([name, duration]) => `${name};dur=${duration.toFixed(3)}`).join(', '));
    if (timing && trace) response.headers.set('X-Auction-Local-Trace', [trace.forwardAt, trace.receivedAt, trace.readyAt, Date.now()].join(','));
    return response;
  }
  private async handleInvite(code: string, request: Request, requestId: string): Promise<Response> {
    const user = this.requireUser(request), token = randomToken(), inviteHash = await sha256Hex(token), now = Date.now();
    const room = this.storage.transaction(entry => {
      if (!entry || entry.room.code !== code) throw new RuleError('ROOM_NOT_FOUND', PRIVATE_ROOM_MESSAGE);
      authorizeMember(entry, user);
      if (entry.room.hostId !== user.id) throw new RuleError('HOST_ONLY', 'Only the host can renew the invitation.');
      if (['COMPLETED', 'CLOSED'].includes(entry.room.status)) throw new RuleError('ROOM_ENDED', 'This auction has ended.');
      entry.inviteHash = inviteHash; entry.inviteExpires = now + INVITE_TTL_MS;
      event(entry.room, now, 'invite_renewed', 'Host renewed the invitation. Previous links no longer admit new members.');
      this.enqueueDirectory('upsert', entry.room, entry.receipts);
      return { next: entry, result: entry.room };
    });
    await this.scheduleAlarm(now, room);
    this.broadcast(room);
    await this.flushDirectory();
    return json({ room: roomSnapshot(room), inviteToken: token, serverNow: Date.now() }, 200, requestId);
  }
  private async handleProfileUpdate(userId: string, request: Request, requestId: string): Promise<Response> {
    if (!userId) return json({ code: 'INVALID_INPUT', message: 'A user ID is required.' }, 400, requestId);
    const body = z.object({ name: z.string() }).strict().parse(await jsonBody(request));
    const name = normalizeProfileName(body.name);
    const invalid = profileNameError(name);
    if (invalid) throw new RuleError('INVALID_NAME', invalid);
    const now = Date.now();
    const result = this.storage.transaction<{ updated: boolean; missing: boolean; room?: Room }>(entry => {
      if (!entry) return { next: null, result: { updated: false, missing: true } };
      const member = entry.room.members.find(item => item.id === userId);
      if (!member) return { next: entry, result: { updated: false, missing: true } };
      if (member.name === name) return { next: entry, result: { updated: true, missing: false } };
      member.name = name;
      event(entry.room, now, 'profile_updated', 'A participant updated their display name.', userId);
      this.enqueueDirectory('upsert', entry.room, entry.receipts);
      return { next: entry, result: { updated: true, missing: false, room: entry.room } };
    });
    this.broadcast(result.room);
    if (result.room) await this.flushDirectory();
    return json(result, 200, requestId);
  }
  /**
   * Permanent room deletion. The room object validates ownership and status
   * before wiping its own SQLite state. Directory cleanup follows the wipe so a
   * retry can always find the room missing and finish the projection cleanup.
   */
  private async handleDeleteRoom(code: string, request: Request, requestId: string): Promise<Response> {
    this.deletions++;
    try { return await this.deleteRoomOperation(code, request, requestId); }
    finally { this.deletions--; }
  }
  private async deleteRoomOperation(code: string, request: Request, requestId: string): Promise<Response> {
    const user = this.requireUser(request), entry = this.storage.read();
    if (!entry) {
      if (!await this.deleteDirectoryRoom(code, requestId)) {
        return json({
          code: 'DELETION_INCOMPLETE', requestId,
          message: 'The room is already deleted, but its directory entry could not be removed. Retry to finish.',
        }, 502, requestId);
      }
      return json({ deleted: true, alreadyDeleted: true, serverNow: Date.now() }, 200, requestId);
    }
    if (entry.room.code !== code) return privateRoom(requestId);
    if (entry.room.hostId !== user.id) throw new RuleError('HOST_ONLY', 'Only the host can delete this room.');
    if (!isDeletableRoomStatus(entry.room.status)) throw new RuleError('ROOM_ACTIVE', 'Only completed or closed rooms can be deleted.');
    // Close every live subscription before the state disappears. The runtime
    // may deliver close callbacks later; an empty schema makes them harmless.
    for (const socket of this.ctx.getWebSockets()) {
      try { socket.close(1001, 'Room deleted'); } catch { /* already closed */ }
    }
    await this.ctx.storage.deleteAll();
    this.presence.clear();
    this.alarmAt = null;
    this.storage.ensureSchema();
    this.ensureOutbox();
    if (!await this.deleteDirectoryRoom(code, requestId)) {
      return json({
        code: 'DELETION_INCOMPLETE', requestId,
        message: 'The room was deleted, but its directory entry could not be removed. Retry to finish.',
      }, 502, requestId);
    }
    return json({ deleted: true, alreadyDeleted: false, serverNow: Date.now() }, 200, requestId);
  }
  private async deleteDirectoryRoom(code: string, requestId: string): Promise<boolean> {
    if (!this.env.DIRECTORY) return true;
    try {
      const response = await this.env.DIRECTORY.get(this.env.DIRECTORY.idFromName('global')).fetch(new Request(
        `https://directory.internal/internal/rooms/${code}/delete`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Auction-Internal': 'room',
            'X-Auction-Request-Id': requestId,
          },
          body: JSON.stringify({ now: Date.now() }),
        }));
      return response.ok;
    } catch (error) {
      console.error('Room directory deletion failed', requestId, (error as Error).message);
      return false;
    }
  }
  private async handleDeleteUser(userId: string, requestId: string): Promise<Response> {
    if (!userId) return json({ code: 'INVALID_INPUT', message: 'A user ID is required.' }, 400, requestId);
    const anonymousId = 'deleted_' + await sha256Hex(userId), now = Date.now();
    const result = this.storage.transaction<{ removed: boolean; missing: boolean; room?: Room }>(entry => {
      if (!entry) return { next: null, result: { removed: false, missing: true } };
      const deletion = anonymizeUserInRoom(entry, userId, anonymousId, now);
      if (!deletion.next) {
        this.enqueueDirectory('remove', entry.room);
        return { next: null, result: { removed: true, missing: false } };
      }
      if (deletion.changed) this.enqueueDirectory('upsert', deletion.next.room, deletion.next.receipts);
      return { next: deletion.next, result: { removed: false, missing: false, ...(deletion.changed ? { room: deletion.next.room } : {}) } };
    });
    await this.scheduleAlarm(now);
    this.broadcast(result.room);
    await this.flushDirectory();
    return json(result, 200, requestId);
  }
  private async handleSocket(request: Request, code: string | null, requestId: string): Promise<Response> {
    if (!code) return privateRoom(requestId);
    const user = this.requireUser(request), url = new URL(request.url);
    if (url.searchParams.get('room')?.toUpperCase() !== code) return privateRoom(requestId);
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') return json({ code: 'UPGRADE_REQUIRED', message: 'A WebSocket upgrade is required.' }, 426, requestId);
    const entry = this.storage.read();
    if (!entry || entry.room.code !== code) return privateRoom(requestId);
    try { authorizeMember(entry, user); } catch (error) { return this.errorResponse(error, requestId); }
    const now = Date.now();
    const joined = this.storage.transaction(current => {
      if (!current) throw new RuleError('ROOM_NOT_FOUND', PRIVATE_ROOM_MESSAGE);
      authorizeMember(current, user);
      this.presence.set(user.id, now);
      heartbeat(current.room, user, now, this.presence);
      return { next: current, result: current.room };
    });
    const pair = socketPair(), client = pair[0], server = pair[1];
    // The attachment must exist before acceptance so the first broadcast and any
    // hibernated wake can identify the member.
    server.serializeAttachment?.({ userId: user.id, name: user.name } satisfies SocketAttachment);
    this.ctx.acceptWebSocket(server, [user.id]);
    await this.scheduleAlarm(now, joined);
    this.broadcast(joined);
    const protocol = request.headers.get('Sec-WebSocket-Protocol')?.split(',')
      .map(value => value.trim()).find(value => value.startsWith('ticket.'));
    return this.upgradeResponse(client, protocol);
  }
  /** Overridden by tests that cannot construct a 101 Response in Node. */
  protected upgradeResponse(client: WebSocketLike, protocol?: string): Response {
    return new Response(null, {
      status: 101,
      webSocket: client,
      ...(protocol ? { headers: { 'Sec-WebSocket-Protocol': protocol } } : {}),
    } as unknown as ResponseInit);
  }
  async webSocketMessage(socket: WebSocketLike, message: string | ArrayBuffer): Promise<void> {
    const ingress = this.env.LOCAL_BID_TIMING === '1' ? Date.now() : undefined;
    await this.ready;
    const attachment = socket.deserializeAttachment?.() as SocketAttachment | undefined;
    if (!attachment?.userId) { socket.close(1008, 'Room access ended'); return; }
    const user: User = { id: attachment.userId, name: attachment.name || 'Participant' }, now = Date.now();
    const previous = this.presence.get(user.id);
    this.presence.set(user.id, now);
    let parsed: { type?: unknown; clientSentAt?: unknown };
    try { parsed = JSON.parse(typeof message === 'string' ? message : new TextDecoder().decode(message)); } catch { return; }
    // Normal heartbeats only refresh in-memory presence. A gap longer than the
    // presence timeout may mean advanceRoom marked the member disconnected, so
    // that case still commits and broadcasts a reconnect.
    if (previous === undefined || now - previous > HEARTBEAT_TIMEOUT_MS) {
      let changed = false, current: Room | null = null;
      try {
        current = this.storage.transaction(entry => {
          if (!entry) throw new RuleError('ROOM_NOT_FOUND', PRIVATE_ROOM_MESSAGE);
          authorizeMember(entry, user);
          const member = entry.room.members.find(item => item.id === user.id)!;
          changed = !member.connected;
          heartbeat(entry.room, user, now, this.presence);
          return { next: entry, result: entry.room };
        });
        await this.scheduleAlarm(now, current);
      } catch (error) {
        const denied = error instanceof RuleError && ['ROOM_NOT_FOUND', 'ROOM_BLOCKED', 'FORBIDDEN'].includes(error.code);
        socket.close(denied ? 1008 : 1011, denied ? 'Room access ended' : 'Persistence unavailable');
        return;
      }
      if (changed) this.broadcast(current ?? undefined);
    }
    if (parsed?.type === 'ping' && typeof parsed.clientSentAt === 'number' && Number.isSafeInteger(parsed.clientSentAt) && parsed.clientSentAt >= 0 && socket.readyState === 1) {
      if ((socket.bufferedAmount ?? 0) > 256 * 1024) { socket.close(1013, 'Slow connection; reconnect'); return; }
      const serverNow = Date.now();
      socket.send(JSON.stringify({ type: 'pong', clientSentAt: parsed.clientSentAt, serverNow,
        ...(ingress === undefined ? {} : { localIngressAt: ingress, localBufferedBytes: socket.bufferedAmount }) }));
    }
  }
  async webSocketClose(socket: WebSocketLike, _code: number, _reason: string, _wasClean: boolean): Promise<void> {
    await this.ready;
    const attachment = socket.deserializeAttachment?.() as SocketAttachment | undefined;
    if (!attachment?.userId) return;
    const remaining = this.ctx.getWebSockets(attachment.userId)
      .filter(candidate => candidate !== socket && candidate.readyState === 1);
    if (remaining.length) return;
    this.presence.delete(attachment.userId);
    const now = Date.now();
    let current: Room | null = null;
    const changed = this.storage.transaction(entry => {
      if (!entry) return { next: null, result: false };
      current = entry.room;
      const member = entry.room.members.find(item => item.id === attachment.userId);
      if (!member || !member.connected) return { next: entry, result: false };
      member.connected = false; member.lastSeen = now;
      event(entry.room, now, 'disconnected', `${member.name} disconnected.`, member.id);
      return { next: entry, result: true };
    });
    if (changed) { await this.scheduleAlarm(now, current); this.broadcast(current ?? undefined); }
  }
  async webSocketError(socket: WebSocketLike, _error: unknown): Promise<void> {
    try { socket.close(1011, 'Socket error'); } catch { /* already closed */ }
  }
  async alarm(): Promise<void> {
    await this.ready;
    const now = Date.now();
    // The stored alarm has fired, so the cached instant no longer reflects it.
    this.alarmAt = undefined;
    await this.advanceAndBroadcast(now);
    void this.flushDirectory().catch(() => {});
  }
}
function authorizeMember(entry: StoredRoom, user: User) {
  if (entry.room.blockedUserIds?.includes(user.id)) throw new RuleError('ROOM_BLOCKED', 'The host removed you from this room.');
  if (!entry.room.members.some(member => member.id === user.id)) throw new RuleError('ROOM_NOT_FOUND', PRIVATE_ROOM_MESSAGE);
}
