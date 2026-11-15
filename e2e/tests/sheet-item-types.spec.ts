import { test, expect } from '@playwright/test';
import { signInAsPlayer, gmToken, asGm, runningSystem, approvedPlayer, sheetTab } from './helpers';

// The GEAR tab as a table per item type (8a3a; approved mockup docs/mockups/item-types.html, 2026-11-14): a WEAPONS table
// and a GEAR table; a stick made by hand, its DAMAGE and GRADE its own; a line named like the Pistol showing its values
// faint until typed over; a rope in GEAR; saved as made, and each in its table after a reload.

test('GEAR as a table per type: a stick made by hand, the Pistol\'s values under a line of its name, saved and kept (8a3a)', async ({ browser, request }, info) => {
  test.setTimeout(120_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const gm = await gmToken(request);
  await runningSystem(request, gm, {
    format: 1, name: `Armoryhold${again}`, core: { health: { model: 'pool' } },
    stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }] }],
    items: {
      types: [
        { id: 'gear', label: 'GEAR', one: 'Gear', columns: [{ id: 'weight', label: 'WEIGHT', kind: 'number', unit: 'LB' }] },
        { id: 'weapons', label: 'WEAPONS', one: 'Weapon', columns: [
          { id: 'damage', label: 'DAMAGE', kind: 'damage' }, { id: 'range', label: 'RANGE', kind: 'text' },
          { id: 'grade', label: 'GRADE', kind: 'pick', options: ['LIGHT', 'HEAVY'] }] },
      ],
      list: [{ id: 'pistol', label: 'Pistol', type: 'weapons', values: { damage: '2d6 + @might', range: '30 m', grade: 'LIGHT' } }],
    },
  });
  const player = { username: `e2e_armory${again}`, password: 'e2e-player-password' };
  await approvedPlayer(request, gm, player);
  const sheetOf = async () => (await asGm(request, gm, 'get', `/api/sheets/user/${player.username}`)).data;

  const context = await browser.newContext({ baseURL: info.project.use.baseURL });
  const mine = await context.newPage();
  await signInAsPlayer(mine, player);
  await mine.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true }).click();
  await mine.getByRole('button', { name: 'CHARACTER_SHEET', exact: true }).click();
  await mine.getByLabel('Might', { exact: true }).fill('12');
  await expect.poll(async () => (await sheetOf()).might, { timeout: 15_000 }).toBe(12);

  // A table per type, each empty with its own +.
  await sheetTab(mine, 'GEAR');
  const weapons = mine.getByRole('region', { name: 'WEAPONS gear' });
  const gear = mine.getByRole('region', { name: 'GEAR gear' });
  await expect(weapons.getByText('WEAPONS · 0')).toBeVisible();
  await expect(gear.getByText('GEAR · 0')).toBeVisible();

  // A stick, made by hand: its own DAMAGE and GRADE.
  await weapons.getByRole('button', { name: 'Add a Weapon by hand' }).click();
  await weapons.getByLabel('Item 1 name', { exact: true }).fill('A stick');
  await weapons.getByLabel('Item 1 DAMAGE', { exact: true }).fill('1d4');
  await weapons.getByLabel('Item 1 GRADE', { exact: true }).selectOption('HEAVY');

  // A line named like the Pistol: its values faint, until RANGE is typed over.
  await weapons.getByRole('button', { name: 'Add a Weapon by hand' }).click();
  await weapons.getByLabel('Item 2 name', { exact: true }).fill('Pistol');
  await expect(weapons.getByLabel('Item 2 DAMAGE', { exact: true })).toHaveAttribute('placeholder', '2d6 + @might');
  await weapons.getByLabel('Item 2 RANGE', { exact: true }).fill('50 m');

  // A rope, in GEAR.
  await gear.getByRole('button', { name: 'Add a Gear by hand' }).click();
  await gear.getByLabel('Item 3 name', { exact: true }).fill('Rope');
  await gear.getByLabel('Item 3 WEIGHT', { exact: true }).fill('10');

  const line = (name: string, more: object) => ({ name, qty: 1, enc: '', bundled: false, carry: 'stowed', location: '', ...more });
  await expect.poll(async () => JSON.parse(String((await sheetOf()).inventory ?? '[]')), { timeout: 15_000 }).toEqual([
    line('A stick', { type: 'weapons', values: { damage: '1d4', grade: 'HEAVY' } }),
    line('Pistol', { type: 'weapons', values: { range: '50 m' } }),
    line('Rope', { type: 'gear', values: { weight: 10 } }),
  ]);

  // Kept: after a reload, each in its table.
  await mine.reload();
  await signInAsPlayer(mine, player);
  await mine.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true }).click();
  await mine.getByRole('button', { name: 'CHARACTER_SHEET', exact: true }).click();
  await sheetTab(mine, 'GEAR');
  await expect(weapons.getByText('WEAPONS · 2')).toBeVisible({ timeout: 15_000 });
  await expect(gear.getByText('GEAR · 1')).toBeVisible();
  await expect(weapons.getByLabel('Item 2 RANGE', { exact: true })).toHaveValue('50 m');
  await context.close();
});
