import { test, expect, type Page } from '@playwright/test';
import { signInAsGm, openBuilder, builderPage, gmToken, asGm } from './helpers';

// A list's table to roll on, in the builder (7a5b1; approved mockup docs/mockups/nested-choices.html,
// version 2): a GM gives BACKGROUNDS a d6 table, the rolls shared out evenly over its three options;
// a roll typed onto another's is said beside it and the gap under the table; fixed, players set to
// roll only, and found as left after a reload, the server taking it with no problems. The system is
// set up through the API with its list already made, as the list itself is builder-choices' to make.

const definition = (name: string) => ({
  format: 1, name,
  choices: [{ id: 'backgrounds', one: 'Background', many: 'Backgrounds', options: [
    { id: 'dockhand', label: 'Dockhand' }, { id: 'scribe', label: 'Scribe' }, { id: 'thief', label: 'Thief' },
  ] }],
});

const openChoices = async (page: Page, name: string) => {
  await openBuilder(page);
  const card = page.getByTestId(/^system-/).filter({ hasText: name.toUpperCase() });
  if (!(await card.getByRole('button', { name: 'OPEN', exact: true }).isVisible())) await card.getByRole('button').first().click();
  await card.getByRole('button', { name: 'OPEN', exact: true }).click();
  await builderPage(page, 'CHOICES');
  return page.getByRole('region', { name: 'Backgrounds list' });
};

test('a d6 table on BACKGROUNDS, its rolls checked, rolled only, kept after a reload', async ({ page, request }, info) => {
  const name = `Tabled Hearth ${info.retry + 1}`;
  const token = await gmToken(request);
  const { id } = await asGm(request, token, 'post', '/api/systems', { definition: definition(name) });
  await signInAsGm(page);
  const list = await openChoices(page, name);

  // d6: shared out evenly, BY HAND OR ROLL to start.
  await list.getByRole('combobox', { name: 'Table die' }).selectOption('d6');
  const table = list.getByRole('group', { name: 'Table' });
  await expect(table.getByText('THE TABLE · D6 · 1 TO 6')).toBeVisible();
  await expect(table.getByRole('textbox', { name: 'Dockhand roll' })).toHaveValue('1-2');
  await expect(table.getByRole('textbox', { name: 'Thief roll' })).toHaveValue('5-6');
  await expect(list.getByRole('group', { name: 'Players pick' }).getByRole('button', { name: 'BY HAND OR ROLL' })).toHaveAttribute('aria-pressed', 'true');

  // SCRIBE typed onto DOCKHAND's 2: said beside it, and 4 left on nothing.
  await table.getByRole('textbox', { name: 'Scribe roll' }).fill('2-3');
  await expect(table.getByText('2 is both Dockhand and Scribe')).toBeVisible();
  await expect(table.getByText('Nothing on 4')).toBeVisible();
  await table.getByRole('textbox', { name: 'Scribe roll' }).fill('3-4');
  await expect(table.getByText(/is both|Nothing on/)).toHaveCount(0);

  // Rolled only.
  await list.getByRole('group', { name: 'Players pick' }).getByRole('button', { name: 'BY ROLL ONLY' }).click();
  await expect(list.getByText(/picking by hand is off for them/)).toBeVisible();
  await expect(page.getByTestId('save-status')).toHaveText(/· SAVED /, { timeout: 15_000 });
  const saved = await asGm(request, token, 'get', `/api/systems/${id}`);
  expect(saved.problems).toEqual([]);
  expect(saved.draft.choices[0]).toMatchObject({ table: 'd6', players: 'roll', options: [{ roll: '1-2' }, { roll: '3-4' }, { roll: '5-6' }] });

  // Kept: after a reload, as it was left.
  await page.reload();
  await signInAsGm(page);
  const again = await openChoices(page, name);
  await expect(again.getByRole('combobox', { name: 'Table die' })).toHaveValue('d6');
  await expect(again.getByRole('group', { name: 'Table' }).getByRole('textbox', { name: 'Scribe roll' })).toHaveValue('3-4');
  await expect(again.getByRole('group', { name: 'Players pick' }).getByRole('button', { name: 'BY ROLL ONLY' })).toHaveAttribute('aria-pressed', 'true');
});
