/**
 * Drawing and cutting wires on the graph view (5b2). Approved mockup builder-graph (2026-10-17),
 * decision 3: a wire is a formula reading a name. A wire drawn or cut is one formula's text (or its
 * WITH-rule formula) changed, exactly as typing it in FORMS would; where cutting can't leave a
 * whole formula, the panel opens instead. Over every random system and example: cutting any wire
 * takes out that wire alone and changes nothing else, and drawing a wire then cutting it gives the
 * system back.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { withWire, withoutWire, withoutName, givenBy, reads, wireLabel } from '../graphEdits';
import { graphOf, type Graph, type GraphWire } from '../graphModel';
import { withFormula, withAlternative, formulaList } from '../statsRules';
import { rollList } from '../rolls';
import type { Definition } from '../systemsApi';

const req = createRequire(import.meta.url);
const { checkDefinition } = req('../../../../backend/systemBuilder/definition.js');
const { EXAMPLES } = req('../../../../backend/systemBuilder/examples.js');
const { randomSystem } = req('../../../../backend/__tests__/helpers/randomSystem.js');

const HEARTH: Definition = {
  format: 1,
  name: 'Hearth',
  stats: [
    { id: 'character', label: 'Character', stats: [{ id: 'lvl', label: 'Level' }] },
    { id: 'abilities', label: 'Abilities', stats: [{ id: 'str', label: 'Strength' }, { id: 'wit', label: 'Wits' }] },
  ],
  lookups: { attribute_mod: { bands: [{ upTo: 13, value: 0 }, { value: 1 }] } },
  derived: [
    { id: 'str_mod', label: 'Str mod', formula: 'attribute_mod(@str)' },
    { id: 'wit_mod', label: 'Wit mod', formula: 'attribute_mod(@wit)' },
    { id: 'melee', label: 'Melee', formula: '@str_mod + floor(@lvl / 2)' },
    { id: 'save', label: 'Save', formula: '16 - max(@str_mod, @wit_mod, @lvl)' },
    { id: 'blank', label: 'Blank', formula: '0' },
    { id: 'spell', label: 'Spell', formula: '@wit_mod', alternative: { rule: 'magic', formula: '@wit_mod + @lvl' } },
    { id: 'can', label: 'Can', kind: 'condition', when: '@spell > 1', then: '1', else: '0' },
  ],
  house_rules: [{ id: 'magic', name: 'Magic' }],
};
const g = graphOf(HEARTH);
const formula = (def: Definition | null, id: string) => (formulaList(def!) as { id: string; formula: string; alternative?: { formula: string } }[]).find((f) => f.id === id)!;
const wireOf = (graph: Graph, test: (w: GraphWire) => boolean) => graph.wires.find(test)!;
const problems = (def: Definition) => checkDefinition(def).problems.map((p: { where: string }) => p.where);

describe('what a dot gives', () => {
  it('a stat\'s or modifier\'s row, a formula, a table, a house rule; nothing else', () => {
    expect(givenBy(g, { node: 'abilities', handle: 'out:str' })).toEqual({ kind: 'value', id: 'str' });
    expect(givenBy(g, { node: 'abilities', handle: 'out:str_mod' })).toEqual({ kind: 'value', id: 'str_mod' });
    expect(givenBy(g, { node: 'melee', handle: 'out' })).toEqual({ kind: 'value', id: 'melee' });
    expect(givenBy(g, { node: 'table:attribute_mod', handle: 'out' })).toEqual({ kind: 'table', id: 'attribute_mod' });
    expect(givenBy(g, { node: 'rule:magic', handle: 'out' })).toEqual({ kind: 'rule', id: 'magic' });
    expect(givenBy(g, { node: 'nowhere', handle: 'out' })).toBeNull();
  });
});

describe('a wire drawn', () => {
  it('adds + @name to the end of the formula, as typing it in FORMS would', () => {
    const drawn = withWire(HEARTH, g, { node: 'abilities', handle: 'out:wit' }, 'melee');
    expect(drawn.definition).toEqual(withFormula(HEARTH, 'melee', { formula: '@str_mod + floor(@lvl / 2) + @wit' }));
    expect(drawn.message).toBe('MELEE: added + WITS.');
  });

  it('makes a formula of just 0 read the name', () => {
    expect(formula(withWire(HEARTH, g, { node: 'character', handle: 'out:lvl' }, 'blank').definition, 'blank').formula).toBe('@lvl');
  });

  it('refuses a name already read, a formula reading itself, and a loop', () => {
    expect(withWire(HEARTH, g, { node: 'abilities', handle: 'out:str_mod' }, 'melee')).toEqual({ definition: null, message: 'MELEE already reads STR MOD.' });
    expect(withWire(HEARTH, g, { node: 'melee', handle: 'out' }, 'melee')).toEqual({ definition: null, message: 'A formula can\'t read itself.' });
    const loop = withWire(HEARTH, g, { node: 'can', handle: 'out' }, 'spell');
    expect(loop).toEqual({ definition: null, message: 'That would make a loop: CAN already reads SPELL.' });
  });

  it('from a house rule, gives a formula one to use WITH it, and opens it to change', () => {
    const drawn = withWire(HEARTH, g, { node: 'rule:magic', handle: 'out' }, 'melee');
    expect(drawn.definition).toEqual(withAlternative(HEARTH, 'melee', { rule: 'magic' }));
    expect(drawn).toMatchObject({ message: 'MELEE now has a formula to use WITH MAGIC: change it in the panel.', open: 'melee' });
    expect(withWire(HEARTH, g, { node: 'rule:magic', handle: 'out' }, 'spell')).toMatchObject({ definition: null, open: 'spell' });
  });

  it('from a table, says how a table is read and opens the formula', () => {
    expect(withWire(HEARTH, g, { node: 'table:attribute_mod', handle: 'out' }, 'melee')).toEqual({
      definition: null, message: 'A table needs a number to read: type attribute_mod(@something) in MELEE\'s formula.', open: 'melee',
    });
  });

  it('goes only into formulas', () => {
    expect(withWire(HEARTH, g, { node: 'melee', handle: 'out' }, 'abilities').definition).toBeNull();
    expect(withWire(HEARTH, g, { node: 'melee', handle: 'out' }, 'table:attribute_mod').definition).toBeNull();
    expect(withWire(HEARTH, g, { node: 'melee', handle: 'out' }, 'can').definition).toBeNull();
    expect(withWire(HEARTH, g, { node: 'note:x', handle: 'out' }, 'melee').definition).toBeNull();
  });
});

describe('a condition\'s wires (5b6a)', () => {
  const CONDS: Definition = { ...HEARTH, derived: [...(HEARTH.derived as object[]),
    { id: 'edge', label: 'Edge', kind: 'condition', when: '@lvl > 3', then: '@str_mod + 1', else: '0' },
    { id: 'both', label: 'Both', kind: 'condition', when: '1 > 0', then: '@wit_mod', else: '@wit_mod + 1' },
  ] };
  const cg = graphOf(CONDS);
  const part = (def: Definition | null, id: string, p: string) => (formulaList(def!) as unknown as Record<string, string>[]).find((f) => f.id === id)![p];

  it('drawn in, opens the panel to compare the name in IF, changing nothing', () => {
    expect(withWire(CONDS, cg, { node: 'abilities', handle: 'out:str' }, 'can')).toEqual({
      definition: null, open: 'can', message: 'A condition compares: add STRENGTH to CAN\'s IF in the panel, and say how it compares (@str > 2).',
    });
  });

  it('refuses itself, a loop, a house rule, and says how a table is read', () => {
    expect(withWire(CONDS, cg, { node: 'can', handle: 'out' }, 'can').message).toBe('A condition can\'t read itself.');
    expect(withWire(CONDS, cg, { node: 'edge', handle: 'out' }, 'edge').definition).toBeNull();
    const looped: Definition = { ...CONDS, derived: [...(CONDS.derived as object[]), { id: 'after', formula: '@can + 1' }] };
    expect(withWire(looped, graphOf(looped), { node: 'after', handle: 'out' }, 'can').message).toBe('That would make a loop: AFTER already reads CAN.');
    expect(withWire(CONDS, cg, { node: 'rule:magic', handle: 'out' }, 'can')).toEqual({ definition: null, message: 'CAN is a condition: only a formula has one to use WITH a house rule.' });
    expect(withWire(CONDS, cg, { node: 'table:attribute_mod', handle: 'out' }, 'can')).toMatchObject({ definition: null, open: 'can' });
  });

  it('cut, takes the name out of THEN or ELSE as from a formula', () => {
    const cut = withoutWire(CONDS, cg, wireOf(cg, (w) => w.to === 'edge' && w.value === 'str_mod'));
    expect(part(cut.definition, 'edge', 'then')).toBe('1');
    expect(part(cut.definition, 'edge', 'when')).toBe('@lvl > 3');
    expect(cut.message).toBe('EDGE: took out STR MOD.');
    expect(problems(cut.definition!)).toEqual(problems(CONDS));
  });

  it('never out of IF\'s comparison, nor where it is in THEN and ELSE both: the panel opens', () => {
    expect(withoutWire(CONDS, cg, wireOf(cg, (w) => w.to === 'edge' && w.value === 'lvl'))).toEqual({
      definition: null, open: 'edge', message: 'LEVEL is compared in EDGE\'s IF: change it in the panel.',
    });
    expect(withoutWire(CONDS, cg, wireOf(cg, (w) => w.to === 'both' && w.value === 'wit_mod'))).toEqual({
      definition: null, open: 'both', message: 'WIT MOD is part of a bigger piece of BOTH: change it in the panel.',
    });
  });
});

describe('a note\'s line (5b5)', () => {
  const NOTED: Definition = { ...HEARTH, graph: { notes: [{ id: 'n1', on: 'melee', text: 'Half level.' }, { id: 'n2', text: 'Loose.' }] } };
  const ng = graphOf(NOTED);
  const notes = (def: Definition | null) => (def!.graph as { notes: { id: string; on?: string }[] }).notes;

  it('a note\'s square dot gives the note', () => {
    expect(givenBy(ng, { node: 'note:n2', handle: 'out' })).toEqual({ kind: 'note', id: 'n2' });
  });

  it('dropped on a node pins it there: a stats list, a formula, a condition, a table, a house rule', () => {
    for (const to of ['abilities', 'save', 'can', 'table:attribute_mod', 'rule:magic']) {
      const r = withWire(NOTED, ng, { node: 'note:n2', handle: 'out' }, to);
      expect(notes(r.definition)[1], to).toEqual({ id: 'n2', on: to, text: 'Loose.' });
      expect(graphOf(r.definition!).wires.some((w) => w.kind === 'note' && w.from === 'note:n2' && w.to === to), to).toBe(true);
      expect(problems(r.definition!), to).toEqual(problems(NOTED));
    }
    expect(withWire(NOTED, ng, { node: 'note:n1', handle: 'out' }, 'save').message).toBe('Note pinned to SAVE.');
  });

  it('dropped on a note, or nowhere, pins it to nothing new', () => {
    expect(withWire(NOTED, ng, { node: 'note:n2', handle: 'out' }, 'note:n1').definition).toBeNull();
    expect(withWire(NOTED, ng, { node: 'note:n2', handle: 'out' }, 'nowhere').definition).toBeNull();
  });

  it('cut, unpins it and keeps its words', () => {
    const line = wireOf(ng, (w) => w.kind === 'note');
    const r = withoutWire(NOTED, ng, line);
    expect(notes(r.definition)[0]).toEqual({ id: 'n1', text: 'Half level.' });
    expect(r.message).toBe('Note unpinned. Drag its square dot onto a node to pin it again.');
    expect(wireLabel(NOTED, line)).toBe('A note pinned to MELEE: cutting unpins it');
  });
});

describe('a wire cut', () => {
  it('takes the name out where a whole formula is left', () => {
    expect(withoutName('@a + @b', 'b')).toBe('@a');
    expect(withoutName('@a + @b', 'a')).toBe('@b');
    expect(withoutName('10 - @b + 2', 'b')).toBe('10 + 2');
    expect(withoutName('-@b + 1', 'b')).toBe('1');
    expect(withoutName('@b', 'b')).toBe('0');
    expect(withoutName('16 - max(@a, @b, @c)', 'b')).toBe('16 - max(@a, @c)');
    expect(withoutName('16 - max(@a, @b)', 'a')).toBe('16 - @b');
  });

  it('leaves alone a name inside a bigger piece, or read twice', () => {
    expect(withoutName('floor(@lvl / 2)', 'lvl')).toBeNull();
    expect(withoutName('2 * @a + 1', 'a')).toBeNull();
    expect(withoutName('1 + @a * 2', 'a')).toBeNull();
    expect(withoutName('2 * -@a', 'a')).toBeNull();
    expect(withoutName('6 / - @a + 1', 'a')).toBeNull();
    expect(withoutName('@a + @a', 'a')).toBeNull();
    expect(withoutName('table(@a)', 'a')).toBeNull();
    expect(withoutName('@ab + @a', 'a')).toBe('@ab');
  });

  it('cuts a name from a formula, as typing it out in FORMS would', () => {
    const cut = withoutWire(HEARTH, g, wireOf(g, (w) => w.to === 'melee' && w.value === 'str_mod'));
    expect(cut.definition).toEqual(withFormula(HEARTH, 'melee', { formula: 'floor(@lvl / 2)' }));
    expect(cut.message).toBe('MELEE: took out STR MOD.');
  });

  it('opens the panel where it can\'t', () => {
    expect(withoutWire(HEARTH, g, wireOf(g, (w) => w.to === 'melee' && w.value === 'lvl'))).toEqual({
      definition: null, message: 'LEVEL is part of a bigger piece of MELEE\'s formula: change it in the panel.', open: 'melee',
    });
    expect(withoutWire(HEARTH, g, wireOf(g, (w) => w.kind === 'table'))).toMatchObject({ definition: null, open: 'abilities' });
  });

  it('cuts one name from a BEST, a name from a WITH-rule formula, and a house rule\'s wire', () => {
    expect(formula(withoutWire(HEARTH, g, wireOf(g, (w) => w.to === 'save' && w.value === 'wit_mod')).definition, 'save').formula).toBe('16 - max(@str_mod, @lvl)');
    expect(formula(withoutWire(HEARTH, g, wireOf(g, (w) => w.to === 'spell' && w.alt && w.value === 'lvl')).definition, 'spell').alternative!.formula).toBe('@wit_mod');
    const gate = withoutWire(HEARTH, g, wireOf(g, (w) => w.kind === 'gate'));
    expect(gate.definition).toEqual(withAlternative(HEARTH, 'spell', { rule: null }));
    expect(gate.message).toBe('SPELL no longer has a formula to use WITH MAGIC.');
  });
});

describe('a wire named', () => {
  it('in the names players see, to ask before cutting it', () => {
    expect(wireLabel(HEARTH, wireOf(g, (w) => w.to === 'melee' && w.value === 'str_mod'))).toBe('STR MOD into MELEE');
    expect(wireLabel(HEARTH, wireOf(g, (w) => w.to === 'spell' && w.alt && w.value === 'lvl'))).toBe('LEVEL into SPELL (WITH-rule formula)');
    expect(wireLabel(HEARTH, wireOf(g, (w) => w.kind === 'gate'))).toBe("MAGIC swapping SPELL's formula");
    expect(wireLabel(HEARTH, wireOf(g, (w) => w.kind === 'table'))).toBe('The table attribute_mod into ABILITIES');
  });
});

describe('a wire into a roll (6b4a)', () => {
  const ROLLING: Definition = {
    format: 1, name: 'Rolling',
    stats: [{ id: 'skills', label: 'Skills', stats: [{ id: 'fight', label: 'Fight' }] }, { id: 'abilities', label: 'Abilities', stats: [{ id: 'str', label: 'Strength' }] }],
    derived: [{ id: 'bonus', label: 'Bonus', formula: '1' }],
    rolls: [{ id: 'skill', label: 'Skill check', dice: [{ count: '2', sides: 6 }], add: '@this + @bonus', by: ['skills', 'str'] }],
  };
  const g = graphOf(ROLLING);
  const wire = (from: string) => g.wires.find((w) => w.to === 'roll:skill' && w.from === from && (from !== 'abilities' || w.input === 'by:str'))!;

  it('cut from ROLLED BY: the roll is no longer rolled by it', () => {
    const r = withoutWire(ROLLING, g, wire('skills'));
    expect(r.definition!.rolls).toEqual([{ ...(ROLLING.rolls as object[])[0], by: ['str'] }]);
    expect(r.message).toBe('SKILL CHECK is no longer rolled by SKILLS.');
    expect(withoutWire(ROLLING, g, wire('abilities')).message).toBe('SKILL CHECK is no longer rolled by STRENGTH.');
  });

  it('cut from what its dice or adding read: changed in the panel, which opens', () => {
    expect(withoutWire(ROLLING, g, wire('bonus'))).toEqual({ definition: null, message: 'BONUS is read inside SKILL CHECK: change it in the panel.', open: 'roll:skill' });
  });

  it('drawn into it (6b4b): a stat, a formula or a whole group is something it is rolled by', () => {
    const lone: Definition = { ...ROLLING, rolls: [{ ...(ROLLING.rolls as object[])[0], by: [] }] };
    const lg = graphOf(lone);
    const into = (node: string, handle: string, def = lone, graph = lg) => withWire(def, graph, { node, handle }, 'roll:skill');
    expect(givenBy(lg, { node: 'skills', handle: 'out' })).toEqual({ kind: 'group', id: 'skills' });
    const group = into('skills', 'out');
    expect((group.definition!.rolls as { by: string[] }[])[0].by).toEqual(['skills']);
    expect(group.message).toBe('SKILL CHECK is now rolled by SKILLS: a die button by each of its stats on the sheet.');
    expect((into('abilities', 'out:str').definition!.rolls as { by: string[] }[])[0].by).toEqual(['str']);
    expect(into('abilities', 'out:str').message).toBe('SKILL CHECK is now rolled by STRENGTH: a die button by it on the sheet.');
    expect((into('bonus', 'out').definition!.rolls as { by: string[] }[])[0].by).toEqual(['bonus']);
    // Drawn again, nothing changes.
    expect(into('skills', 'out', ROLLING, g)).toEqual({ definition: null, message: 'SKILL CHECK is already rolled by SKILLS.' });
    expect(problems(group.definition!)).toEqual([]);
  });

  it('a table or a house rule is no ROLLED BY, and a whole group goes only into a roll', () => {
    const withTable: Definition = { ...ROLLING, lookups: { mod: { bands: [{ value: 0 }] } }, house_rules: [{ id: 'magic', name: 'Magic' }] };
    const tg = graphOf(withTable);
    expect(withWire(withTable, tg, { node: 'table:mod', handle: 'out' }, 'roll:skill')).toEqual({ definition: null, message: "A roll reads a table in its dice or adding: type mod(@something) in SKILL CHECK's panel.", open: 'roll:skill' });
    expect(withWire(withTable, tg, { node: 'rule:magic', handle: 'out' }, 'roll:skill')).toEqual({ definition: null, message: 'A house rule swaps formulas, not rolls.' });
    expect(withWire(ROLLING, g, { node: 'skills', handle: 'out' }, 'bonus')).toEqual({ definition: null, message: "A whole stats group goes into a roll's ROLLED BY. A formula reads one stat at a time: draw from its row." });
  });

  it('named as players see them, before it is cut', () => {
    expect(wireLabel(ROLLING, wire('skills'))).toBe('SKILL CHECK rolled by SKILLS');
    expect(wireLabel(ROLLING, wire('bonus'))).toBe('BONUS into SKILL CHECK');
  });
});

describe('over every random system and example', () => {
  const systems = [
    ...Array.from({ length: 40 }, (_, i) => randomSystem(i + 1) as Definition),
    ...(EXAMPLES as { definition: Definition }[]).map((e) => e.definition),
  ];

  it('cutting any wire takes out that wire alone, changes one formula, and adds no problem; or opens the panel', () => {
    let cut = 0;
    let opened = 0;
    let unpinned = 0;
    let unrolled = 0;
    for (const def of systems) {
      const graph = graphOf(def);
      const before = new Set(problems(def));
      for (const w of graph.wires) {
        const r = withoutWire(def, graph, w);
        if (w.kind === 'note') {
          // A note's line unpins it, and changes nothing else.
          expect(graphOf(r.definition!).wires.some((x) => x.id === w.id), w.id).toBe(false);
          expect({ ...r.definition, graph: def.graph }).toEqual(def);
          unpinned += 1;
          continue;
        }
        if (!r.definition) { expect(r.open, `${w.id}`).toBeTruthy(); opened += 1; continue; }
        if (w.to.startsWith('roll:')) {
          // ROLLED BY cut (6b4a): that one roll is no longer rolled by it, and nothing else changes.
          expect(w.input, w.id).toMatch(/^by:/);
          expect(graphOf(r.definition).wires.some((x) => x.id === w.id), w.id).toBe(false);
          const changed = rollList(r.definition).filter((x, i) => JSON.stringify(x) !== JSON.stringify(rollList(def)[i]));
          expect(changed.map((x) => `roll:${x.id}`), w.id).toEqual([w.to]);
          expect(changed[0].by ?? [], w.id).not.toContain(w.value);
          expect({ ...r.definition, rolls: def.rolls }).toEqual(def);
          expect(problems(r.definition).filter((p: string) => !before.has(p)), w.id).toEqual([]);
          unrolled += 1;
          continue;
        }
        cut += 1;
        const after = graphOf(r.definition);
        expect(after.wires.some((x) => x.id === w.id), w.id).toBe(false);
        const changed = (formulaList(r.definition) as unknown[]).filter((f, i) => JSON.stringify(f) !== JSON.stringify(formulaList(def)[i]));
        expect(changed.length, w.id).toBe(1);
        expect({ ...r.definition, derived: def.derived }).toEqual(def);
        expect(problems(r.definition).filter((p: string) => !before.has(p)), w.id).toEqual([]);
      }
    }
    expect(cut).toBeGreaterThan(50);
    expect(opened).toBeGreaterThan(5);
    expect(unpinned).toBeGreaterThan(0);
    expect(unrolled).toBeGreaterThan(5);
  });

  it('drawing a stat into a formula, then cutting it, gives the system back', () => {
    let round = 0;
    for (const def of systems) {
      const graph = graphOf(def);
      const stat = graph.nodes.find((n) => n.kind === 'list' && n.rows?.length);
      const target = graph.nodes.find((n) => n.kind === 'formula' && !n.alternative);
      if (!stat || !target) continue;
      const row = stat.rows![0];
      const drawn = withWire(def, graph, { node: stat.id, handle: `out:${row.stat}` }, target.id);
      if (!drawn.definition) continue;
      const g2 = graphOf(drawn.definition);
      const w = g2.wires.find((x) => x.to === target.id && x.value === row.stat && !x.alt)!;
      const back = withoutWire(drawn.definition, g2, w);
      const original = formula(def, target.id).formula.trim();
      expect(formula(back.definition, target.id).formula, def.name as string).toBe(original === '' ? '0' : original);
      round += 1;
    }
    expect(round).toBeGreaterThan(15);
  });

  it('reads follows formulas through their alternatives', () => {
    expect(reads(HEARTH, 'can', 'spell')).toBe(true);
    expect(reads(HEARTH, 'spell', 'lvl')).toBe(true);
    expect(reads(HEARTH, 'melee', 'wit_mod')).toBe(false);
  });
});
