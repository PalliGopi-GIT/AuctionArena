import { expect, type Page } from '@playwright/test';

export async function login(page: Page, name: string) {
  await page.getByLabel('Display name').fill(name);
  await page.getByRole('button', { name: 'Continue locally' }).click();
}

export async function create(page: Page, options: { budget?: number; maxSquad?: number; timer?: number; spectators?: boolean } = {}) {
  await page.goto('/');
  await page.getByRole('button', { name: 'Create an auction', exact: true }).click();
  await login(page, 'E2E Host');
  await expect(page.getByLabel('Room name', { exact: true })).toBeFocused();
  await page.getByLabel('Room name', { exact: true }).fill('Browser auction');
  await page.getByLabel('Number of teams').fill('2');
  await page.getByLabel('Budget (lakhs)').fill(String(options.budget ?? 2000));
  await page.getByLabel('Minimum squad').fill('1');
  await page.getByLabel('Maximum squad').fill(String(options.maxSquad ?? 2));
  await page.getByLabel('Overseas limit').fill('2');
  await page.getByLabel('Bid timer (seconds)').fill(String(options.timer ?? 10));
  await page.getByLabel('Allow invited spectators after start').setChecked(options.spectators ?? true);
  await page.getByLabel('Extend timer after a late bid').uncheck();
  await page.getByLabel('Automatically open the next player').uncheck();
  await page.getByRole('button', { name: 'Review settings' }).click();
  await expect(page.getByRole('heading', { name: 'Your arena, at a glance.' })).toBeFocused();
  await page.getByRole('button', { name: 'Create private auction' }).click();
  await expect(page.getByRole('heading', { name: 'Browser auction' })).toBeVisible();
  const code = new URL(page.url()).searchParams.get('room')!;
  const invite = await page.evaluate(code => sessionStorage.getItem('invite-' + code), code);
  expect(invite).toBeTruthy();
  return { code, invite: invite! };
}

export async function join(page: Page, code: string, invite: string, name = 'E2E Guest', admitted = true) {
  await page.goto(`/?room=${code}&invite=${invite}`);
  await page.getByRole('button', { name: 'Sign in', exact: false }).click();
  await login(page, name);
  await page.getByRole('button', { name: 'Join private auction' }).click();
  if (admitted) await expect(page.getByRole('heading', { name: 'Browser auction' })).toBeVisible();
}

export async function readRoom(page: Page, code: string) {
  return page.evaluate(async code => {
    const response = await fetch('/api/rooms/' + code, { headers: { Authorization: 'Bearer ' + localStorage.getItem('aa-token') } });
    return { status: response.status, body: await response.json() };
  }, code);
}

