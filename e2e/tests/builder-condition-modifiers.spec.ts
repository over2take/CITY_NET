import { test, expect } from '@playwright/test';
import { signInAsGm, openBuilder, builderPage, gmToken, asGm } from './helpers';

// A condition's modifiers on the builder's CONDITIONS page (8a5e2; approved mockup docs/mockups/condition-modifiers.html,
// 2026-11-18): SLOWED made by clicks, ITS MODIFIERS APPLIED, Speed TIMES 0.5 and Might reduced by a formula, POISONED's
// ALL ROLLS left an ADD of a whole number. Saved as made, there after a reload. At the table it is 8a5e3's.

test('CONDITIONS: SLOWED APPLIED, Speed TIMES 0.5 and Might by a formula, saved and kept (8a5e2)', async ({ page, request }, info) => {
  const name = `Snailfall ${info.retry + 1}`;
  const token = await gmToken(request);
  const { id } = await asGm(request, token, 'post', '/api/systems', { definition: { format: 1, name, core: { health: { model: 'pool' } },
    stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'speed', label: 'Speed' }, { id: 'might', label: 'Might' }] }] } });
  const openIt = async () => {
    await signInAsGm(page);
    await openBuilder(page);
    const card = page.getByTestId(/^system-/).filter({ hasText: name.toUpperCase() });
    if (!(await card.getByRole('button', { name: 'OPEN', exact: true }).isVisible())) await card.getByRole('button').first().click();
    await card.getByRole('button', { name: 'OPEN', exact: true }).click();
    await builderPage(page, 'CONDITIONS');
  };
  await openIt();

  // SLOWED, one of this system's own.
  await page.getByTestId('conditions-page').getByRole('button', { name: '+ CONDITION' }).click();
  const made = page.getByRole('region', { name: 'New condition condition' });
  await made.getByRole('textbox', { name: 'NAME' }).fill('Slowed');
  const slowed = page.getByRole('region', { name: 'Slowed condition' });
  await slowed.getByRole('group', { name: 'Its modifiers' }).getByRole('button', { name: 'APPLIED' }).click();
  await expect(slowed.getByRole('note', { name: 'What its modifiers do' })).toHaveText(/^APPLIED: a character whose token has it/);

  // Speed TIMES 0.5; Might less by a formula.
  await slowed.getByRole('button', { name: '+ MODIFIER' }).click();
  await slowed.getByRole('combobox', { name: 'Modifier 1 target' }).selectOption({ label: 'Speed' });
  await slowed.getByRole('combobox', { name: 'Modifier 1 way' }).selectOption({ label: 'TIMES' });
  await slowed.getByRole('textbox', { name: 'Modifier 1 amount' }).fill('0.5');
  await slowed.getByRole('button', { name: '+ MODIFIER' }).click();
  await slowed.getByRole('combobox', { name: 'Modifier 2 target' }).selectOption({ label: 'Might' });
  await slowed.getByRole('textbox', { name: 'Modifier 2 amount' }).fill('@speed / -10');

  await expect(page.getByTestId('save-status')).toHaveText(/· SAVED /, { timeout: 15_000 });
  const saved = await asGm(request, token, 'get', `/api/systems/${id}`);
  expect(saved.problems).toEqual([]);
  expect(saved.draft.conditions.new_condition).toEqual({
    name: 'Slowed', applied: true,
    modifiers: [{ target: 'speed', way: 'times', amount: 0.5 }, { target: 'might', amount: '@speed / -10' }],
  });

  // Kept: a reload finds it APPLIED, its way and its formula.
  await page.reload();
  await openIt();
  await page.getByRole('list', { name: 'Conditions' }).getByRole('button', { name: 'SLOWED' }).click();
  const again = page.getByRole('region', { name: 'Slowed condition' });
  await expect(again.getByRole('group', { name: 'Its modifiers' }).getByRole('button', { name: 'APPLIED' })).toHaveAttribute('aria-pressed', 'true');
  await expect(again.getByRole('combobox', { name: 'Modifier 1 way' })).toHaveValue('times');
  await expect(again.getByRole('textbox', { name: 'Modifier 2 amount' })).toHaveValue('@speed / -10');
});
