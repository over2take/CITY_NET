import { test, expect } from '@playwright/test';
import { signInAsGm, signInAsPlayer, gmToken, asGm, runningSystem, approvedPlayer, openGameSystem } from './helpers';
import { playerToken, sheetOf, payPlayer } from './shops';

// A type's quick filters at the table (8a7c3; mockup docs/mockups/item-types-in-shops.html, section 3, answered 2 A). A game
// whose GUNS type has a GRADE column, PICK ONE of LIGHT or HEAVY: the GM saves a Pistol (LIGHT) and a Rifle (HEAVY); on the
// store's GUNS shelf the player sees GRADE as buttons, ALL first, presses HEAVY and only the Rifle is left, puts it in the
// cart, presses ALL and the Pistol is back; checked out, the Rifle lands on their gear as a Gun with its grade. Then GIVE.EXE
// (8a7d): the GM's QUICK FIND finds the Rifle by "2d8" with THE LINE said; GUNS, the game's one catalogue, has GRADE as buttons
// too, and HEAVY leaves the Rifle, given, so it stacks onto the one bought.

const SYSTEM = (name: string) => ({
  format: 1, name, core: { health: { model: 'pool' } },
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }] }],
  items: {
    types: [{ id: 'guns', label: 'GUNS', one: 'Gun', columns: [
      { id: 'damage', label: 'DAMAGE', kind: 'damage' },
      { id: 'grade', label: 'GRADE', kind: 'pick', options: ['LIGHT', 'HEAVY'] },
    ] }],
    list: [],
  },
});

test('a GRADE column as buttons on the GUNS shelf: HEAVY leaves the Rifle, bought with its grade; ALL, every line (8a7c3); in GIVE.EXE too, found by its damage and given (8a7d)', async ({ page, browser, request }, info) => {
  test.setTimeout(180_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const gm = await gmToken(request);
  await runningSystem(request, gm, SYSTEM(`Gradefall${again}`));
  const player = { username: `e2e_gradefall${again}`, password: 'e2e-player-password' };
  await approvedPlayer(request, gm, player);
  await playerToken(request, gm, player.username);
  const shop = `GRADE_GOODS${again}`;
  const made = await asGm(request, gm, 'post', '/api/locations', { name: shop, description: '', shape: 'box', x: 14, y: 0, z: 8, width: 2, height: 2, depth: 2 });
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

  // The GM's [GUNS] catalogue, a grade on each line; 1000 paid.
  await page.setViewportSize({ width: 1280, height: 800 });
  await signInAsGm(page);
  await openGameSystem(page);
  await page.getByRole('button', { name: 'SHOP_CATALOGUES', exact: true }).click();
  await page.getByLabel('Catalogue text').fill('[GUNS]\nname, price, damage, grade\nPistol, 250, 2d6, LIGHT\nRifle, 600, 2d8, HEAVY\n');
  await page.getByRole('button', { name: 'PREVIEW', exact: true }).click();
  await expect(page.getByText('2 ROWS READ')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'SAVE', exact: true }).click();
  await expect(page.getByText('Saved: GUNS ×2. The shops have it now.')).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press('Escape');
  await payPlayer(page, player.username, 1000);

  // The store's GUNS shelf: GRADE as buttons, ALL pressed, both guns.
  await mine.getByRole('button', { name: 'QUICK_ACCESS', exact: true }).click();
  const list = mine.locator('.quick-access-panel');
  await list.getByText(/DEFINED_STRUCTURES/).click();
  await list.getByText(shop, { exact: true }).click();
  await mine.getByRole('button', { name: 'SHOP', exact: true }).click();
  const window = mine.locator('.win95-window', { has: mine.getByText(`SHOP.EXE · ${shop}`, { exact: true }) });
  await window.getByRole('tab', { name: 'GUNS' }).click({ timeout: 15_000 });
  const grade = window.getByRole('group', { name: 'GRADE' });
  await expect(grade.getByRole('button')).toHaveText(['ALL', 'LIGHT', 'HEAVY']);
  await expect(grade.getByRole('button', { name: 'ALL' })).toHaveAttribute('aria-pressed', 'true');
  const pistol = window.getByRole('button', { name: 'Add Pistol to the cart' });
  const rifle = window.getByRole('button', { name: 'Add Rifle to the cart' });
  await expect(pistol).toBeVisible();
  await expect(rifle).toBeVisible();

  // HEAVY: the Rifle alone, into the cart; ALL: every line again.
  await grade.getByRole('button', { name: 'HEAVY' }).click();
  await expect(grade.getByRole('button', { name: 'HEAVY' })).toHaveAttribute('aria-pressed', 'true');
  await expect(pistol).toHaveCount(0);
  await rifle.click();
  await grade.getByRole('button', { name: 'ALL' }).click();
  await expect(pistol).toBeVisible();
  await expect(rifle).toBeVisible();

  // Checked out: the Rifle on the gear, its grade with it.
  await window.getByRole('tab', { name: 'CART' }).click();
  await window.getByRole('button', { name: 'CHECK OUT' }).click();
  await expect(window.getByRole('tabpanel')).toContainText('BALANCE 400cr', { timeout: 15_000 });
  await expect.poll(async () => {
    const inventory = (await sheetOf(request, gm, player.username)).inventory;
    return (JSON.parse(typeof inventory === 'string' ? inventory : '[]') as { name: string; type?: string; values?: object }[]).map(({ name, type, values }) => ({ name, type, values }));
  }, { timeout: 15_000 }).toEqual([{ name: 'Rifle', type: 'guns', values: { damage: '2d8', grade: 'HEAVY' } }]);

  // GIVE.EXE (8a7d): QUICK FIND by a value, the line said; GRADE as buttons, the game's one catalogue being GUNS; HEAVY, given.
  await page.getByRole('button', { name: 'GIVE_ITEM', exact: true }).click();
  const give = page.locator('.win95-window', { has: page.getByText('GIVE.EXE', { exact: true }) });
  const items = give.getByRole('table', { name: 'Items' });
  await give.getByLabel('Search every catalogue').fill('2d8');
  await expect(items.getByRole('button', { name: /^Give / })).toHaveCount(1, { timeout: 15_000 });
  await expect(items.locator('tr', { hasText: 'Rifle' })).toContainText('DAMAGE 2d8 · GRADE HEAVY');
  await give.getByLabel('Search every catalogue').fill('');
  const giveGrade = give.getByRole('group', { name: 'GRADE' });
  await expect(giveGrade.getByRole('button')).toHaveText(['ALL', 'LIGHT', 'HEAVY']);
  await giveGrade.getByRole('button', { name: 'HEAVY' }).click();
  await expect(items.getByRole('button', { name: 'Give Pistol' })).toHaveCount(0);
  await items.getByRole('button', { name: 'Give Rifle' }).click();
  await give.getByRole('tablist', { name: 'Folders' }).getByRole('tab', { name: 'TO' }).click();
  await give.getByRole('checkbox', { name: new RegExp(player.username, 'i') }).check();
  await give.getByRole('button', { name: 'GIVE 1 × RIFLE TO 1' }).click();
  await expect.poll(async () => {
    const inventory = (await sheetOf(request, gm, player.username)).inventory;
    return (JSON.parse(typeof inventory === 'string' ? inventory : '[]') as { name: string; qty: number }[]).map(({ name, qty }) => ({ name, qty }));
  }, { timeout: 15_000 }).toEqual([{ name: 'Rifle', qty: 2 }]);
  await context.close();
});
