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

test('the stats asked group by group, a group left out, kept after a reload', async ({ page, request }, info) => {
  const name = `Grouping Hearth ${info.retry + 1}`;
  const token = await gmToken(request);
  const { id } = await asGm(request, token, 'post', '/api/systems', { definition: { ...definition(name), stats: [
    { id: 'abilities', label: 'ABILITIES', stats: [{ id: 'grit', label: 'Grit' }] },
    { id: 'stress', label: 'STRESS', stats: [{ id: 'worry', label: 'Worry' }] },
  ] } });
  await signInAsGm(page);
  await openPage(page, name);
  const steps = page.getByRole('list', { name: 'The steps' }).getByRole('listitem');
  const names = () => steps.evaluateAll((all) => all.map((li) => li.getAttribute('aria-label')));

  // One way for all: STRESS left out of THE STATS.
  await page.getByRole('button', { name: 'THE STATS', exact: true }).click();
  await page.getByRole('switch', { name: 'STRESS asked' }).click();
  await expect(page.getByText(/Every stat but STRESS, typed in by the player/)).toBeVisible();

  // Group by group: a step each, in the same place, with STRESS still out.
  await page.getByRole('button', { name: 'GROUP BY GROUP' }).click();
  await expect(steps).toHaveCount(6);
  expect(await names()).toEqual(['WHO THEY ARE', 'ABILITIES', 'STRESS', 'CLASS', 'KITS', 'MONEY']);
  await expect(page.getByRole('switch', { name: 'STRESS on' })).toHaveAttribute('aria-checked', 'false');

  // Their own order: CLASS between them, what that means for MAGE said by the group.
  await page.getByRole('button', { name: 'CLASS up' }).click();
  await page.getByRole('button', { name: 'CLASS up' }).click();
  await expect(page.getByText(/CLASS comes before ABILITIES, and MAGE needs a stat/)).toBeVisible();
  await page.getByRole('button', { name: 'ABILITIES up' }).click();
  await expect(page.getByText(/comes before ABILITIES/)).toHaveCount(0);

  await expect(page.getByTestId('save-status')).toHaveText(/· SAVED /, { timeout: 15_000 });
  const saved = await asGm(request, token, 'get', `/api/systems/${id}`);
  expect(saved.problems).toEqual([]);
  expect(saved.draft.creation).toMatchObject({ statsBy: 'group', off: ['stats:stress'] });

  await page.reload();
  await signInAsGm(page);
  await openPage(page, name);
  await expect(steps).toHaveCount(6);
  expect(await names()).toEqual(['WHO THEY ARE', 'ABILITIES', 'CLASS', 'STRESS', 'KITS', 'MONEY']);
});

test('a fixed array: too few said, set, the server taking it, kept after a reload', async ({ page, request }, info) => {
  const name = `Arraying Hearth ${info.retry + 1}`;
  const token = await gmToken(request);
  const { id } = await asGm(request, token, 'post', '/api/systems', { definition: { ...definition(name), stats: [
    { id: 'abilities', label: 'ABILITIES', stats: [{ id: 'grit', label: 'Grit', min: 3, max: 15 }, { id: 'wits', label: 'Wits' }] },
  ] } });
  await signInAsGm(page);
  await openPage(page, name);
  await page.getByRole('button', { name: 'THE STATS', exact: true }).click();
  await page.getByRole('group', { name: 'How they are set' }).getByRole('button', { name: 'A FIXED ARRAY' }).click();
  await expect(page.getByText('0 numbers for 2 stats: each stat needs one')).toBeVisible();

  const box = page.getByRole('textbox', { name: 'The numbers' });
  await box.fill('16, 14');
  await expect(page.getByText('16 is above Grit\'s highest, 15')).toBeVisible();
  await box.fill('15, 14');
  await expect(page.getByText(/highest|each stat needs one/)).toHaveCount(0);
  await expect(page.getByTestId('save-status')).toHaveText(/· SAVED /, { timeout: 15_000 });
  const saved = await asGm(request, token, 'get', `/api/systems/${id}`);
  expect(saved.problems).toEqual([]);
  expect(saved.draft.creation).toEqual({ ways: { stats: { way: 'array', numbers: [15, 14] } } });

  await page.reload();
  await signInAsGm(page);
  await openPage(page, name);
  await page.getByRole('button', { name: 'THE STATS', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'The numbers' })).toHaveValue('15, 14');
});

