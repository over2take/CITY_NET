import { test } from '@playwright/test';
import path from 'path';
import { signInAsGm, openBuilder, builderPage, gmToken, asGm } from './helpers';

// Reference pictures of the graph view, to look at by eye before a PR that changes how it looks
// (5a3a): the CWN example as the map opens, fitted, with a node's panel open (5a3b2), a note added (5b5), a condition added (5b6a), PROBLEMS opened (5b6b), and in each theme. Not a check, so it runs
// only when asked:
//
//   GRAPH_SHOTS=1 npx playwright test tests/graph-shots.spec.ts
//
// (PowerShell: $env:GRAPH_SHOTS=1; npx playwright test tests/graph-shots.spec.ts)
// The pictures go to docs/mockups/shots/, which git ignores, like the rest of docs/.

const SHOTS = path.join(__dirname, '..', '..', 'docs', 'mockups', 'shots');
const THEMES = ['classic', 'vaporwave', 'cyberpunk', 'crimson', 'ocean', 'solar', 'monochrome'];

test.skip(!process.env.GRAPH_SHOTS, 'Pictures only when asked: GRAPH_SHOTS=1');

test('the graph view, for looking at', async ({ page, request }, info) => {
  const name = `Shots CWN ${info.retry + 1}`;
  const token = await gmToken(request);
  await asGm(request, token, 'post', '/api/systems', { name, example: 'cwn' });
  await asGm(request, token, 'put', '/api/systems/view', { page: 'rules', view: 'graph' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await signInAsGm(page);
  await openBuilder(page);
  const card = page.getByTestId(/^system-/).filter({ hasText: name.toUpperCase() });
  if (!(await card.getByRole('button', { name: 'OPEN', exact: true }).isVisible())) await card.getByRole('button').first().click();
  await card.getByRole('button', { name: 'OPEN', exact: true }).click();
  await builderPage(page, 'STATS & RULES');
  await page.getByTestId('graph-view').waitFor();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(SHOTS, 'graph-cwn-open.png') });
  await page.getByRole('button', { name: 'FIT', exact: true }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(SHOTS, 'graph-cwn-fit.png') });
  // A group of your own (5c2): the saves into one, named, its panel open.
  for (const id of ['save_physical', 'save_evasion', 'save_mental']) {
    await page.getByTestId(`graph-node-${id}`).click();
    const pick = page.getByTestId('graph-panel').getByLabel('Map group');
    await pick.selectOption({ label: id === 'save_physical' ? '+ NEW GROUP' : 'SAVES' });
    if (id === 'save_physical') {
      await page.keyboard.press('Escape');
      await page.getByTestId('graph-group-group_1').locator('.graph-group-head').click({ position: { x: 120, y: 10 } });
      await page.getByTestId('graph-panel').getByLabel('Group name').fill('SAVES');
    }
    await page.keyboard.press('Escape');
  }
  await page.getByTestId('graph-group-group_1').locator('.graph-group-head').click({ position: { x: 120, y: 10 } });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(SHOTS, 'graph-cwn-group.png') });
  await page.keyboard.press('Escape');
  // Hover (5c1): the physical save, what it reads and what reads it lit, the rest faded.
  await page.getByTestId('graph-node-save_physical').hover();
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(SHOTS, 'graph-cwn-hover.png') });
  await page.mouse.move(5, 5);
  // A node's panel: the same boxes as FORMS, beside the map.
  await page.getByTestId('graph-node-save_physical').click();
  await page.getByTestId('graph-panel').waitFor();
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(SHOTS, 'graph-cwn-panel.png') });
  // A note (5b5): pinned to the node picked, beside it, its panel open to write it.
  await page.keyboard.press('a');
  await page.getByLabel('Add a node: type to search').fill('note');
  await page.keyboard.press('Enter');
  await page.getByTestId('graph-panel').getByLabel('Note').fill('The book rounds this down. Check with the table before a big fight.');
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(SHOTS, 'graph-cwn-note.png') });
  await page.keyboard.press('Escape');
  // A condition (5b6a): IF, THEN and ELSE in its panel.
  await page.keyboard.press('a');
  await page.getByLabel('Add a node: type to search').fill('condition');
  await page.keyboard.press('Enter');
  await page.getByTestId('graph-panel').getByLabel('New condition if').fill('@level > 2');
  await page.getByTestId('graph-panel').getByLabel('New condition then').fill('@str_mod + 1');
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(SHOTS, 'graph-cwn-condition.png') });
  // PROBLEMS (5b6b): the condition broken, saved, and the list opened.
  await page.getByTestId('graph-panel').getByLabel('New condition else').fill('nothing(@level)');
  await page.keyboard.press('Escape');
  await page.getByTestId('save-status').filter({ hasText: /· SAVED / }).waitFor({ timeout: 15_000 });
  await page.getByTestId('graph-problems').getByRole('button', { name: /PROBLEMS/ }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(SHOTS, 'graph-cwn-problems.png') });
  await page.getByTestId('graph-problems').getByRole('button', { name: /PROBLEMS/ }).click();
  for (const theme of THEMES) {
    await page.evaluate((t) => {
      const root = document.querySelector('.crt-container') as HTMLElement;
      root.className = root.className.replace(/theme-\S+/, `theme-${t}`);
    }, theme);
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(SHOTS, `graph-cwn-theme-${theme}.png`), clip: { x: 0, y: 0, width: 1440, height: 520 } });
  }
});

