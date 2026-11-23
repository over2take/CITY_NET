import { test, expect } from '@playwright/test';
import { signInAsGm, signInAsPlayer, gmToken, asGm, approvedPlayer } from './helpers';
import { playerToken, sheetOf, payPlayer } from './shops';

// The shop at the table, a safety net before 8a7 changes what shops and GIVE carry (8n1; the user, 2026-11-19: tests for the
// thin places, the shops among them). Cities Without Number's Gun Shop from the book: the GM pays a player from PAY_PLAYERS,
// the player opens the shop from QUICK_ACCESS, puts a Light Pistol in the cart and checks out; what they have goes down by
// its price and the pistol is on the sheet. Then sold back through the cart: 45% back, the pistol gone. Set up through the
// API; the money as the GM hands it out.

const PISTOL = 'Light Pistol';
const PRICE = 200;
const cr = (n: number) => `${n.toLocaleString('en-US')}cr`;

/** The weapons on a CWN sheet, by name. */
const weaponsOf = (data: Record<string, unknown>) => Object.entries(data).filter(([k, v]) => /^weapon\d+_name$/.test(k) && v).map(([, v]) => String(v));

test('a CWN Gun Shop: paid by the GM, a Light Pistol bought through the cart onto the sheet, then sold back (8n1)', async ({ page, browser, request }, info) => {
  test.setTimeout(180_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const gm = await gmToken(request);
  await asGm(request, gm, 'put', '/api/sheets/system', { system: 'cities_without_number' });
  const player = { username: `e2e_shopper${again}`, password: 'e2e-player-password' };
  await approvedPlayer(request, gm, player);
  await playerToken(request, gm, player.username);
  const shop = `VIC_ARMS${again}`;
  const made = await asGm(request, gm, 'post', '/api/locations', { name: shop, description: '', shape: 'box', x: 8, y: 0, z: 8, width: 2, height: 2, depth: 2 });
  const typed = await request.patch(`/api/locations/${made.data[0].id}/building-type`, { data: { building_type: 'gun_shop' }, headers: { Authorization: `Bearer ${gm}` } });
  expect(typed.ok(), await typed.text()).toBe(true);

  // The player online, so the GM's PAY lists them.
  const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width: 1280, height: 800 } });
  const mine = await context.newPage();
  await signInAsPlayer(mine, player);

  // PAY_PLAYERS, in the GAME tab's BANK: 1000 to the player alone.
  await page.setViewportSize({ width: 1280, height: 800 });
  await signInAsGm(page);
  await payPlayer(page, player.username, 1000);

  // The shop, from QUICK_ACCESS: the building, then SHOP. Its header says what the player has: the GM's 1,000.
  await mine.getByRole('button', { name: 'QUICK_ACCESS', exact: true }).click();
  const list = mine.locator('.quick-access-panel');
  await list.getByText(/DEFINED_STRUCTURES/).click();
  await list.getByText(shop, { exact: true }).click();
  await mine.getByRole('button', { name: 'SHOP', exact: true }).click();
  const window = mine.locator('.win95-window', { has: mine.getByText(`SHOP.EXE · ${shop}`, { exact: true }) });
  const header = window.getByText(/^GUN SHOP · /);
  await expect(header).toContainText(cr(1000), { timeout: 15_000 });

  // A Light Pistol into the cart, and checked out: paid for, then on the sheet.
  await window.getByLabel('Find in this shop').fill(PISTOL);
  // QUICK FIND (8a7c2): both shelves looked along, WEAPONS saying how many it holds, the line found with its type.
  await expect(window.getByTestId('shop-found').locator('tr', { hasText: PISTOL })).toContainText('WEAPONS');
  await expect(window.getByRole('tab', { name: /^WEAPONS · \d+$/ })).toBeVisible();
  await window.getByRole('button', { name: `Add ${PISTOL} to the cart` }).click();
  await window.getByRole('tab', { name: 'CART' }).click();
  await window.getByRole('button', { name: 'CHECK OUT' }).click();
  await expect(header).toContainText(cr(1000 - PRICE), { timeout: 15_000 });
  await expect.poll(async () => weaponsOf(await sheetOf(request, gm, player.username)), { timeout: 15_000 }).toContain(PISTOL);

  // Sold back through the cart: 45% of the book price back (the GAME tab's SHOP_BUY_BACK), and off the sheet.
  await window.getByRole('tab', { name: 'SELL' }).click();
  await window.getByRole('button', { name: `Add ${PISTOL} to the cart` }).click();
  await window.getByRole('tab', { name: 'CART' }).click();
  await window.getByRole('button', { name: 'CHECK OUT' }).click();
  await expect(header).toContainText(cr(1000 - PRICE + PRICE * 0.45), { timeout: 15_000 });
  await expect.poll(async () => weaponsOf(await sheetOf(request, gm, player.username)), { timeout: 15_000 }).not.toContain(PISTOL);
  await context.close();
});
