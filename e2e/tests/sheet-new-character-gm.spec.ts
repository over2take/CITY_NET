import { test, expect, type Browser, type Page, type TestInfo } from '@playwright/test';
import { signInAsGm, signInAsPlayer, gmToken, asGm, runningSystem, approvedPlayer } from './helpers';

// The GM's side of NEW_CHARACTER.EXE (7c5; approved mockup docs/mockups/new-character.html): on a
// player's sheet, where they are, SKIP IT, and START OVER, which asks first and takes back what FINISH
// gave. Set up through the API, as player-journey is.

const definition = (name: string) => ({
  format: 1,
  name,
  stats: [{ id: 'traits', label: 'TRAITS', stats: [{ id: 'grit', label: 'Grit', min: 3, max: 18 }] }],
  creation: {
    on: true,
    kits: [{ id: 'basics', name: 'BASICS', who: 'all', items: [{ name: 'Rope', qty: 2 }] }],
    money: { main: { how: 'number', amount: 50 } },
  },
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
/** The GM opens a player's sheet the way the app offers: GLOBAL_CHAT, their name, OPEN_SHEET. */
const openTheirSheet = async (page: Page, username: string) => {
  await page.getByRole('button', { name: 'GLOBAL_CHAT', exact: true }).click();
  await page.getByText(username, { exact: true }).first().click();
  await page.getByRole('button', { name: 'VIEW_PLAYER_INFO', exact: true }).click();
  await page.getByRole('button', { name: 'OPEN_SHEET', exact: true }).click();
};

test('the GM sees where a player is and skips it; another, finished, is started over and gives it all back', async ({ page, browser, request }, info) => {
  test.setTimeout(180_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const skipped = { username: `e2e_gmskip${again}`, password: 'e2e-player-password' };
  const redone = { username: `e2e_gmredo${again}`, password: 'e2e-player-password' };
  const gm = await gmToken(request);
  await runningSystem(request, gm, definition(`Gmfall${again}`));
  await approvedPlayer(request, gm, skipped);
  await approvedPlayer(request, gm, redone);
  const stored = async (who: { username: string }) => (await asGm(request, gm, 'get', `/api/sheets/user/${who.username}`)).data;

  // One opens the flow and stops on the second step.
  const skipping = await signedIn(browser, info, skipped);
  await rail(skipping).click();
  await sheetButton(skipping).click();
  await skipping.getByRole('button', { name: 'BEGIN' }).click();
  await skipping.getByRole('textbox', { name: 'Name' }).fill('Halfway');
  await skipping.getByRole('button', { name: 'NEXT' }).click();
  await expect.poll(async () => (await stored(skipped))._creating?.at, { timeout: 15_000 }).toBe('stats');

  // The other walks all of it, and FINISH pays and gives.
  const redoing = await signedIn(browser, info, redone);
  await rail(redoing).click();
  await sheetButton(redoing).click();
  await redoing.getByRole('button', { name: 'BEGIN' }).click();
  await redoing.getByRole('textbox', { name: 'Name' }).fill('Done Before');
  await redoing.getByRole('button', { name: 'NEXT' }).click();
  await redoing.getByRole('spinbutton', { name: 'Grit' }).fill('12');
  await redoing.getByRole('button', { name: 'NEXT' }).click();
  await redoing.getByRole('button', { name: 'NEXT' }).click();
  await redoing.getByRole('button', { name: 'FINISH' }).click();
  await expect(flow(redoing)).toHaveCount(0);
  await expect.poll(async () => (await stored(redone)).cash, { timeout: 15_000 }).toBe(50);
  expect(JSON.parse((await stored(redone)).inventory).map((i: { name: string; qty: number }) => [i.name, i.qty])).toEqual([['Rope', 2]]);

  await signInAsGm(page);

  // SKIP IT, seen from where they are. Their window closes on their sheet.
  await openTheirSheet(page, skipped.username);
  const line = page.getByRole('group', { name: 'New character' });
  await expect(line.getByText('CREATING · STEP 2 OF 4 · THE STATS')).toBeVisible();
  await line.getByRole('button', { name: 'SKIP IT' }).click();
  await expect(line.getByText('NEW CHARACTER · SKIPPED BY THE GM')).toBeVisible({ timeout: 15_000 });
  await expect(line.getByRole('button', { name: 'SKIP IT' })).toHaveCount(0);
  await expect(flow(skipping)).toHaveCount(0);
  const after = await stored(skipped);
  expect(after._creating).toEqual({ done: true, skipped: true });
  expect(after.name).toBe('Halfway');
  expect(after.cash ?? 0).toBe(0);

  // START OVER on the finished one: it says what it takes back, and CANCEL changes nothing.
  await signInAsGm(page);
  await openTheirSheet(page, redone.username);
  await expect(line.getByText('NEW CHARACTER · FINISHED')).toBeVisible();
  await line.getByRole('button', { name: 'START OVER' }).click();
  const asking = line.getByRole('alertdialog', { name: 'START OVER' });
  await expect(asking.getByText(/takes back what FINISH gave: 2x Rope, 50\./)).toBeVisible();
  await asking.getByRole('button', { name: 'CANCEL' }).click();
  await expect(asking).toHaveCount(0);
  expect((await stored(redone)).name).toBe('Done Before');
  await line.getByRole('button', { name: 'START OVER' }).click();
  await asking.getByRole('button', { name: 'START OVER' }).click();

  // Everything the flow wrote and gave is gone, and the line says so.
  await expect(line.getByText('CREATING · STARTED OVER, NOT OPENED YET')).toBeVisible({ timeout: 15_000 });
  await expect.poll(async () => (await stored(redone)).cash ?? 0, { timeout: 15_000 }).toBe(0);
  const cleared = await stored(redone);
  expect(cleared.name).toBeUndefined();
  expect(cleared.grit).toBeUndefined();
  expect(JSON.parse(cleared.inventory)).toEqual([]);

  // Their sheet, open as it happened, says so; and coming back later the buttons blink, opening from the top.
  await expect(redoing.getByRole('button', { name: 'CREATING · CONTINUE' })).toBeVisible({ timeout: 15_000 });
  await signInAsPlayer(redoing, redone);
  await expect(rail(redoing)).toHaveClass(/unread-flash/, { timeout: 15_000 });
  await rail(redoing).click();
  await sheetButton(redoing).click();
  await expect(flow(redoing)).toBeVisible();
  await redoing.getByRole('button', { name: 'BEGIN' }).click();
  await redoing.getByRole('textbox', { name: 'Name' }).fill('Second Go');
  await redoing.getByRole('button', { name: 'NEXT' }).click();
  await redoing.getByRole('spinbutton', { name: 'Grit' }).fill('9');
  await redoing.getByRole('button', { name: 'NEXT' }).click();
  await redoing.getByRole('button', { name: 'NEXT' }).click();
  await redoing.getByRole('button', { name: 'FINISH' }).click();

  // Finishing again gives it once more, not twice over.
  await expect.poll(async () => (await stored(redone)).cash, { timeout: 15_000 }).toBe(50);
  expect(JSON.parse((await stored(redone)).inventory).map((i: { name: string; qty: number }) => [i.name, i.qty])).toEqual([['Rope', 2]]);
  await expect(line.getByText('NEW CHARACTER · FINISHED')).toBeVisible({ timeout: 15_000 });
});

const rollDefinition = (name: string) => ({
  format: 1,
  name,
  stats: [{ id: 'traits', label: 'TRAITS', stats: [{ id: 'grit', label: 'Grit', min: 3, max: 18 }] }],
  choices: [{ id: 'jobs', one: 'Job', many: 'Jobs', options: [
    { id: 'dockhand', label: 'Dockhand', gives: { items: [{ name: 'Crowbar', qty: 1 }], money: { main: { how: 'roll', each: '1d4' } } } },
  ] }],
  creation: {
    on: true,
    ways: { stats: { way: 'roll', each: '3d6', placed: 'order' } },
    kits: [{ id: 'hard', name: 'HARD', who: 'needs', requires: '@grit >= 99', items: [{ name: 'Rope', qty: 1 }] }],
    money: { main: { how: 'roll', each: '1d6 * 10' } },
  },
});

test('the GM clears a kept roll, and the player rolls it again with the old roll still in the log', async ({ page, browser, request }, info) => {
  test.setTimeout(180_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const player = { username: `e2e_gmclear${again}`, password: 'e2e-player-password' };
  const gm = await gmToken(request);
  await runningSystem(request, gm, rollDefinition(`Clearfall${again}`));
  await approvedPlayer(request, gm, player);
  const stored = async () => (await asGm(request, gm, 'get', `/api/sheets/user/${player.username}`)).data;

  // The player rolls their stats and money, each kept with no way to roll again.
  const mine = await signedIn(browser, info, player);
  await rail(mine).click();
  await sheetButton(mine).click();
  await mine.getByRole('button', { name: 'BEGIN' }).click();
  await mine.getByRole('textbox', { name: 'Name' }).fill('Wren');
  await mine.getByRole('button', { name: 'NEXT' }).click();
  await mine.getByRole('button', { name: 'ROLL THEM' }).click();
  await expect(mine.getByText('Rolled, and kept. Your GM can clear it for another go.')).toBeVisible({ timeout: 15_000 });
  const first = (await stored()).grit;
  await expect(mine.getByRole('button', { name: 'ROLL THEM' })).toHaveCount(0);

  // The GM clears it, and tells them: their button is back, the number gone.
  await signInAsGm(page);
  await openTheirSheet(page, player.username);
  await page.getByRole('group', { name: 'New character' }).getByRole('button', { name: 'FILL IT IN FOR THEM' }).click();
  await expect(page.getByText('FILLING IT IN FOR THEM. EVERY LIMIT IS OFF.')).toBeVisible();
  await page.getByRole('tab', { name: /THE STATS/ }).click();
  await expect(page.getByText(new RegExp(`^Rolled ${first}\\.`))).toBeVisible({ timeout: 15_000 });
  await page.getByRole('button', { name: 'CLEAR THE ROLL' }).click();
  await expect.poll(async () => (await stored()).grit, { timeout: 15_000 }).toBeUndefined();
  await expect(mine.getByRole('button', { name: 'ROLL THEM' })).toBeVisible({ timeout: 15_000 });
  await expect(mine.getByRole('button', { name: 'NEXT' })).toBeDisabled();

  // They roll again, and the log keeps both.
  await mine.getByRole('button', { name: 'ROLL THEM' }).click();
  await expect.poll(async () => (await stored())._creating.rolled?.stats?.length, { timeout: 15_000 }).toBe(1);
  await mine.getByTitle('TOGGLE_HISTORY').click();
  await expect(mine.getByTestId('dice-history').getByText(/rolled THE STATS \(3d6\)/)).toHaveCount(2, { timeout: 15_000 });
});

test('the GM fills in a whole character for a player, with every limit off', async ({ page, browser, request }, info) => {
  test.setTimeout(180_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const player = { username: `e2e_gmfill${again}`, password: 'e2e-player-password' };
  const gm = await gmToken(request);
  await runningSystem(request, gm, rollDefinition(`Fillfall${again}`));
  await approvedPlayer(request, gm, player);
  const stored = async () => (await asGm(request, gm, 'get', `/api/sheets/user/${player.username}`)).data;
  const theirs = await signedIn(browser, info, player);
  await expect(rail(theirs)).toHaveClass(/unread-flash/, { timeout: 15_000 });

  await signInAsGm(page);
  await openTheirSheet(page, player.username);
  const line = page.getByRole('group', { name: 'New character' });
  await expect(line.getByText('CREATING · NOT OPENED YET')).toBeVisible();
  await line.getByRole('button', { name: 'FILL IT IN FOR THEM' }).click();

  // Every folder open from the first, nothing answered.
  await expect(page.getByText(new RegExp(`^NEW_CHARACTER\\.EXE · ${player.username.toUpperCase()} \\[GM\\]`))).toBeVisible();
  const folder = (name: RegExp) => page.getByRole('tab', { name });
  for (const name of [/THE STATS/, /JOB/, /KITS/, /MONEY/]) await expect(folder(name)).toBeEnabled();

  // A stat typed, past its most and in a game that rolls them.
  await page.getByRole('textbox', { name: 'Name' }).last().fill('Filled In');
  await folder(/THE STATS/).click();
  await page.getByRole('spinbutton', { name: 'Grit' }).last().fill('99');
  await expect.poll(async () => (await stored()).grit, { timeout: 15_000 }).toBe(99);

  // An option, its money left unrolled, and a kit they don't meet.
  await folder(/JOB/).click();
  await page.getByRole('group', { name: 'Pick a Job' }).getByRole('button', { name: 'DOCKHAND' }).click();
  await expect(page.getByRole('group', { name: 'What Dockhand gives' })).toBeVisible({ timeout: 15_000 });
  await folder(/KITS/).click();
  await page.getByRole('group', { name: 'Kits to pick from' }).getByRole('button', { name: 'HARD' }).click();
  await expect.poll(async () => (await stored())._creating.kit, { timeout: 15_000 }).toBe('hard');

  // FINISH with nothing rolled: both rolls made then, paid, and everything given.
  await folder(/MONEY/).click();
  await page.getByRole('button', { name: 'FINISH' }).click();
  await expect(page.getByText('FILLING IT IN FOR THEM. EVERY LIMIT IS OFF.')).toHaveCount(0);
  await expect(line.getByText('NEW CHARACTER · FINISHED')).toBeVisible({ timeout: 15_000 });
  await expect.poll(async () => (await stored()).cash ?? 0, { timeout: 15_000 }).toBeGreaterThanOrEqual(11);
  const done = await stored();
  expect(done.cash).toBeLessThanOrEqual(64);
  expect(done.name).toBe('Filled In');
  expect(done.grit).toBe(99);
  expect(JSON.parse(done.inventory).map((i: { name: string }) => i.name).sort()).toEqual(['Crowbar', 'Rope']);

  // The player is no longer asked.
  await expect(rail(theirs)).not.toHaveClass(/unread-flash/, { timeout: 15_000 });
});
