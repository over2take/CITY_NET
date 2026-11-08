import { test, expect } from '@playwright/test';
import { signInAsGm, signInAsPlayer, gmToken, asGm, runningSystem, approvedPlayer, sheetTab } from './helpers';

// MAX HEALTH: PER LEVEL (7d5a; approved mockup docs/mockups/level-up.html, 2026-11-07): a Fighter with a d10 HIT DIE
// and +2 for each level from Constitution has 12 at level 1. Going up, LEVEL_UP.EXE's HEALTH says the level adds 7,
// and the token follows; a higher Constitution then recounts every level. With ROLL (7d5b) it is rolled in the window and
// kept, the GM clearing it for another go.

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

test('ROLL: health rolled in the window and kept; the GM clears it, the player rolls again and finishes (7d5b)', async ({ page, browser, request }, info) => {
  test.setTimeout(180_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const gm = await gmToken(request);
  await runningSystem(request, gm, {
    format: 1, name: `Hproll${again}`, core: { health: { model: 'pool' }, advancement: ['levels'] },
    choices: [{ id: 'classes', one: 'Class', many: 'Classes', levelled: true, options: [{ id: 'fighter', label: 'Fighter', die: 10 }] }],
    levels: { top: 5, first: 100, ranges: [{ to: 5, x: 2 }], health: { how: 'level', gain: 'roll' } },
  });
  const player = { username: `e2e_hproller${again}`, password: 'e2e-player-password' };
  await approvedPlayer(request, gm, player);
  await asGm(request, gm, 'post', '/api/locations', {
    name: player.username, description: '', shape: 'rhombus', owner: player.username, x: 0, y: 0, z: 0, width: 1, height: 1, depth: 1,
    hp_current: 1, hp_max: 1, hp_temp: 0, battle_map_id: -1, floor_index: -1,
  });
  const sheetOf = async () => (await asGm(request, gm, 'get', `/api/sheets/user/${player.username}`)).data;

  const context = await browser.newContext({ baseURL: info.project.use.baseURL });
  const mine = await context.newPage();
  await signInAsPlayer(mine, player);
  await mine.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true }).click();
  await mine.getByRole('button', { name: 'CHARACTER_SHEET', exact: true }).click();
  await sheetTab(mine, 'CHARACTER');
  await mine.getByRole('group', { name: 'Pick a Class' }).getByRole('button', { name: 'FIGHTER' }).click();
  await expect.poll(async () => (await sheetOf())._choices?.classes?.length, { timeout: 15_000 }).toBe(1);
  await asGm(request, gm, 'put', `/api/sheets/user/${player.username}`, { fields: { _xp: 100 } });

  // The HEALTH folder: nothing to finish on until it's rolled.
  await mine.getByRole('button', { name: 'LEVEL UP READY' }).click();
  await expect(mine.getByText('HEALTH · STEP 1 OF 2')).toBeVisible();
  await expect(mine.getByRole('button', { name: 'NEXT', exact: true })).toBeDisabled();
  await mine.getByRole('group', { name: 'Health this level' }).getByRole('button', { name: 'ROLL D10' }).click();
  await expect.poll(async () => (await sheetOf())._leveling?.health?.roll, { timeout: 15_000 }).toBeGreaterThan(0);
  const first = (await sheetOf())._leveling.health.roll;
  await expect(mine.getByText(`+${first}: ROLLED ${first}`)).toBeVisible();
  await expect(mine.getByText('Rolled, and kept. Your GM can clear it for another go.')).toBeVisible();
  await expect(mine.getByRole('button', { name: 'ROLL D10' })).toHaveCount(0);
  await mine.getByRole('button', { name: 'LEAVE FOR NOW', exact: true }).click();

  // The GM sees the roll on their sheet and clears it.
  await signInAsGm(page);
  await page.getByRole('button', { name: 'GLOBAL_CHAT', exact: true }).click();
  await page.getByText(player.username, { exact: true }).first().click();
  await page.getByRole('button', { name: 'VIEW_PLAYER_INFO', exact: true }).click();
  await page.getByRole('button', { name: 'OPEN_SHEET', exact: true }).click();
  const line = page.getByRole('group', { name: 'Leveling up' });
  await expect(line.getByText(`LEVELING UP · FIGHTER 1 → 2 · HEALTH ROLLED ${first} ON A D10`)).toBeVisible({ timeout: 15_000 });
  await line.getByRole('button', { name: 'CLEAR THE ROLL' }).click();
  await expect.poll(async () => (await sheetOf())._leveling?.health, { timeout: 15_000 }).toBeUndefined();

  // Rolled again, and finished: the token gains that roll on top of level 1's full d10.
  await mine.getByRole('button', { name: 'LEVELING UP · CONTINUE' }).click();
  await mine.getByRole('group', { name: 'Health this level' }).getByRole('button', { name: 'ROLL D10' }).click();
  await expect.poll(async () => (await sheetOf())._leveling?.health?.roll, { timeout: 15_000 }).toBeGreaterThan(0);
  const second = (await sheetOf())._leveling.health.roll;
  await mine.getByRole('button', { name: 'NEXT', exact: true }).click();
  await mine.getByRole('button', { name: 'FINISH', exact: true }).click();
  await expect.poll(async () => (await sheetOf())._health_levels, { timeout: 15_000 }).toEqual({ 2: { die: 10, took: second, rolled: true } });
  await mine.getByRole('button', { name: 'HIT_POINTS', exact: true }).click();
  await expect(mine.getByText(`${10 + second} / ${10 + second}`)).toBeVisible({ timeout: 15_000 });
  await context.close();
});

