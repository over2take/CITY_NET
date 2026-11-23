import { test, expect } from '@playwright/test';
import { signInAsGm, signInAsPlayer, gmToken, asGm, runningSystem, approvedPlayer, openGameSystem } from './helpers';
import { playerToken } from './shops';

// The shop under load in a real browser (8n3; the user, 2026-11-21: "a stress test for the store like having 1000+ items").
// A GUNS shelf of 1000 lines saved from SHOP_CATALOGUES; the player opens it (drawn 200 at a time, more on scrolling), filters
// it as they type and sorts it by PRICE both ways, each within a time limit with room for CI, the right rows each time across
// all 1000. The times are logged.

const SYSTEM = (name: string) => ({
  format: 1, name, core: { health: { model: 'pool' } },
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }] }],
  items: { types: [{ id: 'guns', label: 'GUNS', one: 'Gun', columns: [{ id: 'damage', label: 'DAMAGE', kind: 'damage' }, { id: 'ammo', label: 'AMMO', kind: 'count' }] }], list: [] },
});
const FILE = ['[GUNS]', 'name, price, damage, ammo', ...Array.from({ length: 1000 }, (_, i) => `Gun ${i}, ${10 + i}, 1d${4 + (i % 3) * 2}, ${i % 12}`)].join('\n');

test('a 1000-line shelf: saved, opened, filtered as typed and sorted both ways, each in time (8n3)', async ({ page, browser, request }, info) => {
  test.setTimeout(240_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const gm = await gmToken(request);
  await runningSystem(request, gm, SYSTEM(`Stressfall${again}`));
  const player = { username: `e2e_stressfall${again}`, password: 'e2e-player-password' };
  await approvedPlayer(request, gm, player);
  await playerToken(request, gm, player.username);
  const shop = `STRESS_GOODS${again}`;
  const made = await asGm(request, gm, 'post', '/api/locations', { name: shop, description: '', shape: 'box', x: 12, y: 0, z: 12, width: 2, height: 2, depth: 2 });
  const typed = await request.patch(`/api/locations/${made.data[0].id}/building-type`, { data: { building_type: 'general_store' }, headers: { Authorization: `Bearer ${gm}` } });
  expect(typed.ok(), await typed.text()).toBe(true);

  // The GM saves the 1000 lines.
  await page.setViewportSize({ width: 1280, height: 800 });
  await signInAsGm(page);
  await openGameSystem(page);
  await page.getByRole('button', { name: 'SHOP_CATALOGUES', exact: true }).click();
  await page.getByLabel('Catalogue text').fill(FILE);
  await page.getByRole('button', { name: 'PREVIEW', exact: true }).click();
  await expect(page.getByText('1000 ROWS READ')).toBeVisible({ timeout: 30_000 });
  await page.getByRole('button', { name: 'SAVE', exact: true }).click();
  await expect(page.getByText('Saved: GUNS ×1000. The shops have it now.')).toBeVisible({ timeout: 30_000 });

  // The player's store.
  const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width: 1280, height: 800 } });
  const mine = await context.newPage();
  await signInAsPlayer(mine, player);
  await mine.getByRole('button', { name: 'QUICK_ACCESS', exact: true }).click();
  const list = mine.locator('.quick-access-panel');
  await list.getByText(/DEFINED_STRUCTURES/).click();
  await list.getByText(shop, { exact: true }).click();
  await mine.getByRole('button', { name: 'SHOP', exact: true }).click();
  const window = mine.locator('.win95-window', { has: mine.getByText(`SHOP.EXE · ${shop}`, { exact: true }) });
  const rows = window.getByRole('button', { name: /^Add Gun \d+ to the cart$/ });
  const took: Record<string, number> = {};
  const time = async (name: string, work: () => Promise<unknown>) => { const t = Date.now(); await work(); took[name] = Date.now() - t; };

  await time('open', async () => { await window.getByRole('tab', { name: 'GUNS' }).click({ timeout: 30_000 }); await expect(rows).toHaveCount(200, { timeout: 30_000 }); });
  await expect(window.getByText('SHOWING 200 OF 1000 · SCROLL OR FILTER FOR THE REST')).toBeVisible();
  // Scrolled to the end of the page: 200 more.
  await time('scroll', async () => { await rows.last().scrollIntoViewIfNeeded(); await expect(rows).toHaveCount(400, { timeout: 30_000 }); });
  // Typed a key at a time, as a player does.
  await time('filter', async () => { await window.getByLabel('Find in this shop').pressSequentially('Gun 99'); await expect(rows).toHaveCount(19, { timeout: 30_000 }); }); // every word anywhere (8a7c2): 99, 199 to 899, 990 to 999
  await time('clear', async () => { await window.getByLabel('Find in this shop').fill(''); await expect(rows).toHaveCount(200, { timeout: 30_000 }); });
  const top = () => rows.first().getAttribute('aria-label');
  const before = await top();
  await time('sort', async () => { await window.getByLabel('Sort by PRICE').click(); await expect.poll(top, { timeout: 30_000 }).not.toBe(before); });
  const first = await top();
  await time('reverse', async () => { await window.getByLabel('Sort by PRICE').click(); await expect.poll(top, { timeout: 30_000 }).not.toBe(first); });
  expect([first, await top()].sort()).toEqual(['Add Gun 0 to the cart', 'Add Gun 999 to the cart']);
  console.log('shop stress in the browser (ms):', JSON.stringify(took));
  // Each step took under half a second on a desk (2026-11-21); CI is several times slower.
  for (const [step, ms] of Object.entries(took)) expect(ms, step).toBeLessThan(5_000);
  await context.close();
});
