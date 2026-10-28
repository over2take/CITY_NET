import { test, expect, type Page } from '@playwright/test';
import { signInAsGm, openBuilder, builderPage, gmToken, asGm } from './helpers';

// STATS & RULES with GRAPH on (5a3a; approved mockup docs/mockups/builder-graph.html, 2026-10-17,
// nodes as the builder design's node kit draws them, 2026-09-29). A real browser lays the map out,
// which unit tests can't: so here a GM's own system is drawn, dragged and folded and all of it kept
// after a reload; every dot sits on its row and every wire the system has is drawn; nothing
// overlaps; it opens at a zoom that can be read; a wire going backwards stays out of its nodes;
// and the map takes every theme's colors.

const HEARTH = (name: string) => ({
  format: 1,
  name,
  stats: [
    { id: 'character', label: 'Character', stats: [{ id: 'lvl', label: 'Level', min: 1, max: 10 }] },
    { id: 'abilities', label: 'Abilities', stats: [{ id: 'str', label: 'Strength', min: 3, max: 18 }, { id: 'dex', label: 'Dexterity', min: 3, max: 18 }] },
  ],
  samples: { lvl: 3, str: 16, dex: 12 },
  lookups: { attribute_mod: { label: 'Attribute mod', bands: [{ upTo: 13, value: 0 }, { value: 1 }] } },
  derived: [
    { id: 'str_mod', label: 'Str mod', formula: 'attribute_mod(@str)' },
    { id: 'dex_mod', label: 'Dex mod', formula: 'attribute_mod(@dex)' },
    { id: 'melee', label: 'Melee attack', formula: '@str_mod + floor(@lvl / 2)' },
    { id: 'save', label: 'Physical save', formula: '16 - (@lvl + max(@str_mod, @dex_mod))' },
  ],
  graph: { groups: [{ id: 'attacks', label: 'ATTACKS', members: ['melee'] }] },
});
/** The table into ABILITIES; STR MOD and LEVEL into MELEE; LEVEL, STR MOD and DEX MOD into the save. */
const WIRES = 6;

// Back to FORMS after each: the journeys share one database, and the next expects FORMS.
test.afterEach(async ({ request }) => {
  await asGm(request, await gmToken(request), 'put', '/api/systems/view', { page: 'rules', view: 'forms' });
});

const openSystem = async (page: Page, name: string) => {
  await openBuilder(page);
  const card = page.getByTestId(/^system-/).filter({ hasText: name.toUpperCase() });
  if (!(await card.getByRole('button', { name: 'OPEN', exact: true }).isVisible())) await card.getByRole('button').first().click();
  await card.getByRole('button', { name: 'OPEN', exact: true }).click();
  await builderPage(page, 'STATS & RULES');
};
const placeOf = (page: Page, id: string) => page.getByTestId(`graph-node-${id}`).locator('xpath=..').evaluate((el) => (el as HTMLElement).style.transform);
const toGraph = async (page: Page) => {
  const view = page.getByRole('group', { name: 'View' });
  if ((await view.getByRole('button', { name: 'GRAPH' }).getAttribute('aria-pressed')) !== 'true') await view.getByRole('button', { name: 'GRAPH' }).click();
  await expect(page.getByTestId('graph-view')).toBeVisible();
};
/** Drag a node by its title bar. */
const drag = async (page: Page, id: string, dx: number, dy: number) => {
  const box = (await page.getByTestId(`graph-node-${id}`).boundingBox())!;
  await page.mouse.move(box.x + 60, box.y + 8);
  await page.mouse.down();
  await page.mouse.move(box.x + 60 + dx, box.y + 8 + dy, { steps: 10 });
  await page.mouse.up();
};

