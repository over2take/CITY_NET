import { test, expect } from '@playwright/test';
import { signInAsGm, openBuilder, builderPage, gmToken, asGm } from './helpers';

// ITEM TYPES on the builder's ITEMS page (8a2; approved mockup docs/mockups/item-types.html, 2026-11-14): a WEAPONS type
// from its preset beside GEAR, its AMMO refilled by a long rest and reloaded from Pistol Rounds, a GRADE column of its
// own picking LIGHT or HEAVY, and a Pistol of it with each column filled, made by clicks, saved as made, kept.

test('ITEM TYPES: WEAPONS from its preset with AMMO and a GRADE, and a Pistol filling its columns, saved and kept (8a2)', async ({ page, request }, info) => {
  const name = `Gunfall ${info.retry + 1}`;
  const token = await gmToken(request);
  const { id } = await asGm(request, token, 'post', '/api/systems', { definition: { format: 1, name, core: { health: { model: 'pool' } },
    stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }] }],
    items: { list: [{ id: 'rounds', label: 'Pistol Rounds' }] } } });
  const openIt = async () => {
    await signInAsGm(page);
    await openBuilder(page);
    const card = page.getByTestId(/^system-/).filter({ hasText: name.toUpperCase() });
    if (!(await card.getByRole('button', { name: 'OPEN', exact: true }).isVisible())) await card.getByRole('button').first().click();
    await card.getByRole('button', { name: 'OPEN', exact: true }).click();
    await builderPage(page, 'ITEMS');
  };
  await openIt();

  // GEAR to start; WEAPONS from its preset, opened beside it.
  const types = page.getByRole('region', { name: 'Item types' });
  await expect(types.getByText(/^Every system starts with GEAR/)).toBeVisible();
  await types.getByRole('group', { name: 'Add an item type' }).getByRole('button', { name: 'WEAPON', exact: true }).click();
  const weapons = page.getByRole('region', { name: 'WEAPONS type' });
  await expect(types.getByRole('group', { name: 'The item types' }).getByRole('button', { name: 'WEAPONS' })).toHaveAttribute('aria-pressed', 'true');

  // AMMO: refilled by a long rest, reloaded from Pistol Rounds.
  await weapons.getByRole('combobox', { name: 'AMMO refilled by' }).selectOption({ label: 'LONG REST' });
  await weapons.getByRole('combobox', { name: 'AMMO: reload from an item' }).selectOption({ label: 'Pistol Rounds' });
  await expect(weapons.getByRole('group', { name: 'AMMO reloads from' })).toContainText('Pistol Rounds');

  // A GRADE of its own: PICK ONE of LIGHT or HEAVY.
  await weapons.getByRole('button', { name: '+ COLUMN' }).click();
  await weapons.getByRole('textbox', { name: 'NEW COLUMN column name' }).fill('GRADE');
  await weapons.getByRole('combobox', { name: 'GRADE kind' }).selectOption({ label: 'PICK ONE' });
  await expect(weapons.getByRole('status')).toHaveText(/^PICK ONE: one of the words you list/);
  await weapons.getByRole('textbox', { name: 'GRADE words' }).fill('LIGHT, HEAVY');

  // The Pistol, a WEAPON, each column filled, on ITEMS (8aL1).
  const itemsTab = (tab: string) => page.getByRole('tablist', { name: 'Items' }).getByRole('tab', { name: tab, exact: true });
  await itemsTab('ITEMS').click();
  await page.getByRole('button', { name: '+ ITEM' }).click();
  await page.getByRole('region', { name: 'NEW ITEM item' }).getByRole('textbox', { name: 'NAME' }).fill('Pistol');
  const pistol = page.getByRole('region', { name: 'Pistol item' });
  await pistol.getByRole('combobox', { name: 'TYPE' }).selectOption({ label: 'WEAPONS' });
  await pistol.getByRole('textbox', { name: 'Pistol DAMAGE' }).fill('2d6 + @might');
  await pistol.getByRole('textbox', { name: 'RANGE' }).fill('30 m');
  await pistol.getByRole('spinbutton', { name: 'AMMO' }).fill('6');
  await expect(pistol.getByText('IT HOLDS · FIRE SPENDS ONE')).toBeVisible();
  await pistol.getByRole('spinbutton', { name: 'WEIGHT' }).fill('2');
  await pistol.getByRole('combobox', { name: 'GRADE' }).selectOption('LIGHT');

  await expect(page.getByTestId('save-status')).toHaveText(/· SAVED /, { timeout: 15_000 });
  const saved = await asGm(request, token, 'get', `/api/systems/${id}`);
  expect(saved.problems).toEqual([]);
  expect(saved.draft.items).toEqual({
    types: [
      { id: 'gear', label: 'GEAR', one: 'Gear', columns: [{ id: 'weight', label: 'WEIGHT', kind: 'number', unit: 'LB' }, { id: 'price', label: 'PRICE', kind: 'number' }] },
      { id: 'weapons', label: 'WEAPONS', one: 'Weapon', columns: [
        { id: 'damage', label: 'DAMAGE', kind: 'damage' }, { id: 'range', label: 'RANGE', kind: 'text' },
        { id: 'ammo', label: 'AMMO', kind: 'count', button: 'FIRE', refill: 'long_rest', reload: ['rounds'] },
        { id: 'weight', label: 'WEIGHT', kind: 'number', unit: 'LB' }, { id: 'price', label: 'PRICE', kind: 'number' },
        { id: 'new_column', label: 'GRADE', kind: 'pick', options: ['LIGHT', 'HEAVY'] },
      ] },
    ],
    list: [
      { id: 'rounds', label: 'Pistol Rounds' },
      { id: 'new_item', label: 'Pistol', type: 'weapons', values: { damage: '2d6 + @might', range: '30 m', ammo: 6, weight: 2, new_column: 'LIGHT' } },
    ],
  });

  // Kept: a reload finds the Pistol a WEAPON, and WEAPONS beside GEAR.
  await page.reload();
  await openIt();
  await itemsTab('ITEMS').click();
  await expect(page.getByRole('region', { name: 'Pistol item' }).getByRole('button').first()).toContainText('WEAPON');
  await itemsTab('TYPES').click();
  await expect(page.getByRole('region', { name: 'Item types' }).getByRole('group', { name: 'The item types' }).getByRole('button')).toHaveText([/^GEAR\s*DEFAULT\s*1$/, /^WEAPONS\s*1$/]);
});
