import { test, expect } from '@playwright/test';
import { signInAsPlayer, gmToken, runningSystem, approvedPlayer, asGm } from './helpers';

// Dying at the table (8c3; approved mockup docs/mockups/rule-library.html, section 2). A game whose characters BLEED at 0: the
// GM's DAMAGE takes a player to 0, and their sheet shows the DYING box under the vitals box (the word, SAVES and FAILS);
// they press DEATH SAVE, the server rolls it, their tray says it and the box counts it; healed, the box is gone.

test('a player at 0 sees BLEEDING under their vitals, rolls a DEATH SAVE, sees it counted and said; healed, it is gone (8c3)', async ({ browser, request }, info) => {
  test.setTimeout(150_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const gm = await gmToken(request);
  await runningSystem(request, gm, {
    format: 1, name: `Bleedfall${again}`, core: { health: { model: 'pool' } },
    stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }] }],
    dying: { word: 'Bleeding', way: 'count', save: { dice: '1d20', way: 'at_least', target: '10' }, to_live: 3, to_die: 3 },
  });
  const player = { username: `e2e_bleeder${again}`, password: 'e2e-player-password' };
  await approvedPlayer(request, gm, player);
  const made = await asGm(request, gm, 'post', '/api/locations', {
    name: player.username, description: '', shape: 'rhombus', owner: player.username, x: 0, y: 0, z: 0, width: 1, height: 1, depth: 1,
    hp_current: 3, hp_max: 20, hp_temp: 0, battle_map_id: -1, floor_index: -1,
  });
  const id = made.data[0].id;
  const downNow = async () => {
    const row = (await asGm(request, gm, 'get', '/api/locations') as { id: number; dying: string | null }[]).find((l) => l.id === id);
    return row?.dying ? JSON.parse(row.dying) : null;
  };

  const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width: 1280, height: 900 } });
  const mine = await context.newPage();
  await signInAsPlayer(mine, player);
  await mine.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true }).click();
  await mine.getByRole('button', { name: 'CHARACTER_SHEET', exact: true }).click();
  await expect(mine.getByRole('group', { name: 'Vitals' })).toBeVisible({ timeout: 15_000 });
  await expect(mine.getByRole('region', { name: 'BLEEDING' })).toHaveCount(0);

  // The GM's DAMAGE takes them to 0: down, BLEEDING, nothing counted yet.
  await asGm(request, gm, 'put', `/api/locations/${id}/health`, { action: 'damage', amount: 5 });
  await expect.poll(downNow, { timeout: 15_000 }).toMatchObject({ state: 'dying', saves: 0, fails: 0 });
  const box = mine.getByRole('region', { name: 'BLEEDING' });
  await expect(box).toBeVisible({ timeout: 15_000 });
  await expect(box.getByRole('img', { name: 'SAVES 0 of 3' })).toBeVisible();
  await expect(box.getByRole('img', { name: 'FAILS 0 of 3' })).toBeVisible();
  await expect(box).toContainText('1d20 · 10 OR MORE');

  // DEATH SAVE: rolled by the server, counted one way or the other, said in their tray.
  await box.getByRole('button', { name: 'DEATH SAVE' }).click();
  await expect.poll(async () => { const d = await downNow(); return d ? d.saves + d.fails : -1; }, { timeout: 15_000 }).toBe(1);
  await expect(box.getByRole('img', { name: /^(SAVES|FAILS) 1 of 3$/ })).toBeVisible({ timeout: 15_000 });
  await mine.getByTitle('TOGGLE_HISTORY').click();
  const said = mine.getByTestId('dice-history').locator('> div').filter({ hasText: `${player.username.toUpperCase()} · DEATH SAVE 1d20` });
  await expect(said).toHaveCount(1, { timeout: 15_000 });
  await expect(said).toContainText(/10 OR MORE · (SUCCESS|FAILURE) · [01] OF 3 SAVES · [01] OF 3 FAILS/);

  // Healed above 0: back up, the box gone.
  await asGm(request, gm, 'put', `/api/locations/${id}/health`, { action: 'heal', amount: 4 });
  await expect.poll(downNow, { timeout: 15_000 }).toBeNull();
  await expect(box).toHaveCount(0, { timeout: 15_000 });
  await context.close();
});