test('a system as a map: drawn, dragged, folded, and all of it kept', async ({ page, request }, info) => {
  const name = `Hearth Map ${info.retry + 1}`;
  const token = await gmToken(request);
  await asGm(request, token, 'post', '/api/systems', { definition: HEARTH(name) });
  // FORMS until GRAPH is picked; another journey may have left it on.
  await asGm(request, token, 'put', '/api/systems/view', { page: 'rules', view: 'forms' });

  await signInAsGm(page);
  await openSystem(page, name);
  const view = page.getByRole('group', { name: 'View' });
  await expect(view.getByRole('button', { name: 'FORMS' })).toHaveAttribute('aria-pressed', 'true');
  await view.getByRole('button', { name: 'GRAPH' }).click();

  // The stats as lists, the table, the formulas, the server's values on them, and the wires.
  const map = page.getByTestId('graph-view');
  for (const id of ['character', 'abilities', 'table:attribute_mod', 'melee', 'save']) await expect(map.getByTestId(`graph-node-${id}`)).toBeVisible();
  await expect(map.getByTestId('graph-node-abilities')).toContainText('MOD VIA');
  await expect(map.getByTestId('graph-node-save').locator('[data-value]')).toHaveText('12');
  await expect(map.getByTestId('graph-node-melee').locator('[data-value]')).toHaveText('2');
  await expect(map.getByTestId('graph-node-save')).toContainText('16 − (LEVEL + BEST)');
  await expect(map.locator('.react-flow__edge')).toHaveCount(WIRES);

  // A node dragged lands on the grid and is saved with the draft.
  const before = await placeOf(page, 'save');
  await drag(page, 'save', 100, 80);
  const after = await placeOf(page, 'save');
  expect(after).not.toBe(before);
  const [x, y] = after.match(/-?\d+(\.\d+)?/g)!.map(Number);
  expect([x % 24, y % 24]).toEqual([0, 0]);

  // Undone with Ctrl+Z wherever the focus is after a drag, and done again with Ctrl+Y.
  await page.keyboard.press('Control+z');
  await expect.poll(() => placeOf(page, 'save')).toBe(before);
  await page.keyboard.press('Control+y');
  await expect.poll(() => placeOf(page, 'save')).toBe(after);

  // A group folded: one box, how many nodes and wires out, its member's wires through its one dot.
  await map.getByRole('button', { name: 'Fold ATTACKS' }).click();
  await expect(map.getByTestId('graph-node-melee')).toBeHidden();
  await expect(map.getByTestId('graph-group-attacks')).toContainText('1 NODE · 0 WIRES OUT');
  await expect(map.locator('.react-flow__edge')).toHaveCount(WIRES);
  // 'SAVED' alone would match UNSAVED CHANGES.
  await expect(page.getByTestId('save-status')).toHaveText(/· SAVED /, { timeout: 15_000 });

  // After a reload: GRAPH, the node where it was put, the group still folded.
  await page.reload();
  await signInAsGm(page);
  await openSystem(page, name);
  await expect(view.getByRole('button', { name: 'GRAPH' })).toHaveAttribute('aria-pressed', 'true');
  await expect(map.getByTestId('graph-group-attacks')).toContainText('1 NODE');
  expect(await placeOf(page, 'save')).toBe(after);
  await expect(map.locator('.react-flow__edge')).toHaveCount(WIRES);

  // FORMS: the same system, every formula there.
  await view.getByRole('button', { name: 'FORMS' }).click();
  await page.getByRole('tab', { name: 'FORMULAS' }).click();
  for (const id of ['str_mod', 'dex_mod', 'melee', 'save']) await expect(page.getByTestId(`formula-${id}`)).toBeVisible();
  await expect(page.getByTestId('value-save')).toHaveText('12');
  expect((await asGm(request, token, 'get', '/api/systems/view')).views.rules).toBe('forms');
});

test('a node edited in its panel is the same system in FORMS, and the map follows', async ({ page, request }, info) => {
  const name = `Panel Map ${info.retry + 1}`;
  const token = await gmToken(request);
  await asGm(request, token, 'post', '/api/systems', { definition: HEARTH(name) });
  await asGm(request, token, 'put', '/api/systems/view', { page: 'rules', view: 'graph' });
  await signInAsGm(page);
  await openSystem(page, name);
  await toGraph(page);
  const map = page.getByTestId('graph-view');
  await expect(map.locator('.react-flow__edge')).toHaveCount(WIRES);

  // A click on a node opens its panel, the same boxes as FORMS.
  await map.getByTestId('graph-node-melee').click();
  const panel = page.getByTestId('graph-panel');
  await expect(panel).toHaveAttribute('aria-label', 'FORMULA MELEE ATTACK');
  const text = panel.getByLabel('Melee attack formula');
  await text.click();
  await text.press('End');
  await text.pressSequentially(' + @dex_mod + 3');

  // The map follows: a wire from DEX MOD, and the server's new value, in the panel and on the node.
  await expect(map.locator('.react-flow__edge')).toHaveCount(WIRES + 1);
  await expect(panel.getByTestId('panel-value-melee')).toHaveText('= 5');
  await expect(map.getByTestId('graph-node-melee').locator('[data-value]')).toHaveText('5');
  await expect(map.getByTestId('graph-node-melee')).toContainText('STR MOD + floor(LEVEL / 2) + DEX MOD + 3');

  // Escape closes it; FORMS has the same formula, the same value.
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
  await expect(page.getByTestId('save-status')).toHaveText(/· SAVED /, { timeout: 15_000 });
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'FORMS' }).click();
  await page.getByRole('tab', { name: 'FORMULAS' }).click();
  await expect(page.getByLabel('Melee attack formula')).toHaveValue('@str_mod + floor(@lvl / 2) + @dex_mod + 3');
  await expect(page.getByTestId('value-melee')).toHaveText('5');
});

/** A point on a wire's own line, where a person would click it (a trace's box is mostly empty). */
const onWire = (page: Page, id: string) => page.locator(`[data-testid="rf__edge-${id}"] .react-flow__edge-path`).evaluate((p) => {
  const path = p as SVGPathElement;
  // Just before its input: wires from one dot run together at first, each turns into its own lane at the end.
  const at = path.getPointAtLength(Math.max(0, path.getTotalLength() - 14));
  const m = path.getScreenCTM()!;
  return { x: at.x * m.a + at.y * m.c + m.e, y: at.x * m.b + at.y * m.d + m.f };
});

