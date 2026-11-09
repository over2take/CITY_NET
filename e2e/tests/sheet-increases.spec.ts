import { test, expect } from '@playwright/test';
import { signInAsGm, signInAsPlayer, gmToken, asGm, runningSystem, approvedPlayer, sheetTab } from './helpers';

// Ability increases at the table (7d6b; approved mockup docs/mockups/level-up.html, 2026-11-07): a level that
// unlocks an INCREASE has its own folder in LEVEL_UP.EXE, ABILITY INCREASE, where the points are spread with − and
// +, within what it allows; FINISH waits for every point. The stat shows it on its badge, never written into what
// was typed, and the GM's LEVEL_DOWN takes it off again. OR A FEAT INSTEAD (7d6c): a pick from the list it offers, in
// place of the points, kept under the feature on the sheet.

test('points spread going up, named on the stat\'s badge, and taken off by LEVEL_DOWN (7d6b)', async ({ page, browser, request }, info) => {
  test.setTimeout(150_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const gm = await gmToken(request);
  await runningSystem(request, gm, {
    format: 1, name: `Raisefall${again}`, core: { health: { model: 'pool' }, advancement: ['levels'] },
    stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }, { id: 'wits', label: 'Wits' }] }],
    choices: [{ id: 'classes', one: 'Class', many: 'Classes', levelled: true, options: [{ id: 'soldier', label: 'Soldier', features: [
      { id: 'asi', label: 'Ability Score Improvement', at: 2, increase: { points: 2, stats: 'abilities', cap: 20 } },
    ] }] }],
    levels: { top: 5, first: 100, ranges: [{ to: 5, x: 2 }] },
  });
  const player = { username: `e2e_raiser${again}`, password: 'e2e-player-password' };
  await approvedPlayer(request, gm, player);
  const sheetOf = async () => (await asGm(request, gm, 'get', `/api/sheets/user/${player.username}`)).data;

  const context = await browser.newContext({ baseURL: info.project.use.baseURL });
  const mine = await context.newPage();
  await signInAsPlayer(mine, player);
  await mine.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true }).click();
  await mine.getByRole('button', { name: 'CHARACTER_SHEET', exact: true }).click();
  await mine.getByLabel('Might', { exact: true }).fill('14');
  await mine.getByLabel('Wits', { exact: true }).fill('19');
  await expect.poll(async () => { const d = await sheetOf(); return [d.might, d.wits]; }, { timeout: 15_000 }).toEqual([14, 19]);
  await sheetTab(mine, 'CHARACTER');
  await mine.getByRole('group', { name: 'Pick a Class' }).getByRole('button', { name: 'SOLDIER' }).click();
  await expect.poll(async () => (await sheetOf())._choices?.classes?.[0]?.option, { timeout: 15_000 }).toBe('soldier');
  await asGm(request, gm, 'put', `/api/sheets/user/${player.username}`, { fields: { _xp: 100 } });

  await mine.getByRole('button', { name: 'LEVEL UP READY' }).click();
  await expect(mine.getByText('2 points to spend, in ABILITY INCREASE.')).toBeVisible();
  await mine.getByRole('button', { name: 'NEXT', exact: true }).click();
  const spend = mine.getByRole('group', { name: 'Spend Ability Score Improvement' });
  await expect(spend.getByText('2 POINTS LEFT · AT MOST 2 ON ONE · STOPS AT 20')).toBeVisible();
  await expect(mine.getByRole('button', { name: 'FINISH', exact: true })).toBeDisabled();
  // Wits stops at 20: one point, then no more.
  await spend.getByRole('button', { name: 'More Wits' }).click();
  await expect(spend.getByRole('button', { name: 'More Wits' })).toBeDisabled();
  await spend.getByRole('button', { name: 'Less Wits' }).click();
  await spend.getByRole('button', { name: 'More Might' }).click();
  await spend.getByRole('button', { name: 'More Might' }).click();
  await expect(spend.getByLabel('Might with the points')).toHaveText('16');
  await mine.getByRole('button', { name: 'FINISH', exact: true }).click();
  await expect.poll(async () => (await sheetOf())._increases, { timeout: 15_000 }).toEqual({ asi: { might: 2 } });
  expect((await sheetOf()).might).toBe(14);

  // On STATS, the badge says where the 2 came from.
  await sheetTab(mine, 'STATS');
  await expect(mine.getByTitle('14 → 16 (Ability Score Improvement +2)')).toBeVisible({ timeout: 15_000 });

  // The GM takes the level back, and the increase with it.
  await signInAsGm(page);
  await page.getByRole('button', { name: 'GAME', exact: true }).click();
  await page.getByRole('button', { name: 'AWARD_EXPERIENCE' }).click();
  await page.getByRole('checkbox', { name: player.username }).check();
  await page.getByRole('button', { name: 'LEVEL_DOWN' }).click();
  await expect.poll(async () => (await sheetOf())._increases, { timeout: 15_000 }).toBeUndefined();
  await expect(mine.getByTitle('14 → 16 (Ability Score Improvement +2)')).toHaveCount(0, { timeout: 15_000 });
  await context.close();
});

