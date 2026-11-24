import { test, expect } from '@playwright/test';
import { signInAsPlayer, signInAsGm, gmToken, runningSystem, approvedPlayer, asGm } from './helpers';

// The vitals strip (8s3b): under the sheet header's HP bar in SHEET.EXE and the ⧉ tab alike, DAMAGE and HEAL change the
// player's token through the HEALTH window's own route, and every open sheet follows; the HP bar opens HEALTH's own panel
// right there.

test('DAMAGE in SHEET.EXE and HEAL on the tab move the token and both sheets; the HP bar opens HEALTH in place (8s3b)', async ({ browser, request }, info) => {
  test.setTimeout(120_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const gm = await gmToken(request);
  await runningSystem(request, gm, {
    format: 1, name: `Vitalkeep${again}`, core: { health: { model: 'pool' } },
    stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }] }],
  });
  const player = { username: `e2e_vitals${again}`, password: 'e2e-player-password' };
  await approvedPlayer(request, gm, player);
  await asGm(request, gm, 'post', '/api/locations', {
    name: player.username, description: '', shape: 'rhombus', owner: player.username, x: 0, y: 0, z: 0, width: 1, height: 1, depth: 1,
    hp_current: 20, hp_max: 20, hp_temp: 0, battle_map_id: -1, floor_index: -1,
  });
  const bar = (p: import('@playwright/test').Page) => p.getByTitle('Synced with your token: click to open HEALTH here');
  const hpOf = async () => (await asGm(request, gm, 'get', '/api/locations')).find((l: { owner?: string; shape?: string }) => l.shape === 'rhombus' && l.owner === player.username).hp_current;

  const context = await browser.newContext({ baseURL: info.project.use.baseURL });
  const mine = await context.newPage();
  await signInAsPlayer(mine, player);
  await mine.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true }).click();
  await mine.getByRole('button', { name: 'CHARACTER_SHEET', exact: true }).click();

  // DAMAGE in SHEET.EXE.
  const strip = mine.getByRole('group', { name: 'Vitals' });
  await expect(strip).toBeVisible({ timeout: 15_000 });
  // The token's AC beside the chips: a built system with combat on and no AC field shows its token's, as the token
  // menu does, an unset one being its 10 (Testfall showed none, the user saw).
  await expect(mine.getByRole('note', { name: 'AC 10' })).toHaveText('AC10');
  // HP DETAILS ▾ sits wholly under the numbers (its padding once reached up into them, the user saw).
  const caption = (await strip.getByRole('button', { name: /^HP DETAILS/ }).boundingBox())!;
  const current = (await strip.getByLabel('Current HP').boundingBox())!;
  expect(caption.y).toBeGreaterThanOrEqual(current.y + current.height - 1);
  // And the slash between CURRENT and MAX is centered over it, the box being symmetric (the user, 2026-11-17).
  const slash = (await strip.getByText('/', { exact: true }).boundingBox())!;
  expect(Math.abs((slash.x + slash.width / 2) - (caption.x + caption.width / 2))).toBeLessThanOrEqual(2);
  await strip.getByRole('spinbutton').fill('5');
  await strip.getByRole('button', { name: 'DAMAGE', exact: true }).click();
  await expect.poll(hpOf, { timeout: 15_000 }).toBe(15);
  await expect(bar(mine)).toContainText('15/20', { timeout: 15_000 });

  // HEAL on the tab: SHEET.EXE follows.
  const [tab] = await Promise.all([context.waitForEvent('page'), mine.getByRole('button', { name: 'Open in new tab' }).click()]);
  await tab.waitForLoadState();
  const tabStrip = tab.getByRole('group', { name: 'Vitals' });
  await expect(bar(tab)).toContainText('15/20', { timeout: 15_000 });
  await tabStrip.getByRole('spinbutton').fill('3');
  await tabStrip.getByRole('button', { name: 'HEAL', exact: true }).click();
  await expect.poll(hpOf, { timeout: 15_000 }).toBe(18);
  await expect(bar(tab)).toContainText('18/20', { timeout: 15_000 });
  await expect(bar(mine)).toContainText('18/20', { timeout: 15_000 });

  // The HP bar opens HEALTH's own panel on the tab, the map's HEALTH window not needed.
  await bar(tab).click();
  const health = tab.getByRole('region', { name: 'Health' });
  // No heart monitor or numbers there, the strip having them (8s4b): INJURIES, opening the injury map on the tab, a part
  // marked there kept on the token.
  await expect(health.getByRole('img', { name: /^Heart monitor/ })).toHaveCount(0);
  await health.getByRole('button', { name: 'Injuries' }).click();
  await health.getByRole('button', { name: 'HEAD' }).click();
  await expect.poll(async () => JSON.parse((await asGm(request, gm, 'get', '/api/locations')).find((l: { owner?: string; shape?: string }) => l.shape === 'rhombus' && l.owner === player.username).injuries || '{}').head, { timeout: 15_000 }).toBe(true);
  // MAX is set on the strip (8s4a), not here too.
  await expect(health.getByRole('spinbutton', { name: 'Max HP' })).toHaveCount(0);
  // Not a second DAMAGE and HEAL: the strip has them.
  await expect(health.getByRole('button', { name: 'DAMAGE', exact: true })).toHaveCount(0);
  await context.close();
});

