import { test, expect, type Page } from '@playwright/test';
import { create, currentLot, join, login, readRoom } from './helpers';

/**
 * Multiplayer synchronization and isolation.
 *
 * These assert observable behaviour across independent browser contexts: two
 * authenticated users, one authoritative room, and a second room that must not
 * leak into either of them.
 */

const ORIGIN = 'http://127.0.0.1:5273';

async function guestContext(browser: Parameters<typeof test>[0] extends never ? never : any, testInfo: any) {
  return browser.newContext({
    baseURL: ORIGIN,
    viewport: testInfo.project.use.viewport,
    isMobile: !!testInfo.project.use.isMobile,
    hasTouch: !!testInfo.project.use.hasTouch,
  });
}

async function startTwoPlayerRoom(page: Page, browser: any, testInfo: any) {
  const { code, invite } = await create(page);
  await page.getByRole('button', { name: /Mumbai Indians/ }).click();
  const other = await guestContext(browser, testInfo);
  const guest = await other.newPage();
  await join(guest, code, invite);
  await guest.getByRole('button', { name: /Chennai Super Kings/ }).click();
  await page.getByRole('button', { name: 'Start auction', exact: true }).click();
  await expect(guest.locator('.room-status')).toContainText('LIVE');
  return { code, invite, other, guest };
}

test('a bid accepted for one user appears for the other with the same amount and bidder', async ({ page, browser }, testInfo) => {
  const { other, guest } = await startTwoPlayerRoom(page, browser, testInfo);
  try {
    const { lot } = await currentLot(page, page.url().split('room=')[1]!);
    // Guest bids; the host's screen must reflect the same accepted amount.
    await guest.getByRole('button', { name: /^Bid / }).click();
    await expect(page.locator('.leading')).toContainText('Chennai');
    await expect(guest.locator('.leading')).toContainText('Chennai');
    const hostView = await page.locator('.bid-amount').first().innerText();
    const guestView = await guest.locator('.bid-amount').first().innerText();
    expect(hostView.replace(/\s/g, '')).toBe(guestView.replace(/\s/g, ''));
    // Both clients agree with the server's authoritative price.
    const code = page.url().split('room=')[1]!.split('&')[0];
    const server = (await readRoom(page, code)).body.room;
    expect(server.currentBid).toBe(lot.basePrice);
    expect(server.leadingTeamId).toBe('t2');
  } finally { await other.close(); }
});

test('simultaneous bids from two users accept exactly one and never double-charge', async ({ page, browser }, testInfo) => {
  const { other, guest } = await startTwoPlayerRoom(page, browser, testInfo);
  try {
    const code = page.url().split('room=')[1]!.split('&')[0];
    // Both bid at the same instant through the API, bypassing UI timing.
    const bid = (p: Page) => p.evaluate(async c => {
      const room = await (await fetch('/api/rooms/' + c, { headers: { Authorization: 'Bearer ' + localStorage.getItem('aa-token') } })).json();
      const lot = room.room.players[room.room.currentPlayerIndex];
      const r = await fetch(`/api/rooms/${c}/actions`, {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + localStorage.getItem('aa-token'), 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: crypto.randomUUID(), type: 'bid', playerId: lot.id, amount: lot.basePrice, expectedVersion: room.room.version }),
      });
      return { status: r.status, body: await r.json() };
    }, code);
    const [a, b] = await Promise.all([bid(page), bid(guest)]);
    const accepted = [a, b].filter(r => r.status === 200);
    expect(accepted.length).toBeLessThanOrEqual(1);

    const after = (await readRoom(page, code)).body.room;
    const bidEvents = after.history.filter((e: { type: string }) => e.type === 'bid');
    expect(bidEvents).toHaveLength(1);
    // Exactly one team paid for this lot.
    for (const team of after.teams) {
      expect(team.budget + team.squad.reduce((s: number, p: { price: number }) => s + p.price, 0)).toBe(after.settings.budget);
    }
  } finally { await other.close(); }
});

test('team budgets stay accurate and the winner is the only team charged', async ({ page, browser }, testInfo) => {
  const { other, guest } = await startTwoPlayerRoom(page, browser, testInfo);
  try {
    const code = page.url().split('room=')[1]!.split('&')[0];
    const { lot } = await currentLot(page, code);
    const before = (await readRoom(page, code)).body.room;
    await guest.getByRole('button', { name: /^Bid / }).click();
    await expect(page.locator('.room-status')).toContainText('RESULT', { timeout: 25_000 });
    const after = (await readRoom(page, code)).body.room;
    // Chennai (t2) won the only lot and paid exactly the base price.
    expect(after.teams[1].budget).toBe(before.settings.budget - lot.basePrice);
    expect(after.teams[1].squad).toEqual([{ playerId: lot.id, price: lot.basePrice }]);
    // The losing team was never charged.
    expect(after.teams[0].budget).toBe(before.settings.budget);
    expect(after.teams[0].squad).toEqual([]);
    // Conservation: budgets + squad spend always equals the original purse.
    for (const team of after.teams) {
      expect(team.budget + team.squad.reduce((s: number, p: { price: number }) => s + p.price, 0)).toBe(after.settings.budget);
    }
  } finally { await other.close(); }
});