test('a Feat taken instead of the points: kept under the feature, its bonus on the badge, no points spent (7d6c)', async ({ browser, request }, info) => {
  test.setTimeout(150_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const gm = await gmToken(request);
  await runningSystem(request, gm, {
    format: 1, name: `Featfall${again}`, core: { health: { model: 'pool' }, advancement: ['levels'] },
    stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }, { id: 'wits', label: 'Wits' }] }],
    choices: [
      { id: 'classes', one: 'Class', many: 'Classes', levelled: true, options: [{ id: 'soldier', label: 'Soldier', features: [
        { id: 'asi', label: 'Ability Score Improvement', at: 2, increase: { points: 2, stats: 'abilities', cap: 20, instead: 'feats' } },
      ] }] },
      { id: 'feats', one: 'Feat', many: 'Feats', picked: 'features', options: [
        { id: 'tough', label: 'Tough', features: [{ id: 'tough_wits', label: 'Tough', modifiers: [{ target: 'wits', amount: '1' }] }] },
        { id: 'quick', label: 'Quick' },
      ] },
    ],
    levels: { top: 5, first: 100, ranges: [{ to: 5, x: 2 }] },
  });
  const player = { username: `e2e_featured${again}`, password: 'e2e-player-password' };
  await approvedPlayer(request, gm, player);
  const sheetOf = async () => (await asGm(request, gm, 'get', `/api/sheets/user/${player.username}`)).data;

  const context = await browser.newContext({ baseURL: info.project.use.baseURL });
  const mine = await context.newPage();
  await signInAsPlayer(mine, player);
  await mine.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true }).click();
  await mine.getByRole('button', { name: 'CHARACTER_SHEET', exact: true }).click();
  await mine.getByLabel('Wits', { exact: true }).fill('12');
  await expect.poll(async () => (await sheetOf()).wits, { timeout: 15_000 }).toBe(12);
  await sheetTab(mine, 'CHARACTER');
  await mine.getByRole('group', { name: 'Pick a Class' }).getByRole('button', { name: 'SOLDIER' }).click();
  await expect.poll(async () => (await sheetOf())._choices?.classes?.[0]?.option, { timeout: 15_000 }).toBe('soldier');
  await asGm(request, gm, 'put', `/api/sheets/user/${player.username}`, { fields: { _xp: 100 } });

  await mine.getByRole('button', { name: 'LEVEL UP READY' }).click();
  await expect(mine.getByText('2 points to spend, or a Feat, in ABILITY INCREASE.')).toBeVisible();
  await mine.getByRole('button', { name: 'NEXT', exact: true }).click();
  const spend = mine.getByRole('group', { name: 'Spend Ability Score Improvement' });
  await spend.getByRole('button', { name: 'OR A FEAT INSTEAD' }).click();
  await expect(spend.getByText('A FEAT INSTEAD OF THE POINTS')).toBeVisible();
  await spend.getByRole('group', { name: 'Pick a Feat instead' }).getByRole('button', { name: 'TOUGH' }).click();
  await expect(mine.getByRole('button', { name: 'FINISH', exact: true })).toBeEnabled();
  await mine.getByRole('button', { name: 'FINISH', exact: true }).click();
  await expect.poll(async () => (await sheetOf())._choices?.feats, { timeout: 15_000 }).toEqual([{ option: 'tough', from: 'asi' }]);
  expect((await sheetOf())._increases).toBeUndefined();

  // On the sheet, under the feature in place of its points; on STATS, Tough's +1 named on Wits.
  await sheetTab(mine, 'CHARACTER');
  await expect(mine.getByRole('group', { name: 'Instead of Ability Score Improvement\'s points' }).getByRole('group', { name: 'Tough' })).toBeVisible({ timeout: 15_000 });
  await sheetTab(mine, 'STATS');
  await expect(mine.getByTitle('12 → 13 (Tough +1)')).toBeVisible({ timeout: 15_000 });
  await context.close();
});
