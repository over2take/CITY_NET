import { test, expect } from '@playwright/test';
import { signInAsPlayer, gmToken, asGm, runningSystem, approvedPlayer } from './helpers';

// The sheet's conditions in a row of their own (8a6c; approved mockup docs/mockups/sheet-condition-row.html, A; the user:
// "max 2 rows then +N", a click opening one with TAKE OFF): all ten of a game's conditions on the token, laid out by the
// browser in two lines at most over + CONDITION, the rest behind "+N", whose list opens one. Set up through the API.

test('the sheet\'s conditions: two lines at most over + CONDITION, then "+N" opening the rest (8a6c)', async ({ browser, request }, info) => {
  test.setTimeout(120_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const gm = await gmToken(request);
  await runningSystem(request, gm, {
    format: 1, name: `Pileup${again}`, core: { health: { model: 'pool' } },
    stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }] }],
  });
  const player = { username: `e2e_pileup${again}`, password: 'e2e-player-password' };
  await approvedPlayer(request, gm, player);
  const made = await asGm(request, gm, 'post', '/api/locations', {
    name: player.username, description: '', shape: 'rhombus', owner: player.username, x: 0, y: 0, z: 0, width: 1, height: 1, depth: 1,
    hp_current: 10, hp_max: 10, hp_temp: 0, battle_map_id: -1, floor_index: -1,
  });
  const ids = ['blinded', 'bleeding', 'poisoned', 'prone', 'stunned', 'grappled', 'frightened', 'unconscious', 'restrained', 'exhausted'];
  await asGm(request, gm, 'put', `/api/locations/${made.data[0].id}/conditions`, { conditions: ids.map((id) => ({ id })) });

  const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width: 1280, height: 800 } });
  const mine = await context.newPage();
  await signInAsPlayer(mine, player);
  await mine.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true }).click();
  await mine.getByRole('button', { name: 'CHARACTER_SHEET', exact: true }).click();
  const chips = mine.getByRole('group', { name: 'Vitals' }).locator('..').getByRole('region', { name: 'Conditions' });
  const more = chips.getByRole('button', { name: /^\d+ more conditions$/ });
  await expect(more).toBeVisible({ timeout: 15_000 });

  // Each condition once: on the row, or behind "+N".
  const hidden = Number((await more.textContent())!.slice(1));
  const add = chips.getByRole('button', { name: 'Put on a condition' });
  const row = more.locator('..');
  const shown = row.getByRole('button', { name: /^(?!\d+ more)/ });
  expect((await shown.count()) + hidden).toBe(ids.length);
  expect(hidden).toBeGreaterThan(0);
  // Two lines, no more, all over + CONDITION's line.
  const tops = new Set<number>();
  for (const box of await row.getByRole('button').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().top))) tops.add(Math.round(box));
  expect(tops.size).toBe(2);
  const addTop = (await add.boundingBox())!.y;
  for (const top of tops) expect(top).toBeLessThan(addTop);

  // "+N" lists the rest; one of them opens with what it is and TAKE OFF.
  await more.click();
  const list = mine.getByRole('group', { name: 'More conditions' });
  await expect(list.getByRole('button')).toHaveCount(hidden);
  await list.getByRole('button', { name: 'EXHAUSTED' }).click();
  const open = mine.getByRole('group', { name: 'Exhausted', exact: true });
  await expect(open).toContainText('EXHAUSTED');
  await open.getByRole('button', { name: 'Take Exhausted off' }).click();
  const conditionsOn = async () => JSON.parse((await asGm(request, gm, 'get', '/api/locations')).find((l: { id: number }) => l.id === made.data[0].id).conditions || '[]').map((c: { id: string }) => c.id);
  await expect.poll(conditionsOn, { timeout: 15_000 }).toEqual(ids.filter((id) => id !== 'exhausted'));
  await context.close();
});
