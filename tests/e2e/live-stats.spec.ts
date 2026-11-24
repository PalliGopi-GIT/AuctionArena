import { test, expect } from '@playwright/test';
import { create, join, readRoom } from './helpers';

/**
 * Live lot statistics: visible without interaction, correct for each role, and
 * automatically replaced when the current player changes.
 */
test('live auction shows the current player statistics and updates per player', async ({ page, browser }, testInfo) => {
  const { code, invite } = await create(page, { mode: 'quick' });
  await page.getByRole('button', { name: /Mumbai Indians/ }).click();
  const other = await browser.newContext({ baseURL: 'http://127.0.0.1:5273', viewport: testInfo.project.use.viewport });
  const guest = await other.newPage();
  try {
    await join(guest, code, invite);
    await guest.getByRole('button', { name: /Chennai Super Kings/ }).click();
    await page.getByRole('button', { name: 'Start auction', exact: true }).click();
    await expect(guest.locator('.room-status')).toContainText('LIVE');

    const panel = page.locator('.player-stats--live');
    const seen: Array<{ name: string; role: string; labels: string[] }> = [];

    for (let lot = 0; lot < 4; lot++) {
      await expect(panel, `lot ${lot}`).toBeVisible();
      // No click required: the grid must already be rendered.
      const labels = await panel.locator('dt').allInnerTexts();
      expect(labels.length, `lot ${lot}`).toBeGreaterThan(0);

      const name = await page.locator('.live-player-layout h2').innerText();
      const role = await panel.locator('.player-stats-heading .tag').innerText();
      seen.push({ name, role, labels });

      // Statistics must belong to the player on screen (stable ID lookup).
      const room = (await readRoom(page, code)).body.room;
      const current = room.players[room.currentPlayerIndex];
      expect(current.name, `lot ${lot} identity`).toBe(name);

      // Photograph must remain present and unchanged in kind.
      const art = page.locator('.live-player-layout .player-art');
      await expect(art).toBeVisible();
      const img = art.locator('img.player-photo');
      if (await img.count()) {
        const src = await img.first().getAttribute('src');
        expect(src, `lot ${lot} photo`).toBe(current.image);
      }

      if (lot < 3) {
        await page.getByRole('button', { name: 'Next player' }).click().catch(() => {});
        // Host pauses a lot automatically after a bid-less countdown; advance via the
        // authoritative action instead so the loop stays deterministic.
        await page.waitForTimeout(400);
        const changed = await expect
          .poll(async () => (await page.locator('.live-player-layout h2').innerText()) !== name, { timeout: 20_000 })
          .toBe(true).then(() => true).catch(() => false);
        if (!changed) break;
      }
    }

    // Each role present must show its own stat set, and roles must differ.
    const roles = new Set(seen.map(s => s.role));
    expect(seen.length).toBeGreaterThan(1);
    expect(roles.size).toBeGreaterThan(1);
    for (const entry of seen) {
      const joined = entry.labels.join(' ').toLowerCase();
      // The heading is uppercased by CSS, so compare case-insensitively.
      if (/bowler/i.test(entry.role)) expect(joined).toMatch(/wickets|economy|bowling/i);
      else expect(joined).toMatch(/runs|batting avg|strike rate/i);
      // Never render an unavailable statistic as a literal null/undefined.
      const values = await panel.locator('dd').allInnerTexts();
      expect(values.every(v => v !== 'null' && v !== 'undefined' && v.length > 0)).toBe(true);
    }
    await page.screenshot({ path: `${process.env.AA_EVIDENCE_DIR}/${testInfo.project.name}-live-stats.png` });
  } finally { await other.close(); }
});
