import { test, expect } from '@playwright/test';
import { signInAsGm, signInAsPlayer, gmToken, asGm, runningSystem, approvedPlayer, sheetTab } from './helpers';

// WHAT EACH LEVEL GAINED (7d7b2; approved mockup docs/mockups/level-record.html, 2026-11-09): the record on CHARACTER,
// under the class picks, for the player and the GM. The GM clears a past level's roll, the player rolls it again on
// their sheet, the maximum follows, and the GM sets one outright.

test('the record: the GM clears a past roll, the player rolls it again, the maximum follows; the GM sets one (7d7b2)', async ({ page, browser, request }, info) => {
  test.setTimeout(180_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const gm = await gmToken(request);
  await runningSystem(request, gm, {
    format: 1, name: `Recordfall${again}`, core: { health: { model: 'pool' }, advancement: ['levels'] },
    choices: [{ id: 'classes', one: 'Class', many: 'Classes', levelled: true, options: [{ id: 'soldier', label: 'Soldier', die: 10 }] }],
    levels: { top: 5, first: 100, ranges: [{ to: 5, x: 2 }], health: { how: 'level', gain: 'roll' } },
  });
  const player = { username: `e2e_recorded${again}`, password: 'e2e-player-password' };
  await approvedPlayer(request, gm, player);
  const sheetOf = async () => (await asGm(request, gm, 'get', `/api/sheets/user/${player.username}`)).data;

  // The player picks a class, and stays signed in, so the GM's chat lists them.
  const context = await browser.newContext({ baseURL: info.project.use.baseURL });
  const mine = await context.newPage();
  await signInAsPlayer(mine, player);
  await mine.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true }).click();
  await mine.getByRole('button', { name: 'CHARACTER_SHEET', exact: true }).click();
  await sheetTab(mine, 'CHARACTER');
  await mine.getByRole('group', { name: 'Pick a Class' }).getByRole('button', { name: 'SOLDIER' }).click();
  await expect.poll(async () => (await sheetOf())._choices?.classes?.length, { timeout: 15_000 }).toBe(1);

  // The GM takes them to level 2 with a roll, kept.
  await signInAsGm(page);
  await page.getByRole('button', { name: 'GLOBAL_CHAT', exact: true }).click();
  await page.getByText(player.username, { exact: true }).first().click();
  await page.getByRole('button', { name: 'VIEW_PLAYER_INFO', exact: true }).click();
  await page.getByRole('button', { name: 'OPEN_SHEET', exact: true }).click();
  await page.getByRole('group', { name: 'Their level' }).getByRole('button', { name: 'FILL IT IN FOR THEM' }).click();
  await page.getByRole('button', { name: 'ROLL D10', exact: true }).click();
  await expect(page.getByText('Rolled, and kept. Your GM can clear it for another go.')).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'NEXT', exact: true }).click();
  await page.getByRole('button', { name: 'FINISH', exact: true }).click();
  await expect.poll(async () => (await sheetOf())._health_levels?.[2]?.rolled, { timeout: 15_000 }).toBe(true);

  // On their sheet, the record, folded shut: the GM clears level 2's roll.
  await sheetTab(page, 'CHARACTER');
  const theirs = page.getByRole('region', { name: 'What each level gained' });
  await theirs.getByRole('button', { name: /^LEVELS · 2 · MAX HEALTH \d+ · WHAT EACH GAINED$/ }).click();
  await expect(theirs.getByRole('group', { name: 'Level 1' }).getByText('THE FULL D10')).toBeVisible();
  await theirs.getByRole('button', { name: "Clear level 2's roll" }).click();
  await expect.poll(async () => (await sheetOf())._health_levels?.[2]?.cleared, { timeout: 15_000 }).toBe(true);
  await expect(theirs.getByText('TO ROLL AGAIN: THE PLAYER ROLLS IT ON THEIR SHEET')).toBeVisible({ timeout: 15_000 });
  // Till it's rolled, the average: 10 and 5.
  await expect.poll(async () => (await sheetOf())._health?.max, { timeout: 15_000 }).toBe(15);

  // The player rolls it again on their sheet: kept, and the maximum follows. The GM's roll, in their name, opened
  // their dice tray over the sheet: shut first, as they would.
  const tray = mine.locator('.win95-window', { has: mine.getByText('DICE_TRAY.EXE', { exact: true }) });
  if (await tray.isVisible()) await tray.getByRole('button', { name: '×', exact: true }).click();
  await expect(tray).toBeHidden();
  const record = mine.getByRole('region', { name: 'What each level gained' });
  await record.getByRole('button', { name: /WHAT EACH GAINED$/ }).click();
  await record.getByRole('group', { name: 'Level 2' }).getByRole('button', { name: 'ROLL D10' }).click();
  await expect.poll(async () => (await sheetOf())._health_levels?.[2]?.rolled, { timeout: 15_000 }).toBe(true);
  const rolled = (await sheetOf())._health_levels[2].took as number;
  expect(rolled).toBeGreaterThanOrEqual(1);
  expect(rolled).toBeLessThanOrEqual(10);
  await expect.poll(async () => (await sheetOf())._health?.max, { timeout: 15_000 }).toBe(10 + rolled);
  await expect(record.getByRole('group', { name: 'Level 2' }).getByText(`ROLLED ${rolled}`, { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(record.getByLabel('Max health')).toHaveText(String(10 + rolled));
  // A second roll is the GM's to allow.
  await expect(record.getByRole('group', { name: 'Level 2' }).getByRole('button', { name: 'ROLL D10' })).toHaveCount(0);

  // The GM sets it outright: the die's part, the player's record saying so.
  await theirs.getByLabel("Level 2: set the die's part to").fill('7');
  await theirs.getByRole('button', { name: 'Set level 2' }).click();
  await expect.poll(async () => (await sheetOf())._health_levels?.[2], { timeout: 15_000 }).toEqual({ die: 10, took: 7, set: true });
  await expect.poll(async () => (await sheetOf())._health?.max, { timeout: 15_000 }).toBe(17);
  await expect(record.getByText('SET TO 7 BY THE GM')).toBeVisible({ timeout: 15_000 });
  await context.close();
});