test("wires drawn and cut on the map are the formula's own text, and undo", async ({ page, request }, info) => {
  const name = `Wired Map ${info.retry + 1}`;
  const token = await gmToken(request);
  await asGm(request, token, 'post', '/api/systems', { definition: HEARTH(name) });
  await asGm(request, token, 'put', '/api/systems/view', { page: 'rules', view: 'graph' });
  await signInAsGm(page);
  await openSystem(page, name);
  await toGraph(page);
  await page.getByRole('button', { name: 'FIT', exact: true }).click();
  const map = page.getByTestId('graph-view');
  await expect(map.locator('.react-flow__edge')).toHaveCount(WIRES);

  // Drawn: DEX MOD's dot dragged onto MELEE, anywhere on it.
  const from = (await map.getByTestId('graph-node-abilities').locator('[data-handleid="out:dex_mod"]').boundingBox())!;
  const onto = (await map.getByTestId('graph-node-melee').boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(onto.x + onto.width / 2, onto.y + onto.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(map.getByRole('status')).toHaveText('MELEE ATTACK: added + DEX MOD.');
  await expect(map.locator('.react-flow__edge')).toHaveCount(WIRES + 1);
  await expect(map.getByTestId('graph-node-melee')).toContainText('+ DEX MOD');

  // Undone, and done again.
  await page.keyboard.press('Control+z');
  await expect(map.locator('.react-flow__edge')).toHaveCount(WIRES);
  await page.keyboard.press('Control+y');
  await expect(map.locator('.react-flow__edge')).toHaveCount(WIRES + 1);

  // Cut: STR MOD's wire into MELEE, asked first.
  const strWire = await onWire(page, 'abilities:out:str_mod>melee:b:@str_mod');
  await page.mouse.click(strWire.x, strWire.y);
  const ask = page.getByRole('dialog', { name: 'Cut this wire?' });
  await expect(ask).toContainText('STR MOD into MELEE ATTACK');
  await ask.getByRole('button', { name: 'CUT' }).click();
  await expect(map.getByRole('status')).toHaveText('MELEE ATTACK: took out STR MOD.');
  await expect(map.locator('.react-flow__edge')).toHaveCount(WIRES);

  // LEVEL is inside floor(): not cut, the panel opened on the formula to change by hand.
  const lvlWire = await onWire(page, 'character:out:lvl>melee:b:@lvl');
  await page.mouse.click(lvlWire.x, lvlWire.y);
  await page.getByRole('dialog', { name: 'Cut this wire?' }).getByRole('button', { name: 'CUT' }).click();
  await expect(map.getByRole('status')).toContainText('LEVEL is part of a bigger piece');
  await expect(page.getByTestId('graph-panel')).toHaveAttribute('aria-label', 'FORMULA MELEE ATTACK');

  // FORMS: the formula as the wires left it.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('save-status')).toHaveText(/· SAVED /, { timeout: 15_000 });
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'FORMS' }).click();
  await page.getByRole('tab', { name: 'FORMULAS' }).click();
  await expect(page.getByLabel('Melee attack formula')).toHaveValue('floor(@lvl / 2) + @dex_mod');
});

test('a modifier is a diamond on its wire, its number changed in the panel', async ({ page, request }, info) => {
  const name = `Diamond Map ${info.retry + 1}`;
  const token = await gmToken(request);
  await asGm(request, token, 'post', '/api/systems', { definition: HEARTH(name) });
  await asGm(request, token, 'put', '/api/systems/view', { page: 'rules', view: 'graph' });
  await signInAsGm(page);
  await openSystem(page, name);
  await toGraph(page);
  const map = page.getByTestId('graph-view');

  // floor(@lvl / 2) in MELEE: the level's wire carries ÷2↓, the only wire with a diamond.
  const lvlWire = map.getByTestId('rf__edge-character:out:lvl>melee:b:@lvl');
  await expect(lvlWire.locator('[data-modifier]')).toHaveAttribute('data-modifier', '÷2↓');
  await expect(lvlWire.locator('text')).toHaveText('÷2↓');
  await expect(map.locator('.react-flow__edge [data-modifier]')).toHaveCount(1);

  // Changed to 4 in the panel: the diamond, the value and the formula all follow.
  await map.getByTestId('graph-node-melee').click();
  const box = page.getByTestId('graph-panel').getByLabel('LEVEL divided by, rounded down');
  await expect(box).toHaveValue('2');
  await box.fill('4');
  await expect(lvlWire.locator('text')).toHaveText('÷4↓');
  await expect(map.getByTestId('graph-node-melee').locator('[data-value]')).toHaveText('1');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('save-status')).toHaveText(/· SAVED /, { timeout: 15_000 });
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'FORMS' }).click();
  await page.getByRole('tab', { name: 'FORMULAS' }).click();
  await expect(page.getByLabel('Melee attack formula')).toHaveValue('@str_mod + floor(@lvl / 4)');
});

