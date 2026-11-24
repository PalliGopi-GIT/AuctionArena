import { expect, type Page } from '@playwright/test';

export async function login(page: Page, name: string) {
  await page.getByLabel('Display name').fill(name);
  await page.getByRole('button', { name: 'Continue locally' }).click();
}

/**
 * Create a room through the mode-based form. Purse, squad size, nationality
 * limits, pool and timer are fixed by the mode, so only team count and lobby
 * options are adjustable there.
 *
 * Tests that need an exact purse/squad/timer (bid mechanics, affordability,
 * heartbeat deadlines) ask for a legacy room instead: the API still accepts a
 * custom no-mode settings object, which is what those assertions target.
 */
export async function create(page: Page, options: {
  mode?: 'quick' | 'standard' | 'mega'; teams?: number; timer?: number;
  spectators?: boolean; budget?: number; maxSquad?: number; overseas?: number;
} = {}) {
  const legacy = options.budget !== undefined || options.maxSquad !== undefined || options.overseas !== undefined;
  await page.goto('/');
  await page.getByRole('button', { name: 'Create an auction', exact: true }).click();
  await login(page, 'E2E Host');
  await expect(page.getByLabel('Room name', { exact: true })).toBeFocused();

  if (legacy) {
    const settings = {
      name: 'Browser auction', teamCount: options.teams ?? 2, budget: options.budget ?? 2000,
      minSquad: 1, maxSquad: options.maxSquad ?? 2, maxOverseas: options.overseas ?? 2,
      timerSeconds: options.timer ?? 10, lateExtension: false, autoAdvance: false,
      resultSeconds: 5, spectators: options.spectators ?? true, bidIncrement: 10,
    };
    const created = await page.evaluate(async settings => {
      const response = await fetch('/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + localStorage.getItem('aa-token') }, body: JSON.stringify(settings) });
      return { status: response.status, body: await response.json() };
    }, settings);
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const code = created.body.room.code as string;
    const invite = created.body.inviteToken as string;
    await page.evaluate(([c, t]) => sessionStorage.setItem('invite-' + c, t as string), [code, invite]);
    await page.goto(`/?room=${code}`);
    await expect(page.getByRole('heading', { name: 'Browser auction' })).toBeVisible();
    return { code, invite };
  }

  await page.getByLabel('Room name', { exact: true }).fill('Browser auction');
  if (options.mode) {
    const label = options.mode[0].toUpperCase() + options.mode.slice(1);
    await page.locator('.mode-picker').getByRole('button', { name: new RegExp(label) }).click();
  }
  await page.getByLabel('Number of teams').fill(String(options.teams ?? 2));
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
  // The header and the Overview plan panel may both offer "Sign in"; use the header.
  await page.getByRole('banner').getByRole('button', { name: 'Sign in' }).click();
  await login(page, name);
  const heading = page.getByRole('heading', { name: 'Browser auction' });
  const joinButton = page.getByRole('button', { name: 'Join private auction' });
  await joinButton.or(heading).first().waitFor({ state: 'visible', timeout: 20_000 });
  if (await joinButton.isVisible().catch(() => false)) {
    // The join form takes one field: a room code or a full invitation link.
    const link = `${new URL(page.url()).origin}/?room=${code}&invite=${invite}`;
    await page.getByLabel('Room code or invitation link').fill(link);
    await joinButton.click();
  }
  if (admitted) await expect(heading).toBeVisible();
}

export async function readRoom(page: Page, code: string) {
  return page.evaluate(async code => {
    const response = await fetch('/api/rooms/' + code, { headers: { Authorization: 'Bearer ' + localStorage.getItem('aa-token') } });
    return { status: response.status, body: await response.json() };
  }, code);
}

export function money(lakhs: number) {
  return lakhs >= 100 ? `₹${(lakhs / 100).toFixed(2)} Cr` : `₹${lakhs} L`;
}

/** New rooms start a seeded catalog plan, so the first lot varies. */
export async function currentLot(page: Page, code: string) {
  const room = (await readRoom(page, code)).body.room;
  return { room, lot: room.players[room.currentPlayerIndex] as { id: string; name: string; basePrice: number } };
}
