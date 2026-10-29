import { test, expect } from '@playwright/test';
import { signInAsGm, signInAsPlayer, openBuilder, builderPage, gmToken, asGm, approvedPlayer } from './helpers';

// Lists inside lists, and a list everyone has (7a5a2; approved mockup docs/mockups/nested-choices.html,
// 2026-10-28). In the builder the GM sees SPECIALTIES opened by the SOLDIER's Specialty and sets it to
// THROUGH FEATURES, and sets COMMONS to EVERYONE HAS IT. Published, a player raises SOLDIER to 3 and
// picks a specialty right under the feature; lowered to 2 it waits, kept, and comes back at 3. Every
// character has COMMONS, its Improvement unlocking at level 2.

const definition = (name: string) => ({
  format: 1,
  name,
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'int', label: 'Intellect', min: 1, max: 18 }] }],
  core: { health: { model: 'pool' }, advancement: ['levels'], dice: ['d20'] },
  choices: [
    { id: 'classes', one: 'Class', many: 'Classes', levelled: true, options: [
      { id: 'soldier', label: 'Soldier', features: [{ id: 'specialty', label: 'Specialty', at: 3, choice: 'specs' }] },
    ] },
    { id: 'specs', one: 'Specialty', many: 'Specialties', options: [
      { id: 'duelist', label: 'Duelist', features: [{ id: 'riposte', label: 'Riposte' }] },
      { id: 'vanguard', label: 'Vanguard' },
    ] },
    { id: 'commons', one: 'Common', many: 'Commons', options: [
      { id: 'second_wind', label: 'Second Wind', features: [{ id: 'breath', label: 'Breath' }, { id: 'improve', label: 'Improvement', at: 2 }] },
    ] },
  ],
});

test('a specialty picked under its class feature, kept while it waits; what every character has', async ({ page, browser, request }, info) => {
  test.setTimeout(180_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const name = `Nested Keep${again}`;
  const gm = await gmToken(request);
  const { id } = await asGm(request, gm, 'post', '/api/systems', { definition: definition(name) });

  // THE BUILDER: SPECIALTIES through features, COMMONS everyone has.
  await signInAsGm(page);
  await openBuilder(page);
  const card = page.getByTestId(/^system-/).filter({ hasText: name.toUpperCase() });
  if (!(await card.getByRole('button', { name: 'OPEN', exact: true }).isVisible())) await card.getByRole('button').first().click();
  await card.getByRole('button', { name: 'OPEN', exact: true }).click();
  await builderPage(page, 'CHOICES');
  const lists = page.getByRole('list', { name: 'Lists' });
  await lists.getByRole('button', { name: /SPECIALTIES/ }).click();
  const specs = page.getByRole('region', { name: 'Specialties list' });
  await expect(specs.getByLabel('Opened by')).toHaveText('OPENED BY · SOLDIER: SPECIALTY (LV 3)');
  await specs.getByRole('group', { name: 'Picked' }).getByRole('button', { name: 'THROUGH FEATURES' }).click();
  await lists.getByRole('button', { name: /COMMONS/ }).click();
  await page.getByRole('region', { name: 'Commons list' }).getByRole('group', { name: 'Picked' }).getByRole('button', { name: 'EVERYONE HAS IT' }).click();
  await expect(page.getByTestId('save-status')).toHaveText(/· SAVED /, { timeout: 15_000 });
  const saved = await asGm(request, gm, 'get', `/api/systems/${id}`);
  expect(saved.problems).toEqual([]);
  expect(saved.draft.choices.map((c: { picked?: string }) => c.picked ?? 'own')).toEqual(['own', 'features', 'everyone']);

  // AT THE TABLE.
  await asGm(request, gm, 'post', `/api/systems/${id}/publish`);
  await asGm(request, gm, 'put', '/api/sheets/system', { system: id });
  const player = { username: `e2e_nester${again}`, password: 'e2e-player-password' };
  await approvedPlayer(request, gm, player);
  const context = await browser.newContext({ baseURL: info.project.use.baseURL });
  const sheet = await context.newPage();
  await signInAsPlayer(sheet, player);
  await sheet.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true }).click();
  await sheet.getByRole('button', { name: 'CHARACTER_SHEET', exact: true }).click();

  // SPECIALTIES isn't a list of its own; COMMONS is every character's, Improvement at level 2.
  await expect(sheet.getByRole('region', { name: 'Specialties' })).toHaveCount(0);
  const commons = sheet.getByRole('region', { name: 'Commons' });
  await expect(commons.getByText('EVERY CHARACTER HAS THESE')).toBeVisible();
  await expect(commons.getByRole('group', { name: 'Second Wind' }).getByText('NEXT · LV 2: Improvement')).toBeVisible();

  // SOLDIER to 3: the specialty is picked right under the feature.
  const classes = sheet.getByRole('region', { name: 'Classes' });
  await classes.getByRole('group', { name: 'Pick a Class' }).getByRole('button', { name: 'SOLDIER' }).click();
  const soldier = classes.getByRole('group', { name: 'Soldier' });
  await soldier.getByRole('button', { name: 'Soldier level up' }).click();
  await expect(commons.getByText('Improvement')).toBeVisible();
  await soldier.getByRole('button', { name: 'Soldier level up' }).click();
  const under = soldier.getByRole('group', { name: 'Under Specialty' });
  await under.getByRole('group', { name: 'Pick a Specialty' }).getByRole('button', { name: 'DUELIST' }).click();
  await expect(under.getByRole('group', { name: 'Duelist' }).getByText('Riposte')).toBeVisible();
  await expect(under.getByRole('group', { name: 'Pick a Specialty' })).toHaveCount(0);

  // Lowered to 2: kept, waiting; back at 3, counted again.
  await soldier.getByRole('button', { name: 'Soldier level down' }).click();
  await expect(under.getByText('DUELIST · WAITS FOR SPECIALTY AT LEVEL 3, KEPT')).toBeVisible();
  await soldier.getByRole('button', { name: 'Soldier level up' }).click();
  await expect(under.getByRole('group', { name: 'Duelist' })).toBeVisible();

  const { data } = await asGm(request, gm, 'get', `/api/sheets/user/${player.username}`);
  expect(data._choices.specs).toEqual([{ option: 'duelist', from: 'specialty' }]);
  expect(data._worked.picks).toContainEqual({ list: 'commons', option: 'second_wind', level: 3 });
  await context.close();
});
