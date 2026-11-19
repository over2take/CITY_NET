import { test, expect } from '@playwright/test';
import { signInAsGm, openBuilder, builderPage, gmToken, asGm } from './helpers';

// ENCUMBRANCE on the builder's ITEMS page (8a5c; approved mockup docs/mockups/item-types.html, 2026-11-14, decision 7):
// counted by GEAR's WEIGHT, CAN CARRY five times Might, the first band renamed and moved, a third band added and the word
// past them changed (each the GM's, the user, 2026-11-18), and the CYBERWARE install still weighing while installed. Made
// by clicks, saved as made, there after a reload.

test('ENCUMBRANCE: counted by WEIGHT, CAN CARRY, bands named and placed, an install that still weighs, saved and kept (8a5c)', async ({ page, request }, info) => {
  const name = `Packfall ${info.retry + 1}`;
  const token = await gmToken(request);
  const { id } = await asGm(request, token, 'post', '/api/systems', { definition: { format: 1, name, core: { health: { model: 'pool' } },
    stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }] }],
    items: { installs: [{ id: 'cyberware', label: 'CYBERWARE', against: 'might', limit: '@might' }] } } });
  const openIt = async () => {
    await signInAsGm(page);
    await openBuilder(page);
    const card = page.getByTestId(/^system-/).filter({ hasText: name.toUpperCase() });
    if (!(await card.getByRole('button', { name: 'OPEN', exact: true }).isVisible())) await card.getByRole('button').first().click();
    await card.getByRole('button', { name: 'OPEN', exact: true }).click();
    await builderPage(page, 'ITEMS');
  };
  const itemsTab = (tab: string) => page.getByRole('tablist', { name: 'Items' }).getByRole('tab', { name: tab, exact: true });
  await openIt();

  // Not counted to start; COUNT ENCUMBRANCE starts on GEAR's WEIGHT.
  await itemsTab('ENCUMBRANCE').click();
  const panel = page.getByRole('region', { name: 'Encumbrance' });
  await expect(panel.getByText(/^Not counted: nothing is weighed/)).toBeVisible();
  await panel.getByRole('button', { name: 'COUNT ENCUMBRANCE' }).click();
  await expect(panel.getByRole('group', { name: 'Counted by' }).getByRole('button', { name: 'WEIGHT' })).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.getByText('GEAR counts WEIGHT, one of each times how many.')).toBeVisible();

  // CAN CARRY five times Might; the bands as this game has them.
  await panel.getByRole('textbox', { name: 'Can carry' }).fill('@might * 5');
  await panel.getByRole('textbox', { name: 'Band 1 word' }).fill('UNBURDENED');
  await panel.getByRole('spinbutton', { name: 'Band 1 up to' }).fill('40');
  await panel.getByRole('button', { name: '+ BAND' }).click();
  await panel.getByRole('textbox', { name: 'Band 3 word' }).fill('HEAVY');
  await panel.getByRole('textbox', { name: 'Past the last band' }).fill('CRUSHED');
  await expect(panel.getByRole('spinbutton', { name: 'Band 3 up to' })).toHaveValue('200');

  // CYBERWARE still weighs while installed.
  await itemsTab('SLOTS & INSTALLS').click();
  await page.getByRole('group', { name: 'CYBERWARE: while installed' }).getByRole('button', { name: 'STILL WEIGHS' }).click();

  await expect(page.getByTestId('save-status')).toHaveText(/· SAVED /, { timeout: 15_000 });
  const saved = await asGm(request, token, 'get', `/api/systems/${id}`);
  expect(saved.problems).toEqual([]);
  expect(saved.draft.items.encumbrance).toEqual({
    column: 'weight', unit: 'LB', capacity: '@might * 5',
    bands: [{ word: 'UNBURDENED', upto: 40 }, { word: 'ENCUMBERED', upto: 100 }, { word: 'HEAVY', upto: 200 }], past: 'CRUSHED',
  });
  expect(saved.draft.items.installs).toEqual([{ id: 'cyberware', label: 'CYBERWARE', against: 'might', limit: '@might', weighs: true }]);

  // Kept: a reload finds the bands as they were made.
  await page.reload();
  await openIt();
  await itemsTab('ENCUMBRANCE').click();
  await expect(page.getByRole('region', { name: 'Encumbrance' }).getByRole('textbox', { name: 'Band 1 word' })).toHaveValue('UNBURDENED');
  await expect(page.getByRole('region', { name: 'Encumbrance' }).getByRole('textbox', { name: 'Can carry' })).toHaveValue('@might * 5');
});
