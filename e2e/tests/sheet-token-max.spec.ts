import { test, expect, type Page } from '@playwright/test';
import { signInAsGm, signInAsPlayer, gmToken, asGm, runningSystem, approvedPlayer, sheetTab } from './helpers';

// A feature's modifier on the token's maximum (7a5a3; decision 10 of the approved mockup
// docs/mockups/nested-choices.html, 2026-10-28): a player with a 20 HP token, a FIGHTER at level 3,
// picks TOUGH (+2 HP per level) and their token goes to 26 of 26, the sheet naming the bonus and MAX
// HEALTH following; a level down takes it to 24. The GM takes TOUGH away from the player's sheet and
// the token is back at 20.

const definition = (name: string) => ({
  format: 1,
  name,
  core: { health: { model: 'pool' }, advancement: ['levels'], dice: ['d20'] },
  choices: [
    { id: 'classes', one: 'Class', many: 'Classes', levelled: true, options: [{ id: 'fighter', label: 'Fighter' }] },
    { id: 'feats', one: 'Feat', many: 'Feats', picks: 'any', options: [
      { id: 'tough', label: 'Tough', features: [{ id: 'tough_hp', label: 'Tough', modifiers: [{ target: 'hp_max', amount: '2 * @level' }] }] },
    ] },
  ],
});

/** Someone looks a player up the way the app offers: GLOBAL_CHAT, their name, VIEW_PLAYER_INFO. */
const lookUp = async (page: Page, username: string) => {
  await page.getByRole('button', { name: 'GLOBAL_CHAT', exact: true }).click();
  await page.getByText(username, { exact: true }).first().click();
  await page.getByRole('button', { name: 'VIEW_PLAYER_INFO', exact: true }).click();
};

test('a feature adding to HP MAX moves the token\'s real maximum, and back when it goes', async ({ page, browser, request }, info) => {
  test.setTimeout(180_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const gm = await gmToken(request);
  await runningSystem(request, gm, definition(`Tough Keep${again}`));
  const player = { username: `e2e_tough${again}`, password: 'e2e-player-password' };
  await approvedPlayer(request, gm, player);
  await asGm(request, gm, 'post', '/api/locations', {
    name: player.username, description: '', shape: 'rhombus', owner: player.username, x: 0, y: 0, z: 0, width: 1, height: 1, depth: 1,
    hp_current: 20, hp_max: 20, hp_temp: 0, battle_map_id: -1, floor_index: -1,
  });

  const context = await browser.newContext({ baseURL: info.project.use.baseURL });
  const mine = await context.newPage();
  await signInAsPlayer(mine, player);
  await mine.getByRole('button', { name: 'HIT_POINTS', exact: true }).click();
  await expect(mine.getByText('20 / 20')).toBeVisible();
  await mine.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true }).click();
  await mine.getByRole('button', { name: 'CHARACTER_SHEET', exact: true }).click();

  // A FIGHTER at level 3 picks TOUGH, on CHARACTER: 6 more, on the token and named on STATS.
  await sheetTab(mine, 'CHARACTER');
  const classes = mine.getByRole('region', { name: 'Classes' });
  await classes.getByRole('group', { name: 'Pick a Class' }).getByRole('button', { name: 'FIGHTER' }).click();
  const fighter = classes.getByRole('group', { name: 'Fighter' });
  await fighter.getByRole('button', { name: 'Fighter level up' }).click();
  await fighter.getByRole('button', { name: 'Fighter level up' }).click();
  await expect(fighter.getByText('LV 3')).toBeVisible();
  const feats = mine.getByRole('region', { name: 'Feats' });
  await feats.getByRole('group', { name: 'Pick a Feat' }).getByRole('button', { name: 'TOUGH' }).click();
  await expect(mine.getByText('26 / 26')).toBeVisible();
  await sheetTab(mine, 'STATS');
  await expect(mine.getByTitle('20 → 26 (Tough +6)')).toBeVisible();
  // CHARACTER_CONTROLS' MAX HEALTH follows, so SAVE_STATS never writes the old 20 back.
  const maxHealth = mine.locator('label', { hasText: /^MAX HEALTH$/ }).locator('xpath=following-sibling::input');
  await expect(maxHealth).toHaveValue('26');

  // A level down: 4, not 6.
  await sheetTab(mine, 'CHARACTER');
  await fighter.getByRole('button', { name: 'Fighter level down' }).click();
  await expect(mine.getByText('24 / 24')).toBeVisible();
  await sheetTab(mine, 'STATS');
  await expect(mine.getByTitle('20 → 24 (Tough +4)')).toBeVisible();

  // THE GM takes TOUGH away from the player's sheet: the token is back where it started.
  await signInAsGm(page);
  await lookUp(page, player.username);
  await page.getByRole('button', { name: 'OPEN_SHEET', exact: true }).click();
  await sheetTab(page, 'CHARACTER');
  const tough = page.getByRole('region', { name: 'Feats' }).getByRole('group', { name: 'Tough' });
  await tough.getByRole('button', { name: 'Drop Tough' }).click();
  await tough.getByRole('button', { name: 'YES, DROP' }).click();
  await expect(mine.getByText('20 / 20')).toBeVisible();
  await expect(mine.getByTitle(/Tough/)).toHaveCount(0);
  await expect(maxHealth).toHaveValue('20');

  const token = (await asGm(request, gm, 'get', '/api/locations') as Array<{ owner: string; hp_current: number; hp_max: number }>)
    .find((l) => l.owner === player.username);
  expect([token?.hp_current, token?.hp_max]).toEqual([20, 20]);
  await context.close();
});
