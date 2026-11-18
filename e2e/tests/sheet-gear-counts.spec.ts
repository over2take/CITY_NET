import { test, expect } from '@playwright/test';
import { signInAsPlayer, gmToken, asGm, runningSystem, approvedPlayer, sheetTab } from './helpers';

// A gear line's COUNT at the table (8a4; approved mockups docs/mockups/item-types.html, decision 5, and gear-compact.html,
// decision 6): the Pistol's "AMMO 2 / 6" with FIRE and RELOAD beside it. FIRE spends one; RELOAD, with Pistol Rounds and
// AP Rounds both carried, asks which and takes from the AP Rounds until they're gone, then from the Pistol Rounds alone
// until full. The Wand's CHARGES has no RELOAD: a short rest from the sheet fills it. Set up through the API.

test('a COUNT at the table: FIRE spends one, RELOAD asks which and takes from the carried line, a rest refills (8a4)', async ({ browser, request }, info) => {
  test.setTimeout(120_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const gm = await gmToken(request);
  await runningSystem(request, gm, {
    format: 1, name: `Gunmetal${again}`, core: { health: { model: 'pool' } },
    stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }] }],
    resting: { finish: 'sheet' },
    items: {
      types: [
        { id: 'weapons', label: 'WEAPONS', one: 'Weapon', columns: [
          { id: 'ammo', label: 'AMMO', kind: 'count', button: 'FIRE', reload: ['rounds', 'ap'] },
          { id: 'charges', label: 'CHARGES', kind: 'count', refill: 'short_rest' }] },
        { id: 'gear', label: 'GEAR', one: 'Gear', columns: [{ id: 'weight', label: 'WEIGHT', kind: 'number', unit: 'LB' }] },
      ],
      list: [
        { id: 'pistol', label: 'Pistol', type: 'weapons', values: { ammo: 6 } },
        { id: 'wand', label: 'Wand', type: 'weapons', values: { charges: 3 } },
        { id: 'rounds', label: 'Pistol Rounds', type: 'gear' },
        { id: 'ap', label: 'AP Rounds', type: 'gear' },
      ],
    },
  });
  const player = { username: `e2e_gunner${again}`, password: 'e2e-player-password' };
  await approvedPlayer(request, gm, player);
  const line = (name: string, more: object = {}) => ({ name, qty: 1, enc: '', bundled: false, carry: 'stowed', location: '', ...more });
  const gear = async () => JSON.parse(String((await asGm(request, gm, 'get', `/api/sheets/user/${player.username}`)).data.inventory ?? '[]')) as { name: string; qty: number; counts?: Record<string, number> }[];

  const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width: 1280, height: 800 } });
  const mine = await context.newPage();
  await signInAsPlayer(mine, player);
  await mine.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true }).click();
  await mine.getByRole('button', { name: 'CHARACTER_SHEET', exact: true }).click();
  await mine.getByLabel('Might', { exact: true }).fill('12');
  // The sheet is made once opened; then the GM gives the gear, the sheet told it changed.
  await expect.poll(async () => (await request.get(`/api/sheets/user/${player.username}`, { headers: { Authorization: `Bearer ${gm}` } })).ok(), { timeout: 15_000 }).toBe(true);
  await asGm(request, gm, 'put', `/api/sheets/user/${player.username}`, { fields: { inventory: JSON.stringify([
    line('Pistol', { carry: 'readied', counts: { ammo: 2 } }), line('Pistol Rounds', { qty: 10 }), line('AP Rounds', { qty: 3 }), line('Wand', { counts: { charges: 1 } }),
  ]) } });
  await sheetTab(mine, 'GEAR');
  const pistol = mine.getByTestId('gear-line-0');
  await expect(pistol.getByRole('note', { name: 'Item 1 AMMO: 2 / 6' })).toBeVisible({ timeout: 15_000 });

  // FIRE: one spent, on the server and on the line.
  await pistol.getByRole('button', { name: 'FIRE Item 1 AMMO' }).click();
  await expect(pistol.getByRole('note', { name: 'Item 1 AMMO: 1 / 6' })).toBeVisible({ timeout: 15_000 });
  await expect.poll(async () => (await gear())[0].counts, { timeout: 15_000 }).toEqual({ ammo: 1 });

  // RELOAD with both carried: asked which, each with how many; the AP Rounds, all 3, gone once used up.
  await pistol.getByRole('button', { name: 'Reload Item 1 AMMO' }).click();
  const which = pistol.getByRole('group', { name: 'Item 1 reload AMMO from' });
  await expect(which.getByRole('button', { name: 'Pistol Rounds ×10' })).toBeVisible({ timeout: 15_000 });
  await which.getByRole('button', { name: 'AP Rounds ×3' }).click();
  await expect(pistol.getByRole('note', { name: 'Item 1 AMMO: 4 / 6' })).toBeVisible({ timeout: 15_000 });
  await expect.poll(async () => (await gear()).map((l) => l.name), { timeout: 15_000 }).toEqual(['Pistol', 'Pistol Rounds', 'Wand']);

  // RELOAD with the Pistol Rounds alone: no asking, as many as fit; full, RELOAD held.
  await pistol.getByRole('button', { name: 'Reload Item 1 AMMO' }).click();
  await expect(pistol.getByRole('note', { name: 'Item 1 AMMO: 6 / 6' })).toBeVisible({ timeout: 15_000 });
  await expect(pistol.getByRole('button', { name: 'Reload Item 1 AMMO' })).toBeDisabled();
  await expect.poll(async () => (await gear())[1].qty, { timeout: 15_000 }).toBe(8);

  // The Wand: CHARGES with no RELOAD, filled by a short rest from the sheet.
  const wand = mine.getByTestId('gear-line-2');
  await expect(wand.getByRole('note', { name: 'Item 3 CHARGES: 1 / 3' })).toBeVisible();
  await expect(wand.getByRole('button', { name: 'Reload Item 3 CHARGES' })).toHaveCount(0);
  await sheetTab(mine, 'STATS');
  await mine.getByRole('button', { name: /^REST/ }).click();
  await mine.getByRole('group', { name: 'Rests' }).getByRole('button', { name: 'SHORT REST' }).click();
  await mine.getByRole('group', { name: 'Take a Short rest?' }).getByRole('button', { name: 'REST' }).click();
  await expect.poll(async () => (await gear())[2].counts, { timeout: 15_000 }).toBeUndefined();
  await sheetTab(mine, 'GEAR');
  await expect(mine.getByTestId('gear-line-2').getByRole('note', { name: 'Item 3 CHARGES: 3 / 3' })).toBeVisible({ timeout: 15_000 });
  await context.close();
});
