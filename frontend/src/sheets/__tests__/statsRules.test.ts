/**
 * The STATS & RULES page as logic (4b2c). Approved mockup builder-stats-rules (2026-10-06): stats in
 * groups, a sample character, formulas with names, lookup tables; ids from first names, kept after.
 * Every step is held to the server's own check (backend/systemBuilder/definition.js) and engine.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import {
  statGroups, allStats, formulaList, tableList, takenIds, FUNCTIONS,
  withNewGroup, withGroupLabel, withoutGroup, withNewStat, withStat, withoutStat, sampleOf, withSample,
  withNewFormula, withFormula, withoutFormula, usedBy, problemsByFormula, insertToken,
  withNewTable, withTableLabel, withoutTable, withBands, lookupIn,
} from '../statsRules';
import type { Definition } from '../systemsApi';

const req = createRequire(import.meta.url);
const { checkDefinition } = req('../../../../backend/systemBuilder/definition.js');
const { previewDerived } = req('../../../../backend/systemBuilder/derived.js');
const { BUILTINS } = req('../../../../backend/systemBuilder/expression.js');

const H: Definition = { format: 1, name: 'Hearth' };
const problems = (def: Definition) => checkDefinition(def).problems.map((p: { where: string; message: string }) => `${p.where}: ${p.message}`);

/** Hearth with abilities STR and DEX, a mod table, and two formulas. */
const built = (): Definition => {
  let def = withNewGroup(H, 'ABILITIES');
  def = withNewStat(def, 'abilities', 'Strength');
  def = withNewStat(def, 'abilities', 'Dexterity');
  def = withStat(def, 'strength', { min: 3, max: 18 });
  def = withNewTable(def, 'Mod');
  def = withBands(def, 'mod', { add: true });
  def = withBands(def, 'mod', { set: 0, upTo: 7, value: -1 });
  def = withBands(def, 'mod', { set: 1, value: 1 });
  def = withNewFormula(def, 'Strength mod');
  def = withFormula(def, 'strength_mod', { formula: 'mod(@strength)' });
  def = withNewFormula(def, 'Save');
  def = withFormula(def, 'save', { formula: '16 - @strength_mod' });
  return def;
};

describe('held to the server', () => {
  it('names the functions the engine has', () => {
    expect([...FUNCTIONS].sort()).toEqual(Object.keys(BUILTINS).sort());
  });

  it('builds a system the server accepts at every step, and works it out', () => {
    const def = withSample(withSample(built(), 'strength', 16), 'dexterity', 12);
    expect(problems(def)).toEqual([]);
    expect(previewDerived({ lookups: def.lookups, derived: def.derived }, def.samples).values).toEqual({ strength_mod: 1, save: 15 });
  });
});

