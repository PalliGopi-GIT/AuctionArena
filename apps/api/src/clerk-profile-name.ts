export interface ClerkProfile { id: string; firstName: string | null; lastName: string | null; username: string | null; updatedAt?:number|Date }

/** Public display data only. Never fall back to email, phone, metadata or external IDs. */
export function displayName(value: unknown): string {
  return typeof value === 'string'
    ? Array.from(value.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ').replace(/\s+/gu, ' ').trim()).slice(0, 60).join('')
    : '';
}

export function clerkProfileName(profile: ClerkProfile): string {
  return displayName([displayName(profile.firstName), displayName(profile.lastName)].filter(Boolean).join(' ')) ||
    displayName(profile.username) || 'Auction fan';
}
