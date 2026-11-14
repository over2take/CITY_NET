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

// Formula box 2: a roll's AGAINST with a misspelt @this, fixed and read for the sample rolling its
// first ROLLED BY stat; ADD written with ITS MODIFIER; a rest's amount written with DICE AND A STAT,
// said with the least and most it comes to. Saved as written.
test('the formula box on a roll\'s ADD and AGAINST and a rest\'s amount', async ({ page, request }, info) => {
  const name = `Formula Rolls ${info.retry + 1}`;
  const token = await gmToken(request);
  const { id } = await asGm(request, token, 'post', '/api/systems', { definition: {
    format: 1, name,
    stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'str', label: 'Strength' }, { id: 'con', label: 'Constitution' }] }],
    samples: { str: 16, con: 14 },
    derived: [{ id: 'con_mod', label: 'CON modifier', formula: 'floor((@con - 10) / 2)' }],
    core: { health: { model: 'pool' } },
    rolls: [{ id: 'save', label: 'Save', dice: [{ count: '1', sides: 20 }], by: ['abilities'] }],
    rests: { short_rest: { refills: [{ what: 'health', how: 'by', amount: '1' }] } },
  } });
  await asGm(request, token, 'put', '/api/systems/view', { page: 'rules', view: 'forms' });
  await signInAsGm(page);
  await openBuilder(page);
  const card = page.getByTestId(/^system-/).filter({ hasText: name.toUpperCase() });
  if (!(await card.getByRole('button', { name: 'OPEN', exact: true }).isVisible())) await card.getByRole('button').first().click();
  await card.getByRole('button', { name: 'OPEN', exact: true }).click();
  await builderPage(page, 'STATS & RULES');
  await page.getByRole('tab', { name: 'ROLLS' }).click();
  const compare = page.getByTestId('roll-save').getByRole('region', { name: 'ADD AND COMPARE' });

  // AGAINST: @thsi in red, USE @this, then the sample rolling Strength.
  const against = compare.getByRole('textbox', { name: 'Against' });
  await against.fill('@thsi');
  await expect(compare.getByText("@thsi isn't one of this system's names")).toBeVisible();
  await compare.getByRole('button', { name: 'USE @this' }).click();
  await expect(against).toHaveValue('@this');
  await expect(compare.getByTestId('formula-words')).toHaveText('against your rolled stat · sample, rolling Strength, rolled stat 16: target 16');

  // ADD: ITS MODIFIER from SHAPE.
  await compare.getByRole('button', { name: 'Help writing Add' }).click();
  await compare.getByRole('group', { name: 'Help writing Add' }).getByRole('button', { name: 'ITS MODIFIER', exact: true }).click();
  await expect(compare.getByRole('textbox', { name: 'Add' })).toHaveValue('@this_mod');

  // A short rest heals 1d8 + CON modifier: 3 to 10 for the sample.
  await builderPage(page, 'RESTS');
  await page.getByRole('button', { name: /^SHORT REST/ }).click();
  const rest = page.getByRole('region', { name: 'Short rest rest' });
  await rest.getByRole('button', { name: 'Help writing Refill 1: amount' }).click();
  const help = rest.getByRole('group', { name: 'Help writing Refill 1: amount' });
  await help.getByRole('button', { name: 'DICE AND A STAT' }).click();
  await help.getByRole('combobox', { name: 'Which', exact: true }).selectOption({ label: 'CON MODIFIER' });
  await expect(rest.getByRole('textbox', { name: 'Refill 1: amount' })).toHaveValue('1d8 + @con_mod');
  await expect(rest.getByTestId('formula-words')).toHaveText('1d8 + CON modifier · sample CON modifier 2: 3 to 10');

  await expect(page.getByTestId('save-status')).toHaveText(/· SAVED /, { timeout: 15_000 });
  const { draft, problems } = await asGm(request, token, 'get', `/api/systems/${id}`);
  expect([draft.rolls[0].add, draft.rolls[0].against, draft.rests.short_rest.refills[0].amount]).toEqual(['@this_mod', '@this', '1d8 + @con_mod']);
  expect(problems).toEqual([]);
});

// Formula box 3: on STATS & RULES, a formula with a misspelt name, which used to read 0 without a
// word, in red under its box with the fix; fixed, it says what it reads, and the VALUE follows.
test('the words and fixes under STATS & RULES formulas', async ({ page, request }, info) => {
  const name = `Formula Rules ${info.retry + 1}`;
  const token = await gmToken(request);
  const { id } = await asGm(request, token, 'post', '/api/systems', { definition: {
    format: 1, name,
    stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'str', label: 'Strength' }] }],
    samples: { str: 16 },
    derived: [{ id: 'grip', label: 'Grip', formula: '@strr + 1' }],
  } });
  await asGm(request, token, 'put', '/api/systems/view', { page: 'rules', view: 'forms' });
  await signInAsGm(page);
  await openBuilder(page);
  const card = page.getByTestId(/^system-/).filter({ hasText: name.toUpperCase() });
  if (!(await card.getByRole('button', { name: 'OPEN', exact: true }).isVisible())) await card.getByRole('button').first().click();
  await card.getByRole('button', { name: 'OPEN', exact: true }).click();
  await builderPage(page, 'STATS & RULES');
  await page.getByRole('tab', { name: 'FORMULAS' }).click();
  const grip = page.getByTestId('formula-grip');
  await expect(grip.getByTestId('formula-words')).toContainText("@strr isn't one of this system's names");
  await expect(page.getByTestId('value-grip')).toHaveText('1');
  await grip.getByRole('button', { name: 'USE @str' }).click();
  await expect(grip.getByLabel('Grip formula')).toHaveValue('@str + 1');
  await expect(grip.getByTestId('formula-words')).toHaveText('worked out from Strength');
  await expect(page.getByTestId('value-grip')).toHaveText('17');

  await expect(page.getByTestId('save-status')).toHaveText(/· SAVED /, { timeout: 15_000 });
  const { draft } = await asGm(request, token, 'get', `/api/systems/${id}`);
  expect(draft.derived[0].formula).toBe('@str + 1');
});
