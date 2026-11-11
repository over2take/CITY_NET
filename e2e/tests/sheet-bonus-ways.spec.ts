import { test, expect } from '@playwright/test';
import { signInAsPlayer, gmToken, asGm, runningSystem, approvedPlayer, sheetTab } from './helpers';

// Three ways a bonus counts, at the table (7e1; approved mockup docs/mockups/items.html, 2026-11-10): a feat's +2 and a
// ring's +2 on CON stop at 20, the ring named as cut; an Amulet's AT LEAST 19 lifts a CON of 12 past them. The stat's
// badge says each.

test('BONUSES STOP AT and AT LEAST: two +2s stop at 20, the cut one named; an AT LEAST lifts what they leave (7e1)', async ({ browser, request }, info) => {
  test.setTimeout(120_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const gm = await gmToken(request);
  await runningSystem(request, gm, {
    format: 1, name: `Capfall${again}`, core: { health: { model: 'pool' } },
    stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'con', label: 'Con', stop: 20 }] }],
    choices: [{ id: 'feats', one: 'Feat', many: 'Feats', picks: 'any', options: [
      { id: 'tough', label: 'Tough', features: [{ id: 'tough_f', label: 'Tough', modifiers: [{ target: 'con', amount: '2' }] }] },
      { id: 'ring', label: 'Ring', features: [{ id: 'ring_f', label: 'Ring', modifiers: [{ target: 'con', amount: '2' }] }] },
      { id: 'amulet', label: 'Amulet', features: [{ id: 'amulet_f', label: 'Amulet', modifiers: [{ target: 'con', amount: '19', how: 'least' }] }] },
    ] }],
  });
  const player = { username: `e2e_capped${again}`, password: 'e2e-player-password' };
  await approvedPlayer(request, gm, player);
  const sheetOf = async () => (await asGm(request, gm, 'get', `/api/sheets/user/${player.username}`)).data;

  const context = await browser.newContext({ baseURL: info.project.use.baseURL });
  const mine = await context.newPage();
  await signInAsPlayer(mine, player);
  await mine.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true }).click();
  await mine.getByRole('button', { name: 'CHARACTER_SHEET', exact: true }).click();
  await mine.getByLabel('Con', { exact: true }).fill('18');
  await expect.poll(async () => (await sheetOf()).con, { timeout: 15_000 }).toBe(18);
  const pick = async (name: string, option: string) => {
    await sheetTab(mine, 'CHARACTER');
    await mine.getByRole('group', { name: 'Pick a Feat' }).getByRole('button', { name }).click();
    await expect.poll(async () => ((await sheetOf())._choices?.feats ?? []).some((p: string | { option: string }) => (typeof p === 'string' ? p : p.option) === option), { timeout: 15_000 }).toBe(true);
    await sheetTab(mine, 'STATS');
  };

  // Tough's +2 takes 18 to 20; the Ring's +2 then stops at 20, named as cut.
  await pick('TOUGH', 'tough');
  await expect(mine.getByTitle('18 → 20 (Tough +2)')).toBeVisible({ timeout: 15_000 });
  await pick('RING', 'ring');
  await expect(mine.getByTitle('18 → 20 (Tough +2, Ring (+2, stops at 20) +0)')).toBeVisible({ timeout: 15_000 });

  // The Amulet's AT LEAST 19: nothing at 20; with CON 12, the two +2s make 16 and it lifts that to 19.
  await pick('AMULET', 'amulet');
  await expect(mine.getByTitle('18 → 20 (Tough +2, Ring (+2, stops at 20) +0, Amulet (already higher) +0)')).toBeVisible({ timeout: 15_000 });
  await mine.getByLabel('Con', { exact: true }).fill('12');
  await expect.poll(async () => (await sheetOf()).con, { timeout: 15_000 }).toBe(12);
  await expect(mine.getByTitle('12 → 19 (Tough +2, Ring +2, Amulet → 19)')).toBeVisible({ timeout: 15_000 });
  await context.close();
});
