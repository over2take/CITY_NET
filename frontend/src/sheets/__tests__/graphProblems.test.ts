/**
 * PROBLEMS on the graph view (5b6b). Approved mockup builder-graph (2026-10-17): the same server
 * check as PROBLEMS, each one clickable to its node, and a map-only warning for a formula that isn't
 * on the character sheet and that nothing reads. Held to the server's own check: every problem it
 * finds with a stat, formula, table or house rule lands on the node that shows it.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { mapProblems, nodeShowing } from '../graphProblems';
import { graphOf } from '../graphModel';
import type { Definition } from '../systemsApi';

const req = createRequire(import.meta.url);
const { checkDefinition } = req('../../../../backend/systemBuilder/definition.js');
const { randomSystem } = req('../../../../backend/__tests__/helpers/randomSystem.js');

const HEARTH: Definition = {
  format: 1,
  name: 'Hearth',
  stats: [
    { id: 'character', label: 'Character', stats: [{ id: 'lvl', label: 'Level' }] },
    { id: 'abilities', label: 'Abilities', stats: [{ id: 'str', label: 'Strength' }] },
  ],
  lookups: { attribute_mod: { label: 'Attribute mod', bands: [{ upTo: 13, value: 0 }, { value: 1 }] } },
  derived: [
    { id: 'str_mod', label: 'Str mod', formula: 'attribute_mod(@str)' },
    { id: 'melee', label: 'Melee attack', formula: '@str_mod + @nowhere' },
    { id: 'spare', label: 'Spare', formula: '1' },
    { id: 'shown', label: 'Shown', formula: '2' },
  ],
  house_rules: [{ id: 'magic', name: 'Magic' }],
};
const g = graphOf(HEARTH);
const on = (where: string, message = 'Wrong') => mapProblems(HEARTH, g, [{ where, message }])[0];

describe('the server\'s problems, on the map', () => {
  it('each tied to the node that shows what it is about, in players\' names', () => {
    expect(on('derived melee, formula', 'No stat or formula called @nowhere')).toEqual({ kind: 'error', text: 'MELEE ATTACK: No stat or formula called @nowhere', node: 'melee' });
    expect(on('derived melee')).toMatchObject({ node: 'melee' });
    // A roll's (6b4a), on its ROLL node.
    const rolling = { ...HEARTH, rolls: [{ id: 'skill', label: 'Skill check', dice: [{ count: '2', sides: 6 }] }] };
    expect(mapProblems(rolling, graphOf(rolling), [{ where: 'roll skill, by 1', message: 'Wrong' }])[0]).toEqual({ kind: 'error', text: 'ROLL SKILL CHECK: Wrong', node: 'roll:skill' });
    expect(mapProblems(rolling, graphOf(rolling), [{ where: 'roll nope', message: 'Wrong' }])[0].node).toBeNull();
    expect(on('derived melee, alternative, formula')).toMatchObject({ node: 'melee', text: 'MELEE ATTACK: Wrong' });
    // A modifier shown as a column of its stats list, and a stat as a row of it.
    expect(on('derived str_mod, formula')).toEqual({ kind: 'error', text: 'STR MOD: Wrong', node: 'abilities' });
    expect(on('stat str, max')).toEqual({ kind: 'error', text: 'STRENGTH: Wrong', node: 'abilities' });
    expect(on('samples lvl')).toEqual({ kind: 'error', text: 'LEVEL: Wrong', node: 'character' });
    expect(on('stats abilities, stats')).toEqual({ kind: 'error', text: 'STATS ABILITIES: Wrong', node: 'abilities' });
    expect(on('lookup attribute_mod, bands')).toEqual({ kind: 'error', text: 'TABLE ATTRIBUTE MOD: Wrong', node: 'table:attribute_mod' });
    expect(on('house rule magic, name')).toEqual({ kind: 'error', text: 'HOUSE RULE MAGIC: Wrong', node: 'rule:magic' });
  });

  it('one about another page, or nothing the map shows, says where it is, with no node', () => {
    expect(on('words currency', 'Too long')).toEqual({ kind: 'error', text: 'words currency: Too long', node: null });
    expect(on('derived gone, formula')).toEqual({ kind: 'error', text: 'derived gone, formula: Wrong', node: null });
    expect(on('lookup gone')).toMatchObject({ node: null });
    expect(on('house rule gone')).toMatchObject({ node: null });
    expect(on('derived value 3')).toMatchObject({ node: null });
    expect(on('stat strength_2')).toMatchObject({ node: null });
    // An entry with no id is "derived value 3": not the formula that happens to be called value.
    const valued = { ...HEARTH, derived: [...(HEARTH.derived as object[]), { id: 'value', formula: '1' }] };
    expect(mapProblems(valued, graphOf(valued), [{ where: 'derived value 3', message: 'Needs an id' }])[0].node).toBeNull();
    expect(mapProblems(valued, graphOf(valued), [{ where: 'derived value', message: 'Wrong' }])[0].node).toBe('value');
  });

  it('what shows a stat or formula: its own node, or the list it is a row or modifier of; never a note', () => {
    expect(nodeShowing(g, 'melee')).toBe('melee');
    expect(nodeShowing(g, 'str')).toBe('abilities');
    expect(nodeShowing(g, 'str_mod')).toBe('abilities');
    expect(nodeShowing(g, 'nowhere')).toBeNull();
    const noted = graphOf({ ...HEARTH, graph: { notes: [{ id: 'n1', text: 'x' }] } });
    expect(nodeShowing(noted, 'note:n1')).toBeNull();
  });

  it('every one the server finds in forty random systems with a broken formula: a formula\'s on its node', () => {
    let tied = 0;
    for (let i = 1; i <= 40; i += 1) {
      const def = randomSystem(i) as Definition;
      const derived = (def.derived as { id: string }[] | undefined) ?? [];
      if (!derived.length) continue;
      const broken = { ...def, derived: derived.map((d, k) => (k === 0 ? { id: d.id, formula: '@not_a_name + (' } : d)) };
      const graph = graphOf(broken);
      const found = mapProblems(broken, graph, checkDefinition(broken).problems);
      const mine = found.filter((p) => p.kind === 'error' && p.node === nodeShowing(graph, derived[0].id));
      expect(mine.length, `seed ${i}`).toBeGreaterThan(0);
      for (const p of found.filter((x) => x.node)) expect(graph.nodes.some((n) => n.id === p.node), `seed ${i} ${p.text}`).toBe(true);
      tied += mine.length;
    }
    expect(tied).toBeGreaterThan(10);
  });
});

describe('the map\'s own warning', () => {
  const SHEET = { sections: [{ id: 'main', label: 'MAIN', fields: [{ id: 'shown', label: 'Shown' }, { id: 'melee', label: 'Melee' }] }] };

  it('a formula a customized sheet leaves off that nothing reads, after the errors', () => {
    const def = { ...HEARTH, sheet: SHEET };
    expect(mapProblems(def, graphOf(def), [{ where: 'derived melee, formula', message: 'Wrong' }])).toEqual([
      { kind: 'error', text: 'MELEE ATTACK: Wrong', node: 'melee' },
      { kind: 'warning', text: "SPARE isn't on the character sheet, and nothing reads it", node: 'spare' },
    ]);
  });

  it('none for one read by another formula, on the sheet, already in error, or on the starter sheet', () => {
    const def = { ...HEARTH, sheet: SHEET };
    // STR MOD is off the sheet, but MELEE reads it.
    expect(mapProblems(def, graphOf(def), []).map((p) => p.text)).toEqual(["SPARE isn't on the character sheet, and nothing reads it"]);
    expect(mapProblems(def, graphOf(def), [{ where: 'derived spare, formula', message: 'Wrong' }]).filter((p) => p.kind === 'warning')).toEqual([]);
    expect(mapProblems(HEARTH, g, [])).toEqual([]);
  });
});
