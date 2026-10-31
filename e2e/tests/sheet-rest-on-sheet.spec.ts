import { test, expect } from '@playwright/test';
import { signInAsGm, signInAsPlayer, openGameSystem, gmToken, asGm, runningSystem, approvedPlayer } from './helpers';

// Resting on the sheet (R3b; approved mockup docs/mockups/rest-on-sheet.html, and the user's calls of
// 2026-10-30 and -31): in a system whose rests are finished on each sheet, a Fighter's RESTS section
// has a button for each rest. SHORT REST asks first, then opens its panel with the Hit Dice; one is
// spent, and FINISH, which asks too, takes the rest: Second Wind comes back. Then the GM calls a long
// rest from the GAME tab, which asks first and opens it on the player's sheet, CALLED BY THE GM; the
// player finishes it and the dice come back. Set up through the API, as player-journey is.

const definition = (name: string) => ({
  format: 1,
  name,
  stats: [{ id: 'traits', label: 'TRAITS', stats: [{ id: 'grit', label: 'Grit', min: 0, max: 20 }] }],
  core: { health: { model: 'pool' }, advancement: ['levels'], dice: ['d10'] },
  choices: [{ id: 'classes', one: 'Class', many: 'Classes', levelled: true, options: [
    { id: 'fighter', label: 'Fighter', die: 10, features: [{ id: 'second_wind', label: 'Second Wind', uses: { count: '1', refill: 'short_rest' } }] },
  ] }],
  resting: { finish: 'sheet', recovery: { name: 'Hit Dice', spent_at: ['short_rest'], back: [{ rest: 'long_rest', how: 'all' }] } },
});

test('a player rests from their sheet, asked first, and finishes a long rest the GM called', async ({ page: gmPage, browser, request }, info) => {
  const again = info.retry ? `_${info.retry + 1}` : '';
  const player = { username: `e2e_rester2${again}`, password: 'e2e-player-password' };
  const gm = await gmToken(request);
  await runningSystem(request, gm, definition(`Restwell${again}`));
  await approvedPlayer(request, gm, player);
  const stored = async () => (await asGm(request, gm, 'get', `/api/sheets/user/${player.username}`)).data;

  // THE PLAYER: FIGHTER, with Second Wind used.
  const context = await browser.newContext({ baseURL: info.project.use.baseURL });
  const sheet = await context.newPage();
  await signInAsPlayer(sheet, player);
  await sheet.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true }).click();
  await sheet.getByRole('button', { name: 'CHARACTER_SHEET', exact: true }).click();
  await sheet.getByLabel('Name', { exact: true }).fill('Rook');
  const classes = sheet.getByRole('region', { name: 'Classes' });
  await classes.getByRole('group', { name: 'Pick a Class' }).getByRole('button', { name: 'FIGHTER' }).click();
  await classes.getByRole('group', { name: 'Second Wind uses' }).getByRole('button', { name: 'Second Wind use 1' }).click();
  await expect.poll(async () => (await stored())._uses?.second_wind, { timeout: 15_000 }).toBe(1);

  // SHORT REST: asked first, then its panel with the Hit Dice, one spent, then FINISH, asked too.
  const rests = sheet.getByRole('group', { name: 'Rests' });
  await rests.getByRole('button', { name: 'SHORT REST' }).click();
  await sheet.getByRole('group', { name: 'Take a Short rest?' }).getByRole('button', { name: 'REST' }).click();
  const panel = sheet.getByRole('region', { name: 'Short rest panel' });
  await panel.getByRole('button', { name: 'SPEND 1D10' }).click();
  await expect(panel.getByText('0 OF 1 LEFT')).toBeVisible({ timeout: 15_000 });
  await sheet.keyboard.press('Escape'); // the dice tray, opened over the sheet for the roll
  await panel.getByRole('button', { name: 'FINISH SHORT REST' }).click();
  await sheet.getByRole('group', { name: 'Finish the Short rest?' }).getByRole('button', { name: 'FINISH' }).click();
  await expect.poll(async () => (await stored())._uses?.second_wind, { timeout: 15_000 }).toBe(0);
  await expect(panel).toBeHidden();

  // THE GM calls a long rest: asked first, and it opens on the player's sheet.
  await signInAsGm(gmPage);
  await openGameSystem(gmPage);
  await gmPage.keyboard.press('Escape');
  const gameRests = gmPage.getByRole('region', { name: 'Rests' });
  await gameRests.getByLabel('Rest', { exact: true }).selectOption('long_rest');
  await expect(gameRests.getByRole('list', { name: 'What each one gets' })).toContainText('ROOK');
  await gameRests.getByRole('button', { name: 'CALL LONG REST', exact: true }).click();
  const asking = gameRests.getByRole('group', { name: 'Call a Long rest?' });
  await expect(asking).toContainText('It opens on 1 player\'s sheet for them to finish.');
  await asking.getByRole('button', { name: 'CALL', exact: true }).click();
  await expect(gameRests.getByRole('status')).toHaveText('LONG REST CALLED · OPEN ON 1 SHEET');

  // THE PLAYER finishes it: the Hit Dice come back.
  const called = sheet.getByRole('region', { name: 'Long rest panel' });
  await expect(called.getByText('CALLED BY THE GM')).toBeVisible({ timeout: 15_000 });
  await called.getByRole('button', { name: 'FINISH LONG REST' }).click();
  await sheet.getByRole('group', { name: 'Finish the Long rest?' }).getByRole('button', { name: 'FINISH' }).click();
  await expect.poll(async () => { const d = await stored(); return [d._recovery?.fighter, d._rest_call]; }, { timeout: 15_000 }).toEqual([0, undefined]);
  await expect(called).toBeHidden();
  await context.close();
});
