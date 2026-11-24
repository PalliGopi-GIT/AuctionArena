import { test, expect } from '@playwright/test';
import { create, join } from './helpers';

/**
 * Mobile live card: the photograph must stay the primary visual element while the
 * statistics panel stays compact. Desktop is measured only to prove it unchanged.
 */
const WIDTHS = [320, 360, 390, 430];

for (const width of WIDTHS) {
  test(`mobile ${width}px live card keeps a large photo and compact stats`, async ({ page, browser }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    const { code, invite } = await create(page, { mode: 'quick' });
    await page.getByRole('button', { name: /Mumbai Indians/ }).click();
    const ctx = await browser.newContext({ baseURL: 'http://127.0.0.1:5273', viewport: { width, height: 844 }, isMobile: true, hasTouch: true });
    const guest = await ctx.newPage();
    try {
      await join(guest, code, invite);
      await guest.getByRole('button', { name: /Chennai Super Kings/ }).click();
      await page.getByRole('button', { name: 'Start auction', exact: true }).click();
      await expect(guest.locator('.room-status')).toContainText('LIVE');

      const art = page.locator('.live-player-layout .player-art');
      const stats = page.locator('.player-stats--live');
      await expect(art).toBeVisible();
      await expect(stats).toBeVisible();

      const artBox = (await art.boundingBox())!;
      const statsBox = (await stats.boundingBox())!;

      // Photograph is a real visual element, not a 64-82px thumbnail.
      expect(artBox.height, `${width}px photo height`).toBeGreaterThanOrEqual(160);
      expect(artBox.width, `${width}px photo width`).toBeGreaterThanOrEqual(100);

      // Statistics must not dominate: the photo is the larger element.
      expect(artBox.height, `${width}px photo vs stats height`).toBeGreaterThanOrEqual(statsBox.height);

      // Every available statistic is visible without a click.
      const labels = await stats.locator('dt').allInnerTexts();
      expect(labels.length, `${width}px stat count`).toBeGreaterThanOrEqual(6);
      await expect(stats.locator('summary')).toHaveCount(0);

      // Photograph keeps its aspect ratio (no stretching/cropping).
      const photo = art.locator('img.player-photo');
      if (await photo.count()) {
        expect(await photo.first().evaluate(i => getComputedStyle(i).objectFit)).toBe('contain');
      }

      // No horizontal overflow, and the bid button is reachable.
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await expect(page.getByRole('button', { name: /^Bid / })).toBeVisible();

      await page.locator('.current-player').screenshot({ path: `${process.env.AA_EVIDENCE_DIR}/card-${width}.png` });
      await page.screenshot({ path: `${process.env.AA_EVIDENCE_DIR}/mobile-${width}-live.png` });
    } finally { await ctx.close(); }
  });
}

test('desktop live card is unchanged', async ({ page, browser }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { code, invite } = await create(page, { mode: 'quick' });
  await page.getByRole('button', { name: /Mumbai Indians/ }).click();
  const ctx = await browser.newContext({ baseURL: 'http://127.0.0.1:5273', viewport: { width: 1440, height: 1000 } });
  const guest = await ctx.newPage();
  try {
    await join(guest, code, invite);
    await guest.getByRole('button', { name: /Chennai Super Kings/ }).click();
    await page.getByRole('button', { name: 'Start auction', exact: true }).click();
    await expect(guest.locator('.room-status')).toContainText('LIVE');
    const artBox = (await page.locator('.live-player-layout .player-art').boundingBox())!;
    // Desktop keeps its original clamp(150px,17vw,245px) sizing.
    expect(artBox.height).toBeGreaterThanOrEqual(240);
    expect(artBox.height).toBeLessThanOrEqual(246);
    await page.screenshot({ path: `${process.env.AA_EVIDENCE_DIR}/desktop-live.png` });
  } finally { await ctx.close(); }
});
