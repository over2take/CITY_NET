import { test, expect } from '@playwright/test';
import { signInAsPlayer, gmToken, asGm, runningSystem, approvedPlayer, sheetTab } from './helpers';

// The GEAR tab in bands (G2; approved mockup docs/mockups/sheet-gear-layout.html, layout A): a game whose WEAPONS are
// EQUIPPED, POTIONS USABLE and GEAR unsaid (PACK). Things made by hand land in their bands, counted; a sword moved to the
// stash goes to the STASH band, which opens to show it; USABLE closed by its head stays closed on the next visit.

test('GEAR in bands: EQUIPPED, USABLE, PACK by type, a sword stashed into the STASH, a band closed and kept closed (G2)', async ({ browser, request }, info) => {
  test.setTimeout(120_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const gm = await gmToken(request);
  await runningSystem(request, gm, {
    format: 1, name: `Bandhold${again}`, core: { health: { model: 'pool' } },
    stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }] }],
    items: {
      types: [
        { id: 'gear', label: 'GEAR', one: 'Gear', columns: [{ id: 'weight', label: 'WEIGHT', kind: 'number', unit: 'LB' }] },
        { id: 'weapons', label: 'WEAPONS', one: 'Weapon', on_sheet: 'equipped', columns: [{ id: 'damage', label: 'DAMAGE', kind: 'damage' }] },
        { id: 'potions', label: 'POTIONS', one: 'Potion', on_sheet: 'usable', columns: [{ id: 'heals', label: 'HEALS', kind: 'dice' }] },
      ],
      list: [],
    },
  });
  const player = { username: `e2e_bandhold${again}`, password: 'e2e-player-password' };
  await approvedPlayer(request, gm, player);
  const sheetOf = async () => (await asGm(request, gm, 'get', `/api/sheets/user/${player.username}`)).data;

  const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width: 1280, height: 800 } });
  const mine = await context.newPage();
  await signInAsPlayer(mine, player);
  await mine.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true }).click();
  await mine.getByRole('button', { name: 'CHARACTER_SHEET', exact: true }).click();
  await sheetTab(mine, 'GEAR');

  // One of each, made by hand: each in its type's band.
  const add = mine.getByRole('group', { name: 'Add by hand' });
  const band = (label: string) => mine.getByRole('region', { name: `${label} band` });
  const head = (label: string) => band(label).getByRole('button', { name: new RegExp(`^[▸▾] ${label} · \\d+$`) });
  await add.getByRole('button', { name: 'Add a Weapon by hand' }).click();
  await mine.getByLabel('Item 1 name', { exact: true }).fill('Sword');
  await add.getByRole('button', { name: 'Add a Potion by hand' }).click();
  await mine.getByLabel('Item 2 name', { exact: true }).fill('Draught');
  await add.getByRole('button', { name: 'Add a Gear by hand' }).click();
  await mine.getByLabel('Item 3 name', { exact: true }).fill('Rope');
  await expect(head('EQUIPPED')).toHaveText('▾ EQUIPPED · 1');
  await expect(head('USABLE')).toHaveText('▾ USABLE · 1');
  await expect(head('PACK')).toHaveText('▾ PACK · 1');
  await expect(head('STASH')).toHaveText('▸ STASH · 0');
  await expect(band('USABLE').getByRole('region', { name: 'POTIONS gear' })).toBeVisible();
  await expect.poll(async () => JSON.parse(String((await sheetOf()).inventory ?? '[]')).map((l: { name: string }) => l.name), { timeout: 15_000 }).toEqual(['Sword', 'Draught', 'Rope']);

  // The sword to the stash: into the STASH band, opened to show it, its type said.
  await band('EQUIPPED').getByLabel('Item 1 carried', { exact: true }).selectOption('stash');
  await expect(head('STASH')).toHaveText('▾ STASH · 1');
  await expect(band('STASH').getByLabel('Item 1 name', { exact: true })).toHaveValue('Sword');
  await expect(band('STASH').getByText('WEAPONS', { exact: true })).toBeVisible();
  await expect(head('EQUIPPED')).toHaveText('▾ EQUIPPED · 0');

  // USABLE closed by its head; still closed after a reload.
  await head('USABLE').click();
  await expect(head('USABLE')).toHaveAttribute('aria-expanded', 'false');
  await expect(band('USABLE').getByLabel('Item 2 name', { exact: true })).toHaveCount(0);
  await expect.poll(async () => JSON.parse(String((await sheetOf()).inventory ?? '[]'))[0]?.carry, { timeout: 15_000 }).toBe('stash');
  // A fresh visit, signed in again: which bands are closed is kept in this browser.
  await signInAsPlayer(mine, player);
  await mine.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true }).click();
  await mine.getByRole('button', { name: 'CHARACTER_SHEET', exact: true }).click();
  await sheetTab(mine, 'GEAR');
  await expect(head('USABLE')).toHaveAttribute('aria-expanded', 'false');
  await expect(head('PACK')).toHaveAttribute('aria-expanded', 'true');
  await context.close();
});
