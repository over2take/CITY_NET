import { test, expect, type Page, type APIRequestContext, type Browser, type TestInfo } from '@playwright/test';
import { signInAsGm, signInAsPlayer, gmToken, asGm, runningSystem, approvedPlayer } from './helpers';
import { tracker, rows, up, nav, gmTracker, startFight, nextUntil } from './initiative';

// The initiative tracker in a real browser (8i2; the user, 2026-11-19: tests "for the initiative tracker, and multi
// initiatives", and "what about the GM jumping fight to fight?"): one fight from START to END with two players joining and
// rolling; and two fights at once, the city map and a building's floor, the GM jumping between them from ACTIVE COMBATS,
// each fight kept as it was, each scene its own ROUND, players seeing only their own scene's; and the two joined into one
// combat. Set up through the API. The tracker's scenes are the table's own (city:0 is everyone's), so each test ends what it
// started, and starts by ending what another left.

/** A 1x1 PNG, enough of a map to enter. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

const SYSTEM = (name: string) => ({ format: 1, name, core: { health: { model: 'pool' } }, stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }] }] });

/** A token through the API: a player's on the city map, or an enemy on the city map or a building's floor. Its id. */
const token = async (request: APIRequestContext, gm: string, body: object) => {
  const made = await asGm(request, gm, 'post', '/api/locations', { description: '', x: 0, y: 0, z: 0, width: 1, height: 1, depth: 1, hp_current: 10, hp_max: 10, hp_temp: 0, ...body });
  return made.data[0].id as number;
};

/** A building with one battle map, `floor` its name. Its id. */
const building = async (request: APIRequestContext, gm: string, name: string, floor: string) => {
  const id = await token(request, gm, { name, shape: 'box', x: 4, z: 4, width: 2, height: 2, depth: 2 });
  const res = await request.post(`/api/locations/${id}/battle_maps`, { headers: { Authorization: `Bearer ${gm}` }, multipart: { designation: floor, image: { name: 'map.png', mimeType: 'image/png', buffer: PNG } } });
  expect(res.ok(), await res.text()).toBe(true);
  return id;
};

/** A player signed in in their own window, the tracker opened once initiative runs in their scene. */
const playerWindow = async (browser: Browser, info: TestInfo, player: { username: string; password: string }) => {
  const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await signInAsPlayer(page, player);
  return { context, page };
};
/** A player's tracker opens by itself once initiative runs in their scene (App.tsx): waited for, never clicked (a click shuts it). */
const openPlayerTracker = async (page: Page) => {
  await expect(tracker(page)).toBeVisible({ timeout: 15_000 });
};

/**
 * A fight jumped to from ACTIVE COMBATS, the tracker open beside the menu all the while (it opened over the list until 8i2),
 * and showing the fight there.
 */
const jump = async (page: Page, label: string) => {
  await expect(tracker(page)).toBeVisible();
  await nav(page).getByRole('button', { name: label }).click({ timeout: 15_000 });
  await expect(tracker(page)).toBeVisible();
};

