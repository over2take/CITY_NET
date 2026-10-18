/**
 * The GRAPH view as logic (5a2). Approved mockup builder-graph (2026-10-17): a system read as nodes,
 * wires and groups, where wires are what each formula reads (never stored), laid out in columns on
 * a 24px grid, the map's moves written back into the definition's `graph` section, and folded
 * groups standing in for their members. Held to the server's own formula reader (expression.js)
 * and its own check (definition.js), over random systems and every built-in example.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import {
  referencesIn, graphOf, heightOf, columnsOf, layoutOf, positionsOf, savedPositions, withPositions, withCollapsed,
  groupBoxOf, shownWires, foldedHeight, GRID, REACH, SIZE, type Graph, type GraphNode,
} from '../graphModel';
import type { Definition } from '../systemsApi';

const req = createRequire(import.meta.url);
const { checkDefinition } = req('../../../../backend/systemBuilder/definition.js');
const { parse, references } = req('../../../../backend/systemBuilder/expression.js');
const { LIMITS: GRAPH_LIMITS } = req('../../../../backend/systemBuilder/graph.js');
const { EXAMPLES } = req('../../../../backend/systemBuilder/examples.js');
const { randomSystem } = req('../../../../backend/__tests__/helpers/randomSystem.js');

const problems = (def: Definition) => checkDefinition(def).problems.map((p: { where: string; message: string }) => `${p.where}: ${p.message}`);

/** HEARTH, as the mockup draws it: abilities and a level, a table, modifiers in a map group, a house rule, a note. */
const HEARTH: Definition = {
  format: 1,
  name: 'Hearth',
  stats: [
    { id: 'character', label: 'CHARACTER', stats: [{ id: 'lvl', label: 'Level', min: 1, max: 10 }] },
    { id: 'abilities', label: 'ABILITIES', stats: [{ id: 'str', label: 'Strength', min: 3, max: 18 }, { id: 'wit', label: 'Wits', min: 3, max: 18 }] },
    { id: 'skills', label: 'SKILLS', stats: [{ id: 'fight', label: 'Fight', min: 0, max: 4, tie: 'str' }] },
  ],
  lookups: { attribute_mod: { label: 'ATTRIBUTE MOD', bands: [{ upTo: 13, value: 0 }, { value: 1 }] } },
  derived: [
    { id: 'str_mod', label: 'STR MOD', formula: 'attribute_mod(@str)' },
    { id: 'wit_mod', label: 'WIT MOD', formula: 'attribute_mod(@wit)' },
    { id: 'melee', label: 'Melee attack', formula: '@str_mod + @fight + floor(@lvl / 2) + @cash' },
    { id: 'spell', label: 'Spell power', formula: '0', alternative: { rule: 'magic', formula: '@wit_mod + @lvl' } },
    { id: 'can_cast', label: 'Can cast', kind: 'condition', when: '@spell > 2', then: '1', else: '0' },
  ],
  house_rules: [{ id: 'magic', name: 'MAGIC', description: 'Characters can learn spells.' }],
  graph: {
    groups: [{ id: 'mods', label: 'MODIFIERS', members: ['str_mod', 'wit_mod'] }],
    collapsed: ['mods'],
    notes: [{ id: 'n1', on: 'melee', text: 'Half level, rounded down: the 2nd printing.' }],
  },
};
const node = (g: Graph, id: string): GraphNode => g.nodes.find((n) => n.id === id)!;
const wiresInto = (g: Graph, id: string) => g.wires.filter((w) => w.to === id).map((w) => `${w.from} ${w.kind}${w.alt ? ' alt' : ''}`);

const randoms = Array.from({ length: 60 }, (_, i) => randomSystem(i + 1) as Definition);
const examples = (EXAMPLES as { id: string; definition: Definition }[]).map((e) => e.definition);

describe('what a formula reads', () => {
  it('finds @fields, tables and $rules, each once, in the order read', () => {
    expect(referencesIn('attribute_mod(@str) + max(@dex, @str) * $cwn_armor_soak + not(@x) + floor (@y)')).toEqual({
      fields: ['str', 'dex', 'x', 'y'], tables: ['attribute_mod'], rules: ['cwn_armor_soak'],
    });
    expect(referencesIn('if(@a > 1 and @b, band (@c), 0)')).toEqual({ fields: ['a', 'b', 'c'], tables: ['band'], rules: [] });
    expect(referencesIn(undefined)).toEqual({ fields: [], tables: [], rules: [] });
  });

  it('reads every formula the way the server does, over random systems and every example', () => {
    let read = 0;
    for (const def of [...randoms, ...examples]) {
      for (const d of (Array.isArray(def.derived) ? def.derived : []) as Record<string, unknown>[]) {
        const alt = d.alternative as { formula?: string } | undefined;
        for (const text of [d.formula, d.when, d.then, d.else, alt?.formula]) {
          if (typeof text !== 'string') continue;
          const server = references(parse(text, () => true));
          expect(referencesIn(text), text).toEqual({ fields: [...server.fields], tables: [...server.tables], rules: [...server.rules] });
          read += 1;
        }
      }
    }
    expect(read).toBeGreaterThan(200);
  });
});

