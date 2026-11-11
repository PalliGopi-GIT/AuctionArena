import './register-typescript.mjs';
import { existsSync, mkdirSync, writeFileSync, readFileSync, copyFileSync } from 'node:fs';
import { createClerkClient } from '@clerk/backend';
import { chromium, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { clerkDevelopmentConfig } from './clerk-config.ts';
import { probeClerkPreview } from './clerk-live-preflight.ts';
import { runClerkTwoUserAuction } from './clerk-two-user-flow.ts';
import { clerkTwoUserFixture } from './clerk-two-user-fixture.ts';
import { runClerkProfileCheck } from './clerk-profile-flow.ts';

// Run from the host: the agent sandbox cannot reach Clerk's API.
// No browser storage, traces, token values or raw SDK errors are written to evidence.
if (existsSync('.env.local')) process.loadEnvFile('.env.local');
const config = clerkDevelopmentConfig(process.env);
const baseURL = process.env.CLERK_TEST_BASE_URL || 'http://127.0.0.1:5373';
const target = new URL(baseURL);
if (!['127.0.0.1', 'localhost'].includes(target.hostname) || target.protocol !== 'http:') throw new Error('The live smoke test requires a loopback HTTP preview.');
const selectedIssuer = 'https://quality-labrador-8216.clerk.accounts.dev';
if (config.env.CLERK_ISSUER !== selectedIssuer) throw new Error('The keys do not match the selected AuctionArena development instance.');

const twoUsers = process.argv.includes('--two-users');
const profilesOnly = process.argv.includes('--profiles');
const resuming = twoUsers && process.argv.includes('--resume');
const directory = `docs/reports/evidence/${profilesOnly ? 'WP1-CLERK-PROFILES' : twoUsers ? 'WP1-CLERK-TWO-USER' : 'WP1-CLERK-LIVE'}`;
mkdirSync(directory, { recursive: true });
const report = { at: new Date().toISOString(), status: 'not-run', stage: 'preflight', baseURL, instance: 'ins_3LlP2P5dv6hhyDKp3h6huKBFkFd', checks: [] };
let resume;
if (resuming) {
  resume = clerkTwoUserFixture(JSON.parse(readFileSync(`${directory}/result.json`, 'utf8')));
  copyFileSync(`${directory}/result.json`, `${directory}/attempt-${Date.now()}.json`);
  Object.assign(report, resume, { resumed: true, roomURL: `${baseURL}/?room=${resume.roomCode}` });
}
const save = () => writeFileSync(`${directory}/${preflightOnly ? 'preflight-result' : 'result'}.json`, JSON.stringify(report, null, 2));
const approved = resuming || process.argv.includes(profilesOnly ? '--verify-profiles' : twoUsers ? '--create-test-users' : '--create-test-user');
const preflightOnly = process.argv.includes('--preflight-only');
console.log(profilesOnly ? 'Plan: reuse the completed two-user fixture to verify Clerk-sourced API/member/result names, WebSocket delivery, reload and sign-out. No users, rooms or auction actions are created.' : resuming ? `Plan: reuse the two synthetic development identities and private room ${resume.roomCode}; retry account switching and the auction flow. No additional users or rooms will be created.` : twoUsers
  ? 'Plan: create two synthetic development users and one private room; verify account switching, invite-only access, ready/start/bid/sale/results/reload, and sign out both identities.'
  : 'Plan: check AuctionArena sign-in branding, create one synthetic development user, sign in with a short-lived Clerk ticket, create/claim/reopen a room through the UI, verify the API identity and sign out.');
console.log('Synthetic test users and the room will remain available for inspection. No personal accounts are used.');
if (!approved && !preflightOnly) {
  console.log(profilesOnly ? 'Preview only. To run: npm.cmd run test:clerk:profiles -- --verify-profiles' : twoUsers ? 'Preview only. To run: npm.cmd run test:clerk:two -- --create-test-users' : 'Preview only. To run this plan: npm.cmd run test:clerk:live -- --create-test-user');
  writeFileSync(`${directory}/plan.json`, JSON.stringify(report, null, 2));
  process.exit(0);
}

let browser, sessionId, preview;
const client = createClerkClient({ secretKey: config.env.CLERK_SECRET_KEY });
let tokenId;
function failure(code, message) { return Object.assign(new Error(message), { safeCode: code, safeMessage: message }); }
async function stopOwnedPreview() {
  if (!preview || preview.exitCode !== null || preview.signalCode !== null) return;
  await new Promise(resolve => {
    const timeout = setTimeout(() => { preview.kill(); resolve(); }, 7000);
    preview.once('exit', () => { clearTimeout(timeout); resolve(); });
    if (preview.connected) preview.send('shutdown'); else preview.kill();
  });
}
try {
  report.stage = 'preview availability';
  let probe = await probeClerkPreview(baseURL);
  if (!probe.ready && probe.canStart) {
    console.log('The preview is stopped. Starting it automatically for this check…');
    const webPort = target.port || '80';
    const apiPort = process.env.CLERK_TEST_API_PORT || '3201';
    if (Number(webPort) < 1024) throw failure('PREVIEW_PORT_INVALID', 'Choose a preview URL with a port of 1024 or higher.');
    preview = spawn(process.execPath, ['scripts/dev-clerk.mjs'], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
      env: { ...config.env, API_PORT: apiPort, WEB_PORT: webPort, ALLOWED_ORIGINS: `http://127.0.0.1:${webPort},http://localhost:${webPort}` },
    });
    // Drain build output without copying potential environment-dependent errors to reports.
    preview.stdout.on('data', () => {});
    preview.stderr.on('data', () => {});
    let startupError;
    preview.on('error', error => { startupError = error; });
    const deadline = Date.now() + 90000;
    while (true) {
      if (startupError || preview.exitCode !== null || preview.signalCode !== null) throw failure('PREVIEW_START_FAILED', 'The preview could not start. Check that its configured API port is available and the development keys are configured.');
      probe = await probeClerkPreview(baseURL, 1000);
      if (probe.ready) break;
      if (!probe.canStart) throw failure(probe.code, probe.message);
      if (Date.now() >= deadline) throw failure('PREVIEW_START_TIMEOUT', 'The preview did not start within 90 seconds. Run npm.cmd run dev:clerk to inspect startup output.');
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    report.previewStartedByTest = true;
  }
  if (!probe.ready) throw failure(probe.code, probe.message);
  report.checks.push('Clerk-only preview is available');
  if (preflightOnly) {
    report.status = 'preflight-passed'; report.stage = 'preview availability complete';
    console.log('Preview availability check passed. No Clerk user or room was created.');
  } else {
  report.stage = 'Clerk instance verification';
  const instance = await client.instance.get();
  if (instance.id !== report.instance || instance.environmentType !== 'development') throw new Error('Unexpected Clerk instance.');
  report.checks.push('Selected development instance and Clerk-only API configuration confirmed');

  browser = await chromium.launch({ channel: 'chrome', headless: true });
  if (profilesOnly) {
    const fixture = JSON.parse(readFileSync('docs/reports/evidence/WP1-CLERK-TWO-USER/result.json', 'utf8'));
    await runClerkProfileCheck({ client, browser, baseURL, issuer: selectedIssuer, directory, fixture, report, save });
    report.status = 'passed'; report.stage = 'complete';
    console.log(`Passed. Clerk participant profiles in room ${report.roomCode}. Evidence: ${directory}/result.json`);
  } else if (twoUsers) {
    await runClerkTwoUserAuction({ client, browser, baseURL, issuer: selectedIssuer, directory, report, save, resume });
    report.status = 'passed'; report.stage = 'complete';
    console.log(`Passed. Two-user auction room: ${report.roomCode}. Evidence: ${directory}/result.json`);
  } else {
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);
  page.setDefaultNavigationTimeout(30000);
  const testingToken = await client.testingTokens.createTestingToken();
  await context.route(`${selectedIssuer}/v1/**`, async route => {
    const url = new URL(route.request().url());
    url.searchParams.set('__clerk_testing_token', testingToken.token);
    await route.continue({ url: url.toString() });
  });
  report.stage = 'sign-in branding';
  await page.goto('/');
  await page.waitForFunction(() => window.Clerk?.loaded, undefined, { timeout: 45000 });
  await page.getByRole('button', { name: 'Create an auction', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: /^(Sign in to|Continue to) AuctionArena$/ })).toBeVisible();
  await page.screenshot({ path: `${directory}/sign-in.png` });
  report.checks.push('Actual Clerk sign-in heading shows AuctionArena');
  await page.evaluate(() => window.Clerk.closeSignIn());

  report.stage = 'create development test user';
  // Test email suffix prevents real email delivery. This is a new synthetic identity.
  const user = await client.users.createUser({
    emailAddress: [`auctionarena-smoke-${Date.now()}+clerk_test@example.com`],
    firstName: 'AuctionArena', lastName: 'Smoke Test', skipPasswordRequirement: true,
    privateMetadata: { purpose: 'auctionarena-live-smoke-test' },
  });
  report.testUserId = user.id;
  save();
  const ticket = await client.signInTokens.createSignInToken({ userId: user.id, expiresInSeconds: 60 });
  tokenId = ticket.id;
  report.stage = 'Clerk ticket sign-in';
  sessionId = await page.evaluate(async ticket => {
    const attempt = await window.Clerk.client.signIn.create({ strategy: 'ticket', ticket });
    if (attempt.status !== 'complete' || !attempt.createdSessionId) throw new Error('The test session requires additional authentication steps.');
    await window.Clerk.setActive({ session: attempt.createdSessionId });
    return attempt.createdSessionId;
  }, ticket.token);
  // Verify the original signed-out create intent resumes after Clerk activates the session.
  await expect(page.getByLabel('Room name', { exact: true })).toBeVisible();
  report.checks.push('Real Clerk session activated; pending create form resumed');
  const me = await page.evaluate(async () => {
    const token = await window.Clerk.session.getToken();
    const response = await fetch('/api/me', { headers: { Authorization: `Bearer ${token}` } });
    const body = await response.json();
    return { status: response.status, userId: body.user?.id };
  });
  if (me.status !== 200 || me.userId !== user.id) throw new Error('The API did not verify the real Clerk identity.');
  report.checks.push('API verified the Clerk-issued session token and exact test-user identity');

  report.stage = 'create test room';
  await page.getByLabel('Room name', { exact: true }).fill('AuctionArena Clerk smoke test');
  await page.getByRole('button', { name: 'Review settings' }).click();
  await page.getByRole('button', { name: 'Create private auction' }).click();
  await expect(page.getByRole('heading', { name: 'AuctionArena Clerk smoke test' })).toBeVisible();
  const code = new URL(page.url()).searchParams.get('room');
  if (!code) throw new Error('Room code was not returned.');
  report.roomCode = code; report.roomURL = `${baseURL}/?room=${code}`;
  await page.getByRole('button', { name: /Mumbai Meteors/ }).click();
  await expect(page.getByRole('button', { name: /Mumbai Meteors/ })).toContainText('(you)');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'AuctionArena Clerk smoke test' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Mumbai Meteors/ })).toContainText('(you)');
  await page.screenshot({ path: `${directory}/test-room.png`, fullPage: true });
  report.checks.push('UI created a private room, claimed a team and reopened it after reload');
  report.stage = 'sign out';
  await page.evaluate(() => window.Clerk.signOut());
  sessionId = undefined;
  await expect(page.getByRole('heading', { name: /Build a squad/ })).toBeVisible();
  const denied = await page.evaluate(async code => (await fetch(`/api/rooms/${code}`)).status, code);
  if (denied !== 401) throw new Error('Signed-out room access was not rejected.');
  report.checks.push('Sign-out cleared room UI and unauthenticated private access returned 401');
  report.status = 'passed'; report.stage = 'complete';
  console.log(`Passed. Test room: ${report.roomCode}. Evidence: ${directory}/result.json`);
  }
  }
} catch (error) {
  report.status = 'failed';
  // SDK/Playwright error strings can include request URLs or token arguments. Do not serialize them.
  report.error = { type: error?.name || 'Error', codes: error?.errors?.map(item => item.code) ?? [],
    ...(error.safeCode ? { code: error.safeCode, message: error.safeMessage } : {}) };
  if (error.safeMessage) console.error(error.safeMessage);
  else if (report.stage === 'Clerk instance verification') console.error('Could not verify the selected Clerk instance. Check the host network connection and run clerk doctor.');
  console.error(`Live Clerk check failed at: ${report.stage}. See ${directory}/result.json for redacted status.`);
  process.exitCode = 1;
} finally {
  if (sessionId) await client.sessions.revokeSession(sessionId).catch(() => { report.sessionCleanup = 'Could not revoke test session; review in Clerk dashboard.'; });
  if (tokenId) await client.signInTokens.revokeSignInToken(tokenId).catch(() => {});
  await browser?.close();
  await stopOwnedPreview();
  save();
}
