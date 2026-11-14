import { test, expect } from '@playwright/test';
import { signInAsPlayer, gmToken, asGm, runningSystem, approvedPlayer, sheetTab } from './helpers';

// MAX HEALTH: A FORMULA (7d4; approved mockup docs/mockups/level-up.html, 2026-11-07): the token's maximum worked out
// from the sheet. A player with a 20 HP token types their Constitution, and the token's maximum follows the formula,
// its health moving by as much.

test('a stat typed on the sheet moves the token\'s max health by the system\'s formula', async ({ browser, request }, info) => {
  test.setTimeout(120_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const gm = await gmToken(request);
  await runningSystem(request, gm, {
    format: 1, name: `Hearty${again}`, core: { health: { model: 'pool' } },
    stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'con', label: 'Constitution', min: 0, max: 20 }] }],
    levels: { health: { how: 'formula', formula: '10 + @con * 2' } },
  });
  const player = { username: `e2e_hearty${again}`, password: 'e2e-player-password' };
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
  await sheetTab(mine, 'STATS');
  const con = mine.getByRole('spinbutton', { name: 'Constitution' });

  // 10 + 3 * 2: down 4, the health with it.
  await con.fill('3');
  await con.blur();
  await expect(mine.getByText('16 / 16')).toBeVisible({ timeout: 15_000 });
  // 10 + 8 * 2: up 10.
  await con.fill('8');
  await con.blur();
  await expect(mine.getByText('26 / 26')).toBeVisible({ timeout: 15_000 });
  await context.close();
});
