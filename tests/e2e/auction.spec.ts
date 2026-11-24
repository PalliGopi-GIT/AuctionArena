import { test, expect } from '@playwright/test';
import { create, currentLot, join, login, money, readRoom } from './helpers';

test('two browsers complete a sale, recover, remove/block and reopen results', async ({ page, browser }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  // Legacy room: this test pins an exact purse (₹2,000) and result timing.
  const { code, invite } = await create(page, { budget: 2000 });
  await page.getByRole('button', { name: /Mumbai Indians/ }).click();
  const guestContext = await browser.newContext({ baseURL: 'http://127.0.0.1:5273', viewport: testInfo.project.use.viewport, isMobile: !!testInfo.project.use.isMobile, hasTouch: !!testInfo.project.use.hasTouch });
  const guest = await guestContext.newPage();
  guest.on('pageerror', error => errors.push(error.message));
  try {
    await join(guest, code, invite);
    await guest.getByRole('button', { name: /Chennai Super Kings/ }).click();
    await guest.getByRole('button', { name: 'I’m ready' }).click();
    await page.getByRole('button', { name: 'I’m ready' }).click();
    await page.getByRole('button', { name: 'Start auction', exact: true }).click();
    await expect(guest.locator('.room-status')).toContainText('LIVE');
    const { lot } = await currentLot(page, code);
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(guest.locator('.room-status')).toContainText('PAUSED');
    await expect(guest.getByRole('button', { name: /^Bid ₹/ })).toBeDisabled();
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await guest.getByRole('button', { name: /^Bid ₹/ }).click();
    await expect(page.locator('.leading')).toContainText('Chennai');
    await guest.reload();
    await expect(guest.getByRole('button', { name: 'You’re leading' })).toBeVisible();
    await expect(page.locator('.room-status')).toContainText('RESULT', { timeout: 20_000 });
    await expect(guest.locator('.room-status')).toContainText('RESULT');
    const sold = (await readRoom(page, code)).body.room;
    expect(sold.teams[1].budget).toBe(2000 - lot.basePrice);
    expect(sold.teams[1].squad).toEqual([{ playerId: lot.id, price: lot.basePrice }]);
    await guestContext.setOffline(true);
    await expect(guest.locator('.room-status')).toContainText('Reconnecting');
    await guestContext.setOffline(false);
    await expect(guest.locator('.room-status')).toContainText('Connected');
    await page.getByRole('button', { name: 'members', exact: true }).click();
    await page.getByRole('button', { name: 'Remove and block E2E Guest' }).click();
    await page.getByRole('button', { name: 'Remove participant', exact: true }).click();
    await expect(page.locator('.member-list')).not.toContainText('E2E Guest');
    const denied = await readRoom(guest, code);
    expect(denied.status).toBe(403);
    expect(denied.body.code).toBe('ROOM_BLOCKED');
    await expect(guest.getByRole('alert')).toBeVisible();
    await expect(guest.locator('.arena')).toHaveCount(0);
    await expect(guest.getByRole('heading', { name: /Build a squad/ })).toBeVisible();
    const preserved = (await readRoom(page, code)).body.room;
    expect(preserved.teams[1]).toEqual(sold.teams[1]);
    await page.getByRole('button', { name: 'auction', exact: true }).click();
    await page.getByRole('button', { name: 'End auction', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'End auction', exact: true }).click();
    await expect(page.locator('.room-status')).toContainText('COMPLETED');
    await expect(page.getByLabel('Auction end reason')).toContainText('The host ended the auction');
    await expect(page.getByLabel('Auction totals')).toContainText(money(lot.basePrice));
    await expect(page.locator('.results-team').filter({ hasText: 'Chennai' })).toContainText(money(2000 - lot.basePrice));
    await page.reload();
    await expect(page.getByLabel('Auction totals')).toContainText(money(lot.basePrice));
    await expect(page.locator('.results-team').filter({ hasText: 'Chennai' })).toContainText(money(2000 - lot.basePrice));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `${process.env.AA_EVIDENCE_DIR ?? 'docs/reports/evidence/WP1-E2E'}/${testInfo.project.name}-results.png`, fullPage: true });
    expect(errors).toEqual([]);
  } finally {
    await guestContext.close();
  }
});