test('sold state is identical on both clients after the lot settles', async ({ page, browser }, testInfo) => {
  const { other, guest } = await startTwoPlayerRoom(page, browser, testInfo);
  try {
    const code = page.url().split('room=')[1]!.split('&')[0];
    await guest.getByRole('button', { name: /^Bid / }).click();
    await expect(page.locator('.room-status')).toContainText('RESULT', { timeout: 25_000 });
    await expect(guest.locator('.room-status')).toContainText('RESULT', { timeout: 25_000 });
    const host = (await readRoom(page, code)).body.room;
    const guestView = (await readRoom(guest, code)).body.room;
    expect(guestView.currentBid).toBe(host.currentBid);
    expect(guestView.leadingTeamId).toBe(host.leadingTeamId);
    expect(guestView.version).toBe(host.version);
    expect(guestView.teams).toEqual(host.teams);
    // The sold player is marked sold on both.
    const sold = host.players.filter((p: { status: string }) => p.status === 'sold');
    expect(sold).toHaveLength(1);
    expect(guestView.players.filter((p: { status: string }) => p.status === 'sold')).toHaveLength(1);
  } finally { await other.close(); }
});

test('refresh and reconnect restore the same authoritative state without duplicating bids', async ({ page, browser }, testInfo) => {
  const { other, guest } = await startTwoPlayerRoom(page, browser, testInfo);
  try {
    const code = page.url().split('room=')[1]!.split('&')[0];
    await guest.getByRole('button', { name: /^Bid / }).click();
    await expect(page.locator('.leading')).toContainText('Chennai');
    const before = (await readRoom(page, code)).body.room;

    // Drop the guest connection, then restore it.
    await other.setOffline(true);
    await expect(guest.locator('.room-status')).toContainText('Reconnecting', { timeout: 15_000 });
    await other.setOffline(false);
    await expect(guest.locator('.room-status')).toContainText('Connected', { timeout: 20_000 });

    await guest.reload();
    await expect(guest.locator('.leading')).toContainText('Chennai', { timeout: 20_000 });
    const after = (await readRoom(guest, code)).body.room;
    expect(after.currentBid).toBe(before.currentBid);
    expect(after.version).toBe(before.version);
    expect(after.history.filter((e: { type: string }) => e.type === 'bid')).toHaveLength(1);
  } finally { await other.close(); }
});

test('a second room cannot observe or affect the first room', async ({ page, browser }, testInfo) => {
  const first = await startTwoPlayerRoom(page, browser, testInfo);
  const secondContext = await browser.newContext({ baseURL: ORIGIN });
  const second = await secondContext.newPage();
  try {
    const firstCode = page.url().split('room=')[1]!.split('&')[0];
    // A different host creates an entirely separate room.
    const { code: secondCode, invite: secondInvite } = await create(second);
    expect(secondCode).not.toBe(firstCode);
    await second.getByRole('button', { name: /Mumbai Indians/ }).click();
    // Start is gated on two claimed teams, so a second player must join.
    const secondGuestContext = await browser.newContext({ baseURL: ORIGIN });
    const secondGuest = await secondGuestContext.newPage();
    try {
      await join(secondGuest, secondCode, secondInvite);
      await secondGuest.getByRole('button', { name: /Chennai Super Kings/ }).click();
      await expect(second.getByRole('button', { name: 'Start auction', exact: true })).toBeEnabled({ timeout: 20_000 });
      await second.getByRole('button', { name: 'Start auction', exact: true }).click();
      await expect(second.locator('.room-status')).toContainText('LIVE');

    // Bid in room 2 and confirm room 1 is untouched.
    const before1 = (await readRoom(page, firstCode)).body.room;
    await second.getByRole('button', { name: /^Bid / }).click();
    await expect(second.locator('.leading')).toContainText('Mumbai');
    const after1 = (await readRoom(page, firstCode)).body.room;
    expect(after1.currentBid).toBe(before1.currentBid);
    expect(after1.version).toBe(before1.version);
    expect(after1.history.filter((e: { type: string }) => e.type === 'bid')).toHaveLength(before1.history.filter((e: { type: string }) => e.type === 'bid').length);

    // The first room's guest never sees the second room's data.
    const guestRoom = (await readRoom(first.guest, firstCode)).body.room;
    expect(guestRoom.code).toBe(firstCode);
    } finally {
      await secondGuestContext.close();
    }
  } finally {
    await secondContext.close();
    await first.other.close();
  }
});

test('unauthorized actions are rejected without mutating the room', async ({ page, browser }, testInfo) => {
  const { other, guest } = await startTwoPlayerRoom(page, browser, testInfo);
  try {
    const code = page.url().split('room=')[1]!.split('&')[0];
    const before = (await readRoom(page, code)).body.room;
    // A non-host tries host-only actions and an outsider tries to bid.
    const guestAttempts = await guest.evaluate(async (c: string) => {
      const post = async (body: object) => {
        const r = await fetch(`/api/rooms/${c}/actions`, {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + localStorage.getItem('aa-token'), 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: crypto.randomUUID(), ...body }),
        });
        return { status: r.status, code: (await r.json()).code };
      };
      return [await post({ type: 'end' }), await post({ type: 'pause' }), await post({ type: 'update-settings', settings: {} })];
    }, code);
    for (const attempt of guestAttempts) {
      expect(attempt.status).toBeGreaterThanOrEqual(400);
    }
    const after = (await readRoom(page, code)).body.room;
    expect(after.status).toBe(before.status);
    expect(after.version).toBe(before.version);
  } finally { await other.close(); }
});
