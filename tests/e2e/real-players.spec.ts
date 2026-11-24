import { test, expect } from '@playwright/test';
import { create, readRoom } from './helpers';

/** Test A + D: real players immediately, and enlarged recognisable logos. */
test('a new room shows real players before any plan approval', async ({ page }, testInfo) => {
  for (const mode of ['quick', 'standard', 'mega'] as const) {
    // create() signs in through the login modal, so clear the prior session.
    await page.goto('/');
    await page.evaluate(() => { localStorage.clear(); sessionStorage.clear(); });
    const { code } = await create(page, { mode });
    // Backend truth, not just the UI.
    const room = (await readRoom(page, code)).body.room;
    const expected = mode === 'quick' ? 80 : mode === 'standard' ? 120 : 250;
    expect(room.players, mode).toHaveLength(expected);
    expect(room.players.filter((p: { isSample?: boolean }) => p.isSample), mode).toHaveLength(0);
    expect(room.players.every((p: { id: string }) => /^P\d{3}$/.test(p.id)), mode).toBe(true);
    // planDraft is deliberately stripped from participant snapshots (anti-leak),
    // so the pool itself is the contract. The host preview must be usable.
    const preview = await page.evaluate(async c => {
      const r = await fetch('/api/rooms/' + c + '/plan', { headers: { Authorization: 'Bearer ' + localStorage.getItem('aa-token') } });
      return { status: r.status, body: await r.json() };
    }, code);
    expect(preview.status, mode).toBe(200);
    expect(preview.body.plan.mode, mode).toBe(mode);
    // No fictional names in the authoritative pool.
    const fictional = ['Arjun Rathore', 'Kabir Mehta', 'Liam Fletcher', 'Dev Malhotra'];
    for (const name of fictional) expect(room.players.some((p: { name: string }) => p.name === name)).toBe(false);

    // Rendered pool. The tab label is the raw section name while waiting.
    await page.getByRole('button', { name: /^players$/i }).click();
    await page.waitForTimeout(900);
    const tiles = await page.locator('.player-tile h3').allInnerTexts();
    expect(tiles.length).toBeGreaterThan(0);
    for (const name of fictional) expect(tiles).not.toContain(name);
    expect(tiles).toContain('KL Rahul');
  }
});

test('franchise logos are prominent and not distorted', async ({ page }, testInfo) => {
  await create(page, { mode: 'standard' });
  const crest = page.locator('.teams-grid .team-crest').first();
  const box = await crest.boundingBox();
  const min = testInfo.project.name === 'mobile' ? 48 : 72;
  expect(box!.width).toBeGreaterThanOrEqual(min);
  expect(box!.height).toBeGreaterThanOrEqual(min);
  const img = crest.locator('img');
  const fit = await img.evaluate(i => getComputedStyle(i).objectFit);
  expect(fit).toBe('contain');
  const nameSize = await page.locator('.teams-grid .team-choice h3').first().evaluate(n => parseFloat(getComputedStyle(n).fontSize));
  expect(nameSize).toBeLessThanOrEqual(16);
  // No horizontal overflow introduced.
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: `${process.env.AA_EVIDENCE_DIR}/${testInfo.project.name}-franchise-logos.png`, fullPage: false });
});