// 8s3c: under the box, a condition put on in SHEET.EXE shows on the tab as a chip and is taken off there; REST ▾ on the tab
// opens the sheet's own RESTS, and the rest is taken.
test('a condition put on under the box shows on the tab and comes off there; REST ▾ takes a rest from the tab (8s3c)', async ({ browser, request }, info) => {
  test.setTimeout(120_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const gm = await gmToken(request);
  await runningSystem(request, gm, {
    format: 1, name: `Vitalrest${again}`, core: { health: { model: 'pool' } },
    stats: [{ id: 'resources', label: 'RESOURCES', stats: [{ id: 'resolve', label: 'Resolve', min: 0, max: 30 }] }],
    rests: { long_rest: { refills: [{ what: 'resolve', how: 'to', amount: '5' }] } },
    resting: { finish: 'sheet' },
  });
  const player = { username: `e2e_vitalrest${again}`, password: 'e2e-player-password' };
  await approvedPlayer(request, gm, player);
  await asGm(request, gm, 'post', '/api/locations', {
    name: player.username, description: '', shape: 'rhombus', owner: player.username, x: 0, y: 0, z: 0, width: 1, height: 1, depth: 1,
    hp_current: 20, hp_max: 20, hp_temp: 0, battle_map_id: -1, floor_index: -1,
  });
  const conditionsOn = async () => JSON.parse((await asGm(request, gm, 'get', '/api/locations')).find((l: { owner?: string; shape?: string }) => l.shape === 'rhombus' && l.owner === player.username).conditions || '[]').map((c: { id: string }) => c.id);

  const context = await browser.newContext({ baseURL: info.project.use.baseURL });
  const mine = await context.newPage();
  await signInAsPlayer(mine, player);
  await mine.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true }).click();
  await mine.getByRole('button', { name: 'CHARACTER_SHEET', exact: true }).click();

  // AC centered between + CONDITION and REST (the user, 2026-11-17).
  const addBox = (await mine.getByRole('button', { name: 'Put on a condition' }).boundingBox())!;
  const restBox = (await mine.getByRole('button', { name: /^REST/ }).boundingBox())!;
  const acBox = (await mine.getByRole('note', { name: 'AC 10' }).boundingBox())!;
  const between = (addBox.x + addBox.width + restBox.x) / 2;
  expect(Math.abs(acBox.x + acBox.width / 2 - between)).toBeLessThanOrEqual(2);

  // PRONE put on under the box in SHEET.EXE.
  const chips = mine.getByRole('group', { name: 'Vitals' }).locator('..').getByRole('region', { name: 'Conditions' });
  await chips.getByRole('button', { name: 'Put on a condition' }).click();
  // The list opens under the row, as wide as the box and REST's drawer (the user, 2026-11-17).
  const list = (await mine.getByRole('listbox', { name: 'Put on a condition' }).boundingBox())!;
  const vitalsBox = (await mine.getByRole('group', { name: 'Vitals' }).boundingBox())!;
  expect(Math.abs(list.width - vitalsBox.width)).toBeLessThanOrEqual(2);
  await mine.getByRole('listbox', { name: 'Put on a condition' }).getByRole('option', { name: /PRONE/ }).click();
  await expect.poll(conditionsOn, { timeout: 15_000 }).toEqual(['prone']);

  // On the tab, as a chip, and taken off there.
  const [tab] = await Promise.all([context.waitForEvent('page'), mine.getByRole('button', { name: 'Open in new tab' }).click()]);
  await tab.waitForLoadState();
  const tabChips = tab.getByRole('group', { name: 'Vitals' }).locator('..').getByRole('region', { name: 'Conditions' });
  // In a row of their own over + CONDITION (8a6c): a click opens it under the row, as wide as the box, TAKE OFF there.
  await tabChips.getByRole('button', { name: 'Prone', exact: true }).click({ timeout: 15_000 });
  const prone = tab.getByRole('group', { name: 'Prone', exact: true });
  const tabVitals = (await tab.getByRole('group', { name: 'Vitals' }).boundingBox())!;
  expect(Math.abs((await prone.boundingBox())!.width - tabVitals.width)).toBeLessThanOrEqual(2);
  await prone.getByRole('button', { name: 'Take Prone off' }).click();
  await expect.poll(conditionsOn, { timeout: 15_000 }).toEqual([]);
  await expect(mine.getByRole('group', { name: 'Vitals' }).locator('..').getByRole('button', { name: 'Prone', exact: true })).toHaveCount(0, { timeout: 15_000 });

  // REST ▾ on the tab: LONG REST, asked first, then taken.
  await tab.getByRole('button', { name: /^REST/ }).click();
  const rest = tab.getByRole('region', { name: 'Take a rest' });
  await rest.getByRole('button', { name: 'LONG REST' }).click();
  await rest.getByRole('group', { name: 'Take a Long rest?' }).getByRole('button', { name: 'REST' }).click();
  await expect.poll(async () => (await asGm(request, gm, 'get', `/api/sheets/user/${player.username}`)).data.resolve, { timeout: 15_000 }).toBe(5);
  await context.close();
});

