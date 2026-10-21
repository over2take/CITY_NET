/**
 * The GRAPH view as logic (5a2, node styles 5a3a). Approved mockups builder-graph (2026-10-17) and
 * the builder design's node kit (2026-09-29): a system read as nodes, wires and groups, drawn to be
 * read: a stats group is one list node, a modifier each stat gets from one table a column on it,
 * a formula's inputs and text in the names players see, `max(@a, @b)` as BEST with a wire from
 * each. Wires are what each formula reads (never stored), laid out in columns on a 24px grid, the
 * map's moves written back into the definition's `graph` section. Held to the server's own formula
 * reader (expression.js) and its own check (definition.js), over random systems and every example.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import {
  referencesIn, graphOf, heightOf, exprHeight, columnsOf, layoutOf, positionsOf, savedPositions, withPositions, withCollapsed,
  groupBoxOf, shownWires, foldedHeight, clearSpot, clearOf, takenBoxes, relatedTo, rollText, GRID, REACH, SIZE, type Graph, type GraphNode,
} from '../graphModel';
import type { Definition } from '../systemsApi';

const req = createRequire(import.meta.url);
const { checkDefinition } = req('../../../../backend/systemBuilder/definition.js');
const { parse, references } = req('../../../../backend/systemBuilder/expression.js');
const { LIMITS: GRAPH_LIMITS } = req('../../../../backend/systemBuilder/graph.js');
const { EXAMPLES } = req('../../../../backend/systemBuilder/examples.js');
const { randomSystem } = req('../../../../backend/__tests__/helpers/randomSystem.js');

const problems = (def: Definition) => checkDefinition(def).problems.map((p: { where: string; message: string }) => `${p.where}: ${p.message}`);

/** HEARTH: a level, abilities with modifiers from one table, a skill, attacks in a map group, a house rule, a note. */
const HEARTH: Definition = {
  format: 1,
  name: 'Hearth',
  stats: [
    { id: 'character', label: 'Character', stats: [{ id: 'lvl', label: 'Level', min: 1, max: 10 }] },
    { id: 'abilities', label: 'Abilities', stats: [{ id: 'str', label: 'Strength', min: 3, max: 18 }, { id: 'wit', label: 'Wits', min: 3, max: 18 }] },
    { id: 'skills', label: 'Skills', stats: [{ id: 'fight', label: 'Fight', min: 0, max: 4, tie: 'str' }] },
  ],
  lookups: { attribute_mod: { label: 'Attribute mod', bands: [{ upTo: 13, value: 0 }, { value: 1 }] } },
  derived: [
    { id: 'str_mod', label: 'Str mod', formula: 'attribute_mod(@str)' },
    { id: 'wit_mod', label: 'Wit mod', formula: 'attribute_mod(@wit)' },
    { id: 'melee', label: 'Melee attack', formula: '@str_mod + @fight + floor(@lvl / 2) + @cash' },
    { id: 'spell', label: 'Spell power', formula: '0', alternative: { rule: 'magic', formula: '@wit_mod + @lvl' } },
    { id: 'can_cast', label: 'Can cast', kind: 'condition', when: '@spell > 2', then: '1', else: '0' },
  ],
  house_rules: [{ id: 'magic', name: 'Magic', description: 'Characters can learn spells.' }],
  graph: {
    groups: [{ id: 'attacks', label: 'ATTACKS', members: ['melee', 'spell'] }],
    collapsed: ['attacks'],
    notes: [{ id: 'n1', on: 'melee', text: 'Half level, rounded down: the 2nd printing.' }],
  },
};
const node = (g: Graph, id: string): GraphNode => g.nodes.find((n) => n.id === id)!;
const wiresInto = (g: Graph, id: string) => g.wires.filter((w) => w.to === id).map((w) => `${w.from} ${w.fromHandle} ${w.kind}${w.alt ? ' alt' : ''}`);
const with_ = (over: Partial<Definition>): Definition => ({ ...HEARTH, ...over });

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

  it('draws a stats group as one list node, and a table, house rule, formula, condition and note as a node each', () => {
    expect(g.nodes.map((n) => `${n.kind} ${n.id}`)).toEqual([
      'list character', 'list abilities', 'list skills', 'rule rule:magic', 'table table:attribute_mod',
      'formula melee', 'formula spell', 'condition can_cast', 'note note:n1',
    ]);
    expect(node(g, 'table:attribute_mod').bands).toEqual([{ upTo: 13, value: 0 }, { upTo: null, value: 1 }]);
    expect(node(g, 'abilities').label).toBe('ABILITIES');
  });

  it('puts each stat\'s modifier from one table on its row, the table feeding the list once', () => {
    expect(node(g, 'abilities').rows).toEqual([
      { stat: 'str', label: 'STRENGTH', short: 'STR', mod: 'str_mod' },
      { stat: 'wit', label: 'WITS', short: 'WIT', mod: 'wit_mod' },
    ]);
    expect(node(g, 'abilities').via).toEqual({ table: 'attribute_mod', label: 'ATTRIBUTE MOD' });
    expect(wiresInto(g, 'abilities')).toEqual(['table:attribute_mod out table']);
    expect(node(g, 'character').rows).toEqual([{ stat: 'lvl', label: 'LEVEL', short: 'LVL', mod: null }]);
    expect(node(g, 'character').via).toBeUndefined();
    expect(g.nodes.some((n) => n.id === 'str_mod')).toBe(false);
  });

  it('keeps a modifier a node of its own when it isn\'t one table on one stat for the whole group', () => {
    const twoTables = with_({
      lookups: { ...(HEARTH.lookups as object), other: { bands: [{ value: 1 }] } },
      derived: [{ id: 'str_mod', formula: 'attribute_mod(@str)' }, { id: 'wit_mod', formula: 'other(@wit)' }],
    });
    expect(graphOf(twoTables).nodes.filter((n) => n.kind === 'formula').map((n) => n.id)).toEqual(['str_mod', 'wit_mod']);
    const underRule = with_({ derived: [{ id: 'str_mod', formula: 'attribute_mod(@str)', alternative: { rule: 'magic', formula: '1' } }] });
    expect(graphOf(underRule).nodes.some((n) => n.id === 'str_mod')).toBe(true);
    const grouped = with_({ graph: { groups: [{ id: 'mods', label: 'MODS', members: ['str_mod'] }] } });
    expect(node(graphOf(grouped), 'abilities').rows!.map((r) => r.mod)).toEqual([null, 'wit_mod']);
  });

  it('labels a formula\'s inputs by the names players see, and where a stat comes from', () => {
    expect(node(g, 'melee').inputs.map((i) => `${i.key} ${i.kind} ${i.label} ${i.where ?? ''}`.trim())).toEqual([
      'b:@str_mod value STR MOD ABILITIES', 'b:@fight value FIGHT SKILLS', 'b:@lvl value LEVEL CHARACTER', 'b:@cash field @cash',
    ]);
    expect(node(g, 'melee').inputs[3]).toMatchObject({ known: true, missing: false, from: [] });
    expect(wiresInto(g, 'melee')).toEqual(['abilities out:str_mod value', 'skills out:fight value', 'character out:lvl value', 'note:n1 out note']);
  });

  it('carries what a formula does to a name on its way in (5b3), on its input and its wire', () => {
    const lvl = node(g, 'melee').inputs.find((i) => i.key === 'b:@lvl')!;
    expect(lvl.modifier).toMatchObject({ kind: 'down', n: 2, label: '÷2↓' });
    expect(node(g, 'melee').inputs.find((i) => i.key === 'b:@str_mod')!.modifier).toBeUndefined();
    expect(g.wires.find((w) => w.to === 'melee' && w.value === 'lvl')!.modifier).toBe('÷2↓');
    expect(g.wires.find((w) => w.to === 'melee' && w.value === 'str_mod')!.modifier).toBeUndefined();
  });

  it('writes a formula\'s text in those names', () => {
    expect(node(g, 'melee').text).toBe('STR MOD + FIGHT + floor(LEVEL / 2) + @cash');
    expect(node(g, 'can_cast').text).toBe('IF SPELL POWER > 2 THEN 1 ELSE 0');
    const tabled = graphOf(with_({ derived: [{ id: 'x', formula: 'attribute_mod(@lvl) * 2 - 1' }] }));
    expect(node(tabled, 'x').text).toBe('ATTRIBUTE MOD(LEVEL) × 2 − 1');
  });

  it('reads max() and min() of names as one BEST or WORST input, a wire from each', () => {
    const def = with_({ derived: [...(HEARTH.derived as unknown[]), { id: 'save', label: 'Save', formula: '16 - (@lvl + max(@str_mod, @wit_mod))' }, { id: 'worst', formula: 'min(@str, @wit) + min(@lvl, @fight)' }] });
    const graph = graphOf(def);
    expect(node(graph, 'save').inputs.map((i) => `${i.kind} ${i.label}: ${i.from.map((f) => f.value).join(', ')}`)).toEqual(['value LEVEL: lvl', 'combined BEST: str_mod, wit_mod']);
    expect(node(graph, 'save').text).toBe('16 − (LEVEL + BEST)');
    expect(wiresInto(graph, 'save')).toEqual(['character out:lvl value', 'abilities out:str_mod value', 'abilities out:wit_mod value']);
    expect(node(graph, 'worst').inputs.map((i) => i.label)).toEqual(['WORST 1', 'WORST 2']);
    expect(node(graph, 'worst').text).toBe('WORST 1 + WORST 2');
  });

  it('wires a house rule to the formulas it swaps, and their alternatives\' inputs as alternatives', () => {
    expect(node(g, 'spell').alternative).toEqual({ rule: 'magic', ruleName: 'MAGIC', text: 'WIT MOD + LEVEL' });
    expect(wiresInto(g, 'spell')).toEqual(['abilities out:wit_mod value alt', 'character out:lvl value alt', 'rule:magic out gate alt']);
  });

  it('lists what else waits on a house rule, on other pages', () => {
    expect(node(graphOf(with_({ conditions: { hexed: { only_with: 'magic' } } })), 'rule:magic').also).toEqual(['hexed · CONDITION']);
  });

  it('marks a table that isn\'t there and a name no sheet has', () => {
    const odd = graphOf(with_({ derived: [{ id: 'x', formula: 'nothing(@nowhere) + $cwn_move_bonus' }] }));
    expect(node(odd, 'x').inputs.map((i) => `${i.kind} ${i.label} ${i.missing ?? ''} ${i.known ?? ''}`.trim())).toEqual([
      'table nothing true', 'field @nowhere true false', 'engine CWN MOVE BONUS',
    ]);
  });

  it('groups formulas by the map\'s own groups', () => {
    expect(g.groups).toEqual([{ id: 'attacks', label: 'ATTACKS', members: ['melee', 'spell'], collapsed: true }]);
    expect(node(g, 'melee').group).toBe('attacks');
  });

  it('sizes each node from what it shows', () => {
    expect(node(g, 'abilities').height).toBe(SIZE.header + SIZE.row + SIZE.colHead + 2 * SIZE.listRow + SIZE.pad + SIZE.border);
    expect(node(g, 'character').height).toBe(SIZE.header + SIZE.colHead + SIZE.listRow + SIZE.pad + SIZE.border);
    expect(node(g, 'melee').height).toBe(SIZE.header + 4 * SIZE.row + exprHeight(node(g, 'melee').text) + SIZE.result + SIZE.pad + SIZE.border);
    expect(node(g, 'spell').height).toBe(SIZE.header + exprHeight('0') + SIZE.result + SIZE.row + 2 * SIZE.row + exprHeight('WIT MOD + LEVEL') + SIZE.pad + SIZE.border);
    expect(node(g, 'note:n1').width).toBe(SIZE.noteWidth);
    for (const n of g.nodes) expect(n.height).toBe(heightOf(n));
  });

  it('leaves out what the layout names but FORMS has since deleted, and pins a note on a stat to its list', () => {
    const def = with_({
      graph: {
        positions: { gone: [0, 0], abilities: [48, 48] },
        groups: [{ id: 'attacks', label: 'ATTACKS', members: ['gone', 'melee'] }, { id: 'attacks', label: 'AGAIN', members: ['spell'] }, { id: 'more', label: 'MORE', members: ['melee'] }],
        notes: [{ id: 'n1', on: 'gone', text: 'Pinned to nothing now.' }, { id: 'n2', on: 'str', text: 'On a stat.' }],
      },
    });
    const lost = graphOf(def);
    expect(lost.groups).toEqual([
      { id: 'attacks', label: 'ATTACKS', members: ['melee'], collapsed: false },
      { id: 'more', label: 'MORE', members: [], collapsed: false },
    ]);
    expect(node(lost, 'note:n1').on).toBeUndefined();
    expect(node(lost, 'note:n2').on).toBe('abilities');
    expect(Object.keys(savedPositions(def, lost))).toEqual(['abilities']);
  });

  it('every wire joins two nodes on the map at a dot they have, for any system', () => {
    for (const def of [...randoms, ...examples]) {
      const graph = graphOf(def);
      const ids = new Map(graph.nodes.map((n) => [n.id, n]));
      for (const w of graph.wires) {
        expect(ids.has(w.from)).toBe(true);
        expect(ids.has(w.to)).toBe(true);
        const from = ids.get(w.from)!;
        if (w.fromHandle.startsWith('out:')) expect(from.rows!.some((r) => `out:${r.stat}` === w.fromHandle || `out:${r.mod}` === w.fromHandle)).toBe(true);
        else expect(w.fromHandle).toBe('out');
        const to = ids.get(w.to)!;
        if (w.input !== 'gate' && w.input !== 'note') expect(to.inputs.some((i) => i.key === w.input)).toBe(true);
      }
      for (const n of graph.nodes) for (const i of n.inputs) for (const f of i.from) expect(graph.wires.some((w) => w.to === n.id && w.input === i.key && w.value === f.value)).toBe(true);
    }
  });
});

