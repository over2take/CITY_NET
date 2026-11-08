import { test, expect, type Page } from '@playwright/test';
import { signInAsGm, openBuilder, builderPage, gmToken, asGm } from './helpers';

// The builder's LEVELS page (7d1; approved mockup docs/mockups/level-up.html, 2026-11-07): a GM turns XP levels
// on, fills the table from a cost and two ranges, types one level over, and finds it all as they left it after
// a reload, the server taking it with no problems. Nothing at the table yet: that is the meter's, 7d2. MAX HEALTH: A
// FORMULA (7d4) is typed in the formula box, said in words, and kept; and PER LEVEL (7d5a), its die one for all.

const openPage = async (page: Page, name: string) => {
  await openBuilder(page);
  const card = page.getByTestId(/^system-/).filter({ hasText: name.toUpperCase() });
  if (!(await card.getByRole('button', { name: 'OPEN', exact: true }).isVisible())) await card.getByRole('button').first().click();
  await card.getByRole('button', { name: 'OPEN', exact: true }).click();
  await builderPage(page, 'LEVELS');
  await expect(page.getByTestId('levels-page')).toBeVisible();
};
const saved = (page: Page) => expect(page.getByTestId('save-status')).toHaveText(/· SAVED /, { timeout: 15_000 });

test('a table from a cost and two ranges, one level typed over, kept after a reload', async ({ page, request }, info) => {
  const name = `Levelfall${info.retry ? ` ${info.retry + 1}` : ''}`;
  const gm = await gmToken(request);
  const { id } = await asGm(request, gm, 'post', '/api/systems', { definition: { format: 1, name } });
  await signInAsGm(page);
  await openPage(page, name);

  // Off to start: no table.
  await expect(page.getByText(/^Off: characters don't go up here/)).toBeVisible();
  await expect(page.getByRole('region', { name: 'The XP table' })).toHaveCount(0);
  await page.getByRole('button', { name: 'XP LEVELS' }).click();
  const table = page.getByRole('region', { name: 'The XP table' });
  await expect(table).toBeVisible();

  await page.getByRole('textbox', { name: 'Highest level' }).fill('8');
  await table.getByRole('textbox', { name: 'Level 2 costs' }).fill('100');
  await table.getByRole('button', { name: '+ ANOTHER RANGE' }).click();
  const high = table.getByRole('listitem', { name: 'Levels 5 to 8' });
  await high.getByRole('button', { name: '× 1.5' }).click();

  // Costs 100, 200, 400 to level 4, then x1.5 from level 5: 600, 900, 1350, 2025.
  const total = (level: number) => table.getByRole('textbox', { name: `Level ${level} total` });
  // The multipliers line up, range under range.
  const leftOf = async (name: string) => (await table.getByRole('group', { name: `${name}, each level costs` }).boundingBox())!.x;
  expect(Math.abs(await leftOf('Levels 1 to 4') - await leftOf('Levels 5 to 8'))).toBeLessThan(4);
  await expect(total(4)).toHaveValue('700');
  await expect(total(5)).toHaveValue('1300');
  await expect(total(8)).toHaveValue('5575');

  // One typed over too low says so; raised, it doesn't.
  await total(6).fill('100');
  await expect(table.getByText('Level 6 needs more than level 5, 1300')).toBeVisible();
  await total(6).fill('5000');
  await expect(table.getByText('Level 6 needs more than level 5, 1300')).toHaveCount(0);
  await total(7).fill('9000');
  await total(8).fill('20000');
  await expect(table.getByText(/needs more than level/)).toHaveCount(0);
  await saved(page);

  // The server has it, and takes it.
  const stored = await asGm(request, gm, 'get', `/api/systems/${id}`);
  expect(stored.draft.core.advancement).toEqual(['levels']);
  expect(stored.draft.levels).toEqual({ top: 8, first: 100, ranges: [{ to: 4, x: 2 }, { to: 8, x: 1.5 }], typed: { 6: 5000, 7: 9000, 8: 20000 } });
  expect(stored.problems.filter((p: { where: string }) => p.where.startsWith('levels'))).toEqual([]);

  // As left, after a reload.
  await page.reload();
  await signInAsGm(page);
  await openPage(page, name);
  const again = page.getByRole('region', { name: 'The XP table' });
  await expect(again.getByRole('textbox', { name: 'Level 6 total' })).toHaveValue('5000');
  await expect(again.getByRole('listitem', { name: 'Levels 5 to 8' }).getByRole('button', { name: '× 1.5' })).toHaveAttribute('aria-pressed', 'true');

  // FILL IT AGAIN asks, then takes what was typed.
  await again.getByRole('button', { name: 'FILL IT AGAIN' }).click();
  await again.getByRole('alertdialog', { name: 'Fill it again' }).getByRole('button', { name: 'FILL IT AGAIN' }).click();
  await expect(again.getByRole('textbox', { name: 'Level 6 total' })).toHaveValue('2200');

  // RENAME ON WORDS goes there.
  await page.getByRole('button', { name: 'RENAME ON WORDS' }).click();
  await expect(page.getByTestId('levels-page')).toHaveCount(0);
});

test('MAX HEALTH: A FORMULA typed, said in words, and kept after a reload (7d4)', async ({ page, request }, info) => {
  const name = `Heartfall${info.retry ? ` ${info.retry + 1}` : ''}`;
  const gm = await gmToken(request);
  const { id } = await asGm(request, gm, 'post', '/api/systems', { definition: { format: 1, name, stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'con', label: 'Constitution' }] }] } });
  await signInAsGm(page);
  await openPage(page, name);
  const health = page.getByRole('region', { name: 'Max health' });
  await expect(health.getByRole('button', { name: 'AS IT IS' })).toHaveAttribute('aria-pressed', 'true');
  await health.getByRole('button', { name: 'A FORMULA' }).click();
  await health.getByRole('textbox', { name: 'Max health formula' }).fill('10 + @con * 2');
  await expect(health.getByTestId('formula-words')).toContainText('Constitution');
  await saved(page);
  expect((await asGm(request, gm, 'get', `/api/systems/${id}`)).draft.levels.health).toEqual({ how: 'formula', formula: '10 + @con * 2' });
  await page.reload();
  await signInAsGm(page);
  await openPage(page, name);
  await expect(page.getByRole('region', { name: 'Max health' }).getByRole('textbox', { name: 'Max health formula' })).toHaveValue('10 + @con * 2');
});