// TRY ON THE MAP (5b6c): no example has a house rule, so a small system with one, switched on.
test('a house rule tried on the map, for looking at', async ({ page, request }, info) => {
  const name = `Shots Try ${info.retry + 1}`;
  const token = await gmToken(request);
  await asGm(request, token, 'post', '/api/systems', { definition: {
    format: 1, name,
    stats: [{ id: 'character', label: 'Character', stats: [{ id: 'lvl', label: 'Level' }] }, { id: 'abilities', label: 'Abilities', stats: [{ id: 'str', label: 'Strength' }, { id: 'wis', label: 'Wisdom' }] }],
    samples: { lvl: 3, str: 16, wis: 12 },
    lookups: { attribute_mod: { label: 'Attribute mod', bands: [{ upTo: 7, value: -1 }, { upTo: 13, value: 0 }, { value: 1 }] } },
    derived: [
      { id: 'str_mod', label: 'Str mod', formula: 'attribute_mod(@str)' },
      { id: 'wis_mod', label: 'Wis mod', formula: 'attribute_mod(@wis)' },
      { id: 'spell', label: 'Spell power', formula: '0', alternative: { rule: 'magic', formula: '@wis_mod + @lvl' } },
      { id: 'melee', label: 'Melee attack', formula: '@str_mod + floor(@lvl / 2)' },
    ],
    house_rules: [{ id: 'magic', name: 'Magic', description: 'Characters can learn spells.' }],
  } });
  await asGm(request, token, 'put', '/api/systems/view', { page: 'rules', view: 'graph' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await signInAsGm(page);
  await openBuilder(page);
  const card = page.getByTestId(/^system-/).filter({ hasText: name.toUpperCase() });
  if (!(await card.getByRole('button', { name: 'OPEN', exact: true }).isVisible())) await card.getByRole('button').first().click();
  await card.getByRole('button', { name: 'OPEN', exact: true }).click();
  await builderPage(page, 'STATS & RULES');
  await page.getByTestId('graph-view').waitFor();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(SHOTS, 'graph-try-off.png') });
  await page.getByRole('switch', { name: 'Try on the map' }).click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(SHOTS, 'graph-try-on.png') });
  await asGm(request, token, 'put', '/api/systems/view', { page: 'rules', view: 'forms' });
});
