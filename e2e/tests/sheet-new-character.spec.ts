import { test, expect, type APIRequestContext, type Locator, type Page, type Browser, type TestInfo } from '@playwright/test';
import { signInAsPlayer, gmToken, asGm, runningSystem, approvedPlayer, sheetTab } from './helpers';

// NEW_CHARACTER.EXE at the table (7c2; approved mockup docs/mockups/new-character.html, 2026-11-03):
// a player with a blank sheet sees CHARACTER_CONTROLS blink, then CHARACTER_SHEET, which opens the
// flow; they walk it, leave, come back to the same step, and finish on their filled-in sheet, never
// blinking again. Another uploads a sheet and is done. A player with a sheet already is never asked.
// Set up through the API, as player-journey is.

const definition = (name: string) => ({
  format: 1,
  name,
  stats: [{ id: 'traits', label: 'TRAITS', stats: [{ id: 'grit', label: 'Grit', min: 3, max: 18 }] }],
  choices: [{ id: 'classes', one: 'Class', many: 'Classes', options: [
    { id: 'soldier', label: 'Soldier' }, { id: 'mage', label: 'Mage', requires: '@grit >= 13' }, { id: 'warden', label: 'Warden', requires: '@grit >= 20' },
  ] }],
  creation: { on: true },
});

const signedIn = async (browser: Browser, info: TestInfo, player: { username: string; password: string }) => {
  const context = await browser.newContext({ baseURL: info.project.use.baseURL });
  const page = await context.newPage();
  await signInAsPlayer(page, player);
  return page;
};
const rail = (page: Page) => page.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true });
const sheetButton = (page: Page) => page.getByRole('button', { name: 'CHARACTER_SHEET', exact: true });
const flow = (page: Page) => page.getByText(/^NEW_CHARACTER\.EXE/);

