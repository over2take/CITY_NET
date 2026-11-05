import { test, expect, type Page } from '@playwright/test';
import { signInAsGm, openBuilder, builderPage, gmToken, asGm } from './helpers';

// The builder's NEW CHARACTER page (7c1; approved mockup docs/mockups/new-character.html, 2026-11-03):
// a GM turns the flow on, moves CLASS above THE STATS and is told what that means for MAGE, puts it
// back, switches MONEY off, goes to a list on CHOICES, and finds it all as they left it after a
// reload, the server taking it with no problems. The window players get: sheet-new-character.spec.ts.

const definition = (name: string) => ({
  format: 1, name,
  stats: [{ id: 'traits', label: 'TRAITS', stats: [{ id: 'grit', label: 'Grit' }] }],
  choices: [{ id: 'classes', one: 'Class', many: 'Classes', options: [
    { id: 'soldier', label: 'Soldier' }, { id: 'mage', label: 'Mage', requires: '@grit >= 13' },
  ] }],
});

const openPage = async (page: Page, name: string) => {
  await openBuilder(page);
  const card = page.getByTestId(/^system-/).filter({ hasText: name.toUpperCase() });
  if (!(await card.getByRole('button', { name: 'OPEN', exact: true }).isVisible())) await card.getByRole('button').first().click();
  await card.getByRole('button', { name: 'OPEN', exact: true }).click();
  await builderPage(page, 'NEW CHARACTER');
};

test('the steps of a new character, ordered and switched, kept after a reload', async ({ page, request }, info) => {
  const name = `Stepping Hearth ${info.retry + 1}`;
  const token = await gmToken(request);
  const { id } = await asGm(request, token, 'post', '/api/systems', { definition: definition(name) });
  await signInAsGm(page);
  await openPage(page, name);

  // On, and the steps as the system has them.
  await page.getByRole('switch', { name: /GUIDED NEW CHARACTER/ }).click();
  await expect(page.getByText(/A player opening a blank sheet is walked through these steps/)).toBeVisible();
  const steps = page.getByRole('list', { name: 'The steps' }).getByRole('listitem');
  await expect(steps).toHaveCount(5);
  const names = () => steps.evaluateAll((all) => all.map((li) => li.getAttribute('aria-label')));
  expect(await names()).toEqual(['WHO THEY ARE', 'THE STATS', 'CLASS', 'KITS', 'MONEY']);

  // CLASS above THE STATS: told what that means. Back again.
  await page.getByRole('button', { name: 'CLASS up' }).click();
  await expect(page.getByText(/CLASS comes before THE STATS, and MAGE needs a stat/)).toBeVisible();
  await page.getByRole('button', { name: 'CLASS down' }).click();
  await expect(page.getByText(/comes before THE STATS/)).toHaveCount(0);

  // MONEY off, and to the end of the list of what's asked.
  await page.getByRole('button', { name: 'KITS down' }).click();
  await page.getByRole('switch', { name: 'MONEY on' }).click();
  await expect(page.getByTestId('save-status')).toHaveText(/· SAVED /, { timeout: 15_000 });
  const saved = await asGm(request, token, 'get', `/api/systems/${id}`);
  expect(saved.problems).toEqual([]);
  expect(saved.draft.creation).toEqual({ on: true, order: ['who', 'stats', 'list:classes', 'money', 'kits'], off: ['money'] });

  // A list's step goes to its list.
  await page.getByRole('listitem', { name: 'CLASS' }).getByRole('button', { name: 'CLASS', exact: true }).click();
  await page.getByRole('button', { name: 'GO TO CHOICES' }).click();
  await expect(page.getByRole('region', { name: 'Classes list' })).toBeVisible();

  // Kept: after a reload, as it was left.
  await page.reload();
  await signInAsGm(page);
  await openPage(page, name);
  await expect(page.getByRole('switch', { name: /GUIDED NEW CHARACTER/ })).toHaveAttribute('aria-checked', 'true');
  await expect(steps).toHaveCount(5);
  expect(await names()).toEqual(['WHO THEY ARE', 'THE STATS', 'CLASS', 'MONEY', 'KITS']);
  await expect(page.getByRole('switch', { name: 'MONEY on' })).toHaveAttribute('aria-checked', 'false');
});
