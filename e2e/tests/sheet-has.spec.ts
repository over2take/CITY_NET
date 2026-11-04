import { test, expect } from '@playwright/test';
import { signInAsPlayer, gmToken, asGm, runningSystem, approvedPlayer, sheetTab } from './helpers';

// has(name) at the table (7b): a formula and a requirement reading what a character has. MAGE needs
// Second Wind, so it is off, saying so in names, until SOLDIER is picked. GUARD counts it too: 10
// without, 12 with. Set up through the API, as player-journey is.

const definition = (name: string) => ({
  format: 1, name,
  derived: [{ id: 'guard', label: 'Guard', formula: '10 + 2 * has(second_wind)' }],
  core: { health: { model: 'pool' }, advancement: ['levels'], dice: ['d20'] },
  choices: [{ id: 'classes', one: 'Class', many: 'Classes', levelled: true, again: true, options: [
    { id: 'soldier', label: 'Soldier', features: [{ id: 'second_wind', label: 'Second Wind' }] },
    { id: 'mage', label: 'Mage', requires: 'has(second_wind)' },
  ] }],
});

test('a requirement and a formula reading what the character has', async ({ browser, request }, info) => {
  const again = info.retry ? `_${info.retry + 1}` : '';
  const player = { username: `e2e_haver${again}`, password: 'e2e-player-password' };
  const gm = await gmToken(request);
  await runningSystem(request, gm, definition(`Hasfall${again}`));
  await approvedPlayer(request, gm, player);

  const context = await browser.newContext({ baseURL: info.project.use.baseURL });
  const sheet = await context.newPage();
  await signInAsPlayer(sheet, player);
  await sheet.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true }).click();
  await sheet.getByRole('button', { name: 'CHARACTER_SHEET', exact: true }).click();

  // Without it: GUARD 10, on STATS.
  await expect(sheet.getByLabel('Guard', { exact: true })).toHaveValue('10');

  // MAGE is off, saying what it needs by name; SOLDIER is picked.
  await sheetTab(sheet, 'CHARACTER');
  const classes = sheet.getByRole('region', { name: 'Classes' });
  const pick = classes.getByRole('group', { name: 'Pick a Class' });
  await expect(pick.getByRole('button', { name: 'MAGE' })).toBeDisabled();
  await expect(pick.getByText('NEEDS SECOND WIND')).toBeVisible();
  await pick.getByRole('button', { name: 'SOLDIER' }).click();

  // With it: MAGE can be picked, and GUARD is 12.
  await expect(classes.getByRole('group', { name: 'Soldier' })).toBeVisible();
  await expect(pick.getByRole('button', { name: 'MAGE' })).toBeEnabled({ timeout: 15_000 });
  await sheetTab(sheet, 'STATS');
  await expect(sheet.getByLabel('Guard', { exact: true })).toHaveValue('12', { timeout: 15_000 });
  await context.close();
});
