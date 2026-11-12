import { test, expect } from '@playwright/test';
import { signInAsGm, openBuilder, builderPage, gmToken, asGm } from './helpers';

// The builder's RANKS (7f1b; approved mockup docs/mockups/ranks-and-xp.html, 2026-11-12): PROFICIENCY from its preset,
// Athletics holding it with TRAINED the highest at the start, its sample EXPERT, and a formula reading its worth; saved
// as made, there after a reload.

test('RANKS: PROFICIENCY from its preset, Athletics holding it, a formula reading its worth, saved and kept (7f1b)', async ({ page, request }, info) => {
  const name = `Rankfall ${info.retry + 1}`;
  const token = await gmToken(request);
  const { id } = await asGm(request, token, 'post', '/api/systems', { definition: { format: 1, name, core: { health: { model: 'pool' } },
    stats: [{ id: 'basics', label: 'BASICS', stats: [{ id: 'level', label: 'Level' }, { id: 'athletics', label: 'Athletics' }] }],
    samples: { level: 3 }, derived: [{ id: 'climb', label: 'Climb', formula: '@athletics + 1' }] } });
  await asGm(request, token, 'put', '/api/systems/view', { page: 'rules', view: 'forms' });
  const openIt = async () => {
    await signInAsGm(page);
    await openBuilder(page);
    const card = page.getByTestId(/^system-/).filter({ hasText: name.toUpperCase() });
    if (!(await card.getByRole('button', { name: 'OPEN', exact: true }).isVisible())) await card.getByRole('button').first().click();
    await card.getByRole('button', { name: 'OPEN', exact: true }).click();
    await builderPage(page, 'STATS & RULES');
  };
  await openIt();

  // PROFICIENCY from its preset, its lowest made worth -1.
  await page.getByRole('tab', { name: 'RANKS', exact: true }).click();
  await page.getByRole('group', { name: 'New rank list' }).getByRole('button', { name: '+ PROFICIENCY' }).click();
  const prof = page.getByTestId('ranks-proficiency');
  await expect(prof.getByRole('textbox', { name: 'PROFICIENCY rank 3 name' })).toHaveValue('EXPERT');
  await prof.getByRole('textbox', { name: 'PROFICIENCY rank 1 worth' }).fill('-1');
  await expect(prof.getByText('NO STAT HOLDS IT YET: SET ONE ON STATS')).toBeVisible();

  // Athletics holds it: TRAINED at most at the start, EXPERT for the sample.
  await page.getByRole('tab', { name: 'STATS', exact: true }).click();
  const athletics = page.getByTestId('stat-athletics');
  await athletics.getByRole('combobox', { name: 'Athletics holds' }).selectOption({ label: 'PROFICIENCY' });
  await athletics.getByRole('combobox', { name: 'Athletics at start, up to' }).selectOption({ label: 'TRAINED' });
  await athletics.getByRole('combobox', { name: 'Athletics sample' }).selectOption({ label: 'EXPERT' });

  // The formula reads its worth: EXPERT, 4 + level 3, + 1.
  await page.getByRole('tab', { name: 'FORMULAS', exact: true }).click();
  await expect(page.getByTestId('value-climb')).toHaveText('8', { timeout: 15_000 });

  await expect(page.getByTestId('save-status')).toHaveText(/· SAVED /, { timeout: 15_000 });
  const saved = await asGm(request, token, 'get', `/api/systems/${id}`);
  expect(saved.problems).toEqual([]);
  expect(saved.draft.stats[0].stats[1]).toEqual({ id: 'athletics', label: 'Athletics', rank: 'proficiency', atStart: 1 });
  expect(saved.draft.samples).toEqual({ level: 3, athletics: 2 });
  expect(saved.draft.ranks[0].list[0]).toEqual({ name: 'UNTRAINED', worth: '-1' });

  // Kept: a reload finds it.
  await page.reload();
  await openIt();
  await expect(page.getByTestId('stat-athletics').getByRole('combobox', { name: 'Athletics at start, up to' })).toHaveValue('1');
  await page.getByRole('tab', { name: 'RANKS', exact: true }).click();
  await expect(page.getByTestId('ranks-proficiency').getByText('HELD BY ATHLETICS')).toBeVisible();
});
