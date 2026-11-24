import { test, expect } from '@playwright/test';
import { signInAsGm, signInAsPlayer, openBuilder, builderPage, gmToken, asGm, runningSystem, approvedPlayer } from './helpers';

// A condition drawn on the 16 x 16 pad, at the table (8b1b; the user, 2026-11-23: "add it here just to get it done"). The GM
// draws BLINDED's picture on the builder's CONDITIONS page, two squares, and it is saved as a drawing in place of its icon;
// published and put on a player's token, the player's sheet shows the BLIND chip with those two squares.

const SYSTEM = (name: string) => ({
  format: 1, name, core: { health: { model: 'pool' } },
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }] }],
});

test('BLINDED drawn on the pad in the builder; published, its chip on a player\'s sheet draws it (8b1b)', async ({ page, browser, request }, info) => {
  test.setTimeout(180_000);
  const again = info.retry ? ` ${info.retry + 1}` : '';
  const name = `Inkfall${again}`;
  const gm = await gmToken(request);
  const id = await runningSystem(request, gm, SYSTEM(name));
  const player = { username: `e2e_inkfall${again.trim() ? `_${again.trim()}` : ''}`, password: 'e2e-player-password' };
  await approvedPlayer(request, gm, player);

  // The GM draws BLINDED's picture.
  await page.setViewportSize({ width: 1280, height: 800 });
  await signInAsGm(page);
  await openBuilder(page);
  const card = page.getByTestId(/^system-/).filter({ hasText: name.toUpperCase() });
  await expect(card).toBeVisible();
  if (!(await card.getByText('OPEN NOW', { exact: true }).first().isVisible())) {
    if (!(await card.getByRole('button', { name: 'OPEN', exact: true }).isVisible())) await card.getByRole('button').first().click();
    await card.getByRole('button', { name: 'OPEN', exact: true }).click();
  }
  await builderPage(page, 'CONDITIONS');
  const blinded = page.getByRole('region', { name: 'Blinded condition' });
  await blinded.getByRole('button', { name: 'DRAW' }).click();
  await expect(blinded.getByText('ON A CHIP · ON THE MAP')).toBeVisible();
  const pad = blinded.getByRole('group', { name: 'Drawing of Blinded' });
  for (const square of ['Square 1, 1', 'Square 16, 16']) {
    await pad.getByRole('button', { name: square, exact: true }).click();
    await expect(pad.getByRole('button', { name: square, exact: true })).toHaveAttribute('aria-pressed', 'true');
  }
  await blinded.getByRole('button', { name: 'DONE' }).click();
  await expect(page.getByTestId('save-status')).toHaveText(/· SAVED /, { timeout: 15_000 });
  const saved = await asGm(request, gm, 'get', `/api/systems/${id}`);
  expect(saved.problems).toEqual([]);
  expect(saved.draft.conditions).toEqual({ blinded: { drawn: ['8000', ...Array(14).fill('0000'), '0001'] } });

  // Published, and on the player's token.
  await asGm(request, gm, 'post', `/api/systems/${id}/publish`);
  const made = await asGm(request, gm, 'post', '/api/locations', {
    name: player.username, description: '', shape: 'rhombus', owner: player.username, x: 0, y: 0, z: 0, width: 1, height: 1, depth: 1,
    hp_current: 10, hp_max: 10, hp_temp: 0, battle_map_id: -1, floor_index: -1,
  });
  await asGm(request, gm, 'put', `/api/locations/${made.data[0].id}/conditions`, { conditions: [{ id: 'blinded' }] });

  // The player's sheet: the BLIND chip draws the two squares.
  const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width: 1280, height: 800 } });
  const mine = await context.newPage();
  await signInAsPlayer(mine, player);
  await mine.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true }).click();
  await mine.getByRole('button', { name: 'CHARACTER_SHEET', exact: true }).click();
  const chip = mine.getByRole('group', { name: 'Vitals' }).locator('..').getByRole('region', { name: 'Conditions' }).getByRole('button', { name: 'Blinded' });
  await expect(chip).toBeVisible({ timeout: 15_000 });
  await expect(chip.locator('rect')).toHaveCount(2);
  await context.close();
});
