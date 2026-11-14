import { test, expect } from '@playwright/test';
import { signInAsPlayer, gmToken, asGm, runningSystem, approvedPlayer, sheetTab } from './helpers';

// IMPROVE BY USE at the table (7f3b; approved mockup docs/mockups/ranks-and-xp.html, 2026-11-12): a player rolls Lore
// with a success and it is marked beside its name; the mark cleared and ticked again by hand; then END OF SESSION, taken
// from the sheet's RESTS, rolls it to improve (d100 over 0, +5: Lore 3 to 8) and clears the mark.

test('IMPROVE BY USE: a success marks Lore, a mark ticked by hand, END OF SESSION improves it (7f3b)', async ({ browser, request }, info) => {
  test.setTimeout(120_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const gm = await gmToken(request);
  await runningSystem(request, gm, {
    format: 1, name: `Improvefall${again}`, core: { health: { model: 'pool' }, advancement: ['use'] },
    stats: [{ id: 'skills', label: 'SKILLS', stats: [{ id: 'lore', label: 'Lore' }] }],
    rolls: [{ id: 'check', label: 'Check', dice: [{ count: '1', sides: 100 }], against: '1', by: ['lore'] }],
    improve: { stats: 'skills', marked: 'success', at: 'end_of_session', roll: 'd100', over: '0', gain: '5' },
    resting: { finish: 'sheet' },
  });
  const player = { username: `e2e_improver${again}`, password: 'e2e-player-password' };
  await approvedPlayer(request, gm, player);
  const stored = async () => (await asGm(request, gm, 'get', `/api/sheets/user/${player.username}`)).data;

  const context = await browser.newContext({ baseURL: info.project.use.baseURL });
  const mine = await context.newPage();
  await signInAsPlayer(mine, player);
  await mine.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true }).click();
  await mine.getByRole('button', { name: 'CHARACTER_SHEET', exact: true }).click();
  await sheetTab(mine, 'STATS');
  await mine.getByLabel('Lore', { exact: true }).fill('3');
  await expect.poll(async () => (await stored()).lore, { timeout: 15_000 }).toBe(3);
  const mark = mine.getByRole('button', { name: 'Lore marked' });
  await expect(mark).toHaveAttribute('aria-pressed', 'false');

  // A successful roll marks it.
  await mine.getByRole('button', { name: 'Roll Check' }).click();
  await expect(mark).toHaveAttribute('aria-pressed', 'true', { timeout: 15_000 });
  // The dice tray opens over the sheet for the roll: closed once it is there, so Escape never closes the sheet instead.
  const tray = mine.getByText('DICE_TRAY.EXE', { exact: true });
  await expect(tray).toBeVisible();
  await mine.keyboard.press('Escape');
  await expect(tray).toBeHidden();
  // Cleared, and ticked again, by hand.
  await mark.click();
  await expect.poll(async () => (await stored())._marks, { timeout: 15_000 }).toBeUndefined();
  await mark.click();
  await expect.poll(async () => (await stored())._marks, { timeout: 15_000 }).toEqual({ lore: true });

  // END OF SESSION from RESTS: Lore's d100 is over 0, so it gains 5; the mark clears.
  const rests = mine.getByRole('group', { name: 'Rests' });
  await rests.getByRole('button', { name: 'END OF SESSION' }).click();
  await mine.getByRole('group', { name: /^Take a End of session\?$/ }).getByRole('button', { name: 'REST' }).click();
  // Nothing to spend at it, so it is taken at once, the improvement's d100 thrown in the tray.
  await expect.poll(async () => (await stored()).lore, { timeout: 15_000 }).toBe(8);
  expect((await stored())._marks).toEqual({});
  await expect(mark).toHaveAttribute('aria-pressed', 'false', { timeout: 15_000 });
  await expect(mine.getByLabel('Lore', { exact: true })).toHaveValue('8');
  await context.close();
});