test('invitation renewal, invalid invite, leave and close before start', async ({ page, browser }) => {
  const { code, invite } = await create(page);
  await page.getByRole('button', { name: 'Renew invite', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Invitation renewed' })).toBeVisible();
  const renewed = await page.evaluate(code => sessionStorage.getItem('invite-' + code), code);
  expect(renewed).not.toBe(invite);
  const guestContext = await browser.newContext({ baseURL: 'http://127.0.0.1:5273' });
  const guest = await guestContext.newPage();
  try {
    await joinWithInvalidInvite();
    // The join form takes a room code or a full link, not a bare token.
    await guest.getByLabel('Room code or invitation link').fill(`http://127.0.0.1:5273/?room=${code}&invite=${renewed}`);
    await guest.getByRole('button', { name: 'Join private auction' }).click();
    await expect(guest.getByRole('heading', { name: 'Browser auction' })).toBeVisible();
    await guest.getByRole('button', { name: /Chennai Super Kings/ }).click();
    await guest.getByRole('button', { name: 'Leave lobby', exact: true }).click();
    await guest.getByRole('dialog').getByRole('button', { name: 'Leave lobby', exact: true }).click();
    await expect(guest.getByRole('heading', { name: /Build a squad/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Chennai Super Kings/ })).toContainText('Available to claim');
    await page.getByRole('button', { name: 'Close room', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Close room', exact: true }).click();
    await expect(page.locator('.room-status')).toContainText('CLOSED');
    await expect(page.getByLabel('Auction end reason')).toContainText('before bidding started');
    await expect(page.getByLabel('Auction totals')).toContainText('₹0');
  } finally { await guestContext.close(); }

  async function joinWithInvalidInvite() {
    await guest.goto(`/?room=${code}&invite=${invite}`);
    await guest.getByRole('banner').getByRole('button', { name: 'Sign in' }).click();
    await login(guest, 'E2E Guest');
    await guest.getByRole('button', { name: 'Join private auction' }).click();
    await expect(guest.getByRole('alert')).toBeVisible();
    await expect(guest.getByRole('dialog')).toBeVisible();
  }
});

test('switching local profiles clears the prior private room and invitation', async ({ page }) => {
  const { code } = await create(page);
  await page.getByRole('button', { name: /Mumbai Indians/ }).click();
  await page.locator('.user-pill').click();
  await page.getByRole('button', { name: 'Sign out of local profile' }).click();
  await expect(page.getByRole('heading', { name: /Build a squad/ })).toBeVisible();
  expect(await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith('invite-')))).toEqual([]);
  expect(new URL(page.url()).search).toBe('');
  await page.getByRole('banner').getByRole('button', { name: 'Sign in' }).click();
  await login(page, 'Next identity');
  await page.locator('.user-pill').click();
  await expect(page.locator('.room-list-card')).toHaveCount(0);
  await expect(page.locator('.arena')).toHaveCount(0);
  const denied = await readRoom(page, code);
  expect(denied.status).toBe(404);
  expect(denied.body.code).toBe('ROOM_NOT_FOUND');
});

test('a signed-out full reload clears the old identity invitation and room route', async ({ page }) => {
  await create(page);
  expect(await page.evaluate(() => sessionStorage.getItem('aa-session-identity'))).toBeTruthy();
  // Model an external identity provider reloading before React observes sign-out.
  await page.evaluate(() => { localStorage.removeItem('aa-user'); localStorage.removeItem('aa-token'); });
  await page.reload();
  await expect(page.getByRole('heading', { name: /Build a squad/ })).toBeVisible();
  await expect(page.locator('.arena')).toHaveCount(0);
  expect(await page.evaluate(() => Object.keys(sessionStorage).filter(key => key.startsWith('invite-')))).toEqual([]);
  expect(new URL(page.url()).search).toBe('');
});

test('real clipboard invitations join and results links work without invitation credentials', async ({ page, browser }) => {
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const { code, invite } = await create(page);
  await page.getByRole('button', { name: 'Copy Link', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Copied to clipboard' })).toBeVisible();
  const copied = new URL(await page.evaluate(() => navigator.clipboard.readText()));
  expect(copied.origin).toBe('http://127.0.0.1:5273');
  expect(copied.searchParams.get('room')).toBe(code);
  expect(copied.searchParams.get('invite')).toBe(invite);
  const guestContext = await browser.newContext({ baseURL: 'http://127.0.0.1:5273' });
  const guest = await guestContext.newPage();
  try {
    // Join through the same single-field form every other test uses; the URL
    // prefill leaves only the bare token, which the form rejects.
    await guest.goto(copied.toString());
    await guest.getByRole('banner').getByRole('button', { name: 'Sign in' }).click();
    await login(guest, 'Clipboard guest');
    const joinButton = guest.getByRole('button', { name: 'Join private auction' });
    await joinButton.or(guest.getByRole('heading', { name: 'Browser auction' })).first().waitFor({ state: 'visible' });
    if (await joinButton.isVisible().catch(() => false)) {
      await guest.getByLabel('Room code or invitation link').fill(copied.toString());
      await joinButton.click();
    }
    await expect(guest.getByRole('heading', { name: 'Browser auction' })).toBeVisible();
    await page.getByRole('button', { name: 'Close room', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Close room', exact: true }).click();
    await page.evaluate(code => sessionStorage.removeItem('invite-' + code), code);
    await page.reload();
    await page.getByRole('button', { name: 'Copy results link' }).click();
    await expect(page.getByRole('status').filter({ hasText: 'Copied to clipboard' })).toBeVisible();
    const result = new URL(await page.evaluate(() => navigator.clipboard.readText()));
    expect([...result.searchParams.entries()]).toEqual([['room', code]]);
    await guest.goto(result.toString());
    await expect(guest.getByLabel('Auction totals')).toBeVisible();
    await expect(guest.locator('.room-status')).toContainText('CLOSED');
  } finally { await guestContext.close(); }
});

test('clipboard denial provides selectable links with keyboard focus and clears pending copies on sign-out', async ({ page }, testInfo) => {
  const { code } = await create(page);
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    writeText: async () => { throw new DOMException('Denied for this test', 'NotAllowedError'); },
  } }));
  const trigger = page.getByRole('button', { name: 'Copy Link', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'Copy invitation', exact: true });
  const link = dialog.getByLabel('Invitation link');
  await expect(link).toBeFocused();
  const selection = await link.evaluate((input: HTMLInputElement) => ({ readonly: input.readOnly, selected: input.selectionStart === 0 && input.selectionEnd === input.value.length }));
  expect(selection).toEqual({ readonly: true, selected: true });
  expect(new URL(await link.inputValue()).searchParams.get('room')).toBe(code);
  await dialog.getByRole('button', { name: 'Select link' }).click();
  await expect(link).toBeFocused();
  await dialog.getByRole('button', { name: 'Done', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: 'Close dialog' })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Done', exact: true })).toBeFocused();
  await page.screenshot({ path: `${process.env.AA_EVIDENCE_DIR ?? 'docs/reports/evidence/WP1-ROOM-RESILIENCE'}/${testInfo.project.name}-manual-copy.png`, fullPage: true, mask: [link] });
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.getByRole('button', { name: 'Close room', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Close room', exact: true }).click();
  await page.getByRole('button', { name: 'Copy results link' }).click();
  const resultsDialog = page.getByRole('dialog', { name: 'Copy results link', exact: true });
  const resultsLink = resultsDialog.getByLabel('Results link', { exact: true });
  await expect(resultsLink).toBeFocused();
  expect([...new URL(await resultsLink.inputValue()).searchParams.entries()]).toEqual([['room', code]]);
  await resultsDialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Copy results link' })).toBeFocused();
  // A clipboard permission result may arrive after the user changes identity.
  await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    writeText: () => new Promise<void>((_, reject) => { (window as Window & { rejectTestCopy?: () => void }).rejectTestCopy = () => reject(new Error('Delayed denial')); }),
  } }));
  await trigger.click();
  await page.locator('.user-pill').click();
  await page.getByRole('button', { name: 'Sign out of local profile' }).click();
  await page.evaluate(() => (window as Window & { rejectTestCopy?: () => void }).rejectTestCopy?.());
  await expect(page.getByRole('heading', { name: /Build a squad/ })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(await page.evaluate(() => Object.keys(sessionStorage).some(key => key.startsWith('invite-')))).toBe(false);
});

test('host heartbeat expiry pauses an accepted bid until the host reconnects and resumes', async ({ page, browser }, testInfo) => {
  test.setTimeout(100000);
  const { code, invite } = await create(page, { timer: 30, budget: 2000 });
  await page.getByRole('button', { name: /Mumbai Indians/ }).click();
  const guestContext = await browser.newContext({ baseURL: 'http://127.0.0.1:5273', viewport: testInfo.project.use.viewport, isMobile: !!testInfo.project.use.isMobile, hasTouch: !!testInfo.project.use.hasTouch });
  const guest = await guestContext.newPage();
  try {
    await join(guest, code, invite);
    await guest.getByRole('button', { name: /Chennai Super Kings/ }).click();
    await page.getByRole('button', { name: 'Start auction', exact: true }).click();
    await expect(guest.locator('.room-status')).toContainText('LIVE');
    const { lot } = await currentLot(page, code);
    await guest.getByRole('button', { name: /^Bid / }).click();
    await expect(page.locator('.leading')).toContainText('Chennai');
    const accepted = (await readRoom(guest, code)).body.room;
    await page.context().setOffline(true);
    await expect(guest.locator('.room-status')).toContainText('PAUSED', { timeout: 16000 });
    await expect(guest.locator('#bid-reason')).toContainText('paused');
    const paused = (await readRoom(guest, code)).body.room;
    expect(paused.leadingTeamId).toBe('t2'); expect(paused.currentBid).toBe(lot.basePrice);
    expect(paused.players[paused.currentPlayerIndex].status).toBe('open'); expect(paused.teams).toEqual(accepted.teams);
    expect(paused.pausedRemaining).toBeGreaterThan(0);
    // Keep the guest connected beyond the original server deadline; nothing may settle while paused.
    await expect.poll(async () => { await readRoom(guest, code); return Date.now() > accepted.deadline + 500; }, { timeout: 35000, intervals: [1000] }).toBe(true);
    const held = (await readRoom(guest, code)).body.room;
    expect(held.status).toBe('PAUSED'); expect(held.pausedRemaining).toBe(paused.pausedRemaining);
    expect(held.teams).toEqual(accepted.teams);
    await guest.screenshot({ path: `${process.env.AA_EVIDENCE_DIR ?? 'docs/reports/evidence/WP1-ROOM-RESILIENCE'}/${testInfo.project.name}-host-away.png`, fullPage: true });
    await page.context().setOffline(false);
    await expect(page.locator('.room-status')).toContainText('Connected');
    await expect(page.locator('.room-status')).toContainText('PAUSED');
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await expect(guest.locator('.room-status')).toContainText('LIVE');
    const resumed = (await readRoom(guest, code)).body.room;
    expect(resumed.currentBid).toBe(lot.basePrice); expect(resumed.leadingTeamId).toBe('t2');
    expect(resumed.deadline - Date.now()).toBeGreaterThan(paused.pausedRemaining - 4000);
    expect(resumed.deadline - Date.now()).toBeLessThanOrEqual(paused.pausedRemaining);
    await expect(guest.locator('.room-status')).toContainText('RESULT', { timeout: 35000 });
    const sold = (await readRoom(guest, code)).body.room;
    expect(sold.teams[1].budget).toBe(2000 - lot.basePrice);
    expect(sold.teams[1].squad).toEqual([{ playerId: lot.id, price: lot.basePrice }]);
    expect(sold.history.filter((event: { type: string }) => event.type === 'sold')).toHaveLength(1);
  } finally { await page.context().setOffline(false); await guestContext.close(); }
});

for (const allowed of [true, false]) test(`late invited spectator is ${allowed ? 'read-only and receives results' : 'denied when spectators are disabled'}`, async ({ page, browser }, testInfo) => {
  const { code, invite } = await create(page, { timer: 60, spectators: allowed, budget: 2000 });
  await page.getByRole('button', { name: /Mumbai Indians/ }).click();
  const participantContext = await browser.newContext({ baseURL: 'http://127.0.0.1:5273' });
  const spectatorContext = await browser.newContext({ baseURL: 'http://127.0.0.1:5273', viewport: testInfo.project.use.viewport, isMobile: !!testInfo.project.use.isMobile, hasTouch: !!testInfo.project.use.hasTouch });
  const participant = await participantContext.newPage(), spectator = await spectatorContext.newPage();
  const socketStates = new Set<string>();
  spectator.on('websocket', socket => socket.on('framereceived', frame => {
    try { const data = JSON.parse(frame.payload.toString()); if (data.room?.code === code) socketStates.add(data.room.status); } catch { /* Snapshot frames only. */ }
  }));
  try {
    await join(participant, code, invite); await participant.getByRole('button', { name: /Chennai Super Kings/ }).click();
    await page.getByRole('button', { name: 'Start auction', exact: true }).click();
    await expect(participant.locator('.room-status')).toContainText('LIVE');
    const { lot } = await currentLot(page, code);
    await join(spectator, code, invite, 'Late spectator', allowed);
    if (!allowed) {
      await expect(spectator.getByRole('alert')).toContainText('Room unavailable');
      expect((await readRoom(spectator, code)).status).toBe(404);
      expect((await readRoom(page, code)).body.room.members).toHaveLength(2);
      return;
    }
    await expect(spectator.locator('#bid-reason')).toContainText('spectating');
    await expect(spectator.getByRole('button', { name: /^Bid / })).toBeDisabled();
    const rejected = await spectator.evaluate(async ({ code, lot }) => {
      const post = async (type: string, extra: object) => {
        const response = await fetch(`/api/rooms/${code}/actions`, { method: 'POST', headers: { Authorization: 'Bearer ' + localStorage.getItem('aa-token'), 'Content-Type': 'application/json' }, body: JSON.stringify({ id: crypto.randomUUID(), type, ...extra }) });
        return { status: response.status, code: (await response.json()).code };
      };
      return [await post('claim', { teamId: 't1' }), await post('bid', { playerId: lot.id, amount: lot.basePrice })];
    }, { code, lot });
    expect(rejected).toEqual([{ status: 400, code: 'ALREADY_STARTED' }, { status: 400, code: 'NO_TEAM' }]);
    await participant.getByRole('button', { name: /^Bid / }).click();
    await expect(spectator.locator('.leading')).toContainText('Chennai');
    await page.getByRole('button', { name: 'End auction', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'End auction', exact: true }).click();
    await expect(spectator.getByLabel('Auction totals')).toContainText(money(lot.basePrice));
    await expect.poll(() => socketStates.has('COMPLETED')).toBe(true);
    const final = (await readRoom(spectator, code)).body.room;
    expect(final.members).toHaveLength(3);
    expect(final.teams.map((team: { ownerId: string }) => team.ownerId).filter(Boolean)).toHaveLength(2);
    expect(final.teams[1].budget).toBe(2000 - lot.basePrice);
    await spectator.reload();
    await expect(spectator.getByLabel('Auction totals')).toContainText(money(lot.basePrice));
    await spectator.screenshot({ path: `${process.env.AA_EVIDENCE_DIR ?? 'docs/reports/evidence/WP1-ROOM-RESILIENCE'}/${testInfo.project.name}-spectator-results.png`, fullPage: true });
  } finally { await participantContext.close(); await spectatorContext.close(); }
});

test('depleted purses disable bids and finish with an affordability reason', async ({ page, browser }, testInfo) => {
  test.setTimeout(120_000);
  const { code, invite } = await create(page, { budget: 200, maxSquad: 8 });
  await page.getByRole('button', { name: /Mumbai Indians/ }).click();
  const guestContext = await browser.newContext({ baseURL: 'http://127.0.0.1:5273', viewport: testInfo.project.use.viewport, isMobile: !!testInfo.project.use.isMobile, hasTouch: !!testInfo.project.use.hasTouch });
  const guest = await guestContext.newPage();
  try {
    await join(guest, code, invite);
    await guest.getByRole('button', { name: /Chennai Super Kings/ }).click();
    await page.getByRole('button', { name: 'Start auction', exact: true }).click();
    await expect(guest.locator('.room-status')).toContainText('LIVE');
    const { lot } = await currentLot(page, code);
    // The opening marquee is tier A at a 200-lakh base price. Both teams have
    // exactly 200, so each can win one opening lot and then neither can bid.
    expect(lot.basePrice).toBe(200);
    await page.getByRole('button', { name: /^Bid / }).click();
    await expect(page.locator('.room-status')).toContainText('RESULT', { timeout: 20_000 });
    let state = (await readRoom(page, code)).body.room;
    expect(state.teams.map((team: { budget: number }) => team.budget)).toEqual([0, 200]);
    await page.getByRole('button', { name: 'Next player' }).click();
    await expect(guest.locator('.room-status')).toContainText('LIVE');
    await guest.getByRole('button', { name: /^Bid / }).click();
    await expect(page.locator('.room-status')).toContainText('RESULT', { timeout: 20_000 });
    state = (await readRoom(page, code)).body.room;
    expect(state.teams.map((team: { budget: number }) => team.budget)).toEqual([0, 0]);
    await page.getByRole('button', { name: 'Next player' }).click();
    await expect(page.locator('.room-status')).toContainText('COMPLETED');
    await expect(guest.locator('.room-status')).toContainText('COMPLETED');
    await expect(page.getByLabel('Auction end reason')).toContainText('No participating team with squad space can afford');
    const final = (await readRoom(page, code)).body.room;
    expect(final.completion_reason).toBe('NO_AFFORDABLE_PLAYERS');
    const total = final.teams.reduce((sum: number, team: { squad: { price: number }[] }) => sum + team.squad.reduce((spent, pick) => spent + pick.price, 0), 0);
    expect(total).toBe(400);
    await expect(page.getByLabel('Auction totals')).toContainText(money(total));
    await page.reload();
    await expect(page.getByLabel('Auction end reason')).toContainText('No participating team with squad space can afford');
    await page.screenshot({ path: `${process.env.AA_EVIDENCE_DIR ?? 'docs/reports/evidence/WP1-E2E'}/${testInfo.project.name}-affordability.png`, fullPage: true });
  } finally { await guestContext.close(); }
});
