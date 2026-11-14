import { test, expect } from '@playwright/test';
import { signInAsGm, signInAsPlayer, gmToken, asGm, runningSystem, approvedPlayer, sheetTab } from './helpers';

// WHAT EACH LEVEL GAINED (7d7b2; approved mockup docs/mockups/level-record.html, 2026-11-09): the record on CHARACTER,
// under the class picks, for the player and the GM. The GM clears a past level's roll, the player rolls it again on
// their sheet, the maximum follows, and the GM sets one outright. An uploaded sheet's HP MAX (7d7c) is the base for the
// levels it has, one line in the record, which the GM clears.

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

test('an uploaded sheet\'s HP MAX is the base for its levels, one line in the record; the GM clears it (7d7c)', async ({ page, browser, request }, info) => {
  test.setTimeout(180_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const gm = await gmToken(request);
  await runningSystem(request, gm, {
    format: 1, name: `Uploadrecordfall${again}`, core: { health: { model: 'pool' }, advancement: ['levels'] },
    choices: [{ id: 'classes', one: 'Class', many: 'Classes', levelled: true, options: [{ id: 'soldier', label: 'Soldier', die: 10 }] }],
    levels: { top: 5, first: 100, ranges: [{ to: 5, x: 2 }], health: { how: 'level', gain: 'roll' } },
  });
  const player = { username: `e2e_uploadedmax${again}`, password: 'e2e-player-password' };
  await approvedPlayer(request, gm, player);
  const sheetOf = async () => (await asGm(request, gm, 'get', `/api/sheets/user/${player.username}`)).data;

  // The JSON template asks for it, under the token's maximum's own label.
  const template = await (await request.get('/api/sheets/import/template.json')).json();
  expect(template.fields._health_base).toBeNull();
  expect(template.help._health_base).toBe('HP MAX. Their maximum now, for the levels they have. Left empty, each level counts as here');

  // The player uploads a Soldier 3 with HP MAX 31: the base, and the maximum it comes to (no token here: the server's
  // tests move one).
  const context = await browser.newContext({ baseURL: info.project.use.baseURL });
  const mine = await context.newPage();
  await signInAsPlayer(mine, player);
  await mine.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true }).click();
  await mine.getByRole('button', { name: 'CHARACTER_SHEET', exact: true }).click();
  await mine.getByRole('button', { name: 'IMPORT', exact: true }).click();
  await mine.getByRole('textbox', { name: 'Paste JSON or a stat block' }).fill(JSON.stringify({ name: 'Wren', Class: 'Soldier', 'Class level': 3, 'HP MAX': 31 }));
  await mine.getByRole('button', { name: 'PREVIEW', exact: true }).click();
  await mine.getByRole('button', { name: /REPLACE SHEET WITH/ }).click();
  await expect(mine.getByRole('button', { name: '✓ APPLIED' })).toBeVisible({ timeout: 15_000 });
  await mine.getByRole('button', { name: 'CLOSE', exact: true }).click();
  await expect.poll(async () => (await sheetOf())._health_base, { timeout: 15_000 }).toEqual({ max: 31, level: 3 });
  await expect.poll(async () => (await sheetOf())._health?.max, { timeout: 15_000 }).toBe(31);

  // Their record: one line for levels 1 to 3, nothing to press.
  await sheetTab(mine, 'CHARACTER');
  const record = mine.getByRole('region', { name: 'What each level gained' });
  await record.getByRole('button', { name: /^LEVELS · 3 · MAX HEALTH 31 · WHAT EACH GAINED$/ }).click();
  const line = record.getByRole('group', { name: 'Uploaded maximum' });
  await expect(line.getByText('L1–3 · HEALTH 31')).toBeVisible();
  await expect(line.getByRole('button')).toHaveCount(0);
  await expect(record.getByRole('group', { name: 'Level 2' })).toHaveCount(0);

  // The GM clears it: each level counted as here.
  await signInAsGm(page);
  await page.getByRole('button', { name: 'GLOBAL_CHAT', exact: true }).click();
  await page.getByText(player.username, { exact: true }).first().click();
  await page.getByRole('button', { name: 'VIEW_PLAYER_INFO', exact: true }).click();
  await page.getByRole('button', { name: 'OPEN_SHEET', exact: true }).click();
  await sheetTab(page, 'CHARACTER');
  const theirs = page.getByRole('region', { name: 'What each level gained' });
  await theirs.getByRole('button', { name: /WHAT EACH GAINED$/ }).click();
  await theirs.getByRole('button', { name: 'Clear the uploaded maximum' }).click();
  await expect.poll(async () => '_health_base' in (await sheetOf()), { timeout: 15_000 }).toBe(false);
  await expect.poll(async () => (await sheetOf())._health?.max, { timeout: 15_000 }).not.toBe(31);
  const max = (await sheetOf())._health.max as number;
  await expect(record.getByLabel('Max health')).toHaveText(String(max), { timeout: 15_000 });
  await expect(record.getByRole('group', { name: 'Uploaded maximum' })).toHaveCount(0, { timeout: 15_000 });
  await expect(record.getByRole('group', { name: 'Level 1' }).getByText('THE FULL D10')).toBeVisible();
  await context.close();
});
