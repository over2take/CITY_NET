import { test, expect } from '@playwright/test';
import { signInAsGm, signInAsPlayer, gmToken, asGm, runningSystem, approvedPlayer } from './helpers';
import { tracker, rows, nav, gmTracker, startFight, nextUntil } from './initiative';

// A condition's EACH TURN at the table (8a9c; approved mockup docs/mockups/condition-turn-effects.html, 2026-11-19): in a game
// whose conditions act on turns, round 1 waits on BEGIN ROUND 1; BURNING burns on its own; an NPC's save is asked of the GM
// on its row and rolled from there; and the GAME tab's CONDITION TURN EFFECTS switched off, nothing more is rolled. Set up
// through the API. city:0's fight is everyone's, so this ends what it starts, and puts the switch back. And a save asked
// of a player (8a9c2): said beside the GM's NEXT, and rolled from under the HP box on the player's sheet.

const SYSTEM = (name: string) => ({
  format: 1, name, core: { health: { model: 'pool' } }, stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }] }],
  conditions: {
    burning: { name: 'Burning', each_turn: [{ when: 'turn_start', does: 'damage', roll: '1' }] },
    // Never met, so it stays on to be asked again.
    venom: { name: 'Venom', each_turn: [{ when: 'turn_end', does: 'roll_to_end', roll: '1d20', ends_on: 999, rolled_by: 'player' }] },
  },
});

test('EACH TURN at the table: BEGIN ROUND 1, BURNING burns, an NPC\'s save rolled from its row; switched off, nothing rolled (8a9c)', async ({ page, request }, info) => {
  test.setTimeout(180_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const gm = await gmToken(request);
  await runningSystem(request, gm, SYSTEM(`Turnfx${again}`));
  const enemy = `TURNFX_GANGER${again}`;
  const made = await asGm(request, gm, 'post', '/api/locations', { name: enemy, shape: 'enemy_rhombus', description: '', x: 0, y: 0, z: 0, width: 1, height: 1, depth: 1, hp_current: 10, hp_max: 10, hp_temp: 0 });
  const id = made.data[0].id as number;
  await asGm(request, gm, 'put', `/api/locations/${id}/conditions`, { conditions: [{ id: 'burning' }, { id: 'venom' }] });
  const hp = async () => (await asGm(request, gm, 'get', '/api/locations')).find((l: { id: number }) => l.id === id).hp_current as number;
  const setting = (value: string) => asGm(request, gm, 'post', '/api/settings', { key: 'condition_turn_effects', value });
  const roll = () => rows(page).filter({ hasText: enemy }).getByRole('button', { name: 'ROLL · VENOM SAVE' });

  await page.setViewportSize({ width: 1280, height: 800 });
  await signInAsGm(page);
  await gmTracker(page);
  try {
    // Round 1 not begun: said, and BEGIN in NEXT's place.
    await startFight(page);
    await nav(page).getByRole('button', { name: 'ROLL ENEMIES' }).click();
    await expect(rows(page).filter({ hasText: enemy })).toHaveCount(1, { timeout: 15_000 });
    await expect(tracker(page).getByText('ROUND 1 · NOT BEGUN', { exact: true })).toBeVisible();
    await expect(tracker(page).getByRole('button', { name: 'NEXT', exact: true })).toHaveCount(0);
    await tracker(page).getByRole('button', { name: 'BEGIN ROUND 1' }).click();
    await expect(tracker(page).getByRole('button', { name: 'NEXT', exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(tracker(page).getByText('ROUND 1', { exact: true })).toBeVisible();

    // Round the order: its turn came, BURNING burned on its own, and its VENOM save waits on the GM, on its row.
    await nextUntil(page, 'ROUND 2');
    await expect(roll()).toBeVisible({ timeout: 15_000 });
    await expect.poll(hp, { timeout: 15_000 }).toBeLessThan(10);
    await roll().click();
    await expect(roll()).toHaveCount(0, { timeout: 15_000 });
    await expect(tracker(page).getByRole('alert')).toHaveCount(0);

    // CONDITION TURN EFFECTS off: a whole round more, nothing burns and nothing is asked.
    await setting('0');
    const left = await hp();
    await nextUntil(page, 'ROUND 3');
    await expect(roll()).toHaveCount(0);
    expect(await hp()).toBe(left);
  } finally {
    await setting('1');
    await gmTracker(page);
  }
});

test('a save asked of a player: WAITING ON beside the GM\'s NEXT, YOUR SAVE under their HP box, rolled from there (8a9c2)', async ({ page, browser, request }, info) => {
  test.setTimeout(180_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const gm = await gmToken(request);
  await runningSystem(request, gm, SYSTEM(`Turnask${again}`));
  const player = { username: `e2e_turnask${again}`, password: 'e2e-player-password' };
  await approvedPlayer(request, gm, player);
  const made = await asGm(request, gm, 'post', '/api/locations', {
    name: player.username, description: '', shape: 'rhombus', owner: player.username, x: 0, y: 0, z: 0, width: 1, height: 1, depth: 1,
    hp_current: 10, hp_max: 10, hp_temp: 0, battle_map_id: -1, floor_index: -1,
  });
  await asGm(request, gm, 'put', `/api/locations/${made.data[0].id}/conditions`, { conditions: [{ id: 'venom' }] });

  await page.setViewportSize({ width: 1280, height: 800 });
  await signInAsGm(page);
  await gmTracker(page);
  const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width: 1280, height: 800 } });
  try {
    await startFight(page);
    // The player joins from their own tracker, and opens their sheet.
    const mine = await context.newPage();
    await signInAsPlayer(mine, player);
    await expect(tracker(mine)).toBeVisible({ timeout: 15_000 });
    await tracker(mine).getByRole('button', { name: 'JOIN INITIATIVE' }).click();
    await expect(rows(page).filter({ hasText: player.username.toUpperCase() })).toHaveCount(1, { timeout: 15_000 });
    await mine.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true }).click();
    await mine.getByRole('button', { name: 'CHARACTER_SHEET', exact: true }).click();
    await expect(mine.getByRole('group', { name: 'Vitals' })).toBeVisible({ timeout: 15_000 });

    // Begun, and round the order: the player's turn ended, their VENOM save asked of them.
    await tracker(page).getByRole('button', { name: 'BEGIN ROUND 1' }).click();
    await expect(tracker(page).getByRole('button', { name: 'NEXT', exact: true })).toBeVisible({ timeout: 15_000 });
    await nextUntil(page, 'ROUND 2');
    const waiting = tracker(page).getByTestId('initiative-waiting');
    await expect(waiting).toHaveText(`WAITING ON ${player.username.toUpperCase()}'S VENOM SAVE`, { timeout: 15_000 });
    const asked = mine.getByRole('region', { name: 'Rolls asked' });
    await expect(asked).toContainText('VENOM · YOUR SAVE', { timeout: 15_000 });
    await expect(asked).toContainText('End of your turn: 1d20, 999 or more ends it.');

    // Rolled from the sheet: gone there, and from beside the GM's NEXT.
    await asked.getByRole('button', { name: 'ROLL SAVE' }).click();
    await expect(asked).toHaveCount(0, { timeout: 15_000 });
    await expect(waiting).toHaveCount(0, { timeout: 15_000 });
  } finally {
    await context.close();
    await gmTracker(page);
  }
});
