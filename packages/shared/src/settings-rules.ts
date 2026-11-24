import type { Settings } from './index';
import { auctionModeLabels, auctionModeRules, auctionModes, type AuctionMode } from './domain';

// The actor validates complete settings independently of HTTP/Zod parsing.
const ranges = {
  teamCount: [2, 10], budget: [200, 20000], minSquad: [1, 11],
  maxSquad: [2, 12], maxOverseas: [0, 12], timerSeconds: [10, 120],
  bidIncrement: [5, 100], resultSeconds: [2, 20],
} as const;
const flags = ['lateExtension', 'autoAdvance', 'spectators'] as const;
const keys = new Set(['name', 'mode', ...Object.keys(ranges), ...flags]);
/** Existing rooms created before modes keep their original 24-player pool assumption. */
const LEGACY_POOL_SIZE = 24;

function isAuctionMode(value: unknown): value is AuctionMode {
  return typeof value === 'string' && (auctionModes as readonly string[]).includes(value);
}

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

  let mode: AuctionMode | undefined;
  if (input.mode !== undefined) {
    if (!isAuctionMode(input.mode)) {
      errors.push('Auction mode must be quick, standard or mega.');
    } else {
      mode = input.mode;
      const rules = auctionModeRules[mode], label = auctionModeLabels[mode];
      if (input.budget !== rules.purse) errors.push(`${label} mode uses a fixed purse of ₹${rules.purse / 100} Cr.`);
      if (input.minSquad !== rules.squad || input.maxSquad !== rules.squad) errors.push(`${label} mode uses a squad of exactly ${rules.squad} players.`);
      if (input.maxOverseas !== rules.maxOverseas) errors.push(`${label} mode allows at most ${rules.maxOverseas} overseas players.`);
      if (input.timerSeconds !== rules.timerSeconds) errors.push(`${label} mode uses a ${rules.timerSeconds}-second bid timer.`);
    }
  }

  if (typeof input.minSquad === 'number' && typeof input.maxSquad === 'number' && input.minSquad > input.maxSquad) errors.push('Minimum squad cannot exceed maximum squad.');
  const poolSize = mode ? auctionModeRules[mode].players : LEGACY_POOL_SIZE;
  if (typeof input.minSquad === 'number' && typeof input.teamCount === 'number' && input.minSquad * input.teamCount > poolSize) {
    errors.push(`Player pool cannot satisfy ${input.teamCount} teams with a minimum squad of ${input.minSquad}.`);
  }
  return errors;
}

export function normalizedSettings(settings: Settings): Settings {
  return { ...settings, name: settings.name.trim() };
}
