import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import type { ClerkClient } from '@clerk/backend';
import type { useClerk } from '@clerk/react';
import type { Room } from '../packages/shared/src/domain';
import { assertPristineClerkRoom, type ClerkTwoUserFixture } from './clerk-two-user-fixture.ts';

declare global { interface Window { Clerk: ReturnType<typeof useClerk> } }

interface Report {
  stage: string;
  checks: string[];
  testUsers?: { host: string; guest: string };
  roomCode?: string;
  roomURL?: string;
  outcome?: { soldPlayer: string; salePrice: number; winnerBudget: number; hostBudget: number; completionReason?: string };
  sessionCleanupFailures?: number;
  checkpoint?: string;
  failureState?: unknown[];
}
interface Options {
  client: ClerkClient;
  browser: Browser;
  baseURL: string;
  issuer: string;
  directory: string;
  report: Report;
  save: () => void;
  resume?: ClerkTwoUserFixture;
}

/** Host-only test orchestration. Never store auth tokens, invitation tokens, traces or browser storage. */
export async function runClerkTwoUserAuction({ client, browser, baseURL, issuer, directory, report, save, resume }: Options) {
  const sessions = new Map<Page, string>();
  const tickets = new Set<string>();
  const contexts: BrowserContext[] = [];
  const stage = (name: string) => { report.stage = name; delete report.checkpoint; save(); console.log(`Checking: ${name}`); };
  const passed = (name: string) => { report.checks.push(name); save(); };
  const checkpoint = (name: string) => { report.checkpoint = name; save(); };
  const runtimeErrors: string[] = [];

  async function pageForUser() {
    const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
    contexts.push(context);
    const testing = await client.testingTokens.createTestingToken();
    await context.route(`${issuer}/v1/**`, async route => {
      const url = new URL(route.request().url());
      url.searchParams.set('__clerk_testing_token', testing.token);
      await route.continue({ url: url.toString() });
    });
    const page = await context.newPage();
    page.setDefaultTimeout(20000); page.setDefaultNavigationTimeout(30000);
    page.on('pageerror', error => runtimeErrors.push(error.name));
    const socketStates = new Set<string>();
    page.on('websocket', socket => socket.on('framereceived', frame => {
      try {
        const data = JSON.parse(frame.payload.toString());
        if (data.room?.code === report.roomCode) socketStates.add(data.room.status);
      } catch { /* Only room snapshots count as WebSocket evidence. */ }
    }));
    await page.goto('/');
    await page.waitForFunction(() => window.Clerk?.loaded, undefined, { timeout: 45000 });
    return { page, socketStates };
  }

  async function signIn(page: Page, userId: string) {
    checkpoint('wait for Clerk before ticket sign-in');
    await page.waitForFunction(() => window.Clerk?.loaded && !!window.Clerk.client);
    checkpoint('create and activate short-lived ticket session');
    const ticket = await client.signInTokens.createSignInToken({ userId, expiresInSeconds: 60 });
    tickets.add(ticket.id);
    const session = await page.evaluate(async ticketValue => {
      const attempt = await window.Clerk.client!.signIn.create({ strategy: 'ticket', ticket: ticketValue });
      if (attempt.status !== 'complete' || !attempt.createdSessionId) throw new Error('Test identity needs additional sign-in steps.');
      await window.Clerk.setActive({ session: attempt.createdSessionId });
      return attempt.createdSessionId;
    }, ticket.token);
    sessions.set(page, session);
    checkpoint('wait for active Clerk identity and React sign-in');
    await page.waitForFunction(id => window.Clerk.user?.id === id, userId);
    await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toHaveCount(0);
    checkpoint('verify authenticated API identity');
    const me = await request(page, '/me');
    expect(me.status).toBe(200); expect(me.body.user.id).toBe(userId);
  }

  async function signOut(page: Page) {
    checkpoint('sign out active Clerk session');
    await page.evaluate(() => window.Clerk.signOut());
    sessions.delete(page);
    checkpoint('wait for signed-out Clerk identity and private UI cleanup');
    await page.waitForFunction(() => window.Clerk?.loaded && !window.Clerk.user && !window.Clerk.session);
    await expect(page.getByRole('heading', { name: /Build a squad/ })).toBeVisible();
    await expect(page.locator('.arena')).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    checkpoint('verify invitation cache and room route cleared after sign-out');
    await expect.poll(() => page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith('invite-')).length)).toBe(0);
    await expect.poll(() => new URL(page.url()).search).toBe('');
  }

  async function request(page: Page, path: string, body?: object) {
    return page.evaluate(async ({ path, body }) => {
      const token = await window.Clerk.session?.getToken();
      const response = await fetch('/api' + path, {
        method: body ? 'POST' : 'GET',
        headers: { Authorization: `Bearer ${token || ''}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: response.status, body: await response.json() };
    }, { path, body });
  }

  function roomFrom(response: Awaited<ReturnType<typeof request>>): Room {
    expect(response.status).toBe(200);
    expect(response.body.room.code).toBe(report.roomCode);
    return response.body.room as Room;
  }

  try {
    stage(resume ? 'verify and reuse the retained synthetic development identities' : 'create two synthetic development identities');
    const suffix = Date.now();
    const createUser = (role: string) => client.users.createUser({
      emailAddress: [`auctionarena-${role}-${suffix}+clerk_test@example.com`],
      firstName: 'AuctionArena', lastName: `Test ${role}`, skipPasswordRequirement: true,
      privateMetadata: { purpose: 'auctionarena-two-user-test', role },
    });
    const hostUser = resume ? await client.users.getUser(resume.testUsers.host) : await createUser('host');
    report.testUsers = { host: hostUser.id, guest: resume?.testUsers.guest || '' }; save();
    const guestUser = resume ? await client.users.getUser(resume.testUsers.guest) : await createUser('guest');
    report.testUsers.guest = guestUser.id; save();
    expect(hostUser.id).not.toBe(guestUser.id);
    for (const [user, role] of [[hostUser, 'host'], [guestUser, 'guest']] as const) {
      expect(user.privateMetadata.purpose).toBe('auctionarena-two-user-test');
      expect(user.privateMetadata.role).toBe(role);
    }
    const host = await pageForUser();

    let code: string;
    if (resume) {
      stage('reopen the retained private room without creating another');
      report.roomCode = resume.roomCode; report.roomURL = `${baseURL}/?room=${resume.roomCode}`; save();
      await signIn(host.page, hostUser.id);
      const retained = roomFrom(await request(host.page, `/rooms/${resume.roomCode}`));
      assertPristineClerkRoom(retained, resume);
      await host.page.getByRole('button', { name: 'My auctions', exact: true }).click();
      await host.page.locator('.room-list-card').filter({ hasText: resume.roomCode }).click();
      await expect(host.page.getByRole('heading', { name: 'AuctionArena two-user Clerk test' })).toBeVisible();
      // The failed attempt retained its invite only in a destroyed browser context.
      // Renew through the UI so this retry also exercises clearing a real credential.
      await host.page.getByRole('button', { name: 'Renew invite', exact: true }).click();
      await expect.poll(() => host.page.evaluate(code => !!sessionStorage.getItem('invite-' + code), resume.roomCode)).toBe(true);
      code = resume.roomCode;
      passed('Reused the same two synthetic identities and pristine private room; no additional user or room was created');
    } else {
    stage('host sign-in and private room creation');
    await host.page.getByRole('button', { name: 'Create an auction', exact: true }).click();
    await signIn(host.page, hostUser.id);
    await expect(host.page.getByLabel('Room name', { exact: true })).toBeVisible();
    await host.page.getByLabel('Room name', { exact: true }).fill('AuctionArena two-user Clerk test');
    for (const [label, value] of [
      ['Number of teams', '2'], ['Budget (lakhs)', '2000'], ['Minimum squad', '1'],
      ['Maximum squad', '2'], ['Overseas limit', '2'], ['Bid timer (seconds)', '20'],
    ]) await host.page.getByLabel(label).fill(value);
    await host.page.getByLabel('Extend timer after a late bid').uncheck();
    await host.page.getByLabel('Automatically open the next player').uncheck();
    await host.page.getByRole('button', { name: 'Review settings' }).click();
    await host.page.getByRole('button', { name: 'Create private auction' }).click();
    await expect(host.page.getByRole('heading', { name: 'AuctionArena two-user Clerk test' })).toBeVisible();
    const createdCode = new URL(host.page.url()).searchParams.get('room');
    if (!createdCode) throw new Error('Room code missing');
    code = createdCode;
    report.roomCode = code; report.roomURL = `${baseURL}/?room=${code}`; save();
    await host.page.getByRole('button', { name: /Mumbai Meteors/ }).click();
    const initial = roomFrom(await request(host.page, `/rooms/${code}`));
    expect(initial.hostId).toBe(hostUser.id);
    expect(initial.teams[0]!.ownerId).toBe(hostUser.id);
    passed('Host created exactly one private room and claimed Mumbai using its verified Clerk identity');
    }

    stage('switch the host tab to the uninvited guest identity');
    await signOut(host.page);
    await signIn(host.page, guestUser.id);
    checkpoint('verify guest room list and private access denial');
    await host.page.getByRole('button', { name: 'My auctions', exact: true }).click();
    await expect(host.page.locator('.room-list-card')).toHaveCount(0);
    await expect(host.page.locator('.arena')).toHaveCount(0);
    const list = await request(host.page, '/me');
    expect(list.body.rooms.some((room: Room) => room.code === code)).toBe(false);
    const denied = await request(host.page, `/rooms/${code}`);
    expect(denied.status).toBe(403); expect(denied.body.code).toBe('FORBIDDEN');
    expect(denied.body.room).toBeUndefined();
    const deniedTicket = await request(host.page, `/rooms/${code}/ws-ticket`, {});
    expect(deniedTicket.status).toBe(403); expect(deniedTicket.body.ticket).toBeUndefined();
    passed('Switching identities cleared the room, room list, route and invitations; uninvited guest HTTP and socket-ticket access were denied');

    stage('restore the host and explicitly issue a new invitation');
    await signOut(host.page); await signIn(host.page, hostUser.id);
    await host.page.getByRole('button', { name: 'My auctions', exact: true }).click();
    await host.page.locator('.room-list-card').filter({ hasText: code }).click();
    await expect(host.page.getByRole('button', { name: /Mumbai Meteors/ })).toContainText('(you)');
    await host.page.getByRole('button', { name: 'Renew invite', exact: true }).click();
    await expect(host.page.getByRole('status').filter({ hasText: 'Invitation renewed' })).toBeVisible();
    const invite = await host.page.evaluate(code => sessionStorage.getItem('invite-' + code), code);
    if (!invite) throw new Error('Host invitation missing');
    const guest = await pageForUser();
    await signIn(guest.page, guestUser.id);
    const invalid = await request(guest.page, `/rooms/${code}/join`, { inviteToken: 'invalid-test-invitation' });
    expect(invalid.status).toBe(400); expect(invalid.body.code).toBe('INVALID_INVITE');
    expect((await request(guest.page, `/rooms/${code}`)).status).toBe(403);
    passed('An invalid invitation did not grant membership');

    stage('guest joins by invitation and claims Chennai');
    await guest.page.goto(`/?room=${code}&invite=${encodeURIComponent(invite)}`);
    await expect(guest.page.getByRole('button', { name: 'Join private auction' })).toBeVisible();
    await guest.page.getByRole('button', { name: 'Join private auction' }).click();
    await expect(guest.page.getByRole('heading', { name: 'AuctionArena two-user Clerk test' })).toBeVisible();
    await guest.page.getByRole('button', { name: /Chennai/ }).click();
    await expect(host.page.getByRole('button', { name: /Chennai/ })).toBeDisabled();
    const joined = roomFrom(await request(host.page, `/rooms/${code}`));
    expect(joined.members).toHaveLength(2); expect(joined.teams[1]!.ownerId).toBe(guestUser.id);
    passed('Valid invitation admitted the second real Clerk identity and broadcast its Chennai claim');

    stage('ready, host-only start and live bid');
    await guest.page.getByRole('button', { name: /ready/, exact: false }).click();
    await host.page.getByRole('button', { name: /ready/, exact: false }).click();
    const forbiddenStart = await request(guest.page, `/rooms/${code}/actions`, { id: crypto.randomUUID(), type: 'start' });
    expect(forbiddenStart.status).toBe(400); expect(forbiddenStart.body.code).toBe('HOST_ONLY');
    await host.page.getByRole('button', { name: 'Start auction', exact: true }).click();
    await expect(guest.page.locator('.room-status')).toContainText('LIVE');
    await guest.page.getByRole('button', { name: /^Bid / }).click();
    await expect(host.page.locator('.leading')).toContainText('Chennai');
    await expect(guest.page.getByRole('button', { name: /leading/ })).toBeDisabled();
    passed('Both owners readied, guest host controls were rejected, and guest bid was confirmed by the other browser');

    stage('settle the sale and reconcile both browsers');
    await expect(host.page.locator('.room-status')).toContainText('RESULT', { timeout: 30000 });
    await expect(guest.page.locator('.room-status')).toContainText('RESULT');
    await expect.poll(() => host.socketStates.has('RESULT') && guest.socketStates.has('RESULT')).toBe(true);
    const soldHost = roomFrom(await request(host.page, `/rooms/${code}`));
    const soldGuest = roomFrom(await request(guest.page, `/rooms/${code}`));
    expect(soldHost.players[0]!.status).toBe('sold'); expect(soldHost.players[0]!.soldTo).toBe('t2');
    expect(soldHost.teams[1]!.budget).toBe(1900);
    expect(soldHost.teams[1]!.squad).toEqual([{ playerId: 'p1', price: 100 }]);
    expect(soldGuest.teams).toEqual(soldHost.teams);
    passed('Real WebSocket result snapshots reached both browsers; one sale and exact winning budget/squad reconciled');

    stage('end the auction, check results and reopen');
    await host.page.getByRole('button', { name: 'End auction', exact: true }).click();
    await host.page.getByRole('dialog').getByRole('button', { name: 'End auction', exact: true }).click();
    for (const page of [host.page, guest.page]) {
      await expect(page.locator('.room-status')).toContainText('COMPLETED');
      await expect(page.getByLabel('Auction totals')).toContainText('₹1.00 Cr');
      await expect(page.locator('.results-team').filter({ hasText: 'Chennai' })).toContainText('₹19.00 Cr');
    }
    const final = roomFrom(await request(host.page, `/rooms/${code}`));
    expect(final.completion_reason).toBe('HOST_ENDED');
    expect(final.teams[0]!.budget).toBe(2000);
    report.outcome = { soldPlayer: 'p1', salePrice: 100, winnerBudget: 1900, hostBudget: 2000, completionReason: final.completion_reason };
    await guest.page.reload();
    await expect(guest.page.getByLabel('Auction totals')).toContainText('₹1.00 Cr');
    await host.page.screenshot({ path: `${directory}/host-results.png`, fullPage: true });
    await guest.page.screenshot({ path: `${directory}/guest-results.png`, fullPage: true });
    passed('Both real Clerk members saw completed results; totals, preserved squads and guest reload matched the final state');

    stage('sign out both identities and deny private results');
    for (const page of [host.page, guest.page]) {
      await signOut(page);
      const signedOut = await page.evaluate(async code => (await fetch(`/api/rooms/${code}`)).status, code);
      expect(signedOut).toBe(401);
    }
    expect(runtimeErrors).toEqual([]);
    passed('Both identities signed out, cleared private browser state and received 401 for private results; no browser runtime errors');
  } catch (error) {
    report.failureState = [];
    // Only synthetic test contexts are captured; mask invitation/password/form values.
    for (const [index, context] of contexts.entries()) {
      const page = context.pages()[0];
      // Record bounded diagnostics only: never URLs, storage values, SDK objects or raw errors.
      if (page) report.failureState.push(await page.evaluate(() => ({
        clerkLoaded: !!window.Clerk?.loaded, signedIn: !!window.Clerk?.user, activeSession: !!window.Clerk?.session,
        identityMarkerPresent: !!sessionStorage.getItem('aa-session-identity'),
        identityMarkerMatches: sessionStorage.getItem('aa-session-identity') === window.Clerk?.user?.id,
        invitationCount: Object.keys(sessionStorage).filter(key => key.startsWith('invite-')).length,
        roomRoutePresent: new URLSearchParams(location.search).has('room'),
        inviteRoutePresent: new URLSearchParams(location.search).has('invite'),
        arenaCount: document.querySelectorAll('.arena').length, dialogCount: document.querySelectorAll('[role="dialog"]').length,
      })).catch(() => ({ unavailable: true })));
      if (page) await page.screenshot({ path: `${directory}/failure-${index + 1}.png`, fullPage: true, mask: [page.locator('input')] }).catch(() => {});
    }
    save();
    throw error;
  } finally {
    let failures = 0;
    for (const session of sessions.values()) await client.sessions.revokeSession(session).catch(() => { failures++; });
    for (const ticket of tickets) await client.signInTokens.revokeSignInToken(ticket).catch(() => {});
    if (failures) report.sessionCleanupFailures = failures;
    for (const context of contexts) await context.close();
  }
}
