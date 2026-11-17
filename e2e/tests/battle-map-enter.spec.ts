import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { signInAsGm, signInAsPlayer, gmToken, asGm, approvedPlayer } from './helpers';

// Into a battle map and out again, as the GM and as a player (2026-11-17). Entering one as the GM had broken the page:
// the admin panel's hooks came before its battle-map early return, and React refused the change in their number.
// Picked from QUICK_ACCESS rather than clicked on the 3D map, so the journey needs no screen positions.

/** A 1x1 PNG, enough of a map to enter. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

/** A named building with one battle map, made through the API. Its name. */
const buildingWithMap = async (request: APIRequestContext, gm: string, name: string) => {
  const made = await asGm(request, gm, 'post', '/api/locations', {
    name, description: 'A place to fight in.', shape: 'box', x: 4, y: 0, z: 4, width: 2, height: 2, depth: 2,
  });
  const id = made.data?.[0]?.id;
  expect(id, JSON.stringify(made)).toBeTruthy();
  const res = await request.post(`/api/locations/${id}/battle_maps`, {
    headers: { Authorization: `Bearer ${gm}` },
    multipart: { designation: 'GROUND', image: { name: 'map.png', mimeType: 'image/png', buffer: PNG } },
  });
  expect(res.ok(), await res.text()).toBe(true);
  return name;
};

/** Every error the page throws, for the journey to say none came. */
const errorsOf = (page: Page) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
};

const pick = async (page: Page, name: string) => {
  await page.getByRole('button', { name: 'QUICK_ACCESS', exact: true }).click();
  const list = page.locator('.quick-access-panel');
  await list.getByText(/DEFINED_STRUCTURES/).click();
  await list.getByText(name, { exact: true }).click();
};

test('the GM enters a battle map from the admin panel and leaves it, the page whole throughout', async ({ page, request }, info) => {
  test.setTimeout(120_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const gm = await gmToken(request);
  const name = await buildingWithMap(request, gm, `GM Arena${again}`);
  const errors = errorsOf(page);

  await signInAsGm(page);
  await pick(page, name);
  await page.getByRole('button', { name: 'ENTER_BATTLE_MAP (1)' }).click();
  await expect(page.getByRole('button', { name: 'EXIT', exact: true })).toBeVisible({ timeout: 15_000 });
  // The admin panel, now the battle map's, drawn whole.
  await expect(page.getByText('BATTLE ADMIN', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'ADD_ENEMY', exact: true })).toBeVisible();
  // And out again: the city's panel back, the battle map's gone.
  await page.getByRole('button', { name: 'EXIT', exact: true }).click();
  await expect(page.getByText('BATTLE ADMIN', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '+ CITY_GEN', exact: true })).toBeVisible({ timeout: 15_000 });
  expect(errors).toEqual([]);
});

test('a player enters a battle map from the building\'s window and leaves it, the page whole throughout', async ({ browser, request }, info) => {
  test.setTimeout(120_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const gm = await gmToken(request);
  const name = await buildingWithMap(request, gm, `Player Arena${again}`);
  const player = { username: `e2e_arena${again}`, password: 'e2e-player-password' };
  await approvedPlayer(request, gm, player);

  const context = await browser.newContext({ baseURL: info.project.use.baseURL });
  const mine = await context.newPage();
  const errors = errorsOf(mine);
  await signInAsPlayer(mine, player);
  await pick(mine, name);
  await mine.getByRole('button', { name: 'ENTER BATTLE MAP', exact: true }).click();
  await expect(mine.getByRole('button', { name: 'EXIT', exact: true })).toBeVisible({ timeout: 15_000 });
  await mine.getByRole('button', { name: 'EXIT', exact: true }).click();
  await expect(mine.getByRole('button', { name: 'EXIT', exact: true })).toHaveCount(0);
  await expect(mine.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true })).toBeVisible();
  expect(errors).toEqual([]);
  await context.close();
});
