import { describe, it, expect } from 'vitest';
import { wordsOf, sampleLine, insertGroups, levelTokens, shapesOf, writeShape } from '../formulaBox';
import type { Definition } from '../systemsApi';

/**
 * The formula box as logic (formula box 1; approved mockup docs/mockups/formula-box.html,
 * 2026-10-29): a formula said in words, its sample line, what INSERT offers (no formulas for an
 * amount), and the SHAPES and what each writes.
 */
const DEF = {
  format: 1, name: 'Hearth',
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'str', label: 'Strength' }, { id: 'con', label: 'Constitution' }] }],
  derived: [{ id: 'con_mod', label: 'CON modifier', formula: 'floor(@con / 2)' }],
  lookups: { mod: { bands: [{ value: 0 }] } },
  choices: [
    { id: 'classes', one: 'Class', many: 'Classes', levelled: true, options: [{ id: 'fighter', label: 'Fighter', features: [] }] },
    { id: 'feats', one: 'Feat', many: 'Feats', options: [] },
  ],
} as unknown as Definition;
const LEVEL = [{ id: 'level', label: 'Level', value: 3 }];

describe('a formula in words', () => {
  it('says the common shapes of an amount plainly', () => {
    expect(wordsOf('amount', '5')).toBe('+5, always');
    expect(wordsOf('amount', '-1')).toBe('−1, always');
    expect(wordsOf('amount', '2 * @level', LEVEL)).toBe('+2 for each level');
    expect(wordsOf('amount', '@level * 2', LEVEL)).toBe('+2 for each level');
    expect(wordsOf('amount', '@con', [{ id: 'con', label: 'Constitution', value: 14 }])).toBe('+ your Constitution');
    expect(wordsOf('amount', 'floor(@level / 2)', LEVEL)).toBe('+ half your level, rounded down');
  });

  it('says anything else by what it is worked out from, by label, ids while the server hasn\'t answered', () => {
    expect(wordsOf('amount', '@str + @level', [{ id: 'str', label: 'Strength', value: 16 }, ...LEVEL])).toBe('worked out from Strength, Level');
    expect(wordsOf('amount', '2 * @level')).toBe('+2 for each level');
    expect(wordsOf('amount', '1 + 2')).toBe('a fixed number');
    expect(wordsOf('amount', '3 * @fighter_level + @con')).toBe('worked out from fighter_level, con');
    expect(wordsOf('amount', '   ')).toBe('');
  });

  it('says uses in uses', () => {
    expect(wordsOf('uses', '1')).toBe('1 use, always');
    expect(wordsOf('uses', '3')).toBe('3 uses, always');
    expect(wordsOf('uses', '1 * @level', LEVEL)).toBe('1 for each level');
    expect(wordsOf('uses', '@con_mod', [{ id: 'con_mod', label: 'CON modifier', value: 2 }])).toBe('as many as your CON modifier');
  });

  it('says what a requirement needs', () => {
    const str = [{ id: 'str', label: 'Strength', value: 16 }];
    expect(wordsOf('requires', '@str >= 13', str)).toBe('needs Strength 13 or more');
    expect(wordsOf('requires', '@str > 12', str)).toBe('needs Strength over 12');
    expect(wordsOf('requires', '@str >= 13 and @level >= 2', [...str, ...LEVEL])).toBe('needs Strength >= 13 and Level >= 2');
  });
});

describe('the sample line', () => {
  it('says what it comes to for the sample, with each name read', () => {
    expect(sampleLine('amount', { ok: true, value: 6, reads: LEVEL })).toBe('sample Level 3: +6');
    expect(sampleLine('amount', { ok: true, value: -1, reads: [] })).toBe('−1');
    expect(sampleLine('uses', { ok: true, value: 1, reads: LEVEL })).toBe('sample Level 3: 1 use');
    expect(sampleLine('uses', { ok: true, value: 2.5, reads: [] })).toBe('2.5 uses');
    expect(sampleLine('amount', { ok: true, value: 6, reads: [...LEVEL, ...LEVEL] })).toBe('sample Level 3: +6');
  });

  it('says whether the sample meets a requirement', () => {
    expect(sampleLine('requires', { ok: true, value: 1, reads: [{ id: 'str', label: 'Strength', value: 16 }] })).toBe('the sample (Strength 16) meets it');
    expect(sampleLine('requires', { ok: true, value: 0, reads: [] })).toBe('the sample doesn\'t meet it');
  });
});

