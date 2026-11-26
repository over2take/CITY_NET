import { test, expect, type Page } from '@playwright/test';
import { signInAsGm, gmToken, runningSystem, asGm, sheetTab } from './helpers';

// ATTACK AS on a game made in the builder (8b6a; approved mockup docs/mockups/waiting-hits.html, sections 1 and 2). The GM
// runs an Ogre and a Goblin: MELEE on the Scarecrow, ATTACK AS OGRE, a d20 (AC 0, so a HIT); MELEE on the Dummy, ATTACK AS
// GOBLIN, a HIT. Both hits wait. The Ogre's Greataxe DAMAGE, rolled from its own sheet, reaches the Scarecrow and the
// Goblin's Shortbow the Dummy (before, the Goblin's attack let the Ogre's hit go, and the Ogre's damage reached the Dummy).
// The log names who swung: "Ogre (…) rolled 1d20". Friendly NPCs, as QUICK_ACCESS lists those.

const carrying = (name: string) => JSON.stringify([{ name, qty: 1, enc: '', bundled: false, carry: 'readied', location: '' }]);

const openToken = async (page: Page, name: string) => {
  await page.getByRole('button', { name: 'QUICK_ACCESS', exact: true }).click();
  const list = page.locator('.quick-access-panel');
  if (!(await list.getByText(name, { exact: true }).isVisible())) await list.getByText(/DEFINED_STRUCTURES/).click();
  await list.getByText(name, { exact: true }).click();
};
const closeToken = async (page: Page, name: string) => {
  await page.locator('.win95-window').filter({ hasText: `ID.EXE · ${name}` }).locator('.win95-close-btn', { hasText: '×' }).first().click();
};

/** MELEE on `target`'s window, ATTACK AS `as` in the DICE_ROLLER's attack box, then a d20: a HIT on AC 0. */
const hitAs = async (page: Page, target: string, as: string, offered: string[]) => {
  await openToken(page, target);
  await page.getByRole('button', { name: /MELEE/ }).first().click();
  await expect(page.getByText(/AWAITING_ROLL/).first()).toBeVisible({ timeout: 15_000 });
  const d20 = page.getByRole('button', { name: 'One more d20', exact: true });
  if (!(await d20.isVisible())) await page.getByRole('button', { name: 'DICE_ROLLER', exact: true }).click();
  const picker = page.getByLabel('Attack as', { exact: true });
  // YOU first, then the NPCs with a sheet in the target's scene; never the target, nor one with no sheet.
  await expect(picker.locator('option')).toHaveText(['YOU', ...offered]);
  await picker.selectOption({ label: as });
  await d20.click();
  await page.getByRole('button', { name: /ROLL DICE/ }).click();
  await expect(page.getByText(/AWAITING_ROLL/)).toHaveCount(0, { timeout: 15_000 });
  const tray = page.getByText('DICE_TRAY.EXE', { exact: true });
  await expect(tray).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press('Escape');
  await expect(tray).toBeHidden();
  await closeToken(page, target);
  await page.getByRole('button', { name: 'DICE_ROLLER', exact: true }).click();
  await expect(d20).toBeHidden();
};

/** From `npc`'s own sheet, its first line of gear's DAMAGE. */
const damageFrom = async (page: Page, npc: string) => {
  await openToken(page, npc);
  await page.getByRole('button', { name: 'OPEN_SHEET', exact: true }).click();
  await sheetTab(page, 'GEAR');
  const sheet = page.locator('.win95-window').filter({ has: page.getByRole('region', { name: 'WEAPONS gear' }) });
  await page.getByRole('region', { name: 'WEAPONS gear' }).getByRole('button', { name: 'Roll Item 1 DAMAGE' }).click();
  const tray = page.getByText('DICE_TRAY.EXE', { exact: true });
  await expect(tray).toBeVisible({ timeout: 15_000 });
  await page.keyboard.press('Escape');
  await expect(tray).toBeHidden();
  await sheet.first().locator('.win95-close-btn', { hasText: '×' }).first().click();
  await closeToken(page, npc);
};

