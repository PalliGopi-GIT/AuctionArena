/** Application display names are independent of Clerk's account identifiers. */
export function normalizeProfileName(value: string): string {
  return value.normalize('NFKC').replace(/\s+/gu, ' ').trim();
}
export function profileNameKey(value: string): string {
  return normalizeProfileName(value).toLowerCase();
}
export function profileNameError(value: unknown): string | undefined {
  if (typeof value !== 'string') return 'Enter a display name.';
  const name = normalizeProfileName(value);
  if (Array.from(name).length < 3 || Array.from(name).length > 30) return 'Use 3–30 characters.';
  if (!/^[\p{L}\p{N}][\p{L}\p{M}\p{N} '_-]*$/u.test(name)) return 'Start with a letter or number; use letters, numbers, spaces, apostrophes, underscores or hyphens.';
}