describe('stats', () => {
  it('adds groups and stats with ids from their first names, kept when renamed', () => {
    let def = built();
    expect(statGroups(def)).toEqual([{ id: 'abilities', label: 'ABILITIES', stats: [
      { id: 'strength', label: 'Strength', min: 3, max: 18 }, { id: 'dexterity', label: 'Dexterity', min: 0, max: 10 },
    ] }]);
    def = withGroupLabel(def, 'abilities', 'ATTRIBUTES');
    def = withStat(def, 'strength', { label: 'Might' });
    expect(statGroups(def)[0].label).toBe('ATTRIBUTES');
    expect(allStats(def)[0]).toEqual({ id: 'strength', label: 'Might', min: 3, max: 18 });
  });

  it('renames only the group, or table, asked for', () => {
    let def = withNewTable(withNewTable(withNewGroup(withNewGroup(H, 'ONE'), 'TWO'), 'Alpha'), 'Beta');
    def = withTableLabel(withGroupLabel(def, 'two', 'SECOND'), 'beta', 'Second table');
    expect(statGroups(def).map((g) => g.label)).toEqual(['ONE', 'SECOND']);
    expect(tableList(def).map((t) => t.label)).toEqual(['Alpha', 'Second table']);
  });

  it('never gives an id something else has', () => {
    let def = withNewGroup(H, 'Notes');
    expect(statGroups(def)[0].id).toBe('notes_2');
    def = withNewStat(def, 'notes_2', 'HP');
    expect(allStats(def)[0].id).toBe('hp_2');
    def = withNewStat(withNewTable(def, 'Mod'), 'notes_2', 'mod');
    expect(allStats(def)[1].id).toBe('mod_2');
    def = withNewTable(def, 'max');
    expect(tableList(def).map((t) => t.id)).toEqual(['mod', 'max_2']);
    expect(takenIds(H)).toEqual(expect.arrayContaining(['name', 'cash', 'hp', 'hp_max', ...FUNCTIONS]));
    expect(problems(def)).toEqual([]);
  });

  it('clears a range end, ties a skill and unties it', () => {
    let def = withNewStat(withNewGroup(built(), 'SKILLS'), 'skills', 'Shoot');
    def = withStat(def, 'shoot', { min: null, tie: 'dexterity' });
    expect(allStats(def).find((s) => s.id === 'shoot')).toEqual({ id: 'shoot', label: 'Shoot', max: 10, tie: 'dexterity' });
    expect(problems(def)).toEqual([]);
    def = withStat(def, 'shoot', { tie: '' });
    expect(allStats(def).find((s) => s.id === 'shoot')).toEqual({ id: 'shoot', label: 'Shoot', max: 10 });
  });

  it('removing a stat takes its sample and the ties to it; removing a group, all of its stats', () => {
    let def = withNewStat(withNewGroup(built(), 'SKILLS'), 'skills', 'Shoot');
    def = withStat(def, 'shoot', { tie: 'dexterity' });
    def = withSample(withSample(def, 'dexterity', 14), 'shoot', 2);
    const noDex = withoutStat(def, 'dexterity');
    expect(allStats(noDex).map((s) => s.id)).toEqual(['strength', 'shoot']);
    expect(allStats(noDex).find((s) => s.id === 'shoot')!.tie).toBeUndefined();
    expect(noDex.samples).toEqual({ shoot: 2 });
    const noAbilities = withoutGroup(def, 'abilities');
    expect(allStats(noAbilities).map((s) => s.id)).toEqual(['shoot']);
    expect(noAbilities.samples).toEqual({ shoot: 2 });
    expect('stats' in withoutGroup(withoutGroup(def, 'abilities'), 'skills')).toBe(false);
  });

  it('sets and clears a sample, the section going when empty', () => {
    let def = withSample(built(), 'strength', 16);
    expect(sampleOf(def, 'strength')).toBe(16);
    expect(sampleOf(def, 'dexterity')).toBeNull();
    def = withSample(def, 'strength', null);
    expect('samples' in def).toBe(false);
    expect('samples' in withSample(built(), 'strength', NaN)).toBe(false);
    expect(sampleOf({ ...H, samples: { strength: 'x' } }, 'strength')).toBeNull();
    expect(sampleOf({ ...H, samples: { strength: Infinity } }, 'strength')).toBeNull();
  });
});