test('a node added with A where the GM is looking, and removed with Delete', async ({ page, request }, info) => {
  const name = `Added Map ${info.retry + 1}`;
  const token = await gmToken(request);
  await asGm(request, token, 'post', '/api/systems', { definition: HEARTH(name) });
  await asGm(request, token, 'put', '/api/systems/view', { page: 'rules', view: 'graph' });
  await signInAsGm(page);
  await openSystem(page, name);
  await toGraph(page);
  const map = page.getByTestId('graph-view');

  // A, a word, Enter: a table, in view, its panel open to name it.
  await page.mouse.click(5, 5);
  await page.keyboard.press('a');
  const search = page.getByRole('dialog', { name: 'Add a node' });
  await search.getByLabel('Add a node: type to search').fill('table');
  await page.keyboard.press('Enter');
  const added = map.getByTestId('graph-node-table:new_table');
  await expect(added).toBeVisible();
  const box = (await added.boundingBox())!;
  const area = (await page.getByTestId('graph-map').boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(area.x);
  expect(box.y).toBeGreaterThanOrEqual(area.y);
  expect(box.x + box.width / 2).toBeLessThanOrEqual(area.x + area.width);
  await expect(page.getByTestId('graph-panel')).toHaveAttribute('aria-label', 'TABLE NEW TABLE');

  // Delete takes it away; Ctrl+Z brings it back.
  await page.getByTestId('graph-panel').getByRole('button', { name: 'Close the panel' }).click();
  await added.click();
  await page.mouse.move(area.x + 5, area.y + area.height - 40);
  await page.keyboard.press('Delete');
  await expect(added).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(added).toBeVisible();
});

test('a condition added with A, written IF, THEN and ELSE in its panel, a wire into it asking to compare, and the same in FORMS', async ({ page, request }, info) => {
  const name = `Condition Map ${info.retry + 1}`;
  const token = await gmToken(request);
  await asGm(request, token, 'post', '/api/systems', { definition: HEARTH(name) });
  await asGm(request, token, 'put', '/api/systems/view', { page: 'rules', view: 'graph' });
  await signInAsGm(page);
  await openSystem(page, name);
  await toGraph(page);
  const map = page.getByTestId('graph-view');
  const panel = page.getByTestId('graph-panel');

  // A, CONDITION: comparing the first stat, its panel open.
  await page.mouse.click(5, 5);
  await page.keyboard.press('a');
  await page.getByLabel('Add a node: type to search').fill('condition');
  await page.keyboard.press('Enter');
  const node = map.getByTestId('graph-node-new_condition');
  await expect(node).toBeVisible();
  await expect(panel).toHaveAttribute('aria-label', 'CONDITION NEW CONDITION');
  await expect(panel.getByLabel('New condition if')).toHaveValue('@lvl > 0');

  // Written: the node and its value follow (level 3 on the sample).
  await panel.getByLabel('New condition if').fill('@lvl > 2');
  await panel.getByLabel('New condition then').fill('@str_mod + 1');
  await expect(node).toContainText('IF LEVEL > 2');
  await expect(node.locator('[data-value]')).toHaveText('2');
  await expect(map.getByTestId('rf__edge-abilities:out:str_mod>new_condition:b:@str_mod')).toHaveCount(1);

  // A wire dragged into it: nothing changed, the panel says to compare it in IF.
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'FIT', exact: true }).click();
  const from = (await map.getByTestId('graph-node-abilities').locator('[data-handleid="out:dex"]').boundingBox())!;
  const onto = (await node.boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(onto.x + onto.width / 2, onto.y + onto.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(map.getByRole('status')).toHaveText("A condition compares: add DEXTERITY to NEW CONDITION's IF in the panel, and say how it compares (@dex > 2).");
  await expect(panel).toHaveAttribute('aria-label', 'CONDITION NEW CONDITION');
  await expect(panel.getByLabel('New condition if')).toHaveValue('@lvl > 2');

  // FORMS: the same three boxes, the same value.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('save-status')).toHaveText(/· SAVED /, { timeout: 15_000 });
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'FORMS' }).click();
  await page.getByRole('tab', { name: 'FORMULAS' }).click();
  await expect(page.getByLabel('New condition if')).toHaveValue('@lvl > 2');
  await expect(page.getByLabel('New condition then')).toHaveValue('@str_mod + 1');
  await expect(page.getByLabel('New condition else')).toHaveValue('0');
  await expect(page.getByTestId('value-new_condition')).toHaveText('2');
});

test('PROBLEMS on the map: a broken formula drawn red, picked from the list, fixed in its panel, and gone once saved', async ({ page, request }, info) => {
  const name = `Problem Map ${info.retry + 1}`;
  const token = await gmToken(request);
  const broken = HEARTH(name);
  broken.derived[3] = { id: 'save', label: 'Physical save', formula: '16 - (@lvl + nothing(@dex))' };
  await asGm(request, token, 'post', '/api/systems', { definition: broken });
  await asGm(request, token, 'put', '/api/systems/view', { page: 'rules', view: 'graph' });
  await signInAsGm(page);
  await openSystem(page, name);
  await toGraph(page);
  const map = page.getByTestId('graph-view');
  const box = map.getByTestId('graph-problems');

  // Counted, the node drawn red, and listed in players' names when opened.
  const head = box.getByRole('button', { name: /PROBLEMS/ });
  await expect(head).toContainText('1 ✕');
  expect(await map.locator('.react-flow__node[data-id="save"]').evaluate((el) => (el as HTMLElement).style.outline)).toBe('2px solid var(--danger)');
  await head.click();
  const item = box.getByRole('button', { name: /PHYSICAL SAVE/ });
  await expect(item).toContainText('nothing');

  // Picked: its panel opens and the map moves to it.
  // Zoomed out and slid away first, so picking it has to bring it back.
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await item.click();
  const panel = page.getByTestId('graph-panel');
  await expect(panel).toHaveAttribute('aria-label', 'FORMULA PHYSICAL SAVE');
  await expect(map.getByTestId('graph-node-save')).toBeInViewport();

  // Fixed there: once saved, no problems, and the red is gone.
  await panel.getByLabel('Physical save formula').fill('16 - (@lvl + @dex_mod)');
  await expect(page.getByTestId('save-status')).toHaveText(/· SAVED /, { timeout: 15_000 });
  await expect(head).toContainText('0 ✕');
  await expect(box).toContainText('No problems. It can be published.');
  expect(await map.locator('.react-flow__node[data-id="save"]').evaluate((el) => (el as HTMLElement).style.outline)).not.toContain('danger');
});