describe('laying it out', () => {
  const g = graphOf(HEARTH);

  it('reads left to right: tables, house rules and plain stats, a list a table feeds, then each formula right of what it reads', () => {
    expect(columnsOf(g)).toEqual({
      character: 0, abilities: 1, skills: 0, 'rule:magic': 0, 'table:attribute_mod': 0,
      melee: 2, spell: 2, can_cast: 3, 'note:n1': 3,
    });
  });

  it('puts tables and house rules at the top of their column, so they sit before what they feed', () => {
    const pos = layoutOf(graphOf(with_({ graph: undefined })));
    expect(pos['table:attribute_mod'].y).toBeLessThan(pos.character.y);
    expect(pos['rule:magic'].y).toBeLessThan(pos.character.y);
    expect(pos['table:attribute_mod'].x).toBeLessThan(pos.abilities.x);
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

  it('starts another column beside one that would grow too tall, for any system', () => {
    for (const def of [...randoms, ...examples]) {
      const graph = graphOf(def);
      const pos = layoutOf(graph);
      const groupOf = new Map(graph.groups.flatMap((x) => x.members.map((m) => [m, x])));
      for (const n of graph.nodes) {
        // A node the top of its column, or in a group (which moves across whole), may run past.
        if (pos[n.id].y === SIZE.top || groupOf.has(n.id)) continue;
        expect(pos[n.id].y + n.height, n.id).toBeLessThanOrEqual(SIZE.top + SIZE.columnHeight);
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
    const moved = withPositions(HEARTH, g, { melee: { x: 1000, y: 13 }, abilities: { x: REACH + 500, y: -REACH - 500 } });
    expect(problems(moved)).toEqual([]);
    const places = (moved.graph as { positions: Record<string, [number, number]> }).positions;
    expect(Object.keys(places).sort()).toEqual(g.nodes.map((n) => n.id).sort());
    expect(places.melee).toEqual([1008, 24]);
    expect(places.abilities).toEqual([REACH, -REACH]);
    expect(REACH).toBe(GRAPH_LIMITS.reach);
    expect((moved.graph as Record<string, unknown>).notes).toEqual((HEARTH.graph as Record<string, unknown>).notes);
  });

  it('drops places of what is no longer on the map when it writes, and never writes a stray', () => {
    const def = with_({ graph: { ...(HEARTH.graph as object), positions: { gone: [0, 0], abilities: [48, 48] } } });
    const places = (withPositions(def, graphOf(def), { nowhere: { x: 0, y: 0 } }).graph as { positions: Record<string, unknown> }).positions;
    expect(places.gone).toBeUndefined();
    expect(places.nowhere).toBeUndefined();
    expect(places.abilities).toEqual([48, 48]);
  });

  it('puts a node added since under what is in its column, leaving the rest where it was', () => {
    // Melee moved well down first: a new node goes under it, not where a fresh layout would put it.
    const open = with_({ graph: undefined });
    const og = graphOf(open);
    const placed = withPositions(open, og, { melee: { x: layoutOf(og).melee.x, y: 960 } });
    const more = { ...placed, derived: [...(placed.derived as unknown[]), { id: 'defense', label: 'Defense', formula: '10 + @str_mod' }] };
    const graph = graphOf(more);
    const pos = positionsOf(more, graph);
    expect(pos.melee).toEqual({ x: layoutOf(og).melee.x, y: 960 });
    expect(pos.defense.x).toBe(pos.melee.x);
    expect(pos.defense.y).toBeGreaterThanOrEqual(960 + node(og, 'melee').height);
  });

  it('folds and opens a group, keeping nothing empty behind', () => {
    const open = withCollapsed(HEARTH, 'attacks', false);
    expect((open.graph as Record<string, unknown>).collapsed).toBeUndefined();
    expect(withCollapsed(open, 'attacks', true).graph).toMatchObject({ collapsed: ['attacks'] });
    const bare = withCollapsed({ format: 1, name: 'X', graph: { collapsed: ['a'] } }, 'a', false);
    expect(bare.graph).toBeUndefined();
    expect(problems(withCollapsed(open, 'attacks', true))).toEqual([]);
  });

  it('a system made before the map existed opens laid out, and its first move writes what the server takes', () => {
    // e2e/fixtures/emberline.citysys: exported 2026-10-16 by a 2.0.0 dev build, no graph section.
    const file = JSON.parse(req('fs').readFileSync(req('path').join(__dirname, '..', '..', '..', '..', 'e2e', 'fixtures', 'emberline.citysys'), 'utf8'));
    const old = file.definition as Definition;
    expect(old.graph).toBeUndefined();
    const graph = graphOf(old);
    expect(graph.nodes.length).toBeGreaterThan(3);
    expect(positionsOf(old, graph)).toEqual(layoutOf(graph));
    const ids = new Set(graph.nodes.map((n) => n.id));
    for (const w of graph.wires) { expect(ids.has(w.from)).toBe(true); expect(ids.has(w.to)).toBe(true); }
    const moved = withPositions(old, graph, { [graph.nodes[0].id]: { x: 480, y: 480 } });
    expect(problems(moved)).toEqual([]);
    // Everything else in it is as it was: the map only adds its own section.
    const { graph: _layout, ...rest } = moved;
    expect(rest).toEqual(old);
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

  it('a folded group is one box at its members\' corner, saying how many wires leave it', () => {
    const box = groupBoxOf(g.groups[0], g, pos)!;
    expect(box).toEqual({
      id: 'attacks', x: Math.min(pos.melee.x, pos.spell.x) - SIZE.groupPad, y: Math.min(pos.melee.y, pos.spell.y) - SIZE.groupTitle,
      width: SIZE.width + 2 * SIZE.groupPad, height: foldedHeight(), collapsed: true, members: ['melee', 'spell'], wiresOut: 1,
    });
  });

  it('an open group is a box around its members', () => {
    const open = withCollapsed(HEARTH, 'attacks', false);
    const og = graphOf(open);
    const opos = positionsOf(open, og);
    const box = groupBoxOf(og.groups[0], og, opos)!;
    expect(box.collapsed).toBe(false);
    expect(box.x).toBe(opos.melee.x - SIZE.groupPad);
    expect(box.y + box.height).toBe(Math.max(opos.melee.y + node(og, 'melee').height, opos.spell.y + node(og, 'spell').height) + SIZE.groupPad);
  });

  it('wires reach a folded group through its one dot in and one out, and one between two of its members is not drawn', () => {
    const shown = shownWires(g);
    const intoMelee = shown.find((w) => w.from === 'skills' && w.to === 'melee')!;
    expect([intoMelee.source, intoMelee.sourceHandle, intoMelee.target, intoMelee.targetHandle]).toEqual(['skills', 'out:fight', 'group:attacks', 'in']);
    const outOfSpell = shown.find((w) => w.from === 'spell' && w.to === 'can_cast')!;
    expect([outOfSpell.source, outOfSpell.sourceHandle, outOfSpell.target, outOfSpell.targetHandle]).toEqual(['group:attacks', 'out', 'can_cast', 'b:@spell']);
    const inner = with_({ derived: [...(HEARTH.derived as unknown[]), { id: 'combo', formula: '@melee' }],
      graph: { groups: [{ id: 'attacks', label: 'A', members: ['melee', 'combo'] }], collapsed: ['attacks'] } });
    expect(shownWires(graphOf(inner)).some((w) => w.from === 'melee' && w.to === 'combo')).toBe(false);
  });
});

describe('room for something new (5b6a)', () => {
  const size = { width: SIZE.width, height: 120 };

  it('clear means a whole cell between, on every side', () => {
    const taken = [{ x: 240, y: 240, width: 264, height: 96 }];
    const one = { width: 120, height: 48 };
    // Right, left, below, above: a cell apart is clear, touching or nearer is not.
    expect(clearOf(taken, { x: 240 + 264 + GRID, y: 240 }, one)).toBe(true);
    expect(clearOf(taken, { x: 240 + 264, y: 240 }, one)).toBe(false);
    expect(clearOf(taken, { x: 240 - 120 - GRID, y: 240 }, one)).toBe(true);
    expect(clearOf(taken, { x: 240 - 120, y: 240 }, one)).toBe(false);
    expect(clearOf(taken, { x: 240, y: 240 + 96 + GRID }, one)).toBe(true);
    expect(clearOf(taken, { x: 240, y: 240 + 96 + GRID - 1 }, one)).toBe(false);
    expect(clearOf(taken, { x: 240, y: 240 - 48 - GRID }, one)).toBe(true);
    expect(clearOf(taken, { x: 240, y: 240 - 48 }, one)).toBe(false);
  });

  it('the spot asked for when it is clear', () => {
    const g = graphOf(HEARTH);
    expect(clearSpot(g, positionsOf(HEARTH, g), { x: 4800, y: 4800 }, size)).toEqual({ x: 4800, y: 4800 });
  });

  it('on a node, the nearest whole cells away that are clear of every node and group box; none nearer is', () => {
    for (const def of [HEARTH, ...examples, ...randoms.slice(0, 20)]) {
      const g = graphOf(def);
      const places = positionsOf(def, g);
      const taken = takenBoxes(g, places);
      for (const n of g.nodes.slice(0, 4)) {
        const at = places[n.id];
        const spot = clearSpot(g, places, at, size);
        expect(clearOf(taken, spot, size), `${def.name} ${n.id}`).toBe(true);
        const far = Math.hypot(spot.x - at.x, spot.y - at.y) / GRID;
        expect(far, `${def.name} ${n.id}`).toBeGreaterThan(0);
        const reach = Math.ceil(far);
        const cells = ((spot.x - at.x) / GRID) ** 2 + ((spot.y - at.y) / GRID) ** 2;
        for (let dx = -reach; dx <= reach; dx += 1) for (let dy = -reach; dy <= reach; dy += 1) {
          // In whole cells squared, exact: Math.hypot can put the spot found a hair nearer than itself.
          if (dx * dx + dy * dy < cells) expect(clearOf(taken, { x: at.x + dx * GRID, y: at.y + dy * GRID }, size), `${def.name} ${n.id} ${dx},${dy}`).toBe(false);
        }
      }
    }
  });

  it('keeps out of a group\'s box, and leaves out the node being placed', () => {
    const g = graphOf(HEARTH);
    const places = positionsOf(HEARTH, g);
    const box = groupBoxOf(g.groups.find((x) => x.id === 'attacks')!, g, places)!;
    expect(takenBoxes(g, places)).toContainEqual({ x: box.x, y: box.y, width: box.width, height: box.height, ...{ id: box.id, collapsed: box.collapsed, members: box.members, wiresOut: box.wiresOut } });
    expect(clearOf(takenBoxes(g, places), { x: box.x, y: box.y }, { width: 24, height: 24 })).toBe(false);
    const can = places.can_cast;
    expect(takenBoxes(g, places, 'can_cast')).toHaveLength(takenBoxes(g, places).length - 1);
    expect(takenBoxes(g, places, 'can_cast').some((b) => b.x === can.x && b.y === can.y)).toBe(false);
    // On its own, far from anything: where it is, itself not in the way.
    const alone = { ...places, can_cast: { x: 9600, y: 9600 } };
    expect(clearSpot(g, alone, alone.can_cast, node(g, 'can_cast'), 'can_cast')).toEqual(alone.can_cast);
  });
});

describe('what a node is part of, for hover highlighting (5c1)', () => {
  const g = graphOf(HEARTH);
  const sorted = (s: Set<string>) => [...s].sort();

  it('what it reads however far up, and its notes; not what only shares an input', () => {
    expect(sorted(relatedTo(g, 'melee'))).toEqual(['abilities', 'character', 'melee', 'note:n1', 'skills', 'table:attribute_mod']);
  });

  it('what reads it however far down, and the house rule swapping it', () => {
    expect(sorted(relatedTo(g, 'spell'))).toEqual(['abilities', 'can_cast', 'character', 'rule:magic', 'spell', 'table:attribute_mod']);
    expect(sorted(relatedTo(g, 'rule:magic'))).toEqual(['can_cast', 'rule:magic', 'spell']);
  });

  it('a note lights itself and its node; one pinned to nothing, itself', () => {
    expect(sorted(relatedTo(g, 'note:n1'))).toEqual(['melee', 'note:n1']);
    const loose = graphOf({ ...HEARTH, graph: { notes: [{ id: 'n2', text: 'x' }] } });
    expect(sorted(relatedTo(loose, 'note:n2'))).toEqual(['note:n2']);
    // Its line isn't a wire: a note on SPELL doesn't light what reads SPELL.
    const onSpell = graphOf({ ...HEARTH, graph: { notes: [{ id: 'n3', on: 'spell', text: 'x' }] } });
    expect(sorted(relatedTo(onSpell, 'note:n3'))).toEqual(['note:n3', 'spell']);
  });

  it('in every example and random system: holds itself, and only nodes the map has, and is the same both ways', () => {
    for (const def of [...examples, ...randoms.slice(0, 20)]) {
      const graph = graphOf(def);
      const ids = new Set(graph.nodes.map((n) => n.id));
      for (const n of graph.nodes.slice(0, 8)) {
        const r = relatedTo(graph, n.id);
        expect(r.has(n.id)).toBe(true);
        for (const x of r) expect(ids.has(x), `${def.name} ${n.id} ${x}`).toBe(true);
        // What is lit from a node it reads or that reads it lights that node back.
        for (const w of graph.wires.filter((x) => x.kind !== 'note' && x.from === n.id)) expect(relatedTo(graph, w.to).has(n.id), `${def.name} ${w.id}`).toBe(true);
      }
    }
  });
});

describe('a roll on the map (6b4a)', () => {
  const ROLLING: Definition = {
    ...HEARTH,
    rolls: [
      { id: 'skill', label: 'Skill check', dice: [{ count: '2', sides: 6 }], add: '@this + @tie_mod + floor(@lvl / 2)',
        bands: [{ upTo: 6, label: 'Miss' }, { upTo: 9, label: 'Cost' }, { label: 'Hit' }],
        changes: [{ id: 'fwd', label: 'Forward', add: '@wit_mod' }, { id: 'push', label: 'Push', extra: { dice: 1 }, cost: { from: 'lvl', amount: 1 } }], by: ['skills'] },
      { id: 'save', label: 'Save', dice: [{ count: '1', sides: 20 }], against: '@this', under: true, by: ['melee'] },
      { id: 'pool', label: 'Pool', dice: [{ count: '@this + @hunger', sides: 10, name: 'Hunger' }], read: 'count', at: 6, by: ['str', 'gone'] },
      { id: 'fate', label: 'Fate', dice: [{ count: '4', sides: 'F' }], read: 'highest', keep: '2' },
    ],
  };
  const g = graphOf(ROLLING);
  const rows = (id: string) => node(g, id).inputs.map((i) => `${i.key} ${i.kind} ${i.label} · ${i.about ?? i.where ?? ''}${i.missing ? ' MISSING' : ''}`);

  it('one ROLL node a roll: what it is rolled by, then what its dice and adding read, @this and the rest rows of their own', () => {
    expect(g.nodes.filter((n) => n.kind === 'roll').map((n) => n.id)).toEqual(['roll:skill', 'roll:save', 'roll:pool', 'roll:fate']);
    expect(node(g, 'roll:skill')).toMatchObject({ label: 'SKILL CHECK', text: '2d6 + @this + @tie_mod + floor(LEVEL / 2)', roll: { outcome: '10+ · 7–9 · 6−', changes: ['FORWARD', 'PUSH ◆'] } });
    expect(rows('roll:skill')).toEqual([
      'by:skills value SKILLS · ROLLED BY · EACH STAT',
      'b:@this field @this · THE STAT ROLLED',
      "b:@tie_mod field @tie_mod · ITS ABILITY'S MODIFIER",
      'b:@lvl value LEVEL · CHARACTER',
      // FORWARD's +WIT MOD: read by a change, wired in all the same.
      'b:@wit_mod value WIT MOD · ABILITIES',
    ]);
    expect(rows('roll:pool')).toEqual([
      'by:str value STRENGTH · ROLLED BY', 'by:gone value GONE · ROLLED BY · NOT HERE MISSING',
      'b:@this field @this · THE STAT ROLLED', 'b:@hunger field @hunger ·  MISSING',
    ]);
    expect(node(g, 'roll:pool').inputs.find((i) => i.key === 'b:@hunger')).toMatchObject({ known: false });
    expect(node(g, 'roll:save')).toMatchObject({ text: '1d20 UNDER @this', roll: { outcome: 'AT OR UNDER THE TARGET', changes: [] } });
    expect(node(g, 'roll:pool').roll!.outcome).toBe('SUCCESSES');
    expect(node(g, 'roll:fate')).toMatchObject({ text: '4dF KEEP HIGHEST 2', inputs: [], roll: { outcome: 'THE TOTAL' } });
  });

  it('wired from what rolls it, a whole stats group from its list\'s own dot, and from what it reads', () => {
    expect(wiresInto(g, 'roll:skill')).toEqual(['skills out value', 'character out:lvl value', 'abilities out:wit_mod value']);
    expect(wiresInto(g, 'roll:save')).toEqual(['melee out value']);
    expect(wiresInto(g, 'roll:pool')).toEqual(['abilities out:str value']);
    expect(g.wires.filter((w) => w.from.startsWith('roll:'))).toEqual([]);
  });

  it('as tall as a formula with as many rows, right of everything it reads, and its place kept', () => {
    const n = node(g, 'roll:skill');
    expect(n.height).toBe(heightOf({ ...n, kind: 'formula' }));
    const col = columnsOf(g);
    expect(col['roll:skill']).toBeGreaterThan(Math.max(col.skills, col.character, col.abilities));
    expect(col['roll:save']).toBeGreaterThan(col.melee);
    // Saved with the draft as any node's, which the server takes.
    const moved = withPositions(ROLLING, g, { 'roll:skill': { x: 4800, y: 4800 } });
    expect(positionsOf(moved, graphOf(moved))['roll:skill']).toEqual({ x: 4800, y: 4800 });
    expect(problems(moved).filter((p: string) => p.startsWith('graph'))).toEqual([]);
  });

  it('its dice in a line: counts worked out in brackets, Fate dice, a named kind, keeping and the target', () => {
    expect(rollText({ id: 'a', dice: [{ count: '2', sides: 6 }, { count: '1', sides: 6, name: 'Hope' }] })).toBe('2d6 + 1d6 HOPE');
    expect(rollText({ id: 'a', dice: [{ count: ' 3 ', sides: 'F' }], read: 'lowest' })).toBe('3dF KEEP LOWEST 1');
    expect(rollText({ id: 'a', dice: [{ count: '@this', sides: 10 }], read: 'count', at: 8, add: '1', against: '3' })).toBe('(@this)d10 COUNT 8+ + 1 VS 3');
    expect(rollText({ id: 'a', dice: [] })).toBe('NO DICE');
  });
});