// CWN's two ACs, MELEE and RANGED, in SHEET.EXE's narrow column: shown both, overlapping neither + CONDITION nor REST
// (the user, 2026-11-17); too tight for one line, the AC wraps to its own.
test('CWN\'s MELEE and RANGED AC by the box in SHEET.EXE, overlapping no button (8s3c)', async ({ browser, request }, info) => {
  test.setTimeout(120_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const gm = await gmToken(request);
  await asGm(request, gm, 'put', '/api/sheets/system', { system: 'cities_without_number' });
  const player = { username: `e2e_vitalcwn${again}`, password: 'e2e-player-password' };
  await approvedPlayer(request, gm, player);
  const made = await asGm(request, gm, 'post', '/api/locations', {
    name: player.username, description: '', shape: 'rhombus', owner: player.username, x: 0, y: 0, z: 0, width: 1, height: 1, depth: 1,
    hp_current: 20, hp_max: 20, hp_temp: 0, battle_map_id: -1, floor_index: -1,
  });
  await asGm(request, gm, 'put', `/api/locations/${made.data[0].id}`, {
    name: player.username, x: 0, y: 0, z: 0, width: 1, height: 1, depth: 1, shape: 'rhombus', owner: player.username,
    battle_map_id: -1, floor_index: -1, melee_ac: 13, ranged_ac: 15,
  });

  const context = await browser.newContext({ baseURL: info.project.use.baseURL });
  const mine = await context.newPage();
  await signInAsPlayer(mine, player);
  await mine.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true }).click();
  await mine.getByRole('button', { name: 'CHARACTER_SHEET', exact: true }).click();

  const ac = mine.getByRole('note', { name: 'MELEE AC 13, RANGED AC 15' });
  await expect(ac).toHaveText('MELEE AC13RANGED AC15', { timeout: 15_000 });
  // Every control in and under the box, CWN's STIM among them (its full name once spilled into HP DETAILS ▾).
  const strip = mine.getByRole('group', { name: 'Vitals' });
  const boxes = [(await ac.boundingBox())!, (await mine.getByRole('button', { name: 'Put on a condition' }).boundingBox())!];
  for (const name of ['HEAL', 'DAMAGE', 'STIM +1 STRAIN', /^HP DETAILS/] as const) boxes.push((await strip.getByRole('button', { name, exact: typeof name === 'string' }).boundingBox())!);
  const rest = mine.getByRole('button', { name: /^REST/ });
  if (await rest.count()) boxes.push((await rest.boundingBox())!);
  const overlap = (a: { x: number; y: number; width: number; height: number }, b: typeof a) =>
    a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) expect(overlap(boxes[i], boxes[j]), `${i} and ${j}`).toBe(false);
  // And each one's words inside it: a box keeps its width while its text runs out (STIM +1 STRAIN did).
  const spilled = await strip.locator('..').evaluate((el) => [...el.querySelectorAll('button, [role=note]')]
    .filter((b) => b.scrollWidth > b.clientWidth + 1).map((b) => b.getAttribute('aria-label') || b.textContent));
  expect(spilled).toEqual([]);
  // Inside the box's width, not running off the sheet.
  const vitals = (await mine.getByRole('group', { name: 'Vitals' }).boundingBox())!;
  expect(boxes[0].x).toBeGreaterThanOrEqual(vitals.x - 1);
  expect(boxes[0].x + boxes[0].width).toBeLessThanOrEqual(vitals.x + vitals.width + 1);
  await mine.screenshot({ path: test.info().outputPath('cwn-ac.png') });
  await context.close();
});