test("TRY ON THE MAP swaps a house rule's formulas in for the map's numbers only, never saved", async ({ page, request }, info) => {
  const name = `Try Map ${info.retry + 1}`;
  const token = await gmToken(request);
  const def = HEARTH(name);
  const magic = { ...def, house_rules: [{ id: 'magic', name: 'Magic', description: 'Characters can learn spells.' }],
    derived: def.derived.map((d) => (d.id === 'melee' ? { ...d, alternative: { rule: 'magic', formula: '@dex_mod + @lvl' } } : d)) };
  await asGm(request, token, 'post', '/api/systems', { definition: magic });
  await asGm(request, token, 'put', '/api/systems/view', { page: 'rules', view: 'graph' });
  await signInAsGm(page);
  await openSystem(page, name);
  await toGraph(page);
  const map = page.getByTestId('graph-view');
  const melee = map.getByTestId('graph-node-melee');
  const sw = map.getByTestId('graph-node-rule:magic').getByRole('switch', { name: 'Try on the map' });

  // Off: STR MOD 1 + half of LEVEL 3 is 2; the WITH MAGIC formula waits.
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await expect(melee.locator('[data-value]')).toHaveText('2');
  await expect(melee.locator('[data-in-use]')).toHaveText('NOT IN USE');
  // The wire into the formula in use solid, the other faint.
  const faint = (id: string) => map.getByTestId(`rf__edge-${id}`).locator('.react-flow__edge-path').evaluate((p) => (p as SVGPathElement).style.opacity === '0.4');
  const own = 'abilities:out:str_mod>melee:b:@str_mod';
  const withMagic = 'abilities:out:dex_mod>melee:a:@dex_mod';
  expect([await faint(own), await faint(withMagic)]).toEqual([false, true]);

  // On: DEX MOD 0 + LEVEL 3, by the server's engine; said along the bottom.
  await sw.click();
  await page.mouse.move(5, 5);
  await expect(sw).toHaveAttribute('aria-checked', 'true');
  await expect(melee.locator('[data-value]')).toHaveText('3');
  await expect(melee.locator('[data-in-use]')).toHaveText('IN USE');
  expect([await faint(own), await faint(withMagic)]).toEqual([true, false]);
  await expect(map.getByTestId('graph-trying')).toHaveText('TRYING MAGIC · THE MAP ONLY');
  await expect(page.getByTestId('save-status')).not.toContainText('UNSAVED');

  // Never saved: FORMS still works the formula out its own way, and the map opens with it off.
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'FORMS' }).click();
  await page.getByRole('tab', { name: 'FORMULAS' }).click();
  await expect(page.getByTestId('value-melee')).toHaveText('2');
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'GRAPH' }).click();
  await expect(sw).toHaveAttribute('aria-checked', 'false');
  await expect(melee.locator('[data-value]')).toHaveText('2');
});

test('hovering a node lights what it reads and what reads it, its wires cyan, and fades the rest', async ({ page, request }, info) => {
  const name = `Hover Map ${info.retry + 1}`;
  const token = await gmToken(request);
  await asGm(request, token, 'post', '/api/systems', { definition: HEARTH(name) });
  await asGm(request, token, 'put', '/api/systems/view', { page: 'rules', view: 'graph' });
  await signInAsGm(page);
  await openSystem(page, name);
  await toGraph(page);
  const map = page.getByTestId('graph-view');
  const opacity = (id: string) => map.locator(`.react-flow__node[data-id="${id}"]`).evaluate((el) => (el as HTMLElement).style.opacity);
  const wire = (id: string) => map.getByTestId(`rf__edge-${id}`).locator('.react-flow__edge-path').evaluate((p) => ({ stroke: (p as SVGPathElement).style.stroke, opacity: (p as SVGPathElement).style.opacity }));

  // MELEE reads STR MOD and LEVEL; the save reads them too, but only shares them, so it fades.
  await map.getByTestId('graph-node-melee').hover();
  await expect.poll(() => opacity('save')).toBe('0.16');
  for (const id of ['melee', 'abilities', 'character', 'table:attribute_mod']) expect(await opacity(id), id).toBe('');
  expect(await wire('abilities:out:str_mod>melee:b:@str_mod')).toEqual({ stroke: 'var(--cyan)', opacity: '1' });
  expect((await wire('character:out:lvl>save:b:@lvl')).opacity).toBe('0.16');

  // The pointer away: everything back.
  await page.mouse.move(5, 5);
  await expect.poll(() => opacity('save')).toBe('');
  expect((await wire('abilities:out:str_mod>melee:b:@str_mod')).stroke).not.toBe('var(--cyan)');
});

