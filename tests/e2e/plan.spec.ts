import { test, expect, type Page } from '@playwright/test';
import { mkdirSync, readFileSync } from 'node:fs';
import { create, join, readRoom } from './helpers';
import type { Catalog, AssetManifest } from '../../packages/catalog/src/types';

const directory = process.env.AA_EVIDENCE_DIR ?? 'docs/reports/evidence/WP-H-PLAYER-POOLS';
mkdirSync(directory, { recursive: true });

type Preview = {
  ok: boolean;
  mode: string;
  planVersion: number;
  approved: boolean;
  counts: { total: number; byTier: Record<string, number>; marquee: number; overseas: number; domestic: number };
  sets: { name: string; count: number; players: { id: string; name: string; role: string; tier: string }[] }[];
};

async function planOf(page: Page, code: string) {
  return page.evaluate(async code => {
    const response = await fetch(`/api/rooms/${code}/plan`, { headers: { Authorization: 'Bearer ' + localStorage.getItem('aa-token') } });
    return { status: response.status, body: await response.json() };
  }, code);
}

const orderOf = (plan: Preview) => plan.sets.flatMap(set => set.players.map(player => player.id));
const catalogData = JSON.parse(readFileSync('packages/catalog/src/data/catalog.json', 'utf8')) as Catalog;
const assetData = JSON.parse(readFileSync('packages/catalog/src/data/assets.json', 'utf8')) as AssetManifest;

