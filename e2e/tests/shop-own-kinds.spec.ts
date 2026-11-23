import { test, expect } from '@playwright/test';
import { signInAsGm, signInAsPlayer, gmToken, asGm, runningSystem, approvedPlayer } from './helpers';
import { playerToken, payPlayer } from './shops';

// The game's own shops at the table (8a7b3a; approved mockup docs/mockups/types-in-shops.html, sections 3 and 4). A game with
// an Apothecary selling its POTIONS and a Fence that sells nothing and BUYS anything. The GM makes a building an Apothecary
// from BUILDING TYPE, under THIS GAME'S OWN; the player buys a Healing Draught there, then takes it to the Fence, whose
// window opens on SELL, its BUY folder saying it only buys, and sells it back at the app's 45%.

const SYSTEM = (name: string) => ({
  format: 1, name, core: { health: { model: 'pool' } },
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }] }],
  buildings: { shops: [{ id: 'apothecary', name: 'Apothecary' }, { id: 'fence', name: 'Fence', buys: 'anything' }] },
  items: {
    types: [{ id: 'potions', label: 'POTIONS', one: 'Potion', sold_at: ['apothecary'], columns: [{ id: 'heals', label: 'HEALS', kind: 'dice' }] }],
    list: [{ id: 'draught', label: 'Healing Draught', type: 'potions', values: { heals: '2d4' }, price: 40, in_shops: true }],
  },
});

test('the game\'s own shops: an Apothecary picked under THIS GAME\'S OWN sells a draught; a Fence that only buys takes it back (8a7b3a)', async ({ page, browser, request }, info) => {
  test.setTimeout(180_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const gm = await gmToken(request);
  await runningSystem(request, gm, SYSTEM(`Herbfall${again}`));
  const player = { username: `e2e_herbfall${again}`, password: 'e2e-player-password' };
  await approvedPlayer(request, gm, player);
  await playerToken(request, gm, player.username);
  const shop = `HERBFALL_MOSS${again}`;
  const fence = `HERBFALL_DOOR${again}`;
  await asGm(request, gm, 'post', '/api/locations', { name: shop, description: '', shape: 'box', x: 12, y: 0, z: 12, width: 2, height: 2, depth: 2 });
  const door = await asGm(request, gm, 'post', '/api/locations', { name: fence, description: '', shape: 'box', x: 16, y: 0, z: 12, width: 2, height: 2, depth: 2 });
  const typed = await request.patch(`/api/locations/${door.data[0].id}/building-type`, { data: { building_type: 'fence' }, headers: { Authorization: `Bearer ${gm}` } });
  expect(typed.ok(), await typed.text()).toBe(true);

  // The player, online and with a sheet opened once.
  const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width: 1280, height: 800 } });
  const mine = await context.newPage();
  await signInAsPlayer(mine, player);
  await mine.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true }).click();
  await mine.getByRole('button', { name: 'CHARACTER_SHEET', exact: true }).click();
  await expect(mine.getByRole('group', { name: 'Vitals' })).toBeVisible({ timeout: 15_000 });
  await mine.keyboard.press('Escape');

  // The GM: the building picked out, EDIT, BUILDING TYPE has the game's own under THIS GAME'S OWN; Apothecary, saved.
  await page.setViewportSize({ width: 1280, height: 800 });
  await signInAsGm(page);
  await page.getByRole('button', { name: 'QUICK_ACCESS', exact: true }).click();
  const gmList = page.locator('.quick-access-panel');
  await gmList.getByText(/DEFINED_STRUCTURES/).click();
  await gmList.getByText(shop, { exact: true }).click();
  await page.locator('.selection-panel').getByRole('button', { name: 'EDIT', exact: true }).click();
  const picker = page.getByLabel('Building type');
  await expect(picker.locator('optgroup[label="THIS GAME\'S OWN"] option')).toHaveText(['Apothecary (shop)', 'Fence (shop)']);
  await picker.selectOption('apothecary');
  await expect(page.getByLabel('Buy-back rate for this shop')).toBeVisible();
  await page.getByRole('button', { name: 'UPDATE_DATA_POINT', exact: true }).click();
  await expect(page.getByText('CHANGES_SAVED', { exact: true })).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'ACKNOWLEDGE', exact: true }).click();
  await expect.poll(async () => (await asGm(request, gm, 'get', '/api/locations')).find((l: { name: string }) => l.name === shop)?.building_type, { timeout: 15_000 }).toBe('apothecary');
  await payPlayer(page, player.username, 100);

  // The Apothecary: named as the game names it, its POTIONS on sale; a draught bought.
  await mine.getByRole('button', { name: 'QUICK_ACCESS', exact: true }).click();
  const list = mine.locator('.quick-access-panel');
  await list.getByText(/DEFINED_STRUCTURES/).click();
  await list.getByText(shop, { exact: true }).click();
  await mine.getByRole('button', { name: 'SHOP', exact: true }).click();
  const moss = mine.locator('.win95-window', { has: mine.getByText(`SHOP.EXE · ${shop}`, { exact: true }) });
  await expect(moss.getByText(/^APOTHECARY · 1 LINE/)).toBeVisible({ timeout: 15_000 });
  await moss.getByRole('button', { name: 'Add Healing Draught to the cart' }).click();
  await moss.getByRole('tab', { name: 'CART' }).click();
  await moss.getByRole('button', { name: 'CHECK OUT' }).click();
  await expect(moss.getByRole('tabpanel')).toContainText('BALANCE 60cr', { timeout: 15_000 });
  await mine.keyboard.press('Escape');

  // The Fence: open on SELL, the draught there; BUY says it only buys; sold back at 45% of 40.
  await list.getByText(fence, { exact: true }).click();
  await mine.getByRole('button', { name: 'SHOP', exact: true }).click();
  const back = mine.locator('.win95-window', { has: mine.getByText(`SHOP.EXE · ${fence}`, { exact: true }) });
  await expect(back.getByRole('tab', { name: 'SELL' })).toHaveAttribute('aria-selected', 'true', { timeout: 15_000 });
  await back.getByRole('button', { name: 'Add Healing Draught to the cart' }).click({ timeout: 15_000 });
  await back.getByRole('tab', { name: 'BUY' }).click();
  await expect(back.getByTestId('shop-sells-nothing')).toHaveText('THIS SHOP ONLY BUYS: it sells nothing, and takes anything with a price. Open SELL.');
  await back.getByRole('tab', { name: 'CART' }).click();
  await back.getByRole('button', { name: 'CHECK OUT' }).click();
  await expect(back.getByRole('tabpanel')).toContainText('BALANCE 78cr', { timeout: 15_000 });
  await context.close();
});
