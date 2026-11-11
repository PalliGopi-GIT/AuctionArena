import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import type { ClerkClient } from '@clerk/backend';
import type { Room } from '../packages/shared/src/domain';
import { clerkProfileName } from '../apps/api/src/clerk-profile-name.ts';

interface Options {
  client: ClerkClient; browser: Browser; baseURL: string; issuer: string; directory: string;
  fixture: { status: string; roomCode: string; testUsers: { host: string; guest: string } };
  report: { stage: string; checks: string[]; roomCode?: string; names?: { host: string; guest: string }; sessionCleanupFailures?: number };
  save: () => void;
}

/** Existing synthetic identities only: reads and profile projection, with no auction intents. */
export async function runClerkProfileCheck({ client, browser, baseURL, issuer, directory, fixture, report, save }: Options) {
  const contexts: BrowserContext[] = [], sessions = new Map<Page, string>(), tickets: string[] = [];
  const stage = (name: string) => { report.stage = name; save(); console.log('Checking: ' + name); };
  const passed = (name: string) => { report.checks.push(name); save(); };
  const errors: string[] = [];
  const roomStates = new Map<Page, Room>();
  const auctionState = (room: Room) => { const { members, history, version, ...auction } = room; return auction; };
  try {
    stage('verify the existing synthetic identities and completed fixture');
    if (fixture.status !== 'passed' || !/^[A-Z0-9]{6}$/.test(fixture.roomCode) ||
        !/^user_[A-Za-z0-9]+$/.test(fixture.testUsers?.host) || !/^user_[A-Za-z0-9]+$/.test(fixture.testUsers?.guest) ||
        fixture.testUsers.host === fixture.testUsers.guest) throw new Error('A passing two-user fixture is required.');
    const host = await client.users.getUser(fixture.testUsers.host), guest = await client.users.getUser(fixture.testUsers.guest);
    for (const [user, role] of [[host, 'host'], [guest, 'guest']] as const) {
      expect(user.privateMetadata.purpose).toBe('auctionarena-two-user-test'); expect(user.privateMetadata.role).toBe(role);
    }
    const names = { host: clerkProfileName(host), guest: clerkProfileName(guest) };
    expect(names.host).not.toBe('Auction fan'); expect(names.guest).not.toBe('Auction fan');
    report.roomCode = fixture.roomCode; report.names = names; save();
    passed('Reused the two existing synthetic identities and completed room; no identities, rooms or auction actions created');

    async function request(page: Page, path: string) {
      return page.evaluate(async path => {
        const token = await window.Clerk.session?.getToken();
        const response = await fetch('/api' + path, { headers: { Authorization: 'Bearer ' + (token || '') } });
        return { status: response.status, body: await response.json() };
      }, path);
    }
    async function signIn(userId: string) {
      const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 1000 } });
      contexts.push(context);
      const testing = await client.testingTokens.createTestingToken();
      await context.route(`${issuer}/v1/**`, async route => {
        const url = new URL(route.request().url()); url.searchParams.set('__clerk_testing_token', testing.token);
        await route.continue({ url: url.toString() });
      });
      const page = await context.newPage(); page.setDefaultTimeout(20000);
      page.on('pageerror', error => errors.push(error.name));
      page.on('websocket', socket => socket.on('framereceived', frame => {
        try { const data = JSON.parse(frame.payload.toString()); if (data.room?.code === fixture.roomCode) roomStates.set(page, data.room); }
        catch { /* Ignore non-snapshot frames. */ }
      }));
      await page.goto('/'); await page.waitForFunction(() => window.Clerk?.loaded, undefined, { timeout: 45000 });
      const ticket = await client.signInTokens.createSignInToken({ userId, expiresInSeconds: 60 }); tickets.push(ticket.id);
      const sessionId = await page.evaluate(async ticketValue => {
        const attempt = await window.Clerk.client!.signIn.create({ strategy: 'ticket', ticket: ticketValue });
        if (attempt.status !== 'complete' || !attempt.createdSessionId) throw new Error('Incomplete test sign-in');
        await window.Clerk.setActive({ session: attempt.createdSessionId }); return attempt.createdSessionId;
      }, ticket.token);
      sessions.set(page, sessionId);
      await page.waitForFunction(id => window.Clerk.user?.id === id, userId);
      await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toHaveCount(0);
      return page;
    }
    stage('host API identity and completed-results profile name');
    const hostPage = await signIn(host.id);
    const hostMe = await request(hostPage, '/me');
    expect(hostMe.status).toBe(200); expect(hostMe.body.user).toEqual({ id: host.id, name: names.host });
    await hostPage.getByRole('button', { name: 'My auctions', exact: true }).click();
    await hostPage.locator('.room-list-card').filter({ hasText: fixture.roomCode }).click();
    await expect(hostPage.locator('.room-status')).toContainText('COMPLETED');
    await expect(hostPage.locator('.results-team').filter({ hasText: 'Mumbai' })).toContainText(names.host);
    const before = (await request(hostPage, '/rooms/' + fixture.roomCode)).body.room as Room;
    expect(before.hostId).toBe(host.id); expect(before.completion_reason).toBe('HOST_ENDED');
    passed('Host API and saved results show the Clerk Backend profile name for the verified subject');

    stage('guest profile, both result views and real WebSocket names');
    const guestPage = await signIn(guest.id);
    const guestMe = await request(guestPage, '/me');
    expect(guestMe.status).toBe(200); expect(guestMe.body.user).toEqual({ id: guest.id, name: names.guest });
    await guestPage.goto('/?room=' + fixture.roomCode);
    for (const page of [hostPage, guestPage]) {
      await expect(page.locator('.results-team').filter({ hasText: 'Mumbai' })).toContainText(names.host);
      await expect(page.locator('.results-team').filter({ hasText: 'Chennai' })).toContainText(names.guest);
      await expect.poll(() => roomStates.get(page)?.members.find(member => member.id === guest.id)?.name).toBe(names.guest);
      const snapshot = await request(page, '/rooms/' + fixture.roomCode);
      expect(snapshot.status).toBe(200); expect(auctionState(snapshot.body.room)).toEqual(auctionState(before));
      expect(snapshot.body.room.members.find((member: { id: string }) => member.id === host.id).name).toBe(names.host);
    }
    passed('Both real Clerk identities see both names in results and WebSocket snapshots; auction state and ownership remain exact');

    stage('reload, signed-out private denial and safe session cleanup');
    await guestPage.reload();
    await expect(guestPage.locator('.results-team').filter({ hasText: 'Chennai' })).toContainText(names.guest);
    await hostPage.screenshot({ path: `${directory}/host-profiles.png`, fullPage: true });
    await guestPage.screenshot({ path: `${directory}/guest-profiles.png`, fullPage: true });
    for (const page of [hostPage, guestPage]) {
      await page.evaluate(() => window.Clerk.signOut()); sessions.delete(page);
      await page.waitForFunction(() => window.Clerk?.loaded && !window.Clerk.user);
      await expect(page.getByRole('heading', { name: /Build a squad/ })).toBeVisible();
      await expect(page.locator('.arena')).toHaveCount(0);
      const response = await page.evaluate(async code => (await fetch('/api/rooms/' + code)).status, fixture.roomCode);
      expect(response).toBe(401);
    }
    expect(errors).toEqual([]);
    passed('Profile names survive reload; both users sign out and private reads return 401; no browser runtime errors');
  } finally {
    let failures = 0;
    for (const session of sessions.values()) await client.sessions.revokeSession(session).catch(() => { failures++; });
    for (const ticket of tickets) await client.signInTokens.revokeSignInToken(ticket).catch(() => {});
    if (failures) report.sessionCleanupFailures = failures;
    for (const context of contexts) await context.close();
  }
}