test('REROLL ALL, KEEP HIGHER: every level rolled again, the token taking the new maximum or 1 more (7d5c)', async ({ browser, request }, info) => {
  test.setTimeout(150_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const gm = await gmToken(request);
  await runningSystem(request, gm, {
    format: 1, name: `Rerollfall${again}`, core: { health: { model: 'pool' }, advancement: ['levels'] },
    choices: [{ id: 'classes', one: 'Class', many: 'Classes', levelled: true, options: [{ id: 'fighter', label: 'Fighter', die: 6 }] }],
    levels: { top: 5, first: 100, ranges: [{ to: 5, x: 2 }], health: { how: 'level', gain: 'reroll', adds: '1' } },
  });
  const player = { username: `e2e_rerolled${again}`, password: 'e2e-player-password' };
  await approvedPlayer(request, gm, player);
  await asGm(request, gm, 'post', '/api/locations', {
    name: player.username, description: '', shape: 'rhombus', owner: player.username, x: 0, y: 0, z: 0, width: 1, height: 1, depth: 1,
    hp_current: 1, hp_max: 1, hp_temp: 0, battle_map_id: -1, floor_index: -1,
  });
  const sheetOf = async () => (await asGm(request, gm, 'get', `/api/sheets/user/${player.username}`)).data;

  const context = await browser.newContext({ baseURL: info.project.use.baseURL });
  const mine = await context.newPage();
  await signInAsPlayer(mine, player);
  await mine.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true }).click();
  await mine.getByRole('button', { name: 'CHARACTER_SHEET', exact: true }).click();
  await sheetTab(mine, 'CHARACTER');
  await mine.getByRole('group', { name: 'Pick a Class' }).getByRole('button', { name: 'FIGHTER' }).click();
  // Level 1: the full d6 and 1.
  await expect.poll(async () => (await sheetOf())._health?.max, { timeout: 15_000 }).toBe(7);
  await asGm(request, gm, 'put', `/api/sheets/user/${player.username}`, { fields: { _xp: 100 } });

  await mine.getByRole('button', { name: 'LEVEL UP READY' }).click();
  await expect(mine.getByText('HEALTH · EVERY LEVEL: 2 DICE + 2')).toBeVisible();
  await expect(mine.getByText('Every level rolled again. Over 7 and it becomes your new maximum. Otherwise you gain 1.')).toBeVisible();
  await mine.getByRole('group', { name: 'Health this level' }).getByRole('button', { name: 'ROLL THEM ALL' }).click();
  await expect.poll(async () => (await sheetOf())._leveling?.health?.gained, { timeout: 15_000 }).toBeGreaterThan(0);
  const { roll, gained } = (await sheetOf())._leveling.health;
  expect(gained).toBe(roll > 7 ? roll - 7 : 1);
  await expect(mine.getByText(roll > 7 ? `+${gained}: ROLLED ${roll}, OVER 7: THE NEW MAXIMUM` : `+1: ROLLED ${roll}, NOT OVER 7: +1`)).toBeVisible();
  await mine.getByRole('button', { name: 'NEXT', exact: true }).click();
  await mine.getByRole('button', { name: 'FINISH', exact: true }).click();
  await expect.poll(async () => (await sheetOf())._health?.max, { timeout: 15_000 }).toBe(7 + gained);
  await mine.getByRole('button', { name: 'HIT_POINTS', exact: true }).click();
  await expect(mine.getByText(`${7 + gained} / ${7 + gained}`)).toBeVisible({ timeout: 15_000 });
  await context.close();
});