test("the map's own groups: a formula grouped from its panel, the group named from its title bar, shown in FORMS, ungrouped", async ({ page, request }, info) => {
  const name = `Grouped Map ${info.retry + 1}`;
  const token = await gmToken(request);
  await asGm(request, token, 'post', '/api/systems', { definition: HEARTH(name) });
  await asGm(request, token, 'put', '/api/systems/view', { page: 'rules', view: 'graph' });
  await signInAsGm(page);
  await openSystem(page, name);
  await toGraph(page);
  const map = page.getByTestId('graph-view');
  const panel = page.getByTestId('graph-panel');

  // The save into a new group: a box round it with NEW GROUP on its title bar.
  await map.getByTestId('graph-node-save').click();
  await panel.getByLabel('Map group').selectOption({ label: '+ NEW GROUP' });
  const group = map.getByTestId('graph-group-group_1');
  await expect(group).toContainText('NEW GROUP');

  // Its title bar opens its panel: named there, the title bar follows.
  await page.keyboard.press('Escape');
  await group.locator('.graph-group-head').click({ position: { x: 120, y: 10 } });
  await expect(panel).toHaveAttribute('aria-label', 'MAP GROUP NEW GROUP');
  await panel.getByLabel('Group name').fill('DEFENCE');
  await expect(group).toContainText('DEFENCE');

  // FORMS: read only under the formula, and EDIT IN GRAPH back to the group's panel.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('save-status')).toHaveText(/· SAVED /, { timeout: 15_000 });
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'FORMS' }).click();
  await page.getByRole('tab', { name: 'FORMULAS' }).click();
  await expect(page.getByTestId('forms-group-save')).toContainText('DEFENCE');
  await page.getByRole('button', { name: 'Edit DEFENCE in graph' }).click();
  await expect(panel).toHaveAttribute('aria-label', 'MAP GROUP DEFENCE');

  // MELEE joins it, from its own column; LINE UP stacks the two, left edges even, MELEE under the save or above it.
  await page.keyboard.press('Escape');
  await map.getByTestId('graph-node-melee').click();
  await panel.getByLabel('Map group').selectOption({ label: 'DEFENCE' });
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'FIT', exact: true }).click();
  await group.locator('.graph-group-head').click({ position: { x: 120, y: 10 } });
  await panel.getByRole('button', { name: 'LINE UP' }).click();
  const box = async (id: string) => (await map.getByTestId(`graph-node-${id}`).boundingBox())!;
  await expect.poll(async () => Math.round((await box('melee')).x - (await box('save')).x)).toBe(0);
  const [a, b] = [await box('save'), await box('melee')].sort((p, q) => p.y - q.y);
  expect(b.y).toBeGreaterThan(a.y + a.height);

  // Ungrouped: the box goes, the save stays.
  await panel.getByRole('button', { name: 'UNGROUP' }).click();
  await expect(group).toHaveCount(0);
  await expect(map.getByTestId('graph-node-save')).toBeVisible();
});

test('a note pinned to the node picked, written, dragged to another, unpinned, and read in FORMS', async ({ page, request }, info) => {
  const name = `Noted Map ${info.retry + 1}`;
  const token = await gmToken(request);
  await asGm(request, token, 'post', '/api/systems', { definition: HEARTH(name) });
  await asGm(request, token, 'put', '/api/systems/view', { page: 'rules', view: 'graph' });
  await signInAsGm(page);
  await openSystem(page, name);
  await toGraph(page);
  const map = page.getByTestId('graph-view');
  const panel = page.getByTestId('graph-panel');

  // MELEE picked, A, NOTE: a note beside it on a dashed line, its panel open to write it.
  await map.getByTestId('graph-node-melee').click();
  await page.keyboard.press('a');
  await page.getByLabel('Add a node: type to search').fill('note');
  await page.keyboard.press('Enter');
  const note = map.getByTestId('graph-node-note:n1');
  await expect(note).toBeVisible();
  await expect(panel).toHaveAttribute('aria-label', 'NOTE ON MELEE ATTACK');
  await expect(map.getByTestId('rf__edge-note:n1>melee')).toHaveCount(1);
  await panel.getByLabel('Note').fill('Half level, rounded down.');
  await expect(note).toContainText('Half level, rounded down.');

  // Its square dot dragged onto the save: pinned there instead.
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'FIT', exact: true }).click();
  const dot = (await note.locator('.react-flow__handle').boundingBox())!;
  const save = (await map.getByTestId('graph-node-save').boundingBox())!;
  await page.mouse.move(dot.x + dot.width / 2, dot.y + dot.height / 2);
  await page.mouse.down();
  await page.mouse.move(save.x + save.width / 2, save.y + save.height / 2, { steps: 12 });
  await page.mouse.up();
  await expect(map.getByRole('status')).toHaveText('Note pinned to PHYSICAL SAVE.');
  await expect(map.getByTestId('rf__edge-note:n1>save')).toHaveCount(1);
  await expect(map.getByTestId('rf__edge-note:n1>melee')).toHaveCount(0);

  // Its line cut, asked first: unpinned, its words kept.
  const line = await map.getByTestId('rf__edge-note:n1>save').locator('.react-flow__edge-path').evaluate((p) => {
    const path = p as SVGPathElement;
    // Just past the note's own dot, clear of the node it is pinned to.
    const at = path.getPointAtLength(16);
    const m = path.getScreenCTM()!;
    return { x: at.x * m.a + at.y * m.c + m.e, y: at.x * m.b + at.y * m.d + m.f };
  });
  await page.mouse.click(line.x, line.y);
  const ask = page.getByRole('dialog', { name: 'Cut this wire?' });
  await expect(ask).toContainText('A note pinned to PHYSICAL SAVE: cutting unpins it');
  await ask.getByRole('button', { name: 'CUT' }).click();
  await expect(map.getByTestId('rf__edge-note:n1>save')).toHaveCount(0);
  await expect(map.locator('.react-flow__edge')).toHaveCount(WIRES);
  await expect(note).toContainText('Half level, rounded down.');

  // Pinned again from its panel, then read in FORMS under MELEE, with EDIT IN GRAPH back to it.
  await note.click();
  await expect(panel).toHaveAttribute('aria-label', 'NOTE NOT PINNED');
  await panel.getByLabel('Pinned to').selectOption({ label: 'MELEE ATTACK' });
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('save-status')).toHaveText(/· SAVED /, { timeout: 15_000 });
  await page.getByRole('group', { name: 'View' }).getByRole('button', { name: 'FORMS' }).click();
  await page.getByRole('tab', { name: 'FORMULAS' }).click();
  const read = page.getByTestId('forms-note-n1');
  await expect(read).toContainText('Half level, rounded down.');
  await read.getByRole('button', { name: 'EDIT IN GRAPH' }).click();
  await expect(panel).toHaveAttribute('aria-label', 'NOTE ON MELEE ATTACK');
  await expect(panel.getByLabel('Note')).toHaveValue('Half level, rounded down.');
});

