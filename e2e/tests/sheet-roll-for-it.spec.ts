import { test, expect } from '@playwright/test';
import { signInAsPlayer, gmToken, asGm, runningSystem, approvedPlayer, sheetTab } from './helpers';

// ROLL FOR IT at the table (7a5b2; approved mockup docs/mockups/nested-choices.html, version 2): a
// game whose BACKGROUNDS are rolled only. The player can't pick one by hand; ROLL FOR IT rolls on the
// server, the dice tray throwing it, and the result is marked TAKE IT with a second roll refused
// them. Taken, it is their background. Set up through the API, as player-journey is.

const definition = (name: string) => ({
  format: 1,
  name,
  core: { health: { model: 'pool' }, dice: ['d6'] },
  choices: [{ id: 'backgrounds', one: 'Background', many: 'Backgrounds', table: 'd6', players: 'roll', options: [
    { id: 'dockhand', label: 'Dockhand', roll: '1-3' }, { id: 'scribe', label: 'Scribe', roll: '4-6' },
  ] }],
});

test('a background rolled for, thrown in the tray, then taken; picking by hand is off', async ({ browser, request }, info) => {
  const again = info.retry ? `_${info.retry + 1}` : '';
  const player = { username: `e2e_roller4it${again}`, password: 'e2e-player-password' };
  const gm = await gmToken(request);
  await runningSystem(request, gm, definition(`Rollfall${again}`));
  await approvedPlayer(request, gm, player);
  const stored = async () => (await asGm(request, gm, 'get', `/api/sheets/user/${player.username}`)).data;

  const context = await browser.newContext({ baseURL: info.project.use.baseURL });
  const sheet = await context.newPage();
  await signInAsPlayer(sheet, player);
  await sheet.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true }).click();
  await sheet.getByRole('button', { name: 'CHARACTER_SHEET', exact: true }).click();
  await sheetTab(sheet, 'CHARACTER');
  await sheet.getByLabel('Name', { exact: true }).fill('Wren');
  await expect.poll(async () => (await stored()).name, { timeout: 15_000 }).toBe('Wren');

  // Rolled only: nothing to pick by hand until it's rolled.
  const pick = sheet.getByRole('region', { name: 'Backgrounds' }).getByRole('group', { name: 'Pick a Background' });
  await expect(pick.getByRole('button', { name: 'DOCKHAND' })).toBeDisabled();
  await pick.getByRole('button', { name: 'ROLL FOR IT' }).click();

  // The tray throws it; the sheet says what came up, marked TAKE IT, and no second roll.
  await expect(sheet.getByText('DICE_TRAY.EXE', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(pick.getByText(/^ROLLED [1-6] → (DOCKHAND|SCRIBE)$/)).toBeVisible({ timeout: 15_000 });
  const said = (await pick.getByText(/^ROLLED/).textContent())!;
  const landed = said.endsWith('DOCKHAND') ? 'DOCKHAND' : 'SCRIBE';
  await sheet.keyboard.press('Escape');
  await expect(pick.getByRole('button', { name: 'ROLL FOR IT' })).toBeDisabled();
  await expect(pick.getByRole('button', { name: landed === 'DOCKHAND' ? 'SCRIBE' : 'DOCKHAND' })).toBeDisabled();

  // TAKE IT: theirs.
  await pick.getByRole('button', { name: `${landed} · TAKE IT` }).click();
  const id = landed === 'DOCKHAND' ? 'dockhand' : 'scribe';
  await expect.poll(async () => { const d = await stored(); return [d._choices?.backgrounds, d._rolled]; }, { timeout: 15_000 })
    .toEqual([[{ option: id }], undefined]);
  await expect(sheet.getByRole('region', { name: 'Backgrounds' }).getByRole('group', { name: landed === 'DOCKHAND' ? 'Dockhand' : 'Scribe' })).toBeVisible();
  await context.close();
});
