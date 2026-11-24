import { describe, it, expect } from 'vitest';
import { canViewRoom, clearInvitationCache, syncIdentitySession } from '../../apps/web/src/identity-session';
import { createRoom } from '../../packages/engine/src/index';
import { settingsSchema } from '../../packages/shared/src/index';

describe('private room state across identity changes', () => {
  it('hides cached room content from a different or signed-out identity', () => {
    const room = createRoom('PRIVATE', { id: 'user_a', name: 'A' }, settingsSchema.parse({}), 100000);
    expect(canViewRoom(room, 'user_a')).toBe(true);
    expect(canViewRoom(room, 'user_b')).toBe(false);
    expect(canViewRoom(room, undefined)).toBe(false);
  });
  it('keeps a shared room accessible to an invited member but not a blocked member', () => {
    const room = createRoom('SHARED', { id: 'user_a', name: 'A' }, settingsSchema.parse({}), 100000);
    room.members.push({ id: 'user_b', name: 'B', connected: true, ready: false, lastSeen: 100000 });
    expect(canViewRoom(room, 'user_b')).toBe(true);
    room.blockedUserIds = ['user_b'];
    expect(canViewRoom(room, 'user_b')).toBe(false);
    expect(canViewRoom(room, 'user_a')).toBe(true);
  });
  it('renders privacy-preserving account listings that omit member identities', () => {
    const listing = { code: 'LISTED', name: 'Listed room', status: 'WAITING', memberCount: 3 };
    expect(canViewRoom(listing, 'user_a')).toBe(true);
    expect(canViewRoom(listing, undefined)).toBe(false);
    expect(canViewRoom({ ...listing, blockedUserIds: ['user_a'] }, 'user_a')).toBe(false);
    const rooms = [listing, { ...listing, code: 'BLOCKED', blockedUserIds: ['user_a'] }];
    expect(rooms.filter(room => canViewRoom(room, 'user_a')).map(room => room.code)).toEqual(['LISTED']);
  });
  it('removes all old invitation credentials without deleting unrelated tab state', () => {
    const values = new Map([['invite-ONE', 'private-a'], ['theme', 'dark'], ['invite-TWO', 'private-b'], ['draft', 'text']]);
    const storage = { get length() { return values.size; }, key: (index: number) => [...values.keys()][index] ?? null, removeItem: (key: string) => { values.delete(key); } };
    clearInvitationCache(storage);
    expect([...values.entries()]).toEqual([['theme', 'dark'], ['draft', 'text']]);
    clearInvitationCache(storage);
    expect(values.size).toBe(2);
  });
  it('remembers identity across a reload and clears invitations on signed-out remount', () => {
    const values = new Map<string, string>();
    const storage = { get length() { return values.size; }, key: (i: number) => [...values.keys()][i] ?? null,
      getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
    expect(syncIdentitySession(storage, 'user_a')).toBe(false);
    values.set('invite-PRIVATE', 'secret'); values.set('theme', 'dark');
    expect(syncIdentitySession(storage, 'user_a')).toBe(false);
    expect(values.has('invite-PRIVATE')).toBe(true);
    expect(syncIdentitySession(storage, undefined)).toBe(true);
    expect(values.has('invite-PRIVATE')).toBe(false);
    expect(values.get('theme')).toBe('dark');
    expect(values.has('aa-session-identity')).toBe(false);
  });
});
