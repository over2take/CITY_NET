/**
 * Choices on the graph (7a5c). Approved mockup nested-choices, section 3 and its decision that they
 * are read-only there: a list with levels is a LEVELS node, a row and a dot for its total and each
 * option's level, so a formula reading @soldier_level is wired as any other; a feature's modifier is
 * a dashed wire from its list into what it changes, refused a cut; a list with neither stays off.
 * Everything else about the map works on the node as on any other, and the server takes it.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { graphOf, layoutOf, columnsOf, heightOf, SIZE } from '../graphModel';
import { withWire, withoutWire, givenBy, wireLabel } from '../graphEdits';
import { withRemoved } from '../graphAdds';
import { pinChoices } from '../graphNotes';
import { listsOnMap } from '../choices';
import { formulaList } from '../statsRules';
import type { Definition } from '../systemsApi';

const req = createRequire(import.meta.url);
const { checkDefinition } = req('../../../../backend/systemBuilder/definition.js');

const HEARTH = {
  format: 1, name: 'Hearth',
  stats: [{ id: 'abilities', label: 'Abilities', stats: [{ id: 'str', label: 'Strength' }, { id: 'wit', label: 'Wits' }] }],
  lookups: { mod: { label: 'Mod', bands: [{ upTo: 13, value: 0 }, { value: 1 }] } },
  derived: [
    { id: 'str_mod', label: 'Str mod', formula: 'mod(@str)' },
    { id: 'wit_mod', label: 'Wit mod', formula: 'mod(@wit)' },
    { id: 'ward', label: 'Ward', formula: '10 + @mage_level' },
    { id: 'defense', label: 'Defense', formula: '10' },
    { id: 'pace', label: 'Pace', formula: '@level + @classes_level' },
  ],
  choices: [
    { id: 'classes', one: 'Class', many: 'Classes', levelled: true, options: [
      { id: 'soldier', label: 'Soldier', features: [
        { id: 'guard', label: 'Guard Stance', modifiers: [{ target: 'defense', amount: '1' }] },
        { id: 'tough', label: 'Tough', modifiers: [{ target: 'hp_max', amount: '2 * @level' }] },
      ] },
      { id: 'mage', label: 'Mage', features: [
        { id: 'sharp', label: 'Sharp', modifiers: [{ target: 'wit', amount: '-1' }, { target: 'str_mod', amount: '@mage_level * 2' }] },
      ] },
    ] },
    { id: 'feats', one: 'Feat', many: 'Feats', picks: 'any', options: [{ id: 'keen', label: 'Keen', features: [{ id: 'keen_eye', label: 'Keen Eye', modifiers: [{ target: 'defense', amount: '2' }] }] }] },
    { id: 'backgrounds', one: 'Background', many: 'Backgrounds', options: [{ id: 'dockhand', label: 'Dockhand' }] },
  ],
} as unknown as Definition;

const nodeOf = (def: Definition, id: string) => graphOf(def).nodes.find((n) => n.id === id);

describe('a list on the map', () => {
  it('the system is one the server takes', () => {
    expect(checkDefinition(HEARTH).problems).toEqual([]);
  });

  it('a levelled list is a node: its total, each option, and the character\'s level on the first', () => {
    const classes = nodeOf(HEARTH, 'choices:classes')!;
    expect(classes).toMatchObject({ kind: 'levels', label: 'CLASSES', list: 'classes', bonuses: 3 });
    expect(classes.rows!.map((r) => [r.label, r.stat])).toEqual([['TOTAL', 'classes_level'], ['SOLDIER', 'soldier_level'], ['MAGE', 'mage_level'], ['CHARACTER', 'level']]);
    expect(classes.height).toBe(SIZE.header + 5 * SIZE.listRow + SIZE.pad + SIZE.border);
    expect(heightOf({ ...classes, bonuses: 0 })).toBe(SIZE.header + 4 * SIZE.listRow + SIZE.pad + SIZE.border);
  });

  it('a list without levels shows only its bonuses; with neither, it stays off', () => {
    const feats = nodeOf(HEARTH, 'choices:feats')!;
    expect(feats).toMatchObject({ kind: 'levels', label: 'FEATS', rows: [], bonuses: 1 });
    expect(nodeOf(HEARTH, 'choices:backgrounds')).toBeUndefined();
    expect(listsOnMap(HEARTH).map((c) => c.id)).toEqual(['classes', 'feats']);
  });

  it('one whose only modifiers land off the map has nothing to show, and no system has a node for nothing', () => {
    const def = { ...HEARTH, choices: [{ id: 'hardy', one: 'Hardy', many: 'Hardies', options: [{ id: 'h', label: 'H', features: [{ id: 'hf', label: 'HF', modifiers: [{ target: 'hp_max', amount: '1' }] }] }] }] } as unknown as Definition;
    expect(nodeOf(def, 'choices:hardy')).toBeUndefined();
    expect(graphOf({ format: 1, name: 'Plain' } as Definition).nodes).toEqual([]);
  });

  it('a system\'s own level keeps its name: the stat is wired, no CHARACTER row', () => {
    const def = { ...HEARTH, stats: [{ id: 'abilities', label: 'Abilities', stats: [{ id: 'level', label: 'Tier' }, { id: 'str', label: 'Strength' }, { id: 'wit', label: 'Wits' }] }] } as Definition;
    expect(nodeOf(def, 'choices:classes')!.rows!.map((r) => r.stat)).not.toContain('level');
    expect(graphOf(def).wires.find((w) => w.to === 'pace' && w.value === 'level')).toMatchObject({ from: 'abilities', fromHandle: 'out:level' });
  });

  it('sits left of everything, so its wires read left to right; without one, nothing moves', () => {
    const g = graphOf(HEARTH);
    expect(columnsOf(g)['choices:classes']).toBe(-1);
    const at = layoutOf(g);
    expect(at['choices:classes'].x).toBeLessThan(at.abilities.x);
    expect(at['choices:classes'].x).toBe(SIZE.left);
    const plain = graphOf({ ...HEARTH, choices: undefined } as unknown as Definition);
    expect(layoutOf(plain)['table:mod'].x).toBe(SIZE.left);
  });
});

describe('its levels, read by a formula', () => {
  it('wired from their rows as any value, the formula\'s words in names', () => {
    const g = graphOf(HEARTH);
    expect(g.wires.filter((w) => w.from === 'choices:classes' && w.kind === 'value').map((w) => [w.fromHandle, w.to])).toEqual([
      ['out:mage_level', 'ward'], ['out:level', 'pace'], ['out:classes_level', 'pace'],
    ]);
    expect(g.nodes.find((n) => n.id === 'ward')!.text).toBe('10 + MAGE LEVEL');
    expect(g.nodes.find((n) => n.id === 'pace')!.text).toBe('LEVEL + CLASSES LEVEL');
    expect(g.nodes.find((n) => n.id === 'ward')!.inputs[0]).toMatchObject({ kind: 'value', label: 'MAGE LEVEL' });
  });

  it('drawn from a row into a formula, it is that formula\'s text; cut, it comes out again', () => {
    const g = graphOf(HEARTH);
    const dot = { node: 'choices:classes', handle: 'out:soldier_level' };
    expect(givenBy(g, dot)).toEqual({ kind: 'value', id: 'soldier_level' });
    const drawn = withWire(HEARTH, g, dot, 'defense');
    expect(formulaList(drawn.definition!).find((f) => f.id === 'defense')!.formula).toBe('10 + @soldier_level');
    const wire = graphOf(drawn.definition!).wires.find((w) => w.value === 'soldier_level')!;
    const cut = withoutWire(drawn.definition!, graphOf(drawn.definition!), wire);
    expect(formulaList(cut.definition!).find((f) => f.id === 'defense')!.formula).toBe('10');
  });

  it('nothing is wired into a list\'s levels, nor out of its bonuses', () => {
    const g = graphOf(HEARTH);
    const r = withWire(HEARTH, g, { node: 'abilities', handle: 'out:str' }, 'choices:classes');
    expect(r).toEqual({ definition: null, message: 'A list\'s levels come from what characters pick, so nothing is wired into them. Drop the wire on a formula.' });
    expect(givenBy(g, { node: 'choices:classes', handle: 'bonus' })).toBeNull();
  });
});

describe('a feature\'s bonus', () => {
  const bonuses = () => graphOf(HEARTH).wires.filter((w) => w.kind === 'bonus');

  it('is a wire from its list into what it changes, into a formula as a row of its own', () => {
    expect(bonuses().map((w) => [w.from, w.fromHandle, w.to, w.about])).toEqual([
      ['choices:classes', 'bonus', 'abilities', 'SHARP −1 from CLASSES into WITS'],
      ['choices:classes', 'bonus', 'abilities', 'SHARP + MAGE LEVEL × 2 from CLASSES into STR MOD'],
      ['choices:classes', 'bonus', 'defense', 'GUARD STANCE +1 from CLASSES into DEFENSE'],
      ['choices:feats', 'bonus', 'defense', 'KEEN EYE +2 from FEATS into DEFENSE'],
    ]);
    const defense = nodeOf(HEARTH, 'defense')!;
    expect(defense.inputs.map((i) => [i.kind, i.label, i.about])).toEqual([
      ['bonus', 'GUARD STANCE +1', 'BONUS · CLASSES'], ['bonus', 'KEEN EYE +2', 'BONUS · FEATS'],
    ]);
    expect(defense.height).toBe(heightOf({ ...defense, inputs: [] }) + 2 * SIZE.row);
  });

  it('into a stats group, by the row it changes: a stat, or a modifier that is a column on it', () => {
    const list = nodeOf(HEARTH, 'abilities')!;
    expect(list.inputs.filter((i) => i.kind === 'bonus').map((i) => i.on)).toEqual(['wit', 'str_mod']);
    expect(list.rows!.map((r) => [r.stat, r.mod])).toEqual([['str', 'str_mod'], ['wit', 'wit_mod']]);
    // No row to say what it is, so the wire says it; one into a formula has its row.
    expect(bonuses().map((w) => [w.to, w.modifier])).toEqual([
      ['abilities', 'SHARP −1'], ['abilities', 'SHARP + MAGE LEVEL × 2'], ['defense', undefined], ['defense', undefined],
    ]);
  });

  it('skips what isn\'t on the map: the health boxes have no node', () => {
    expect(bonuses().some((w) => w.value === 'tough')).toBe(false);
  });

  it('can\'t be cut: it is set on CHOICES, and asking says what it is', () => {
    const g = graphOf(HEARTH);
    const w = g.wires.find((x) => x.kind === 'bonus' && x.value === 'guard')!;
    expect(withoutWire(HEARTH, g, w)).toEqual({ definition: null, message: 'A feature\'s bonus is set on CHOICES, on its feature.' });
    expect(wireLabel(HEARTH, w)).toBe('GUARD STANCE +1 from CLASSES into DEFENSE');
  });

  it('doesn\'t add to the columns: a formula with only a bonus sits where it did', () => {
    const col = columnsOf(graphOf(HEARTH));
    expect(col.defense).toBe(1);
  });
});

describe('the rest of the map', () => {
  it('a list\'s node can\'t be removed from here, and says where it is', () => {
    expect(withRemoved(HEARTH, 'choices:classes')).toEqual({ definition: null, message: 'Lists are made and removed on CHOICES: this only shows what they give.' });
  });

  it('a note may be pinned to it, and the server takes that and where the node sits', () => {
    expect(pinChoices(HEARTH)).toEqual(expect.arrayContaining([{ id: 'choices:classes', label: 'CHOICES CLASSES' }, { id: 'choices:feats', label: 'CHOICES FEATS' }]));
    expect(pinChoices(HEARTH).map((p) => p.id)).not.toContain('choices:backgrounds');
    const def = { ...HEARTH, graph: { positions: { 'choices:classes': [48, 48] }, notes: [{ id: 'n1', on: 'choices:classes', text: 'Multiclassing allowed.' }] } } as unknown as Definition;
    expect(checkDefinition(def).problems).toEqual([]);
    expect(graphOf(def).wires.find((w) => w.kind === 'note')).toMatchObject({ from: 'note:n1', to: 'choices:classes' });
  });
});