describe('the system as nodes and wires', () => {
  const g = graphOf(HEARTH);

  it('has a node for every stat, house rule, table, formula, condition and note', () => {
    expect(g.nodes.map((n) => `${n.kind} ${n.id}`)).toEqual([
      'stat lvl', 'stat str', 'stat wit', 'stat fight', 'rule rule:magic', 'table table:attribute_mod',
      'formula str_mod', 'formula wit_mod', 'formula melee', 'formula spell', 'condition can_cast', 'note note:n1',
    ]);
    expect(node(g, 'fight').text).toBe('TIED TO str');
    expect(node(g, 'can_cast').text).toBe('IF @spell > 2 THEN 1 ELSE 0');
    expect(node(g, 'table:attribute_mod').bands).toEqual([{ upTo: 13, value: 0 }, { upTo: null, value: 1 }]);
  });

  it('wires each name a formula reads from where it comes from; a sheet field or $rule is a row with no wire', () => {
    expect(node(g, 'melee').inputs.map((i) => `${i.kind} ${i.name} ${i.source}`)).toEqual([
      'value str_mod str_mod', 'value fight fight', 'value lvl lvl', 'field cash null',
    ]);
    expect(wiresInto(g, 'melee')).toEqual(['str_mod value', 'fight value', 'lvl value', 'note:n1 note']);
    expect(wiresInto(g, 'str_mod')).toEqual(['str value', 'table:attribute_mod table']);
    expect(wiresInto(g, 'can_cast')).toEqual(['spell value']);
  });

  it('wires a house rule to the formulas it swaps, and their alternatives\' inputs as alternatives', () => {
    expect(node(g, 'spell').alternative).toEqual({ rule: 'magic', text: '@wit_mod + @lvl' });
    expect(wiresInto(g, 'spell')).toEqual(['wit_mod value alt', 'lvl value alt', 'rule:magic gate alt']);
  });

  it('lists what else waits on a house rule, on other pages', () => {
    const def = { ...HEARTH, conditions: { hexed: { only_with: 'magic' } } };
    expect(node(graphOf(def), 'rule:magic').also).toEqual(['hexed · CONDITION']);
  });

  it('groups the stats by their groups, and formulas by the map\'s own', () => {
    expect(g.groups).toEqual([
      { id: 'character', label: 'CHARACTER', kind: 'stats', members: ['lvl'], collapsed: false },
      { id: 'abilities', label: 'ABILITIES', kind: 'stats', members: ['str', 'wit'], collapsed: false },
      { id: 'skills', label: 'SKILLS', kind: 'stats', members: ['fight'], collapsed: false },
      { id: 'mods', label: 'MODIFIERS', kind: 'map', members: ['str_mod', 'wit_mod'], collapsed: true },
    ]);
    expect(node(g, 'str_mod').group).toBe('mods');
    expect(node(g, 'str').group).toBe('abilities');
  });

  it('sizes each node from what it shows', () => {
    expect(node(g, 'str').height).toBe(SIZE.header + SIZE.row + SIZE.border);
    expect(node(g, 'melee').height).toBe(SIZE.header + SIZE.text + 4 * SIZE.row + SIZE.pad + SIZE.border);
    expect(node(g, 'spell').height).toBe(SIZE.header + SIZE.text + SIZE.row + SIZE.text + 2 * SIZE.row + SIZE.pad + SIZE.border);
    expect(node(g, 'note:n1').width).toBe(SIZE.noteWidth);
    for (const n of g.nodes) expect(n.height).toBe(heightOf(n));
  });

  it('leaves out what the layout names but FORMS has since deleted', () => {
    const def = {
      ...HEARTH,
      graph: {
        positions: { gone: [0, 0], str: [48, 48] },
        groups: [{ id: 'mods', label: 'MODIFIERS', members: ['gone', 'str_mod'] }, { id: 'mods', label: 'AGAIN', members: ['wit_mod'] }, { id: 'more', label: 'MORE', members: ['str_mod'] }],
        notes: [{ id: 'n1', on: 'gone', text: 'Pinned to nothing now.' }],
      },
    };
    const lost = graphOf(def);
    expect(lost.groups.filter((x) => x.kind === 'map')).toEqual([
      { id: 'mods', label: 'MODIFIERS', kind: 'map', members: ['str_mod'], collapsed: false },
      { id: 'more', label: 'MORE', kind: 'map', members: [], collapsed: false },
    ]);
    expect(node(lost, 'note:n1').on).toBeUndefined();
    expect(lost.wires.some((w) => w.from === 'note:n1')).toBe(false);
    expect(Object.keys(savedPositions(def, lost))).toEqual(['str']);
  });

  it('every wire joins two nodes on the map, and every input with a source has its wire, for any system', () => {
    for (const def of [...randoms, ...examples]) {
      const graph = graphOf(def);
      const ids = new Set(graph.nodes.map((n) => n.id));
      for (const w of graph.wires) { expect(ids.has(w.from)).toBe(true); expect(ids.has(w.to)).toBe(true); }
      for (const n of graph.nodes) for (const i of n.inputs) if (i.source) expect(graph.wires.some((w) => w.to === n.id && w.input === i.key)).toBe(true);
    }
  });
});

