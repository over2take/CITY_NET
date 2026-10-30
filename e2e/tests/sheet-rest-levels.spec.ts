import { test, expect } from '@playwright/test';
import { signInAsGm, signInAsPlayer, openGameSystem, gmToken, asGm, runningSystem, approvedPlayer } from './helpers';

// A rest's amount reads the character's levels (rest levels, 2026-10-30): before, a builder system's
// rests could only name sheet fields, stats and formulas, so "heal by your level" was refused. Here a
// long rest sets Resolve to the Fighter's level plus Grit, Grit read with what a feature adds, as a
// roll reads it. The player raises FIGHTER to 3 (Tough, at 2, adds 2 Grit) and the GM calls the rest
// from the GAME tab: Resolve becomes 3 + 5. Set up through the API, as player-journey is.
//
// Quiet rests (2026-10-30): that long rest rolls no dice, so the player's dice tray stays shut, its
// line only in the log; a short rest that rolls 1d4 opens it, as a roll of theirs does.

const definition = (name: string) => ({
  format: 1,
  name,
  stats: [
    { id: 'traits', label: 'TRAITS', stats: [{ id: 'grit', label: 'Grit', min: 1, max: 20 }] },
    { id: 'resources', label: 'RESOURCES', stats: [{ id: 'resolve', label: 'Resolve', min: 0, max: 30 }] },
  ],
  core: { health: { model: 'pool' }, advancement: ['levels'], dice: ['d6'] },
  choices: [{
    id: 'classes', one: 'Class', many: 'Classes', levelled: true,
    options: [{ id: 'fighter', label: 'Fighter', features: [{ id: 'tough', label: 'Tough', at: 2, modifiers: [{ target: 'grit', amount: '2' }] }] }],
  }],
  rests: {
    long_rest: { refills: [{ what: 'resolve', how: 'to', amount: '@fighter_level + @grit' }] },
    short_rest: { refills: [{ what: 'resolve', how: 'by', amount: '1d4' }] },
  },
});

test('a long rest sets a number from the character\'s class level and a stat with its feature\'s bonus', async ({ page: gmPage, browser, request }, info) => {
  const again = info.retry ? `_${info.retry + 1}` : '';
  const player = { username: `e2e_rester${again}`, password: 'e2e-player-password' };
  const gm = await gmToken(request);
  await runningSystem(request, gm, definition(`Restfall${again}`));
  await approvedPlayer(request, gm, player);

  // THE PLAYER: Grit 3, then FIGHTER raised to 3.
  const context = await browser.newContext({ baseURL: info.project.use.baseURL });
  const sheet = await context.newPage();
  await signInAsPlayer(sheet, player);
  await sheet.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true }).click();
  await sheet.getByRole('button', { name: 'CHARACTER_SHEET', exact: true }).click();
  await sheet.getByLabel('Name', { exact: true }).fill('Rook');
  await sheet.getByLabel('Grit', { exact: true }).fill('3');
  const classes = sheet.getByRole('region', { name: 'Classes' });
  await classes.getByRole('group', { name: 'Pick a Class' }).getByRole('button', { name: 'FIGHTER' }).click();
  const fighter = classes.getByRole('group', { name: 'Fighter' });
  for (const lv of [2, 3]) {
    await fighter.getByRole('button', { name: 'Fighter level up' }).click();
    await expect(fighter.getByText(`LV ${lv}`, { exact: true })).toBeVisible();
  }
  await expect.poll(async () => {
    const { data } = await asGm(request, gm, 'get', `/api/sheets/user/${player.username}`);
    return [data.name, data.grit, data._worked?.levels?.fighter_level];
  }, { timeout: 15_000 }).toEqual(['Rook', 3, 3]);

  // THE GM calls a long rest from the GAME tab.
  await signInAsGm(gmPage);
  await openGameSystem(gmPage);
  await gmPage.keyboard.press('Escape');
  const rests = gmPage.getByRole('region', { name: 'Rests' });
  await rests.getByLabel('Rest', { exact: true }).selectOption('long_rest');
  await expect(rests.getByRole('list', { name: 'What each one gets' })).toContainText('ROOK');
  await rests.getByRole('button', { name: 'CALL LONG REST', exact: true }).click();
  await expect(rests.getByRole('status')).toHaveText('LONG REST CALLED · 1 CHARACTER');

  // Resolve is the Fighter's 3 plus Grit 3 with Tough's 2.
  await expect.poll(async () => (await asGm(request, gm, 'get', `/api/sheets/user/${player.username}`)).data.resolve, { timeout: 15_000 }).toBe(8);
  await expect(sheet.getByLabel('Resolve', { exact: true })).toHaveValue('8');
  // No dice were rolled, so no tray opened for it.
  await expect(sheet.getByText('DICE_TRAY.EXE', { exact: true })).toBeHidden();

  // A short rest rolls 1d4 for Rook: the tray opens on the player's screen.
  await rests.getByLabel('Rest', { exact: true }).selectOption('short_rest');
  await rests.getByRole('button', { name: 'CALL SHORT REST', exact: true }).click();
  await expect(rests.getByRole('status')).toHaveText('SHORT REST CALLED · 1 CHARACTER');
  await expect(sheet.getByText('DICE_TRAY.EXE', { exact: true })).toBeVisible();
  await context.close();
});
