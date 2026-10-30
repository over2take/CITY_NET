import { test, expect } from '@playwright/test';
import { signInAsGm, openBuilder, builderPage, gmToken, asGm } from './helpers';

// The builder's formula box (formula box 1; approved mockup docs/mockups/formula-box.html,
// 2026-10-29), read by the real server: a GM types a modifier with a misspelt name on Tough, sees it
// in red with the fix, takes the fix and reads it in words with the sample's value; writes another
// with a SHAPE and a name from INSERT; gives Fighter a requirement with AT LEAST; and finds the draft
// saved as written.

test('the formula box says a formula in words, catches a misspelt name, and writes one for you', async ({ page, request }, info) => {
  const name = `Formula Hearth ${info.retry + 1}`;
  const token = await gmToken(request);
  const { id } = await asGm(request, token, 'post', '/api/systems', { definition: {
    format: 1, name,
    stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'str', label: 'Strength' }, { id: 'con', label: 'Constitution' }] }],
    samples: { str: 16, con: 14 },
    core: { health: { model: 'pool' } },
    choices: [
      { id: 'classes', one: 'Class', many: 'Classes', levelled: true, options: [{ id: 'fighter', label: 'Fighter', features: [] }] },
      { id: 'feats', one: 'Feat', many: 'Feats', options: [{ id: 'tough', label: 'Tough', features: [{ id: 'tough_hp', label: 'Tough', modifiers: [{ target: 'str', amount: '1' }] }] }] },
    ],
  } });
  await signInAsGm(page);
  await openBuilder(page);
  const card = page.getByTestId(/^system-/).filter({ hasText: name.toUpperCase() });
  if (!(await card.getByRole('button', { name: 'OPEN', exact: true }).isVisible())) await card.getByRole('button').first().click();
  await card.getByRole('button', { name: 'OPEN', exact: true }).click();
  await builderPage(page, 'CHOICES');

  // Tough: a misspelt name, said in red with the nearest real one; USE @level fixes it.
  await page.getByRole('button', { name: /^FEATS/ }).click();
  const tough = page.getByRole('region', { name: 'Tough option' });
  await tough.getByRole('button', { name: /^▸ TOUGH/ }).click();
  const feature = tough.getByRole('group', { name: 'Feature Tough' });
  const amount = feature.getByRole('textbox', { name: 'Modifier 1: by' });
  await amount.fill('2 * @lvl');
  const words = feature.getByTestId('formula-words');
  await expect(words).toContainText("@lvl isn't one of this system's names");
  await expect(amount).toHaveAttribute('aria-invalid', 'true');
  await feature.getByRole('button', { name: 'USE @level' }).click();
  await expect(amount).toHaveValue('2 * @level');
  await expect(words).toHaveText('+2 for each level · sample Level 3: +6');

  // A SHAPE writes one, and a name from INSERT goes in at the cursor.
  await feature.getByRole('button', { name: 'Help writing Modifier 1: by' }).click();
  const help = feature.getByRole('group', { name: 'Help writing Modifier 1: by' });
  await help.getByRole('button', { name: 'PER CLASS LEVEL' }).click();
  await help.getByRole('combobox', { name: 'Which level' }).selectOption({ label: 'FIGHTER' });
  await help.getByRole('spinbutton', { name: 'How many' }).fill('3');
  await expect(amount).toHaveValue('3 * @fighter_level');
  await expect(words).toHaveText('+3 for each fighter level · sample Fighter level 3: +9');
  await amount.press('End');
  await amount.pressSequentially(' + ');
  await help.getByRole('button', { name: /^@con / }).click();
  await expect(amount).toHaveValue('3 * @fighter_level + @con');
  await expect(words).toHaveText('worked out from Fighter level, Constitution · sample Fighter level 3, Constitution 14: +23');

  // Fighter needs STR 13, written by AT LEAST; the sample has 16.
  await page.getByRole('button', { name: /^CLASSES/ }).click();
  const fighter = page.getByRole('region', { name: 'Fighter option' });
  await fighter.getByRole('button', { name: 'Help writing REQUIRES' }).click();
  await fighter.getByRole('group', { name: 'Help writing REQUIRES' }).getByRole('button', { name: 'AT LEAST', exact: true }).click();
  await expect(fighter.getByRole('textbox', { name: 'REQUIRES' })).toHaveValue('@str >= 13');
  await expect(fighter.getByTestId('formula-words')).toHaveText('needs Strength 13 or more · the sample (Strength 16) meets it');

  // Saved as written, with no problems: the draft saves itself a few seconds after the last change.
  await expect(page.getByTestId('save-status')).toHaveText(/· SAVED /, { timeout: 15_000 });
  const { draft, problems } = await asGm(request, token, 'get', `/api/systems/${id}`);
  expect([draft.choices[1].options[0].features[0].modifiers[0].amount, draft.choices[0].options[0].requires])
    .toEqual(['3 * @fighter_level + @con', '@str >= 13']);
  expect(problems).toEqual([]);
});
