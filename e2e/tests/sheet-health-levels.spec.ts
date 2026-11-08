import { test, expect } from '@playwright/test';
import { signInAsPlayer, gmToken, asGm, runningSystem, approvedPlayer, sheetTab } from './helpers';

// MAX HEALTH: PER LEVEL (7d5a; approved mockup docs/mockups/level-up.html, 2026-11-07): a Fighter with a d10 HIT DIE
// and +2 for each level from Constitution has 12 at level 1. Going up, LEVEL_UP.EXE's HEALTH says the level adds 7,
// and the token follows; a higher Constitution then recounts every level.

test('a level up adds its average and what each level adds to the token; a stat recounts every level', async ({ browser, request }, info) => {
  test.setTimeout(150_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const gm = await gmToken(request);
  await runningSystem(request, gm, {
    format: 1, name: `Halefall${again}`, core: { health: { model: 'pool' }, advancement: ['levels'] },
    stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'con', label: 'Constitution', min: 1, max: 20 }] }],
    derived: [{ id: 'con_mod', label: 'CON mod', formula: 'floor((@con - 10) / 2)' }],
    choices: [{ id: 'classes', one: 'Class', many: 'Classes', levelled: true, options: [{ id: 'fighter', label: 'Fighter', die: 10 }] }],
    levels: { top: 5, first: 100, ranges: [{ to: 5, x: 2 }], health: { how: 'level', adds: '@con_mod' } },
  });
  const player = { username: `e2e_hale${again}`, password: 'e2e-player-password' };
  await approvedPlayer(request, gm, player);
  await asGm(request, gm, 'post', '/api/locations', {
    name: player.username, description: '', shape: 'rhombus', owner: player.username, x: 0, y: 0, z: 0, width: 1, height: 1, depth: 1,
    hp_current: 1, hp_max: 1, hp_temp: 0, battle_map_id: -1, floor_index: -1,
  });

  const context = await browser.newContext({ baseURL: info.project.use.baseURL });
  const mine = await context.newPage();
  await signInAsPlayer(mine, player);
  await mine.getByRole('button', { name: 'HIT_POINTS', exact: true }).click();
  await mine.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true }).click();
  await mine.getByRole('button', { name: 'CHARACTER_SHEET', exact: true }).click();
  await sheetTab(mine, 'STATS');
  const con = mine.getByRole('spinbutton', { name: 'Constitution' });
  await con.fill('14');
  await con.blur();
  await sheetTab(mine, 'CHARACTER');
  await mine.getByRole('group', { name: 'Pick a Class' }).getByRole('button', { name: 'FIGHTER' }).click();
  // Level 1: the full d10 and +2.
  await expect(mine.getByText('12 / 12')).toBeVisible({ timeout: 15_000 });

  await asGm(request, gm, 'put', `/api/sheets/user/${player.username}`, { fields: { _xp: 100 } });
  await mine.getByRole('button', { name: 'LEVEL UP READY' }).click();
  await expect(mine.getByText('HEALTH · d10 + 2')).toBeVisible();
  await expect(mine.getByText('+7: 5 AVERAGE, +2 EACH LEVEL')).toBeVisible();
  await mine.getByRole('button', { name: 'NEXT', exact: true }).click();
  await mine.getByRole('button', { name: 'FINISH', exact: true }).click();
  await expect(mine.getByText('19 / 19')).toBeVisible({ timeout: 15_000 });

  // CON 18: +4 a level, both levels recounted.
  await sheetTab(mine, 'STATS');
  await con.fill('18');
  await con.blur();
  await expect(mine.getByText('23 / 23')).toBeVisible({ timeout: 15_000 });
  await context.close();
});
