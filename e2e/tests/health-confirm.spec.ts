import { test, expect, type Page } from '@playwright/test';
import { signInAsPlayer, signInAsGm, gmToken, runningSystem, approvedPlayer, asGm, sheetTab } from './helpers';

// APPLY DAMAGE CONFIRM at the table (8b6b1, 8b6b2; approved mockup docs/mockups/waiting-hits.html). A player hits an NPC that
// RESISTS FIRE with MELEE and a d20 (AC 0, a HIT), then rolls a Flame Tongue's "4 SLASHING + 6 FIRE DMG": the log says WAITING
// ON ITS HEALTH and nothing is taken. On the NPC's HEALTH the player, who made it but doesn't play the NPC, reads "1 HIT
// WAITING · THE GM APPLIES IT". The GM's HEALTH tab says 1 WAITING and its row WOULD TAKE 7 OF 10; APPLY 7 takes 7 off. A
// second hit the GM DISMISSes: nothing taken. A friendly NPC, as QUICK_ACCESS lists those.

const SETTINGS = ['apply_damage', 'work_out_resistances', 'hit_totals_gm_only'];

const openToken = async (page: Page, name: string) => {
  const list = page.locator('.quick-access-panel');
  // The menu button toggles: pressed till its panel shows.
  await expect(async () => {
    if (!(await list.isVisible())) await page.getByRole('button', { name: 'QUICK_ACCESS', exact: true }).click();
    await expect(list).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
  if (!(await list.getByText(name, { exact: true }).isVisible())) await list.getByText(/DEFINED_STRUCTURES/).click();
  await list.getByText(name, { exact: true }).click();
};
const window = (page: Page, name: string) => page.locator('.win95-window').filter({ hasText: `ID.EXE · ${name}` });

/** MELEE on its window and a d20 (a HIT on AC 0), then the Flame Tongue's DAMAGE from GEAR. */
const hitWithFlameTongue = async (page: Page, name: string) => {
  await openToken(page, name);
  await page.getByRole('button', { name: /MELEE/ }).first().click();
  await expect(page.getByText(/AWAITING_ROLL/).first()).toBeVisible({ timeout: 15_000 });
  const d20 = page.getByRole('button', { name: 'One more d20', exact: true });
  if (!(await d20.isVisible())) await page.getByRole('button', { name: 'DICE_ROLLER', exact: true }).click();
  await d20.click();
  await page.getByRole('button', { name: /ROLL DICE/ }).click();
  await expect(page.getByText(/AWAITING_ROLL/)).toHaveCount(0, { timeout: 15_000 });
  const tray = page.getByText('DICE_TRAY.EXE', { exact: true });
  await expect(tray).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press('Escape');
  await expect(tray).toBeHidden();
  await window(page, name).locator('.win95-close-btn', { hasText: '×' }).first().click();
  await page.getByRole('button', { name: 'DICE_ROLLER', exact: true }).click();
  await expect(d20).toBeHidden();
  await page.getByRole('region', { name: 'WEAPONS gear' }).getByRole('button', { name: 'Roll Item 1 DAMAGE' }).click();
  await expect(tray).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press('Escape');
  await expect(tray).toBeHidden();
};

test('APPLY DAMAGE CONFIRM: the hit waits on the NPC\'s HEALTH, the player told only that it waits, the GM APPLYs one and DISMISSes another (8b6b2)', async ({ page, browser, request }, info) => {
  test.setTimeout(200_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const gm = await gmToken(request);
  await runningSystem(request, gm, {
    format: 1, name: `Waitfall${again}`, core: { health: { model: 'pool' } },
    stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }] }],
    items: {
      types: [{ id: 'weapons', label: 'WEAPONS', one: 'Weapon', columns: [{ id: 'damage', label: 'DAMAGE', kind: 'damage' }] }],
      list: [{ id: 'tongue', label: 'Flame Tongue', type: 'weapons', values: { damage: '4 SLASHING + 6 FIRE DMG' } }],
    },
    damage: { apply: 'confirm' },
  });
  for (const key of SETTINGS) await asGm(request, gm, 'post', '/api/settings', { key, value: '' });
  const player = { username: `e2e_waits${again}`, password: 'e2e-player-password' };
  await approvedPlayer(request, gm, player);
  const ghoul = `Marsh Ghoul${again}`;
  const sheet = await asGm(request, gm, 'post', '/api/sheets/npcs', { npc_label: ghoul, data: { name: ghoul, _resistances: [{ kind: 'resist', type: 'fire' }] } });
  const token = { name: ghoul, description: 'An NPC', shape: 'friendly_rhombus', x: 0, y: 0, z: 0, width: 1, height: 1, depth: 1 };
  const id = (await asGm(request, gm, 'post', '/api/locations', { ...token, hp_current: 20, hp_max: 20, hp_temp: 0 })).data[0].id as number;
  await asGm(request, gm, 'put', `/api/locations/${id}`, { ...token, melee_ac: 0, ranged_ac: 0 });
  await asGm(request, gm, 'post', `/api/sheets/npcs/${sheet.id}/link`, { location_id: id });
  const hp = async () => (await asGm(request, gm, 'get', '/api/locations') as { id: number; hp_current: number }[]).find((l) => l.id === id)?.hp_current;

  await page.setViewportSize({ width: 1280, height: 900 });
  await signInAsGm(page);
  const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width: 1280, height: 900 } });
  const mine = await context.newPage();
  await signInAsPlayer(mine, player);
  // A Flame Tongue on their GEAR.
  await mine.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true }).click();
  await mine.getByRole('button', { name: 'CHARACTER_SHEET', exact: true }).click();
  await sheetTab(mine, 'GEAR');
  const weapons = mine.getByRole('region', { name: 'WEAPONS gear' });
  await mine.getByRole('group', { name: 'Add by hand' }).getByRole('button', { name: 'Add a Weapon by hand' }).click();
  await weapons.getByLabel('Item 1 name', { exact: true }).fill('Flame Tongue');
  await expect.poll(async () => JSON.parse(String((await asGm(request, gm, 'get', `/api/sheets/user/${player.username}`)).data.inventory ?? '[]'))[0]?.name, { timeout: 15_000 }).toBe('Flame Tongue');
  await weapons.getByRole('button', { name: 'DONE', exact: true }).click();

  // The hit: kept, nothing taken.
  await hitWithFlameTongue(mine, ghoul);
  expect(await hp()).toBe(20);
  // The player made it but doesn't play the NPC: told it waits, and who applies it.
  await openToken(mine, ghoul);
  await window(mine, ghoul).getByRole('tab', { name: /HEALTH/ }).click();
  await expect(window(mine, ghoul).getByRole('status', { name: 'Hits waiting' })).toHaveText('1 HIT WAITING · THE GM APPLIES IT', { timeout: 15_000 });
  await expect(window(mine, ghoul).getByRole('button', { name: /^APPLY/ })).toHaveCount(0);
  await window(mine, ghoul).locator('.win95-close-btn', { hasText: '×' }).first().click();

  // The GM: HEALTH's tab says how many; its row what it would take; APPLY 7 takes 7 off.
  await openToken(page, ghoul);
  const theirs = window(page, ghoul);
  await expect(theirs.getByRole('tab', { name: /HEALTH/ })).toHaveText('HEALTH1 WAITING', { timeout: 15_000 });
  await theirs.getByRole('tab', { name: /HEALTH/ }).click();
  const box = theirs.getByRole('group', { name: 'Hits waiting' });
  await expect(box.getByTestId('would-take')).toHaveText('WOULD TAKE 7 OF 10');
  await expect(box.getByRole('group', { name: /^Flame Tongue from / })).toBeVisible();
  await box.getByRole('button', { name: /^APPLY 7: Flame Tongue from / }).click();
  await expect.poll(hp, { timeout: 15_000 }).toBe(13);
  await expect(box).toHaveCount(0, { timeout: 15_000 });
  await expect(theirs.getByRole('tab', { name: /HEALTH/ })).toHaveText('HEALTH');

  // Another: DISMISSED, nothing taken; the tab's count gone with it.
  await hitWithFlameTongue(mine, ghoul);
  await expect(theirs.getByRole('tab', { name: /HEALTH/ })).toHaveText('HEALTH1 WAITING', { timeout: 15_000 });
  await theirs.getByRole('group', { name: 'Hits waiting' }).getByRole('button', { name: /^Dismiss Flame Tongue from / }).click();
  await expect(theirs.getByRole('group', { name: 'Hits waiting' })).toHaveCount(0, { timeout: 15_000 });
  expect(await hp()).toBe(13);
  for (const key of SETTINGS) await asGm(request, gm, 'post', '/api/settings', { key, value: '' });
  await context.close();
});
