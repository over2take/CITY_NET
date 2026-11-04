import { test, expect, type Page } from '@playwright/test';
import { signInAsGm, openBuilder, builderPage, gmToken, asGm } from './helpers';

// Choices on the graph (7a5c; approved mockup docs/mockups/nested-choices.html, section 3): CLASSES
// is a LEVELS node, MAGE's level wired into WARD, a feature's bonus a dashed wire into DEFENSE. Asked
// to cut that wire, the map offers GO TO CHOICES instead, opening FEATS, the second list; the node's
// own GO TO opens CLASSES. BACKGROUNDS, with neither levels nor bonuses, stays off the map.

const definition = (name: string) => ({
  format: 1, name,
  derived: [{ id: 'ward', label: 'Ward', formula: '10 + @mage_level' }, { id: 'defense', label: 'Defense', formula: '10' }],
  choices: [
    { id: 'classes', one: 'Class', many: 'Classes', levelled: true, options: [
      { id: 'soldier', label: 'Soldier' }, { id: 'mage', label: 'Mage' },
    ] },
    { id: 'feats', one: 'Feat', many: 'Feats', picks: 'any', options: [
      { id: 'keen', label: 'Keen', features: [{ id: 'keen_eye', label: 'Keen Eye', modifiers: [{ target: 'defense', amount: '2' }] }] },
    ] },
    { id: 'backgrounds', one: 'Background', many: 'Backgrounds', options: [{ id: 'dockhand', label: 'Dockhand' }] },
  ],
});

const toMap = async (page: Page, name: string) => {
  await openBuilder(page);
  const card = page.getByTestId(/^system-/).filter({ hasText: name.toUpperCase() });
  if (!(await card.getByRole('button', { name: 'OPEN', exact: true }).isVisible())) await card.getByRole('button').first().click();
  await card.getByRole('button', { name: 'OPEN', exact: true }).click();
  await builderPage(page, 'STATS & RULES');
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'GRAPH' }).click();
  await expect(page.getByTestId('graph-view')).toBeVisible();
};

test('a list\'s levels and a feature\'s bonus on the map, each going to CHOICES to be changed', async ({ page, request }, info) => {
  const name = `Mapped Choices ${info.retry + 1}`;
  const token = await gmToken(request);
  await asGm(request, token, 'post', '/api/systems', { definition: definition(name) });
  await asGm(request, token, 'put', '/api/systems/view', { page: 'rules', view: 'graph' });
  await signInAsGm(page);
  await toMap(page, name);
  const map = page.getByTestId('graph-view');

  // The nodes: levels, with a row a level; bonuses only; and one with neither off the map.
  const classes = map.getByTestId('graph-node-choices:classes');
  await expect(classes).toContainText('LEVELS');
  await expect(classes).toContainText('@mage_level');
  await expect(map.getByTestId('graph-node-choices:feats')).toContainText('BONUSES · 1');
  await expect(map.getByTestId('graph-node-choices:backgrounds')).toHaveCount(0);

  // The wires: MAGE's level into WARD, read in names; KEEN EYE's bonus into DEFENSE, a row of its own.
  await expect(map.getByTestId('graph-node-ward')).toContainText('10 + MAGE LEVEL');
  await expect(map.getByTestId('graph-node-defense')).toContainText('KEEN EYE +2');
  const bonus = map.locator('.react-flow__edge[data-id="choices:feats:bonus>defense:bonus:keen_eye:0"]');
  await expect(bonus).toHaveCount(1);

  // Asked to cut the bonus: it says what it is and offers CHOICES, not CUT. FEATS opens.
  await bonus.locator('path').first().dispatchEvent('click');
  const asked = page.getByRole('dialog', { name: 'Cut this wire?' });
  await expect(asked).toContainText('KEEN EYE +2 from FEATS into DEFENSE');
  await expect(asked.getByRole('button', { name: 'CUT', exact: true })).toHaveCount(0);
  await asked.getByRole('button', { name: 'GO TO CHOICES' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'CHOICES', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Feats list' })).toBeVisible();

  // Back on the map, the node's GO TO opens CLASSES.
  await builderPage(page, 'STATS & RULES');
  await expect(map.getByTestId('graph-node-choices:classes')).toBeVisible();
  await map.getByTestId('graph-node-choices:classes').getByRole('button', { name: 'GO TO' }).click();
  await expect(page.getByRole('region', { name: 'Classes list' })).toBeVisible();

  // Nothing about the system changed.
  await expect(page.getByTestId('save-status')).not.toHaveText(/UNSAVED/);
});
