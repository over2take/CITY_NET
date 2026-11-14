import { test, expect } from '@playwright/test';
import { signInAsGm, signInAsPlayer, openGameSystem, gmToken, asGm, runningSystem, approvedPlayer, sheetTab } from './helpers';

// The builder journey, the player's half (4l2b; plan row 4l browser-journey): a published custom
// system running as the game, played. A player makes a character on it and sees the system's own
// words and numbers; the GM uploads a catalogue, gives them something from it and calls a rest,
// each from the GAME tab; the player sees the gift arrive and the rest change their sheet.
//
// The system is set up through the API, not the builder's screens: building one on screen is the
// GM's half (builder-journey.spec.ts), and this journey runs on its own whichever runs first.

/** A small system of its own: renamed words, a stat a formula reads, and a rest that refills from it. */
const definition = (name: string) => ({
  format: 1,
  name,
  words: {
    hp: { singular: 'Wound', plural: 'Wounds', short: 'WND' },
    gm: { singular: 'Keeper', plural: 'Keepers', short: 'Keeper' },
  },
  stats: [
    { id: 'traits', label: 'TRAITS', stats: [{ id: 'grit', label: 'Grit', min: 1, max: 5 }] },
    { id: 'resources', label: 'RESOURCES', stats: [{ id: 'resolve', label: 'Resolve', min: 0, max: 5 }] },
  ],
  samples: { grit: 3, resolve: 1 },
  derived: [{ id: 'toughness', label: 'Toughness', formula: '10 + @grit' }],
  core: { health: { model: 'pool' }, advancement: ['levels'], dice: ['d6'], distance: 'meters' },
  // A night's sleep brings Resolve back up to Grit.
  rests: { long_rest: { refills: [{ what: 'resolve', how: 'to', amount: '@grit' }] } },
});

/** What the shops (and so GIVE ITEM) have: one line of gear, typed in as a GM would. */
const CATALOGUE = '[gear]\nname, price\nLantern Oil, 5';

test('a player makes a character on a custom game, and gets what the GM gives and the rest the GM calls', async ({ page: gmPage, browser, request }, info) => {
  // A retry runs on the same database as the try before it, so it makes its own system and player.
  const again = info.retry ? `_${info.retry + 1}` : '';
  const player = { username: `e2e_player${again}`, password: 'e2e-player-password' };
  const gm = await gmToken(request);
  await runningSystem(request, gm, definition(`Lanternfall${again}`));
  await approvedPlayer(request, gm, player);

  // THE PLAYER, in a browser of their own: signs in, and the game speaks the system's words.
  const playerContext = await browser.newContext({ baseURL: info.project.use.baseURL });
  const playerPage = await playerContext.newPage();
  await signInAsPlayer(playerPage, player);
  await expect(playerPage.getByRole('button', { name: 'WOUNDS', exact: true })).toBeVisible();

  // Their sheet, made the first time it opens, is the system's: its name, its stats, its formula.
  await playerPage.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true }).click();
  await playerPage.getByRole('button', { name: 'CHARACTER_SHEET', exact: true }).click();
  await expect(playerPage.getByText(`LANTERNFALL${again.toUpperCase()}`, { exact: true })).toBeVisible();
  // The name on the CHARACTER tab, the numbers on STATS.
  await sheetTab(playerPage, 'CHARACTER');
  await playerPage.getByLabel('Name', { exact: true }).fill('Ash');
  await sheetTab(playerPage, 'STATS');
  await playerPage.getByLabel('Grit', { exact: true }).fill('3');
  await expect(playerPage.getByLabel('Toughness', { exact: true })).toHaveValue('13');
  await expect(playerPage.getByLabel('Resolve', { exact: true })).toHaveValue('0');
  // Saved, so the GM's windows know them as Ash, and the server worked Toughness out as the sheet
  // did (the sheet works it out on screen too, so only the saved copy shows the server's).
  await expect.poll(async () => {
    const { data } = await asGm(request, gm, 'get', `/api/sheets/user/${player.username}`);
    return { name: data.name, grit: data.grit, toughness: data.toughness };
  }).toEqual({ name: 'Ash', grit: 3, toughness: 13 });

  // THE GM: a catalogue typed into the GAME tab's catalogue window, previewed and saved.
  await signInAsGm(gmPage);
  await openGameSystem(gmPage);
  await gmPage.getByRole('button', { name: 'SHOP_CATALOGUES', exact: true }).click();
  await gmPage.getByLabel('Catalogue text').fill(CATALOGUE);
  await gmPage.getByRole('button', { name: 'PREVIEW', exact: true }).click();
  await expect(gmPage.getByText('1 ROW READ')).toBeVisible();
  await gmPage.getByRole('button', { name: 'SAVE', exact: true }).click();
  await expect(gmPage.getByText(/^Saved: .* ×1\. The shops have it now\.$/)).toBeVisible();
  await gmPage.keyboard.press('Escape');

  // GIVE ITEM: the lantern oil, to Ash, with a note.
  await gmPage.getByRole('button', { name: 'GIVE_ITEM', exact: true }).click();
  await gmPage.getByRole('button', { name: 'Give Lantern Oil', exact: true }).click();
  await gmPage.getByRole('checkbox', { name: 'Ash', exact: true }).check();
  await gmPage.getByLabel('NOTE TO THEM (OPTIONAL)').fill('For the dark below.');
  await gmPage.getByRole('button', { name: 'GIVE 1 × LANTERN OIL TO 1', exact: true }).click();

  // The player is told, in the system's word for the GM, and it is on their sheet.
  const notice = playerPage.getByTestId('gift-notices');
  await expect(notice).toContainText('THE KEEPER GAVE YOU LANTERN OIL ×1');
  await expect(notice).toContainText('For the dark below.');
  await sheetTab(playerPage, 'GEAR');
  await expect(playerPage.getByText('Lantern Oil')).toBeVisible();

  // A LONG REST, from the GAME tab's rests: the preview says what Ash gets, and calling it does it.
  await gmPage.keyboard.press('Escape');
  const rests = gmPage.getByRole('region', { name: 'Rests' });
  await rests.getByLabel('Rest', { exact: true }).selectOption('long_rest');
  await expect(rests.getByRole('list', { name: 'What each one gets' })).toContainText('ASH');
  await rests.getByRole('button', { name: 'CALL LONG REST', exact: true }).click();
  await rests.getByRole('group', { name: 'Call a Long rest?' }).getByRole('button', { name: 'CALL', exact: true }).click();
  await expect(rests.getByRole('status')).toHaveText('LONG REST CALLED · 1 CHARACTER');

  // Ash's Resolve is back up to their Grit, on the sheet they have open.
  await sheetTab(playerPage, 'STATS');
  await expect(playerPage.getByLabel('Resolve', { exact: true })).toHaveValue('3');

  await playerContext.close();
});
