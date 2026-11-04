/**
 * has(name) in formulas (7b; the plan's "only while the character has this feature"): 1 while the
 * character holds that option, or has that feature unlocked, else 0. Read wherever levels are:
 * formulas, requirements, a feature's amount, a roll's ADD, a rest's amount, recovery dice. Its
 * argument is a name, which the language allows nowhere else. A name that is no option or feature
 * is a problem, not a silent "doesn't have it".
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require_ = createRequire(import.meta.url);
const { parse, evaluate, references, BUILTINS } = require_('../systemBuilder/expression');
const { checkDefinition } = require_('../systemBuilder/definition');
const { PICKS_KEY, overlayOf, effectiveData, heldOf, meets, needsText, valueOn, choicesShown, ownableOf } = require_('../systemBuilder/choices');
const { pickAction } = require_('../systemBuilder/picking');
const { metaOf } = require_('../systemBuilder/runtime');
const { rollField } = require_('../systemBuilder/tableRolls');
const { restOn } = require_('../systemBuilder/resting');
const { previewFormula } = require_('../systemBuilder/formulaPreview');

const CLASSES = { id: 'classes', one: 'Class', many: 'Classes', levelled: true, again: true, options: [
  { id: 'soldier', label: 'Soldier', features: [
    { id: 'second_wind', label: 'Second Wind' },
    { id: 'veteran', label: 'Veteran', at: 3, modifiers: [{ target: 'grit', amount: 'if(has(mage), 5, 1)' }] },
  ] },
  { id: 'mage', label: 'Mage', requires: 'has(second_wind) and @grit >= 2' },
] };
const COMMONS = { id: 'commons', one: 'Common', many: 'Commons', picked: 'everyone', options: [
  { id: 'trained', label: 'Trained', requires: 'has(soldier)' },
  { id: 'adept', label: 'Adept', requires: 'has(trained)' },
] };
const HEARTH = {
  format: 1, name: 'Hearth',
  stats: [{ id: 'traits', label: 'TRAITS', stats: [{ id: 'grit', label: 'Grit' }] }],
  derived: [
    { id: 'guard', label: 'Guard', formula: '10 + 2 * has(second_wind)' },
    { id: 'rank', label: 'Rank', kind: 'condition', when: 'has(veteran)', then: '2', else: '1' },
    { id: 'tricky', label: 'Tricky', formula: 'if(not has(mage), 0, @mage_level)' },
  ],
  rolls: [{ id: 'save', label: 'Save', dice: [{ count: '1', sides: 20 }], add: '@this + has(soldier)', by: ['grit'] }],
  rests: { short_rest: { refills: [{ what: 'grit', how: 'by', amount: 'if(has(soldier), 3, 1)' }] } },
  choices: [CLASSES, COMMONS],
};
const SOLDIER = (level = 1) => ({ [PICKS_KEY]: { classes: [{ option: 'soldier', level }] } });
const worked = (data) => { const d = { grit: 2, ...data }; metaOf(HEARTH).recompute(d); return d; };
const problems = (def) => checkDefinition(def).problems.map((p) => `${p.where}: ${p.message}`);

describe('the language', () => {
  const read = (text, fields = {}) => evaluate(parse(text), { field: (n) => fields[n] ?? 0, rule: () => 0, table: () => 0 });

  it('reads has(name) as 1 or 0, on its own or inside anything, its name kept apart from the fields', () => {
    expect(read('has(a)', { 'has:a': 1 })).toBe(1);
    expect(read('has(a)')).toBe(0);
    expect(read('has( a )', { 'has:a': 7 })).toBe(1);
    expect(read('2 * has(a) + 1', { 'has:a': 1 })).toBe(3);
    expect(read('if(not has(a), 4, 9)')).toBe(4);
    const refs = references(parse('has(a) + @b + has(c) + has(a)'));
    expect([...refs.has]).toEqual(['a', 'c']);
    expect([...refs.fields]).toEqual(['b']);
  });

  it('takes a name and only a name', () => {
    const said = 'has() takes the name of an option or feature, like has(second_wind)';
    for (const bad of ['has()', 'has(1)', 'has(@a)', 'has(a, b)', 'has(a + 1)', 'has(has(a))']) expect(() => parse(bad), bad).toThrow(said);
    expect(() => parse('has')).toThrow('on its own means nothing');
  });

  it('is a name nothing else can take: a table called has is refused', () => {
    expect(BUILTINS.has).toBeTruthy();
    const table = { format: 1, name: 'T', lookups: { has: { bands: [{ value: 1 }] } } };
    expect(problems(table).join()).toContain('"has" is a built-in function; pick another name');
  });
});

describe('at the table', () => {
  it('the system checks clean', () => {
    expect(problems(HEARTH)).toEqual([]);
  });

  it('is 1 for an option held and a feature unlocked, and not one above its level or not picked', () => {
    const low = overlayOf(HEARTH, SOLDIER(1)).sheet;
    expect(low).toMatchObject({ 'has:soldier': 1, 'has:second_wind': 1 });
    expect(low).not.toHaveProperty('has:veteran');
    expect(low).not.toHaveProperty('has:mage');
    expect(overlayOf(HEARTH, SOLDIER(3)).sheet).toMatchObject({ 'has:veteran': 1 });
    expect(overlayOf(HEARTH, {}).sheet).not.toHaveProperty('has:soldier');
  });

  it('never reaches what a sheet is told of its levels', () => {
    expect(Object.keys(overlayOf(HEARTH, SOLDIER(1)).levels).some((k) => k.startsWith('has:'))).toBe(false);
  });

  it('reads in a formula and a condition, and goes when the pick does', () => {
    expect(worked({})).toMatchObject({ guard: 10, rank: 1, tricky: 0 });
    expect(worked(SOLDIER(1))).toMatchObject({ guard: 12, rank: 1 });
    expect(worked(SOLDIER(3))).toMatchObject({ guard: 12, rank: 2 });
    expect(worked({ [PICKS_KEY]: { classes: [{ option: 'soldier', level: 1 }, { option: 'mage', level: 4 }] } }).tricky).toBe(4);
  });

  it('reads in a feature\'s amount, without going round: VETERAN gives 1, or 5 with MAGE', () => {
    expect(overlayOf(HEARTH, { grit: 2, ...SOLDIER(3) }).sheet.grit).toBe(3);
    expect(overlayOf(HEARTH, { grit: 2, [PICKS_KEY]: { classes: [{ option: 'soldier', level: 3 }, { option: 'mage', level: 1 }] } }).sheet.grit).toBe(7);
  });

  it('is a requirement: needed to pick, said in names, and the GM may go past it', () => {
    const mage = CLASSES.options[1];
    expect(meets(HEARTH, { grit: 2 }, mage)).toBe(false);
    expect(meets(HEARTH, { grit: 2, ...SOLDIER(1) }, mage)).toBe(true);
    expect(needsText(HEARTH, mage.requires)).toBe('SECOND WIND and GRIT >= 2');
    expect(choicesShown(HEARTH)[0].options[1].needs).toBe('SECOND WIND and GRIT >= 2');
    const pick = { kind: 'pick', list: 'classes', option: 'mage' };
    expect(pickAction(HEARTH, { grit: 2 }, pick)).toEqual({ ok: false, error: 'Mage needs SECOND WIND and GRIT >= 2' });
    expect(pickAction(HEARTH, { grit: 2, ...SOLDIER(1) }, pick).ok).toBe(true);
    expect(pickAction(HEARTH, { grit: 2 }, pick, { gm: true }).ok).toBe(true);
  });

  it('on a list everyone has, reads what is picked, never another of that list: nothing goes round', () => {
    const everyone = (data) => heldOf(HEARTH, data).filter((p) => p.list.id === 'commons').map((p) => p.option.id);
    expect(everyone({})).toEqual([]);
    expect(everyone(SOLDIER(1))).toEqual(['trained']);
    // Once held, has(trained) reads true elsewhere, as an option everyone has counts.
    expect(overlayOf(HEARTH, SOLDIER(1)).sheet).toMatchObject({ 'has:trained': 1 });
    expect(valueOn(HEARTH, SOLDIER(1), 'has(trained)')).toBe(1);
    expect(valueOn(HEARTH, {}, 'has(trained)')).toBe(0);
  });

  it('reads in a roll\'s ADD', () => {
    const roll = (data) => rollField({ definition: HEARTH, data: { grit: 2, ...data }, fieldId: 'grit', rng: () => 0.5, who: 'Wren' });
    const without = roll({});
    const withIt = roll(SOLDIER(1));
    expect(withIt.total - without.total).toBe(1);
  });

  it('reads in a rest\'s amount', () => {
    const rest = (data) => restOn({ definition: HEARTH, restId: 'short_rest', sheet: { grit: 2, ...data } }).sheetPatch.grit;
    expect(rest({})).toBe(3);
    expect(rest(SOLDIER(1))).toBe(5);
  });

  it('reads through what the rolls and recovery dice read', () => {
    expect(effectiveData(HEARTH, SOLDIER(1))['has:soldier']).toBe(1);
    expect(valueOn(HEARTH, SOLDIER(1), '3 * has(second_wind)')).toBe(3);
  });

  it('is 0 for a pick kept but not counting: under a feature that has locked again', () => {
    const nested = {
      format: 1, name: 'N',
      choices: [
        { id: 'classes', one: 'Class', many: 'Classes', levelled: true, options: [{ id: 'soldier', label: 'Soldier', features: [{ id: 'specialty', label: 'Specialty', at: 3, choice: 'specs' }] }] },
        { id: 'specs', one: 'Spec', many: 'Specs', picked: 'features', options: [{ id: 'duelist', label: 'Duelist', features: [{ id: 'riposte', label: 'Riposte' }] }] },
      ],
    };
    const at = (level) => overlayOf(nested, { [PICKS_KEY]: { classes: [{ option: 'soldier', level }], specs: [{ option: 'duelist', from: 'specialty' }] } }).sheet;
    expect(at(3)).toMatchObject({ 'has:duelist': 1, 'has:riposte': 1 });
    expect(at(2)).not.toHaveProperty('has:duelist');
    expect(at(2)).not.toHaveProperty('has:riposte');
  });
});

describe('a name that is no option or feature', () => {
  const said = (name) => `has(${name}): no option or feature is called that`;

  it('is a problem wherever formula text sits, named as the other checks name it', () => {
    const def = {
      format: 1, name: 'Slips',
      stats: [{ id: 'traits', label: 'TRAITS', stats: [{ id: 'grit', label: 'Grit' }] }],
      derived: [
        { id: 'a', formula: 'has(nope)' },
        { id: 'b', kind: 'condition', when: 'has(no_when)', then: 'has(no_then)', else: 'has(no_else)' },
        { id: 'c', formula: '1', alternative: { rule: 'r', formula: 'has(no_alt)' } },
      ],
      house_rules: [{ id: 'r', name: 'R' }],
      rolls: [{ id: 'save', label: 'Save', dice: [{ count: '1', sides: 20 }], add: 'has(no_add)', against: 'has(no_against)' }],
      choices: [{ id: 'l', one: 'L', many: 'Ls', options: [{ id: 'o', label: 'O', requires: 'has(no_req)', features: [
        { id: 'f', label: 'F', modifiers: [{ target: 'grit', amount: 'has(no_amount)' }], uses: { count: 'has(no_uses)', refill: 'short_rest' } },
      ] }] }],
      rests: { short_rest: { refills: [{ what: 'grit', how: 'by', amount: 'has(no_rest)' }] } },
    };
    const found = problems(def).filter((p) => p.includes('no option or feature'));
    expect(found).toEqual(expect.arrayContaining([
      `derived a, formula: ${said('nope')}`,
      `derived b, when: ${said('no_when')}`,
      `derived b, then: ${said('no_then')}`,
      `derived b, else: ${said('no_else')}`,
      `derived c, alternative, formula: ${said('no_alt')}`,
      `roll save, add: ${said('no_add')}`,
      `roll save, against: ${said('no_against')}`,
      `list l, option o, requires: ${said('no_req')}`,
      `list l, option o, feature f, modifiers, amount: ${said('no_amount')}`,
      `list l, option o, feature f, uses, count: ${said('no_uses')}`,
    ]));
    expect(found.join()).toContain(said('no_rest'));
  });

  it('isn\'t looked for in words: a description may say has(anything)', () => {
    const def = { format: 1, name: 'Words', description: 'has(nothing)', choices: [{ id: 'l', one: 'L', many: 'Ls', options: [{ id: 'o', label: 'O', description: 'has(nothing)', features: [{ id: 'f', label: 'F', text: 'has(nothing)' }] }] }] };
    expect(problems(def)).toEqual([]);
  });

  it('every option and feature can be named, with what players call it', () => {
    expect([...ownableOf(HEARTH)]).toEqual([
      ['soldier', 'Soldier'], ['second_wind', 'Second Wind'], ['veteran', 'Veteran'], ['mage', 'Mage'], ['trained', 'Trained'], ['adept', 'Adept'],
    ]);
  });
});

describe('the formula box', () => {
  it('says what it reads by name, and it reads 0 on a sample with no picks', () => {
    expect(previewFormula(HEARTH, '2 * has(second_wind)', 'formula')).toMatchObject({ ok: true, value: 0, reads: [{ id: 'has:second_wind', label: 'Second Wind', value: 0 }] });
    expect(previewFormula(HEARTH, 'has(soldier) and @grit >= 1', 'requires').reads.map((r) => r.id)).toEqual(['grit', 'has:soldier']);
  });

  it('catches a slip, a misspelt name or a wrong argument', () => {
    expect(previewFormula(HEARTH, 'has(secnd_wind)', 'formula')).toEqual({ ok: false, problem: 'No option or feature is called "secnd_wind"' });
    expect(previewFormula(HEARTH, 'has(1)', 'formula')).toEqual({ ok: false, problem: 'has() takes the name of an option or feature, like has(second_wind) (at character 5)' });
  });
});