async function endInBrowser(page: Page) {
  await page.getByRole('button', { name: 'End auction', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'End auction', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Auction totals' }).getByText('Players signed')).toBeVisible();
}

test('all catalog photos decode and a failed photo falls back to the demo portrait', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  const { code } = await create(page, { mode: 'mega' });
  const roomUrl = `**/api/rooms/${code}`;
  let release: () => void = () => {};
  const responseGate = new Promise<void>(resolve => { release = resolve; });
  await page.route(roomUrl, async route => {
    await responseGate;
    await route.continue();
  });
  try {
    await page.reload({ waitUntil: 'commit' });
    await expect(page.getByRole('status').filter({ hasText: 'Opening auction...' })).toBeVisible();
  } finally { release(); }
  await expect(page.getByRole('heading', { name: 'Browser auction' })).toBeVisible();
  await page.unroute(roomUrl);
  await page.getByRole('button', { name: 'players', exact: true }).click();
  await page.getByRole('searchbox').fill('no-matching-player');
  await expect(page.getByRole('status').filter({ hasText: 'No players match these filters.' })).toBeVisible();
  // The Auction Plan now lives on Overview, which auto-selects the host's waiting room.
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Auction plan' })).toBeVisible();
  await expect(page.getByText('Review all 32 sets')).toBeVisible();
  const photos = catalogData.players.filter(player => player.imageStatus === 'bundled');
  expect(catalogData.players).toHaveLength(250);
  expect(photos).toHaveLength(224);
  expect(new Set(photos.map(player => player.image)).size).toBe(224);
  for (const player of catalogData.players) {
    const asset = assetData.players[player.id]!;
    expect(player.imageStatus).toBe(asset.status);
    expect(player.image).toBe(asset.path);
    if (asset.status === 'bundled') {
      expect(asset.path).toBe('/assets/players/' + player.id + '.webp');
      expect(asset.sourceFile).toContain('/' + player.id + '_');
    }
  }
  if (testInfo.project.name === 'desktop') {
    const failures = await page.evaluate(async paths => {
      const failures: string[] = [];
      for (let i = 0; i < paths.length; i += 16) {
        await Promise.all(paths.slice(i, i + 16).map(async path => {
          const image = new Image();
          image.src = path;
          try { await image.decode(); } catch { failures.push(path); }
        }));
      }
      return failures;
    }, photos.map(player => player.image!));
    expect(failures).toEqual([]);
  }
  const brokenId = photos[0]!.id;
  const valid = photos[1]!;
  // Use a fresh context so the aborted request cannot be served from the cache
  // warmed by the decode loop above, and install the abort before the plan renders.
  const brokenContext = await page.context().browser()!.newContext({
    baseURL: 'http://127.0.0.1:5273', viewport: testInfo.project.use.viewport,
    isMobile: !!testInfo.project.use.isMobile, hasTouch: !!testInfo.project.use.hasTouch,
  });
  try {
    const broken = await brokenContext.newPage();
    await broken.goto('/');
    await broken.evaluate(() => document.fonts.ready);
    await broken.getByLabel('Display name').count();
    // Reuse the host's local identity, then reopen the waiting room and its plan.
    const token = await page.evaluate(() => localStorage.getItem('aa-token'));
    const user = await page.evaluate(() => localStorage.getItem('aa-user'));
    await broken.evaluate(([t, u]) => { localStorage.setItem('aa-token', t!); localStorage.setItem('aa-user', u!); }, [token, user]);
    await broken.route(`**/assets/players/${brokenId}.webp`, route => route.abort());
    await broken.goto(`/?room=${code}`);
    await expect(broken.getByRole('heading', { name: 'Browser auction' })).toBeVisible();
    await broken.getByRole('button', { name: 'Overview', exact: true }).click();
    await expect(broken.getByText('Review all 32 sets')).toBeVisible();
    await broken.getByText('Review all 32 sets').click();
    const plan = broken.locator('.plan-sets');
    const validRow = plan.getByRole('listitem').filter({ hasText: valid.name }).first();
    await validRow.scrollIntoViewIfNeeded();
    await expect(validRow.locator('.player-photo.loaded')).toBeVisible();
    await expect(validRow.locator('.art-initials')).toBeHidden();
    const brokenRow = plan.getByRole('listitem').filter({ hasText: photos[0]!.name }).first();
    await brokenRow.scrollIntoViewIfNeeded();
    await expect(brokenRow.locator('img')).toHaveCount(0);
    await expect(brokenRow.locator('.art-initials')).toBeVisible();
  } finally { await brokenContext.close(); }
});

test('Quick opening set follows approved order and host-ended results survive refresh', async ({ page, browser }, testInfo) => {
  test.setTimeout(200_000);
  const { code, invite } = await create(page, { mode: 'standard' });
  // Claims happen in the room.
  await page.getByRole('button', { name: /Mumbai Meteors/ }).click();
  const guestContext = await browser.newContext({ baseURL: 'http://127.0.0.1:5273', viewport: testInfo.project.use.viewport, isMobile: !!testInfo.project.use.isMobile, hasTouch: !!testInfo.project.use.hasTouch });
  try {
    const guest = await guestContext.newPage();
    await join(guest, code, invite);
    await expect(guest.getByRole('button', { name: /Mumbai Meteors/ })).toContainText('E2E Host');
    await guest.getByRole('button', { name: /Chennai/ }).click();
    await expect(page.getByRole('button', { name: /Chennai/ })).toContainText('E2E Guest');
    // The plan is reviewed and approved on Overview.
    await page.getByRole('button', { name: 'Overview', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Auction plan' })).toBeVisible();
    await expect(page.locator('.plan-mode-fixed')).toContainText('Standard');
    await expect(page.getByText('Review all 15 sets')).toBeVisible();
    const before = (await planOf(page, code)).body.plan as Preview;
    await page.getByRole('button', { name: 'Regenerate' }).click();
    await expect.poll(async () => (await planOf(page, code)).body.plan.planVersion).toBeGreaterThan(before.planVersion);
    const plan = (await planOf(page, code)).body.plan as Preview;
    expect(plan.counts.total).toBe(120);
    await page.getByRole('button', { name: 'Approve & start auction' }).click();
    const opening = plan.sets[0]!.players;
    for (const [index, player] of opening.entries()) {
      await expect(page.locator('.current-player h2')).toHaveText(player.name);
      await expect(guest.locator('.current-player h2')).toHaveText(player.name);
      if (catalogData.players.find(entry => entry.id === player.id)?.imageStatus === 'bundled') {
        await expect(page.locator('.current-player .player-photo.loaded')).toBeVisible();
        await expect(page.locator('.current-player .player-head')).toBeHidden();
      }
      if (index === 0) await page.getByRole('button', { name: /^Bid / }).click();
      await expect(page.locator('.room-status')).toContainText('RESULT', { timeout: 20_000 });
      if (index < opening.length - 1) await page.getByRole('button', { name: 'Next player' }).click();
    }
    await endInBrowser(page);
    await expect(guest.locator('.room-status')).toContainText('COMPLETED');
    await page.reload();
    await expect(page.getByRole('note', { name: 'Auction end reason' })).toContainText('All accepted bids were settled');
    const results = (await readRoom(page, code)).body.room;
    expect(results.completion_reason).toBe('HOST_ENDED');
    expect(results.players.filter((p: { status: string }) => p.status === 'unsold')).toHaveLength(opening.length - 1);
    await page.getByText('Sold players', { exact: false }).first().click();
    await expect(page.locator('.results-pool').first()).toContainText(opening[0]!.name);
    await expect(page.locator('.results-pool').first().locator('.player-art')).toBeVisible();
    await page.getByText('Unsold players', { exact: false }).first().click();
    await expect(page.locator('.results-pool').nth(1)).toContainText(opening[1]!.name);
    await page.getByRole('button', { name: 'Open squads' }).click();
    await expect(page.locator('.squad-player')).toContainText(opening[0]!.name);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await guestContext.close(); }
});

test('host previews, regenerates and approves a seeded plan while participants stay order-blind', async ({ page, browser }, testInfo) => {
  test.setTimeout(240_000);
  const { code, invite } = await create(page, { mode: 'standard' });
  // Claim a team in the room first; the plan is reviewed on Overview.
  await page.getByRole('button', { name: /Mumbai Meteors/ }).click();
  const guestContext = await browser.newContext({ baseURL: 'http://127.0.0.1:5273', viewport: testInfo.project.use.viewport, isMobile: !!testInfo.project.use.isMobile, hasTouch: !!testInfo.project.use.hasTouch });
  const guest = await guestContext.newPage();
  const guestErrors: string[] = [];
  guest.on('pageerror', error => guestErrors.push(error.message));
  try {
    await join(guest, code, invite);
    await guest.getByRole('button', { name: /Chennai/ }).click();
    await page.getByRole('button', { name: 'Overview', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Auction plan' })).toBeVisible();
    // The mode is fixed at creation, so the plan shows it locked with the Standard pool.
    await expect(page.locator('.plan-mode-fixed')).toContainText('Standard');
    await expect(page.locator('.plan-panel .tag')).toHaveText('PREVIEW');
    await expect(page.locator('.plan-counts')).toContainText('120');
    await expect(page.getByText('Review all 15 sets')).toBeVisible();
    const standard = (await planOf(page, code)).body.plan as Preview;
    expect(standard.ok).toBe(true);
    expect(standard.mode).toBe('standard');
    expect(standard.counts).toMatchObject({ total: 120, marquee: 26, byTier: { A: 26, B: 35, C: 35, D: 16, E: 8 } });
    expect(standard.sets).toHaveLength(15);
    expect(standard.sets[0]!.name).toBe('Opening Marquee');
    expect(standard.sets[0]!.count).toBeGreaterThanOrEqual(6);
    expect(standard.sets[0]!.count).toBeLessThanOrEqual(8);
    // A participant sees the pool size but never the draft, seed or order.
    await expect(guest.locator('.rules')).toContainText('Selected by the host');
    const beforeApproval = (await readRoom(guest, code)).body.room;
    expect(beforeApproval.plan).toBeUndefined();
    expect(beforeApproval.planDraft).toBeUndefined();
    expect(beforeApproval.planPosition).toBeUndefined();
    expect(JSON.stringify(beforeApproval)).not.toContain('orderedPlayerIds');
    const deniedPreview = await planOf(guest, code);
    expect(deniedPreview.status).toBe(403);
    expect(deniedPreview.body.code).toBe('HOST_ONLY');

    // The mode is fixed at creation, so the plan panel shows it as locked.
    await expect(page.locator('.plan-mode-fixed')).toContainText('Standard');

    const beforeRegenerate = (await planOf(page, code)).body.plan as Preview;
    await page.getByRole('button', { name: 'Regenerate' }).click();
    let regenerated = beforeRegenerate;
    await expect.poll(async () => {
      regenerated = (await planOf(page, code)).body.plan as Preview;
      return regenerated.planVersion;
    }).toBeGreaterThan(beforeRegenerate.planVersion);
    expect(orderOf(regenerated)).not.toEqual(orderOf(beforeRegenerate));
    const approvedOrder = orderOf(regenerated);

    // The host-only CSV endpoint still exports the pending order. The UI no longer
    // shows a download button.
    const draftCsvResponse = await page.request.get(`/api/rooms/${code}/plan/export`, {
      headers: { Authorization: `Bearer ${await page.evaluate(() => localStorage.getItem('aa-token'))}` },
    });
    expect(draftCsvResponse.status()).toBe(200);
    const draftCsv = (await draftCsvResponse.text()).trim().split(/\r?\n/);
    expect(draftCsv).toHaveLength(121);
    expect(draftCsv[1]!.startsWith(`1,Opening Marquee,${approvedOrder[0]},`)).toBe(true);
    expect(draftCsv[120]!.startsWith('120,')).toBe(true);
    await expect(page.getByRole('button', { name: 'Download CSV' })).toHaveCount(0);
    await page.screenshot({ path: `${directory}/${testInfo.project.name}-plan-preview.png`, fullPage: true });

    // Image credits expose the licence gap, and team crests are generated.
    await page.getByRole('button', { name: 'My auctions', exact: true }).first().click();
    await page.getByRole('button', { name: /Browser auction/ }).first().click();
    await page.getByText('Image credits').click();
    await expect(page.locator('.image-credits')).toContainText('UNRECORDED');
    await expect(page.locator('.image-credits')).toContainText('owner');
    await expect(page.locator('.teams-grid .team-crest').first()).toBeVisible();
    await expect(page.locator('.teams-grid .team-crest').first()).not.toBeEmpty();
    await page.getByRole('button', { name: 'Overview', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Auction plan' })).toBeVisible();

    await page.getByRole('button', { name: 'Approve & start auction' }).click();
    await expect(page.locator('.room-status')).toContainText('LIVE');
    await expect(guest.locator('.room-status')).toContainText('LIVE');
    const approved = (await planOf(page, code)).body.plan as Preview;
    expect(approved.approved).toBe(true);
    expect(approved.planVersion).toBe(regenerated.planVersion);
    expect(orderOf(approved)).toEqual(approvedOrder);

    // The approved plan is stored, but the participant snapshot still carries no order.
    const participant = (await readRoom(guest, code)).body.room;
    expect(participant.plan).toBeUndefined();
    expect(participant.planPosition).toBeUndefined();
    expect(JSON.stringify(participant)).not.toContain('orderedPlayerIds');
    expect(participant.planSummary).toMatchObject({ mode: 'standard', total: 120, position: 1, setName: 'Opening Marquee' });
    const deniedExport = await guest.evaluate(async code => {
      const response = await fetch(`/api/rooms/${code}/plan/export`, { headers: { Authorization: 'Bearer ' + localStorage.getItem('aa-token') } });
      return { status: response.status, body: await response.json() };
    }, code);
    expect(deniedExport).toMatchObject({ status: 403, body: { code: 'HOST_ONLY' } });

    // Photos come from the bundled static copies; the one placeholder A player
    // uses the initials avatar instead.
    const live = (await readRoom(page, code)).body.room;
    expect(live.players.filter((player: { imageStatus: string }) => player.imageStatus === 'bundled').length).toBeGreaterThan(100);
    const lot = live.players[live.currentPlayerIndex] as { id: string; imageStatus: string };
    const art = page.locator('.current-player .player-art');
    if (lot.imageStatus === 'bundled') {
      await expect(art.locator('img')).toHaveAttribute('src', `/assets/players/${lot.id}.webp`);
      await expect(art.locator('img')).toHaveAttribute('loading', 'eager');
    } else await expect(art.locator('.art-initials')).toBeVisible();
    await page.screenshot({ path: `${directory}/${testInfo.project.name}-live-bidding.png`, fullPage: true });
    await guest.screenshot({ path: `${directory}/${testInfo.project.name}-participant-live.png`, fullPage: true });

    // Bid through the whole opening set, alternating real browser bids.
    const openingCount = regenerated.sets[0]!.count;
    for (let index = 0; index < openingCount; index++) {
      const state = (await readRoom(page, code)).body.room;
      expect(state.players[state.currentPlayerIndex].id).toBe(approvedOrder[index]);
      const bidder = index % 2 === 0 ? page : guest;
      const button = bidder.getByRole('button', { name: /^Bid / });
      await expect(button).toBeEnabled({ timeout: 20_000 });
      await button.click();
      await expect(page.locator('.room-status')).toContainText('RESULT', { timeout: 20_000 });
      const sold = (await readRoom(page, code)).body.room;
      expect(sold.players[sold.currentPlayerIndex].status).toBe('sold');
      await page.getByRole('button', { name: 'Next player' }).click();
      if (index < openingCount - 1) await expect(page.locator('.room-status')).toContainText('LIVE');
    }
    await expect(page.locator('.room-status')).toContainText('LIVE');
    const afterOpening = (await readRoom(page, code)).body.room;
    const openingIds = new Set(approvedOrder.slice(0, openingCount));
    expect(afterOpening.players.filter((player: { id: string; status: string }) => openingIds.has(player.id)).every((player: { status: string }) => player.status === 'sold')).toBe(true);
    expect(afterOpening.planSummary).toMatchObject({ total: 120, setIndex: 1 });
    expect(JSON.stringify((await readRoom(guest, code)).body.room)).not.toContain('orderedPlayerIds');

    // The plan CSV export is host-only and matches the approved order. The UI no
    // longer exposes a download button; the authenticated endpoint is still checked.
    const csvResponse = await page.request.get(`/api/rooms/${code}/plan/export`, {
      headers: { Authorization: `Bearer ${await page.evaluate(() => localStorage.getItem('aa-token'))}` },
    });
    expect(csvResponse.status()).toBe(200);
    const csv = (await csvResponse.text()).trim().split(/\r?\n/);
    expect(csv[0]).toBe('position,set name,player ID,name,role,tier,marquee flag,base price,image reference');
    expect(csv).toHaveLength(121);
    expect(csv[1]!.startsWith(`1,Opening Marquee,${approvedOrder[0]},`)).toBe(true);
    expect(csv[120]!.startsWith('120,')).toBe(true);
    await expect(page.getByRole('button', { name: 'Export order' })).toHaveCount(0);

    // A full reload re-reads the approved plan and resumes the same lot.
    const beforeReload = (await readRoom(page, code)).body.room;
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Browser auction' })).toBeVisible();
    await expect(page.locator('.room-status')).toContainText(/LIVE|RESULT/);
    const reloaded = (await planOf(page, code)).body.plan as Preview;
    expect(reloaded.approved).toBe(true);
    expect(reloaded.planVersion).toBe(regenerated.planVersion);
    expect(orderOf(reloaded)).toEqual(approvedOrder);
    const afterReload = (await readRoom(page, code)).body.room;
    expect(afterReload.currentPlayerIndex).toBe(beforeReload.currentPlayerIndex);
    await endInBrowser(page);
    await expect(guest.locator('.room-status')).toContainText('COMPLETED');
    await expect(page.getByRole('note', { name: 'Auction end reason' })).toContainText('All accepted bids were settled');
    expect(guestErrors).toEqual([]);
  } finally { await guestContext.close(); }
});

test('Mega mode previews all 250 players and runs its opening set in approved order', async ({ page, browser }, testInfo) => {
  test.setTimeout(240_000);
  const { code, invite } = await create(page, { mode: 'mega' });
  await page.getByRole('button', { name: /Mumbai Meteors/ }).click();
  const guestContext = await browser.newContext({ baseURL: 'http://127.0.0.1:5273', viewport: testInfo.project.use.viewport, isMobile: !!testInfo.project.use.isMobile, hasTouch: !!testInfo.project.use.hasTouch });
  const guest = await guestContext.newPage();
  const guestErrors: string[] = [];
  guest.on('pageerror', error => guestErrors.push(error.message));
  try {
    await join(guest, code, invite);
    await expect(guest.getByRole('button', { name: /Mumbai Meteors/ })).toContainText('E2E Host');
    await guest.getByRole('button', { name: /Chennai/ }).click();
    await expect(page.getByRole('button', { name: /Chennai/ })).toContainText('E2E Guest');
    await page.getByRole('button', { name: 'Overview', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Auction plan' })).toBeVisible();
    await expect(page.locator('.plan-mode-fixed')).toContainText('Mega');
    await expect(page.locator('.plan-counts')).toContainText('250');
    await expect(page.getByText('Review all 32 sets')).toBeVisible();
    const mega = (await planOf(page, code)).body.plan as Preview;
    expect(mega.mode).toBe('mega');
    expect(mega.counts).toMatchObject({ total: 250, marquee: 26, byTier: { A: 26, B: 45, C: 62, D: 71, E: 46 } });
    expect(mega.sets).toHaveLength(32);
    const order = orderOf(mega);
    expect(new Set(order).size).toBe(250);
    await page.getByRole('button', { name: 'Approve & start auction' }).click();
    await expect(page.locator('.room-status')).toContainText('LIVE');
    await expect(guest.locator('.room-status')).toContainText('LIVE');
    const participant = (await readRoom(guest, code)).body.room;
    expect(participant.planSummary).toMatchObject({ mode: 'mega', total: 250, position: 1, setName: 'Opening Marquee' });
    expect(JSON.stringify(participant)).not.toContain('orderedPlayerIds');

    // The live lots follow the approved order exactly, and both browsers bid.
    const openingCount = mega.sets[0]!.count;
    for (let index = 0; index < openingCount; index++) {
      const state = (await readRoom(page, code)).body.room;
      expect(state.players[state.currentPlayerIndex].id).toBe(order[index]);
      const bidder = index % 2 === 0 ? page : guest;
      const button = bidder.getByRole('button', { name: /^Bid / });
      await expect(button).toBeEnabled({ timeout: 20_000 });
      await button.click();
      await expect(page.locator('.room-status')).toContainText('RESULT', { timeout: 20_000 });
      await page.getByRole('button', { name: 'Next player' }).click();
      if (index < openingCount - 1) await expect(page.locator('.room-status')).toContainText('LIVE');
    }
    await expect(page.locator('.room-status')).toContainText('LIVE');
    const afterOpening = (await readRoom(page, code)).body.room;
    expect(afterOpening.planSummary).toMatchObject({ mode: 'mega', total: 250, setIndex: 1 });
    const openingIds = new Set(order.slice(0, openingCount));
    expect(afterOpening.players.filter((player: { id: string; status: string }) => openingIds.has(player.id)).every((player: { status: string }) => player.status === 'sold')).toBe(true);
    await endInBrowser(page);
    await expect(guest.locator('.room-status')).toContainText('COMPLETED');
    await guest.reload();
    await expect(guest.getByRole('note', { name: 'Auction end reason' })).toContainText('All accepted bids were settled');
    expect(guestErrors).toEqual([]);
  } finally { await guestContext.close(); }
});