test('a blank sheet: the blink, the walk, leaving and coming back, and finishing', async ({ browser, request }, info) => {
  const again = info.retry ? `_${info.retry + 1}` : '';
  const player = { username: `e2e_newchar${again}`, password: 'e2e-player-password' };
  const gm = await gmToken(request);
  await runningSystem(request, gm, definition(`Newfall${again}`));
  await approvedPlayer(request, gm, player);
  const stored = async () => (await asGm(request, gm, 'get', `/api/sheets/user/${player.username}`)).data;
  const page = await signedIn(browser, info, player);

  // The rail blinks; opened, the button inside blinks. Nothing pops up over the map.
  await expect(rail(page)).toHaveClass(/unread-flash/, { timeout: 15_000 });
  await expect(flow(page)).toHaveCount(0);
  await rail(page).click();
  await expect(rail(page)).not.toHaveClass(/unread-flash/);
  await expect(sheetButton(page)).toHaveClass(/unread-flash/);

  // The flow opens in place of the sheet, on START.
  await sheetButton(page).click();
  await expect(flow(page)).toBeVisible();
  await expect(page.getByText('A NEW CHARACTER. HOW DO YOU WANT TO START?')).toBeVisible();
  await expect(sheetButton(page)).not.toHaveClass(/unread-flash/);
  await expect(page.getByRole('tab', { name: 'MAKE ONE HERE' })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: 'BEGIN' }).click();

  // WHO THEY ARE: NEXT waits for a name, and the folders after it stay shut until then.
  await expect(page.getByRole('button', { name: 'NEXT' })).toBeDisabled();
  await expect(page.getByRole('tab', { name: 'THE STATS' })).toBeDisabled();
  await page.getByRole('textbox', { name: 'Name' }).fill('Wren');

  // A portrait, uploaded here, reaches the sheet. A 1x1 PNG.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
  await page.getByLabel(/UPLOAD · MAX 8MB/).setInputFiles({ name: 'wren.png', mimeType: 'image/png', buffer: png });
  await expect.poll(async () => (await asGm(request, gm, 'get', `/api/sheets/user/${player.username}`)).portrait_url, { timeout: 15_000 }).toBeTruthy();
  await page.getByRole('button', { name: 'NEXT' }).click();

  // THE STATS: a number out of range holds NEXT, and saying 14 opens MAGE on the step after.
  const grit = page.getByRole('spinbutton', { name: 'Grit' });
  await grit.fill('2');
  await expect(page.getByText('At least 3')).toBeVisible();
  await expect(page.getByRole('button', { name: 'NEXT' })).toBeDisabled();
  await grit.fill('14');
  await expect.poll(async () => (await stored()).grit, { timeout: 15_000 }).toBe(14);
  await page.getByRole('button', { name: 'NEXT' }).click();
  await expect(page.getByRole('tab', { name: 'CLASS' })).toHaveAttribute('aria-selected', 'true');

  // Leave: the sheet, with its line; no blinking, and CHARACTER_SHEET opens the sheet from now on.
  await page.getByRole('button', { name: 'LEAVE FOR NOW' }).click();
  await expect(flow(page)).toHaveCount(0);
  await expect(page.getByText(/^SHEET\.EXE/)).toBeVisible();
  await expect.poll(async () => (await stored())._creating, { timeout: 15_000 }).toEqual({ at: 'list:classes' });
  await page.reload();
  await signInAsPlayer(page, player);
  await expect(rail(page)).not.toHaveClass(/unread-flash/);
  await rail(page).click();
  await expect(sheetButton(page)).not.toHaveClass(/unread-flash/);
  await sheetButton(page).click();
  await expect(page.getByText(/^SHEET\.EXE/)).toBeVisible();

  // Continue: the same step. A class picked, changed for another, then FINISH.
  await page.getByRole('button', { name: 'CREATING · CONTINUE' }).click();
  await expect(flow(page)).toBeVisible();
  const finish = page.getByRole('button', { name: 'FINISH' });
  await expect(finish).toBeDisabled();
  const pick = page.getByRole('region', { name: 'Classes' }).last();
  // Each option on its own line under PICK A CLASS, what one needs level with that one.
  await expect(pick.getByText('PICK A CLASS')).toBeVisible();
  const lineOf = async (l: Locator) => { const b = (await l.boundingBox())!; return b.y + b.height / 2; };
  const lines = await Promise.all(['SOLDIER', 'MAGE', 'WARDEN'].map((name) => lineOf(pick.getByRole('button', { name }))));
  expect(lines[1]).toBeGreaterThan(lines[0]);
  expect(lines[2]).toBeGreaterThan(lines[1]);
  expect(Math.abs(await lineOf(pick.getByText('NEEDS GRIT >= 20')) - lines[2])).toBeLessThan(4);
  // WARDEN is off but still reads, in the color of one that is on.
  const colorOf = (l: Locator) => l.evaluate((el) => getComputedStyle(el).color);
  await expect(pick.getByRole('button', { name: 'WARDEN' })).toBeDisabled();
  expect(await colorOf(pick.getByRole('button', { name: 'WARDEN' }))).toBe(await colorOf(pick.getByRole('button', { name: 'MAGE' })));
  await pick.getByRole('button', { name: 'SOLDIER' }).click();
  await expect(finish).toBeEnabled({ timeout: 15_000 });
  await pick.getByRole('button', { name: 'Drop Soldier' }).click();
  await pick.getByRole('button', { name: 'YES, DROP' }).click();
  await pick.getByRole('button', { name: 'MAGE' }).click();
  await expect.poll(async () => (await stored())._choices?.classes, { timeout: 15_000 }).toEqual([{ option: 'mage' }]);
  await expect(finish).toBeEnabled({ timeout: 15_000 });
  await finish.click();

  // Closed on their sheet, filled in, and it works as it always has.
  await expect(flow(page)).toHaveCount(0);
  await expect.poll(async () => (await stored())._creating, { timeout: 15_000 }).toEqual({ done: true });
  await expect(page.getByRole('button', { name: 'CREATING · CONTINUE' })).toHaveCount(0);
  await sheetTab(page, 'CHARACTER');
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue('Wren');
  await expect(page.getByRole('region', { name: 'Classes' }).getByRole('group', { name: 'Mage' })).toBeVisible();
  await page.context().close();
});