// Two tracks (8s3d1): the picker above the box; damage on the second past its maximum spills into the first, said.
test('two tracks in the box: STUN picked, damage past its maximum spills into PHYSICAL, said under the box (8s3d1)', async ({ browser, request }, info) => {
  test.setTimeout(120_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const gm = await gmToken(request);
  await runningSystem(request, gm, {
    format: 1, name: `Vitaltrack${again}`,
    core: { health: { model: 'tracks', tracks: [{ id: 'physical', label: 'PHYSICAL' }, { id: 'stun', label: 'STUN' }], overflow: true } },
    stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }] }],
  });
  const player = { username: `e2e_vitaltrack${again}`, password: 'e2e-player-password' };
  await approvedPlayer(request, gm, player);
  await asGm(request, gm, 'post', '/api/locations', {
    name: player.username, description: '', shape: 'rhombus', owner: player.username, x: 0, y: 0, z: 0, width: 1, height: 1, depth: 1,
    hp_current: 20, hp_max: 20, hp_temp: 0, battle_map_id: -1, floor_index: -1,
  });
  const hpOf = async () => (await asGm(request, gm, 'get', '/api/locations')).find((l: { owner?: string; shape?: string }) => l.shape === 'rhombus' && l.owner === player.username).hp_current;

  const context = await browser.newContext({ baseURL: info.project.use.baseURL });
  const mine = await context.newPage();
  await signInAsPlayer(mine, player);
  await mine.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true }).click();
  await mine.getByRole('button', { name: 'CHARACTER_SHEET', exact: true }).click();
  // The second track's maximum is the sheet's.
  await mine.getByLabel('STUN MAX', { exact: true }).fill('4');

  const picker = mine.getByRole('group', { name: 'Track' });
  await expect(picker.getByRole('button', { name: 'STUN 0/4' })).toBeVisible({ timeout: 15_000 });
  await picker.getByRole('button', { name: 'STUN 0/4' }).click();
  const strip = mine.getByRole('group', { name: 'Vitals' });
  await strip.getByRole('spinbutton').fill('6');
  await strip.getByRole('button', { name: 'DAMAGE', exact: true }).click();
  await expect(mine.getByRole('status', { name: 'What happened' })).toHaveText('STUN FULL · 2 SPILLED INTO PHYSICAL', { timeout: 15_000 });
  await expect.poll(hpOf, { timeout: 15_000 }).toBe(18);
  await expect(picker.getByRole('button', { name: 'PHYSICAL 18/20' })).toBeVisible({ timeout: 15_000 });
  await expect(picker.getByRole('button', { name: 'STUN 4/4' })).toBeVisible();
  await context.close();
});

