import { test, expect } from '@playwright/test';
import { signInAsGm, signInAsPlayer, openBuilder, builderPage, gmToken, asGm, approvedPlayer } from './helpers';

// A list a feature opens takes the level of what opened it (7a5d; the user on Fighter's Martial
// Archetype, 2026-10-29). In the builder the GM sets ARCHETYPES to THROUGH FEATURES, is told its
// features follow the FIGHTER's level, and puts Champion's Remarkable Athlete at 7. Published, a
// player raises FIGHTER to 3, picks CHAMPION under Martial Archetype and has Improved Critical only;
// Remarkable Athlete comes at Fighter 7, and the archetype never adds to the character's level.

const definition = (name: string) => ({
  format: 1,
  name,
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'str', label: 'Strength', min: 1, max: 20 }] }],
  core: { health: { model: 'pool' }, advancement: ['levels'], dice: ['d20'] },
  choices: [
    { id: 'classes', one: 'Class', many: 'Classes', levelled: true, options: [
      { id: 'fighter', label: 'Fighter', features: [{ id: 'martial_archetype', label: 'Martial Archetype', at: 3, choice: 'archetypes' }] },
    ] },
    { id: 'archetypes', one: 'Archetype', many: 'Archetypes', options: [
      { id: 'champion', label: 'Champion', description: 'Raw physical power honed to deadly perfection.', features: [
        { id: 'improved_critical', label: 'Improved Critical' },
        { id: 'remarkable_athlete', label: 'Remarkable Athlete' },
      ] },
      { id: 'battle_master', label: 'Battle Master' },
    ] },
  ],
});

test('an archetype picked at Fighter 3 unlocks its later features by the Fighter\'s level', async ({ page, browser, request }, info) => {
  test.setTimeout(180_000);
  const again = info.retry ? `_${info.retry + 1}` : '';
  const name = `Subclass Forge${again}`;
  const gm = await gmToken(request);
  const { id } = await asGm(request, gm, 'post', '/api/systems', { definition: definition(name) });

  // THE BUILDER: ARCHETYPES through features, following the Fighter; Remarkable Athlete at 7.
  await signInAsGm(page);
  await openBuilder(page);
  const card = page.getByTestId(/^system-/).filter({ hasText: name.toUpperCase() });
  if (!(await card.getByRole('button', { name: 'OPEN', exact: true }).isVisible())) await card.getByRole('button').first().click();
  await card.getByRole('button', { name: 'OPEN', exact: true }).click();
  await builderPage(page, 'CHOICES');
  await page.getByRole('list', { name: 'Lists' }).getByRole('button', { name: /ARCHETYPES/ }).click();
  const archetypes = page.getByRole('region', { name: 'Archetypes list' });
  await archetypes.getByRole('group', { name: 'Picked' }).getByRole('button', { name: 'THROUGH FEATURES' }).click();
  await expect(archetypes.getByText(/Each one's features unlock by the level of the pick that opened it: FIGHTER\./)).toBeVisible();
  await archetypes.getByRole('button', { name: 'CHAMPION', exact: true }).click();
  const champion = page.getByRole('region', { name: 'Champion option' });
  await champion.getByRole('button', { name: /^▸ REMARKABLE ATHLETE/ }).click();
  const level = champion.getByRole('group', { name: 'Feature Remarkable Athlete' }).getByRole('spinbutton', { name: 'AT LEVEL' });
  await level.fill('7');
  await level.press('Enter');
  await expect(champion.getByRole('region', { name: 'Level 7' })).toContainText('REMARKABLE ATHLETE');
  await expect(page.getByTestId('save-status')).toHaveText(/· SAVED /, { timeout: 15_000 });
  const saved = await asGm(request, gm, 'get', `/api/systems/${id}`);
  expect(saved.problems).toEqual([]);
  expect(saved.draft.choices[1].options[0].features.map((f: { at?: number }) => f.at ?? 1)).toEqual([1, 7]);

  // AT THE TABLE.
  await asGm(request, gm, 'post', `/api/systems/${id}/publish`);
  await asGm(request, gm, 'put', '/api/sheets/system', { system: id });
  const player = { username: `e2e_champion${again}`, password: 'e2e-player-password' };
  await approvedPlayer(request, gm, player);
  const context = await browser.newContext({ baseURL: info.project.use.baseURL });
  const sheet = await context.newPage();
  await signInAsPlayer(sheet, player);
  await sheet.getByRole('button', { name: 'CHARACTER_CONTROLS', exact: true }).click();
  await sheet.getByRole('button', { name: 'CHARACTER_SHEET', exact: true }).click();

  // FIGHTER to 3, CHAMPION picked under Martial Archetype: Improved Critical now, Remarkable Athlete next.
  const classes = sheet.getByRole('region', { name: 'Classes' });
  await classes.getByRole('group', { name: 'Pick a Class' }).getByRole('button', { name: 'FIGHTER' }).click();
  const fighter = classes.getByRole('group', { name: 'Fighter' });
  const levelTo = async (n: number) => {
    for (let at = Number((await fighter.getByText(/^LV \d+$/).textContent())!.slice(3)); at < n; at += 1) {
      await fighter.getByRole('button', { name: 'Fighter level up' }).click();
      await expect(fighter.getByText(`LV ${at + 1}`, { exact: true })).toBeVisible();
    }
  };
  await levelTo(3);
  const under = fighter.getByRole('group', { name: 'Under Martial Archetype' });
  await under.getByRole('group', { name: 'Pick an Archetype' }).getByRole('button', { name: 'CHAMPION' }).click();
  const picked = under.getByRole('group', { name: 'Champion' });
  await expect(picked.getByText('Improved Critical')).toBeVisible();
  await expect(picked.getByText('NEXT · LV 7: Remarkable Athlete')).toBeVisible();

  // FIGHTER to 7: Remarkable Athlete unlocks; the character is level 7, not 14.
  await levelTo(7);
  await expect(picked.getByText('Remarkable Athlete', { exact: true })).toBeVisible();
  await expect(picked.getByText(/^NEXT ·/)).toHaveCount(0);
  await expect.poll(async () => (await asGm(request, gm, 'get', `/api/sheets/user/${player.username}`)).data._worked.picks, { timeout: 15_000 })
    .toContainEqual({ list: 'archetypes', option: 'champion', level: 7, from: 'martial_archetype' });
  const { data } = await asGm(request, gm, 'get', `/api/sheets/user/${player.username}`);
  expect(data._worked.levels).toEqual({ fighter_level: 7, classes_level: 7, level: 7 });
  await context.close();
});
