import { test, expect, type Page } from '@playwright/test';
import { signInAsPlayer, signInAsGm, gmToken, runningSystem, approvedPlayer, asGm, sheetTab } from './helpers';

// A hit reaching its target (8b5c; approved mockup docs/mockups/damage-pipeline.html, section 5). A player attacks an NPC
// that RESISTS FIRE with MELEE from its window, rolls a d20 to hit (its AC 0, so a HIT), then rolls a Flame Tongue's
// "4 SLASHING + 6 FIRE DMG" from their GEAR: with APPLY DAMAGE AUTO it takes 4 + 3 off the NPC, and the player's log says
// only that it reached it (HIT TOTALS ON NPCS: GM ONLY, on to start), while the GM's says all of it. The d20 says HIT
// after its target, the GM's also what it was against (VS AC 0). With the table's
// APPLY DAMAGE OFF, the next hit is only said. A friendly NPC, as QUICK_ACCESS lists those.

const SETTINGS = ['apply_damage', 'work_out_resistances', 'hit_totals_gm_only'];

/** MELEE on a token's window, from QUICK_ACCESS, then a d20 from the DICE_ROLLER: a HIT on AC 0. */
const hitWithMelee = async (page: Page, name: string) => {
  await page.getByRole('button', { name: 'QUICK_ACCESS', exact: true }).click();
  const list = page.locator('.quick-access-panel');
  if (!(await list.getByText(name, { exact: true }).isVisible())) await list.getByText(/DEFINED_STRUCTURES/).click();
  await list.getByText(name, { exact: true }).click();
  await page.getByRole('button', { name: /MELEE/ }).first().click();
  await expect(page.getByText(/AWAITING_ROLL/).first()).toBeVisible({ timeout: 15_000 });
  // MELEE opens the DICE_ROLLER itself; opened here only where it didn't.
  const d20 = page.getByRole('button', { name: 'One more d20', exact: true });
  if (!(await d20.isVisible())) await page.getByRole('button', { name: 'DICE_ROLLER', exact: true }).click();
  await d20.click();
  await page.getByRole('button', { name: /ROLL DICE/ }).click();
  await expect(page.getByText(/AWAITING_ROLL/)).toHaveCount(0, { timeout: 15_000 });
  // Out of the sheet's way: the tray with Escape, the token's window with its own ×, the DICE_ROLLER closed.
  // The d20 back from the server opens the tray: the HIT is kept by then, waiting for its damage.
  const tray = page.getByText('DICE_TRAY.EXE', { exact: true });
  await expect(tray).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press('Escape');
  await expect(tray).toBeHidden();
  await page.locator('.win95-window').filter({ hasText: `ID.EXE · ${name}` }).locator('.win95-close-btn', { hasText: '×' }).first().click();
  await page.getByRole('button', { name: 'DICE_ROLLER', exact: true }).click();
  await expect(page.getByRole('button', { name: 'One more d20', exact: true })).toBeHidden();
};

