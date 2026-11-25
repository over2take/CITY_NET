import { test, expect, type Page } from '@playwright/test';
import { signInAsPlayer, signInAsGm, gmToken, runningSystem, approvedPlayer, asGm } from './helpers';

// REVEAL at the table (8b4b, a friendly NPC: QUICK_ACCESS lists those, not enemies; the user, 2026-11-24: kept on the NPC's sheet, NPCs only, players see nothing until something
// is revealed). An NPC that RESISTS COLD and is VULNERABLE to FIRE: the GM's HEALTH draws both dotted with a GM mark; a
// player looking sees no rows at all. The GM reveals COLD: the player sees RESIST COLD, its helper on hover saying what it
// means but never where it comes from, and still no VULNERABILITIES. REVEAL ALL: the player sees VULNERABLE FIRE too.

/** A token's window by its name, from QUICK_ACCESS, on its HEALTH folder: the panel. */
const healthOf = async (page: Page, name: string) => {
  await page.getByRole('button', { name: 'QUICK_ACCESS', exact: true }).click();
  const list = page.locator('.quick-access-panel');
  await list.getByText(/DEFINED_STRUCTURES/).click();
  await list.getByText(name, { exact: true }).click();
  await page.getByRole('tab', { name: /HEALTH/ }).click();
  return page.getByRole('tabpanel');
};

test('the GM reveals an NPC\'s RESIST COLD, then ALL; a player sees nothing, then COLD, then FIRE too (8b4b)', async ({ page, browser, request }, info) => {
  test.setTimeout(150_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const gm = await gmToken(request);
  await runningSystem(request, gm, {
    format: 1, name: `Revealfall${again}`, core: { health: { model: 'pool' } },
    stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }] }],
  });
  const player = { username: `e2e_reveals${again}`, password: 'e2e-player-password' };
  await approvedPlayer(request, gm, player);
  const ghoul = `Reveal Ghoul${again}`;
  const sheet = await asGm(request, gm, 'post', '/api/sheets/npcs', {
    npc_label: ghoul, data: { name: ghoul, _resistances: [{ kind: 'resist', type: 'cold' }, { kind: 'vulnerable', type: 'fire' }] },
  });
  const made = await asGm(request, gm, 'post', '/api/locations', {
    name: ghoul, description: 'An NPC', shape: 'friendly_rhombus', x: 0, y: 0, z: 0, width: 1, height: 1, depth: 1,
    hp_current: 12, hp_max: 12, hp_temp: 0,
  });
  const id = made.data[0].id;
  await asGm(request, gm, 'post', `/api/sheets/npcs/${sheet.id}/link`, { location_id: id });
  const revealed = async () => (await asGm(request, gm, 'get', `/api/locations/${id}/resistances`)).revealed;

  // The player, looking: nothing at all.
  const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width: 1280, height: 900 } });
  const mine = await context.newPage();
  await signInAsPlayer(mine, player);
  const theirs = await healthOf(mine, ghoul);
  await expect(theirs.getByRole('img', { name: /^Heart monitor/ })).toBeVisible({ timeout: 15_000 });
  await expect(theirs.getByRole('region', { name: 'Resistances' })).toHaveCount(0);
  await expect(theirs.getByRole('region', { name: 'Vulnerabilities' })).toHaveCount(0);

  // The GM: both, dotted, unrevealed; COLD opened and revealed.
  await page.setViewportSize({ width: 1280, height: 900 });
  await signInAsGm(page);
  const mineGm = await healthOf(page, ghoul);
  const resist = mineGm.getByRole('region', { name: 'Resistances' });
  await expect(resist.getByRole('button', { name: 'RESIST COLD, not revealed' })).toBeVisible({ timeout: 15_000 });
  await expect(mineGm.getByRole('region', { name: 'Vulnerabilities' }).getByRole('button', { name: 'VULNERABLE FIRE, not revealed' })).toBeVisible();
  await expect(mineGm.getByRole('group', { name: 'What players see' })).toContainText('PLAYERS SEE ONLY WHAT YOU REVEAL');
  await resist.getByRole('button', { name: 'RESIST COLD, not revealed' }).click();
  await expect(resist.getByRole('group', { name: 'RESIST COLD' })).toContainText('Players don\'t see it yet.');
  await resist.getByRole('button', { name: 'Reveal RESIST COLD to players' }).click();
  await expect.poll(revealed, { timeout: 15_000 }).toEqual(['cold']);
  await expect(resist.getByRole('button', { name: 'RESIST COLD', exact: true })).toBeVisible({ timeout: 15_000 });

  // The player: RESIST COLD, its helper saying what it means, never where from; no VULNERABILITIES yet.
  const cold = theirs.getByRole('region', { name: 'Resistances' }).getByRole('button', { name: 'RESIST COLD', exact: true });
  await expect(cold).toBeVisible({ timeout: 15_000 });
  await cold.hover();
  const helper = mine.getByRole('tooltip');
  await expect(helper).toContainText('Takes half, rounded down.');
  await expect(helper).not.toContainText('From');
  await expect(theirs.getByRole('region', { name: 'Resistances' }).getByRole('button', { name: '+ RESISTANCE' })).toHaveCount(0);
  await expect(theirs.getByRole('region', { name: 'Vulnerabilities' })).toHaveCount(0);

  // REVEAL ALL: VULNERABLE FIRE reaches the player too.
  await mineGm.getByRole('group', { name: 'What players see' }).getByRole('button', { name: 'REVEAL ALL' }).click();
  await expect.poll(revealed, { timeout: 15_000 }).toEqual(['cold', 'fire']);
  await expect(mineGm.getByRole('group', { name: 'What players see' })).toContainText('PLAYERS SEE ALL OF THESE');
  await expect(theirs.getByRole('region', { name: 'Vulnerabilities' }).getByRole('button', { name: 'VULNERABLE FIRE', exact: true })).toBeVisible({ timeout: 15_000 });
  await context.close();
});
