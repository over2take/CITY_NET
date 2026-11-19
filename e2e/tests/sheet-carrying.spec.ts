import { test, expect } from '@playwright/test';
import { signInAsPlayer, gmToken, asGm, runningSystem, approvedPlayer, sheetTab } from './helpers';

// CARRYING at the top of GEAR (8a6a; approved mockup docs/mockups/carrying-on-sheet.html, A; the user: "I like A and yes to
// all"): Might 5 can carry 50 LB; three Packs, 30 LB, are ENCUMBERED, with the band's words and SLOWED on the token said under
// the meter. One Pack stashed: 20 LB, LIGHT, SLOWED off again. Set up through the API.

test('CARRYING on GEAR: 30 / 50 LB ENCUMBERED with SLOWED on, a Pack stashed and it is LIGHT (8a6a)', async ({ browser, request }, info) => {
  test.setTimeout(120_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const gm = await gmToken(request);
  await runningSystem(request, gm, {
    format: 1, name: `Packmule${again}`, core: { health: { model: 'pool' } },
    stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }] }],
    conditions: { slowed: { name: 'Slowed', icon: 'snail' } },
    items: {
      types: [{ id: 'gear', label: 'GEAR', one: 'Gear', columns: [{ id: 'weight', label: 'WEIGHT', kind: 'number', unit: 'LB' }] }],
      list: [{ id: 'pack', label: 'Pack', type: 'gear', values: { weight: 10 } }],
      encumbrance: {
        column: 'weight', unit: 'LB', capacity: '@might * 10',
        bands: [{ word: 'LIGHT', upto: 50 }, { word: 'ENCUMBERED', upto: 100, says: 'Speed -10 ft.', condition: 'slowed' }],
        past: 'OVERLOADED',
      },
    },
  });
  const player = { username: `e2e_mule${again}`, password: 'e2e-player-password' };
  await approvedPlayer(request, gm, player);
  await asGm(request, gm, 'post', '/api/locations', {
    name: player.username, description: '', shape: 'rhombus', owner: player.username, x: 0, y: 0, z: 0, width: 1, height: 1, depth: 1,
    hp_current: 10, hp_max: 10, hp_temp: 0, battle_map_id: -1, floor_index: -1,
  });
  const line = (name: string, more: object = {}) => ({ name, qty: 1, enc: '', bundled: false, carry: 'stowed', location: '', ...more });

  const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width: 1280, height: 800 } });
  const mine = await context.newPage();
  await signInAsPlayer(mine, player);
  await mine.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true }).click();
  await mine.getByRole('button', { name: 'CHARACTER_SHEET', exact: true }).click();
  await mine.getByLabel('Might', { exact: true }).fill('5');
  await expect.poll(async () => (await asGm(request, gm, 'get', `/api/sheets/user/${player.username}`)).data.might, { timeout: 15_000 }).toBe(5);
  // The GM gives three Packs, one to a line; the player's own save counts them.
  await asGm(request, gm, 'put', `/api/sheets/user/${player.username}`, { fields: { inventory: JSON.stringify([line('Pack'), line('Pack'), line('Pack')]) } });
  await sheetTab(mine, 'GEAR');
  await mine.getByLabel('Item 3 carried').selectOption('readied');

  const block = mine.getByTestId('sheet-carrying');
  await expect(block).toContainText('CARRYING 30 / 50 LB', { timeout: 15_000 });
  await expect(block.getByTestId('sheet-carrying-band')).toHaveText('ENCUMBERED');
  await expect(block.getByRole('meter', { name: 'Carrying' })).toHaveAttribute('aria-valuetext', '30 of 50 LB, ENCUMBERED');
  await expect(block).toContainText('LIGHT ≤ 25 · ENCUMBERED ≤ 50 · OVERLOADED');
  await expect(block).toContainText('Speed -10 ft.');
  await expect(block.getByTestId('sheet-carrying-condition')).toHaveText('SLOWED ON WHILE ENCUMBERED', { timeout: 15_000 });

  // One stashed: 20 LB, LIGHT, and the band takes SLOWED off.
  await mine.getByLabel('Item 1 carried').selectOption('stash');
  await expect(block).toContainText('CARRYING 20 / 50 LB', { timeout: 15_000 });
  await expect(block.getByTestId('sheet-carrying-band')).toHaveText('LIGHT');
  await expect(block.getByTestId('sheet-carrying-condition')).toHaveCount(0, { timeout: 15_000 });
  await expect(block).not.toContainText('Speed -10 ft.');
  await context.close();
});