test('a busy system lays out to be read: dots on their rows, every wire drawn, nothing overlapping, a readable zoom', async ({ page, request }, info) => {
  const name = `Busy Map ${info.retry + 1}`;
  const token = await gmToken(request);
  await asGm(request, token, 'post', '/api/systems', { name, example: 'cwn' });
  await asGm(request, token, 'put', '/api/systems/view', { page: 'rules', view: 'graph' });
  await signInAsGm(page);
  await openSystem(page, name);
  await toGraph(page);
  await page.waitForTimeout(1000);

  // Opens at a zoom that can be read (all of it, if it fits that way).
  expect(Number((await page.getByTestId('graph-zoom').textContent())!.replace('%', ''))).toBeGreaterThanOrEqual(80);

  // Every wire the system has is drawn: the status line counts them from the system itself.
  const counted = Number((await page.getByTestId('graph-status').textContent())!.match(/(\d+) WIRES/)![1]);
  expect(counted).toBeGreaterThan(10);
  await expect(page.locator('.react-flow__edge')).toHaveCount(counted);

  const geometry = await page.evaluate(() => {
    const out = { offRow: [] as string[], overlaps: [] as string[], emptyWires: 0 };
    const nodes = [...document.querySelectorAll('[data-testid^="graph-node-"]')] as HTMLElement[];
    for (const box of nodes) {
      const scale = box.getBoundingClientRect().height / box.offsetHeight;
      const rows = ([...box.children] as HTMLElement[]).filter((c) => c.tagName === 'DIV' && !c.classList.contains('react-flow__handle'));
      const centres = rows.map((r) => { const b = r.getBoundingClientRect(); return b.top + b.height / 2; });
      for (const h of box.querySelectorAll('.react-flow__handle')) {
        if (getComputedStyle(h).opacity === '0' || (h as HTMLElement).dataset.handleid === 'note') continue;
        const hb = h.getBoundingClientRect();
        const y = hb.top + hb.height / 2;
        const near = Math.min(...centres.map((c) => Math.abs(c - y))) / scale;
        if (near > 1.5) out.offRow.push(`${box.dataset.testid} ${(h as HTMLElement).dataset.handleid}`);
      }
    }
    const shown = nodes.filter((n) => n.offsetParent !== null).map((n) => ({ id: n.dataset.testid!, r: n.getBoundingClientRect() }));
    for (const a of shown) for (const b of shown) {
      if (a.id >= b.id) continue;
      const apart = a.r.right <= b.r.left + 0.5 || b.r.right <= a.r.left + 0.5 || a.r.bottom <= b.r.top + 0.5 || b.r.bottom <= a.r.top + 0.5;
      if (!apart) out.overlaps.push(`${a.id} / ${b.id}`);
    }
    out.emptyWires = [...document.querySelectorAll('.react-flow__edge-path')].filter((p) => !(p.getAttribute('d') ?? '').trim()).length;
    return out;
  });
  expect(geometry).toEqual({ offRow: [], overlaps: [], emptyWires: 0 });
});

