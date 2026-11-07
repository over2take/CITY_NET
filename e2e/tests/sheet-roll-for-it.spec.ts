import { test, expect, type Locator } from '@playwright/test';
import { signInAsGm, signInAsPlayer, gmToken, asGm, runningSystem, approvedPlayer, sheetTab } from './helpers';

// ROLL FOR IT at the table (7a5b2; approved mockup docs/mockups/nested-choices.html, version 2): a
// game whose BACKGROUNDS are rolled only. The player can't pick one by hand; ROLL FOR IT rolls on the
// server, the dice tray throwing it, and the result is picked and locked with a second roll refused
// them. Taken, it is their background. Set up through the API, as player-journey is.

const definition = (name: string) => ({
  format: 1,
  name,
  core: { health: { model: 'pool' }, dice: ['d6'] },
  choices: [{ id: 'backgrounds', one: 'Background', many: 'Backgrounds', table: 'd6', players: 'roll', options: [
    { id: 'dockhand', label: 'Dockhand', roll: '1-3' }, { id: 'scribe', label: 'Scribe', roll: '4-6' },
  ] }],
});

test('a background rolled for, thrown in the tray, and locked in; picking by hand is off', async ({ browser, request }, info) => {
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
  // The table is there to read: the dice, and each option's range on its line.
  await expect(pick.getByText('PICK A BACKGROUND (d6)')).toBeVisible();
  const lineOf = async (l: Locator) => { const b = (await l.boundingBox())!; return b.y + b.height / 2; };
  expect(Math.abs(await lineOf(pick.getByText('4-6', { exact: true })) - await lineOf(pick.getByRole('button', { name: 'SCRIBE' })))).toBeLessThan(4);
  expect(await lineOf(pick.getByText('1-3', { exact: true }))).toBeLessThan(await lineOf(pick.getByText('4-6', { exact: true })));
  // The boxes line up, the same width, wherever the ranges sit.
  const boxes = await Promise.all(['DOCKHAND', 'SCRIBE'].map((name) => pick.getByRole('button', { name }).boundingBox()));
  expect(boxes[0]!.x).toBe(boxes[1]!.x);
  expect(boxes[0]!.width).toBe(boxes[1]!.width);
  await pick.getByRole('button', { name: 'ROLL FOR IT' }).click();

  // The tray throws it, and it is theirs at once, locked: no second roll, no way to change it.
  await expect(sheet.getByText('DICE_TRAY.EXE', { exact: true })).toBeVisible({ timeout: 15_000 });
  await expect.poll(async () => (await stored())._choices?.backgrounds?.length, { timeout: 15_000 }).toBe(1);
  const [held] = (await stored())._choices.backgrounds;
  expect(held.locked).toBe(true);
  expect((await stored())._rolled).toBeUndefined();
  const named = held.option === 'dockhand' ? 'Dockhand' : 'Scribe';
  expect(held.roll).toBeGreaterThanOrEqual(held.option === 'dockhand' ? 1 : 4);
  expect(held.roll).toBeLessThanOrEqual(held.option === 'dockhand' ? 3 : 6);
  await sheet.keyboard.press('Escape');
  const card = sheet.getByRole('region', { name: 'Backgrounds' }).getByRole('group', { name: named });
  await expect(card.getByText(`ROLLED ${held.roll}, AND KEPT. YOUR GM CAN CLEAR IT FOR ANOTHER GO.`)).toBeVisible();
  await expect(card.getByRole('button', { name: `Drop ${named}` })).toHaveCount(0);
  await expect(pick).toHaveCount(0);
  await context.close();
});

