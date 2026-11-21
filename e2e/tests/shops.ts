import { expect, type Page, type APIRequestContext } from '@playwright/test';
import { readFile } from 'fs/promises';
import { asGm, openGameSystem } from './helpers';

// Money and stock as the GM hands them out, shared by the shop, bank and GIVE journeys (8n1, 8n2).

/** A custom system with one item, a ring to attune, for the journeys that sell or give it. */
export const ITEMS_SYSTEM = (name: string) => ({
  format: 1, name, core: { health: { model: 'pool' } },
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'con', label: 'Con' }] }],
  items: {
    slots: [{ id: 'attuned', label: 'ATTUNED', count: 3 }],
    list: [{ id: 'ring', label: 'Ring of Might', description: 'A heavy iron band.', needs: 'attuned', features: [] }],
  },
});

/** A player's token on the city map, through the API. */
export const playerToken = (request: APIRequestContext, gm: string, username: string) => asGm(request, gm, 'post', '/api/locations', {
  name: username, description: '', shape: 'rhombus', owner: username, x: 0, y: 0, z: 0, width: 1, height: 1, depth: 1,
  hp_current: 10, hp_max: 10, hp_temp: 0, battle_map_id: -1, floor_index: -1,
});

/** The player's sheet as the server keeps it. */
export const sheetOf = async (request: APIRequestContext, gm: string, username: string) =>
  ((await asGm(request, gm, 'get', `/api/sheets/user/${username}`).catch(() => null))?.data ?? {}) as Record<string, unknown>;

/** A custom sheet's inventory lines, [name, qty]. */
export const inventoryOf = async (request: APIRequestContext, gm: string, username: string) => {
  const inventory = (await sheetOf(request, gm, username)).inventory;
  return (JSON.parse(typeof inventory === 'string' ? inventory : '[]') as { name: string; qty: number }[]).map((l) => [l.name, l.qty]);
};

/** The GAME tab's BANK folder open, as the GM. */
const bankFolder = async (page: Page) => {
  await page.getByRole('button', { name: 'GAME', exact: true }).click();
  const folder = page.getByRole('button', { name: /^[▸▾] BANK$/ });
  if (!(await folder.textContent())?.startsWith('▾')) await folder.click();
};

/** PAYROLL.EXE: `amount` paid to one player who is online, by the names the window gives its boxes (8n2). */
export const payPlayer = async (page: Page, username: string, amount: number) => {
  await bankFolder(page);
  await page.getByRole('button', { name: 'PAY_PLAYERS', exact: true }).click();
  const pay = page.locator('.win95-window', { has: page.getByText('PAYROLL.EXE', { exact: true }) });
  await pay.getByLabel('Total amount').fill(String(amount));
  await pay.getByRole('checkbox', { name: username }).check();
  await pay.getByRole('button', { name: 'PAY_SELECTED' }).click();
  await expect(pay).toHaveCount(0);
};

/**
 * The GM's catalogue for a custom system, from DOWNLOAD ITEMS as a GM would: each of the system's items priced as `prices`
 * says, and `extra` lines added on the same shelf. Saved, and the window shut.
 */
export const saveItemsCatalogue = async (page: Page, prices: Record<string, number>, extra: string) => {
  await openGameSystem(page);
  await page.getByRole('button', { name: 'SHOP_CATALOGUES', exact: true }).click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'DOWNLOAD ITEMS', exact: true }).click()]);
  let text = await readFile(await download.path(), 'utf8');
  for (const [name, price] of Object.entries(prices)) text = text.replace(new RegExp(`^${name}\\s*,\\s*,`, 'm'), `${name}, ${price},`);
  await page.getByLabel('Catalogue text').fill(`${text}${extra}`);
  await page.getByRole('button', { name: 'PREVIEW', exact: true }).click();
  await expect(page.getByText(/^\d+ ROWS? READ/)).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'SAVE', exact: true }).click();
  await expect(page.getByText(/^Saved: .* The shops have it now\.$/)).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press('Escape');
};
