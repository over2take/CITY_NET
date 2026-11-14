import { test, expect } from '@playwright/test';
import { signInAsPlayer, gmToken, asGm, runningSystem, approvedPlayer } from './helpers';

// Ranks making a character (7f1c2; approved mockup docs/mockups/ranks-and-xp.html, 2026-11-12): NEW_CHARACTER.EXE's
// THE STATS asks a ranked stat by name under RANKS, with those past its AT START off for a player; the rank picked is
// kept, and its worth worked out.

test('NEW CHARACTER: a rank picked under RANKS, none past AT START, kept with its worth (7f1c2)', async ({ browser, request }, info) => {
  test.setTimeout(120_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const gm = await gmToken(request);
  await runningSystem(request, gm, {
    format: 1, name: `Startfall${again}`,
    stats: [{ id: 'traits', label: 'TRAITS', stats: [{ id: 'grit', label: 'Grit', min: 3, max: 18 }, { id: 'lore', label: 'Lore', rank: 'proficiency', atStart: 1 }] }],
    ranks: [{ id: 'proficiency', label: 'PROFICIENCY', list: [{ name: 'UNTRAINED', worth: '0' }, { name: 'TRAINED', worth: '2' }, { name: 'EXPERT', worth: '4' }] }],
    creation: { on: true },
  });
  const player = { username: `e2e_started${again}`, password: 'e2e-player-password' };
  await approvedPlayer(request, gm, player);
  const stored = async () => (await asGm(request, gm, 'get', `/api/sheets/user/${player.username}`)).data;

  const context = await browser.newContext({ baseURL: info.project.use.baseURL });
  const page = await context.newPage();
  await signInAsPlayer(page, player);
  await page.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true }).click();
  await page.getByRole('button', { name: 'CHARACTER_SHEET', exact: true }).click();
  await page.getByRole('button', { name: 'BEGIN' }).click();
  await page.getByRole('textbox', { name: 'Name' }).fill('Wren');
  await expect.poll(async () => (await stored()).name, { timeout: 15_000 }).toBe('Wren');
  await page.getByRole('button', { name: 'NEXT' }).click();

  // THE STATS: Grit typed; Lore under RANKS, EXPERT off, TRAINED the most to start.
  await page.getByRole('spinbutton', { name: 'Grit' }).fill('12');
  const ranks = page.getByRole('region', { name: 'Ranks' });
  await expect(ranks.getByText('UP TO TRAINED TO START')).toBeVisible();
  const lore = ranks.getByRole('combobox', { name: 'Lore rank' });
  await expect.poll(() => lore.locator('option').evaluateAll((os) => os.map((o) => [o.textContent, (o as HTMLOptionElement).disabled]))).toEqual([['UNTRAINED', false], ['TRAINED', false], ['EXPERT', true]]);
  await lore.selectOption({ label: 'TRAINED' });
  await expect.poll(async () => { const d = await stored(); return [d.lore_rank, d.lore, d.grit]; }, { timeout: 15_000 }).toEqual(['1', 2, 12]);
  await context.close();
});
