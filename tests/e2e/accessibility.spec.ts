import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, login } from './helpers';

const directory = process.env.AA_EVIDENCE_DIR ?? 'docs/reports/evidence/WP1-ACCESSIBILITY';
mkdirSync(directory, { recursive: true });

test('accessibility scans cover auction screens and dialogs', async ({ page, browser }, testInfo) => {
  test.setTimeout(180000);
  const scans: object[] = [];
  let violations = 0;
  async function scan(name: string) {
    const result = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']).analyze();
    const compact = (items: typeof result.violations) => items.map(item => ({ id: item.id, impact: item.impact, help: item.help,
      targets: item.nodes.map(node => node.target), summaries: item.nodes.map(node => node.failureSummary) }));
    scans.push({ screen: name, passedRules: result.passes.length, violations: compact(result.violations), incomplete: compact(result.incomplete) });
    violations += result.violations.length;
    writeFileSync(`${directory}/${testInfo.project.name}-axe.json`, JSON.stringify({ axeVersion: result.testEngine.version, scans }, null, 2));
  }
  await page.goto('/');
  await scan('home');
  await page.getByRole('button', { name: 'Create an auction', exact: true }).click();
  await scan('local-sign-in');
  await login(page, 'Accessibility host');
  await page.getByLabel('Room name', { exact: true }).fill('Browser auction');
  await page.getByLabel('Number of teams').fill('2');
  await page.getByLabel('Automatically open the next player').uncheck();
  await page.getByLabel('Extend timer after a late bid').uncheck();
  await scan('create-settings');
  await page.getByRole('button', { name: 'Review settings' }).click();
  await scan('create-review');
  await page.getByRole('button', { name: 'Create private auction' }).click();
  await expect(page.getByRole('heading', { name: 'Browser auction' })).toBeVisible();
  const code = new URL(page.url()).searchParams.get('room')!;
  const invite = await page.evaluate(code => sessionStorage.getItem('invite-' + code), code);
  await scan('lobby');
  for (const tab of ['squads', 'players', 'members', 'history']) {
    await page.getByRole('button', { name: tab, exact: true }).click(); await scan(tab);
  }
  await page.getByRole('button', { name: 'members', exact: true }).click();
  await page.getByRole('button', { name: 'Edit room rules', exact: true }).click();
  await scan('edit-rules'); await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Lobby', exact: true }).click();
  await page.getByRole('button', { name: /Mumbai Indians/ }).click();
  const guestContext = await browser.newContext({ baseURL: 'http://127.0.0.1:5273', viewport: testInfo.project.use.viewport, isMobile: !!testInfo.project.use.isMobile, hasTouch: !!testInfo.project.use.hasTouch });
  const guest = await guestContext.newPage();
  try {
    await join(guest, code, invite!);
    await guest.getByRole('button', { name: /Chennai Super Kings/ }).click();
    await page.getByRole('button', { name: 'Start auction', exact: true }).click();
    await guest.getByRole('button', { name: /^Bid / }).click();
    await expect(page.getByRole('status', { name: 'Auction updates' })).toContainText('Leading: Chennai');
    await scan('live-leading-bid');
    await page.getByRole('button', { name: 'Pause', exact: true }).click();
    await expect(page.locator('[data-auction-alerts]')).toContainText('Auction paused');
    await scan('paused');
    await page.getByRole('button', { name: 'Resume', exact: true }).click();
    await page.getByRole('button', { name: 'End auction', exact: true }).click();
    await scan('end-confirmation');
    await page.getByRole('dialog').getByRole('button', { name: 'End auction', exact: true }).click();
    await expect(page.getByLabel('Auction totals')).toBeVisible(); await scan('results');
    await page.screenshot({ path: `${directory}/${testInfo.project.name}-results.png`, fullPage: true });
    await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async () => { throw new Error('Test clipboard denial'); } } }));
    await page.getByRole('button', { name: 'Copy results link' }).click(); await scan('manual-results-copy');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: 'My auctions', exact: true }).click(); await scan('my-auctions');
  } finally { await guestContext.close(); }
  expect(violations, `See ${directory}/${testInfo.project.name}-axe.json`).toBe(0);
});

test('keyboard navigation, modal isolation, target sizes and narrow reflow work', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.locator('.header .brand')).toHaveAccessibleName(/^Auction\s*Arena$/);
  await expect(page.locator('footer .brand')).toHaveAccessibleName(/^Auction\s*Arena$/);
  await expect(page.getByRole('link', { name: 'Skip to main content' })).not.toBeInViewport();
  const homeAudit = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa', 'best-practice']).analyze();
  expect(homeAudit.violations.map(rule => rule.id)).toEqual([]);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main-content')).toBeFocused();
  await expect(page.getByRole('link', { name: 'Skip to main content' })).not.toBeInViewport();
  await page.getByRole('button', { name: 'Create an auction', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Display name')).toBeFocused();
  expect(await page.locator('.app-surface').evaluate((element: HTMLElement) => element.inert)).toBe(true);
  await page.locator('.header .brand').evaluate((element: HTMLElement) => element.focus());
  await expect(page.getByLabel('Display name')).toBeFocused();
  await login(page, 'Keyboard host');
  await expect(page.getByLabel('Room name', { exact: true })).toBeFocused();
  await page.setViewportSize({ width: 320, height: 844 });
  await page.getByLabel('Room name', { exact: true }).fill('A'.repeat(60));
  const targets = await page.getByRole('dialog').evaluate(dialog => [...dialog.querySelectorAll<HTMLElement>('button,input,select')].map(element => {
    const target = element.matches('input[type="checkbox"]') ? element.closest('label')! : element;
    const box = target.getBoundingClientRect(); return { kind: element.tagName, width: Math.round(box.width), height: Math.round(box.height) };
  }));
  expect(targets.filter(target => target.width < 44 || target.height < 44)).toEqual([]);
  expect(await page.getByRole('dialog').evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await page.getByRole('button', { name: 'Review settings' }).click();
  await expect(page.getByRole('heading', { name: 'Your arena, at a glance.' })).toBeFocused();
  await page.getByRole('button', { name: 'Create private auction' }).click();
  await expect(page.getByRole('heading', { name: 'A'.repeat(60) })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
  await page.getByRole('button', { name: 'players', exact: true }).click();
  await expect(page.getByRole('button', { name: 'players', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('searchbox', { name: 'Search player or country' })).toBeVisible();
  await page.getByLabel('Search player or country').fill('Arjun');
  await expect(page.locator('.player-tile')).toHaveCount(1);
  await expect(page.getByRole('link', { name: 'Skip to main content' })).not.toBeInViewport();
  await page.screenshot({ path: `${directory}/${testInfo.project.name}-narrow-player-pool.png`, fullPage: true });
  await expect(page.getByRole('status', { name: 'Auction updates' })).toContainText('Lobby.');
  await page.getByRole('button', { name: 'My auctions', exact: true }).click();
  await expect(page.getByRole('status', { name: 'Auction updates' })).toBeEmpty();
  await page.getByRole('button', { name: 'Sign out of local profile' }).click();
  await expect(page.getByRole('status', { name: 'Auction updates' })).toBeEmpty();
});
