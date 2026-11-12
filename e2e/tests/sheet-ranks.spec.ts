import { test, expect } from '@playwright/test';
import { signInAsPlayer, gmToken, asGm, runningSystem, approvedPlayer } from './helpers';

// A ranked stat on the sheet (7f1c1; approved mockup docs/mockups/ranks-and-xp.html, 2026-11-12): the player picks
// Athletics' rank by name, its worth shows beside it, and a formula reading it follows; the server keeps the step and
// works the worth out.

test('a rank picked on the sheet: its worth beside it, a formula reading it, the step kept (7f1c1)', async ({ browser, request }, info) => {
  test.setTimeout(120_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const gm = await gmToken(request);
  await runningSystem(request, gm, {
    format: 1, name: `Rankhold${again}`, core: { health: { model: 'pool' } },
    stats: [
      { id: 'basics', label: 'BASICS', stats: [{ id: 'level', label: 'Level' }] },
      { id: 'skills', label: 'SKILLS', stats: [{ id: 'athletics', label: 'Athletics', rank: 'proficiency' }] },
    ],
    ranks: [{ id: 'proficiency', label: 'PROFICIENCY', list: [{ name: 'UNTRAINED', worth: '0' }, { name: 'TRAINED', worth: '2 + @level' }, { name: 'EXPERT', worth: '4 + @level' }] }],
    derived: [{ id: 'climb', label: 'Climb', formula: '@athletics + 1' }],
  });
  const player = { username: `e2e_ranked${again}`, password: 'e2e-player-password' };
  await approvedPlayer(request, gm, player);
  const sheetOf = async () => (await asGm(request, gm, 'get', `/api/sheets/user/${player.username}`)).data;

  const context = await browser.newContext({ baseURL: info.project.use.baseURL });
  const mine = await context.newPage();
  await signInAsPlayer(mine, player);
  await mine.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true }).click();
  await mine.getByRole('button', { name: 'CHARACTER_SHEET', exact: true }).click();
  await mine.getByLabel('Level', { exact: true }).fill('3');
  await expect.poll(async () => (await sheetOf()).level, { timeout: 15_000 }).toBe(3);

  // The picker: the lowest to start, worth 0; EXPERT picked, worth 4 + 3.
  const athletics = mine.getByRole('combobox', { name: 'Athletics', exact: true });
  await expect(athletics.locator('option')).toHaveText(['UNTRAINED', 'TRAINED', 'EXPERT']);
  await athletics.selectOption({ label: 'EXPERT' });
  await expect(mine.getByTestId('worth-athletics')).toHaveText('= 7', { timeout: 15_000 });
  await expect.poll(async () => { const d = await sheetOf(); return [d.athletics_rank, d.athletics, d.climb]; }, { timeout: 15_000 }).toEqual(['2', 7, 8]);
  // The formula reading it, on the sheet.
  await expect(mine.getByLabel('Climb', { exact: true })).toHaveValue('8', { timeout: 15_000 });
  await context.close();
});
