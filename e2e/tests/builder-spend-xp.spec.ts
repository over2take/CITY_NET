import { test, expect, type Page } from '@playwright/test';
import { signInAsGm, openBuilder, builderPage, gmToken, asGm } from './helpers';

// SPEND XP on the builder's LEVELS page (7f2b; approved mockup docs/mockups/ranks-and-xp.html, 2026-11-12): a GM turns
// SPEND XP on, raises SKILLS at @new * 5 up to 5, sells FEATS at 10, has purchases wait for the GM, and finds it all as
// they left it after a reload, the server taking it with no problems. The cost's words read the stat raised. Nothing at
// the table yet: that is the sheet's, 7f2c.

const openPage = async (page: Page, name: string) => {
  await openBuilder(page);
  const card = page.getByTestId(/^system-/).filter({ hasText: name.toUpperCase() });
  if (!(await card.getByRole('button', { name: 'OPEN', exact: true }).isVisible())) await card.getByRole('button').first().click();
  await card.getByRole('button', { name: 'OPEN', exact: true }).click();
  await builderPage(page, 'LEVELS');
  await expect(page.getByTestId('levels-page')).toBeVisible();
};
const saved = (page: Page) => expect(page.getByTestId('save-status')).toHaveText(/· SAVED /, { timeout: 15_000 });

test('a price list made, its cost read in words, waiting for the GM, kept after a reload', async ({ page, request }, info) => {
  const name = `Spendfall${info.retry ? ` ${info.retry + 1}` : ''}`;
  const gm = await gmToken(request);
  const { id } = await asGm(request, gm, 'post', '/api/systems', { definition: {
    format: 1, name,
    stats: [
      { id: 'attrs', label: 'ATTRIBUTES', stats: [{ id: 'body', label: 'Body' }] },
      { id: 'skills', label: 'SKILLS', stats: [{ id: 'lore', label: 'Lore' }] },
    ],
    choices: [{ id: 'feats', one: 'Feat', many: 'Feats', options: [{ id: 'alert', label: 'Alert' }] }],
  } });
  await signInAsGm(page);
  await openPage(page, name);

  await page.getByRole('button', { name: 'SPEND XP' }).click();
  const spend = page.getByRole('region', { name: 'Spend XP' });
  await expect(spend.getByText('Nothing yet. Add a stat to raise, or a list to buy from.')).toBeVisible();

  // RAISE A STAT IN SKILLS, COSTS @new * 5 (as it starts), UP TO 5; its words read the stat raised.
  await spend.getByRole('button', { name: '+ RAISE A STAT' }).click();
  const raise = spend.getByRole('group', { name: 'RAISE A STAT 1' });
  await raise.getByRole('combobox', { name: 'RAISE A STAT 1: in' }).selectOption({ label: 'SKILLS' });
  await expect(raise.getByRole('textbox', { name: 'RAISE A STAT 1: costs' })).toHaveValue('@new * 5');
  await expect(raise.getByRole('status')).toContainText('5 for each new rating');
  await expect(raise.getByRole('status')).toContainText('costs 15');
  await raise.getByRole('textbox', { name: 'RAISE A STAT 1: up to' }).fill('5');
  await raise.getByRole('textbox', { name: 'RAISE A STAT 1: up to' }).press('Enter');

  // AN OPTION FROM FEATS, COSTS 10.
  await spend.getByRole('button', { name: '+ AN OPTION' }).click();
  const option = spend.getByRole('group', { name: 'AN OPTION 2' });
  await expect(option.getByRole('combobox', { name: 'AN OPTION 2: from' })).toHaveValue('feats');
  await expect(option.getByRole('textbox', { name: 'AN OPTION 2: costs' })).toHaveValue('10');

  await spend.getByRole('switch', { name: /PURCHASES WAIT FOR THE GM/ }).click();
  await expect(spend.getByText(/^A player's purchase waits/)).toBeVisible();
  await saved(page);

  // The server has it, and takes it.
  const stored = await asGm(request, gm, 'get', `/api/systems/${id}`);
  expect(stored.draft.core.advancement).toEqual(['spend']);
  expect(stored.draft.spend).toEqual({ buys: [
    { id: 'raise', what: 'stat', stats: 'skills', cost: '@new * 5', most: 5 },
    { id: 'option', what: 'option', list: 'feats', cost: '10' },
  ], wait: true });
  expect(stored.problems.filter((p: { where: string }) => p.where.startsWith('spend'))).toEqual([]);

  // As left, after a reload.
  await page.reload();
  await signInAsGm(page);
  await openPage(page, name);
  const again = page.getByRole('region', { name: 'Spend XP' });
  await expect(again.getByRole('combobox', { name: 'RAISE A STAT 1: in' })).toHaveValue('skills');
  await expect(again.getByRole('textbox', { name: 'RAISE A STAT 1: up to' })).toHaveValue('5');
  await expect(again.getByRole('switch', { name: /PURCHASES WAIT FOR THE GM/ })).toHaveAttribute('aria-checked', 'true');

  // Taken off, the option's card goes.
  await again.getByRole('button', { name: 'Take off AN OPTION 2' }).click();
  await expect(again.getByRole('group', { name: 'AN OPTION 2' })).toHaveCount(0);
});
