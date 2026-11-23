import { test, expect, type Page } from '@playwright/test';
import { signInAsGm, signInAsPlayer, gmToken, asGm, runningSystem, approvedPlayer, sheetTab } from './helpers';
import { playerToken, payPlayer, sheetOf, inventoryOf } from './shops';

// Two games on one table (8n5; the user, 2026-11-22: "yes please"). Each part of the app is tested per game on its own; this
// walks one player and one map through switching between two custom games and back, and checks each game is as it was left:
// the character (its name and gear), the money, what the one building is, and what its shelf sells.
//
// North makes an Apothecary selling POTIONS, a Healing Draught at 40; South an Armory selling BLADES, a Dagger at 25. The
// same building is the Apothecary in North and the Armory in South (8a7b3c1, kept per game).

const GAME = (name: string, shop: { id: string; name: string }, type: { id: string; label: string; one: string }, item: { id: string; label: string }, price: number) => ({
  format: 1, name, core: { health: { model: 'pool' } },
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }] }],
  buildings: { shops: [shop] },
  items: { types: [{ ...type, sold_at: [shop.id], columns: [] }], list: [{ ...item, type: type.id, price, in_shops: true }] },
});

test('two games on one table: a character, money, a building\'s shop and its shelf in each, each as it was left after switching and back (8n5)', async ({ page, browser, request }, info) => {
  test.setTimeout(240_000);
  const again = info.retry ? ` ${info.retry + 1}` : '';
  const suffix = info.retry ? `_${info.retry + 1}` : '';
  const gm = await gmToken(request);
  const south = await runningSystem(request, gm, GAME(`Twinfall South${again}`, { id: 'armory', name: 'Armory' }, { id: 'blades', label: 'BLADES', one: 'Blade' }, { id: 'dagger', label: 'Dagger' }, 25));
  const north = await runningSystem(request, gm, GAME(`Twinfall North${again}`, { id: 'apothecary', name: 'Apothecary' }, { id: 'potions', label: 'POTIONS', one: 'Potion' }, { id: 'draught', label: 'Healing Draught' }, 40));
  const run = (system: string) => asGm(request, gm, 'put', '/api/sheets/system', { system });
  const player = { username: `e2e_twinfall${suffix}`, password: 'e2e-player-password' };
  await approvedPlayer(request, gm, player);
  await playerToken(request, gm, player.username);
  const shop = `TWINFALL_CORNER${suffix}`;
  const lane = `TWINFALL_LANE${suffix}`;
  const corner = (await asGm(request, gm, 'post', '/api/locations', { name: shop, description: '', shape: 'box', x: 24, y: 0, z: 24, width: 2, height: 2, depth: 2 })).data[0].id;
  await asGm(request, gm, 'post', '/api/locations', { name: lane, description: '', shape: 'box', x: 28, y: 0, z: 24, width: 2, height: 2, depth: 2 });
  const shopIs = async (type: string) => {
    const res = await request.patch(`/api/locations/${corner}/building-type`, { data: { building_type: type }, headers: { Authorization: `Bearer ${gm}` } });
    expect(res.ok(), await res.text()).toBe(true);
  };

  const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width: 1280, height: 800 } });
  const mine = await context.newPage();
  await signInAsPlayer(mine, player);
  await page.setViewportSize({ width: 1280, height: 800 });
  await signInAsGm(page);

  /**
   * The player's sheet in the running game, named. Opened only where it isn't open already: CHARACTER_SHEET toggles, and an
   * open sheet follows the game when it changes (its game said in its corner), so it is never opened twice.
   */
  const sheet = mine.locator('.win95-window', { hasText: 'SHEET.EXE' });
  const nameCharacter = async (game: string, name: string) => {
    if (!(await sheet.count())) {
      await mine.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true }).click();
      await mine.getByRole('button', { name: 'CHARACTER_SHEET', exact: true }).click();
    }
    await expect(sheet.getByText(game.toUpperCase(), { exact: true })).toBeVisible({ timeout: 15_000 });
    await sheetTab(mine, 'CHARACTER');
    await sheet.getByLabel('Name', { exact: true }).fill(name);
    await expect.poll(async () => (await sheetOf(request, gm, player.username)).name, { timeout: 15_000 }).toBe(name);
    // Shut by its own ×, so it covers no building window after.
    await sheet.locator('.win95-close-btn', { hasText: /^×$/ }).click();
    await expect(sheet).toHaveCount(0);
  };
  /** The corner's SHOP window, the building picked afresh so its type in this game is read. */
  const openShop = async (p: Page) => {
    // One already open (SHOP stays pressed while it is) shut by its own ×, so the building is opened afresh. After a game
    // switch the app may shut it itself a moment later (the building another shop, or none, in this game), so the × is
    // tried briefly, not waited on: either way it is gone before going on (CI, 2026-11-23, waited 4 minutes on a × gone).
    const open = p.locator('.win95-window', { hasText: 'SHOP.EXE' });
    if (await open.count()) await open.locator('.win95-close-btn', { hasText: /^×$/ }).first().click({ timeout: 3_000 }).catch(() => {});
    await expect(open).toHaveCount(0, { timeout: 15_000 });
    const list = p.locator('.quick-access-panel');
    if (!(await list.isVisible())) await p.getByRole('button', { name: 'QUICK_ACCESS', exact: true }).click();
    if (!(await list.getByText(shop, { exact: true }).isVisible())) await list.getByText(/DEFINED_STRUCTURES/).click();
    await list.getByText(lane, { exact: true }).click();
    await list.getByText(shop, { exact: true }).click();
    await p.getByRole('button', { name: 'SHOP', exact: true }).click({ timeout: 15_000 });
    return p.locator('.win95-window', { has: p.getByText(`SHOP.EXE · ${shop}`, { exact: true }) });
  };
  /**
   * One of something bought through the cart, and paid. Not waited for on the sheet: the game is switched straight after.
   * Placed by the player's browser once the checkout answered, it used to land in whichever game was running by then (found
   * here, 2026-11-23: North's draught on South's Bryn); placed by the server in the checkout since 8n6, it lands in the game
   * that took the money, which the checks below prove.
   */
  const buy = async (window: ReturnType<Page['locator']>, label: string, left: number) => {
    await window.getByRole('button', { name: `Add ${label} to the cart` }).click({ timeout: 15_000 });
    await window.getByRole('tab', { name: 'CART' }).click();
    await window.getByRole('button', { name: 'CHECK OUT' }).click();
    await expect(window.getByRole('tabpanel')).toContainText(`BALANCE ${left}cr`, { timeout: 15_000 });
  };
  /** What the corner is in the running game, and what its shelf has, by its window: its name, its stock, the money left. */
  const shopShows = async (type: string, sells: string, notSold: string, money: number) => {
    const window = await openShop(mine);
    await expect(window.getByText(new RegExp(`^${type} · 1 LINE · ${money}cr`))).toBeVisible({ timeout: 15_000 });
    await expect(window.getByRole('button', { name: `Add ${sells} to the cart` })).toBeVisible();
    await expect(window.getByRole('button', { name: `Add ${notSold} to the cart` })).toHaveCount(0);
  };

  // NORTH: Ash, paid 100, a Healing Draught bought at the corner, an Apothecary here.
  await shopIs('apothecary');
  await nameCharacter(`Twinfall North${again}`, 'Ash');
  await payPlayer(page, player.username, 100);
  await buy(await openShop(mine), 'Healing Draught', 60);

  // SOUTH: the same player's other character, Bryn, paid 50, a Dagger bought at the same corner, an Armory here.
  await run(south);
  await shopIs('armory');
  await nameCharacter(`Twinfall South${again}`, 'Bryn');
  await payPlayer(page, player.username, 50);
  await buy(await openShop(mine), 'Dagger', 25);

  // Back to NORTH, then SOUTH, then NORTH again: each as it was left.
  for (const [system, game] of [[north, 'north'], [south, 'south'], [north, 'north']] as const) {
    await run(system);
    if (game === 'north') {
      await expect.poll(async () => (await sheetOf(request, gm, player.username)).name, { timeout: 15_000 }).toBe('Ash');
      await expect.poll(() => inventoryOf(request, gm, player.username)).toEqual([['Healing Draught', 1]]);
      await shopShows('APOTHECARY', 'Healing Draught', 'Dagger', 60);
    } else {
      await expect.poll(async () => (await sheetOf(request, gm, player.username)).name, { timeout: 15_000 }).toBe('Bryn');
      await expect.poll(() => inventoryOf(request, gm, player.username)).toEqual([['Dagger', 1]]);
      await shopShows('ARMORY', 'Dagger', 'Healing Draught', 25);
    }
  }
  await context.close();
});