test('a wire going backwards stays out of the nodes it joins', async ({ page, request }, info) => {
  const name = `Backwards ${info.retry + 1}`;
  const token = await gmToken(request);
  await asGm(request, token, 'post', '/api/systems', { definition: HEARTH(name) });
  await asGm(request, token, 'put', '/api/systems/view', { page: 'rules', view: 'graph' });
  await signInAsGm(page);
  await openSystem(page, name);
  await toGraph(page);

  // The table dragged past the list it feeds, at its height. FIT first: dragged near the map's edge,
  // a node carries on as the map scrolls along with it.
  await page.getByRole('button', { name: 'FIT', exact: true }).click();
  await page.waitForTimeout(400);
  const list = (await page.getByTestId('graph-node-abilities').boundingBox())!;
  const table = (await page.getByTestId('graph-node-table:attribute_mod').boundingBox())!;
  await drag(page, 'table:attribute_mod', list.x + list.width + 120 - table.x, 0);
  // Really past it, or there is no backwards wire to test.
  const moved = (await page.getByTestId('graph-node-table:attribute_mod').boundingBox())!;
  expect(moved.x).toBeGreaterThan(list.x + list.width);
  expect(Math.abs(moved.y - table.y)).toBeLessThan(30);

  const crossings = await page.evaluate(() => {
    const rect = (id: string) => {
      const el = document.querySelector(`.react-flow__node[data-id="${id}"]`) as HTMLElement;
      const [x, y] = (el.style.transform.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);
      return { x, y, w: el.offsetWidth, h: el.offsetHeight };
    };
    const path = document.querySelector('[data-testid="rf__edge-table:attribute_mod:out>abilities:via"] .react-flow__edge-path')!.getAttribute('d')!;
    // M x y, then H and V steps: the points it passes through.
    const points: [number, number][] = [];
    let cx = 0, cy = 0;
    for (const m of path.matchAll(/([MHVL])\s*(-?[\d.]+)(?:[ ,]+(-?[\d.]+))?/g)) {
      if (m[1] === 'M' || m[1] === 'L') { cx = Number(m[2]); cy = Number(m[3]); } else if (m[1] === 'H') cx = Number(m[2]); else cy = Number(m[2]);
      points.push([cx, cy]);
    }
    const inside = (r: { x: number; y: number; w: number; h: number }, x: number, y: number) => x > r.x + 2 && x < r.x + r.w - 2 && y > r.y + 2 && y < r.y + r.h - 2;
    const hits: string[] = [];
    for (const [id, r] of [['table', rect('table:attribute_mod')], ['abilities', rect('abilities')]] as const) {
      for (let i = 1; i < points.length; i += 1) {
        const [x1, y1] = points[i - 1], [x2, y2] = points[i];
        for (let k = 1; k < 20; k += 1) {
          const x = x1 + ((x2 - x1) * k) / 20, y = y1 + ((y2 - y1) * k) / 20;
          if (inside(r, x, y)) { hits.push(`${id} at ${Math.round(x)},${Math.round(y)}`); break; }
        }
      }
    }
    return { points: points.length, hits };
  });
  expect(crossings.points).toBeGreaterThanOrEqual(5);
  expect(crossings.hits).toEqual([]);
});

test('the map takes every theme\'s colors', async ({ page, request }, info) => {
  const name = `Themed ${info.retry + 1}`;
  const token = await gmToken(request);
  await asGm(request, token, 'post', '/api/systems', { definition: HEARTH(name) });
  await asGm(request, token, 'put', '/api/systems/view', { page: 'rules', view: 'graph' });
  await signInAsGm(page);
  await openSystem(page, name);
  await toGraph(page);

  const colors = await page.evaluate(async () => {
    const root = document.querySelector('.crt-container') as HTMLElement;
    const themes = ['classic', 'vaporwave', 'cyberpunk', 'crimson', 'ocean', 'solar', 'monochrome'];
    const out: Record<string, { same: boolean; green: string }> = {};
    for (const theme of themes) {
      root.className = root.className.replace(/theme-\S+/, `theme-${theme}`);
      await new Promise((r) => requestAnimationFrame(() => r(null)));
      // A probe in the theme, drawn with the same colors the map asks for.
      const probe = document.createElement('div');
      document.querySelector('[data-testid="graph-view"]')!.appendChild(probe);
      probe.style.color = 'var(--green)';
      const green = getComputedStyle(probe).color;
      probe.style.color = 'color-mix(in srgb, var(--green) 75%, transparent)';
      const wire = getComputedStyle(probe).color;
      probe.remove();
      const node = document.querySelector('[data-testid="graph-node-save"]') as HTMLElement;
      const dot = node.querySelector('.react-flow__handle.source') as HTMLElement;
      const name = node.querySelector('b') as HTMLElement;
      const path = document.querySelector('[data-testid="rf__edge-character:out:lvl>save:b:@lvl"] .react-flow__edge-path') as SVGPathElement;
      out[theme] = {
        same: getComputedStyle(node).borderTopColor === green && getComputedStyle(dot).backgroundColor === green
          && getComputedStyle(name).color === green && getComputedStyle(path).stroke === wire,
        green,
      };
    }
    return out;
  });
  for (const [theme, c] of Object.entries(colors)) expect(c.same, theme).toBe(true);
  // And the themes really differ: nothing stuck in Classic green.
  expect(new Set(Object.values(colors).map((c) => c.green)).size).toBe(7);
});
