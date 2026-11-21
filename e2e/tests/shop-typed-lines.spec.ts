import { test, expect } from '@playwright/test';
import { signInAsGm, signInAsPlayer, gmToken, asGm, runningSystem, approvedPlayer, openGameSystem } from './helpers';
import { playerToken, sheetOf, payPlayer } from './shops';

// Lines of an item type at the table (8a7a2; mockup docs/mockups/item-types-in-shops.html, answered 2026-11-20). A game with a
// GUNS type, sold where unsaid at the General Store: the GM saves a [GUNS] catalogue and pays the player; the player buys a
// Pistol from the store's GUNS shelf, its own columns on it, and it lands on their gear as a Gun with its damage and ammo;
// the GM gives them another, and it stacks onto the first, as GIVE lands exactly as buying does.

const SYSTEM = (name: string) => ({
  format: 1, name, core: { health: { model: 'pool' } },
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }] }],
  items: {
    types: [{ id: 'guns', label: 'GUNS', one: 'Gun', columns: [
      { id: 'damage', label: 'DAMAGE', kind: 'damage' },
      { id: 'ammo', label: 'AMMO', kind: 'count', button: 'FIRE' },
    ] }],
    list: [],
  },
});

/** The player's gear as stored: each line's name, count, type and values. */
const gearOf = async (request: Parameters<typeof sheetOf>[0], gm: string, username: string) => {
  const inventory = (await sheetOf(request, gm, username)).inventory;
  return (JSON.parse(typeof inventory === 'string' ? inventory : '[]') as { name: string; qty: number; type?: string; values?: object }[])
    .map(({ name, qty, type, values }) => ({ name, qty, type, values }));
};

test('a Pistol of the GUNS type: bought from the General Store\'s GUNS shelf and given, a Gun on the gear with its columns (8a7a2)', async ({ page, browser, request }, info) => {
  test.setTimeout(180_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const gm = await gmToken(request);
  await runningSystem(request, gm, SYSTEM(`Gunline${again}`));
  const player = { username: `e2e_gunline${again}`, password: 'e2e-player-password' };
  await approvedPlayer(request, gm, player);
  await playerToken(request, gm, player.username);
  const shop = `GUNLINE_GOODS${again}`;
  const made = await asGm(request, gm, 'post', '/api/locations', { name: shop, description: '', shape: 'box', x: 8, y: 0, z: 8, width: 2, height: 2, depth: 2 });
  const typed = await request.patch(`/api/locations/${made.data[0].id}/building-type`, { data: { building_type: 'general_store' }, headers: { Authorization: `Bearer ${gm}` } });
  expect(typed.ok(), await typed.text()).toBe(true);

  // The player, online and with a sheet opened once.
  const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width: 1280, height: 800 } });
  const mine = await context.newPage();
  await signInAsPlayer(mine, player);
  await mine.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true }).click();
  await mine.getByRole('button', { name: 'CHARACTER_SHEET', exact: true }).click();
  await expect(mine.getByRole('group', { name: 'Vitals' })).toBeVisible({ timeout: 15_000 });
  await mine.keyboard.press('Escape');

  // The GM's [GUNS] catalogue, saved; 1000 paid.
  await page.setViewportSize({ width: 1280, height: 800 });
  await signInAsGm(page);
  await openGameSystem(page);
  await page.getByRole('button', { name: 'SHOP_CATALOGUES', exact: true }).click();
  await page.getByLabel('Catalogue text').fill('[GUNS]\nname, price, damage, ammo\nPistol, 250, 2d6, 6\n');
  await page.getByRole('button', { name: 'PREVIEW', exact: true }).click();
  await expect(page.getByText('1 ROW READ')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'SAVE', exact: true }).click();
  await expect(page.getByText('Saved: GUNS ×1. The shops have it now.')).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press('Escape');
  await payPlayer(page, player.username, 1000);

  // The store's GUNS shelf: the Pistol in the type's columns, where it lands said.
  await mine.getByRole('button', { name: 'QUICK_ACCESS', exact: true }).click();
  const list = mine.locator('.quick-access-panel');
  await list.getByText(/DEFINED_STRUCTURES/).click();
  await list.getByText(shop, { exact: true }).click();
  await mine.getByRole('button', { name: 'SHOP', exact: true }).click();
  const window = mine.locator('.win95-window', { has: mine.getByText(`SHOP.EXE · ${shop}`, { exact: true }) });
  await window.getByRole('tab', { name: 'GUNS' }).click({ timeout: 15_000 });
  await expect(window.getByText('GOES INTO YOUR GEAR AS A GUN')).toBeVisible();
  await expect(window.getByLabel('Sort by DAMAGE')).toBeVisible();
  await expect(window.getByLabel('Sort by AMMO')).toBeVisible();
  const row = window.locator('tr', { hasText: 'Pistol' });
  await expect(row).toContainText('2d6');

  // Bought: paid for, then a Gun on the gear, its columns its values.
  await window.getByRole('button', { name: 'Add Pistol to the cart' }).click();
  await window.getByRole('tab', { name: 'CART' }).click();
  await window.getByRole('button', { name: 'CHECK OUT' }).click();
  await expect(window.getByRole('tabpanel')).toContainText('BALANCE 750cr', { timeout: 15_000 });
  await expect.poll(() => gearOf(request, gm, player.username), { timeout: 15_000 }).toEqual([{ name: 'Pistol', qty: 1, type: 'guns', values: { damage: '2d6', ammo: 6 } }]);

  // Given another from GIVE.EXE: the same thing untouched, so it stacks.
  await page.getByRole('button', { name: 'GIVE_ITEM', exact: true }).click();
  const give = page.locator('.win95-window', { has: page.getByText('GIVE.EXE', { exact: true }) });
  const folder = (name: string) => give.getByRole('tablist', { name: 'Folders' }).getByRole('tab', { name });
  await give.getByLabel('Search every catalogue').fill('Pistol');
  await give.getByRole('table', { name: 'Items' }).getByRole('button', { name: 'Give Pistol' }).first().click({ timeout: 15_000 });
  await folder('TO').click();
  await give.getByRole('checkbox', { name: new RegExp(player.username, 'i') }).check();
  await give.getByRole('button', { name: 'GIVE 1 × PISTOL TO 1' }).click();
  await expect.poll(() => gearOf(request, gm, player.username), { timeout: 15_000 }).toEqual([{ name: 'Pistol', qty: 2, type: 'guns', values: { damage: '2d6', ammo: 6 } }]);
  await context.close();
});
