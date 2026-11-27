import { test, expect, type Page } from '@playwright/test';
import { signInAsPlayer, signInAsGm, gmToken, runningSystem, approvedPlayer, asGm } from './helpers';

// STABILIZE at the table (8c4b2; approved mockup docs/mockups/rule-library.html, section 3, answer 4). A friendly NPC goes down
// in a game whose friendly NPCs do, and whose STABILIZE is a HEAL roll vs 1 (a d20 always makes it). A player opens its HEALTH:
// the word, and YOUR HEAL VS 1 with STABILIZE; pressed, it is STABLE, said in the tray. The GM's HEALTH has the DYING box with
// BY HAND, and DEAD there is death.

const openToken = async (page: Page, name: string) => {
  const list = page.locator('.quick-access-panel');
  await expect(async () => {
    if (!(await list.isVisible())) await page.getByRole('button', { name: 'QUICK_ACCESS', exact: true }).click();
    await expect(list).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
  if (!(await list.getByText(name, { exact: true }).isVisible())) await list.getByText(/DEFINED_STRUCTURES/).click();
  await list.getByText(name, { exact: true }).click();
};
const window = (page: Page, name: string) => page.locator('.win95-window').filter({ hasText: `ID.EXE · ${name}` });

test('a player stabilizes a friendly NPC down from its HEALTH (YOUR HEAL VS 1), said to all; the GM says DEAD by hand (8c4b2)', async ({ page, browser, request }, info) => {
  test.setTimeout(180_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const gm = await gmToken(request);
  await runningSystem(request, gm, {
    format: 1, name: `Stablefall${again}`, core: { health: { model: 'pool' } },
    stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'heal', label: 'Heal' }] }],
    rolls: [{ id: 'check', label: 'Check', dice: [{ count: '1', sides: 20 }], add: '@this', by: ['heal'] }],
    dying: { word: 'Dying', way: 'count', npcs: { friendly: true }, stabilize: { field: 'heal', vs: '1' } },
  });
  const player = { username: `e2e_medic${again}`, password: 'e2e-player-password' };
  await approvedPlayer(request, gm, player);
  await asGm(request, gm, 'post', '/api/locations', {
    name: player.username, description: '', shape: 'rhombus', owner: player.username, x: 2, y: 0, z: 2, width: 1, height: 1, depth: 1,
    hp_current: 10, hp_max: 10, hp_temp: 0, battle_map_id: -1, floor_index: -1,
  });
  const npc = `Sergeant${again}`;
  const made = await asGm(request, gm, 'post', '/api/locations', { name: npc, description: 'An NPC', shape: 'friendly_rhombus', x: 0, y: 0, z: 0, width: 1, height: 1, depth: 1, hp_current: 3, hp_max: 10, hp_temp: 0 });
  const id = made.data[0].id;
  const downNow = async () => {
    const row = (await asGm(request, gm, 'get', '/api/locations') as { id: number; dying: string | null }[]).find((l) => l.id === id);
    return row?.dying ? JSON.parse(row.dying) : null;
  };
  await asGm(request, gm, 'put', `/api/locations/${id}/health`, { action: 'damage', amount: 5 });
  await expect.poll(downNow, { timeout: 15_000 }).toMatchObject({ state: 'dying' });

  // The player: the word, and theirs to offer.
  const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width: 1280, height: 900 } });
  const mine = await context.newPage();
  await signInAsPlayer(mine, player);
  await openToken(mine, npc);
  await window(mine, npc).getByRole('tab', { name: /HEALTH/ }).click();
  const theirs = window(mine, npc);
  await expect(theirs.getByRole('status', { name: 'Down: DYING' })).toBeVisible({ timeout: 15_000 });
  const offer = theirs.getByRole('group', { name: 'Stabilize them' });
  await expect(offer).toContainText('YOUR HEAL VS 1');
  await offer.getByRole('button', { name: 'STABILIZE' }).click();
  await expect(offer.getByRole('status')).toHaveText('STABILIZED', { timeout: 15_000 });
  await expect.poll(downNow, { timeout: 15_000 }).toMatchObject({ state: 'stable' });
  await expect(theirs.getByRole('status', { name: 'Down: STABLE' })).toBeVisible({ timeout: 15_000 });
  // Said to everyone, the player too.
  await mine.getByTitle('TOGGLE_HISTORY').click();
  await expect(mine.getByTestId('dice-history').locator('> div').filter({ hasText: `stabilizes ${npc.toUpperCase()} · Heal [` })).toHaveCount(1, { timeout: 15_000 });

  // The GM: the DYING box, now STABLE, with DEAD by hand.
  await page.setViewportSize({ width: 1280, height: 900 });
  await signInAsGm(page);
  await openToken(page, npc);
  await window(page, npc).getByRole('tab', { name: /HEALTH/ }).click();
  const box = window(page, npc).getByRole('region', { name: 'STABLE' });
  await expect(box).toBeVisible({ timeout: 15_000 });
  await box.getByRole('group', { name: 'By hand' }).getByRole('button', { name: 'DEAD' }).click();
  await expect.poll(downNow, { timeout: 15_000 }).toMatchObject({ state: 'dead' });
  await expect(window(page, npc).getByRole('region', { name: 'DEAD' })).toBeVisible({ timeout: 15_000 });
  await context.close();
});