test('the GM\'s Ogre and Goblin each hit their own target: ATTACK AS on a builder game\'s attack box, each NPC\'s damage reaching its own (8b6a)', async ({ page, request }, info) => {
  test.setTimeout(180_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const gm = await gmToken(request);
  await runningSystem(request, gm, {
    format: 1, name: `Twinstrike${again}`, core: { health: { model: 'pool' } },
    stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }] }],
    items: {
      types: [{ id: 'weapons', label: 'WEAPONS', one: 'Weapon', columns: [{ id: 'damage', label: 'DAMAGE', kind: 'damage' }] }],
      list: [{ id: 'axe', label: 'Greataxe', type: 'weapons', values: { damage: '5' } }, { id: 'bow', label: 'Shortbow', type: 'weapons', values: { damage: '3' } }],
    },
    damage: { apply: 'auto' },
  });
  await asGm(request, gm, 'post', '/api/settings', { key: 'apply_damage', value: '' });
  const named = (n: string) => `${n} Twin${again}`;
  const token = async (name: string, sheetData?: object) => {
    const shape = { name, description: 'An NPC', shape: 'friendly_rhombus', x: 0, y: 0, z: 0, width: 1, height: 1, depth: 1 };
    const id = (await asGm(request, gm, 'post', '/api/locations', { ...shape, hp_current: 20, hp_max: 20, hp_temp: 0 })).data[0].id as number;
    await asGm(request, gm, 'put', `/api/locations/${id}`, { ...shape, melee_ac: 0, ranged_ac: 0 });
    if (sheetData) {
      const sheet = await asGm(request, gm, 'post', '/api/sheets/npcs', { npc_label: name, data: { name, ...sheetData } });
      await asGm(request, gm, 'post', `/api/sheets/npcs/${sheet.id}/link`, { location_id: id });
    }
    return id;
  };
  const ogre = named('Ogre');
  const goblin = named('Goblin');
  const scarecrow = named('Scarecrow');
  const dummy = named('Dummy');
  await token(ogre, { inventory: carrying('Greataxe') });
  await token(goblin, { inventory: carrying('Shortbow') });
  const scarecrowId = await token(scarecrow);
  const dummyId = await token(dummy);
  const hp = async (id: number) => (await asGm(request, gm, 'get', '/api/locations') as { id: number; hp_current: number }[]).find((l) => l.id === id)?.hp_current;

  await page.setViewportSize({ width: 1280, height: 900 });
  await signInAsGm(page);
  const upper = (n: string) => n.toUpperCase();
  await hitAs(page, scarecrow, upper(ogre), [upper(ogre), upper(goblin)]);
  await hitAs(page, dummy, upper(goblin), [upper(ogre), upper(goblin)]);

  // Each NPC's damage from its own sheet: the Ogre's to the Scarecrow, the Goblin's to the Dummy.
  await damageFrom(page, ogre);
  await expect.poll(() => hp(scarecrowId), { timeout: 15_000 }).toBe(15);
  expect(await hp(dummyId)).toBe(20);
  await damageFrom(page, goblin);
  await expect.poll(() => hp(dummyId), { timeout: 15_000 }).toBe(17);
  expect(await hp(scarecrowId)).toBe(15);

  // The log names who swung, and where each blow went.
  const trayButton = page.getByRole('button', { name: 'DICE_TRAY.exe', exact: true });
  if (!(await trayButton.isVisible())) await page.getByRole('button', { name: 'DICE_ROLLER', exact: true }).click();
  const toggle = page.getByTitle('TOGGLE_HISTORY');
  await expect(async () => {
    if (!(await toggle.isVisible())) await trayButton.click();
    await expect(toggle).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
  if (!(await page.getByTestId('dice-history').isVisible())) await toggle.click();
  const history = page.getByTestId('dice-history').locator('> div');
  await expect(history.filter({ hasText: `→ ${upper(scarecrow)} · VS AC 0 · HIT` }).last()).toContainText(`${ogre} (`);
  await expect(history.filter({ hasText: `→ ${upper(dummy)} · VS AC 0 · HIT` }).last()).toContainText(`${goblin} (`);
  await expect(history.filter({ hasText: /rolled Greataxe DAMAGE/ }).last()).toContainText(`→ ${upper(scarecrow)}`);
  await expect(history.filter({ hasText: /rolled Shortbow DAMAGE/ }).last()).toContainText(`→ ${upper(dummy)}`);
});
