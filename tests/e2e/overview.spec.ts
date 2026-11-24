import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const evidence = process.env.AA_OVERVIEW_PHASE
  ? `docs/reports/evidence/WP-OVERVIEW-${process.env.AA_OVERVIEW_PHASE.toUpperCase()}`
  : null;

async function ready(page: Page) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
  await expect(page.getByRole('article', { name: 'Player catalog preview' }).locator('img.loaded')).toBeVisible();
  await expect(page.getByRole('heading', { name: /Build a squad/ })).toBeVisible();
  // Deterministic capture: no element may hold focus. The skip link is a
  // position:fixed element that moves to top:10px while focused, so a focused
  // link would be composited over the page in an element screenshot. Blurring
  // only resets transient focus state; the link keeps its keyboard behaviour.
  await settleFocus(page);
}

async function settleFocus(page: Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur?.());
  await expect.poll(
    () => page.evaluate(() => document.activeElement === document.body || document.activeElement === null),
    { message: 'no element should hold focus before a screenshot' },
  ).toBe(true);
}

/** Locator screenshots scroll their element into view; reset so page shots are deterministic. */
async function scrollToTop(page: Page) {
  await page.evaluate(() => window.scrollTo(0, 0));
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await settleFocus(page);
}

async function evidenceShot(page: Page, name: string, fullPage = true) {
  if (!evidence) return;
  mkdirSync(evidence, { recursive: true });
  await page.screenshot({ path: `${evidence}/${name}.png`, fullPage, animations: 'disabled' });
}

test('overview content stays visually unchanged', async ({ page }, testInfo) => {
  test.setTimeout(60_000);
  await ready(page);
  const home = page.locator('.auction-home');
  await expect(home).toHaveScreenshot(`overview-home-${testInfo.project.name}.png`, {
    animations: 'disabled',
    maxDiffPixels: 0,
    // The skip link is a fixed element that moves into view while focused, so it
    // can composite over an element capture of <main>. Masking it with the page
    // background keeps the capture deterministic without hiding it for users.
    mask: [page.locator('.skip-link')],
    maskColor: '#f3f1e8',
  });
  if (testInfo.project.name === 'desktop') {
    await scrollToTop(page);
    await expect(page).toHaveScreenshot('overview-page-desktop.png', { animations: 'disabled', maxDiffPixels: 0 });
    await evidenceShot(page, 'desktop-1440');
  } else {
    await scrollToTop(page);
    await expect(page.locator('.mobile-nav button')).toHaveCount(2);
    await expect(page.locator('.mobile-nav').getByRole('button', { name: 'My auctions' })).toBeVisible();
    await expect(page).toHaveScreenshot('overview-page-mobile.png', {
      animations: 'disabled',
      maxDiffPixels: 0,
      mask: [page.locator('.mobile-nav')],
    });
    await evidenceShot(page, 'mobile-390');
  }
});

test('overview tablet content stays visually unchanged', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop', 'The tablet viewport runs once in the desktop project.');
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 768, height: 1024 });
  await ready(page);
  await expect(page.locator('.auction-home')).toHaveScreenshot('overview-home-tablet.png', {
    animations: 'disabled',
    maxDiffPixels: 0,
  });
  await evidenceShot(page, 'tablet-768');
});

test('overview structure and typography remain stable', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Build a squad.');
  await expect(page.getByRole('heading', { name: 'Auction formats' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Auction Experience' })).toBeVisible();
  await expect(page.locator('.format-grid .format-card')).toHaveCount(3);
  await expect(page.locator('.home-guide li')).toHaveCount(3);
  const style = await page.locator('.auction-home').evaluate(node => {
    const home = getComputedStyle(node);
    const hero = getComputedStyle(node.querySelector('.cover-copy h1')!);
    const card = getComputedStyle(node.querySelector('.format-grid .format-card')!);
    return {
      background: home.backgroundColor,
      color: home.color,
      heroFont: hero.fontFamily,
      heroSize: hero.fontSize,
      cardBorderWidth: card.borderTopWidth,
      cardLeftBorderWidth: card.borderLeftWidth,
      cardBorderColor: card.borderTopColor,
      cardPadding: card.paddingTop,
    };
  });
  expect(style.background).toBe('rgb(243, 241, 232)');
  expect(style.color).toBe('rgb(19, 43, 35)');
  expect(style.heroFont).toContain('Barlow Condensed');
  expect(style.heroSize).not.toBe('16px');
  expect(style.cardBorderWidth !== '0px' || style.cardLeftBorderWidth !== '0px').toBe(true);
  expect(style.cardBorderColor).not.toBe('rgba(0, 0, 0, 0)');
  expect(style.cardPadding).not.toBe('0px');
});
