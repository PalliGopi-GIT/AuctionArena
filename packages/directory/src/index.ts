import type { Room, User } from '../../shared/src/domain';
import type { SqlDriver } from '../../storage/src/port';

export const DIRECTORY_SCHEMA_VERSION = 1;
export type RoomRole = 'host' | 'member';
export type DirectoryErrorCode = 'ACCOUNT_DELETED' | 'DELETION_NOT_FOUND' | 'INVALID_DIRECTORY_STATE';

export class DirectoryError extends Error {
  constructor(public code: DirectoryErrorCode, message: string) { super(message); }
}

export interface RoomSummary {
  code: string;
  name: string;
  hostId: string;
  status: Room['status'];
  memberCount: number;
  version: number;
  updatedAt: number;
  completedAt?: number;
}
/** Discovery/export shape deliberately omits other members' identities. */
export interface RoomListing {
  code: string;
  name: string;
  status: Room['status'];
  role: RoomRole;
  memberCount: number;
  updatedAt: number;
  completedAt?: number;
}
export interface ArchiveResult {
  playerId: string;
  playerName: string;
  status: Room['players'][number]['status'];
  teamId: string | null;
  teamName: string | null;
  price: number | null;
}
/** Immutable, privacy-minimised result record. It contains no member IDs or names. */
export interface ArchiveRecord {
  id: string;
  code: string;
  name: string;
  completedAt: number;
  completedVersion: number;
  participantCount: number;
  results: ArchiveResult[];
}
export interface DeletionJob {
  userId: string;
  requestedAt: number;
  providerDeleted: boolean;
  completedAt: number | null;
  attempts: number;
  retryAt: number;
  rooms: RoomListing[];
}
export interface DirectoryExport {
  user: User;
  exportedAt: number;
  rooms: RoomListing[];
  archives: ArchiveRecord[];
}
export interface RoomDirectory {
  /** Null means the code was deleted; a delayed snapshot must not resurrect it. */
  upsertRoom(room: Room, now: number, participants?: string[]): RoomSummary | null;
  removeRoom(code: string, version: number): boolean;
  /** Idempotently remove every projection of a room and remember its deletion. */
  deleteRoom(code: string, now: number): boolean;
  listRooms(userId: string): RoomListing[];
  archive(room: Room, now: number): ArchiveRecord | null;
  archives(userId: string): ArchiveRecord[];
  requestDeletion(userId: string, now: number): DeletionJob;
  markProviderDeleted(userId: string, now: number): DeletionJob;
  retryDeletion(userId: string, now: number): DeletionJob;
  completeDeletion(userId: string, now: number, removedRooms?: string[]): DeletionJob;
  deletionJob(userId: string): DeletionJob | null;
  isDeleted(userId: string): boolean;
  exportUser(user: User, now: number): DirectoryExport;
}

function ended(room: Room) { return room.status === 'COMPLETED' || room.status === 'CLOSED'; }
function participantIds(room: Room, extra: string[] = []): string[] {
  const ids = new Set<string>(extra);
  for (const member of room.members) ids.add(member.id);
  for (const id of room.blockedUserIds ?? []) ids.add(id);
  for (const event of room.history) if (event.actorId) ids.add(event.actorId);
  return [...ids];
}
function summaryFromRow(row: Record<string, unknown>): RoomSummary {
  return {
    code: String(row.code), name: String(row.name), hostId: String(row.host_id),
    status: String(row.status) as Room['status'], memberCount: Number(row.member_count),
    version: Number(row.version), updatedAt: Number(row.updated_at),
    ...(row.completed_at === null || row.completed_at === undefined ? {} : { completedAt: Number(row.completed_at) }),
  };
}
function listingFromRow(row: Record<string, unknown>): RoomListing {
  return {
    code: String(row.code), name: String(row.name), status: String(row.status) as Room['status'],
    role: String(row.role) as RoomRole, memberCount: Number(row.member_count),
    updatedAt: Number(row.updated_at),
    ...(row.completed_at === null || row.completed_at === undefined ? {} : { completedAt: Number(row.completed_at) }),
  };
}
function archiveRecord(room: Room, completedAt: number, participantCount: number): ArchiveRecord {
  const teams = new Map(room.teams.map(team => [team.id, team.name]));
  return {
    id: `${room.code}:${room.version}`, code: room.code, name: room.name,
    completedAt, completedVersion: room.version, participantCount,
    results: room.players.map(player => ({
      playerId: player.id, playerName: player.name, status: player.status,
      teamId: player.soldTo ?? null, teamName: player.soldTo ? teams.get(player.soldTo) ?? null : null,
      price: player.soldPrice ?? null,
    })),
  };
}

