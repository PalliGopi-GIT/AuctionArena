export interface PreviewProbe {
  ready: boolean;
  canStart: boolean;
  code?: string;
  message?: string;
}

/** Diagnose only our public config endpoint. Never include response bodies or credentials in errors. */
export async function probeClerkPreview(baseURL: string, timeout = 3000): Promise<PreviewProbe> {
  let response: Response;
  try {
    response = await fetch(`${baseURL}/api/config`, { signal: AbortSignal.timeout(timeout) });
  } catch (error) {
    const cause = (error as { cause?: { code?: string }; name?: string });
    if (cause.cause?.code === 'ECONNREFUSED') return { ready: false, canStart: true, code: 'PREVIEW_STOPPED', message: 'The local preview is stopped.' };
    if (cause.name === 'TimeoutError' || cause.name === 'AbortError') return { ready: false, canStart: false, code: 'PREVIEW_TIMEOUT', message: 'The preview did not respond. Check the process using its port.' };
    return { ready: false, canStart: false, code: 'PREVIEW_CONNECTION_FAILED', message: 'Could not connect to the local preview. Check its URL and network access.' };
  }
  if (!response.ok) return { ready: false, canStart: false, code: 'PREVIEW_HTTP_ERROR', message: `The preview configuration endpoint returned HTTP ${response.status}.` };
  let config: { clerkConfigured?: boolean; localDevAuth?: boolean };
  try { config = await response.json(); }
  catch { return { ready: false, canStart: false, code: 'PREVIEW_INVALID_RESPONSE', message: 'The preview configuration endpoint did not return JSON.' }; }
  if (!config || config.clerkConfigured !== true || config.localDevAuth !== false) return { ready: false, canStart: false, code: 'PREVIEW_WRONG_AUTH_MODE', message: 'The running preview is not configured for Clerk-only sign-in. Stop that preview or use another port.' };
  return { ready: true, canStart: false };
}
