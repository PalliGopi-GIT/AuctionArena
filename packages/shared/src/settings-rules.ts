import type { Settings } from './index';

// The actor validates complete settings independently of HTTP/Zod parsing.
const ranges = {
  teamCount: [2, 8], budget: [200, 20000], minSquad: [1, 4],
  maxSquad: [2, 12], maxOverseas: [0, 12], timerSeconds: [10, 120],
  bidIncrement: [5, 100], resultSeconds: [2, 20],
} as const;
const flags = ['lateExtension', 'autoAdvance', 'spectators'] as const;
const keys = new Set(['name', ...Object.keys(ranges), ...flags]);

export function settingsErrors(value: unknown): string[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return ['Room settings must be an object.'];
  const input = value as Record<string, unknown>;
  const errors: string[] = [];
  if (Object.keys(input).some(key => !keys.has(key))) errors.push('Unknown room setting.');
  if (typeof input.name !== 'string' || input.name.trim().length < 3 || input.name.trim().length > 60) errors.push('Room name must contain 3–60 characters.');
  for (const [key, [min, max]] of Object.entries(ranges)) {
    const number = input[key];
    if (typeof number !== 'number' || !Number.isSafeInteger(number) || number < min || number > max) errors.push(`${key} must be a whole number from ${min} to ${max}.`);
  }
  for (const key of flags) if (typeof input[key] !== 'boolean') errors.push(`${key} must be enabled or disabled.`);
  if (typeof input.minSquad === 'number' && typeof input.maxSquad === 'number' && input.minSquad > input.maxSquad) errors.push('Minimum squad cannot exceed maximum squad.');
  if (typeof input.minSquad === 'number' && typeof input.teamCount === 'number' && input.minSquad * input.teamCount > 24) errors.push('Player pool cannot satisfy minimum squad sizes.');
  return errors;
}

export function normalizedSettings(settings: Settings): Settings {
  return { ...settings, name: settings.name.trim() };
}
