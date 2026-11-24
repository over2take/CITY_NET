import { test, expect } from '@playwright/test';
import { signInAsPlayer, gmToken, asGm, runningSystem, approvedPlayer, sheetTab } from './helpers';

// A hit carries its type (8b2a; approved mockup docs/mockups/damage-pipeline.html, section 2, answered 2026-11-23: the item
// carries it, "2d6 FIRE DMG"). On the player's GEAR: a Torch made by hand with "2d6 fire dmg" typed in, read on this
// character and rolled, the log saying FIRE; a line named Flame Tongue rolling its item's "1d8 SLASHING + 2d6 FIRE DMG", the
// log saying each part and the whole.

test('a typed DAMAGE at the table: a Torch\'s FIRE, and a Flame Tongue\'s SLASHING + FIRE, read and rolled, the log saying each (8b2a)', async ({ browser, request }, info) => {
  test.setTimeout(120_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const gm = await gmToken(request);
  await runningSystem(request, gm, {
    format: 1, name: `Emberline${again}`, core: { health: { model: 'pool' } },
    stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }] }],
    items: {
      types: [{ id: 'weapons', label: 'WEAPONS', one: 'Weapon', columns: [{ id: 'damage', label: 'DAMAGE', kind: 'damage' }] }],
      list: [{ id: 'tongue', label: 'Flame Tongue', type: 'weapons', values: { damage: '1d8 SLASHING + 2d6 FIRE DMG' } }],
    },
  });
  const player = { username: `e2e_emberline${again}`, password: 'e2e-player-password' };
  await approvedPlayer(request, gm, player);
  const sheetOf = async () => (await asGm(request, gm, 'get', `/api/sheets/user/${player.username}`)).data;

  const context = await browser.newContext({ baseURL: info.project.use.baseURL });
  const mine = await context.newPage();
  await signInAsPlayer(mine, player);
  await mine.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true }).click();
  await mine.getByRole('button', { name: 'CHARACTER_SHEET', exact: true }).click();
  await sheetTab(mine, 'GEAR');
  const weapons = mine.getByRole('region', { name: 'WEAPONS gear' });
  const add = mine.getByRole('group', { name: 'Add by hand' });

  // A Torch, its own DAMAGE with its type, read on this character.
  await add.getByRole('button', { name: 'Add a Weapon by hand' }).click();
  await weapons.getByLabel('Item 1 name', { exact: true }).fill('Torch');
  await weapons.getByLabel('Item 1 DAMAGE', { exact: true }).fill('2d6 fire dmg');
  await expect(weapons.getByRole('status', { name: 'Item 1 DAMAGE on this character' })).toContainText('2 to 12', { timeout: 15_000 });
  await expect.poll(async () => JSON.parse(String((await sheetOf()).inventory ?? '[]'))[0]?.values?.damage, { timeout: 15_000 }).toBe('2d6 fire dmg');
  await weapons.getByRole('button', { name: 'DONE', exact: true }).click();

  // A line named Flame Tongue: its item's DAMAGE, two parts.
  await add.getByRole('button', { name: 'Add a Weapon by hand' }).click();
  await weapons.getByLabel('Item 2 name', { exact: true }).fill('Flame Tongue');
  await expect(weapons.getByLabel('Item 2 DAMAGE', { exact: true })).toHaveAttribute('placeholder', '1d8 SLASHING + 2d6 FIRE DMG');
  await expect(weapons.getByRole('status', { name: 'Item 2 DAMAGE on this character' })).toContainText('3 to 20', { timeout: 15_000 });
  await expect.poll(async () => JSON.parse(String((await sheetOf()).inventory ?? '[]'))[1]?.name, { timeout: 15_000 }).toBe('Flame Tongue');
  await weapons.getByRole('button', { name: 'DONE', exact: true }).click();

  // Each rolled: the log says the type, and each part with the whole.
  const tray = mine.getByText('DICE_TRAY.EXE', { exact: true });
  const history = mine.getByTestId('dice-history').locator('> div');
  await weapons.getByRole('button', { name: 'Roll Item 1 DAMAGE' }).click();
  await expect(tray).toBeVisible({ timeout: 15_000 });
  await mine.getByTitle('TOGGLE_HISTORY').click();
  await expect(history.filter({ hasText: /rolled Torch DAMAGE 2d6 fire dmg \[\(\d+, \d+\)\] = \d+ FIRE DMG$/ }).last()).toBeVisible({ timeout: 15_000 });
  await mine.keyboard.press('Escape');
  await expect(tray).toBeHidden();
  await weapons.getByRole('button', { name: 'Roll Item 2 DAMAGE' }).click();
  await expect(tray).toBeVisible({ timeout: 15_000 });
  await mine.getByTitle('TOGGLE_HISTORY').click();
  await expect(history.filter({ hasText: /rolled Flame Tongue DAMAGE 1d8 SLASHING \+ 2d6 FIRE DMG \[\d+\] \+ \[\(\d+, \d+\)\] = \d+ SLASHING \+ \d+ FIRE DMG \(\d+\)$/ }).last())
    .toBeVisible({ timeout: 15_000 });
  await context.close();
});
