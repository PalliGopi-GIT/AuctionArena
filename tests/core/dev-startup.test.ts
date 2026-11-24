import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { clerkDevelopmentConfig } from '../../scripts/clerk-config';

const root = join(__dirname, '..', '..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');

/** The publishable key only encodes the frontend host; this value is not a secret. */
const PUBLISHABLE = `pk_test_${Buffer.from('example-app.clerk.accounts.dev$').toString('base64')}`;
const SECRET = 'sk_test_placeholder-for-config-unit-test';

describe('normal development startup selects the real Clerk mode', () => {
  it('bare `npm run dev` launches the Clerk launcher, not the local-auth launcher', () => {
    const scripts = JSON.parse(read('package.json')).scripts as Record<string, string>;
    expect(scripts.dev).toContain('dev-clerk.mjs');
    expect(scripts.dev).not.toContain('scripts/dev.mjs');
    // A Vite-only entry point would leave no API and therefore no Clerk verification.
    expect(scripts.dev).not.toMatch(/\bvite\b/);
  });

  it('the explicit test launcher clears Clerk keys so it cannot inherit real sign-in', () => {
    const devLocal = read('scripts/dev.mjs');
    expect(devLocal).toContain("VITE_CLERK_PUBLISHABLE_KEY:''");
    expect(devLocal).toContain("LOCAL_DEV_AUTH:'true'");
    expect(devLocal).toContain("CLERK_SECRET_KEY:''");
  });

  it('the Clerk launcher disables local profiles and derives the issuer from the key', () => {
    const config = clerkDevelopmentConfig({ VITE_CLERK_PUBLISHABLE_KEY: PUBLISHABLE, CLERK_SECRET_KEY: SECRET });
    expect(config.env.LOCAL_DEV_AUTH).toBe('false');
    expect(config.env.VITE_CLERK_PUBLISHABLE_KEY).toBe(PUBLISHABLE);
    expect(config.env.CLERK_ISSUER).toBe('https://example-app.clerk.accounts.dev');
  });

  it('refuses to start Clerk mode without development keys', () => {
    expect(() => clerkDevelopmentConfig({})).toThrow(/Clerk development keys are required/);
    expect(() => clerkDevelopmentConfig({ VITE_CLERK_PUBLISHABLE_KEY: PUBLISHABLE })).toThrow(/Clerk development keys are required/);
  });

  it('a production build without a Clerk key shows a configuration error, not local identities', () => {
    const main = read('apps/web/src/main.tsx');
    // Clerk mode is chosen by the publishable key; local identities are the non-production fallback only.
    expect(main).toContain("clerkKey?<ClerkProvider");
    expect(main).toContain('import.meta.env.PROD');
    expect(main).toContain('Clerk is not configured for this build.');
  });
});
