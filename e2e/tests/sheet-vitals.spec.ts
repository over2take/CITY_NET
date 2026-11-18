import { test, expect } from '@playwright/test';
import { signInAsPlayer, gmToken, runningSystem, approvedPlayer, asGm } from './helpers';

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
  await expect(health).toContainText('18 / 20');
  await expect(health.getByRole('button', { name: '+ CONDITION', exact: true })).toBeVisible();
  // Not a second DAMAGE and HEAL: the strip has them.
  await expect(health.getByRole('button', { name: 'DAMAGE', exact: true })).toHaveCount(0);
  await context.close();
});