test('rolled: what it reads and what it can come to said, set, the server taking it, kept after a reload', async ({ page, request }, info) => {
  const name = `Dice Stats Hearth ${info.retry + 1}`;
  const token = await gmToken(request);
  const { id } = await asGm(request, token, 'post', '/api/systems', { definition: { ...definition(name), stats: [
    { id: 'abilities', label: 'ABILITIES', stats: [{ id: 'grit', label: 'Grit', min: 1, max: 18 }] },
  ] } });
  await signInAsGm(page);
  await openPage(page, name);
  await page.getByRole('button', { name: 'THE STATS', exact: true }).click();
  await page.getByRole('group', { name: 'How they are set' }).getByRole('button', { name: 'ROLL' }).click();
  const each = page.getByRole('textbox', { name: 'Each is' });
  await expect(each).toHaveValue('4d6 drop lowest');

  await each.fill('lots');
  await expect(page.getByText(/^Reads like 3d6, 4d6 drop lowest/)).toBeVisible();
  await each.fill('4d6');
  await expect(page.getByText('4d6 can roll 24, above Grit\'s highest, 18')).toBeVisible();
  await each.fill('3d6');
  await expect(page.getByText(/can roll|Reads like/)).toHaveCount(0);
  await page.getByRole('group', { name: 'Placed' }).getByRole('button', { name: 'IN ORDER' }).click();
  await expect(page.getByText('Every stat, rolled with 3d6, in order.')).toBeVisible();
  await expect(page.getByTestId('save-status')).toHaveText(/· SAVED /, { timeout: 15_000 });
  const saved = await asGm(request, token, 'get', `/api/systems/${id}`);
  expect(saved.problems).toEqual([]);
  expect(saved.draft.creation).toEqual({ ways: { stats: { way: 'roll', each: '3d6', placed: 'order' } } });

  await page.reload();
  await signInAsGm(page);
  await openPage(page, name);
  await page.getByRole('button', { name: 'THE STATS', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Each is' })).toHaveValue('3d6');
  await expect(page.getByRole('group', { name: 'Placed' }).getByRole('button', { name: 'IN ORDER' })).toHaveAttribute('aria-pressed', 'true');
});

test('a point buy: points, range and costs set, what would strand a player said, kept after a reload', async ({ page, request }, info) => {
  const name = `Buying Hearth ${info.retry + 1}`;
  const token = await gmToken(request);
  const { id } = await asGm(request, token, 'post', '/api/systems', { definition: { ...definition(name), stats: [
    { id: 'abilities', label: 'ABILITIES', stats: [{ id: 'grit', label: 'Grit', min: 1, max: 15 }, { id: 'wits', label: 'Wits' }] },
  ] } });
  await signInAsGm(page);
  await openPage(page, name);
  await page.getByRole('button', { name: 'THE STATS', exact: true }).click();
  await page.getByRole('group', { name: 'How they are set' }).getByRole('button', { name: 'POINT BUY' }).click();
  const box = (label: string) => page.getByRole('textbox', { name: label, exact: true });
  await expect(box('Points')).toHaveValue('20');
  await expect(box('Cost of 15')).toHaveValue('9');

  // Past a stat's highest: said, then back within it.
  await box('Highest').fill('16');
  await expect(page.getByText('16 is above Grit\'s highest, 15')).toBeVisible();
  await box('Highest').fill('14');
  await expect(page.getByText(/highest,/)).toHaveCount(0);
  await expect(box('Cost of 15')).toHaveCount(0);

  // Their own points and a cost of their own.
  await box('Points').fill('12');
  await box('Cost of 14').fill('8');
  await expect(page.getByRole('group', { name: 'Costs' }).getByRole('button', { name: 'CLIMBING' })).toHaveAttribute('aria-pressed', 'false');
  await expect(page.getByTestId('save-status')).toHaveText(/· SAVED /, { timeout: 15_000 });
  const saved = await asGm(request, token, 'get', `/api/systems/${id}`);
  expect(saved.problems).toEqual([]);
  expect(saved.draft.creation).toEqual({ ways: { stats: { way: 'buy', points: 12, lowest: 8, highest: 14, costs: { 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 8 } } } });

  await page.reload();
  await signInAsGm(page);
  await openPage(page, name);
  await page.getByRole('button', { name: 'THE STATS', exact: true }).click();
  await expect(box('Points')).toHaveValue('12');
  await expect(box('Cost of 14')).toHaveValue('8');
});

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
