import { test, expect } from '@playwright/test';
import { signInAsGm, openBuilder, builderPage, gmToken, asGm } from './helpers';

// A RESISTANCE row in the builder (8b3b; approved mockup docs/mockups/damage-pipeline.html, answered 2026-11-23): the Dwarf's
// Dwarven Resilience RESIST POISON on CHOICES, a Ring of Warmth's Warm RESIST COLD on ITEMS, POISONED made VULNERABLE TO FIRE
// on CONDITIONS, each by clicks; saved as rows the server takes with no problems.

test('RESISTANCES: a feature on CHOICES, an item\'s feature on ITEMS and a condition, each made by clicks and saved (8b3b)', async ({ page, request }, info) => {
  test.setTimeout(120_000);
  const name = `Stonehold ${info.retry + 1}`;
  const token = await gmToken(request);
  const { id } = await asGm(request, token, 'post', '/api/systems', { definition: { format: 1, name, core: { health: { model: 'pool' } },
    stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'grit', label: 'Grit' }] }],
    choices: [{ id: 'kin', one: 'Kin', many: 'Kin', options: [{ id: 'dwarf', label: 'Dwarf', features: [{ id: 'resilience', label: 'Dwarven Resilience' }] }] }] } });
  await page.setViewportSize({ width: 1280, height: 800 });
  await signInAsGm(page);
  await openBuilder(page);
  const card = page.getByTestId(/^system-/).filter({ hasText: name.toUpperCase() });
  if (!(await card.getByRole('button', { name: 'OPEN', exact: true }).isVisible())) await card.getByRole('button').first().click();
  await card.getByRole('button', { name: 'OPEN', exact: true }).click();

  // CHOICES: Dwarven Resilience, RESIST POISON.
  await builderPage(page, 'CHOICES');
  const dwarf = page.getByRole('region', { name: 'Dwarf option' });
  await dwarf.getByRole('button', { name: /DWARVEN RESILIENCE/ }).click();
  const resilience = dwarf.getByRole('group', { name: 'Feature Dwarven Resilience' }).getByRole('group', { name: 'Resistances' });
  await resilience.getByRole('button', { name: '+ RESISTANCE' }).click();
  await resilience.getByRole('combobox', { name: 'Resistance 1: type' }).selectOption({ label: 'POISON' });
  await expect(resilience.getByText('while it is held')).toBeVisible();
  await expect(dwarf.getByRole('button', { name: /DWARVEN RESILIENCE/ })).toContainText('RESISTANCE');

  // ITEMS: a Ring of Warmth whose Warm resists cold.
  await builderPage(page, 'ITEMS');
  await page.getByRole('tablist', { name: 'Items' }).getByRole('tab', { name: 'ITEMS', exact: true }).click();
  await page.getByRole('button', { name: 'Add a Gear' }).click();
  await page.getByRole('region', { name: 'NEW GEAR item' }).getByRole('textbox', { name: 'NAME' }).fill('Ring of Warmth');
  const ring = page.getByRole('region', { name: 'Ring of Warmth item' });
  await ring.getByRole('button', { name: '+ FEATURE' }).click();
  await ring.getByRole('group', { name: 'Feature NEW FEATURE' }).getByRole('textbox', { name: 'NAME' }).fill('Warm');
  const warm = ring.getByRole('group', { name: 'Feature Warm' }).getByRole('group', { name: 'Resistances' });
  await warm.getByRole('button', { name: '+ RESISTANCE' }).click();
  await warm.getByRole('combobox', { name: 'Resistance 1: type' }).selectOption({ label: 'COLD' });
  await expect(warm.getByText('while the item counts: worn, attuned or installed')).toBeVisible();

  // CONDITIONS: POISONED, VULNERABLE TO FIRE while it is on.
  await builderPage(page, 'CONDITIONS');
  await page.getByRole('list', { name: 'Conditions' }).getByRole('button', { name: 'POISONED' }).click();
  const poisoned = page.getByRole('region', { name: 'Poisoned condition' }).getByRole('group', { name: 'Resistances' });
  await poisoned.getByRole('button', { name: '+ RESISTANCE' }).click();
  await poisoned.getByRole('combobox', { name: 'Resistance 1: kind' }).selectOption({ label: 'VULNERABLE' });
  await expect(poisoned.getByRole('combobox', { name: 'Resistance 1: type' })).toHaveValue('fire');
  await expect(poisoned.getByText('while it is on')).toBeVisible();

  await expect(page.getByTestId('save-status')).toHaveText(/· SAVED /, { timeout: 15_000 });
  const saved = await asGm(request, token, 'get', `/api/systems/${id}`);
  expect(saved.problems).toEqual([]);
  expect(saved.draft.choices[0].options[0].features[0].resistances).toEqual([{ kind: 'resist', type: 'poison' }]);
  expect(saved.draft.items.list.find((i: { label: string }) => i.label === 'Ring of Warmth').features[0].resistances).toEqual([{ kind: 'resist', type: 'cold' }]);
  expect(saved.draft.conditions.poisoned.resistances).toEqual([{ kind: 'vulnerable', type: 'fire' }]);
});
