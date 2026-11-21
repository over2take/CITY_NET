import { test, expect } from '@playwright/test';
import { signInAsGm, openBuilder, builderPage, gmToken, asGm } from './helpers';

// An item's PRICE and IN SHOPS on the builder's ITEMS page (8a7a3b1; decided 2026-11-21, mockup docs/mockups/types-in-shops.html):
// the Pistol's price in its WEAPONS type's PRICE column, shown once under TYPE and changed there; the Rope, of a type without
// one, given its own; the Ring kept out of the shops, NOT SOLD in the list; a new item IN SHOPS, its price asked for until it
// has one. Made by clicks, saved as made, no problems.

test('PRICE and IN SHOPS: in the type\'s PRICE column or the item\'s own, a ring kept out, a new item priced, saved (8a7a3b1)', async ({ page, request }, info) => {
  const name = `Pricefall ${info.retry + 1}`;
  const token = await gmToken(request);
  const { id } = await asGm(request, token, 'post', '/api/systems', { definition: { format: 1, name, core: { health: { model: 'pool' } },
    stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }] }],
    items: {
      types: [
        { id: 'weapons', label: 'WEAPONS', one: 'Weapon', columns: [{ id: 'damage', label: 'DAMAGE', kind: 'damage' }, { id: 'price', label: 'PRICE', kind: 'number' }] },
        { id: 'armor', label: 'ARMOR', one: 'Armor', columns: [{ id: 'defense', label: 'DEFENSE', kind: 'number' }] },
      ],
      list: [
        { id: 'pistol', label: 'Pistol', type: 'weapons', values: { damage: '2d6', price: 200 } },
        { id: 'rope', label: 'Rope', type: 'armor' },
        { id: 'ring', label: 'Ring of Might', type: 'armor', price: 5000 },
      ],
    } } });
  await signInAsGm(page);
  await openBuilder(page);
  const card = page.getByTestId(/^system-/).filter({ hasText: name.toUpperCase() });
  if (!(await card.getByRole('button', { name: 'OPEN', exact: true }).isVisible())) await card.getByRole('button').first().click();
  await card.getByRole('button', { name: 'OPEN', exact: true }).click();
  await builderPage(page, 'ITEMS');
  await page.getByRole('tablist', { name: 'Items' }).getByRole('tab', { name: 'ITEMS', exact: true }).click();
  const list = page.getByRole('region', { name: 'Items', exact: true });
  const panel = (item: string) => page.getByRole('region', { name: `${item} item` });

  // The Pistol: its PRICE column under TYPE, once, at 200; changed to 180.
  await list.getByRole('button', { name: /^Pistol/ }).click();
  await expect(panel('Pistol').getByRole('spinbutton', { name: 'PRICE' })).toHaveValue('200');
  await expect(panel('Pistol').getByRole('spinbutton', { name: 'PRICE' })).toHaveCount(1);
  await panel('Pistol').getByRole('spinbutton', { name: 'PRICE' }).fill('180');

  // The Rope, NOT SOLD while unpriced, given its own price.
  await expect(list.getByRole('button', { name: /^Rope/ })).toContainText('NOT SOLD');
  await list.getByRole('button', { name: /^Rope/ }).click();
  await panel('Rope').getByRole('spinbutton', { name: 'PRICE' }).fill('3');
  await expect(list.getByRole('button', { name: /^Rope/ })).not.toContainText('NOT SOLD');

  // The Ring kept out of the shops.
  await list.getByRole('button', { name: /^Ring of Might/ }).click();
  await panel('Ring of Might').getByRole('switch', { name: 'Ring of Might in shops' }).click();
  await expect(panel('Ring of Might').getByText('Never sold in any shop; only given, from GIVE.EXE')).toBeVisible();
  await expect(list.getByRole('button', { name: /^Ring of Might/ })).toContainText('NOT SOLD');

  // A new armor: IN SHOPS, its price asked for, then given.
  await list.getByRole('button', { name: 'Add a Armor' }).click();
  await expect(panel('NEW ARMOR').getByText(/A PRICE IS NEEDED: it.s IN SHOPS/)).toBeVisible();
  await panel('NEW ARMOR').getByRole('spinbutton', { name: 'PRICE' }).fill('40');
  await expect(panel('NEW ARMOR').getByText(/A PRICE IS NEEDED/)).toHaveCount(0);

  await expect(page.getByTestId('save-status')).toHaveText(/· SAVED /, { timeout: 15_000 });
  const saved = await asGm(request, token, 'get', `/api/systems/${id}`);
  expect(saved.problems).toEqual([]);
  const items = saved.draft.items.list as Record<string, unknown>[];
  expect(items.find((i) => i.id === 'pistol')).toEqual({ id: 'pistol', label: 'Pistol', type: 'weapons', values: { damage: '2d6', price: 180 } });
  expect(items.find((i) => i.id === 'rope')).toEqual({ id: 'rope', label: 'Rope', type: 'armor', price: 3 });
  expect(items.find((i) => i.id === 'ring')).toEqual({ id: 'ring', label: 'Ring of Might', type: 'armor', price: 5000, in_shops: false });
  expect(items.find((i) => i.label === 'NEW ARMOR')).toMatchObject({ type: 'armor', price: 40, in_shops: true });
});
