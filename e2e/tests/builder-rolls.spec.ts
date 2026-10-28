import { test, expect, type Page } from '@playwright/test';
import path from 'path';
import { signInAsGm, openBuilder, builderPage, gmToken, asGm } from './helpers';

// STATS & RULES' ROLLS tab (6b1a, and a roll on GRAPH 6b4a; approved mockup docs/mockups/builder-rolls.html, 2026-10-19): a
// roll made from a preset, given the stats it is rolled by, kept after a reload, and TEST ROLL
// rolling it on the server for the sample character. With GRAPH_SHOTS=1, a picture of the tab goes
// to docs/mockups/shots/ for looking at by eye.

const SHOTS = path.join(__dirname, '..', '..', 'docs', 'mockups', 'shots');
const HEARTH = (name: string) => ({
  format: 1,
  name,
  stats: [
    { id: 'abilities', label: 'Abilities', stats: [{ id: 'str', label: 'Strength', min: 3, max: 18 }] },
    { id: 'skills', label: 'Skills', stats: [{ id: 'fight', label: 'Fight', tie: 'str', min: 0, max: 4 }, { id: 'lore', label: 'Lore', min: 0, max: 4 }] },
  ],
  samples: { str: 16, fight: 2, lore: 3 },
  conditions: { hurt: { name: 'Hurt', short: 'HURT', modifiers: [{ target: 'all_rolls', amount: -1 }] } },
});

const openSystem = async (page: Page, name: string) => {
  await openBuilder(page);
  const card = page.getByTestId(/^system-/).filter({ hasText: name.toUpperCase() });
  if (!(await card.getByRole('button', { name: 'OPEN', exact: true }).isVisible())) await card.getByRole('button').first().click();
  await card.getByRole('button', { name: 'OPEN', exact: true }).click();
  await builderPage(page, 'STATS & RULES');
};

