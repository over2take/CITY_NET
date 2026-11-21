import { test, expect } from '@playwright/test';
import { readFile } from 'fs/promises';
import { signInAsGm, gmToken, runningSystem, openGameSystem, asGm } from './helpers';

// A catalogue file held against the game's own items (8a7a3c1; mockup docs/mockups/types-in-shops.html, answered 2026-11-21).
// A game whose WEAPONS sell themselves (a Pistol at 200, a Cutlass at 120) and a Ring of Might kept out of the shops: a file
// with the Pistol at 260, the Cutlass exactly as it is, the Ring and a Hand Cannon previews as WEAPONS ×2, ALSO ON SALE FROM
// ITEMS: 2 (1 overruled), the Pistol overruling 200 → 260, the Cutlass and the Ring left out and why; saved, DOWNLOAD CURRENT
// has the file's two lines and the game's items behind a #. With ADD NEW LINES TO ITEMS on (8a7a4a), the Hand Cannon becomes
// an item of WEAPONS in the builder's draft, priced 900, the running game untouched until a publish.

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
      { id: 'cutlass', label: 'Cutlass', type: 'weapons', values: { damage: '1d8', price: 120 } },
      { id: 'ring', label: 'Ring of Might', type: 'weapons', price: 5000, in_shops: false },
    ],
  },
});

test('a catalogue held against the game\'s items: one overruling, an exact copy and a ring kept out left out, saved (8a7a3c1)', async ({ page, request }, info) => {
  test.setTimeout(120_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const gm = await gmToken(request);
  const id = await runningSystem(request, gm, SYSTEM(`Itemfile${again}`));

  await page.setViewportSize({ width: 1280, height: 800 });
  await signInAsGm(page);
  await openGameSystem(page);
  await page.getByRole('button', { name: 'SHOP_CATALOGUES', exact: true }).click();

  await page.getByLabel('Catalogue text').fill([
    '[WEAPONS]',
    'name, price, damage',
    'Pistol, 260, 2d6',
    'Cutlass, 120, 1d8',
    'Ring of Might, 10, 1d4',
    'Hand Cannon, 900, 3d6',
  ].join('\n'));
  await page.getByRole('button', { name: 'PREVIEW', exact: true }).click();
  await expect(page.getByText('2 ROWS READ')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/^WEAPONS ×2/)).toBeVisible();
  await expect(page.getByTestId('catalogue-on-sale')).toHaveText('ALSO ON SALE FROM ITEMS: 2 (1 overruled by this file)');
  await expect(page.getByTestId('catalogue-overrules')).toHaveText('LINE 3 [WEAPONS] Pistol: overrules the item, 200 → 260 in the shops');
  await expect(page.getByTestId('catalogue-left-out')).toHaveText([
    'LINE 4 [WEAPONS] Cutlass: already on ITEMS at 120, the same in every column: left out, as it sells itself',
    'LINE 5 [WEAPONS] Ring of Might: kept out of the shops on ITEMS (IN SHOPS is off), so never sold: left out',
  ]);

  // ADD NEW LINES TO ITEMS: off to start; on, the Hand Cannon to be an item (the Pistol is one already).
  const into = page.getByTestId('catalogue-to-items');
  const toggle = into.getByRole('switch', { name: /ADD NEW LINES TO ITEMS/ });
  await expect(toggle).toHaveAttribute('aria-checked', 'false');
  await toggle.click();
  await expect(into.getByText('Hand Cannon becomes an item of WEAPONS, 900')).toBeVisible();
  await expect(into.getByText(/^ITEMS · 3 OF 200 → 4 OF 200/)).toBeVisible();

  await page.getByRole('button', { name: 'SAVE', exact: true }).click();
  await expect(page.getByText("Saved: WEAPONS ×2. The shops have it now. Hand Cannon added to ITEMS in the builder's draft: PUBLISH the system to keep it.")).toBeVisible({ timeout: 15_000 });
  const system = await asGm(request, gm, 'get', `/api/systems/${id}`);
  expect(system.draft.items.list.find((i: { label: string }) => i.label === 'Hand Cannon')).toEqual({ id: 'hand_cannon', label: 'Hand Cannon', type: 'weapons', values: { damage: '3d6', price: 900 }, in_shops: true });
  expect(system.published.items.list.map((i: { label: string }) => i.label)).toEqual(['Pistol', 'Cutlass', 'Ring of Might']);

  // On sale now: the file's two lines, and the game's own Cutlass behind a # (the Pistol's line stands in for its item).
  const [current] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'DOWNLOAD CURRENT', exact: true }).click()]);
  const now = await readFile(await current.path(), 'utf8');
  expect(now).toMatch(/^Pistol\s*, 260\s*, 2d6/m);
  expect(now).toMatch(/^Hand Cannon\s*, 900\s*, 3d6/m);
  expect(now).toMatch(/^# Cutlass\s*, 120\s*, 1d8/m);
  expect(now).not.toMatch(/Ring of Might/);
});
