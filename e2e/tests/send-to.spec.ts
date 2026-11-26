import { test, expect } from '@playwright/test';
import { signInAsPlayer, signInAsGm, gmToken, runningSystem, approvedPlayer, asGm, sheetTab } from './helpers';

// SEND TO, the GM's (8b7; approved mockup docs/mockups/send-to.html, 2026-11-26). A player rolls a Flame Tongue's
// "4 SLASHING + 6 FIRE DMG" straight from their GEAR, no attack, and the GM sends it from the tray's history to an NPC that
// RESISTS FIRE, HALF (it saved): each part halved first, 2 + 3, then FIRE halved again, 2 + 1 = 3 off its 20 under AUTO. The
// GM's log says all of it; the player's only that it was sent and saved (HIT TOTALS ON NPCS: GM ONLY, on to start). The line
// then says where it went, and the picker won't send it there twice. Players' trays have no SEND TO.

const SETTINGS = ['apply_damage', 'work_out_resistances', 'hit_totals_gm_only'];

test('the GM sends a player\'s Flame Tongue HALF to a fire-resisting NPC: 3 taken, said to each as they may know it (8b7)', async ({ page, browser, request }, info) => {
  test.setTimeout(180_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const gm = await gmToken(request);
  await runningSystem(request, gm, {
    format: 1, name: `Blastfall${again}`, core: { health: { model: 'pool' } },
    stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }] }],
    items: {
      types: [{ id: 'weapons', label: 'WEAPONS', one: 'Weapon', columns: [{ id: 'damage', label: 'DAMAGE', kind: 'damage' }] }],
      list: [{ id: 'tongue', label: 'Flame Tongue', type: 'weapons', values: { damage: '4 SLASHING + 6 FIRE DMG' } }],
    },
    damage: { apply: 'auto' },
  });
  for (const key of SETTINGS) await asGm(request, gm, 'post', '/api/settings', { key, value: '' });
  const player = { username: `e2e_sender${again}`, password: 'e2e-player-password' };
  await approvedPlayer(request, gm, player);
  const imp = `Cinder Imp${again}`;
  const IMP = imp.toUpperCase();
  const sheet = await asGm(request, gm, 'post', '/api/sheets/npcs', { npc_label: imp, data: { name: imp, _resistances: [{ kind: 'resist', type: 'fire' }] } });
  const made = await asGm(request, gm, 'post', '/api/locations', { name: imp, description: 'An NPC', shape: 'friendly_rhombus', x: 0, y: 0, z: 0, width: 1, height: 1, depth: 1, hp_current: 20, hp_max: 20, hp_temp: 0 });
  const id = made.data[0].id;
  await asGm(request, gm, 'post', `/api/sheets/npcs/${sheet.id}/link`, { location_id: id });
  const hp = async () => (await asGm(request, gm, 'get', '/api/locations') as { id: number; hp_current: number }[]).find((l) => l.id === id)?.hp_current;

  // The GM at the table (the city map), hearing the rolls as they come.
  await page.setViewportSize({ width: 1280, height: 900 });
  await signInAsGm(page);
  const context = await browser.newContext({ baseURL: info.project.use.baseURL, viewport: { width: 1280, height: 900 } });
  const mine = await context.newPage();
  await signInAsPlayer(mine, player);
  await mine.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true }).click();
  await mine.getByRole('button', { name: 'CHARACTER_SHEET', exact: true }).click();
  await sheetTab(mine, 'GEAR');
  const weapons = mine.getByRole('region', { name: 'WEAPONS gear' });
  await mine.getByRole('group', { name: 'Add by hand' }).getByRole('button', { name: 'Add a Weapon by hand' }).click();
  await weapons.getByLabel('Item 1 name', { exact: true }).fill('Flame Tongue');
  await expect.poll(async () => JSON.parse(String((await asGm(request, gm, 'get', `/api/sheets/user/${player.username}`)).data.inventory ?? '[]'))[0]?.name, { timeout: 15_000 }).toBe('Flame Tongue');
  await weapons.getByRole('button', { name: 'DONE', exact: true }).click();

  // Rolled straight from the sheet: in the log, reaching nobody. The player's tray has no SEND TO.
  await weapons.getByRole('button', { name: 'Roll Item 1 DAMAGE' }).click();
  await mine.getByTitle('TOGGLE_HISTORY').click();
  const theirs = mine.getByTestId('dice-history').locator('> div').filter({ hasText: new RegExp(`^${player.username}:\\s*rolled Flame Tongue DAMAGE`) });
  await expect(theirs).toHaveCount(1, { timeout: 15_000 });
  await expect(theirs).toContainText('= 4 SLASHING + 6 FIRE DMG (10)');
  await expect(mine.getByRole('button', { name: 'Send Flame Tongue to' })).toHaveCount(0);

  // The GM's tray (the roll may open and shut it by itself meanwhile, so until it stays open), its history showing.
  await page.getByRole('button', { name: 'DICE_ROLLER', exact: true }).click();
  const toggle = page.getByTitle('TOGGLE_HISTORY');
  await expect(async () => {
    if (!(await toggle.isVisible())) await page.getByRole('button', { name: 'DICE_TRAY.exe', exact: true }).click();
    await expect(toggle).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
  if (!(await page.getByTestId('dice-history').isVisible())) await toggle.click();
  const gmLine = page.getByTestId('dice-history').locator('> div').filter({ hasText: new RegExp(`^${player.username}:\\s*rolled Flame Tongue DAMAGE`) }).last();
  const sendTo = gmLine.getByRole('button', { name: 'Send Flame Tongue to' });
  await expect(sendTo).toBeVisible({ timeout: 15_000 });
  await sendTo.click();

  // The picker: the NPC on the GM's map, ticked, HALF, what it would take worked out by the server.
  const picker = gmLine.getByRole('group', { name: 'SEND FLAME TONGUE (10 SLASHING + FIRE) TO' });
  await expect(picker).toBeVisible();
  await picker.getByRole('checkbox', { name: IMP, exact: true }).check();
  const row = picker.getByRole('group', { name: `${IMP} full or half`, exact: true });
  await row.getByRole('button', { name: 'HALF', exact: true }).click();
  await expect(row.getByRole('button', { name: 'HALF', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(picker.getByTestId('send-would').filter({ hasText: 'SAVED: HALF' })).toHaveText('SAVED: HALF · RESISTS FIRE: 3 → 1 · WOULD TAKE 3 OF 10', { timeout: 15_000 });
  await picker.getByRole('button', { name: 'SEND', exact: true }).click();
  await expect(picker).toBeHidden({ timeout: 15_000 });

  // Taken: 3 off its 20. The GM's log says all of it; the line says where it went.
  await expect.poll(hp, { timeout: 15_000 }).toBe(17);
  const sentBy = `SENT BY GM · Flame Tongue (from ${player.username.toUpperCase()}) → ${IMP}`;
  const gmSent = page.getByTestId('dice-history').locator('> div').filter({ hasText: sentBy });
  await expect(gmSent).toContainText(`${sentBy} · SAVED: HALF · RESISTS FIRE: 3 → 1 · HIDDEN FROM PLAYERS · TAKES 3 OF 10`, { timeout: 15_000 });
  await expect(gmSent.getByTestId('roll-total')).toHaveText('TAKES 3 OF 10');
  await expect(gmLine.getByTestId('sent-to')).toContainText(`SENT → ${IMP}`);
  // The player's: that it was sent and saved, no numbers.
  const theirSent = mine.getByTestId('dice-history').locator('> div').filter({ hasText: sentBy });
  await expect(theirSent).toHaveText(`${sentBy} · SAVED`, { timeout: 15_000 });

  // Not twice: opened again, it says SENT and can't be ticked.
  await sendTo.click();
  await expect(picker.getByRole('checkbox', { name: IMP, exact: true })).toBeDisabled({ timeout: 15_000 });
  await picker.getByRole('button', { name: 'CANCEL', exact: true }).click();
  expect(await hp()).toBe(17);
  for (const key of SETTINGS) await asGm(request, gm, 'post', '/api/settings', { key, value: '' });
  await context.close();
});