describe('laying it out', () => {
  const g = graphOf(HEARTH);

  it('puts stats first, tables and house rules next, each formula right of what it reads, a note beside its node', () => {
    expect(columnsOf(g)).toEqual({
      lvl: 0, str: 0, wit: 0, fight: 0, 'rule:magic': 1, 'table:attribute_mod': 1,
      str_mod: 1, wit_mod: 1, melee: 2, spell: 2, can_cast: 3, 'note:n1': 3,
    });
  });

  it('places everything on the grid, and nothing in a column overlaps, for any system', () => {
    for (const def of [HEARTH, ...randoms, ...examples]) {
      const graph = graphOf(def);
      const pos = layoutOf(graph);
      expect(Object.keys(pos).sort()).toEqual(graph.nodes.map((n) => n.id).sort());
      const folded = new Set(graph.groups.filter((x) => x.collapsed).flatMap((x) => x.members));
      const shown = graph.nodes.filter((n) => !folded.has(n.id));
      for (const n of graph.nodes) { expect(pos[n.id].x % GRID).toBe(0); expect(pos[n.id].y % GRID).toBe(0); }
      for (const a of shown) {
        for (const b of shown) {
          if (a === b || pos[a.id].x !== pos[b.id].x) continue;
          const apart = pos[a.id].y + a.height <= pos[b.id].y || pos[b.id].y + b.height <= pos[a.id].y;
          expect(apart, `${a.id} and ${b.id}`).toBe(true);
        }
      }
    }
  });

  it('keeps a loop from hanging the layout', () => {
    const def: Definition = { format: 1, name: 'Loop', derived: [{ id: 'a', formula: '@b' }, { id: 'b', formula: '@a' }] };
    expect(columnsOf(graphOf(def))).toEqual({ a: 3, b: 2 });
  });
});