describe('INSERT', () => {
  it('offers levels, stats, formulas, tables and workings, with what each is', () => {
    const groups = insertGroups(DEF, 'requires');
    expect(groups.map((g) => g.title)).toEqual(['LEVELS', 'STATS', 'FORMULAS', 'TABLES', 'WORKINGS']);
    expect(groups[0].items).toEqual([
      { token: '@level', label: 'LEVEL' }, { token: '@classes_level', label: 'CLASSES LEVEL' }, { token: '@fighter_level', label: 'FIGHTER LEVEL' },
    ]);
    expect(groups[2].items).toEqual([{ token: '@con_mod', label: 'CON MODIFIER' }]);
    expect(groups[3].items).toEqual([{ token: 'mod()', label: 'A TABLE' }]);
    expect(groups[4].items).toContainEqual({ token: 'floor()', label: 'ROUNDED DOWN' });
  });

  it('offers an amount no formulas, which it can\'t read', () => {
    expect(insertGroups(DEF, 'amount').map((g) => g.title)).toEqual(['LEVELS', 'STATS', 'TABLES', 'WORKINGS']);
  });

  it('has no levels without a levelled list, and no @level when a stat is called that', () => {
    expect(levelTokens({ ...DEF, choices: [] } as Definition)).toEqual([]);
    const own = { ...DEF, stats: [{ id: 'g', label: 'G', stats: [{ id: 'level', label: 'Level' }] }] } as unknown as Definition;
    expect(levelTokens(own).map((l) => l.token)).toEqual(['@classes_level', '@fighter_level']);
  });
});

describe('SHAPES', () => {
  it('offers amounts and uses four, requirements two', () => {
    expect(shapesOf(DEF, 'amount').map((s) => [s.label, s.asks])).toEqual([
      ['A NUMBER', 'number'], ['PER LEVEL', 'number'], ['PER CLASS LEVEL', 'number-and-level'], ['HALF LEVEL', 'none'],
    ]);
    expect(shapesOf(DEF, 'requires').map((s) => [s.label, s.asks])).toEqual([['AT LEAST', 'number-and-stat'], ['LEVEL AT LEAST', 'number-and-level']]);
    expect(shapesOf(DEF, 'amount').every((s) => !s.needs)).toBe(true);
  });

  it('says why a shape can\'t be used yet', () => {
    const bare = { format: 1, name: 'B' } as Definition;
    expect(shapesOf(bare, 'amount').map((s) => s.needs)).toEqual([undefined, 'No levels yet: make a list levelled on CHOICES', 'No levels yet: make a list levelled on CHOICES', 'No levels yet: make a list levelled on CHOICES']);
    expect(shapesOf(bare, 'requires')[0].needs).toBe('No stats yet: make them on STATS & RULES');
  });

  it('writes each shape', () => {
    expect(writeShape('number', 5)).toBe('5');
    expect(writeShape('per_level', 2)).toBe('2 * @level');
    expect(writeShape('per_class_level', 2, '@fighter_level')).toBe('2 * @fighter_level');
    expect(writeShape('half_level', 9)).toBe('floor(@level / 2)');
    expect(writeShape('at_least', 13, '@str')).toBe('@str >= 13');
    expect(writeShape('level_at_least', 5, '@level')).toBe('@level >= 5');
    expect(writeShape('number', Number.NaN)).toBe('0');
    expect(writeShape('number', 2.7)).toBe('2');
    expect(writeShape('nonsense', 1)).toBe('');
  });
});
