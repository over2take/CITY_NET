import { test, expect } from '@playwright/test';
import { signInAsGm, openBuilder, builderPage, gmToken, asGm } from './helpers';

// Recovery dice in the builder (R1b; approved mockup docs/mockups/rest-on-sheet.html, 2026-10-30):
// a GM gives two classes a HIT DIE on CHOICES, turns on RECOVERY DICE on RESTS and makes them D&D's
// hit dice (named, plus CON, half back at a long rest), has rests finished on each sheet, and finds
// it all as they left it after a reload; the server takes it with no problems. The pools on the
// sheet and the REST panel come in R2 to R4.

test('hit dice made on CHOICES and RESTS, kept after a reload', async ({ page, request }, info) => {
  const name = `Resting Forge ${info.retry + 1}`;
  const token = await gmToken(request);
  const { id } = await asGm(request, token, 'post', '/api/systems', { definition: {
    format: 1, name,
    stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'con', label: 'Constitution' }] }],
    derived: [{ id: 'con_mod', label: 'CON modifier', formula: 'floor((@con - 10) / 2)' }],
    choices: [{ id: 'classes', one: 'Class', many: 'Classes', levelled: true, options: [{ id: 'fighter', label: 'Fighter' }, { id: 'wizard', label: 'Wizard' }] }],
  } });
  await signInAsGm(page);
  await openBuilder(page);
  const card = page.getByTestId(/^system-/).filter({ hasText: name.toUpperCase() });
  if (!(await card.getByRole('button', { name: 'OPEN', exact: true }).isVisible())) await card.getByRole('button').first().click();
  await card.getByRole('button', { name: 'OPEN', exact: true }).click();

  // CHOICES: the Fighter's d10, the Wizard's d6.
  await builderPage(page, 'CHOICES');
  const fighter = page.getByRole('region', { name: 'Fighter option' });
  await fighter.getByRole('group', { name: 'Hit die' }).getByRole('button', { name: 'D10' }).click();
  await expect(fighter.getByText(/Turn on RECOVERY DICE on RESTS to spend its d10 at a rest\./)).toBeVisible();
  await page.getByRole('region', { name: 'Classes list' }).getByRole('group', { name: 'Options' }).getByRole('button', { name: 'WIZARD' }).click();
  await page.getByRole('region', { name: 'Wizard option' }).getByRole('group', { name: 'Hit die' }).getByRole('button', { name: 'D6' }).click();

  // RESTS: recovery dice on, named Hit Dice, + CON, half back at a long rest; finished on each sheet.
  await builderPage(page, 'RESTS');
  const resting = page.getByRole('region', { name: 'Resting' });
  await resting.getByRole('switch', { name: 'Recovery dice' }).click();
  await expect(resting.getByText('FIGHTER D10 · WIZARD D6')).toBeVisible();
  await resting.getByLabel('NAME', { exact: true }).fill('Hit Dice');
  await resting.getByRole('textbox', { name: 'Added to each' }).fill('@con_mod');
  await resting.getByRole('group', { name: 'LONG REST gives back' }).getByRole('button', { name: 'HALF, AT LEAST 1' }).click();
  await resting.getByRole('group', { name: 'Spending' }).getByRole('button', { name: 'WHEN THE GM OPENS IT' }).click();
  await resting.getByRole('group', { name: 'Rests are finished' }).getByRole('button', { name: 'ON EACH SHEET' }).click();
  await expect(resting.getByText(/COMING NEXT/)).toBeVisible();

  // Saved, and nothing for PROBLEMS.
  await expect(page.getByTestId('save-status')).toHaveText(/· SAVED /, { timeout: 15_000 });
  const saved = await asGm(request, token, 'get', `/api/systems/${id}`);
  expect(saved.problems).toEqual([]);
  expect(saved.draft.resting).toEqual({
    finish: 'sheet',
    recovery: { name: 'Hit Dice', plus: '@con_mod', spent_at: ['short_rest'], spend: 'gm', back: [{ rest: 'long_rest', how: 'half' }] },
  });
  expect(saved.draft.choices[0].options.map((o: { die?: number }) => o.die)).toEqual([10, 6]);

  // As left after a reload.
  await page.reload();
  await signInAsGm(page);
  await openBuilder(page);
  if (!(await card.getByRole('button', { name: 'OPEN', exact: true }).isVisible())) await card.getByRole('button').first().click();
  await card.getByRole('button', { name: 'OPEN', exact: true }).click();
  await builderPage(page, 'CHOICES');
  await expect(page.getByRole('region', { name: 'Fighter option' }).getByRole('group', { name: 'Hit die' }).getByRole('button', { name: 'D10' })).toHaveAttribute('aria-pressed', 'true');
  await builderPage(page, 'RESTS');
  const again = page.getByRole('region', { name: 'Resting' });
  await expect(again.getByLabel('NAME', { exact: true })).toHaveValue('Hit Dice');
  await expect(again.getByRole('group', { name: 'LONG REST gives back' }).getByRole('button', { name: 'HALF, AT LEAST 1' })).toHaveAttribute('aria-pressed', 'true');
  await expect(again.getByRole('group', { name: 'Rests are finished' }).getByRole('button', { name: 'ON EACH SHEET' })).toHaveAttribute('aria-pressed', 'true');
});