describe('where things sit, and writing it back', () => {
  const g = graphOf(HEARTH);

  it('lays everything out the first time the map opens', () => {
    expect(positionsOf(HEARTH, g)).toEqual(layoutOf(g));
  });

  it('keeps every place once anything has moved, inside the server\'s reach, on the grid', () => {
    const moved = withPositions(HEARTH, g, { melee: { x: 1000, y: 13 }, str: { x: REACH + 500, y: -REACH - 500 } });
    expect(problems(moved)).toEqual([]);
    const places = (moved.graph as { positions: Record<string, [number, number]> }).positions;
    expect(Object.keys(places).sort()).toEqual(g.nodes.map((n) => n.id).sort());
    expect(places.melee).toEqual([1008, 24]);
    expect(places.str).toEqual([REACH, -REACH]);
    expect(REACH).toBe(GRAPH_LIMITS.reach);
    // and the layout's other parts are kept
    expect((moved.graph as Record<string, unknown>).notes).toEqual((HEARTH.graph as Record<string, unknown>).notes);
  });

  it('drops places of what is no longer on the map when it writes', () => {
    const def = { ...HEARTH, graph: { ...(HEARTH.graph as object), positions: { gone: [0, 0], str: [48, 48] } } };
    const places = (withPositions(def, graphOf(def)).graph as { positions: Record<string, unknown> }).positions;
    expect(places.gone).toBeUndefined();
    expect(places.str).toEqual([48, 48]);
    const stray = (withPositions(def, graphOf(def), { nowhere: { x: 0, y: 0 } }).graph as { positions: Record<string, unknown> }).positions;
    expect(stray.nowhere).toBeUndefined();
  });

  it('puts a node added since under what is in its column, leaving the rest where it was', () => {
    // Melee moved well down first: a new node goes under it, not where a fresh layout would put it.
    const placed = withPositions(HEARTH, g, { melee: { x: layoutOf(g).melee.x, y: 960 } });
    const more = { ...placed, derived: [...(placed.derived as unknown[]), { id: 'defense', label: 'Defense', formula: '10 + @str_mod' }] };
    const graph = graphOf(more);
    const pos = positionsOf(more, graph);
    expect(pos.melee).toEqual(positionsOf(placed, g).melee);
    const column = graph.nodes.filter((n) => columnsOf(graph)[n.id] === 2 && n.id !== 'defense');
    expect(pos.defense.x).toBe(pos.melee.x);
    expect(pos.defense.y).toBeGreaterThanOrEqual(960 + node(g, 'melee').height);
    expect(pos.defense.y).toBeGreaterThanOrEqual(Math.max(...column.map((n) => pos[n.id].y + n.height)));
  });

  it('folds and opens a group, keeping nothing empty behind', () => {
    const open = withCollapsed(HEARTH, 'mods', false);
    expect((open.graph as Record<string, unknown>).collapsed).toBeUndefined();
    expect(withCollapsed(open, 'abilities', true).graph).toMatchObject({ collapsed: ['abilities'] });
    const bare = withCollapsed({ format: 1, name: 'X', graph: { collapsed: ['a'] } }, 'a', false);
    expect(bare.graph).toBeUndefined();
    expect(problems(withCollapsed(HEARTH, 'abilities', true))).toEqual([]);
  });

  it('writes what the server takes, for any system', () => {
    for (const def of [...randoms, ...examples]) {
      const graph = graphOf(def);
      const written = withPositions(def, graph, { [graph.nodes[0]?.id ?? 'x']: { x: 7, y: 7 } });
      expect(problems(written).filter((p: string) => p.startsWith('graph'))).toEqual([]);
    }
  });
});

describe('what is drawn with groups folded', () => {
  const g = graphOf(HEARTH);
  const pos = positionsOf(HEARTH, g);

  it('a folded group is one box at its members\' corner, a row each', () => {
    const box = groupBoxOf(g.groups.find((x) => x.id === 'mods')!, g, pos)!;
    expect(box).toEqual({
      id: 'mods', x: pos.str_mod.x - SIZE.groupPad, y: pos.str_mod.y - SIZE.groupTitle,
      width: SIZE.width + 2 * SIZE.groupPad, height: foldedHeight(2), collapsed: true, members: ['str_mod', 'wit_mod'],
    });
  });

  it('an open group is a box around its members', () => {
    const box = groupBoxOf(g.groups.find((x) => x.id === 'abilities')!, g, pos)!;
    expect(box.collapsed).toBe(false);
    expect(box.x).toBe(pos.str.x - SIZE.groupPad);
    expect(box.y + box.height).toBe(pos.wit.y + node(g, 'wit').height + SIZE.groupPad);
  });

  it('wires reach a folded member through its group\'s row, and one between two folded members is not drawn', () => {
    const shown = shownWires(g);
    const intoMod = shown.find((w) => w.from === 'str' && w.to === 'str_mod')!;
    expect([intoMod.source, intoMod.sourceHandle, intoMod.target, intoMod.targetHandle]).toEqual(['str', 'out', 'group:mods', 'in:str_mod']);
    const outOfMod = shown.find((w) => w.from === 'str_mod' && w.to === 'melee')!;
    expect([outOfMod.source, outOfMod.sourceHandle, outOfMod.target, outOfMod.targetHandle]).toEqual(['group:mods', 'out:str_mod', 'melee', 'b:@str_mod']);
    const inner = { ...HEARTH, derived: [...(HEARTH.derived as unknown[]), { id: 'mods_sum', formula: '@str_mod' }],
      graph: { groups: [{ id: 'mods', label: 'M', members: ['str_mod', 'mods_sum'] }], collapsed: ['mods'] } };
    expect(shownWires(graphOf(inner)).some((w) => w.from === 'str_mod' && w.to === 'mods_sum')).toBe(false);
  });
});
