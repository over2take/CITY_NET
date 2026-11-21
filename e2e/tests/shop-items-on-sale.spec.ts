import { test, expect } from '@playwright/test';
import { signInAsGm, signInAsPlayer, gmToken, asGm, runningSystem, approvedPlayer } from './helpers';
import { playerToken, sheetOf, payPlayer } from './shops';

// The game's own items on the shelves (8a7a3a; mockup docs/mockups/types-in-shops.html, decided 2026-11-21). Found by the user
// testing 8a7a2: a Pistol priced on the ITEMS page never reached a shop. A game whose WEAPONS type has a PRICE column, its
// Pistol priced 200 and a Ring of Might kept out of the shops; no catalogue saved at all. The player's General Store sells the
// Pistol on its WEAPONS shelf, never the ring; bought, it lands on the gear as a Weapon with its damage.

const SYSTEM = (name: string) => ({
  format: 1, name, core: { health: { model: 'pool' } },
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }] }],
  items: {
    types: [{ id: 'weapons', label: 'WEAPONS', one: 'Weapon', columns: [
      { id: 'damage', label: 'DAMAGE', kind: 'damage' },
      { id: 'price', label: 'PRICE', kind: 'number' },
    ] }],
    list: [
      { id: 'pistol', label: 'Pistol', type: 'weapons', values: { damage: '2d6', price: 200 } },
      { id: 'ring', label: 'Ring of Might', type: 'weapons', price: 5000, in_shops: false },
    ],
  },
});

test('a Pistol priced on ITEMS sells itself at the General Store, no catalogue saved; a ring kept out isn\'t (8a7a3a)', async ({ page, browser, request }, info) => {
  test.setTimeout(180_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const gm = await gmToken(request);
  await runningSystem(request, gm, SYSTEM(`Itemsale${again}`));
  const player = { username: `e2e_itemsale${again}`, password: 'e2e-player-password' };
  await approvedPlayer(request, gm, player);
  await playerToken(request, gm, player.username);
  const shop = `ITEMSALE_GOODS${again}`;
  const made = await asGm(request, gm, 'post', '/api/locations', { name: shop, description: '', shape: 'box', x: 10, y: 0, z: 10, width: 2, height: 2, depth: 2 });
  const typed = await request.patch(`/api/locations/${made.data[0].id}/building-type`, { data: { building_type: 'general_store' }, headers: { Authorization: `Bearer ${gm}` } });
  expect(typed.ok(), await typed.text()).toBe(true);

  // The player, with a sheet opened once.
  const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width: 1280, height: 800 } });
  const mine = await context.newPage();
  await signInAsPlayer(mine, player);
  await mine.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true }).click();
  await mine.getByRole('button', { name: 'CHARACTER_SHEET', exact: true }).click();
  await expect(mine.getByRole('group', { name: 'Vitals' })).toBeVisible({ timeout: 15_000 });
  await mine.keyboard.press('Escape');

  // Paid 1000; nothing uploaded.
  await page.setViewportSize({ width: 1280, height: 800 });
  await signInAsGm(page);
  await payPlayer(page, player.username, 1000);

  // The store's WEAPONS shelf: the Pistol from ITEMS, at its price; not the ring.
  await mine.getByRole('button', { name: 'QUICK_ACCESS', exact: true }).click();
  const list = mine.locator('.quick-access-panel');
  await list.getByText(/DEFINED_STRUCTURES/).click();
  await list.getByText(shop, { exact: true }).click();
  await mine.getByRole('button', { name: 'SHOP', exact: true }).click();
  const window = mine.locator('.win95-window', { has: mine.getByText(`SHOP.EXE · ${shop}`, { exact: true }) });
  await window.getByRole('tab', { name: 'WEAPONS' }).click({ timeout: 15_000 });
  const row = window.locator('tr', { hasText: 'Pistol' });
  await expect(row).toContainText('200');
  await expect(row).toContainText('2d6');
  await expect(window.getByText('Ring of Might')).toHaveCount(0);
  await expect(window.getByRole('note', { name: 'How to stock this shop' })).toHaveCount(0);

  // Bought: paid for, then a Weapon on the gear with its damage.
  await window.getByRole('button', { name: 'Add Pistol to the cart' }).click();
  await window.getByRole('tab', { name: 'CART' }).click();
  await window.getByRole('button', { name: 'CHECK OUT' }).click();
  await expect(window.getByRole('tabpanel')).toContainText('BALANCE 800cr', { timeout: 15_000 });
  await expect.poll(async () => {
    const inventory = (await sheetOf(request, gm, player.username)).inventory;
    return (JSON.parse(typeof inventory === 'string' ? inventory : '[]') as { name: string; qty: number; type?: string; values?: Record<string, unknown> }[])
      .map(({ name, qty, type, values }) => ({ name, qty, type, damage: values?.damage }));
  }, { timeout: 15_000 }).toEqual([{ name: 'Pistol', qty: 1, type: 'weapons', damage: '2d6' }]);
  await context.close();
});
