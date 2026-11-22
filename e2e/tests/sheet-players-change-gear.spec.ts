import { test, expect } from '@playwright/test';
import { signInAsPlayer, gmToken, asGm, runningSystem, approvedPlayer, sheetTab } from './helpers';

// PLAYERS CHANGE GEAR (G6a, G6b; decided 2026-11-20, all A, the user: "the GM can still open, view and change things"): the
// GAME tab's switch off at the table, a player's GEAR card shows the Cutlass's DAMAGE but can't change it, and says so; the
// GM changes it on their sheet, which the player sees as UNIQUE, changed by the GM; on again, the player changes it.
// The table's settings are shared by the tests in a part: switched back on whatever happens.

test('PLAYERS CHANGE GEAR off: the player\'s DAMAGE shown not changed, the GM changes it, on again the player does (G6)', async ({ browser, request }, info) => {
  test.setTimeout(120_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const gm = await gmToken(request);
  await runningSystem(request, gm, {
    format: 1, name: `Gearlock${again}`, core: { health: { model: 'pool' } },
    stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }] }],
    items: {
      types: [{ id: 'weapons', label: 'WEAPONS', one: 'Weapon', on_sheet: 'equipped', columns: [{ id: 'damage', label: 'DAMAGE', kind: 'damage' }] }],
      list: [{ id: 'cutlass', label: 'Cutlass', type: 'weapons', values: { damage: '1d8' } }],
    },
  });
  const player = { username: `e2e_gearlock${again}`, password: 'e2e-player-password' };
  await approvedPlayer(request, gm, player);
  const sheetOf = async () => (await asGm(request, gm, 'get', `/api/sheets/user/${player.username}`)).data;
  const setting = (value: string) => asGm(request, gm, 'post', '/api/settings', { key: 'players_change_gear', value });

  const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width: 1280, height: 800 } });
  const mine = await context.newPage();
  try {
    await signInAsPlayer(mine, player);
    await mine.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true }).click();
    await mine.getByRole('button', { name: 'CHARACTER_SHEET', exact: true }).click();
    await sheetTab(mine, 'GEAR');
    await mine.getByRole('group', { name: 'Add by hand' }).getByRole('button', { name: 'Add a Weapon by hand' }).click();
    await mine.getByLabel('Item 1 name', { exact: true }).fill('Cutlass');
    await expect.poll(async () => JSON.parse(String((await sheetOf()).inventory ?? '[]'))[0]?.name, { timeout: 15_000 }).toBe('Cutlass');
    const card = mine.getByRole('group', { name: 'Item 1 columns' });
    const damage = card.getByLabel('Item 1 DAMAGE', { exact: true });
    await expect(damage).toHaveAttribute('placeholder', '1d8');
    await expect(damage).not.toHaveAttribute('readonly', /.*/);

    // Off: the card shows DAMAGE, can't change it, says so; the name is still theirs.
    await setting('0');
    await expect(card.getByRole('note', { name: 'Item 1 columns' })).toHaveText('ONLY THE GM CHANGES THESE AT THIS TABLE', { timeout: 15_000 });
    await expect(damage).toHaveAttribute('readonly', /.*/);
    await expect(card.getByLabel('Item 1 name', { exact: true })).not.toHaveAttribute('readonly', /.*/);

    // The GM, on the player's sheet, makes it 2d8: the player sees it UNIQUE, changed by the GM.
    await asGm(request, gm, 'put', `/api/sheets/user/${player.username}`, {
      fields: { inventory: JSON.stringify([{ name: 'Cutlass', qty: 1, enc: '', bundled: false, carry: 'stowed', location: '', values: { damage: '2d8' } }]) },
    });
    const line = mine.getByTestId('gear-line-0');
    await expect(line.getByRole('note', { name: 'Item 1 is unique' })).toHaveAttribute('title', /DAMAGE 2d8, the item's: 1d8 · changed by the GM, /, { timeout: 15_000 });

    // On again: the player changes it.
    await setting('1');
    await expect(card.getByRole('note', { name: 'Item 1 columns' })).toHaveCount(0, { timeout: 15_000 });
    await damage.fill('3d8');
    await expect.poll(async () => JSON.parse(String((await sheetOf()).inventory ?? '[]'))[0]?.values?.damage, { timeout: 15_000 }).toBe('3d8');
  } finally {
    await setting('1');
    await context.close();
  }
});
