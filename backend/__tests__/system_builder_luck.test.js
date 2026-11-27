import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

/**
 * Luck (8c5a; approved mockup docs/mockups/rule-library.html, section 1's LUCK card, answers 6 and 7): what it is called, the
 * most a character has (a formula of their own), +1 or a die a point, on every roll or some, refilled by the rests ticked;
 * checked as strictly as the rest of an untrusted file, worked out on a sheet, spent on a roll, refilled at a rest, and carried
 * beside the system in its file.
 */

const require_ = createRequire(import.meta.url);
const { LUCK_KEY, EACH, LIMITS, START, checkLuck, luckRuleOf, luckOf, luckOn, withLuck, refilledAt, luckShown } = require_('../systemBuilder/luck');
const { checkDefinition } = require_('../systemBuilder/definition');
const { rollField } = require_('../systemBuilder/tableRolls');
const { restOn } = require_('../systemBuilder/resting');
const { renderOf } = require_('../systemBuilder/runtime');
const citysys = require_('../systemBuilder/citysys');
const { versionChanges } = require_('../systemBuilder/versionDiff');

const OWN = {
  format: 1, name: 'Luckfall',
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'aim', label: 'Aim' }, { id: 'luck', label: 'Luck' }] }],
  rolls: [
    { id: 'shoot', label: 'Shoot', dice: [{ count: '2', sides: 6 }], add: '@this', by: ['aim'] },
    { id: 'dodge', label: 'Dodge', dice: [{ count: '1', sides: 20 }], add: '@this', by: ['luck'] },
  ],
};
const CPR = { name: 'Luck', most: '@luck', each: 'plus', on: 'all', refills: ['end_of_session'] };
const POOL = { name: 'Edge', most: '3', each: 'die', on: ['shoot'], refills: ['end_of_scene'] };
const problemsOf = (luck, extra = {}) => { const p = []; checkLuck({ ...OWN, ...extra, luck }, p); return p.map((x) => `${x.where}: ${x.message}`); };
const ruleOf = (luck) => luckRuleOf({ ...OWN, luck });
/** Dice that land on these faces, in turn, whatever their size. */
const faces = (sides, ...shown) => { let i = 0; return () => (shown[Math.min(i++, shown.length - 1)] - 0.5) / sides; };

describe('the luck section, checked', () => {
  it('the two presets drawn are fine, as is a section left empty', () => {
    for (const l of [CPR, POOL, {}]) expect(problemsOf(l)).toEqual([]);
    expect(checkDefinition({ ...OWN, luck: CPR }).problems).toEqual([]);
    expect(EACH).toEqual(['plus', 'die']);
  });

  it('refuses what is not part of it, and each key out of its range', () => {
    expect(problemsOf('lucky')).toEqual(['luck: Must say what luck is called, its most and what a point does']);
    expect(problemsOf({ fate: 1 })).toEqual(['luck, fate: Not part of luck']);
    expect(problemsOf({ name: ' ' })).toEqual(['luck, name: Needs a name, as LUCK']);
    expect(problemsOf({ name: '<b>' })).toEqual(['luck, name: Letters, digits, spaces, a hyphen or an apostrophe, starting with a letter']);
    expect(problemsOf({ name: 'x'.repeat(LIMITS.name + 1) })).toEqual([`luck, name: Longer than ${LIMITS.name} characters`]);
    expect(problemsOf({ name: 'x'.repeat(LIMITS.name) })).toEqual([]);
    expect(problemsOf({ most: '@nope' })).toEqual(["luck, most: @nope isn't one of this system's names"]);
    expect(problemsOf({ most: '1d6' })).toEqual(['luck, most: A number or a formula, not dice']);
    expect(problemsOf({ most: ' ' })).toEqual(['luck, most: Needs a number or a formula']);
    expect(problemsOf({ most: true })).toEqual(['luck, most: A number or a formula']);
    expect(problemsOf({ most: 4 })).toEqual([]);
    expect(problemsOf({ each: 'half' })).toEqual(['luck, each: plus or die']);
    expect(problemsOf({ on: 'some' })).toEqual(['luck, on: all, or a list of rolls']);
    expect(problemsOf({ on: ['shoot', 'nope'] })).toEqual(["luck, on 2: Not one of this system's rolls"]);
    expect(problemsOf({ on: Array.from({ length: LIMITS.rolls + 1 }, () => 'shoot') })).toEqual([`luck, on: At most ${LIMITS.rolls}`]);
    expect(problemsOf({ refills: 'long_rest' })).toEqual(['luck, refills: Must be a list of rests']);
    expect(problemsOf({ refills: ['long_rest', 'nap'] })).toEqual(["luck, refills 2: Not one of this system's rests"]);
    expect(problemsOf({ refills: ['nap'] }, { rests: { nap: { name: 'Nap' } } })).toEqual([]);
  });

  it('a system\'s problems name it, so it can\'t be published with any', () => {
    expect(checkDefinition({ ...OWN, luck: { each: 'half' } }).problems.map((p) => p.where)).toEqual(['luck, each']);
  });
});

