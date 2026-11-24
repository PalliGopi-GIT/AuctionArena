import { test, expect, type Page } from '@playwright/test';
import { create, join, readRoom } from './helpers';

async function closeRoom(page: Page) {
  await page.getByRole('button', { name: 'Close room', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Close this room?' })).toBeFocused();
  await page.getByRole('dialog').getByRole('button', { name: 'Close room', exact: true }).click();
  await expect(page.getByText('CLOSED', { exact: true })).toBeVisible();
}

/** Whole-auction deletion now lives on My Auctions and requires typing DELETE. */
async function openMyAuctions(page: Page) {
  await page.getByRole('button', { name: 'My auctions', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Your auction nights.' })).toBeVisible();
}

test('host permanently deletes a closed room from My Auctions after typed confirmation', async ({ page }) => {
  const { code } = await create(page);
  await closeRoom(page);
  await openMyAuctions(page);

  const card = page.locator('.room-list-card').filter({ hasText: code });
  await expect(card).toHaveCount(1);
  await card.getByRole('button', { name: 'Delete auction' }).click();
  await expect(page.getByRole('heading', { name: 'Delete this auction?' })).toBeVisible();
  await expect(page.getByLabel('Type DELETE to confirm')).toBeFocused();
  await expect(page.getByRole('dialog')).toContainText('cannot be undone');

  const confirm = page.getByRole('button', { name: 'Delete auction permanently' });
  await expect(confirm).toBeDisabled();
  await page.getByLabel('Type DELETE to confirm').fill('DELETE');
  await expect(confirm).toBeEnabled();
  await confirm.click();

  await expect(page.getByText('Auction permanently deleted.', { exact: true })).toBeVisible();
  await expect(page.locator('.room-list-card').filter({ hasText: code })).toHaveCount(0);
  expect((await readRoom(page, code)).status).toBe(404);
});

test('host can keep a closed room from the confirmation dialog', async ({ page }) => {
  const { code } = await create(page);
  await closeRoom(page);
  await openMyAuctions(page);
  const card = page.locator('.room-list-card').filter({ hasText: code });
  await card.getByRole('button', { name: 'Delete auction' }).click();
  await expect(page.getByRole('heading', { name: 'Delete this auction?' })).toBeVisible();
  await expect(page.getByLabel('Type DELETE to confirm')).toBeFocused();
  await page.getByRole('button', { name: 'Keep auction', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.room-list-card').filter({ hasText: code })).toHaveCount(1);
  expect((await readRoom(page, code)).status).toBe(200);
});

test('does not offer deletion while the auction is active', async ({ page }) => {
  const { code } = await create(page);
  await openMyAuctions(page);
  const card = page.locator('.room-list-card').filter({ hasText: code });
  await expect(card).toHaveCount(1);
  await expect(card.getByRole('button', { name: 'Delete auction' })).toHaveCount(0);
});

test('does not offer deletion to a non-host member', async ({ page, browser }, testInfo) => {
  const { code, invite } = await create(page);
  const guestContext = await browser.newContext({
    baseURL: 'http://127.0.0.1:5273', viewport: testInfo.project.use.viewport,
    isMobile: !!testInfo.project.use.isMobile, hasTouch: !!testInfo.project.use.hasTouch,
  });
  try {
    const guest = await guestContext.newPage();
    await join(guest, code, invite);
    await closeRoom(page);
    await expect(guest.getByText('CLOSED', { exact: true })).toBeVisible();
    await guest.goto('/');
    await guest.getByRole('button', { name: 'My auctions', exact: true }).first().click();
    await expect(guest.getByRole('heading', { name: 'Your auction nights.' })).toBeVisible();
    const guestCard = guest.locator('.room-list-card').filter({ hasText: code });
    await expect(guestCard).toHaveCount(1);
    await expect(guestCard.getByRole('button', { name: 'Delete auction' })).toHaveCount(0);
  } finally { await guestContext.close(); }
});
