import { test, expect } from '@playwright/test';
import { signInAsGm, openBuilder, builderPage, gmToken, asGm } from './helpers';

// The builder's CHOICES page (7a2b1; approved mockup docs/mockups/builder-choices.html, 2026-10-27):
// a GM makes the list characters pick their class from, levelled and taken more than once, gives it
// two options, one with a requirement, gives the SOLDIER a feature at level 2 (7a2b2) with a
// modifier on Intellect and uses a long rest refills, and finds it all as they left it after a
// reload; the server takes it with no problems.

test('a class list made on CHOICES, with two options, kept after a reload', async ({ page, request }, info) => {
  const name = `Choosing Hearth ${info.retry + 1}`;
  const token = await gmToken(request);
  const { id } = await asGm(request, token, 'post', '/api/systems', { definition: { format: 1, name, stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'int', label: 'Intellect' }] }] } });
  await signInAsGm(page);
  await openBuilder(page);
  const card = page.getByTestId(/^system-/).filter({ hasText: name.toUpperCase() });
  if (!(await card.getByRole('button', { name: 'OPEN', exact: true }).isVisible())) await card.getByRole('button').first().click();
  await card.getByRole('button', { name: 'OPEN', exact: true }).click();
  await builderPage(page, 'CHOICES');

  // + LIST: CLASS / CLASSES, levelled, more than once.
  await page.getByRole('button', { name: '+ LIST' }).click();
  const list = page.getByRole('region', { name: 'NEW CHOICES list' });
  await list.getByRole('textbox', { name: 'One' }).fill('Class');
  await page.getByRole('textbox', { name: 'Many' }).fill('Classes');
  const classes = page.getByRole('region', { name: 'Classes list' });
  await classes.getByRole('switch', { name: /LEVELLED/ }).click();
  await classes.getByRole('switch', { name: /MORE THAN ONCE/ }).click();
  // Its id stays as made, as a stat's does, so characters keep their picks through a rename.
  await expect(classes.getByText(/together they read as @new_list_level/)).toBeVisible();

  // Two options: SOLDIER, and MAGE, who needs INT 13.
  await classes.getByRole('button', { name: '+ OPTION' }).click();
  await page.getByRole('region', { name: 'NEW OPTION option' }).getByRole('textbox', { name: 'NAME' }).fill('Soldier');
  await classes.getByRole('button', { name: '+ OPTION' }).click();
  const mage = page.getByRole('region', { name: 'NEW OPTION option' });
  await mage.getByRole('textbox', { name: 'NAME' }).fill('Mage');
  await page.getByRole('region', { name: 'Mage option' }).getByRole('textbox', { name: 'REQUIRES' }).fill('@int >= 13');
  await expect(page.getByRole('region', { name: 'Mage option' }).getByText('Its level reads as @new_option_2_level in formulas: 0 for a character without it.')).toBeVisible();

  // SOLDIER's feature: at level 2, +1 Intellect, one use a long rest refills.
  await page.getByRole('region', { name: 'Classes list' }).getByRole('group', { name: 'Options' }).getByRole('button', { name: 'SOLDIER' }).click();
  const soldier = page.getByRole('region', { name: 'Soldier option' });
  await soldier.getByRole('button', { name: '+ FEATURE' }).click();
  const feature = soldier.getByRole('group', { name: 'Feature NEW FEATURE' });
  await feature.getByRole('textbox', { name: 'NAME' }).fill('Sharp Mind');
  const sharp = soldier.getByRole('group', { name: 'Feature Sharp Mind' });
  await sharp.getByRole('spinbutton', { name: 'AT LEVEL' }).fill('2');
  await sharp.getByRole('spinbutton', { name: 'AT LEVEL' }).press('Enter');
  await expect(soldier.getByRole('region', { name: 'Level 2' })).toContainText('SHARP MIND');
  await sharp.getByRole('button', { name: '+ MODIFIER' }).click();
  await sharp.getByRole('switch', { name: /HAS USES/ }).click();
  await sharp.getByRole('combobox', { name: 'Refilled by' }).selectOption('long_rest');
  await expect(soldier.getByRole('button', { name: /SHARP MIND/ })).toContainText('MODIFIER');
  await expect(soldier.getByRole('button', { name: /SHARP MIND/ })).toContainText('USES');

  // Saved, and nothing for PROBLEMS.
  await expect(page.getByTestId('save-status')).toHaveText(/· SAVED /, { timeout: 15_000 });
  const saved = await asGm(request, token, 'get', `/api/systems/${id}`);
  expect(saved.problems).toEqual([]);
  expect(saved.draft.choices[0]).toMatchObject({ one: 'Class', many: 'Classes', levelled: true, again: true, options: [
    { label: 'Soldier', features: [{ label: 'Sharp Mind', at: 2, modifiers: [{ target: 'int', amount: '1' }], uses: { count: '1', refill: 'long_rest' } }] },
    { label: 'Mage', requires: '@int >= 13' },
  ] });

  // Kept: after a reload, as it was left.
  await page.reload();
  await signInAsGm(page);
  await openBuilder(page);
  if (!(await card.getByRole('button', { name: 'OPEN', exact: true }).isVisible())) await card.getByRole('button').first().click();
  await card.getByRole('button', { name: 'OPEN', exact: true }).click();
  await builderPage(page, 'CHOICES');
  await expect(page.getByRole('list', { name: 'Lists' })).toContainText('CLASSES');
  const options = page.getByRole('region', { name: 'Classes list' }).getByRole('group', { name: 'Options' });
  await expect(options.getByRole('button')).toHaveText(['SOLDIER', 'MAGE']);
  await expect(page.getByRole('region', { name: 'Soldier option' }).getByRole('region', { name: 'Level 2' })).toContainText('SHARP MIND');
  await options.getByRole('button', { name: 'MAGE' }).click();
  await expect(page.getByRole('region', { name: 'Mage option' }).getByRole('textbox', { name: 'REQUIRES' })).toHaveValue('@int >= 13');
});
