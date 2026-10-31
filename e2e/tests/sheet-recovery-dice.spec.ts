import { test, expect } from '@playwright/test';
import { signInAsGm, signInAsPlayer, openGameSystem, gmToken, asGm, runningSystem, approvedPlayer, sheetTab } from './helpers';

// Recovery dice at the table (R2b; approved mockup docs/mockups/rest-on-sheet.html, 2026-10-30): a
// Fighter 2 has two d10 hit dice on their sheet. The system leaves spending to the GM, so they wait
// until the GM opens spending in the GAME tab's RESTS; then the player spends one (the dice tray
// opens for it) and ticks the other off for a real die. A long rest gives them all back, and once the
// GM closes spending the player's wait again. Set up through the API, as player-journey is.

const definition = (name: string) => ({
  format: 1,
  name,
  stats: [{ id: 'traits', label: 'TRAITS', stats: [{ id: 'grit', label: 'Grit', min: 1, max: 20 }] }],
  core: { health: { model: 'pool' }, advancement: ['levels'], dice: ['d10'] },
  choices: [{ id: 'classes', one: 'Class', many: 'Classes', levelled: true, options: [{ id: 'fighter', label: 'Fighter', die: 10 }] }],
  resting: { recovery: { name: 'Hit Dice', plus: '@grit', spent_at: ['short_rest'], spend: 'gm', back: [{ rest: 'long_rest', how: 'all' }] } },
});

test('hit dice wait for the GM, are spent and ticked off on the sheet, and come back at a long rest', async ({ page: gmPage, browser, request }, info) => {
  const again = info.retry ? `_${info.retry + 1}` : '';
  const player = { username: `e2e_hitdice${again}`, password: 'e2e-player-password' };
  const gm = await gmToken(request);
  await runningSystem(request, gm, definition(`Hitfall${again}`));
  await approvedPlayer(request, gm, player);
  // Spending starts closed, whatever another test left.
  await asGm(request, gm, 'post', '/api/settings', { key: 'recovery_open', value: '0' });
  const stored = async () => (await asGm(request, gm, 'get', `/api/sheets/user/${player.username}`)).data;

  // THE PLAYER: FIGHTER to 2, so two d10s.
  const context = await browser.newContext({ baseURL: info.project.use.baseURL });
  const sheet = await context.newPage();
  await signInAsPlayer(sheet, player);
  await sheet.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true }).click();
  await sheet.getByRole('button', { name: 'CHARACTER_SHEET', exact: true }).click();
  await sheet.getByLabel('Grit', { exact: true }).fill('2');
  // The name and the class on CHARACTER; the dice in RESTS, back on STATS.
  await sheetTab(sheet, 'CHARACTER');
  await sheet.getByLabel('Name', { exact: true }).fill('Rook');
  const classes = sheet.getByRole('region', { name: 'Classes' });
  await classes.getByRole('group', { name: 'Pick a Class' }).getByRole('button', { name: 'FIGHTER' }).click();
  await classes.getByRole('group', { name: 'Fighter' }).getByRole('button', { name: 'Fighter level up' }).click();
  await expect(classes.getByRole('group', { name: 'Fighter' }).getByText('LV 2')).toBeVisible();
  await sheetTab(sheet, 'STATS');
  const dice = sheet.getByRole('region', { name: 'Hit Dice' });
  const pool = dice.getByRole('group', { name: 'Fighter d10', exact: true });
  await expect(pool.getByText('2 OF 2 LEFT')).toBeVisible({ timeout: 15_000 });
  await expect(dice.getByText('ONE HEALS ITS DIE + GRIT · SPENT AT A SHORT REST')).toBeVisible();
  // Closed: they wait.
  await expect(dice.getByText('THE GM OPENS SPENDING: UNTIL THEN THESE WAIT')).toBeVisible();
  await expect(pool.getByRole('button', { name: 'Fighter d10 1' })).toBeDisabled();

  // THE GM opens spending from the GAME tab.
  await signInAsGm(gmPage);
  await openGameSystem(gmPage);
  await gmPage.keyboard.press('Escape');
  const rests = gmPage.getByRole('region', { name: 'Rests' });
  const spending = rests.getByRole('switch', { name: 'Spending recovery dice' });
  await expect(spending).toHaveAttribute('aria-checked', 'false');
  await spending.click();
  await expect(spending).toHaveAttribute('aria-checked', 'true');

  // THE PLAYER spends one: the tray opens for the roll, and one is left.
  await expect(dice.getByText(/THE GM OPENS SPENDING/)).toBeHidden({ timeout: 15_000 });
  await pool.getByRole('button', { name: 'SPEND 1D10' }).click();
  await expect(sheet.getByText('DICE_TRAY.EXE', { exact: true })).toBeVisible();
  // And throws the roll that opened it: the board shows it, not READY (2026-10-31).
  await expect(sheet.getByTestId('dice-board')).not.toHaveAttribute('aria-label', 'Ready', { timeout: 15_000 });
  await expect(pool.getByText('1 OF 2 LEFT')).toBeVisible({ timeout: 15_000 });
  // The tray, on top, goes with Escape, as any window does.
  await sheet.keyboard.press('Escape');
  await expect(sheet.getByText('DICE_TRAY.EXE', { exact: true })).toBeHidden();
  // And ticks the other off, for a real die.
  await pool.getByRole('button', { name: 'Fighter d10 2' }).click();
  await expect(pool.getByText('0 OF 2 LEFT')).toBeVisible({ timeout: 15_000 });
  expect((await stored())._recovery).toEqual({ fighter: 2 });

  // THE GM calls a long rest: all back.
  await rests.getByLabel('Rest', { exact: true }).selectOption('long_rest');
  await rests.getByRole('button', { name: 'CALL LONG REST', exact: true }).click();
  await rests.getByRole('group', { name: 'Call a Long rest?' }).getByRole('button', { name: 'CALL', exact: true }).click();
  await expect(rests.getByRole('status')).toHaveText('LONG REST CALLED · 1 CHARACTER');
  await expect(pool.getByText('2 OF 2 LEFT')).toBeVisible({ timeout: 15_000 });

  // And closes spending: the player's wait again.
  await spending.click();
  await expect(spending).toHaveAttribute('aria-checked', 'false');
  await expect(dice.getByText('THE GM OPENS SPENDING: UNTIL THEN THESE WAIT')).toBeVisible({ timeout: 15_000 });
  await expect(pool.getByRole('button', { name: 'SPEND 1D10' })).toBeHidden();
  await context.close();
});
