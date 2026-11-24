/** Short-lived, HMAC-signed socket tickets. The Worker verifies them before routing. */
export interface SocketTicket { room: string; sub: string; name: string; exp: number }
const encoder = new TextEncoder();
function base64url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function decodeBase64url(value: string): Uint8Array {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}
async function hmacKey(secret: string) {
  return crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
export async function signSocketTicket(secret: string, ticket: SocketTicket): Promise<string> {
  const payload = base64url(encoder.encode(JSON.stringify(ticket)));
  const signature = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(payload)));
  return `${payload}.${base64url(signature)}`;
}
export async function verifySocketTicket(secret: string, value: string, now: number): Promise<SocketTicket | null> {
  const parts = value.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) return null;
  let valid = false;
  try {
    const signature = new Uint8Array(decodeBase64url(parts[1]));
    valid = await crypto.subtle.verify('HMAC', await hmacKey(secret), signature, encoder.encode(parts[0]));
  }
  catch { return null; }
  if (!valid) return null;
  try {
    const ticket = JSON.parse(new TextDecoder().decode(decodeBase64url(parts[0]))) as SocketTicket;
    if (!ticket || typeof ticket.room !== 'string' || typeof ticket.sub !== 'string' ||
        typeof ticket.name !== 'string' || !Number.isFinite(ticket.exp) || ticket.exp <= now) return null;
    return ticket;
  } catch { return null; }
}