test('MAX HEALTH: PER LEVEL, each class\'s die named, then one for all with what each level adds, kept (7d5a)', async ({ page, request }, info) => {
  const name = `Halebuild${info.retry ? ` ${info.retry + 1}` : ''}`;
  const gm = await gmToken(request);
  const { id } = await asGm(request, gm, 'post', '/api/systems', { definition: {
    format: 1, name, stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'con', label: 'Constitution' }] }],
    choices: [{ id: 'classes', one: 'Class', many: 'Classes', levelled: true, options: [{ id: 'fighter', label: 'Fighter', die: 10 }, { id: 'monk', label: 'Monk' }] }],
  } });
  await signInAsGm(page);
  await openPage(page, name);
  const health = page.getByRole('region', { name: 'Max health' });
  await health.getByRole('button', { name: 'PER LEVEL' }).click();
  await expect(health.getByLabel("Each class's die")).toHaveText('FIGHTER D10 · MONK NO HIT DIE');
  await expect(health.getByText('A class with no HIT DIE gains only what each level adds. Set one on CHOICES.')).toBeVisible();
  await health.getByRole('button', { name: 'ONE FOR ALL' }).click();
  await health.getByRole('combobox', { name: 'The die for every level' }).selectOption('12');
  await health.getByRole('textbox', { name: 'Each level adds' }).fill('@con');
  await expect(health.getByTestId('formula-words')).toContainText('Constitution');
  await saved(page);
  expect((await asGm(request, gm, 'get', `/api/systems/${id}`)).draft.levels.health).toEqual({ how: 'level', die_on: 'all', die: 12, adds: '@con' });
  await page.reload();
  await signInAsGm(page);
  await openPage(page, name);
  const again = page.getByRole('region', { name: 'Max health' });
  await expect(again.getByRole('button', { name: 'PER LEVEL' })).toHaveAttribute('aria-pressed', 'true');
  await expect(again.getByRole('combobox', { name: 'The die for every level' })).toHaveValue('12');
  await expect(again.getByRole('textbox', { name: 'Each level adds' })).toHaveValue('@con');
});
