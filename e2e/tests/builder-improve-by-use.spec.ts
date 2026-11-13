import { test, expect, type Page } from '@playwright/test';
import { signInAsGm, openBuilder, builderPage, gmToken, asGm } from './helpers';

// IMPROVE BY USE on the builder's LEVELS page (7f3a2; approved mockup docs/mockups/ranks-and-xp.html, 2026-11-12): a GM
// turns it on, improves SKILLS marked by any roll at a long rest, 1d20 over 10 for +1 up to 20, its roll said in words,
// and finds it as they left it after a reload, the server taking it with no problems. Nothing at the table yet: that is
// the sheet's, 7f3b.

const openPage = async (page: Page, name: string) => {
  await openBuilder(page);
  const card = page.getByTestId(/^system-/).filter({ hasText: name.toUpperCase() });
  if (!(await card.getByRole('button', { name: 'OPEN', exact: true }).isVisible())) await card.getByRole('button').first().click();
  await card.getByRole('button', { name: 'OPEN', exact: true }).click();
  await builderPage(page, 'LEVELS');
  await expect(page.getByTestId('levels-page')).toBeVisible();
};
const saved = (page: Page) => expect(page.getByTestId('save-status')).toHaveText(/· SAVED /, { timeout: 15_000 });

test('IMPROVE BY USE set up, its roll said in words, kept after a reload', async ({ page, request }, info) => {
  const name = `Usefall${info.retry ? ` ${info.retry + 1}` : ''}`;
  const gm = await gmToken(request);
  const { id } = await asGm(request, gm, 'post', '/api/systems', { definition: {
    format: 1, name,
    stats: [{ id: 'skills', label: 'SKILLS', stats: [{ id: 'lore', label: 'Lore' }] }],
    samples: { lore: 12 },
  } });
  await signInAsGm(page);
  await openPage(page, name);

  await page.getByRole('button', { name: 'IMPROVE BY USE' }).click();
  const improve = page.getByRole('region', { name: 'Improve by use' });
  await expect(improve.getByText('At END OF SESSION, each marked stat rolls d100; over @this, it gains 1d10. The marks clear.')).toBeVisible();
  await improve.getByRole('combobox', { name: 'Which stats improve' }).selectOption({ label: 'SKILLS' });
  await improve.getByRole('combobox', { name: 'Marked by' }).selectOption({ label: 'ANY ROLL OF IT' });
  await improve.getByRole('combobox', { name: 'At which rest' }).selectOption({ label: 'LONG REST' });
  await improve.getByRole('textbox', { name: 'Improvement roll' }).fill('1d20');
  // Said under its box: the sample's roll as a range.
  await expect(improve.getByRole('status').first()).toContainText('1 to 20');
  await improve.getByRole('textbox', { name: 'Improves if over' }).fill('10');
  await improve.getByRole('textbox', { name: 'Gain' }).fill('1');
  await improve.getByRole('textbox', { name: 'Improves up to' }).fill('20');
  await improve.getByRole('textbox', { name: 'Improves up to' }).press('Enter');
  await expect(improve.getByText('At LONG REST, each marked stat rolls 1d20; over 10, it gains 1, up to 20. The marks clear.')).toBeVisible();
  await saved(page);

  // The server has it, and takes it.
  const stored = await asGm(request, gm, 'get', `/api/systems/${id}`);
  expect(stored.draft.core.advancement).toEqual(['use']);
  expect(stored.draft.improve).toEqual({ stats: 'skills', marked: 'any', at: 'long_rest', roll: '1d20', over: '10', gain: '1', most: 20 });
  expect(stored.problems.filter((p: { where: string }) => p.where.startsWith('improve'))).toEqual([]);

  // As left, after a reload.
  await page.reload();
  await signInAsGm(page);
  await openPage(page, name);
  const again = page.getByRole('region', { name: 'Improve by use' });
  await expect(again.getByRole('combobox', { name: 'Marked by' })).toHaveValue('any');
  await expect(again.getByRole('textbox', { name: 'Improves up to' })).toHaveValue('20');
  await expect(again.getByText('At LONG REST, each marked stat rolls 1d20; over 10, it gains 1, up to 20. The marks clear.')).toBeVisible();
});
