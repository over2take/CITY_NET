import { test, expect } from '@playwright/test';
import { signInAsGm, signInAsPlayer, openBuilder, builderPage, gmToken, asGm, runningSystem, approvedPlayer } from './helpers';
import { playerToken, payPlayer } from './shops';

// SOLD AT on a type, and + NEW SHOP (8a7b2; approved mockup docs/mockups/types-in-shops.html, section 2). By clicks: WEAPONS
// from its preset, sold at the Gun Shop to start; an Apothecary of the game's own made and ticked too; SPELLS from theirs,
// sold nowhere, its Magic Shop filled in and ADDed. Saved as made. Then that game at the table: a Pistol of WEAPONS bought
// at a Gun Shop.

test('SOLD AT: WEAPONS at the Gun Shop and a new Apothecary, SPELLS at a Magic Shop, saved; a Pistol bought at a Gun Shop (8a7b2)', async ({ page, browser, request }, info) => {
  test.setTimeout(180_000);
  const again = info.retry ? ` ${info.retry + 1}` : '';
  const name = `Soldfall${again}`;
  const gm = await gmToken(request);
  const { id } = await asGm(request, gm, 'post', '/api/systems', { definition: { format: 1, name, core: { health: { model: 'pool' } },
    stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }] }] } });
  await page.setViewportSize({ width: 1280, height: 800 });
  await signInAsGm(page);
  await openBuilder(page);
  const card = page.getByTestId(/^system-/).filter({ hasText: name.toUpperCase() });
  if (!(await card.getByRole('button', { name: 'OPEN', exact: true }).isVisible())) await card.getByRole('button').first().click();
  await card.getByRole('button', { name: 'OPEN', exact: true }).click();
  await builderPage(page, 'ITEMS');

  // WEAPONS from its preset: the Gun Shop ticked, said.
  const types = page.getByRole('region', { name: 'Item types' });
  const presets = types.getByRole('group', { name: 'Add an item type' });
  await presets.getByRole('button', { name: 'WEAPON', exact: true }).click();
  const weapons = page.getByRole('region', { name: 'WEAPONS type' });
  const soldAt = weapons.getByRole('group', { name: 'WEAPONS sold at' });
  await expect(soldAt.getByRole('button', { name: 'Gun Shop' })).toHaveAttribute('aria-pressed', 'true');
  await expect(soldAt.getByRole('button', { name: 'General Store' })).toHaveAttribute('aria-pressed', 'false');
  await expect(weapons.getByText('Sold at every Gun Shop in this game.')).toBeVisible();

  // + NEW SHOP: an Apothecary, made by Enter, dashed and ticked.
  await weapons.getByRole('textbox', { name: 'New shop name' }).fill('Apothecary');
  await weapons.getByRole('textbox', { name: 'New shop name' }).press('Enter');
  await expect(soldAt.getByRole('button', { name: 'Apothecary' })).toHaveAttribute('aria-pressed', 'true');
  await expect(weapons.getByText('Sold at every Gun Shop, every Apothecary in this game. Dashed: shops this game made.')).toBeVisible();

  // SPELLS from theirs: sold nowhere, a Magic Shop ready to ADD; ADDed, ticked.
  await presets.getByRole('button', { name: 'SPELL', exact: true }).click();
  const spells = page.getByRole('region', { name: 'SPELLS type' });
  await expect(spells.getByText('Sold nowhere: only given, from GIVE.EXE.')).toBeVisible();
  await expect(spells.getByRole('textbox', { name: 'New shop name' })).toHaveValue('Magic Shop');
  await spells.getByRole('button', { name: 'ADD', exact: true }).click();
  await expect(spells.getByRole('group', { name: 'SPELLS sold at' }).getByRole('button', { name: 'Magic Shop' })).toHaveAttribute('aria-pressed', 'true');

  await expect(page.getByTestId('save-status')).toHaveText(/· SAVED /, { timeout: 15_000 });
  const saved = await asGm(request, gm, 'get', `/api/systems/${id}`);
  expect(saved.problems).toEqual([]);
  expect(saved.draft.buildings).toEqual({ shops: [{ id: 'apothecary', name: 'Apothecary' }, { id: 'magic_shop', name: 'Magic Shop' }] });
  const soldAtOf = (typeId: string) => saved.draft.items.types.find((t: { id: string }) => t.id === typeId).sold_at;
  expect(soldAtOf('weapons')).toEqual(['gun_shop', 'apothecary']);
  expect(soldAtOf('spells')).toEqual(['magic_shop']);
  expect(saved.draft.items.types.find((t: { id: string }) => t.id === 'gear')).not.toHaveProperty('sold_at');

  // At the table: that game, a priced Pistol of WEAPONS, a Gun Shop on the map, a player with 1000.
  const table = { ...saved.draft, name: `Soldfall Table${again}`, items: { ...saved.draft.items,
    list: [{ id: 'pistol', label: 'Pistol', type: 'weapons', values: { damage: '2d6', price: 200 }, in_shops: true }] } };
  await runningSystem(request, gm, table);
  const player = { username: `e2e_soldfall${again ? `_${info.retry + 1}` : ''}`, password: 'e2e-player-password' };
  await approvedPlayer(request, gm, player);
  await playerToken(request, gm, player.username);
  const shop = `SOLDFALL_ARMS${again ? `_${info.retry + 1}` : ''}`;
  const made = await asGm(request, gm, 'post', '/api/locations', { name: shop, description: '', shape: 'box', x: 10, y: 0, z: 10, width: 2, height: 2, depth: 2 });
  const typed = await request.patch(`/api/locations/${made.data[0].id}/building-type`, { data: { building_type: 'gun_shop' }, headers: { Authorization: `Bearer ${gm}` } });
  expect(typed.ok(), await typed.text()).toBe(true);

  const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width: 1280, height: 800 } });
  const mine = await context.newPage();
  await signInAsPlayer(mine, player);
  await mine.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true }).click();
  await mine.getByRole('button', { name: 'CHARACTER_SHEET', exact: true }).click();
  await expect(mine.getByRole('group', { name: 'Vitals' })).toBeVisible({ timeout: 15_000 });
  await mine.keyboard.press('Escape');
  await page.reload();
  await signInAsGm(page);
  await payPlayer(page, player.username, 1000);

  // The Gun Shop's WEAPONS shelf has the Pistol; bought, paid for.
  await mine.getByRole('button', { name: 'QUICK_ACCESS', exact: true }).click();
  const list = mine.locator('.quick-access-panel');
  await list.getByText(/DEFINED_STRUCTURES/).click();
  await list.getByText(shop, { exact: true }).click();
  await mine.getByRole('button', { name: 'SHOP', exact: true }).click();
  const window = mine.locator('.win95-window', { has: mine.getByText(`SHOP.EXE · ${shop}`, { exact: true }) });
  await window.getByRole('tab', { name: 'WEAPONS' }).click({ timeout: 15_000 });
  await window.getByRole('button', { name: 'Add Pistol to the cart' }).click();
  await window.getByRole('tab', { name: 'CART' }).click();
  await window.getByRole('button', { name: 'CHECK OUT' }).click();
  await expect(window.getByRole('tabpanel')).toContainText('BALANCE 800cr', { timeout: 15_000 });
  await context.close();
});
