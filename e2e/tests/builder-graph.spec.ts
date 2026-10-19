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
