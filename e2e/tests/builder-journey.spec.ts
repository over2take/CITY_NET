import { test, expect, type Page } from '@playwright/test';
import { signInAsGm, signInAsPlayer, openBuilder, openGameSystem, builderPage, clickRail, gmToken, approvedPlayer } from './helpers';

// The builder journey, the GM's half (4l2a; plan row 4l browser-journey): a system built through
// the builder's own screens from + NEW (its words, a part off, a stat and a formula worked out on
// the sample), published, changed and published again through the version preview, and the game
// switched to it. The player's half (a character, GIVE ITEM, a rest) is 4l2b.
// Phase 6 adds a roll (6b, 6c4h): a save from a preset, with a target, rolled by the stat, whose
// players see only the verdict while the system keeps targets from them; a player rolls it from
// their sheet once the game runs it, and is told less than the GM.

/** What the server tells this page about each roll. */
const rollsSeenBy = (page: Page) => {
  const seen: { historyString: string; board?: { outcome?: string } }[] = [];
  page.on('websocket', (ws) => ws.on('framereceived', (f) => {
    const m = /^42\["diceRollBroadcast",(.*)\]$/s.exec(String(f.payload));
    if (m) seen.push(JSON.parse(m[1]));
  }));
  return seen;
};

test('the GM builds a system, publishes it twice, switches the game to it, and a player rolls its save', async ({ page, browser, request }, info) => {
  // A retry runs on the same database as the try before it, so it makes a system of its own name.
  const NAME = info.retry ? `Hearthfall ${info.retry + 1}` : 'Hearthfall';
  const again = info.retry ? `_${info.retry + 1}` : '';
  const gmSees = rollsSeenBy(page);
  await signInAsGm(page);
  await openBuilder(page);

  // + NEW: a blank system, opened on SETUP.
  await page.getByRole('tab', { name: '+ NEW' }).click();
  await page.locator('#systems-new-name').fill(NAME);
  await page.getByRole('button', { name: 'CREATE', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'SETUP', exact: true })).toBeVisible();
  await expect(page.getByTestId('builder-system')).toContainText(NAME.toUpperCase());

  // WORDS: HP is a Wound here.
  await builderPage(page, 'WORDS');
  await page.getByLabel('HP one').fill('Wound');
  await page.getByLabel('HP many').fill('Wounds');
  await expect(page.getByTestId('term-hp')).toContainText('1 WOUND · 3 WOUNDS');

  // FEATURES: no vehicles in this game.
  await builderPage(page, 'FEATURES');
  const vehicles = page.getByRole('switch', { name: 'VEHICLES' });
  await vehicles.click();
  await expect(vehicles).toHaveAttribute('aria-checked', 'false');

  // STATS & RULES: a stat, and a formula worked out from it on the sample character.
  await builderPage(page, 'STATS & RULES');
  // In FORMS (the map is builder-graph.spec's): picked on screen, whatever was picked last.
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'FORMS' }).click();
  await page.getByRole('button', { name: '+ GROUP' }).click();
  await page.getByRole('button', { name: '+ STAT' }).click();
  await page.getByLabel('New stat name').fill('Grit');
  await page.getByLabel('Grit sample').fill('3');
  await page.getByRole('tab', { name: 'FORMULAS' }).click();
  await page.getByRole('button', { name: '+ FORMULA' }).click();
  await page.getByLabel('New formula name').fill('Toughness');
  await page.getByLabel('Toughness formula').fill('10 + @new_stat');
  await expect(page.getByTestId('value-new_formula')).toHaveText('13');

  // ROLLS: a new system keeps every roll's target from players.
  await page.getByRole('tab', { name: 'ROLLS', exact: true }).click();
  await expect(page.getByRole('group', { name: 'Every roll: players see' }).getByRole('button', { name: 'GM ONLY' })).toHaveAttribute('aria-pressed', 'true');
  // A save from the CWN preset: a d20 against a target, here 16 less Grit, rolled by Grit.
  await page.getByRole('group', { name: 'New roll from a preset' }).getByRole('button', { name: 'CWN SAVE' }).click();
  await page.getByLabel('Roll name').fill('Grit save');
  await page.getByLabel('Against', { exact: true }).fill('16 - @this');
  await page.getByRole('region', { name: 'Rolled by' }).getByRole('button', { name: 'GRIT', exact: true }).click();
  // Players of this one are told whether it worked, not what it was against.
  const thisRoll = page.getByRole('group', { name: 'This roll: players see' });
  await expect(thisRoll.getByRole('button', { name: 'AS THE SYSTEM (GM ONLY)' })).toHaveAttribute('aria-pressed', 'true');
  await thisRoll.getByRole('button', { name: 'VERDICT ONLY', exact: true }).click();
  await expect(thisRoll.getByRole('button', { name: 'VERDICT ONLY', exact: true })).toHaveAttribute('aria-pressed', 'true');
  // TEST ROLL: on the sample's Grit 3, against 13.
  const test_ = page.getByTestId('test-roll');
  await test_.getByRole('button', { name: 'TEST ROLL ▸' }).click();
  await expect(test_.getByTestId('test-outcome')).toHaveText(/^(SUCCESS|FAILURE)$/);

  // PUBLISH: the first version goes straight through.
  await clickRail(page, 'PUBLISH');
  await expect(page.getByRole('status')).toContainText('Published v1.');
  await expect(page.getByTestId('builder-system')).toContainText('PUBLISHED v1');

  // A change, then PUBLISH again: the version preview first, then v2.
  await builderPage(page, 'WORDS');
  await page.getByLabel('HP one').fill('Scar');
  await page.getByLabel('HP many').fill('Scars');
  await clickRail(page, 'PUBLISH');
  await expect(page.getByText('PUBLISH v2 · WHAT CHANGES FROM v1')).toBeVisible();
  await page.getByRole('button', { name: 'PUBLISH v2', exact: true }).click();
  await expect(page.getByTestId('builder-system')).toContainText('PUBLISHED v2');

  // Back on the map, the game switched to it in TTRPG_SYSTEM's picker.
  await page.getByRole('button', { name: 'Exit the builder and go back to the map' }).click();
  await expect(page.getByRole('main', { name: 'System builder' })).toBeHidden();
  await openGameSystem(page);
  await page.locator('button[aria-haspopup="listbox"]').click();
  await page.getByRole('option', { name: new RegExp(`^${NAME.toUpperCase()} ?v\\d`) }).click();
  const confirm = page.getByRole('dialog', { name: '!! SWITCH GAME SYSTEM !!' });
  await confirm.getByRole('button', { name: 'SWITCH', exact: true }).click();
  await expect(confirm).toBeHidden();
  // The picker names the game now running, and the version it runs.
  const picker = page.locator('button[aria-haspopup="listbox"]');
  await expect(picker).toContainText(NAME.toUpperCase());
  await expect(picker).toContainText('v2');

  // A PLAYER, in a browser of their own: the save has a die button by Grit on their sheet.
  const player = { username: `e2e_saver${again}`, password: 'e2e-player-password' };
  await approvedPlayer(request, await gmToken(request), player);
  const context = await browser.newContext({ baseURL: info.project.use.baseURL });
  const playerPage = await context.newPage();
  const playerSees = rollsSeenBy(playerPage);
  await signInAsPlayer(playerPage, player);
  await playerPage.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true }).click();
  await playerPage.getByRole('button', { name: 'CHARACTER_SHEET', exact: true }).click();
  await playerPage.getByLabel('Name', { exact: true }).fill('Wren');
  await playerPage.getByLabel('Grit', { exact: true }).fill('3');
  // Saved first, so the server reads Grit from the stored sheet.
  await playerPage.waitForTimeout(800);
  await playerPage.getByRole('button', { name: 'Roll Grit save' }).click();

  // The player is told whether it worked; the GM what it was against too, and that players weren't.
  await expect.poll(() => playerSees.length, { timeout: 15_000 }).toBe(1);
  await expect.poll(() => gmSees.length, { timeout: 15_000 }).toBe(1);
  expect(playerSees[0].historyString).toMatch(/^Wren rolled Grit save \(Grit\) \[\d+ = \d+\] — (SUCCESS|FAILURE)$/);
  expect(playerSees[0].board?.outcome ?? '').not.toMatch(/vs/i);
  expect(gmSees[0].historyString).toMatch(/^Wren rolled Grit save \(Grit\) \[\d+ = \d+\] — vs 13: (SUCCESS|FAILURE) · HIDDEN FROM PLAYERS$/);
  // The same verdict for both.
  expect(gmSees[0].historyString).toContain(/(SUCCESS|FAILURE)$/.exec(playerSees[0].historyString)![1]);
  await context.close();
});
