import { test, expect } from '@playwright/test';
import { signInAsPlayer, signInAsGm, gmToken, runningSystem, approvedPlayer, asGm } from './helpers';

// Luck at the table (8c6; approved mockup docs/mockups/rule-library.html, section 4, answers 6 and 7). A player's sheet shows their
// LUCK, 3 of 3; they set two aside ("2 SET ASIDE · NEXT ROLL +2") and roll Shoot: the roll says LUCK and they have 1 left. The
// GM's GAME tab, under RESTS, has REFILL LUCK: pressed, the player is back to 3.

test('a player sets two LUCK aside and rolls with them; the GM\'s REFILL LUCK puts them back (8c6)', async ({ page, browser, request }, info) => {
  test.setTimeout(180_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const gm = await gmToken(request);
  await runningSystem(request, gm, {
    format: 1, name: `Luckroll${again}`, core: { health: { model: 'pool' } },
    stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'aim', label: 'Aim' }] }],
    rolls: [{ id: 'shoot', label: 'Shoot', dice: [{ count: '2', sides: 6 }], add: '@this', by: ['aim'] }],
    luck: { name: 'Luck', most: '3', each: 'plus', on: 'all', refills: ['end_of_session'] },
  });
  const player = { username: `e2e_lucky${again}`, password: 'e2e-player-password' };
  await approvedPlayer(request, gm, player);
  await asGm(request, gm, 'post', '/api/locations', {
    name: player.username, description: '', shape: 'rhombus', owner: player.username, x: 0, y: 0, z: 0, width: 1, height: 1, depth: 1,
    hp_current: 10, hp_max: 10, hp_temp: 0, battle_map_id: -1, floor_index: -1,
  });

  const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width: 1280, height: 900 } });
  const mine = await context.newPage();
  await signInAsPlayer(mine, player);
  await mine.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true }).click();
  await mine.getByRole('button', { name: 'CHARACTER_SHEET', exact: true }).click();
  const luck = mine.getByRole('group', { name: 'LUCK', exact: true });
  await expect(luck).toContainText('3/3', { timeout: 15_000 });
  await luck.getByRole('button', { name: 'LUCK 2 of 3' }).click();
  await expect(luck.getByRole('status')).toHaveText('2 SET ASIDE · NEXT ROLL +2');
  await mine.getByRole('button', { name: 'Roll Shoot' }).first().click();
  await expect(luck).toContainText('1/3', { timeout: 15_000 });
  await expect(luck.getByRole('status')).toHaveCount(0);
  // The roll says it.
  await mine.getByTitle('TOGGLE_HISTORY').click();
  await expect(mine.getByTestId('dice-history').locator('> div').filter({ hasText: /rolled Shoot.*LUCK/ })).toHaveCount(1, { timeout: 15_000 });

  // The GM's REFILL LUCK, on the GAME tab under RESTS.
  await page.setViewportSize({ width: 1280, height: 900 });
  await signInAsGm(page);
  await page.getByRole('button', { name: 'GAME', exact: true }).click();
  const rests = page.getByRole('button', { name: /RESTS$/ });
  if ((await rests.getAttribute('aria-expanded')) !== 'true') await rests.click();
  const refill = page.getByRole('region', { name: 'Refill LUCK' });
  await refill.getByRole('button', { name: 'REFILL LUCK' }).click();
  await expect(refill.getByRole('status')).toHaveText('1 CHARACTER BACK TO THEIR MOST', { timeout: 15_000 });
  await expect(luck).toContainText('3/3', { timeout: 15_000 });
  await context.close();
});