test('a HIT\'s Flame Tongue reaches the NPC: FIRE halved and taken off under AUTO, players told only that it hit; OFF only said (8b5c)', async ({ page, browser, request }, info) => {
  test.setTimeout(180_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const gm = await gmToken(request);
  await runningSystem(request, gm, {
    format: 1, name: `Strikefall${again}`, core: { health: { model: 'pool' } },
    stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }] }],
    items: {
      types: [{ id: 'weapons', label: 'WEAPONS', one: 'Weapon', columns: [{ id: 'damage', label: 'DAMAGE', kind: 'damage' }] }],
      list: [{ id: 'tongue', label: 'Flame Tongue', type: 'weapons', values: { damage: '4 SLASHING + 6 FIRE DMG' } }],
    },
    damage: { apply: 'auto' },
  });
  for (const key of SETTINGS) await asGm(request, gm, 'post', '/api/settings', { key, value: '' });
  const player = { username: `e2e_hits${again}`, password: 'e2e-player-password' };
  await approvedPlayer(request, gm, player);
  const ghoul = `Bog Ghoul${again}`;
  const sheet = await asGm(request, gm, 'post', '/api/sheets/npcs', { npc_label: ghoul, data: { name: ghoul, _resistances: [{ kind: 'resist', type: 'fire' }] } });
  const token = { name: ghoul, description: 'An NPC', shape: 'friendly_rhombus', x: 0, y: 0, z: 0, width: 1, height: 1, depth: 1 };
  const made = await asGm(request, gm, 'post', '/api/locations', { ...token, hp_current: 20, hp_max: 20, hp_temp: 0 });
  const id = made.data[0].id;
  // AC 0, set as the GM's editor sets it (a new token takes none), so any d20 HITs.
  await asGm(request, gm, 'put', `/api/locations/${id}`, { ...token, melee_ac: 0, ranged_ac: 0 });
  await asGm(request, gm, 'post', `/api/sheets/npcs/${sheet.id}/link`, { location_id: id });
  const hp = async () => (await asGm(request, gm, 'get', '/api/locations') as { id: number; hp_current: number }[]).find((l) => l.id === id)?.hp_current;

  // The GM at the table, hearing the rolls as they come.
  await page.setViewportSize({ width: 1280, height: 900 });
  await signInAsGm(page);
  const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width: 1280, height: 900 } });
  const mine = await context.newPage();
  await signInAsPlayer(mine, player);
  // A Flame Tongue on their GEAR, its item's DAMAGE.
  await mine.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true }).click();
  await mine.getByRole('button', { name: 'CHARACTER_SHEET', exact: true }).click();
  await sheetTab(mine, 'GEAR');
  const weapons = mine.getByRole('region', { name: 'WEAPONS gear' });
  await mine.getByRole('group', { name: 'Add by hand' }).getByRole('button', { name: 'Add a Weapon by hand' }).click();
  await weapons.getByLabel('Item 1 name', { exact: true }).fill('Flame Tongue');
  await expect(weapons.getByLabel('Item 1 DAMAGE', { exact: true })).toHaveAttribute('placeholder', '4 SLASHING + 6 FIRE DMG');
  await expect.poll(async () => JSON.parse(String((await asGm(request, gm, 'get', `/api/sheets/user/${player.username}`)).data.inventory ?? '[]'))[0]?.name, { timeout: 15_000 }).toBe('Flame Tongue');
  await weapons.getByRole('button', { name: 'DONE', exact: true }).click();

  // AUTO: the hit, then its DAMAGE: 4 + 3 off the NPC; the player's log says it reached it, no more.
  await hitWithMelee(mine, ghoul);
  await weapons.getByRole('button', { name: 'Roll Item 1 DAMAGE' }).click();
  await mine.getByTitle('TOGGLE_HISTORY').click();
  const history = mine.getByTestId('dice-history').locator('> div');
  const line = history.filter({ hasText: /rolled Flame Tongue DAMAGE/ }).last();
  await expect(line).toContainText(`= 4 SLASHING + 6 FIRE DMG (10) → ${ghoul.toUpperCase()}`, { timeout: 15_000 });
  await expect.poll(hp, { timeout: 15_000 }).toBe(13);
  await expect(line).not.toContainText('TAKES');
  await expect(line).not.toContainText('RESISTS');
  // Its to-hit before it: the target and HIT, never what it was against.
  const check = history.filter({ hasText: /rolled 1d20/ }).last();
  await expect(check).toContainText(`→ ${ghoul.toUpperCase()} · HIT`);
  await expect(check).not.toContainText('AC');
  // The GM's: what it took, and why, and that players weren't told.
  // Their tray, from the DICE_ROLLER (the rolls may open and shut it by themselves meanwhile, so until it stays open).
  await page.getByRole('button', { name: 'DICE_ROLLER', exact: true }).click();
  const toggle = page.getByTitle('TOGGLE_HISTORY');
  await expect(async () => {
    if (!(await toggle.isVisible())) await page.getByRole('button', { name: 'DICE_TRAY.exe', exact: true }).click();
    await expect(toggle).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
  // Opened on a roll's flash, it shows the history already.
  if (!(await page.getByTestId('dice-history').isVisible())) await toggle.click();
  const gmLine = page.getByTestId('dice-history').locator('> div').filter({ hasText: /rolled Flame Tongue DAMAGE/ }).last();
  await expect(gmLine)
    .toContainText(`→ ${ghoul.toUpperCase()} · RESISTS FIRE: 6 → 3 · HIDDEN FROM PLAYERS · TAKES 7 OF 10`, { timeout: 15_000 });
  // What it took, last, the one bold and larger.
  await expect(gmLine.getByTestId('roll-total')).toHaveText('TAKES 7 OF 10');
  await expect(gmLine.getByTestId('roll-total')).toHaveCSS('font-weight', '800');
  // The GM's to-hit: against AC 0, HIT, bold.
  const gmCheck = page.getByTestId('dice-history').locator('> div').filter({ hasText: /rolled 1d20/ }).last();
  await expect(gmCheck).toContainText(`→ ${ghoul.toUpperCase()} · VS AC 0 · HIT`);
  await expect(gmCheck.getByTestId('roll-total')).toHaveText('HIT');
  // Once, its dice long landed: opened by the click, the tray asks for its history as the roll is made, and never
  // records it a second time as it lands.
  await expect(mine.getByTestId('dice-board')).not.toHaveAttribute('aria-label', /Rolling/);
  // This player's own: the history is everyone's, and another journey on this database may roll a Flame Tongue too.
  await expect(history.filter({ hasText: new RegExp(`^${player.username}:\\s*rolled Flame Tongue DAMAGE`) })).toHaveCount(1);
  await mine.keyboard.press('Escape');

  // The table's APPLY DAMAGE OFF: the next hit only said.
  await asGm(request, gm, 'post', '/api/settings', { key: 'apply_damage', value: 'off' });
  await hitWithMelee(mine, ghoul);
  await weapons.getByRole('button', { name: 'Roll Item 1 DAMAGE' }).click();
  await mine.getByTitle('TOGGLE_HISTORY').click();
  await expect(history.filter({ hasText: /NOT APPLIED: APPLY DAMAGE IS OFF/ }).last()).toContainText(`→ ${ghoul.toUpperCase()} · NOT APPLIED`, { timeout: 15_000 });
  expect(await hp()).toBe(13);
  for (const key of SETTINGS) await asGm(request, gm, 'post', '/api/settings', { key, value: '' });
  await context.close();
});
