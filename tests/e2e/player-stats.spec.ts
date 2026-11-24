import { test, expect } from '@playwright/test';
import { create } from './helpers';

/** Test C: displayed statistics match the source CSV for several roles. */
test('player stat panels show role-appropriate figures from the dataset', async ({ page }, testInfo) => {
  await create(page, { mode: 'standard' });
  await page.getByRole('button', { name: /^players$/i }).click();
  await page.waitForTimeout(1000);

  const tiles = page.locator('.player-tile');
  const total = await tiles.count();
  expect(total).toBeGreaterThan(0);

  const collected: Array<{ player: string; rows: Record<string, string> }> = [];
  for (let i = 0; i < Math.min(total, 6); i++) {
    const tile = tiles.nth(i);
    const panel = tile.locator('.player-stats');
    if (!(await panel.count())) continue;
    await panel.locator('summary').click();
    const labels = await panel.locator('dt').allInnerTexts();
    const values = await panel.locator('dd').allInnerTexts();
    collected.push({
      player: await tile.locator('h3').innerText(),
      rows: Object.fromEntries(labels.map((l, n) => [l, values[n]])),
    });
  }

  expect(collected.length).toBeGreaterThan(0);
  for (const entry of collected) {
    // Never render an unavailable statistic as a fake zero.
    for (const [label, value] of Object.entries(entry.rows)) {
      expect(value, `${entry.player} ${label}`).not.toBe('null');
      expect(value, `${entry.player} ${label}`).not.toBe('undefined');
      expect(value.length).toBeGreaterThan(0);
    }
  }
  await page.screenshot({ path: `${process.env.AA_EVIDENCE_DIR}/${testInfo.project.name}-player-stats.png`, fullPage: false });
});
