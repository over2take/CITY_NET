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
      // A GEAR thing to wear (G3): worn, it is on you, so EQUIPPED though GEAR is PACK.
      list: [{ id: 'cloak', label: 'Cloak', type: 'gear', needs: 'worn', features: [] }],
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
  await expect(band('STASH').getByRole('button', { name: 'Sword, item 1', exact: true })).toBeVisible();
  await expect(band('STASH').getByText('WEAPONS', { exact: true })).toBeVisible();
  await expect(head('EQUIPPED')).toHaveText('▾ EQUIPPED · 0');

  // One line a thing (G3): the Draught's HEALS is blank, so FILL IN, which opens its card at that box, ready to type.
  const draught = mine.getByTestId('gear-line-1');
  await expect(draught.getByRole('group', { name: 'Item 2 columns' })).toHaveCount(0);
  await draught.getByRole('button', { name: 'Fill in item 2: HEALS', exact: true }).click();
  await expect(draught.getByLabel('Item 2 HEALS', { exact: true })).toBeFocused();
  await mine.keyboard.type('2d4');
  await draught.getByRole('button', { name: 'DONE', exact: true }).click();
  await expect(draught.getByRole('note', { name: 'Item 2 HEALS: 2d4' })).toBeVisible();
  await expect(draught.getByRole('button', { name: /^Fill in/ })).toHaveCount(0);
  await expect.poll(async () => JSON.parse(String((await sheetOf()).inventory ?? '[]'))[1]?.values, { timeout: 15_000 }).toEqual({ heals: '2d4' });

  // USABLE closed by its head; still closed after a reload.
  await head('USABLE').click();
  await expect(head('USABLE')).toHaveAttribute('aria-expanded', 'false');
  await expect(band('USABLE').getByRole('button', { name: 'Draught, item 2', exact: true })).toHaveCount(0);
  await expect.poll(async () => JSON.parse(String((await sheetOf()).inventory ?? '[]'))[0]?.carry, { timeout: 15_000 }).toBe('stash');
  // A fresh visit, signed in again: which bands are closed is kept in this browser.
  await signInAsPlayer(mine, player);
  await mine.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true }).click();
  await mine.getByRole('button', { name: 'CHARACTER_SHEET', exact: true }).click();
  await sheetTab(mine, 'GEAR');
  await expect(head('USABLE')).toHaveAttribute('aria-expanded', 'false');
  await expect(head('PACK')).toHaveAttribute('aria-expanded', 'true');

  // FIND (G4): always there; 2d4 finds the Draught in USABLE, closed, opened while it shows; cleared, USABLE closed again.
  const find = mine.getByRole('searchbox', { name: 'Find in your gear' });
  await find.fill('2d4');
  await expect(head('USABLE')).toHaveText('▾ USABLE · 1');
  await expect(band('USABLE').getByRole('button', { name: 'Draught, item 2', exact: true })).toBeVisible();
  await expect(head('PACK')).toHaveText('▾ PACK · 0');
  await find.fill('lantern');
  await expect(mine.getByRole('status', { name: 'What FIND found' })).toHaveText('Nothing on this sheet matches “lantern”.');
  await find.fill('');
  await expect(head('USABLE')).toHaveAttribute('aria-expanded', 'false');
  await expect(head('USABLE')).toHaveText('▸ USABLE · 1');

  // A Cloak, GEAR, in PACK; worn, EQUIPPED; taken off, PACK again (G3: "my Cutlass is worn, should it be in EQUIPPED?").
  await add.getByRole('button', { name: 'Add a Gear by hand' }).click();
  await mine.getByLabel('Item 4 name', { exact: true }).fill('Cloak');
  await expect(band('PACK').getByRole('button', { name: 'Cloak, item 4', exact: true })).toBeVisible();
  // EQUIPPED closed, the Cloak worn: its head lights up with the count (G3), and opened shows it.
  await head('EQUIPPED').click();
  await mine.getByTestId('gear-item-cloak').getByRole('button', { name: 'WEAR Cloak', exact: true }).click();
  await expect(head('EQUIPPED')).toHaveText('▸ EQUIPPED · 1', { timeout: 15_000 });
  await expect(head('EQUIPPED')).toHaveClass('gear-band-news');
  await head('EQUIPPED').click();
  await expect(head('EQUIPPED')).not.toHaveClass('gear-band-news');
  await expect(band('EQUIPPED').getByRole('button', { name: 'Cloak, item 4', exact: true })).toBeVisible();
  await mine.getByTestId('gear-item-cloak').getByRole('button', { name: /^WORN/ }).click();
  await expect(band('PACK').getByRole('button', { name: 'Cloak, item 4', exact: true })).toBeVisible({ timeout: 15_000 });
  await context.close();
});
