import { test, expect } from '@playwright/test';
import { signInAsPlayer, signInAsGm, gmToken, approvedPlayer, asGm, openGameSystem } from './helpers';

// APPLY DAMAGE on a built-in game's GAME tab (8b5d; the mockup's answer 8, and the user's 2026-11-25: OFF leaves everything
// on the target, its line ending as a custom system's). Under Cyberpunk RED the GM finds it on HOUSE RULES as AUTO (SYSTEM'S)
// or OFF, picks OFF, and a player FIREs a Unity from the sheet attack at an NPC: the log says what gets through and WOULD
// TAKE it, drawn larger, and the NPC keeps its hit points.

const KEY = 'apply_damage_built_in';

test('a built-in game\'s APPLY DAMAGE: OFF picked on the GAME tab, a sheet attack\'s hit said and WOULD TAKE, nothing taken (8b5d)', async ({ page, browser, request }, info) => {
  test.setTimeout(180_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const gm = await gmToken(request);
  await asGm(request, gm, 'put', '/api/sheets/system', { system: 'cyberpunk_red' });
  await asGm(request, gm, 'post', '/api/settings', { key: KEY, value: '' });
  const player = { username: `e2e_applyoff${again}`, password: 'e2e-player-password' };
  await approvedPlayer(request, gm, player);
  const ganger = `Ganger${again}`;
  const token = { name: ganger, description: 'An NPC', shape: 'friendly_rhombus', x: 0, y: 0, z: 0, width: 1, height: 1, depth: 1 };
  const made = await asGm(request, gm, 'post', '/api/locations', { ...token, hp_current: 40, hp_max: 40, hp_temp: 0 });
  const id = made.data[0].id;
  // DV 0, as the GM's editor sets it (a new token takes none), so any to-hit HITs.
  await asGm(request, gm, 'put', `/api/locations/${id}`, { ...token, melee_ac: 0, ranged_ac: 0 });
  const hp = async () => (await asGm(request, gm, 'get', '/api/locations') as { id: number; hp_current: number }[]).find((l) => l.id === id)?.hp_current;

  // The GM's GAME tab: APPLY DAMAGE, AUTO as the game always was, then OFF.
  await page.setViewportSize({ width: 1280, height: 900 });
  await signInAsGm(page);
  await openGameSystem(page);
  await page.getByRole('button', { name: /^HOUSE RULES/ }).click();
  const applyBox = page.getByRole('combobox', { name: 'APPLY DAMAGE' });
  await expect(applyBox).toHaveValue('');
  await expect(applyBox.locator('option')).toHaveText(['AUTO (SYSTEM\'S)', 'OFF']);
  await applyBox.selectOption('off');
  await page.getByRole('button', { name: 'APPLY', exact: true }).click();
  await expect(page.getByText('HOUSE RULES APPLIED')).toBeVisible({ timeout: 15_000 });
  const setting = async () => (await asGm(request, gm, 'get', '/api/settings') as { key: string; value: string }[]).find((r) => r.key === KEY)?.value;
  await expect.poll(setting, { timeout: 15_000 }).toBe('off');

  // The player, with a Unity on their sheet (set by the GM once the sheet is there).
  const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width: 1280, height: 900 } });
  const mine = await context.newPage();
  await signInAsPlayer(mine, player);
  await mine.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true }).click();
  await mine.getByRole('button', { name: 'CHARACTER_SHEET', exact: true }).click();
  await expect.poll(async () => (await asGm(request, gm, 'get', `/api/sheets/user/${player.username}`).catch(() => null))?.id, { timeout: 15_000 }).toBeTruthy();
  await asGm(request, gm, 'put', `/api/sheets/user/${player.username}`, { fields: { ref: 8, handgun: 6, weapon1_name: 'Unity', weapon1_dmg: '2d6', weapon1_skill: 'handgun' } });
  await mine.keyboard.press('Escape');

  // ATTACK on the Ganger's window (a sheet-combat game's one button), then FIRE from the attack panel.
  await mine.getByRole('button', { name: 'QUICK_ACCESS', exact: true }).click();
  const list = mine.locator('.quick-access-panel');
  if (!(await list.getByText(ganger, { exact: true }).isVisible())) await list.getByText(/DEFINED_STRUCTURES/).click();
  await list.getByText(ganger, { exact: true }).click();
  await mine.getByRole('button', { name: /ATTACK/ }).first().click();
  // ATTACK opens the DICE_ROLLER itself, its weapon picked from the sheet.
  await expect(mine.getByRole('combobox', { name: 'Weapon' })).toContainText('UNITY · 2d6', { timeout: 15_000 });
  await mine.getByRole('button', { name: 'FIRE', exact: true }).click();

  // The player's log: the damage, what gets through, and WOULD TAKE it, the one bold and larger.
  const toggle = mine.getByTitle('TOGGLE_HISTORY');
  await expect(toggle).toBeVisible({ timeout: 15_000 });
  if (!(await mine.getByTestId('dice-history').isVisible())) await toggle.click();
  const line = mine.getByTestId('dice-history').locator('> div').filter({ hasText: /Unity damage vs/ }).last();
  await expect(line).toContainText(/ · NOT APPLIED: APPLY DAMAGE IS OFF · WOULD TAKE \d+$/, { timeout: 15_000 });
  await expect(line.getByTestId('roll-total')).toHaveText(/^WOULD TAKE \d+$/);
  await expect(line.getByTestId('roll-total')).toHaveCSS('font-weight', '800');
  // Nothing taken.
  expect(await hp()).toBe(40);
  await mine.screenshot({ path: test.info().outputPath('apply-off.png') });

  await asGm(request, gm, 'post', '/api/settings', { key: KEY, value: '' });
  await context.close();
});
