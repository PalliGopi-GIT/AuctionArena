import { allowedOrigins } from '../apps/api/src/clerk-auth.ts';

/** Pure validation. Never include credential values in errors or diagnostic output. */
export function clerkDevelopmentConfig(env: Record<string, string | undefined>) {
  const publishableKey = env.VITE_CLERK_PUBLISHABLE_KEY?.trim();
  const secretKey = env.CLERK_SECRET_KEY?.trim();
  if (!publishableKey?.startsWith('pk_test_') || !secretKey?.startsWith('sk_test_')) {
    throw new Error('Clerk development keys are required. Pull them from the selected development application into .env.local.');
  }
  const frontendHost = Buffer.from(publishableKey.slice('pk_test_'.length), 'base64').toString('utf8').replace(/\$$/, '');
  if (!/^[a-z0-9.-]+$/i.test(frontendHost) || !frontendHost.includes('.') || frontendHost.includes('..')) {
    throw new Error('The Clerk publishable key is invalid. Restore it from the selected development application.');
  }
  const issuer = `https://${frontendHost}`;
  if (env.CLERK_ISSUER && env.CLERK_ISSUER !== issuer) throw new Error('CLERK_ISSUER does not match the publishable key. Check the selected development application.');
  const port = (value: string | undefined, fallback: number) => {
    const parsed = value === undefined || value === '' ? fallback : Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < 1024 || parsed > 65535) throw new Error('Development ports must be whole numbers between 1024 and 65535.');
    return parsed;
  };
  const apiPort = port(env.API_PORT, 3001), webPort = port(env.WEB_PORT, 5173);
  if (apiPort === webPort) throw new Error('API_PORT and WEB_PORT must be different.');
  const origins = allowedOrigins((env.ALLOWED_ORIGINS ?? `http://localhost:${webPort},http://127.0.0.1:${webPort}`).split(','));
  if (!origins.includes(`http://127.0.0.1:${webPort}`)) throw new Error('ALLOWED_ORIGINS must include this launcher\'s frontend origin.');
  return {
    apiPort, webPort,
    env: { ...env, VITE_CLERK_PUBLISHABLE_KEY: publishableKey, CLERK_SECRET_KEY: secretKey, CLERK_ISSUER: issuer,
      LOCAL_DEV_AUTH: 'false', API_PORT: String(apiPort), ALLOWED_ORIGINS: origins.join(','), DATA_FILE: env.DATA_FILE || '.data/auctionarena-clerk.json' },
  };
}