// The user's flow (2026-11-06): the player rolls, the roll locks it in, they ask the GM, and the GM clears
// it for them to roll again, rolls again for them, or picks one by hand. Each of the three, in turn.
test('a roll locked in: the GM clears it, rolls again, or picks one by hand', async ({ page, browser, request }, info) => {
  test.setTimeout(180_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const player = { username: `e2e_rolllock${again}`, password: 'e2e-player-password' };
  const gm = await gmToken(request);
  const system = definition(`Lockfall${again}`);
  await runningSystem(request, gm, { ...system, choices: system.choices.map(({ players: _players, ...c }) => c) });
  await approvedPlayer(request, gm, player);
  const stored = async () => (await asGm(request, gm, 'get', `/api/sheets/user/${player.username}`)).data;
  const held = async () => (await stored())._choices?.backgrounds ?? [];
  const label = (option: string) => (option === 'dockhand' ? 'Dockhand' : 'Scribe');
  // The dice log is the whole game's, so this test's rolls are told by this character's own name.
  const character = `Lockhand${again}`;

  const context = await browser.newContext({ baseURL: info.project.use.baseURL });
  const sheet = await context.newPage();
  await signInAsPlayer(sheet, player);
  await sheet.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true }).click();
  await sheet.getByRole('button', { name: 'CHARACTER_SHEET', exact: true }).click();
  await sheetTab(sheet, 'CHARACTER');
  await sheet.getByLabel('Name', { exact: true }).fill(character);
  await expect.poll(async () => (await stored()).name, { timeout: 15_000 }).toBe(character);
  const region = sheet.getByRole('region', { name: 'Backgrounds' });
  const rollForIt = region.getByRole('button', { name: 'ROLL FOR IT' });

  // Selectable as well as rollable: both are there.
  await expect(region.getByRole('button', { name: 'SCRIBE' })).toBeEnabled();
  await expect(rollForIt).toBeEnabled();

  // 1, 2. They roll, and it locks in.
  await rollForIt.click();
  await expect.poll(async () => (await held()).length, { timeout: 15_000 }).toBe(1);
  const first = (await held())[0];
  expect(first.locked).toBe(true);
  await expect(region.getByText(/YOUR GM CAN CLEAR IT FOR ANOTHER GO\.$/)).toBeVisible({ timeout: 15_000 });
  await expect(rollForIt).toHaveCount(0);
  // The tray opened over the sheet, as it does for any roll: they put it away.
  await sheet.keyboard.press('Escape');

  // The GM opens their sheet.
  await signInAsGm(page);
  await page.getByRole('button', { name: 'GLOBAL_CHAT', exact: true }).click();
  await page.getByText(player.username, { exact: true }).first().click();
  await page.getByRole('button', { name: 'VIEW_PLAYER_INFO', exact: true }).click();
  await page.getByRole('button', { name: 'OPEN_SHEET', exact: true }).click();
  await sheetTab(page, 'CHARACTER');

  // 4a. CLEAR THE ROLL: the player's button comes back, and they roll again.
  await page.getByRole('button', { name: `Clear the roll for ${label(first.option)}` }).click();
  await expect.poll(held, { timeout: 15_000 }).toEqual([]);
  await expect(rollForIt).toBeEnabled({ timeout: 15_000 });
  await rollForIt.click();
  await expect.poll(async () => (await held()).length, { timeout: 15_000 }).toBe(1);
  const second = (await held())[0];

  // 4b. ROLL AGAIN: the GM rolls for them, the result locked in the same way.
  await page.getByRole('button', { name: `Roll again for ${label(second.option)}` }).click();
  await expect(page.getByRole('button', { name: /^Clear the roll for / })).toBeVisible({ timeout: 15_000 });
  await expect.poll(async () => (await held())[0]?.locked, { timeout: 15_000 }).toBe(true);
  const third = (await held())[0];
  expect(await held()).toHaveLength(1);

  // 4c. Picked by hand: cleared, then chosen. It stays locked to the player, saying who set it.
  await page.getByRole('button', { name: `Clear the roll for ${label(third.option)}` }).click();
  await expect.poll(held, { timeout: 15_000 }).toEqual([]);
  await page.getByRole('button', { name: 'SCRIBE', exact: true }).click();
  await expect.poll(held, { timeout: 15_000 }).toEqual([{ option: 'scribe', locked: true }]);
  await expect(region.getByText('SET BY THE GM. YOUR GM CAN CLEAR IT FOR ANOTHER GO.')).toBeVisible({ timeout: 15_000 });

  // The log keeps every roll made.
  await sheet.getByTitle('TOGGLE_HISTORY').click();
  await expect(sheet.getByTestId('dice-history').getByText(`${character}: rolled Background (d6)`)).toHaveCount(3, { timeout: 15_000 });
  await context.close();
});
