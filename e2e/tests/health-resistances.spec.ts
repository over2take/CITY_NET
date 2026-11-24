import { test, expect } from '@playwright/test';
import { signInAsPlayer, signInAsGm, gmToken, runningSystem, approvedPlayer, asGm } from './helpers';

// RESISTANCES and VULNERABILITIES at the table (8b3c2b; the user, 2026-11-24, draft 2 approved). A player in their HEALTH
// window: none yet, + RESISTANCE, IMMUNE FIRE added, no VULNERABILITIES row and no + VULNERABILITY; SOAKED put on their
// token shows them VULNERABLE LIGHTNING, opened to say where from; the same two rows in SHEET.EXE's HIT POINTS ▾. The GM,
// in their view of the sheet, adds VULNERABLE COLD.

test('a player adds IMMUNE FIRE, sees SOAKED\'s VULNERABLE LIGHTNING and can\'t add one; the GM adds VULNERABLE COLD (8b3c2b)', async ({ page, browser, request }, info) => {
  test.setTimeout(150_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const gm = await gmToken(request);
  await runningSystem(request, gm, {
    format: 1, name: `Resistfall${again}`, core: { health: { model: 'pool' } },
    stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }] }],
    conditions: { soaked: { name: 'Soaked', resistances: [{ kind: 'vulnerable', type: 'lightning' }] } },
  });
  const player = { username: `e2e_resists${again}`, password: 'e2e-player-password' };
  await approvedPlayer(request, gm, player);
  const made = await asGm(request, gm, 'post', '/api/locations', {
    name: player.username, description: '', shape: 'rhombus', owner: player.username, x: 0, y: 0, z: 0, width: 1, height: 1, depth: 1,
    hp_current: 20, hp_max: 20, hp_temp: 0, battle_map_id: -1, floor_index: -1,
  });
  const id = made.data[0].id;
  const handOf = async () => (await asGm(request, gm, 'get', `/api/locations/${id}/resistances`)).hand;

  const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width: 1280, height: 900 } });
  const mine = await context.newPage();
  await signInAsPlayer(mine, player);
  // Their sheet first, made as it opens: by hand is kept there.
  await mine.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true }).click();
  await mine.getByRole('button', { name: 'CHARACTER_SHEET', exact: true }).click();
  const strip = mine.getByRole('group', { name: 'Vitals' });
  await expect(strip).toBeVisible({ timeout: 15_000 });
  await mine.getByRole('button', { name: 'HIT_POINTS', exact: true }).click();
  const health = mine.getByRole('tabpanel');
  const resist = health.getByRole('region', { name: 'Resistances' });
  await expect(resist).toContainText('None.', { timeout: 15_000 });
  // Theirs to add, a vulnerability not.
  await expect(health.getByRole('region', { name: 'Vulnerabilities' })).toHaveCount(0);
  await resist.getByRole('button', { name: '+ RESISTANCE' }).click();
  const add = resist.getByRole('group', { name: 'Add a resistance' });
  await add.getByRole('button', { name: 'IMMUNE', exact: true }).click();
  await add.getByRole('button', { name: 'FIRE', exact: true }).click();
  await expect(resist.getByRole('button', { name: 'IMMUNE FIRE' })).toBeVisible({ timeout: 15_000 });
  await expect.poll(handOf, { timeout: 15_000 }).toEqual([{ kind: 'immune', type: 'fire', by: player.username }]);

  // SOAKED on their token: VULNERABLE LIGHTNING shows, opened to say where from; still no + VULNERABILITY.
  await asGm(request, gm, 'put', `/api/locations/${id}/conditions`, { conditions: [{ id: 'soaked' }] });
  const vulnerable = health.getByRole('region', { name: 'Vulnerabilities' });
  await vulnerable.getByRole('button', { name: 'VULNERABLE LIGHTNING' }).click({ timeout: 15_000 });
  await expect(vulnerable.getByRole('group', { name: 'VULNERABLE LIGHTNING' })).toContainText('FROM: Soaked');
  await expect(vulnerable.getByRole('group', { name: 'VULNERABLE LIGHTNING' })).toContainText('Takes double.');
  await expect(vulnerable.getByRole('button', { name: '+ VULNERABILITY' })).toHaveCount(0);

  // The HEALTH window closed with its own ×, the nearest window round its rows; the same in SHEET.EXE's HIT POINTS ▾.
  await resist.locator('xpath=ancestor::*[.//button[contains(@class, "win95-close-btn")]][1]//button[contains(@class, "win95-close-btn") and text()="×"]').click();
  await expect(resist).toBeHidden();
  await strip.getByRole('button', { name: /^HIT POINTS/ }).click({ timeout: 15_000 });
  const drawer = mine.getByRole('region', { name: 'Health' });
  await expect(drawer.getByRole('region', { name: 'Resistances' }).getByRole('button', { name: 'IMMUNE FIRE' })).toBeVisible({ timeout: 15_000 });
  await expect(drawer.getByRole('region', { name: 'Vulnerabilities' }).getByRole('button', { name: 'VULNERABLE LIGHTNING' })).toBeVisible();

  // The GM, in their view of the sheet: VULNERABLE COLD.
  await signInAsGm(page);
  await page.getByRole('button', { name: 'GLOBAL_CHAT', exact: true }).click();
  await page.getByText(player.username, { exact: true }).first().click();
  await page.getByRole('button', { name: 'VIEW_PLAYER_INFO', exact: true }).click();
  await page.getByRole('button', { name: 'OPEN_SHEET', exact: true }).click();
  await page.getByRole('group', { name: 'Vitals' }).getByRole('button', { name: /^HIT POINTS/ }).click({ timeout: 15_000 });
  const gmVulnerable = page.getByRole('region', { name: 'Health' }).getByRole('region', { name: 'Vulnerabilities' });
  await gmVulnerable.getByRole('button', { name: '+ VULNERABILITY' }).click({ timeout: 15_000 });
  await gmVulnerable.getByRole('group', { name: 'Add a vulnerability' }).getByRole('button', { name: 'COLD', exact: true }).click();
  await expect.poll(handOf, { timeout: 15_000 }).toEqual([{ kind: 'immune', type: 'fire', by: player.username }, { kind: 'vulnerable', type: 'cold' }]);
  // The player's SHEET.EXE follows.
  await expect(drawer.getByRole('region', { name: 'Vulnerabilities' }).getByRole('button', { name: 'VULNERABLE COLD' })).toBeVisible({ timeout: 15_000 });
  await context.close();
});