// Walks to a stats step: name first, as the flow asks.
const walkToStats = async (page: Page) => {
  await rail(page).click();
  await sheetButton(page).click();
  await expect(flow(page)).toBeVisible();
  await page.getByRole('button', { name: 'BEGIN' }).click();
  await page.getByLabel('Name', { exact: true }).fill('Wren');
  await page.getByRole('button', { name: 'NEXT' }).click();
};
const GROUPS = [
  { id: 'abilities', label: 'ABILITIES', stats: [{ id: 'grit', label: 'Grit' }] },
  { id: 'skills', label: 'SKILLS', stats: [{ id: 'climb', label: 'Climb' }] },
  { id: 'stress', label: 'STRESS', stats: [{ id: 'worry', label: 'Worry' }] },
];

test('group by group: a step per group, one left out never asked', async ({ browser, request }, info) => {
  const again = info.retry ? `_${info.retry + 1}` : '';
  const player = { username: `e2e_newchar_group${again}`, password: 'e2e-player-password' };
  const gm = await gmToken(request);
  await runningSystem(request, gm, { format: 1, name: `Newfall Groups${again}`, stats: GROUPS, creation: { on: true, statsBy: 'group', off: ['stats:stress'] } });
  await approvedPlayer(request, gm, player);
  const stored = async () => (await asGm(request, gm, 'get', `/api/sheets/user/${player.username}`)).data;
  const page = await signedIn(browser, info, player);
  await walkToStats(page);

  // ABILITIES alone, then SKILLS alone, with no folder for STRESS.
  await expect(page.getByRole('tab', { name: 'ABILITIES' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('tab', { name: 'SKILLS' })).toBeVisible();
  await expect(page.getByRole('tab', { name: 'STRESS' })).toHaveCount(0);
  await expect(page.getByRole('spinbutton', { name: 'Climb' })).toHaveCount(0);
  await page.getByRole('spinbutton', { name: 'Grit' }).fill('4');
  await expect.poll(async () => (await stored()).grit, { timeout: 15_000 }).toBe(4);
  await page.getByRole('button', { name: 'NEXT' }).click();
  await expect.poll(async () => (await stored())._creating, { timeout: 15_000 }).toEqual({ at: 'stats:skills' });
  await expect(page.getByRole('spinbutton', { name: 'Grit' })).toHaveCount(0);
  await page.getByRole('spinbutton', { name: 'Climb' }).fill('2');
  await expect.poll(async () => (await stored()).climb, { timeout: 15_000 }).toBe(2);

  // FINISH asks for nothing of STRESS, and the sheet still has it.
  await page.getByRole('button', { name: 'FINISH' }).click();
  await expect(flow(page)).toHaveCount(0);
  await expect.poll(async () => (await stored())._creating, { timeout: 15_000 }).toEqual({ done: true });
  await sheetTab(page, 'STATS');
  await expect(page.getByLabel('Worry', { exact: true })).toBeVisible();
  await page.context().close();
});

test('one way for all: one step, without a group left out', async ({ browser, request }, info) => {
  const again = info.retry ? `_${info.retry + 1}` : '';
  const player = { username: `e2e_newchar_oneway${again}`, password: 'e2e-player-password' };
  const gm = await gmToken(request);
  await runningSystem(request, gm, { format: 1, name: `Newfall One Way${again}`, stats: GROUPS, creation: { on: true, off: ['stats:stress'] } });
  await approvedPlayer(request, gm, player);
  const page = await signedIn(browser, info, player);
  await walkToStats(page);

  await expect(page.getByRole('tab', { name: 'THE STATS' })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('region', { name: 'ABILITIES' }).getByRole('spinbutton', { name: 'Grit' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'SKILLS' }).getByRole('spinbutton', { name: 'Climb' })).toBeVisible();
  await expect(page.getByRole('spinbutton', { name: 'Worry' })).toHaveCount(0);
  await page.context().close();
});

test('a fixed array: numbers placed, swapped and taken back; locked on the sheet until finished', async ({ browser, request }, info) => {
  const again = info.retry ? `_${info.retry + 1}` : '';
  const player = { username: `e2e_newchar_array${again}`, password: 'e2e-player-password' };
  const gm = await gmToken(request);
  await runningSystem(request, gm, {
    format: 1, name: `Newfall Array${again}`,
    stats: [{ id: 'traits', label: 'TRAITS', stats: [{ id: 'grit', label: 'Grit' }, { id: 'wits', label: 'Wits' }] }],
    creation: { on: true, ways: { stats: { way: 'array', numbers: [15, 14, 9] } } },
  });
  await approvedPlayer(request, gm, player);
  const stored = async () => (await asGm(request, gm, 'get', `/api/sheets/user/${player.username}`)).data;
  const page = await signedIn(browser, info, player);
  await walkToStats(page);

  const pool = page.getByRole('group', { name: 'Numbers to place' });
  const chips = () => pool.getByRole('button').allTextContents();
  const stat = (name: RegExp) => page.getByRole('button', { name });
  const finish = page.getByRole('button', { name: 'FINISH' });
  await expect(pool.getByRole('button')).toHaveCount(3);
  expect(await chips()).toEqual(['15', '14', '9']);
  await expect(finish).toBeDisabled();

  // 15 on Grit, then 14 over it: the 15 goes back.
  await pool.getByRole('button', { name: '15' }).click();
  await stat(/^Grit:/).click();
  await expect(stat(/^Grit: 15/)).toBeVisible();
  await expect.poll(async () => (await stored()).grit, { timeout: 15_000 }).toBe(15);
  await expect(pool.getByRole('button')).toHaveCount(2);
  await pool.getByRole('button', { name: '14' }).click();
  await stat(/^Grit:/).click();
  await expect(stat(/^Grit: 14/)).toBeVisible();
  expect((await chips()).sort()).toEqual(['15', '9']);

  // Clicked with none held, it comes back.
  await stat(/^Grit:/).click();
  await expect(stat(/^Grit: no number yet/)).toBeVisible();
  await expect.poll(async () => (await stored()).grit, { timeout: 15_000 }).toBeUndefined();

  // Grit placed, then left: the sheet shows it, and won't take typing while they make the character.
  await pool.getByRole('button', { name: '15' }).click();
  await stat(/^Grit:/).click();
  await expect(stat(/^Grit: 15/)).toBeVisible();
  await page.getByRole('button', { name: 'LEAVE FOR NOW' }).click();
  await expect(flow(page)).toHaveCount(0);
  await sheetTab(page, 'STATS');
  const onSheet = page.getByLabel('Grit', { exact: true });
  await expect(onSheet).toHaveValue('15');
  await expect(onSheet).not.toBeEditable();

  // Back, the last one placed, a number left over no matter, and finished.
  await page.getByRole('button', { name: 'CREATING · CONTINUE' }).click();
  await expect(flow(page)).toBeVisible();
  await expect(finish).toBeDisabled();
  await pool.getByRole('button', { name: '9' }).click();
  await stat(/^Wits:/).click();
  await expect(finish).toBeEnabled({ timeout: 15_000 });
  await finish.click();
  await expect(flow(page)).toHaveCount(0);
  await expect.poll(async () => (await stored())._creating, { timeout: 15_000 }).toEqual({ done: true });
  expect((await stored()).wits).toBe(9);

  // Finished, the sheet is theirs.
  await sheetTab(page, 'STATS');
  await expect(onSheet).toBeEditable();
  await onSheet.fill('16');
  await expect.poll(async () => (await stored()).grit, { timeout: 15_000 }).toBe(16);
  await page.context().close();
});

// A game whose stats are rolled, and a player on that step.
const rollingTable = async (browser: Browser, request: APIRequestContext, info: TestInfo, placed: string, tag: string) => {
  const again = info.retry ? `_${info.retry + 1}` : '';
  const player = { username: `e2e_newchar_${tag}${again}`, password: 'e2e-player-password' };
  const gm = await gmToken(request);
  await runningSystem(request, gm, {
    format: 1, name: `Newfall ${tag}${again}`,
    core: { health: { model: 'pool' }, dice: ['d6'] },
    stats: [{ id: 'traits', label: 'TRAITS', stats: [{ id: 'grit', label: 'Grit' }, { id: 'wits', label: 'Wits' }] }],
    creation: { on: true, ways: { stats: { way: 'roll', each: '4d6 drop lowest', placed } } },
  });
  await approvedPlayer(request, gm, player);
  const stored = async () => (await asGm(request, gm, 'get', `/api/sheets/user/${player.username}`)).data;
  const page = await signedIn(browser, info, player);
  await walkToStats(page);
  // The name saves a moment after it is typed: a reload before that would lose it, and hold FINISH.
  await expect.poll(async () => (await stored()).name, { timeout: 15_000 }).toBe('Wren');
  return { page, stored, player };
};
const rollThem = (page: Page) => page.getByRole('button', { name: 'ROLL THEM' });

test('rolled in order: on the secure dice, in the tray and on the stats, kept through a reload, saved to the log', async ({ browser, request }, info) => {
  const { page, stored, player } = await rollingTable(browser, request, info, 'order', 'order');
  await expect(page.getByText('4d6 drop lowest for each stat, in order. What comes up is yours.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'FINISH' })).toBeDisabled();
  await rollThem(page).click();

  // Thrown for everyone, what came up on the stats, within what the dice can do, and no second roll.
  await expect(page.getByText('DICE_TRAY.EXE', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/^Rolled, and kept/)).toBeVisible({ timeout: 15_000 });
  await expect(rollThem(page)).toHaveCount(0);
  const data = await stored();
  const [grit, wits] = data._creating.rolled.stats;
  expect([data.grit, data.wits]).toEqual([grit, wits]);
  for (const n of [grit, wits]) { expect(n).toBeGreaterThanOrEqual(3); expect(n).toBeLessThanOrEqual(18); }
  await expect(page.getByRole('group', { name: `Grit: ${grit}` })).toBeVisible();

  // A reload doesn't roll again.
  await page.reload();
  await signInAsPlayer(page, player);
  await rail(page).click();
  await sheetButton(page).click();
  await page.getByRole('button', { name: 'CREATING · CONTINUE' }).click();
  await expect(rollThem(page)).toHaveCount(0);
  await expect(page.getByRole('group', { name: `Wits: ${wits}` })).toBeVisible();
  await page.getByRole('button', { name: 'FINISH' }).click();
  await expect.poll(async () => (await stored())._creating, { timeout: 15_000 }).toEqual({ done: true });

  // Saved to the dice log: since that reload, the history can only have it from the database.
  await page.getByRole('button', { name: 'DICE_ROLLER', exact: true }).click();
  await page.getByRole('button', { name: 'DICE_TRAY.exe' }).click();
  await page.getByTitle('TOGGLE_HISTORY').click();
  await expect(page.getByTestId('dice-history')).toContainText(`rolled THE STATS (4d6 drop lowest): Grit ${grit}, Wits ${wits}`, { timeout: 15_000 });
  await page.context().close();
});

test('rolled to arrange: what came up placed as they like, then finished', async ({ browser, request }, info) => {
  const { page, stored } = await rollingTable(browser, request, info, 'arrange', 'arrange');
  await expect(page.getByText('4d6 drop lowest, once for each stat, then placed as you like.')).toBeVisible();
  await rollThem(page).click();
  const pool = page.getByRole('group', { name: 'Numbers to place' });
  await expect(pool.getByRole('button')).toHaveCount(2, { timeout: 15_000 });
  const data = await stored();
  const [first, second] = data._creating.rolled.stats;
  expect([data.grit, data.wits]).toEqual([undefined, undefined]);
  const finish = page.getByRole('button', { name: 'FINISH' });
  await expect(finish).toBeDisabled();

  // The second number on the first stat: theirs to arrange.
  await pool.getByRole('button').nth(1).click();
  await page.getByRole('button', { name: /^Grit:/ }).click();
  await expect.poll(async () => (await stored()).grit, { timeout: 15_000 }).toBe(second);
  await expect(pool.getByRole('button')).toHaveCount(1);
  await pool.getByRole('button').first().click();
  await page.getByRole('button', { name: /^Wits:/ }).click();
  await expect.poll(async () => (await stored()).wits, { timeout: 15_000 }).toBe(first);
  await expect(finish).toBeEnabled({ timeout: 15_000 });
  await finish.click();
  await expect.poll(async () => (await stored())._creating, { timeout: 15_000 }).toEqual({ done: true });
  await page.context().close();
});

test('a point buy: from the lowest, by the table, as far as the points go; locked on the sheet until finished', async ({ browser, request }, info) => {
  const again = info.retry ? `_${info.retry + 1}` : '';
  const player = { username: `e2e_newchar_buy${again}`, password: 'e2e-player-password' };
  const gm = await gmToken(request);
  await runningSystem(request, gm, {
    format: 1, name: `Newfall Buy${again}`,
    stats: [{ id: 'traits', label: 'TRAITS', stats: [{ id: 'grit', label: 'Grit' }, { id: 'wits', label: 'Wits' }] }],
    creation: { on: true, ways: { stats: { way: 'buy', points: 5, lowest: 8, highest: 12, costs: { 8: 0, 9: 1, 10: 2, 11: 4, 12: 6 } } } },
  });
  await approvedPlayer(request, gm, player);
  const stored = async () => (await asGm(request, gm, 'get', `/api/sheets/user/${player.username}`)).data;
  const page = await signedIn(browser, info, player);
  await walkToStats(page);

  // Arriving, each is at its lowest with every point left, and the server has them so.
  const left = page.getByRole('tabpanel').getByRole('status');
  const up = (name: string) => page.getByRole('button', { name: `${name} up` });
  const down = (name: string) => page.getByRole('button', { name: `${name} down` });
  await expect(left).toHaveText('5 OF 5 POINTS LEFT');
  await expect.poll(async () => (await stored()).grit, { timeout: 15_000 }).toBe(8);
  await expect(down('Grit')).toBeDisabled();

  // Up by the table: 11 costs 4, so 1 is left, and 12 costs more than that.
  for (const shows of ['Grit: 9', 'Grit: 10', 'Grit: 11']) {
    await up('Grit').click();
    await expect(page.getByRole('group', { name: shows })).toBeVisible();
  }
  await expect(left).toHaveText('1 OF 5 POINTS LEFT');
  await expect(up('Grit')).toBeDisabled();
  await up('Wits').click();
  await expect(left).toHaveText('0 OF 5 POINTS LEFT');
  await expect(up('Wits')).toBeDisabled();
  await expect.poll(async () => { const d = await stored(); return [d.grit, d.wits]; }, { timeout: 15_000 }).toEqual([11, 9]);

  // Down gives it back.
  await down('Wits').click();
  await expect(left).toHaveText('1 OF 5 POINTS LEFT');

  // Left: the sheet shows it, and won't take typing while they make the character.
  await page.getByRole('button', { name: 'LEAVE FOR NOW' }).click();
  await expect(flow(page)).toHaveCount(0);
  await sheetTab(page, 'STATS');
  const onSheet = page.getByLabel('Grit', { exact: true });
  await expect(onSheet).toHaveValue('11');
  await expect(onSheet).not.toBeEditable();

  // Back, a point left over no matter, and finished: the sheet is theirs.
  await page.getByRole('button', { name: 'CREATING · CONTINUE' }).click();
  await expect(left).toHaveText('1 OF 5 POINTS LEFT');
  await page.getByRole('button', { name: 'FINISH' }).click();
  await expect(flow(page)).toHaveCount(0);
  await expect.poll(async () => (await stored())._creating, { timeout: 15_000 }).toEqual({ done: true });
  await sheetTab(page, 'STATS');
  await expect(onSheet).toBeEditable();
  await page.context().close();
});

test('kits: everyone\'s and the one picked land in the inventory on finishing; one not met is off; the GM\'s never shown', async ({ browser, request }, info) => {
  const again = info.retry ? `_${info.retry + 1}` : '';
  const player = { username: `e2e_newchar_kits${again}`, password: 'e2e-player-password' };
  const gm = await gmToken(request);
  await runningSystem(request, gm, {
    format: 1, name: `Newfall Kits${again}`,
    stats: [{ id: 'traits', label: 'TRAITS', stats: [{ id: 'grit', label: 'Grit' }] }],
    creation: { on: true, kits: [
      { id: 'essentials', name: 'ESSENTIALS', items: [{ name: 'Knife', qty: 1 }], who: 'all' },
      { id: 'traveler', name: 'TRAVELER', items: [{ name: 'Rope', qty: 1 }, { name: 'Rations', qty: 3 }], who: 'pick' },
      { id: 'potions', name: 'POTION MAKER', items: [{ name: 'Mortar', qty: 1 }], who: 'needs', requires: '@grit >= 13' },
      { id: 'rook', name: 'ROOK', items: [{ name: 'Sealed letter', qty: 1 }], who: 'gm' },
    ] },
  });
  await approvedPlayer(request, gm, player);
  const stored = async () => (await asGm(request, gm, 'get', `/api/sheets/user/${player.username}`)).data;
  const page = await signedIn(browser, info, player);
  await walkToStats(page);

  // Below the requirement.
  await page.getByRole('spinbutton', { name: 'Grit' }).fill('4');
  await expect.poll(async () => (await stored()).grit, { timeout: 15_000 }).toBe(4);
  await page.getByRole('button', { name: 'NEXT' }).click();
  await expect(page.getByRole('tab', { name: 'KITS' })).toHaveAttribute('aria-selected', 'true');

  // What everyone gets said; one off, what it needs beside it; the GM's nowhere.
  await expect(page.getByText('Everyone gets ESSENTIALS: Knife.')).toBeVisible();
  const picks = page.getByRole('group', { name: 'Kits to pick from' });
  await expect(picks.getByRole('button', { name: 'POTION MAKER' })).toBeDisabled();
  await expect(picks.getByText('NEEDS GRIT >= 13')).toBeVisible();
  await expect(page.getByText('ROOK')).toHaveCount(0);
  const finish = page.getByRole('button', { name: 'FINISH' });
  await expect(finish).toBeDisabled();

  // Picked, nothing lands yet; back up to meet it, and it takes the other's place.
  await picks.getByRole('button', { name: 'TRAVELER' }).click();
  await expect(finish).toBeEnabled({ timeout: 15_000 });
  expect((await stored()).inventory).toBeUndefined();
  await page.getByRole('tab', { name: 'THE STATS' }).click();
  await page.getByRole('spinbutton', { name: 'Grit' }).fill('14');
  await expect.poll(async () => (await stored()).grit, { timeout: 15_000 }).toBe(14);
  await page.getByRole('tab', { name: 'KITS' }).click();
  await expect(picks.getByRole('button', { name: 'POTION MAKER' })).toBeEnabled({ timeout: 15_000 });
  await picks.getByRole('button', { name: 'POTION MAKER' }).click();
  await expect(picks.getByRole('button', { name: 'POTION MAKER' })).toHaveAttribute('aria-pressed', 'true');
  await picks.getByRole('button', { name: 'TRAVELER' }).click();
  await expect(picks.getByRole('button', { name: 'TRAVELER' })).toHaveAttribute('aria-pressed', 'true');

  // Finished: each its own line, on the sheet's GEAR, none of the other kit.
  await finish.click();
  await expect(flow(page)).toHaveCount(0);
  await expect.poll(async () => (await stored())._creating, { timeout: 15_000 }).toEqual({ done: true });
  const held = JSON.parse((await stored()).inventory).map((i: { name: string; qty: number }) => [i.name, i.qty]);
  expect(held).toEqual([['Knife', 1], ['Rope', 1], ['Rations', 3]]);
  await sheetTab(page, 'GEAR');
  await expect(page.locator('input').and(page.locator('[value="Rations"]'))).toHaveCount(1);
  await page.context().close();
});

test('an upload is taken as it is, and no steps follow', async ({ browser, request }, info) => {
  const again = info.retry ? `_${info.retry + 1}` : '';
  const player = { username: `e2e_uploader${again}`, password: 'e2e-player-password' };
  const gm = await gmToken(request);
  await runningSystem(request, gm, definition(`Uploadfall${again}`));
  await approvedPlayer(request, gm, player);
  const stored = async () => (await asGm(request, gm, 'get', `/api/sheets/user/${player.username}`)).data;
  const page = await signedIn(browser, info, player);

  await expect(rail(page)).toHaveClass(/unread-flash/, { timeout: 15_000 });
  await rail(page).click();
  await sheetButton(page).click();
  await page.getByRole('tab', { name: 'UPLOAD A SHEET' }).click();
  await page.getByRole('button', { name: 'CHOOSE A SHEET' }).click();
  // A stat under its range comes in as it is: no rules checked.
  await page.getByRole('textbox', { name: 'Paste JSON or a stat block' }).fill(JSON.stringify({ name: 'Rook', grit: 1 }));
  await page.getByRole('button', { name: 'PREVIEW', exact: true }).click();
  await page.getByRole('button', { name: /REPLACE SHEET WITH/ }).click();

  await expect(flow(page)).toHaveCount(0, { timeout: 15_000 });
  await expect(page.getByText(/^SHEET\.EXE/)).toBeVisible();
  await expect.poll(async () => (await stored())._creating, { timeout: 15_000 }).toEqual({ done: true, uploaded: true });
  const data = await stored();
  expect(data.name).toBe('Rook');
  expect(data.grit).toBe(1);
  await expect(page.getByRole('button', { name: 'CREATING · CONTINUE' })).toHaveCount(0);
  await page.context().close();
});

test('someone with a sheet already is never asked', async ({ browser, request }, info) => {
  const again = info.retry ? `_${info.retry + 1}` : '';
  const player = { username: `e2e_veteran${again}`, password: 'e2e-player-password' };
  const gm = await gmToken(request);
  // Their character came first, in a game with the flow off; the GM turns it on afterwards.
  const id = await runningSystem(request, gm, { ...definition(`Veteranfall${again}`), creation: undefined });
  await approvedPlayer(request, gm, player);
  const page = await signedIn(browser, info, player);
  await rail(page).click();
  await sheetButton(page).click();
  await sheetTab(page, 'CHARACTER');
  await page.getByLabel('Name', { exact: true }).fill('Old Hand');
  await expect.poll(async () => (await asGm(request, gm, 'get', `/api/sheets/user/${player.username}`)).data.name, { timeout: 15_000 }).toBe('Old Hand');
  await asGm(request, gm, 'put', `/api/systems/${id}/draft`, { definition: definition(`Veteranfall${again}`) });
  await asGm(request, gm, 'post', `/api/systems/${id}/publish`);

  await page.reload();
  await signInAsPlayer(page, player);
  await rail(page).click();
  await sheetButton(page).click();
  await expect(page.getByText(/^SHEET\.EXE/)).toBeVisible();
  await expect(flow(page)).toHaveCount(0);
  await expect(rail(page)).not.toHaveClass(/unread-flash/);
  await expect(page.getByRole('button', { name: 'CREATING · CONTINUE' })).toHaveCount(0);
  await page.context().close();
});