describe('the rule a game plays by', () => {
  it('none without the section, or with LUCK off on PARTS', () => {
    expect(luckRuleOf(OWN)).toBeNull();
    expect(luckRuleOf({ ...OWN, luck: CPR, parts: { luck: { on: false } } })).toBeNull();
    expect(luckRuleOf(null)).toBeNull();
  });

  it('every key filled in: as written, or as a game starts', () => {
    expect(ruleOf({})).toEqual({ ...START, on: 'all' });
    expect(START).toEqual({ name: 'LUCK', most: '3', each: 'plus', on: 'all', refills: ['end_of_session'] });
    expect(ruleOf(POOL)).toEqual({ name: 'EDGE', most: '3', each: 'die', on: ['shoot'], refills: ['end_of_scene'] });
    expect(ruleOf({ most: 5, each: 'x', on: 'x', refills: 'x' })).toEqual({ ...START, most: '5' });
  });

  it('a character\'s: the most worked out on their sheet, what they have left (all of it, none kept)', () => {
    const rule = ruleOf(CPR);
    expect(luckOf(OWN, rule, { luck: 6 })).toEqual({ current: 6, most: 6 });
    expect(luckOf(OWN, rule, { luck: 6, [LUCK_KEY]: 2 })).toEqual({ current: 2, most: 6 });
    // Never above the most, nor below none; a most past the limit held to it.
    expect(luckOf(OWN, rule, { luck: 6, [LUCK_KEY]: 9 })).toEqual({ current: 6, most: 6 });
    expect(luckOf(OWN, rule, { luck: 6, [LUCK_KEY]: -2 })).toEqual({ current: 0, most: 6 });
    expect(luckOf(OWN, rule, { luck: 500 }).most).toBe(LIMITS.most);
    expect(luckOf(OWN, rule, { luck: -3 }).most).toBe(0);
    expect(luckOf(OWN, rule, { luck: 6, [LUCK_KEY]: null }).current).toBe(6);
    expect(luckOf(OWN, rule, null)).toEqual({ current: 0, most: 0 });
  });

  it('on every roll, or only those named', () => {
    expect(luckOn(ruleOf(CPR), 'dodge')).toBe(true);
    expect(luckOn(ruleOf(POOL), 'shoot')).toBe(true);
    expect(luckOn(ruleOf(POOL), 'dodge')).toBe(false);
    expect(luckOn(null, 'shoot')).toBe(false);
  });

  it('as a sheet shows it', () => {
    expect(luckShown({ ...OWN, luck: POOL })).toEqual({ name: 'EDGE', each: 'die', on: ['shoot'] });
    expect(luckShown(OWN)).toBeNull();
    expect(renderOf('sys_aaaaaaaaaaaaaaaa', { ...OWN, luck: POOL }).luck).toEqual({ name: 'EDGE', each: 'die', on: ['shoot'] });
    expect(renderOf('sys_aaaaaaaaaaaaaaaa', OWN).luck).toBeNull();
  });
});

