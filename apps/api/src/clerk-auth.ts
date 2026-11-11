import { verifyToken } from '@clerk/backend';
import type { User } from '../../../packages/shared/src/domain';

export interface ClerkVerification {
  secretKey?: string;
  jwtKey?: string;
  issuer?: string;
  authorizedParties: string[];
}

/** Only verified user sessions can enter the room API; JWT templates are insufficient. */
export async function verifyClerkIdentity(token: string, options: ClerkVerification): Promise<{user:User;firstFactorAge?:number}> {
  const payload = await verifyToken(token, options);
  if (!payload.sub || typeof payload.sid !== 'string' || !payload.sid ||
    (payload.sts !== undefined && payload.sts !== 'active')) {
    throw new Error('An active user session is required.');
  }
  const name = typeof payload.name === 'string' && payload.name.trim()
    ? payload.name.trim() : typeof payload.first_name === 'string' && payload.first_name.trim()
      ? payload.first_name.trim() : 'Auction fan';
  const fva=payload.fva;
  const firstFactorAge=Array.isArray(fva)&&Number.isFinite(fva[0])&&fva[0]>=0&&typeof payload.iat==='number'
    ? fva[0]+Math.max(0,(Date.now()/1000-payload.iat)/60):undefined;
  return { user:{ id: payload.sub, name: name.slice(0, 60) },firstFactorAge };
}
export async function verifyClerkSession(token:string,options:ClerkVerification):Promise<User>{return (await verifyClerkIdentity(token,options)).user;}

export function allowedOrigins(origins: string[] = ['http://localhost:5173', 'http://127.0.0.1:5173']): string[] {
  const normalized = [...new Set(origins.map(origin => origin.trim()).filter(Boolean))];
  if (!normalized.length || normalized.some(origin => {
    try { const url = new URL(origin); return !['http:', 'https:'].includes(url.protocol) || url.origin !== origin; }
    catch { return true; }
  })) throw new Error('ALLOWED_ORIGINS must contain at least one exact HTTP or HTTPS origin.');
  return normalized;
}
