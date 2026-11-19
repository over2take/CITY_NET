import { test, expect } from '@playwright/test';
import { signInAsPlayer, gmToken, asGm, runningSystem, approvedPlayer } from './helpers';

// A condition APPLIED at the table (8a5e3; approved mockup docs/mockups/condition-modifiers.html, 2026-11-18; the user: "we
// just need to show the effect SLOWED: Speed ×0.5 and update the movement/speed on the sheet"): SLOWED put on from the HP box,
// Speed's box saying SLOWED: Speed ×0.5 with its number halved; taken off, gone again. Set up through the API.

test('SLOWED APPLIED at the table: Speed halved with "SLOWED: Speed ×0.5" under it, gone when it comes off (8a5e3)', async ({ browser, request }, info) => {
  test.setTimeout(120_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const gm = await gmToken(request);
  await runningSystem(request, gm, {
    format: 1, name: `Snailtown${again}`, core: { health: { model: 'pool' } },
    stats: [{ id: 'move', label: 'MOVEMENT', stats: [{ id: 'speed', label: 'Speed' }] }],
    conditions: { slowed: { name: 'Slowed', icon: 'snow', applied: true, modifiers: [{ target: 'speed', way: 'times', amount: 0.5 }] } },
  });
  const player = { username: `e2e_snail${again}`, password: 'e2e-player-password' };
  await approvedPlayer(request, gm, player);
  await asGm(request, gm, 'post', '/api/locations', {
    name: player.username, description: '', shape: 'rhombus', owner: player.username, x: 0, y: 0, z: 0, width: 1, height: 1, depth: 1,
    hp_current: 10, hp_max: 10, hp_temp: 0, battle_map_id: -1, floor_index: -1,
  });

  const context = await browser.newContext({ baseURL: info.project.use.baseURL });
  const mine = await context.newPage();
  await signInAsPlayer(mine, player);
  await mine.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true }).click();
  await mine.getByRole('button', { name: 'CHARACTER_SHEET', exact: true }).click();
  await mine.getByLabel('Speed', { exact: true }).fill('30');
  await expect.poll(async () => (await asGm(request, gm, 'get', `/api/sheets/user/${player.username}`)).data.speed, { timeout: 15_000 }).toBe(30);

  // SLOWED on, from the conditions under the HP box.
  const chips = mine.getByRole('group', { name: 'Vitals' }).locator('..').getByRole('region', { name: 'Conditions' });
  await chips.getByRole('button', { name: 'Put on a condition' }).click();
  await mine.getByRole('listbox', { name: 'Put on a condition' }).getByRole('option', { name: /SLOWED/ }).click();
  const note = mine.getByRole('note', { name: 'Conditions on Speed' });
  await expect(note).toHaveText('SLOWED: Speed ×0.5 · typed 30', { timeout: 15_000 });
  // The changed number as the big one (the user's pick, 2026-11-19).
  await expect(mine.getByRole('button', { name: /^Speed 15, changed by a condition/ })).toBeVisible();

  // Off again: back to as typed, said no more.
  await chips.getByRole('button', { name: 'Slowed', exact: true }).click();
  await mine.getByRole('group', { name: 'Slowed', exact: true }).getByRole('button', { name: 'Take Slowed off' }).click();
  await expect(note).toHaveCount(0, { timeout: 15_000 });
  await expect(mine.getByLabel('Speed', { exact: true })).toHaveValue('30');
  await context.close();
});
