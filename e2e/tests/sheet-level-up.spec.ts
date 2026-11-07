import { test, expect, type Browser, type TestInfo } from '@playwright/test';
import { signInAsGm, signInAsPlayer, gmToken, asGm, runningSystem, approvedPlayer, sheetTab } from './helpers';

// Going up a level on a custom system (7d2b; approved mockup docs/mockups/level-up.html, 2026-11-07): LEVEL UP READY
// blinks on a player's sheet once their XP reaches the next level, or the GM gives them one, and they go up
// themselves. What's past the level carries over, and the GM can take one back. The player has no + or - to press.

const CLASSES = { id: 'classes', one: 'Class', many: 'Classes', levelled: true, again: true, options: [{ id: 'soldier', label: 'Soldier' }, { id: 'mage', label: 'Mage' }] };
const signedIn = async (browser: Browser, info: TestInfo, player: { username: string; password: string }) => {
  const context = await browser.newContext({ baseURL: info.project.use.baseURL });
  const page = await context.newPage();
  await signInAsPlayer(page, player);
  await page.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true }).click();
  return page;
};
const openSheet = (page: import('@playwright/test').Page) => page.getByRole('button', { name: 'CHARACTER_SHEET', exact: true }).click();

test('XP reaches a level: READY blinks, the player goes up, one class of two, and the rest carries over', async ({ page, browser, request }, info) => {
  test.setTimeout(180_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const wren = { username: `e2e_lvlwren${again}`, password: 'e2e-player-password' };
  const gm = await gmToken(request);
  await runningSystem(request, gm, { format: 1, name: `Upfall${again}`, core: { health: { model: 'pool' }, advancement: ['levels'] }, choices: [CLASSES], levels: { top: 5, first: 100, ranges: [{ to: 5, x: 2 }] } });
  await approvedPlayer(request, gm, wren);
  const sheetOf = async () => (await asGm(request, gm, 'get', `/api/sheets/user/${wren.username}`)).data;

  const mine = await signedIn(browser, info, wren);
  await openSheet(mine);
  await sheetTab(mine, 'CHARACTER');
  const pick = mine.getByRole('group', { name: 'Pick a Class' });
  await pick.getByRole('button', { name: 'SOLDIER' }).click();
  await expect(mine.getByRole('group', { name: 'Soldier' }).getByText('LV 1')).toBeVisible({ timeout: 15_000 });
  await pick.getByRole('button', { name: 'MAGE' }).click();
  await expect(mine.getByRole('group', { name: 'Mage' }).getByText('LV 1')).toBeVisible({ timeout: 15_000 });
  const meter = mine.getByTestId('xp-meter');
  await expect(meter.getByText('0 / 300 · 300 TO LEVEL 3')).toBeVisible({ timeout: 15_000 });
  // Two classes at 1 make level 2. Nothing to press yet, and no + on a class.
  await expect(mine.getByRole('button', { name: /^LEVEL UP/ })).toHaveCount(0);
  await expect(mine.getByRole('button', { name: 'Soldier level up' })).toHaveCount(0);

  await signInAsGm(page);
  await page.getByRole('button', { name: 'GAME', exact: true }).click();
  await page.getByRole('button', { name: 'AWARD_EXPERIENCE' }).click();
  await page.getByLabel('POINTS_EACH').fill('340');
  await page.getByRole('checkbox', { name: wren.username }).check();
  await page.getByRole('button', { name: 'AWARD_SELECTED' }).click();

  // Which goes up is theirs to say.
  const mage = mine.getByRole('button', { name: 'LEVEL UP: MAGE 1 → 2' });
  await expect(mage).toBeVisible({ timeout: 15_000 });
  await expect(mine.getByRole('button', { name: 'LEVEL UP: SOLDIER 1 → 2' })).toBeVisible();
  await expect(mage).toHaveClass(/unread-flash/);
  await mage.click();
  await expect.poll(async () => (await sheetOf())._choices.classes.find((p: { option: string }) => p.option === 'mage').level, { timeout: 15_000 }).toBe(2);
  expect((await sheetOf())._xp).toBe(340);

  // Level 3 now, the 340 still counted, and not yet enough for level 4.
  await expect(meter.getByText('340 / 700 · 360 TO LEVEL 4')).toBeVisible({ timeout: 15_000 });
  await expect(mine.getByRole('button', { name: /^LEVEL UP/ })).toHaveCount(0);

  // The GM takes one back, from the same window; it's enough again, so READY returns.
  await page.getByRole('button', { name: 'LEVEL_DOWN' }).click();
  await expect.poll(async () => (await sheetOf())._choices.classes.find((p: { option: string }) => p.option === 'mage').level, { timeout: 15_000 }).toBe(1);
  await expect(mine.getByRole('button', { name: 'LEVEL UP: MAGE 1 → 2' })).toBeVisible({ timeout: 15_000 });
  await mine.context().close();
});

test('milestone: the GM gives a level, the rail blinks, the player takes it; no XP anywhere', async ({ page, browser, request }, info) => {
  test.setTimeout(180_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const rook = { username: `e2e_lvlrook${again}`, password: 'e2e-player-password' };
  const gm = await gmToken(request);
  await runningSystem(request, gm, {
    format: 1, name: `Milefall${again}`, core: { health: { model: 'pool' }, advancement: ['milestone'] },
    stats: [{ id: 'traits', label: 'TRAITS', stats: [{ id: 'level', label: 'Level', min: 1 }] }],
    levels: { top: 3 },
  });
  await approvedPlayer(request, gm, rook);
  const sheetOf = async () => (await asGm(request, gm, 'get', `/api/sheets/user/${rook.username}`)).data;

  const mine = await signedIn(browser, info, rook);
  const rail = mine.getByRole('button', { name: 'CHARACTER_SHEET', exact: true });
  await expect(rail).toBeVisible();
  // Their sheet is made the first time they open it: a level can only be given to a sheet that's there.
  await openSheet(mine);
  await expect(mine.getByText(/^SHEET.EXE/)).toBeVisible({ timeout: 15_000 });
  await mine.keyboard.press('Escape');
  await expect(mine.getByText(/^SHEET.EXE/)).toHaveCount(0);

  await signInAsGm(page);
  await page.getByRole('button', { name: 'GAME', exact: true }).click();
  await expect(page.getByRole('button', { name: 'AWARD_EXPERIENCE' })).toHaveCount(0);
  await page.getByRole('button', { name: 'LEVEL_UP_PLAYERS' }).click();
  await expect(page.getByText('LEVELS.EXE')).toBeVisible();
  await expect(page.getByLabel('POINTS_EACH')).toHaveCount(0);
  await page.getByRole('checkbox', { name: rook.username }).check();
  await page.getByRole('button', { name: 'LEVEL_UP', exact: true }).click();
  await expect(page.getByText(/level 1 · 1 to take/)).toBeVisible({ timeout: 15_000 });
  expect((await sheetOf())._levels_owed).toBe(1);

  // Their rail blinks with no sheet open, then they take it from the sheet. The level isn't theirs to type.
  await expect(mine.locator('.unread-flash').first()).toBeVisible({ timeout: 15_000 });
  await openSheet(mine);
  await expect(mine.getByTestId('xp-meter')).toHaveCount(0);
  await mine.getByRole('button', { name: 'LEVEL UP READY' }).click();
  await expect.poll(async () => (await sheetOf()).level, { timeout: 15_000 }).toBe(2);
  expect((await sheetOf())._levels_owed).toBeUndefined();
  await expect(mine.getByRole('button', { name: 'LEVEL UP READY' })).toHaveCount(0);
  await expect(mine.getByRole('spinbutton', { name: 'Level' })).not.toBeEditable();
  await expect(mine.getByRole('spinbutton', { name: 'Level' })).toHaveValue('2');

  // LEVEL_DOWN: a level back.
  await page.getByRole('button', { name: 'LEVEL_DOWN' }).click();
  await expect.poll(async () => (await sheetOf()).level, { timeout: 15_000 }).toBe(1);
  await mine.context().close();
});
