import { createClerkClient } from '@clerk/backend';
import type { User } from '../../../packages/shared/src/domain';
import { displayName, clerkProfileName, type ClerkProfile } from './clerk-profile-name';
export { displayName, clerkProfileName, type ClerkProfile } from './clerk-profile-name';

export type ClerkProfileLookup = (userId: string) => Promise<ClerkProfile>;
export interface ProjectedProfile { user: User; fetchedAt: number }
interface ProfileStore {
  profile(userId: string): ProjectedProfile | undefined;
  projectProfile(user: User, fetchedAt: number, providerVersion?:number): void;
}

export function clerkProfileLookup(secretKey?: string): ClerkProfileLookup | undefined {
  if (!secretKey) return undefined;
  const client = createClerkClient({ secretKey });
  return userId => client.users.getUser(userId);
}

/** Local projection: refresh on profile/room reads and admission, never on intents or socket tickets. */
export class ClerkProfiles {
  private pending = new Map<string, Promise<void>>();
  private retryAfter = new Map<string, number>();
  constructor(private store: ProfileStore, private lookup?: ClerkProfileLookup, private clock = Date.now,
    private timeoutMs = 1500) {}

  async resolve(verified: User, refresh: boolean): Promise<User> {
    const cached = this.store.profile(verified.id);
    const now = this.clock();
    if (refresh && this.lookup && (!cached || now - cached.fetchedAt >= 300000) &&
        (this.retryAfter.get(verified.id) || 0) <= now) {
      let pending = this.pending.get(verified.id);
      if (!pending) {
        pending = this.refresh(verified.id);
        this.pending.set(verified.id, pending);
      }
      await pending;
    }
    return this.store.profile(verified.id)?.user || { id: verified.id, name: displayName(verified.name) || 'Auction fan' };
  }

  private async refresh(userId: string): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const profile = await Promise.race([
        Promise.resolve().then(() => this.lookup!(userId)),
        new Promise<never>((_, reject) => { timeout = setTimeout(() => reject(new Error('Profile lookup timed out')), this.timeoutMs); }),
      ]);
      if (profile.id !== userId) throw new Error('Profile identity mismatch');
      const version=profile.updatedAt instanceof Date?profile.updatedAt.getTime():profile.updatedAt;
      this.store.projectProfile({ id: userId, name: clerkProfileName(profile) }, this.clock(),version);
      this.retryAfter.delete(userId);
    } catch {
      // Profile availability must not change authentication or erase a known name.
      // SDK errors can contain sensitive request data; do not log or return them.
      if (this.retryAfter.size >= 1000) this.retryAfter.delete(this.retryAfter.keys().next().value!);
      this.retryAfter.set(userId, this.clock() + 30000);
    } finally {
      clearTimeout(timeout);
      this.pending.delete(userId);
    }
  }
}
