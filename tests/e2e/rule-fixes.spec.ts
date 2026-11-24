import { test, expect } from '@playwright/test';
import { create, currentLot, join, readRoom } from './helpers';

test('new-room tiered bids agree between both browsers and the server', async ({ page, browser }, testInfo) => {
  let pongs = 0;
  page.on('websocket', socket => socket.on('framereceived', event => {
    try { if (JSON.parse(String(event.payload)).type === 'pong') pongs++; } catch { /* Other frames are irrelevant. */ }
  }));
  const { code, invite } = await create(page, { timer: 60 });
  await expect(page.locator('.rules')).toContainText('+10 / +20 / +25');
  await page.getByRole('button', { name: /Mumbai Meteors/ }).click();
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5273', viewport: testInfo.project.use.viewport, isMobile: !!testInfo.project.use.isMobile, hasTouch: !!testInfo.project.use.hasTouch });
  try {
    const guest = await context.newPage(); await join(guest, code, invite);
    await guest.getByRole('button', { name: /Chennai/ }).click();
    await page.getByRole('button', { name: 'Start auction', exact: true }).click();
    await expect(guest.locator('.room-status')).toContainText('LIVE');
    const { lot } = await currentLot(page, code);
    const amounts: number[] = [];
    for (let amount = lot.basePrice; amount < 320; amount += amount < 200 ? 10 : amount <= 500 ? 20 : 25) amounts.push(amount);
    for (const [index, amount] of amounts.entries()) {
      const bidder = index % 2 ? guest : page;
      const response = await bidder.evaluate(async ({ code, amount, playerId }) => {
        const result = await fetch(`/api/rooms/${code}/actions`, { method: 'POST', headers: { Authorization: 'Bearer ' + localStorage.getItem('aa-token'), 'Content-Type': 'application/json' }, body: JSON.stringify({ id: crypto.randomUUID(), type: 'bid', playerId, amount }) });
        const body = await result.json(); return { status: result.status, amount: body.room?.currentBid, code: body.code };
      }, { code, amount, playerId: lot.id });
      expect(response).toEqual({ status: 200, amount, code: undefined });
    }
    await expect(page.getByRole('button', { name: 'Bid ₹3.20 Cr', exact: true })).toBeEnabled();
    await page.getByRole('button', { name: 'Bid ₹3.20 Cr', exact: true }).click();
    await expect(guest.locator('.bid-amount')).toHaveText('₹3.20 Cr');
    expect((await readRoom(page, code)).body.room.bidRule).toBe('tiered-v1');
    await expect.poll(() => pongs).toBeGreaterThan(0);
    await page.getByRole('button', { name: 'End auction', exact: true }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'End auction', exact: true }).click();
    expect((await readRoom(page, code)).body.room.teams[0].squad).toEqual([{ playerId: lot.id, price: 320 }]);
  } finally { await context.close(); }
});

test('ACCOUNT_DELETED clears the room and stops retries when WebSockets are unavailable', async ({ page }) => {
  await page.routeWebSocket(/\/ws/, socket => socket.close({ code: 1011, reason: 'Test: socket unavailable' }));
  const { code } = await create(page);
  let requests = 0;
  await page.route('**/api/rooms/**', async route => {
    requests++;
    if ([`/api/rooms/${code}`, `/api/rooms/${code}/sync`].includes(new URL(route.request().url()).pathname)) {
      await route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ code: 'ACCOUNT_DELETED', message: 'This account no longer has access.' }) });
    } else await route.continue();
  });
  await expect(page.getByRole('alert')).toContainText('This account no longer has access.');
  await expect(page.locator('.arena')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: /Build a squad/ })).toBeVisible();
  expect(new URL(page.url()).search).toBe('');
  const stoppedAt = requests;
  await new Promise(resolve => setTimeout(resolve, 2500));
  expect(requests).toBe(stoppedAt);
});
