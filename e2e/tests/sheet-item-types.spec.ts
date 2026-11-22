import { test, expect } from '@playwright/test';
import { signInAsPlayer, gmToken, asGm, runningSystem, approvedPlayer, sheetTab } from './helpers';

// The GEAR tab as a table per item type (8a3a; approved mockup docs/mockups/item-types.html, 2026-11-14): a WEAPONS table
// and a GEAR table; a stick made by hand, its DAMAGE and GRADE its own; a line named like the Pistol showing its values
// faint until typed over; a rope in GEAR; saved as made, and each in its table after a reload.

test('GEAR as a table per type: a stick made by hand and its DAMAGE rolled, the Pistol\'s values under a line of its name, saved and kept (8a3a, 8a3b)', async ({ browser, request }, info) => {
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

  // In bands (G2): nothing carried yet, a + for each type in the row at the top.
  await sheetTab(mine, 'GEAR');
  const weapons = mine.getByRole('region', { name: 'WEAPONS gear' });
  const gear = mine.getByRole('region', { name: 'GEAR gear' });
  const add = mine.getByRole('group', { name: 'Add by hand' });
  await expect(mine.getByRole('region', { name: 'PACK band' }).getByText('Nothing here.')).toBeVisible();
  await expect(weapons).toHaveCount(0);

  // A stick, made by hand: its own DAMAGE and GRADE.
  await add.getByRole('button', { name: 'Add a Weapon by hand' }).click();
  await weapons.getByLabel('Item 1 name', { exact: true }).fill('A stick');
  await weapons.getByLabel('Item 1 DAMAGE', { exact: true }).fill('1d4');
  await weapons.getByLabel('Item 1 GRADE', { exact: true }).selectOption('HEAVY');

  // ROLL beside its DAMAGE (8a3b): rolled by the server into the log, said in the tray's history.
  await expect.poll(async () => JSON.parse(String((await sheetOf()).inventory ?? '[]'))[0]?.values?.damage, { timeout: 15_000 }).toBe('1d4');
  // A line made by hand opens under ✎ (8a3c1); DONE shows it as a compact line, ROLL beside its DAMAGE.
  await weapons.getByRole('button', { name: 'DONE', exact: true }).click();
  await expect(weapons.getByRole('note', { name: 'Item 1 DAMAGE: 1d4' })).toBeVisible();
  await weapons.getByRole('button', { name: 'Roll Item 1 DAMAGE' }).click();
  const tray = mine.getByText('DICE_TRAY.EXE', { exact: true });
  await expect(tray).toBeVisible({ timeout: 15_000 });
  await mine.getByTitle('TOGGLE_HISTORY').click();
  await expect(mine.getByTestId('dice-history').locator('> div').filter({ hasText: 'rolled A stick DAMAGE 1d4' }).last()).toBeVisible({ timeout: 15_000 });
  await mine.keyboard.press('Escape');
  await expect(tray).toBeHidden();

  // A line named like the Pistol: its values faint, until RANGE is typed over.
  await add.getByRole('button', { name: 'Add a Weapon by hand' }).click();
  await weapons.getByLabel('Item 2 name', { exact: true }).fill('Pistol');
  await expect(weapons.getByLabel('Item 2 DAMAGE', { exact: true })).toHaveAttribute('placeholder', '2d6 + @might');
  await weapons.getByLabel('Item 2 RANGE', { exact: true }).fill('50 m');

  // A rope, in GEAR.
  await add.getByRole('button', { name: 'Add a Gear by hand' }).click();
  await gear.getByLabel('Item 3 name', { exact: true }).fill('Rope');
  await gear.getByLabel('Item 3 WEIGHT', { exact: true }).fill('10');

  const line = (name: string, more: object) => ({ name, qty: 1, enc: '', bundled: false, carry: 'stowed', location: '', ...more });
  await expect.poll(async () => JSON.parse(String((await sheetOf()).inventory ?? '[]')), { timeout: 15_000 }).toEqual([
    line('A stick', { type: 'weapons', values: { damage: '1d4', grade: 'HEAVY' } }),
    // Its RANGE its own, not the item's 30 m: the Pistol made unique, the server noting who and when (G5a).
    line('Pistol', { type: 'weapons', values: { range: '50 m' }, changed: { range: { by: player.username, at: expect.any(String) } } }),
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
  await expect(weapons.getByRole('note', { name: 'Item 2 RANGE: 50 m' })).toBeVisible();
  // UNIQUE (G5b): its RANGE its own, so the line says so, with the item's and who changed it when on hover; counted at the top.
  const unique = weapons.getByRole('note', { name: 'Item 2 is unique' });
  await expect(unique).toHaveText('UNIQUE');
  await expect(unique).toHaveAttribute('title', new RegExp(`RANGE 50 m, the item's: 30 m · changed by ${player.username}, \\d{4}-\\d{2}-\\d{2}`));
  await expect(mine.getByRole('button', { name: '1 UNIQUE', exact: true })).toBeVisible();
  // Compact lines (8a3c1): in SHEET.EXE's width, nothing on the GEAR tab scrolls sideways.
  // The sheet and any box inside it (the old table scrolled in a box of its own).
  const sideways = await mine.locator('.sheet-scroll').evaluate((root) => [root, ...root.querySelectorAll('*')]
    .filter((el) => ['auto', 'scroll'].includes(getComputedStyle(el).overflowX) && el.scrollWidth > el.clientWidth + 1).length);
  expect(sideways).toBe(0);

  // Its DAMAGE under ✎ (8a3c2): what it reads on this character, as ROLL reads it (Might 12); a name the system hasn't
  // got, said as typed rather than skipped at the roll.
  // Its card opened by a click on its name (G3).
  await weapons.getByRole('button', { name: 'Pistol, item 2', exact: true }).click();
  const reads = weapons.getByRole('status', { name: 'Item 2 DAMAGE on this character' });
  await expect(reads).toHaveText('ON THIS CHARACTER: 2d6 + Might (12): 14 to 24', { timeout: 15_000 });
  await weapons.getByLabel('Item 2 DAMAGE', { exact: true }).fill('1d6 + @strength');
  await expect(reads).toHaveText("@STRENGTH ISN'T ONE OF THIS SYSTEM'S NAMES: IT WON'T ROLL", { timeout: 15_000 });
  // eˣ: INSERT puts in one of the system's names.
  await weapons.getByLabel('Item 2 DAMAGE', { exact: true }).fill('1d6');
  await weapons.getByRole('button', { name: 'Help writing Item 2 DAMAGE' }).click();
  await weapons.getByRole('group', { name: 'Help writing Item 2 DAMAGE' }).getByRole('button', { name: /^@might/ }).click();
  await expect(weapons.getByLabel('Item 2 DAMAGE', { exact: true })).toHaveValue('1d6 + @might');
  await expect(reads).toHaveText('ON THIS CHARACTER: 1d6 + Might (12): 13 to 18', { timeout: 15_000 });

  // THE ITEM'S (G5b): DAMAGE and RANGE each put back to the item's; no longer unique, saved as a plain Pistol.
  await weapons.getByRole('group', { name: 'Item 2 DAMAGE is unique' }).getByRole('button', { name: "Item 2 DAMAGE: the item's" }).click();
  await expect(weapons.getByLabel('Item 2 DAMAGE', { exact: true })).toHaveValue('');
  await weapons.getByRole('group', { name: 'Item 2 RANGE is unique' }).getByRole('button', { name: "Item 2 RANGE: the item's" }).click();
  await expect(unique).toHaveCount(0);
  await expect(mine.getByRole('button', { name: /UNIQUE$/ })).toHaveCount(0);
  await expect.poll(async () => JSON.parse(String((await sheetOf()).inventory ?? '[]'))[1], { timeout: 15_000 }).toEqual(line('Pistol', { type: 'weapons' }));
  await context.close();
});