// The GM's view of a player's sheet (8s3d2): the same box, the GM's sign-in sent; the player's own SHEET.EXE follows.
test('the GM takes damage off a player from the box in their view of the sheet; the player\'s SHEET.EXE follows (8s3d2)', async ({ page, browser, request }, info) => {
  test.setTimeout(120_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const gm = await gmToken(request);
  await runningSystem(request, gm, {
    format: 1, name: `Vitalgm${again}`, core: { health: { model: 'pool' } },
    stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }] }],
  });
  const player = { username: `e2e_vitalgm${again}`, password: 'e2e-player-password' };
  await approvedPlayer(request, gm, player);
  await asGm(request, gm, 'post', '/api/locations', {
    name: player.username, description: '', shape: 'rhombus', owner: player.username, x: 0, y: 0, z: 0, width: 1, height: 1, depth: 1,
    hp_current: 20, hp_max: 20, hp_temp: 0, battle_map_id: -1, floor_index: -1,
  });
  const hpOf = async () => (await asGm(request, gm, 'get', '/api/locations')).find((l: { owner?: string; shape?: string }) => l.shape === 'rhombus' && l.owner === player.username).hp_current;

  // The player, their sheet open.
  const context = await browser.newContext({ baseURL: info.project.use.baseURL });
  const mine = await context.newPage();
  await signInAsPlayer(mine, player);
  await mine.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true }).click();
  await mine.getByRole('button', { name: 'CHARACTER_SHEET', exact: true }).click();
  await expect(mine.getByRole('group', { name: 'Vitals' })).toBeVisible({ timeout: 15_000 });

  // The GM opens it and takes 5.
  await signInAsGm(page);
  await page.getByRole('button', { name: 'GLOBAL_CHAT', exact: true }).click();
  await page.getByText(player.username, { exact: true }).first().click();
  await page.getByRole('button', { name: 'VIEW_PLAYER_INFO', exact: true }).click();
  await page.getByRole('button', { name: 'OPEN_SHEET', exact: true }).click();
  const box = page.getByRole('group', { name: 'Vitals' });
  await expect(box.getByLabel('Current HP')).toHaveText('20', { timeout: 15_000 });
  await box.getByRole('spinbutton', { name: 'Amount of HP' }).fill('5');
  await box.getByRole('button', { name: 'DAMAGE', exact: true }).click();
  await expect.poll(hpOf, { timeout: 15_000 }).toBe(15);
  await expect(box.getByLabel('Current HP')).toHaveText('15', { timeout: 15_000 });
  await expect(mine.getByRole('group', { name: 'Vitals' }).getByLabel('Current HP')).toHaveText('15', { timeout: 15_000 });
  await context.close();
});
