import { test, expect, type Page } from '@playwright/test';
import { create, join } from './helpers';

const widths = [320, 360, 375, 390, 430, 768, 1024, 1280, 1440, 1680];

async function fitsPage(page: Page, width: number) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth),
    { message: `Page overflows at ${width}px` }).toBeLessThanOrEqual(width);
}

test('catalog cover and live bid desk reflow without losing the primary action', async ({ page, browser }, info) => {
  test.setTimeout(100_000);
  await page.goto('/');
  const cover = page.getByRole('article', { name: 'Player catalog preview' });
  await expect(cover.locator('img.loaded')).toBeVisible();
  for (const width of widths) {
    await page.setViewportSize({ width, height: 844 });
    await fitsPage(page, width);
    await expect(page.getByRole('button', { name: 'Create an auction', exact: true })).toBeInViewport();
    if (width === 1440 || width === 390) await page.screenshot({ path: info.outputPath(`home-${width}.png`) });
  }
  const { code, invite } = await create(page, { timer: 120 });
  await page.getByRole('button', { name: /Mumbai Meteors/ }).click();
  const other = await browser.newContext({ baseURL: 'http://127.0.0.1:5273' });
  try {
    const guest = await other.newPage();
    await join(guest, code, invite);
    await expect(guest.getByRole('button', { name: /Mumbai Meteors/ })).toContainText('E2E Host');
    await guest.getByRole('button', { name: /Chennai/ }).click();
    await expect(page.getByRole('button', { name: /Chennai/ })).toContainText('E2E Guest');
    await page.getByRole('button', { name: 'Start auction', exact: true }).click();
    const bid = page.getByRole('button', { name: /^Bid / });
    await expect(bid).toBeEnabled();
    for (const width of widths) {
      await page.setViewportSize({ width, height: 844 });
      await page.evaluate(() => window.scrollTo(0, 0));
      await fitsPage(page, width);
      await expect(page.locator('.current-player h2')).toBeInViewport();
      await expect(page.locator('.countdown')).toBeInViewport();
      await expect(bid).toBeInViewport({ ratio: 1 });
      if (width === 1440 || width === 390) await page.screenshot({ path: info.outputPath(`live-${width}.png`) });
    }
    await page.setViewportSize({ width: 844, height: 390 });
    await fitsPage(page, 844);
    await bid.click();
    await expect(guest.locator('.leading')).toContainText('Mumbai Meteors');
  } finally { await other.close(); }
});