for (const way of ['pool', 'level'] as const) {
  test(`ROLL TO BEAT, ${way === 'pool' ? 'a pool' : 'a die per level'}: beaten, the level gains; not, nothing (7d5d)`, async ({ browser, request }, info) => {
    test.setTimeout(150_000);
    const again = info.retry ? `_${info.retry + 1}` : '';
    const gm = await gmToken(request);
    await runningSystem(request, gm, {
      format: 1, name: `Beatfall ${way}${again}`, core: { health: { model: 'pool' }, advancement: ['levels'] },
      choices: [{ id: 'classes', one: 'Class', many: 'Classes', levelled: true, options: [{ id: 'fighter', label: 'Fighter', die: 6 }] }],
      levels: { top: 5, first: 100, ranges: [{ to: 5, x: 2 }], health: { how: 'level', gain: 'beat', beat_way: way, pool_count: 3, pool_die: 6, gain_die: 4 } },
    });
    const player = { username: `e2e_beat${way}${again}`, password: 'e2e-player-password' };
    await approvedPlayer(request, gm, player);
    await asGm(request, gm, 'post', '/api/locations', {
      name: player.username, description: '', shape: 'rhombus', owner: player.username, x: 0, y: 0, z: 0, width: 1, height: 1, depth: 1,
      hp_current: 1, hp_max: 1, hp_temp: 0, battle_map_id: -1, floor_index: -1,
    });
    const sheetOf = async () => (await asGm(request, gm, 'get', `/api/sheets/user/${player.username}`)).data;

    const context = await browser.newContext({ baseURL: info.project.use.baseURL });
    const mine = await context.newPage();
    await signInAsPlayer(mine, player);
    await mine.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true }).click();
    await mine.getByRole('button', { name: 'CHARACTER_SHEET', exact: true }).click();
    await sheetTab(mine, 'CHARACTER');
    await mine.getByRole('group', { name: 'Pick a Class' }).getByRole('button', { name: 'FIGHTER' }).click();
    // Level 1: the full d6.
    await expect.poll(async () => (await sheetOf())._health?.max, { timeout: 15_000 }).toBe(6);
    await asGm(request, gm, 'put', `/api/sheets/user/${player.username}`, { fields: { _xp: 100 } });

    await mine.getByRole('button', { name: 'LEVEL UP READY' }).click();
    await expect(mine.getByText(way === 'pool' ? 'HEALTH · ROLL 3D6 TO BEAT 6' : 'HEALTH · EVERY LEVEL: 2 DICE TO BEAT 6')).toBeVisible();
    await mine.getByRole('group', { name: 'Health this level' }).getByRole('button', { name: 'ROLL TO BEAT' }).click();
    await expect.poll(async () => (await sheetOf())._leveling?.health?.beat, { timeout: 15_000 }).toBe(true);
    const { roll, gained } = (await sheetOf())._leveling.health;
    expect(roll > 6 ? gained > 0 : gained === 0).toBe(true);
    await expect(mine.getByText(roll > 6 ? `+${gained}: ROLLED ${roll}, OVER 6: GAINED ${gained}` : `+0: ROLLED ${roll}, NOT OVER 6: NOTHING GAINED`)).toBeVisible();
    await mine.getByRole('button', { name: 'NEXT', exact: true }).click();
    await mine.getByRole('button', { name: 'FINISH', exact: true }).click();
    await expect.poll(async () => (await sheetOf())._health?.max, { timeout: 15_000 }).toBe(6 + gained);
    await mine.getByRole('button', { name: 'HIT_POINTS', exact: true }).click();
    await expect(mine.getByText(`${6 + gained} / ${6 + gained}`)).toBeVisible({ timeout: 15_000 });
    await context.close();
  });
}