test('a roll made from a preset, rolled by a group, kept, and test rolled on the server', async ({ page, request }, info) => {
  const name = `Rolling Hearth ${info.retry + 1}`;
  const token = await gmToken(request);
  await asGm(request, token, 'post', '/api/systems', { definition: HEARTH(name) });
  await asGm(request, token, 'put', '/api/systems/view', { page: 'rules', view: 'forms' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await signInAsGm(page);
  await openSystem(page, name);
  await page.getByRole('tab', { name: 'ROLLS' }).click();

  // No rolls yet: the presets. PbtA MOVE makes one.
  await page.getByRole('group', { name: 'New roll from a preset' }).getByRole('button', { name: 'PBTA MOVE' }).click();
  const roll = page.getByTestId('roll-pbta_move');
  await expect(roll.getByLabel('Roll name')).toHaveValue('PbtA move');
  await roll.getByLabel('Roll name').fill('Skill check');
  await roll.getByRole('region', { name: 'Rolled by' }).getByRole('button', { name: 'SKILLS' }).click();
  await expect(roll.getByRole('region', { name: 'Rolled by' }).getByRole('button', { name: 'SKILLS' })).toHaveAttribute('aria-pressed', 'true');

  // TEST ROLL: for LORE, with FORWARD +1; the server's dice, so the outcome is one of the bands.
  const test_ = page.getByTestId('test-roll');
  await test_.getByLabel('Roll it for').selectOption({ label: 'LORE' });
  await test_.getByRole('switch', { name: 'FORWARD +1' }).click();
  await test_.getByRole('button', { name: 'TEST ROLL ▸' }).click();
  await expect(test_.getByTestId('test-outcome')).toHaveText(/^(MISS|SUCCESS AT A COST|FULL SUCCESS)$/);
  await expect(test_.getByTestId('test-working')).toHaveText(/^\[\d \d = \d+ \+ 4 = \d+\] — /);
  await expect(test_.getByTestId('test-dice').locator('span')).toHaveCount(2);

  // Under HURT (6b3c), as a character with it on their token rolls: one less, named in the working.
  await test_.getByRole('switch', { name: 'HURT · ALL ROLLS −1' }).click();
  await test_.getByRole('button', { name: 'TEST ROLL ▸' }).click();
  await expect(test_.getByTestId('test-working')).toHaveText(/^\[\d \d = \d+ \+ 4 - 1 \(HURT\) = \d+\] — /);
  if (process.env.GRAPH_SHOTS) await page.screenshot({ path: path.join(SHOTS, 'builder-rolls-tab.png') });

  // Kept: after a reload, the roll is there as it was left.
  await expect(page.getByTestId('save-status')).toHaveText(/· SAVED /, { timeout: 15_000 });
  await page.reload();
  await signInAsGm(page);
  await openSystem(page, name);
  await page.getByRole('tab', { name: 'ROLLS' }).click();
  await expect(page.getByTestId('roll-pbta_move').getByLabel('Roll name')).toHaveValue('Skill check');
  await expect(page.getByTestId('roll-pbta_move').getByRole('region', { name: 'Rolled by' }).getByRole('button', { name: 'SKILLS' })).toHaveAttribute('aria-pressed', 'true');
});

test('a roll\'s dice, reading, adding and bands edited, and TEST ROLL rolling it as edited', async ({ page, request }, info) => {
  const name = `Editing Hearth ${info.retry + 1}`;
  const token = await gmToken(request);
  await asGm(request, token, 'post', '/api/systems', { definition: { ...HEARTH(name), rolls: [{ id: 'skill', label: 'Skill check', dice: [{ count: '2', sides: 6 }], add: '@this', by: ['skills'] }] } });
  await asGm(request, token, 'put', '/api/systems/view', { page: 'rules', view: 'forms' });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await signInAsGm(page);
  await openSystem(page, name);
  await page.getByRole('tab', { name: 'ROLLS' }).click();
  const roll = page.getByTestId('roll-skill');

  // 3d6, keep the highest two, + @this, read on two bands.
  await roll.getByLabel('Dice 1: how many').fill('3');
  await roll.getByRole('region', { name: 'READ THE DICE' }).getByRole('button', { name: 'KEEP HIGHEST' }).click();
  await roll.getByLabel('How many dice are kept').fill('2');
  await roll.getByRole('region', { name: 'ADD AND COMPARE' }).getByRole('button', { name: '+ BANDS' }).click();
  await roll.getByLabel('Band 1: up to').fill('8');
  await roll.getByLabel('Band 2: words').fill('Strong hit');
  // Step 4: sixes explode, once; a natural 18 is named.
  const special = roll.getByRole('region', { name: 'SPECIAL RESULTS' });
  await special.getByRole('group', { name: /EXPLODING/ }).getByRole('switch', { name: /ROLLS ANOTHER/ }).click();
  await special.getByRole('switch', { name: 'ONLY ONCE' }).click();
  await special.getByRole('button', { name: '+ NATURAL' }).click();
  await special.getByLabel('Natural 1: face').fill('18');
  await special.getByLabel('Natural 1: words').fill('Perfect');

  // TEST ROLL rolls it as it now stands: three dice, one not counted, on the bands.
  const test_ = page.getByTestId('test-roll');
  await test_.getByRole('button', { name: 'TEST ROLL ▸' }).click();
  await expect(test_.getByTestId('test-outcome')).toHaveText(/^(MISS|STRONG HIT)$/);
  // Three dice, or four when a six explodes (once); those not counted in brackets.
  await expect(test_.getByTestId('test-working')).toHaveText(/^\[[\d() ]+ = \d+ \+ 2 = \d+\] — (MISS|STRONG HIT)( · PERFECT)?$/);
  expect([3, 4]).toContain(await test_.getByTestId('test-dice').locator('span').count());
  if (process.env.GRAPH_SHOTS) await page.screenshot({ path: path.join(SHOTS, 'builder-rolls-editing.png'), fullPage: true });
});

test('a roll on GRAPH: its node wired from what rolls it, its panel the five steps', async ({ page, request }, info) => {
  const name = `Mapped Hearth ${info.retry + 1}`;
  const token = await gmToken(request);
  await asGm(request, token, 'post', '/api/systems', { definition: { ...HEARTH(name), rolls: [{ id: 'skill', label: 'Skill check', dice: [{ count: '2', sides: 6 }], add: '@this', bands: [{ upTo: 6, label: 'Miss' }, { label: 'Hit' }], by: ['skills'] }] } });
  await asGm(request, token, 'put', '/api/systems/view', { page: 'rules', view: 'graph' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await signInAsGm(page);
  await openSystem(page, name);
  const map = page.getByTestId('graph-view');
  const roll = map.getByTestId('graph-node-roll:skill');
  await expect(roll).toBeVisible();
  await expect(roll).toContainText('SKILL CHECK');
  await expect(roll).toContainText('2d6 + @this');
  await expect(roll).toContainText('7+ · 6−');
  // One wire in, from the SKILLS list's own dot.
  await expect(map.locator('[data-testid="graph-node-skills"] [data-handleid="out"]')).toBeVisible();
  if (process.env.GRAPH_SHOTS) await page.screenshot({ path: path.join(SHOTS, 'builder-roll-node.png') });

  // Its panel: the same five steps as the tab. Renamed there, renamed on the map.
  await roll.click();
  const panel = page.getByTestId('graph-panel');
  await expect(panel).toHaveAttribute('aria-label', 'ROLL SKILL CHECK');
  await panel.getByLabel('Roll name').fill('Feat');
  await expect(roll).toContainText('FEAT');
  await expect(panel.getByTestId('test-roll')).toBeVisible();
  if (process.env.GRAPH_SHOTS) await page.screenshot({ path: path.join(SHOTS, 'builder-roll-panel.png') });
  await page.keyboard.press('Escape');

  // + ADD → ROLL from a preset (6b4b): a Blades roll on the map, its panel open, rolled by nothing yet.
  await page.getByRole('button', { name: '+ ADD', exact: true }).click();
  await page.getByLabel('Add a node: type to search').fill('roll blades');
  await page.keyboard.press('Enter');
  const blades = map.getByTestId('graph-node-roll:blades_action');
  await expect(blades).toBeVisible();
  await expect(panel).toHaveAttribute('aria-label', 'ROLL BLADES ACTION');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'FIT', exact: true }).click();

  // The SKILLS list's own dot dragged onto it: rolled by every skill.
  const from = (await map.locator('[data-testid="graph-node-skills"] [data-handleid="out"]').boundingBox())!;
  const onto = (await blades.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(onto.x + onto.width / 2, onto.y + onto.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(map.getByRole('status')).toHaveText('BLADES ACTION is now rolled by SKILLS: a die button by each of its stats on the sheet.');
  await expect(blades).toContainText('ROLLED BY · EACH STAT');
});