describe('spent on a roll', () => {
  it('+1 a point: a term the log names', () => {
    const rule = ruleOf(CPR);
    const spent = withLuck(rule, OWN.rolls[0], 2);
    expect(spent.chosen).toEqual([]);
    expect(spent.terms).toEqual([{ label: 'LUCK', amount: 2 }]);
    const made = rollField({ definition: OWN, data: { aim: 3 }, fieldId: 'aim', rng: faces(6, 4, 5), who: 'kes', roll: spent.roll, chosen: spent.chosen, terms: spent.terms });
    expect(made.total).toBe(4 + 5 + 3 + 2);
    expect(made.historyText).toContain('LUCK');
  });

  it('a die a point: as many more of the roll\'s first kind, the log saying how many', () => {
    const rule = ruleOf(POOL);
    const spent = withLuck(rule, OWN.rolls[0], 2);
    expect(spent.terms).toEqual([]);
    expect(spent.chosen).toEqual(['_luck']);
    expect(spent.roll.changes).toEqual([{ id: '_luck', label: '2 EDGE', extra: { dice: 2 } }]);
    const made = rollField({ definition: OWN, data: { aim: 0 }, fieldId: 'aim', rng: faces(6, 1, 2, 3, 4), who: 'kes', roll: spent.roll, chosen: spent.chosen });
    expect(made.total).toBe(1 + 2 + 3 + 4);
    expect(made.historyText).toContain('2 EDGE');
    // A roll's own changes kept beside it.
    expect(withLuck(rule, { ...OWN.rolls[0], changes: [{ id: 'aimed', label: 'Aimed' }] }, 1).roll.changes.map((c) => c.id)).toEqual(['aimed', '_luck']);
  });
});

describe('refilled at a rest', () => {
  const DEF = { ...OWN, luck: CPR, rests: { long_rest: { counts_as: ['end_of_session'] } } };
  it('a rest REFILLED BY names, or one counting as it: back to the most, said', () => {
    const at = restOn({ definition: DEF, restId: 'end_of_session', sheet: { luck: 6, [LUCK_KEY]: 1 } });
    expect(at.sheetPatch[LUCK_KEY]).toBeNull();
    expect(at.changes).toContainEqual({ what: 'luck', label: 'LUCK', from: 1, to: 6 });
    expect(restOn({ definition: DEF, restId: 'long_rest', sheet: { luck: 6, [LUCK_KEY]: 1 } }).sheetPatch[LUCK_KEY]).toBeNull();
    expect(refilledAt(ruleOf(CPR), new Set(['end_of_session']))).toBe(true);
    expect(refilledAt(null, new Set(['end_of_session']))).toBe(false);
  });

  it('another rest, or all of it left: nothing', () => {
    expect(restOn({ definition: DEF, restId: 'short_rest', sheet: { luck: 6, [LUCK_KEY]: 1 } }).sheetPatch).not.toHaveProperty(LUCK_KEY);
    const full = restOn({ definition: DEF, restId: 'end_of_session', sheet: { luck: 6 } });
    expect(full.sheetPatch).not.toHaveProperty(LUCK_KEY);
    expect(full.changes.find((c) => c.what === 'luck')).toBeUndefined();
  });
});

describe('carried with the system', () => {
  it('in its file beside the definition, read back unchanged, and said as a change in a new version', () => {
    const DEF = { ...OWN, luck: CPR };
    const file = citysys.buildFile({ definition: DEF, version: 2, origin: 'org_luck' });
    expect(file.definition.luck).toBeUndefined();
    expect(file.luck).toEqual(CPR);
    const read = citysys.readFile(JSON.stringify(file));
    expect(read.problems).toEqual([]);
    expect(read.file.definition.luck).toEqual(CPR);
    expect(versionChanges(OWN, DEF)).toContainEqual({ kind: 'other', change: 'changed', id: 'luck' });
  });
});