test('one fight: the GM starts it, rolls the enemies, two players join; NEXT goes round to ROUND 2 on every screen; END (8i2)', async ({ page, browser, request }, info) => {
  test.setTimeout(180_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const gm = await gmToken(request);
  await runningSystem(request, gm, SYSTEM(`Fightclub${again}`));
  const alpha = { username: `e2e_fight_a${again}`, password: 'e2e-player-password' };
  const beta = { username: `e2e_fight_b${again}`, password: 'e2e-player-password' };
  for (const p of [alpha, beta]) {
    await approvedPlayer(request, gm, p);
    await token(request, gm, { name: p.username, shape: 'rhombus', owner: p.username });
  }
  const enemy = `FIGHT_GANGER${again}`;
  await token(request, gm, { name: enemy, shape: 'enemy_rhombus' });

  await page.setViewportSize({ width: 1280, height: 800 });
  await signInAsGm(page);
  await gmTracker(page);
  try {
    await startFight(page);
    await nav(page).getByRole('button', { name: 'ROLL ENEMIES' }).click();
    await expect(rows(page).filter({ hasText: enemy })).toHaveCount(1, { timeout: 15_000 });

    // Each player joins from their own tracker, and is in the GM's order.
    const players = [];
    for (const p of [alpha, beta]) {
      const w = await playerWindow(browser, info, p);
      players.push(w);
      await openPlayerTracker(w.page);
      await tracker(w.page).getByRole('button', { name: 'JOIN INITIATIVE' }).click();
      await expect(rows(page).filter({ hasText: p.username.toUpperCase() })).toHaveCount(1, { timeout: 15_000 });
      await expect(tracker(w.page).getByRole('button', { name: 'JOIN INITIATIVE' })).toHaveCount(0);
    }
    // Round the order: ROUND 2 on the GM's tracker and on each player's.
    await nextUntil(page, 'ROUND 2');
    for (const w of players) await expect(tracker(w.page).getByText('ROUND 2', { exact: true })).toBeVisible({ timeout: 15_000 });
    // The menu lists the fight, the city map at ROUND 2.
    await expect(nav(page).getByRole('button', { name: '▶ CITY MAP · ROUND 2' })).toBeVisible({ timeout: 15_000 });

    // END: the GM's tracker offers START again; the players' trackers say there is none.
    await tracker(page).getByRole('button', { name: /^END / }).click();
    await expect(tracker(page).getByRole('button', { name: 'START INITIATIVE' })).toBeVisible({ timeout: 15_000 });
    for (const w of players) await expect(tracker(w.page).getByText('ROUND 2', { exact: true })).toHaveCount(0, { timeout: 15_000 });
    for (const w of players) await w.context.close();
  } finally {
    await gmTracker(page);
  }
});

/** Into a building's battle map as the GM, from QUICK_ACCESS, the tracker open beside the list. */
const gmEnter = async (page: Page, name: string) => {
  await page.getByRole('button', { name: 'QUICK_ACCESS', exact: true }).click();
  const list = page.locator('.quick-access-panel');
  await list.getByText(/DEFINED_STRUCTURES/).click();
  await list.getByText(name, { exact: true }).click();
  await page.getByRole('button', { name: 'ENTER_BATTLE_MAP (1)' }).click();
  await expect(page.getByRole('button', { name: 'EXIT', exact: true })).toBeVisible({ timeout: 15_000 });
};

/** Two fights' worth: a player and an enemy on the city map, an enemy on a building's floor. */
const twoScenes = async (request: APIRequestContext, info: TestInfo, tag: string) => {
  const again = info.retry ? `_${info.retry + 1}` : '';
  const gm = await gmToken(request);
  await runningSystem(request, gm, SYSTEM(`${tag}${again}`));
  const player = { username: `e2e_${tag.toLowerCase()}_p${again}`, password: 'e2e-player-password' };
  await approvedPlayer(request, gm, player);
  await token(request, gm, { name: player.username, shape: 'rhombus', owner: player.username });
  const street = `${tag.toUpperCase()}_STREET${again}`;
  const roof = `${tag.toUpperCase()}_ROOF${again}`;
  await token(request, gm, { name: street, shape: 'enemy_rhombus' });
  const place = `${tag} Tower${again}`;
  const id = await building(request, gm, place, 'Roof');
  await token(request, gm, { name: roof, shape: 'enemy_rhombus', battle_map_id: id, floor_index: 0 });
  return { gm, player, street, roof, place, id, floor: `${place.toUpperCase()} — ROOF` };
};

test('two fights at once: the GM jumps between them from ACTIVE COMBATS, each as it was; a player sees only theirs (8i2)', async ({ page, browser, request }, info) => {
  test.setTimeout(240_000);
  const t = await twoScenes(request, info, 'Jumper');
  await page.setViewportSize({ width: 1280, height: 800 });
  await signInAsGm(page);
  await gmTracker(page);
  let roofStarted = false;
  try {
    // The street fight, on the city map: its enemy rolled.
    await startFight(page);
    await nav(page).getByRole('button', { name: 'ROLL ENEMIES' }).click();
    await expect(rows(page).filter({ hasText: t.street })).toHaveCount(1, { timeout: 15_000 });
    const player = await playerWindow(browser, info, t.player);
    await openPlayerTracker(player.page);
    await tracker(player.page).getByRole('button', { name: 'JOIN INITIATIVE' }).click();
    await expect(rows(page).filter({ hasText: t.player.username.toUpperCase() })).toHaveCount(1, { timeout: 15_000 });
    const streetUp = await up(page).textContent();

    // The roof fight: the GM goes there, starts a fight of its own, rolls only the roof's enemy, and moves it on.
    await gmEnter(page, t.place);
    await gmTracker(page);
    await startFight(page);
    roofStarted = true;
    await nav(page).getByRole('button', { name: 'ROLL ENEMIES' }).click();
    await expect(rows(page).filter({ hasText: t.roof })).toHaveCount(1, { timeout: 15_000 });
    await expect(rows(page).filter({ hasText: t.street })).toHaveCount(0);
    await nextUntil(page, 'ROUND 2');
    // The player, on the city map all along, saw none of it.
    await expect(rows(player.page).filter({ hasText: t.roof })).toHaveCount(0);
    await expect(tracker(player.page).getByText('ROUND 1', { exact: true })).toBeVisible();

    // ACTIVE COMBATS: both fights, each scene its own ROUND. Back to the street: as it was left.
    await expect(nav(page).getByRole('button', { name: `▶ ${t.floor} · ROUND 2` })).toBeVisible({ timeout: 15_000 });
    await jump(page, '▶ CITY MAP · ROUND 1');
    await expect(page.getByRole('button', { name: 'EXIT', exact: true })).toHaveCount(0, { timeout: 15_000 });
    await expect(tracker(page).getByText('ROUND 1', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(rows(page).filter({ hasText: t.street })).toHaveCount(1);
    await expect(rows(page).filter({ hasText: t.roof })).toHaveCount(0);
    await expect(up(page)).toHaveText(streetUp!);
    // And to the roof again: the map there, its fight at ROUND 2.
    await jump(page, `▶ ${t.floor} · ROUND 2`);
    await expect(page.getByRole('button', { name: 'EXIT', exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(tracker(page).getByText('ROUND 2', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(rows(page).filter({ hasText: t.roof })).toHaveCount(1);
    await player.context.close();

    // The roof's battle map deleted while its fight runs: jumping there says so, rather than a click doing nothing.
    await jump(page, '▶ CITY MAP · ROUND 1');
    const maps = await asGm(request, t.gm, 'get', `/api/locations/${t.id}/battle_maps`);
    for (const m of maps) await request.delete(`/api/locations/${t.id}/battle_maps/${m.id}`, { headers: { Authorization: `Bearer ${t.gm}` } });
    await nav(page).getByRole('button', { name: `▶ ${t.floor} · ROUND 2` }).click({ timeout: 15_000 });
    await expect(page.getByRole('heading', { name: 'NO_BATTLE_MAP_FOR_THAT_SCENE' })).toBeVisible({ timeout: 15_000 });
    await page.getByRole('heading', { name: 'NO_BATTLE_MAP_FOR_THAT_SCENE' }).click();
    await expect(page.getByRole('button', { name: 'EXIT', exact: true })).toHaveCount(0);
  } finally {
    // Every fight this left, ended from the menu: the street's and the roof's.
    if (await page.getByRole('heading', { name: 'NO_BATTLE_MAP_FOR_THAT_SCENE' }).isVisible()) await page.getByRole('heading', { name: 'NO_BATTLE_MAP_FOR_THAT_SCENE' }).click();
    await page.getByRole('button', { name: 'EXIT', exact: true }).click({ timeout: 10_000 }).catch(() => {});
    if (roofStarted) {
      const end = nav(page).getByRole('button', { name: /^End combat / });
      // One at a time, each waited for: ending one redraws the list under the next.
      for (let i = 0; i < 6; i++) {
        const n = await end.count();
        if (!n) break;
        await end.first().click({ timeout: 5_000 }).catch(() => {});
        await expect.poll(() => end.count(), { timeout: 15_000 }).toBeLessThan(n);
      }
    }
    await gmTracker(page);
  }
});

test('one fight over two scenes: the roof JOINs the street\'s combat, each keeps its own ROUND, one menu entry (8i2)', async ({ page, request }, info) => {
  test.setTimeout(240_000);
  const t = await twoScenes(request, info, 'Joiner');
  await page.setViewportSize({ width: 1280, height: 800 });
  await signInAsGm(page);
  await gmTracker(page);
  let roofStarted = false;
  try {
    await startFight(page);
    await nav(page).getByRole('button', { name: 'ROLL ENEMIES' }).click();
    await expect(rows(page).filter({ hasText: t.street })).toHaveCount(1, { timeout: 15_000 });

    // On the roof, JOIN EXISTING COMBAT: the street's.
    await gmEnter(page, t.place);
    await gmTracker(page);
    await tracker(page).getByRole('button', { name: 'JOIN EXISTING COMBAT' }).click();
    await tracker(page).getByRole('button', { name: /^COMBAT #\d+ \[1 SCENE\]$/ }).last().click();
    roofStarted = true;
    await nav(page).getByRole('button', { name: 'ROLL ENEMIES' }).click();
    await expect(rows(page).filter({ hasText: t.roof })).toHaveCount(1, { timeout: 15_000 });
    await nextUntil(page, 'ROUND 2');

    // One combat in the menu with both scenes, each at its own ROUND: the roof went round, the street did not.
    const entry = nav(page).locator('div').filter({ has: page.getByRole('button', { name: `▶ ${t.floor} · ROUND 2` }) }).filter({ has: page.getByRole('button', { name: '▶ CITY MAP · ROUND 1' }) });
    await expect(entry.first()).toBeVisible({ timeout: 15_000 });
    await jump(page, '▶ CITY MAP · ROUND 1');
    await expect(tracker(page).getByText('ROUND 1', { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(rows(page).filter({ hasText: t.street })).toHaveCount(1);
  } finally {
    if (roofStarted) {
      // END COMBAT from the menu: both scenes at once.
      const end = nav(page).getByRole('button', { name: /^End combat / });
      if (await end.count()) await end.last().click({ timeout: 15_000 });
    }
    await gmTracker(page);
  }
});
