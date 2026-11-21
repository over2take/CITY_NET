import { test, expect } from '@playwright/test';
import { signInAsGm, signInAsPlayer, gmToken, asGm, runningSystem, approvedPlayer } from './helpers';
import { playerToken, sheetOf, inventoryOf, payPlayer, saveItemsCatalogue, ITEMS_SYSTEM } from './shops';

// A custom system's shop at the table, a safety net before 8a7 changes what shops carry (8n1): the GM's catalogue for the
// General Store with an item (a ring the system has) and a plain line of gear; the player, paid from PAY_PLAYERS, buys both
// through the cart. The gear line lands on the sheet's GEAR; the ring lands as the item it is, to WEAR and ATTUNE.

test('a custom system\'s General Store: a gear line and an item bought through the cart, each where it belongs (8n1)', async ({ page, browser, request }, info) => {
  test.setTimeout(180_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const gm = await gmToken(request);
  await runningSystem(request, gm, ITEMS_SYSTEM(`Cartfall${again}`));
  const player = { username: `e2e_cartfall${again}`, password: 'e2e-player-password' };
  await approvedPlayer(request, gm, player);
  await playerToken(request, gm, player.username);
  const shop = `GENERAL_GOODS${again}`;
  const made = await asGm(request, gm, 'post', '/api/locations', { name: shop, description: '', shape: 'box', x: 8, y: 0, z: 8, width: 2, height: 2, depth: 2 });
  const typed = await request.patch(`/api/locations/${made.data[0].id}/building-type`, { data: { building_type: 'general_store' }, headers: { Authorization: `Bearer ${gm}` } });
  expect(typed.ok(), await typed.text()).toBe(true);

  const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width: 1280, height: 800 } });
  const mine = await context.newPage();
  await signInAsPlayer(mine, player);

  // The GM's catalogue, the ring priced and a rope added, saved while the player is online; then 1000 paid to them.
  await page.setViewportSize({ width: 1280, height: 800 });
  await signInAsGm(page);
  await saveItemsCatalogue(page, { 'Ring of Might': 500 }, 'Rope, 5, , Fifty feet of it.\n');
  await payPlayer(page, player.username, 1000);

  // The store, from QUICK_ACCESS: the GM's two lines on its shelf, though the player was online before they were saved
  // (8n1 found the player's shops empty: what was sent was never kept).
  await mine.getByRole('button', { name: 'QUICK_ACCESS', exact: true }).click();
  const list = mine.locator('.quick-access-panel');
  await list.getByText(/DEFINED_STRUCTURES/).click();
  await list.getByText(shop, { exact: true }).click();
  await mine.getByRole('button', { name: 'SHOP', exact: true }).click();
  const window = mine.locator('.win95-window', { has: mine.getByText(`SHOP.EXE · ${shop}`, { exact: true }) });
  await expect(window.getByText(/^GENERAL STORE · /)).toContainText('2 LINES', { timeout: 15_000 });

  // Both into the cart, and checked out: 505 paid from the account, the receipt saying so.
  await window.getByRole('button', { name: 'Add Ring of Might to the cart' }).click();
  await window.getByRole('button', { name: 'Add Rope to the cart' }).click();
  await window.getByRole('tab', { name: 'CART' }).click();
  await window.getByRole('button', { name: 'CHECK OUT' }).click();
  const receipt = window.getByRole('tabpanel');
  await expect(receipt).toContainText('TOTAL505cr', { timeout: 15_000 });
  await expect(receipt).toContainText('BALANCE 495cr');

  // On the sheet: both in the inventory, the ring known as the item it is, to WEAR and ATTUNE.
  await expect.poll(() => inventoryOf(request, gm, player.username), { timeout: 15_000 }).toEqual([['Ring of Might', 1], ['Rope', 1]]);
  const worked = (await sheetOf(request, gm, player.username))._worked as { items?: { id: string }[] };
  expect(worked.items?.map((i) => i.id)).toEqual(['ring']);
  await context.close();
});
