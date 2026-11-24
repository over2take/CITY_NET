import { test, expect } from '@playwright/test';
import { signInAsGm, openBuilder, builderPage, gmToken, asGm } from './helpers';

// An item's DAMAGE as rows on the builder's ITEMS page (8b2b; approved 2026-11-23, "that's perfect"). A WEAPONS type from its
// preset, its DAMAGE column's MOST LINES ARE set to SLASHING; a Flame Tongue made from + WEAPON starting SLASHING, its 1d8
// typed, + PART made FIRE with 2d6, each part with its own eˣ; saved as the text the server reads, with no problems.

test('DAMAGE as rows: MOST LINES ARE SLASHING, a Flame Tongue of 1d8 SLASHING + 2d6 FIRE made by clicks, saved as text (8b2b)', async ({ page, request }, info) => {
  test.setTimeout(120_000);
  const name = `Flamefall ${info.retry + 1}`;
  const token = await gmToken(request);
  const { id } = await asGm(request, token, 'post', '/api/systems', { definition: { format: 1, name, core: { health: { model: 'pool' } },
    stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }] }] } });
  await page.setViewportSize({ width: 1280, height: 800 });
  await signInAsGm(page);
  await openBuilder(page);
  const card = page.getByTestId(/^system-/).filter({ hasText: name.toUpperCase() });
  if (!(await card.getByRole('button', { name: 'OPEN', exact: true }).isVisible())) await card.getByRole('button').first().click();
  await card.getByRole('button', { name: 'OPEN', exact: true }).click();
  await builderPage(page, 'ITEMS');

  // WEAPONS from its preset; its DAMAGE column's MOST LINES ARE: SLASHING.
  const types = page.getByRole('region', { name: 'Item types' });
  await types.getByRole('group', { name: 'Add an item type' }).getByRole('button', { name: 'WEAPON', exact: true }).click();
  const weapons = page.getByRole('region', { name: 'WEAPONS type' });
  await weapons.getByRole('combobox', { name: 'DAMAGE most lines are' }).selectOption({ label: 'SLASHING' });

  // A Flame Tongue: its DAMAGE starts SLASHING; 1d8, then + PART, FIRE, 2d6.
  await page.getByRole('tablist', { name: 'Items' }).getByRole('tab', { name: 'ITEMS', exact: true }).click();
  await page.getByRole('region', { name: 'Items', exact: true }).getByRole('group', { name: 'WEAPONS items' }).getByRole('button', { name: 'Add a Weapon' }).click();
  await page.keyboard.type('Flame Tongue');
  // In the shops, as a new item is, so priced.
  await page.getByRole('region', { name: 'Flame Tongue item' }).getByRole('spinbutton', { name: 'PRICE' }).fill('500');
  const parts = page.getByRole('region', { name: 'Flame Tongue item' }).getByRole('group', { name: 'Flame Tongue DAMAGE parts' });
  await expect(parts.getByRole('combobox', { name: 'Flame Tongue DAMAGE type' })).toHaveValue('slashing');
  await parts.getByRole('textbox', { name: 'Flame Tongue DAMAGE', exact: true }).fill('1d8');
  await parts.getByRole('button', { name: 'Add a part to Flame Tongue DAMAGE' }).click();
  await parts.getByRole('combobox', { name: 'Flame Tongue DAMAGE part 2 type' }).selectOption({ label: 'FIRE' });
  await parts.getByRole('textbox', { name: 'Flame Tongue DAMAGE part 2' }).fill('2d6');
  // Each part its own eˣ.
  await parts.getByRole('button', { name: 'Help writing Flame Tongue DAMAGE part 2' }).click();
  await expect(parts.getByRole('group', { name: 'Help writing Flame Tongue DAMAGE part 2' })).toBeVisible();

  await expect(page.getByTestId('save-status')).toHaveText(/· SAVED /, { timeout: 15_000 });
  const saved = await asGm(request, token, 'get', `/api/systems/${id}`);
  expect(saved.problems).toEqual([]);
  expect(saved.draft.items.types.find((t: { id: string }) => t.id === 'weapons').columns.find((c: { id: string }) => c.id === 'damage').usual).toBe('slashing');
  expect(saved.draft.items.list.find((i: { label: string }) => i.label === 'Flame Tongue').values.damage).toBe('1d8 SLASHING + 2d6 FIRE DMG');
});