describe('formulas', () => {
  it('names and writes one, a blank name leaving its id to show', () => {
    let def = withFormula(built(), 'save', { label: 'Physical save' });
    expect(formulaList(def).find((f) => f.id === 'save')).toEqual({ id: 'save', label: 'Physical save', formula: '16 - @strength_mod' });
    def = withFormula(def, 'save', { label: '  ' });
    expect(formulaList(def).find((f) => f.id === 'save')).toEqual({ id: 'save', formula: '16 - @strength_mod' });
    expect(withNewFormula(H).derived).toEqual([{ id: 'new_formula', label: 'New formula', formula: '0' }]);
  });

  it('says which formulas read one, by name', () => {
    const def = built();
    expect(usedBy(def, 'strength_mod')).toEqual(['Save']);
    expect(usedBy(def, 'save')).toEqual([]);
    expect(usedBy(withFormula(def, 'save', { formula: '@strength_modx' }), 'strength_mod')).toEqual([]);
    // One that reads itself is a loop, shown as a problem, not as its own user.
    expect(usedBy(withFormula(def, 'save', { formula: '@save + 1' }), 'save')).toEqual([]);
  });

  it('removes one, and the last takes the section', () => {
    const def = withoutFormula(built(), 'save');
    expect(formulaList(def).map((f) => f.id)).toEqual(['strength_mod']);
    expect('derived' in withoutFormula(def, 'strength_mod')).toBe(false);
  });

  it('pins the server\'s problems to their formulas', () => {
    const def = withFormula(built(), 'save', { formula: '16 - (' });
    const found = problemsByFormula(checkDefinition(def).problems);
    expect(Object.keys(found)).toEqual(['save']);
    expect(problemsByFormula([{ where: 'derived value 3', message: 'x' }, { where: 'lookup mod', message: 'y' }, { where: 'derived a', message: 'first' }, { where: 'derived a, formula', message: 'second' }]))
      .toEqual({ a: 'first' });
  });

  it('puts a chip at the cursor, inside the brackets of a call', () => {
    expect(insertToken('16 - ', 5, '@str')).toEqual({ text: '16 - @str', cursor: 9 });
    expect(insertToken('1 + ', 4, 'max()')).toEqual({ text: '1 + max()', cursor: 8 });
    expect(insertToken('ab', 1, '@x')).toEqual({ text: 'a@xb', cursor: 3 });
    expect(insertToken('ab', 99, '@x')).toEqual({ text: 'ab@x', cursor: 4 });
  });
});

describe('tables', () => {
  it('starts a table giving 0 for everything, and adds rows above the last', () => {
    let def = withNewTable(H, 'Mod');
    expect(tableList(def)).toEqual([{ id: 'mod', label: 'Mod', bands: [{ value: 0 }] }]);
    def = withBands(def, 'mod', { add: true });
    def = withBands(def, 'mod', { add: true });
    expect(tableList(def)[0].bands).toEqual([{ upTo: 0, value: 0 }, { upTo: 1, value: 0 }, { value: 0 }]);
    expect(problems(def)).toEqual([]);
  });

  it('sets a row, never giving the last one an "up to", and removes any but the last', () => {
    let def = withBands(withBands(withNewTable(H, 'Mod'), 'mod', { add: true }), 'mod', { add: true });
    def = withBands(def, 'mod', { set: 2, upTo: 9, value: 5 });
    expect(tableList(def)[0].bands[2]).toEqual({ value: 5 });
    def = withBands(def, 'mod', { remove: 0 });
    expect(tableList(def)[0].bands).toEqual([{ upTo: 1, value: 0 }, { value: 5 }]);
    expect(withBands(def, 'mod', { remove: 1 })).toEqual(def);
  });

  it('renames a table, keeping what formulas call, and removes it', () => {
    let def = withTableLabel(built(), 'mod', 'Attribute modifier');
    expect(tableList(def)[0]).toMatchObject({ id: 'mod', label: 'Attribute modifier' });
    expect(problems(def)).toEqual([]);
    def = withoutTable(def, 'mod');
    expect('lookups' in def).toBe(false);
    expect(problems(def).some((p: string) => p.startsWith('derived strength_mod'))).toBe(true);
  });

  it('reads a table as the engine does', () => {
    const bands = [{ upTo: 3, value: -2 }, { upTo: 7, value: -1 }, { value: 1 }];
    expect([2, 3, 4, 7, 8, 99].map((x) => lookupIn(bands, x))).toEqual([-2, -2, -1, -1, 1, 1]);
    expect(lookupIn([{ upTo: 1, value: 4 }], 5)).toBe(0);
  });
});
