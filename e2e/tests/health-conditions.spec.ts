import { test, expect } from '@playwright/test';
import { signInAsPlayer, gmToken, asGm, runningSystem, approvedPlayer } from './helpers';

// The conditions in ID.EXE's HEALTH folder, folded away (8a6d; the pattern of docs/mockups/sheet-condition-row.html; the
// user, 2026-11-19: "A: click a chip"): the chips only, each clicked open with what it is and what it does, one at a time,
// and TAKE OFF there where the × was. Set up through the API.

test('ID.EXE\'s conditions: chips, one clicked open with what it does, taken off from there (8a6d)', async ({ browser, request }, info) => {
  test.setTimeout(120_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const gm = await gmToken(request);
  await runningSystem(request, gm, {
    format: 1, name: `Foldaway${again}`, core: { health: { model: 'pool' } },
    stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }] }],
  });
  const player = { username: `e2e_foldaway${again}`, password: 'e2e-player-password' };
  await approvedPlayer(request, gm, player);
  const made = await asGm(request, gm, 'post', '/api/locations', {
    name: player.username, description: '', shape: 'rhombus', owner: player.username, x: 0, y: 0, z: 0, width: 1, height: 1, depth: 1,
    hp_current: 10, hp_max: 10, hp_temp: 0, battle_map_id: -1, floor_index: -1,
  });
  const id = made.data[0].id;
  await asGm(request, gm, 'put', `/api/locations/${id}/conditions`, { conditions: [{ id: 'blinded' }, { id: 'unconscious' }, { id: 'exhausted' }] });
  const conditionsOn = async () => JSON.parse((await asGm(request, gm, 'get', '/api/locations')).find((l: { id: number }) => l.id === id).conditions || '[]').map((c: { id: string }) => c.id);

  const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width: 1280, height: 800 } });
  const mine = await context.newPage();
  await signInAsPlayer(mine, player);
  await mine.getByRole('button', { name: 'HIT_POINTS', exact: true }).click();
  const conditions = mine.getByRole('tabpanel').getByRole('region', { name: 'Conditions' });
  const chips = conditions.getByRole('group', { name: 'On this token' }).getByRole('button');
  await expect(chips).toHaveText(['BLIND', 'OUT', 'TIRED'], { timeout: 15_000 });
  // Folded away until clicked.
  await expect(conditions.getByRole('group', { name: 'Unconscious', exact: true })).toHaveCount(0);

  await conditions.getByRole('button', { name: 'Unconscious', exact: true }).click();
  const out = conditions.getByRole('group', { name: 'Unconscious', exact: true });
  await expect(out).toContainText('UNCONSCIOUS');
  // Another clicked takes its place.
  await conditions.getByRole('button', { name: 'Blinded', exact: true }).click();
  await expect(out).toHaveCount(0);
  const blind = conditions.getByRole('group', { name: 'Blinded', exact: true });
  await expect(blind).toContainText('BLINDED');
  await blind.getByRole('button', { name: 'Take Blinded off' }).click();
  await expect.poll(conditionsOn, { timeout: 15_000 }).toEqual(['unconscious', 'exhausted']);
  await expect(chips).toHaveText(['OUT', 'TIRED'], { timeout: 15_000 });
  await context.close();
});
