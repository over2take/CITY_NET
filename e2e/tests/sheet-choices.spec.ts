import { test, expect } from '@playwright/test';
import { signInAsPlayer, signInAsGm, gmToken, asGm, runningSystem, approvedPlayer, sheetTab } from './helpers';

// A custom system's CHOICES block at the table (7a3b1; approved mockup docs/mockups/builder-choices.html,
// 2026-10-27): a player opens their sheet and picks a class from it. One they don't meet is off, saying
// what it needs; the one they pick shows its features, and its bonus reaches the formula it changes.
// They raise its level and the next feature unlocks; they tick a use off, and a short rest the GM calls
// gives it back. The GM (7a3b2) picks past a requirement, sees a bonus named on the stat it changes,
// and takes a pick away, asked first. Set up through the API, as player-journey is.

const definition = (name: string) => ({
  format: 1,
  name,
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'int', label: 'Intellect', min: 1, max: 18 }] }],
  derived: [{ id: 'defense', label: 'Defense', formula: '10' }],
  core: { health: { model: 'pool' }, advancement: ['levels'], dice: ['d20'] },
  choices: [{
    id: 'classes', one: 'Class', many: 'Classes', levelled: true, again: true,
    options: [
      { id: 'soldier', label: 'Soldier', features: [
        { id: 'guard', label: 'Guard Stance', modifiers: [{ target: 'defense', amount: '1' }] },
        { id: 'rally', label: 'Rally', uses: { count: '2', refill: 'short_rest' } },
        { id: 'veteran', label: 'Veteran', at: 2 },
      ] },
      { id: 'mage', label: 'Mage', requires: '@int >= 13' },
    ],
  }],
});

test('a player picks a class on their sheet, levels it, and ticks a use a short rest gives back', async ({ browser, request }, info) => {
  const again = info.retry ? `_${info.retry + 1}` : '';
  const player = { username: `e2e_chooser${again}`, password: 'e2e-player-password' };
  const gm = await gmToken(request);
  await runningSystem(request, gm, definition(`Choosing Keep${again}`));
  await approvedPlayer(request, gm, player);

  const context = await browser.newContext({ baseURL: info.project.use.baseURL });
  const page = await context.newPage();
  await signInAsPlayer(page, player);
  await page.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true }).click();
  await page.getByRole('button', { name: 'CHARACTER_SHEET', exact: true }).click();
  await page.getByLabel('Intellect', { exact: true }).fill('10');
  await expect.poll(async () => (await asGm(request, gm, 'get', `/api/sheets/user/${player.username}`)).data.int).toBe(10);

  // On the CHARACTER tab, nothing picked: MAGE is off and says why; SOLDIER is picked.
  await sheetTab(page, 'CHARACTER');
  await page.getByLabel('Name', { exact: true }).fill('Wren');
  const block = page.getByRole('region', { name: 'Classes' });
  await expect(block.getByText('No Class picked yet.')).toBeVisible();
  const pick = block.getByRole('group', { name: 'Pick a Class' });
  await expect(pick.getByRole('button', { name: 'MAGE' })).toBeDisabled();
  await expect(pick.getByText('NEEDS INTELLECT >= 13')).toBeVisible();
  await pick.getByRole('button', { name: 'SOLDIER' }).click();

  // Its features, and its bonus on the formula, back on STATS: Defense 10 + 1.
  const soldier = block.getByRole('group', { name: 'Soldier' });
  await expect(soldier.getByText('LV 1')).toBeVisible();
  await expect(soldier.getByText('Guard Stance')).toBeVisible();
  await expect(soldier.getByText('NEXT · LV 2: Veteran')).toBeVisible();
  await sheetTab(page, 'STATS');
  await expect(page.getByLabel('Defense', { exact: true })).toHaveValue('11');
  await sheetTab(page, 'CHARACTER');

  // Level 2: Veteran unlocks; the total says so.
  await soldier.getByRole('button', { name: 'Soldier level up' }).click();
  await expect(soldier.getByText('LV 2')).toBeVisible();
  await expect(soldier.getByText('Veteran')).toBeVisible();
  await expect(block.getByLabel('Level 2: SOLDIER 2')).toBeVisible();

  // A use of Rally ticked off, then a short rest gives it back.
  const rally = soldier.getByRole('group', { name: 'Rally uses' });
  await expect(rally.getByText('2 OF 2 · SHORT REST')).toBeVisible();
  await rally.getByRole('button', { name: 'Rally use 1' }).click();
  await expect(rally.getByText('1 OF 2 · SHORT REST')).toBeVisible();
  await asGm(request, gm, 'post', '/api/sheets/rest', { rest: 'short_rest', players: [player.username] });
  await expect(rally.getByText('2 OF 2 · SHORT REST')).toBeVisible();

  // As the server keeps it.
  const { data } = await asGm(request, gm, 'get', `/api/sheets/user/${player.username}`);
  expect(data._worked.picks).toEqual([{ list: 'classes', option: 'soldier', level: 2 }]);
  expect(data._uses).toEqual({ rally: 0 });
  await context.close();
});

test('the GM picks past a requirement, sees the bonus on the stat, and takes a pick away (7a3b2)', async ({ page, request }, info) => {
  const again = info.retry ? `_${info.retry + 1}` : '';
  const gm = await gmToken(request);
  await runningSystem(request, gm, definition(`Overruled Keep${again}`));
  await signInAsGm(page);
  await page.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true }).click();
  await page.getByRole('button', { name: 'CHARACTER_SHEET', exact: true }).click();
  await page.getByLabel('Intellect', { exact: true }).fill('10');

  // MAGE isn't met, and the GM may add it anyway.
  await sheetTab(page, 'CHARACTER');
  await page.getByLabel('Name', { exact: true }).fill('The Keeper');
  const block = page.getByRole('region', { name: 'Classes' });
  const pick = block.getByRole('group', { name: 'Pick a Class' });
  await expect(pick.getByText('NEEDS INTELLECT >= 13 · ADD ANYWAY')).toBeVisible();
  await pick.getByRole('button', { name: 'SOLDIER' }).click();
  await expect(block.getByRole('group', { name: 'Soldier' })).toBeVisible();
  await block.getByRole('group', { name: 'Pick a Class' }).getByRole('button', { name: 'MAGE' }).click();
  await expect(block.getByRole('group', { name: 'Mage' })).toBeVisible();

  // Guard Stance's bonus, named on Defense on STATS: 10 before it, 11 with it.
  await sheetTab(page, 'STATS');
  await expect(page.getByTitle('10 → 11 (Guard Stance +1)')).toBeVisible();
  await sheetTab(page, 'CHARACTER');

  // MAGE taken away, asked first; KEEP first keeps it.
  const mage = block.getByRole('group', { name: 'Mage' });
  await mage.getByRole('button', { name: 'Drop Mage' }).click();
  await mage.getByRole('button', { name: 'KEEP' }).click();
  await expect(mage).toBeVisible();
  await mage.getByRole('button', { name: 'Drop Mage' }).click();
  await mage.getByRole('button', { name: 'YES, DROP' }).click();
  await expect(block.getByRole('group', { name: 'Mage' })).toHaveCount(0);
  await expect(block.getByRole('group', { name: 'Soldier' })).toBeVisible();
});