/**
 * Cross-room projection. Room-local SQLite remains authoritative for live auction
 * state; this store only answers discovery, archive and account-wide questions.
 * Every write is idempotent and guarded by the room version so delayed outbox
 * deliveries cannot move an index backwards.
 */
export class SqliteRoomDirectory implements RoomDirectory {
  constructor(private sql: SqlDriver) {
    sql.transaction(() => {
      sql.run('CREATE TABLE IF NOT EXISTS dir_schema (id INTEGER PRIMARY KEY CHECK(id=1), version INTEGER NOT NULL)');
      const version = sql.all('SELECT version FROM dir_schema WHERE id=1')[0]?.version;
      if (version !== undefined && version !== DIRECTORY_SCHEMA_VERSION) throw new Error(`Unsupported directory schema version: ${version}`);
      sql.run('CREATE TABLE IF NOT EXISTS dir_rooms (code TEXT PRIMARY KEY, name TEXT NOT NULL, host_id TEXT NOT NULL, status TEXT NOT NULL, member_count INTEGER NOT NULL, version INTEGER NOT NULL, updated_at INTEGER NOT NULL, completed_at INTEGER)');
      sql.run('CREATE TABLE IF NOT EXISTS dir_memberships (user_id TEXT NOT NULL, code TEXT NOT NULL, role TEXT NOT NULL, joined_at INTEGER NOT NULL, PRIMARY KEY(user_id, code))');
      sql.run('CREATE INDEX IF NOT EXISTS dir_memberships_code ON dir_memberships(code)');
      // Participants include former members and history authors, so account
      // deletion can reach rooms that a current-membership query would miss.
      sql.run('CREATE TABLE IF NOT EXISTS dir_participants (user_id TEXT NOT NULL, code TEXT NOT NULL, PRIMARY KEY(user_id, code))');
      sql.run('CREATE INDEX IF NOT EXISTS dir_participants_code ON dir_participants(code)');
      sql.run('CREATE TABLE IF NOT EXISTS dir_archives (id TEXT PRIMARY KEY, code TEXT NOT NULL, completed_version INTEGER NOT NULL, completed_at INTEGER NOT NULL, payload TEXT NOT NULL)');
      sql.run('CREATE TABLE IF NOT EXISTS dir_archive_members (archive_id TEXT NOT NULL, user_id TEXT NOT NULL, PRIMARY KEY(archive_id, user_id))');
      sql.run('CREATE TABLE IF NOT EXISTS dir_deletion_jobs (user_id TEXT PRIMARY KEY, requested_at INTEGER NOT NULL, provider_deleted INTEGER NOT NULL, completed_at INTEGER, attempts INTEGER NOT NULL, retry_at INTEGER NOT NULL)');
      sql.run('CREATE TABLE IF NOT EXISTS dir_deleted_users (user_id TEXT PRIMARY KEY, deleted_at INTEGER NOT NULL)');
      // A room can be deleted while a room object still has an in-flight upsert.
      // The tombstone makes that delayed delivery a no-op. A genuinely new room
      // may reuse the code because its createdAt is newer than the tombstone.
      sql.run('CREATE TABLE IF NOT EXISTS dir_deleted_rooms (code TEXT PRIMARY KEY, deleted_at INTEGER NOT NULL)');
      sql.run('INSERT OR IGNORE INTO dir_schema (id, version) VALUES (1, ?)', DIRECTORY_SCHEMA_VERSION);
    });
  }
  private summaryRow(code: string): RoomSummary | null {
    const row = this.sql.all('SELECT * FROM dir_rooms WHERE code=?', code)[0];
    return row ? summaryFromRow(row) : null;
  }
  /** Snapshots created before the tombstone are stale; a later room may reuse the code. */
  private roomTombstoned(code: string, createdAt: number): boolean {
    const row = this.sql.all('SELECT deleted_at FROM dir_deleted_rooms WHERE code=?', code)[0];
    return !!row && Number(row.deleted_at) >= createdAt;
  }
  /**
   * A delayed outbox delivery must never resurrect a deleted account's
   * membership. The marker is authoritative even when the room snapshot is old.
   */
  private visibleMembers(room: Room): Room['members'] {
    const blocked = new Set(room.blockedUserIds ?? []);
    const ids = JSON.stringify(room.members.map(member => member.id));
    const deleted = new Set(this.sql.all(
      'SELECT user_id FROM dir_deleted_users WHERE user_id IN (SELECT value FROM json_each(?))', ids,
    ).map(row => String(row.user_id)));
    return room.members.filter(member => !blocked.has(member.id) && !deleted.has(member.id));
  }
  private rawListings(userId: string): RoomListing[] {
    return this.sql.all(`SELECT r.*, m.role FROM dir_rooms r JOIN dir_memberships m ON m.code=r.code WHERE m.user_id=? ORDER BY r.updated_at DESC, r.code`, userId)
      .map(listingFromRow);
  }
  /** Deletion reaches current members and former participants with retained history. */
  private deletionListings(userId: string): RoomListing[] {
    return this.sql.all(`SELECT r.*, COALESCE(m.role, 'member') AS role FROM dir_rooms r
      JOIN dir_participants p ON p.code=r.code
      LEFT JOIN dir_memberships m ON m.code=r.code AND m.user_id=p.user_id
      WHERE p.user_id=? ORDER BY r.updated_at DESC, r.code`, userId).map(listingFromRow);
  }
  private archiveInTransaction(room: Room, completedAt: number): ArchiveRecord {
    const id = `${room.code}:${room.version}`;
    const existing = this.sql.all('SELECT payload FROM dir_archives WHERE id=?', id)[0];
    if (existing) return JSON.parse(String(existing.payload)) as ArchiveRecord;
    const members = this.visibleMembers(room);
    const record = archiveRecord(room, completedAt, members.length);
    this.sql.run('INSERT OR IGNORE INTO dir_archives (id, code, completed_version, completed_at, payload) VALUES (?, ?, ?, ?, ?)',
      record.id, record.code, record.completedVersion, record.completedAt, JSON.stringify(record));
    for (const member of members) this.sql.run('INSERT OR IGNORE INTO dir_archive_members (archive_id, user_id) VALUES (?, ?)', record.id, member.id);
    return record;
  }
  upsertRoom(room: Room, now: number, participants: string[] = []): RoomSummary | null {
    return this.sql.transaction(() => {
      if (this.roomTombstoned(room.code, room.createdAt)) return null;
      const existing = this.summaryRow(room.code);
      if (existing && room.version < existing.version) return existing;
      const completedAt = existing?.completedAt ?? (ended(room) ? now : undefined);
      const members = this.visibleMembers(room);
      const summary: RoomSummary = {
        code: room.code, name: room.name, hostId: room.hostId, status: room.status,
        memberCount: members.length,
        version: room.version, updatedAt: now, ...(completedAt === undefined ? {} : { completedAt }),
      };
      this.sql.run(`INSERT INTO dir_rooms (code, name, host_id, status, member_count, version, updated_at, completed_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(code) DO UPDATE SET name=excluded.name, host_id=excluded.host_id,
        status=excluded.status, member_count=excluded.member_count, version=excluded.version, updated_at=excluded.updated_at, completed_at=excluded.completed_at`,
        summary.code, summary.name, summary.hostId, summary.status, summary.memberCount, summary.version, summary.updatedAt, summary.completedAt ?? null);
      const memberIds = JSON.stringify(members.map(member => member.id));
      const participantKeys = JSON.stringify(participantIds(room, participants));
      this.sql.run('DELETE FROM dir_memberships WHERE code=? AND user_id NOT IN (SELECT value FROM json_each(?))', room.code, memberIds);
      this.sql.run(`INSERT INTO dir_memberships (user_id, code, role, joined_at)
        SELECT value, ?, CASE WHEN value=? THEN 'host' ELSE 'member' END, ? FROM json_each(?) WHERE 1
        ON CONFLICT(user_id, code) DO UPDATE SET role=excluded.role WHERE role<>excluded.role`,
        room.code, room.hostId, now, memberIds);
      this.sql.run(`DELETE FROM dir_participants WHERE code=? AND (
        user_id NOT IN (SELECT value FROM json_each(?)) OR user_id IN (SELECT user_id FROM dir_deleted_users)
      )`, room.code, participantKeys);
      this.sql.run(`INSERT OR IGNORE INTO dir_participants (user_id, code)
        SELECT value, ? FROM json_each(?) AS ids
        WHERE NOT EXISTS (SELECT 1 FROM dir_deleted_users WHERE user_id=ids.value)`, room.code, participantKeys);
      if (ended(room)) this.archiveInTransaction(room, completedAt ?? now);
      return summary;
    });
  }
  removeRoom(code: string, version: number): boolean {
    return this.sql.transaction(() => {
      const existing = this.summaryRow(code);
      if (!existing || existing.version > version) return false;
      this.sql.run('DELETE FROM dir_rooms WHERE code=?', code);
      this.sql.run('DELETE FROM dir_memberships WHERE code=?', code);
      this.sql.run('DELETE FROM dir_participants WHERE code=?', code);
      return true;
    });
  }
  /**
   * Permanent room deletion. Every projection, archive and participant index is
   * removed in one transaction. The tombstone is written even when the room was
   * already absent so an in-flight outbox upsert cannot recreate it. Repeating
   * this call is safe and returns false once there is nothing left to remove.
   */
  deleteRoom(code: string, now: number): boolean {
    return this.sql.transaction(() => {
      const removed = !!this.sql.all('SELECT 1 AS present FROM dir_rooms WHERE code=?', code)[0]
        || !!this.sql.all('SELECT 1 AS present FROM dir_archives WHERE code=?', code)[0];
      this.sql.run('INSERT INTO dir_deleted_rooms (code, deleted_at) VALUES (?, ?) ON CONFLICT(code) DO UPDATE SET deleted_at=excluded.deleted_at', code, now);
      this.sql.run('DELETE FROM dir_archive_members WHERE archive_id IN (SELECT id FROM dir_archives WHERE code=?)', code);
      this.sql.run('DELETE FROM dir_archives WHERE code=?', code);
      this.sql.run('DELETE FROM dir_participants WHERE code=?', code);
      this.sql.run('DELETE FROM dir_memberships WHERE code=?', code);
      this.sql.run('DELETE FROM dir_rooms WHERE code=?', code);
      return removed;
    });
  }
  listRooms(userId: string): RoomListing[] {
    if (this.isDeleted(userId)) return [];
    return this.rawListings(userId);
  }
  archive(room: Room, now: number): ArchiveRecord | null {
    if (!ended(room) || this.roomTombstoned(room.code, room.createdAt)) return null;
    return this.sql.transaction(() => this.archiveInTransaction(room, now));
  }
  archives(userId: string): ArchiveRecord[] {
    if (this.isDeleted(userId)) return [];
    return this.sql.all(`SELECT a.payload FROM dir_archives a JOIN dir_archive_members m ON m.archive_id=a.id
      WHERE m.user_id=? ORDER BY a.completed_at DESC, a.id`, userId).map(row => JSON.parse(String(row.payload)) as ArchiveRecord);
  }
  isDeleted(userId: string): boolean {
    return !!this.sql.all('SELECT 1 AS present FROM dir_deleted_users WHERE user_id=?', userId)[0];
  }
  private jobRow(userId: string): DeletionJob | null {
    const row = this.sql.all('SELECT * FROM dir_deletion_jobs WHERE user_id=?', userId)[0];
    if (!row) return null;
    return {
      userId: String(row.user_id), requestedAt: Number(row.requested_at), providerDeleted: Number(row.provider_deleted) === 1,
      completedAt: row.completed_at === null || row.completed_at === undefined ? null : Number(row.completed_at),
      attempts: Number(row.attempts), retryAt: Number(row.retry_at), rooms: [],
    };
  }
  private jobWithRooms(userId: string, rooms?: RoomListing[]): DeletionJob {
    const job = this.jobRow(userId);
    if (!job) throw new DirectoryError('DELETION_NOT_FOUND', 'Account deletion job was not found.');
    return { ...job, rooms: job.completedAt === null ? rooms ?? this.deletionListings(userId) : [] };
  }
  requestDeletion(userId: string, now: number): DeletionJob {
    return this.sql.transaction(() => {
      const existing = this.jobRow(userId);
      if (existing?.completedAt !== null && existing?.completedAt !== undefined) return this.jobWithRooms(userId, []);
      const rooms = this.deletionListings(userId);
      this.sql.run('INSERT OR IGNORE INTO dir_deleted_users (user_id, deleted_at) VALUES (?, ?)', userId, now);
      if (existing) this.sql.run('UPDATE dir_deletion_jobs SET retry_at=0, completed_at=NULL WHERE user_id=?', userId);
      else this.sql.run('INSERT INTO dir_deletion_jobs (user_id, requested_at, provider_deleted, completed_at, attempts, retry_at) VALUES (?, ?, 0, NULL, 0, 0)', userId, now);
      return this.jobWithRooms(userId, rooms);
    });
  }
  markProviderDeleted(userId: string, _now: number): DeletionJob {
    return this.sql.transaction(() => {
      if (!this.jobRow(userId)) throw new DirectoryError('DELETION_NOT_FOUND', 'Account deletion job was not found.');
      this.sql.run('UPDATE dir_deletion_jobs SET provider_deleted=1 WHERE user_id=?', userId);
      return this.jobWithRooms(userId);
    });
  }
  retryDeletion(userId: string, now: number): DeletionJob {
    return this.sql.transaction(() => {
      const job = this.jobRow(userId);
      if (!job) throw new DirectoryError('DELETION_NOT_FOUND', 'Account deletion job was not found.');
      if (job.completedAt !== null) return this.jobWithRooms(userId, []);
      const attempts = job.attempts + 1;
      this.sql.run('UPDATE dir_deletion_jobs SET attempts=?, retry_at=? WHERE user_id=?', attempts, now + Math.min(3600000, 1000 * 2 ** Math.min(attempts, 12)), userId);
      return this.jobWithRooms(userId);
    });
  }
  completeDeletion(userId: string, now: number, removedRooms: string[] = []): DeletionJob {
    return this.sql.transaction(() => {
      const job = this.jobRow(userId);
      if (!job) throw new DirectoryError('DELETION_NOT_FOUND', 'Account deletion job was not found.');
      if (job.completedAt !== null) return this.jobWithRooms(userId, []);
      for (const code of removedRooms) {
        this.sql.run('DELETE FROM dir_rooms WHERE code=?', code);
        this.sql.run('DELETE FROM dir_memberships WHERE code=?', code);
      }
      this.sql.run('DELETE FROM dir_memberships WHERE user_id=?', userId);
      this.sql.run('DELETE FROM dir_participants WHERE user_id=?', userId);
      this.sql.run('UPDATE dir_deletion_jobs SET completed_at=?, provider_deleted=1, retry_at=0 WHERE user_id=?', now, userId);
      return this.jobWithRooms(userId, []);
    });
  }
  deletionJob(userId: string): DeletionJob | null {
    return this.jobRow(userId) ? this.jobWithRooms(userId) : null;
  }
  exportUser(user: User, now: number): DirectoryExport {
    if (this.isDeleted(user.id)) throw new DirectoryError('ACCOUNT_DELETED', 'This account no longer has access.');
    return { user, exportedAt: now, rooms: this.listRooms(user.id), archives: this.archives(user.id) };
  }
}
