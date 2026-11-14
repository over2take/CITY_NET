import { test, expect, type Browser, type TestInfo } from '@playwright/test';
import { signInAsGm, signInAsPlayer, gmToken, asGm, runningSystem, approvedPlayer } from './helpers';

// XP on a custom system (7d2a; approved mockup docs/mockups/level-up.html, 2026-11-07): the GM gives it from the
// window beside PAY_PLAYERS, to one player or several, EACH or SPLIT, and can SET it to another number. A player
// watches the meter on their sheet move, in cells like the HP bar's, with no box to type it in.

const definition = (name: string) => ({
  format: 1,
  name,
  core: { health: { model: 'pool' }, advancement: ['levels'] },
  words: { xp: { singular: 'MARK', plural: 'MARKS', short: 'MK' } },
  stats: [{ id: 'traits', label: 'TRAITS', stats: [{ id: 'level', label: 'Level', min: 1 }] }],
  levels: { top: 5, first: 100, ranges: [{ to: 5, x: 2 }] },
});
const signedIn = async (browser: Browser, info: TestInfo, player: { username: string; password: string }) => {
  const context = await browser.newContext({ baseURL: info.project.use.baseURL });
  const page = await context.newPage();
  await signInAsPlayer(page, player);
  await page.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true }).click();
  await page.getByRole('button', { name: 'CHARACTER_SHEET', exact: true }).click();
  return page;
};

test('the GM gives XP to players, each or split, and sets it; the meter follows and carries over', async ({ page, browser, request }, info) => {
  test.setTimeout(180_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const wren = { username: `e2e_xpwren${again}`, password: 'e2e-player-password' };
  const rook = { username: `e2e_xprook${again}`, password: 'e2e-player-password' };
  const gm = await gmToken(request);
  await runningSystem(request, gm, definition(`Xpfall${again}`));
  await approvedPlayer(request, gm, wren);
  await approvedPlayer(request, gm, rook);
  const xpOf = async (who: { username: string }) => (await asGm(request, gm, 'get', `/api/sheets/user/${who.username}`)).data._xp;

  const mine = await signedIn(browser, info, wren);
  const theirs = await signedIn(browser, info, rook);
  const meter = mine.getByTestId('xp-meter');
  await expect(meter.getByText('0 / 100 · 100 TO LEVEL 2')).toBeVisible({ timeout: 15_000 });
  await expect(meter.getByText('MK', { exact: true })).toBeVisible();
  // 100 to level 2 is more than 40 points, so twenty cells, in line with the HP bar.
  await expect(meter.getByRole('img').locator('div')).toHaveCount(20);
  await expect(meter.locator('[data-lit]')).toHaveCount(0);

  await signInAsGm(page);
  await page.getByRole('button', { name: 'GAME', exact: true }).click();
  await page.getByRole('button', { name: 'AWARD_EXPERIENCE' }).click();
  await expect(page.getByText('MK.EXE')).toBeVisible();
  const award = page;
  await expect(award.getByRole('checkbox', { name: wren.username })).toBeVisible({ timeout: 15_000 });

  // One player, the amount each.
  await award.getByLabel('POINTS_EACH').fill('50');
  await award.getByRole('checkbox', { name: wren.username }).check();
  await award.getByRole('button', { name: 'AWARD_SELECTED' }).click();
  await expect.poll(() => xpOf(wren), { timeout: 15_000 }).toBe(50);
  await expect(meter.getByText('50 / 100 · 50 TO LEVEL 2')).toBeVisible({ timeout: 15_000 });
  await expect(meter.locator('[data-lit]')).toHaveCount(10);
  expect(await xpOf(rook)).toBeUndefined();

  // Several, split, with what won't divide said.
  await award.getByRole('button', { name: 'SPLIT' }).click();
  await award.getByLabel('POINTS_TO_SPLIT').fill('101');
  await award.getByRole('checkbox', { name: rook.username }).check();
  await award.getByRole('button', { name: 'AWARD_SELECTED' }).click();
  await expect(award.getByText("1 LEFT OVER: IT WOULDN'T DIVIDE")).toBeVisible({ timeout: 15_000 });
  await expect.poll(() => xpOf(rook), { timeout: 15_000 }).toBe(50);
  await expect.poll(() => xpOf(wren), { timeout: 15_000 }).toBe(100);
  await expect(theirs.getByTestId('xp-meter').getByText('50 / 100 · 50 TO LEVEL 2')).toBeVisible({ timeout: 15_000 });

  // Past a level: full, and what's over is said.
  await award.getByRole('button', { name: 'EACH', exact: true }).click();
  await award.getByRole('checkbox', { name: rook.username }).uncheck();
  await award.getByLabel('POINTS_EACH').fill('30');
  await award.getByRole('button', { name: 'AWARD_SELECTED' }).click();
  await expect(meter.getByText('130 / 100 · ENOUGH FOR LEVEL 2 · 30 CARRIES OVER')).toBeVisible({ timeout: 15_000 });
  await expect(meter.locator('[data-lit]')).toHaveCount(20);

  // SET it to another number. A mistake put right.
  await award.getByLabel(/^Replace what the selected/).fill('20');
  await award.getByRole('button', { name: 'SET_MK_TO' }).click();
  await expect.poll(() => xpOf(wren), { timeout: 15_000 }).toBe(20);
  await expect(meter.getByText('20 / 100 · 80 TO LEVEL 2')).toBeVisible({ timeout: 15_000 });

  // A player has nothing to type it in: only the meter.
  await expect(mine.getByRole('spinbutton', { name: 'MK' })).toHaveCount(0);
  await mine.context().close();
  await theirs.context().close();
});
