import { describe, it, expect } from 'vitest';
import { wordsOf, sampleLine, insertGroups, levelTokens, hasTokens, shapesOf, writeShape, formulaTexts, isMistake, serverKind } from '../formulaBox';
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
    expect(groups.map((g) => g.title)).toEqual(['LEVELS', 'STATS', 'FORMULAS', 'TABLES', 'CHOICES', 'WORKINGS']);
    expect(groups[0].items).toEqual([
      { token: '@level', label: 'LEVEL' }, { token: '@classes_level', label: 'CLASSES LEVEL' }, { token: '@fighter_level', label: 'FIGHTER LEVEL' },
    ]);
    expect(groups[2].items).toEqual([{ token: '@con_mod', label: 'CON MODIFIER' }]);
    expect(groups[3].items).toEqual([{ token: 'mod()', label: 'A TABLE' }]);
    expect(groups[4].items).toContainEqual({ token: 'has(fighter)', label: 'HAS FIGHTER' });
    expect(groups[5].items).toContainEqual({ token: 'floor()', label: 'ROUNDED DOWN' });
    // has() is offered by name, under CHOICES: never as a bare call with nothing to name.
    expect(groups[5].items.map((i) => i.token)).not.toContain('has()');
  });

  it('offers has() for each option and each of its features; a system without lists has none (7b)', () => {
    const def = { ...DEF, choices: [{ id: 'c', one: 'C', many: 'Cs', options: [{ id: 'mage', label: 'Mage', features: [{ id: 'ward', label: 'Ward' }, { id: 'nameless', label: '' }] }, { id: 'bare', label: '' }] }] } as unknown as Definition;
    expect(hasTokens(def)).toEqual([
      { token: 'has(mage)', label: 'HAS MAGE' }, { token: 'has(ward)', label: 'HAS WARD' }, { token: 'has(nameless)', label: 'HAS NAMELESS' }, { token: 'has(bare)', label: 'HAS BARE' },
    ]);
    expect(insertGroups({ ...DEF, choices: [] } as Definition, 'requires').map((g) => g.title)).not.toContain('CHOICES');
  });

  it('says a requirement reading has() in words (7b)', () => {
    const reads = [{ id: 'has:ward', label: 'WARD', value: 0 }, { id: 'int', label: 'INTELLECT', value: 10 }];
    expect(wordsOf('requires', 'has(ward)', reads)).toBe('needs WARD');
    expect(wordsOf('requires', ' has( ward ) ', reads)).toBe('needs WARD');
    expect(wordsOf('requires', 'has(ward) and @int >= 13', reads)).toBe('needs WARD and INTELLECT >= 13');
    expect(wordsOf('formula', '2 * has(ward)', reads)).toBe('worked out from WARD, INTELLECT');
  });

  it('offers an amount no formulas, which it can\'t read', () => {
    expect(insertGroups(DEF, 'amount').map((g) => g.title)).toEqual(['LEVELS', 'STATS', 'TABLES', 'CHOICES', 'WORKINGS']);
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

describe('a roll\'s ADD and AGAINST, and a rest\'s amount (formula box 2)', () => {
  const ROLLED = [{ id: 'this', label: 'rolled stat', value: 16 }];

  it('says them in words', () => {
    expect(wordsOf('add', '@this_mod', [{ id: 'this_mod', label: 'rolled stat\'s modifier', value: 3 }])).toBe('+ your rolled stat\'s modifier');
    expect(wordsOf('add', '2')).toBe('+2, always');
    expect(wordsOf('against', '13')).toBe('against 13');
    expect(wordsOf('against', '@this', ROLLED)).toBe('against your rolled stat');
    expect(wordsOf('against', '10 + @this', ROLLED)).toBe('against a target worked out from rolled stat');
    expect(wordsOf('refill', '1d8  +  @con_mod', [{ id: 'con_mod', label: 'CON modifier', value: 2 }])).toBe('1d8 + CON modifier');
    expect(wordsOf('refill', '@hp_max')).toBe('hp_max');
  });

  it('says the sample: the stat it rolls, a target, and what dice can come to', () => {
    expect(sampleLine('add', { ok: true, value: 3, reads: [{ id: 'this_mod', label: 'rolled stat\'s modifier', value: 3 }], rolling: 'Strength' }))
      .toBe('sample, rolling Strength, rolled stat\'s modifier 3: +3');
    expect(sampleLine('add', { ok: true, value: 2, reads: [], rolling: 'Strength' })).toBe('sample, rolling Strength: +2');
    expect(sampleLine('against', { ok: true, value: 16, reads: ROLLED })).toBe('sample rolled stat 16: target 16');
    expect(sampleLine('refill', { ok: true, value: 3, most: 10, reads: [{ id: 'con_mod', label: 'CON modifier', value: 2 }] })).toBe('sample CON modifier 2: 3 to 10');
    expect(sampleLine('refill', { ok: true, value: 5, reads: [] })).toBe('5');
  });

  it('INSERT: the stat rolled first in a roll, no tables in a rest', () => {
    expect(insertGroups(DEF, 'add').map((g) => g.title)).toEqual(['THIS ROLL', 'LEVELS', 'STATS', 'FORMULAS', 'TABLES', 'CHOICES', 'WORKINGS']);
    expect(insertGroups(DEF, 'against')[0].items.map((i) => i.token)).toEqual(['@this', '@this_mod', '@tie', '@tie_mod']);
    expect(insertGroups(DEF, 'refill').map((g) => g.title)).toEqual(['LEVELS', 'STATS', 'FORMULAS', 'CHOICES', 'WORKINGS']);
  });

  it('SHAPES: the stat rolled and its modifier, a target, dice', () => {
    expect(shapesOf(DEF, 'add').map((s) => s.label)).toEqual(['A NUMBER', 'THE STAT ROLLED', 'ITS MODIFIER', 'PER LEVEL']);
    expect(shapesOf(DEF, 'against').map((s) => s.label)).toEqual(['A NUMBER', 'THE STAT ROLLED']);
    expect(shapesOf(DEF, 'refill').map((s) => [s.label, s.asks])).toEqual([['A NUMBER', 'number'], ['DICE', 'dice'], ['DICE AND A STAT', 'dice-and-stat']]);
    expect(shapesOf({ format: 1, name: 'B' } as Definition, 'refill')[2].needs).toBe('No stats yet: make them on STATS & RULES');
    expect(shapesOf({ format: 1, name: 'B' } as Definition, 'add')[3].needs).toBe('No levels yet: make a list levelled on CHOICES');
    expect([writeShape('rolled', 1), writeShape('rolled_mod', 1)]).toEqual(['@this', '@this_mod']);
    expect([writeShape('dice', 2, '@level', 6), writeShape('dice', 0), writeShape('dice_and_stat', 1, '@con_mod', 10)]).toEqual(['2d6', '1d8', '1d10 + @con_mod']);
  });
});

describe('a formula of STATS & RULES (formula box 3)', () => {
  it('says it as a value, with no sign', () => {
    expect(wordsOf('formula', '10')).toBe('10, always');
    expect(wordsOf('formula', '2 * @level', LEVEL)).toBe('2 for each level');
    expect(wordsOf('formula', '@str', [{ id: 'str', label: 'Strength', value: 16 }])).toBe('your Strength');
    expect(wordsOf('formula', 'floor(@level / 2)', LEVEL)).toBe('half your level, rounded down');
    expect(wordsOf('formula', '10 + @dex + @armor')).toBe('worked out from dex, armor');
  });

  it('asks for a formula\'s text, or a condition\'s three parts, keyed as the page binds them', () => {
    expect(formulaTexts([
      { id: 'save', label: 'Save', formula: '16 - @str_mod' },
      { id: 'hurt', label: 'Hurt', kind: 'condition', when: '@str < 5', then: '1', else: '@str_mod' },
      { id: 'blank', label: 'Blank' },
    ] as never)).toEqual([
      { key: 'save:formula', text: '16 - @str_mod', kind: 'formula' },
      { key: 'hurt:when', text: '@str < 5', kind: 'formula' }, { key: 'hurt:then', text: '1', kind: 'formula' }, { key: 'hurt:else', text: '@str_mod', kind: 'formula' },
      { key: 'blank:formula', text: '', kind: 'formula' },
    ]);
  });

  it('tells a mistake from an answer, and from no answer yet', () => {
    expect([isMistake({ ok: false, problem: 'x' }), isMistake({ ok: true, value: 1, reads: [] }), isMistake(null)]).toEqual([true, false, false]);
  });
});

describe('a cost of raising a stat (7f2b, SPEND XP)', () => {
  const NEW = [{ id: 'new', label: 'New rating', value: 3 }];
  it('said as a value, never signed', () => {
    expect(wordsOf('cost', '@new * 5', NEW)).toBe('5 for each new rating');
    expect(wordsOf('cost', '10')).toBe('10, always');
    expect(wordsOf('cost', '@new', NEW)).toBe('the New rating');
    expect(sampleLine('cost', { ok: true, value: 15, reads: NEW })).toBe('sample New rating 3: costs 15');
  });

  it('INSERT offers the stat raised, formulas too; its SHAPES a number or so much for each point of the new rating', () => {
    const groups = insertGroups(DEF, 'cost');
    expect(groups.find((g) => g.title === 'THE STAT RAISED')?.items).toEqual([{ token: '@old', label: 'THE RATING NOW' }, { token: '@new', label: 'THE NEW RATING' }]);
    expect(groups.some((g) => g.title === 'FORMULAS')).toBe(true);
    expect(insertGroups(DEF, 'formula').some((g) => g.title === 'THE STAT RAISED')).toBe(false);
    expect(shapesOf(DEF, 'cost').map((s) => s.label)).toEqual(['A NUMBER', 'NEW RATING TIMES']);
    expect(writeShape('per_new', 5)).toBe('@new * 5');
  });

  it('an option\'s price: a value said as a cost, with no stat raised to read', () => {
    expect(wordsOf('price', '10')).toBe('10, always');
    expect(wordsOf('price', '2 * @str', [{ id: 'str', label: 'Strength', value: 16 }])).toBe('2 for each strength');
    expect(wordsOf('price', '@str', [{ id: 'str', label: 'Strength', value: 16 }])).toBe('the Strength');
    expect(sampleLine('price', { ok: true, value: 10, reads: [] })).toBe('costs 10');
    expect(insertGroups(DEF, 'price').some((g) => g.title === 'THE STAT RAISED')).toBe(false);
    expect(shapesOf(DEF, 'price').map((s) => s.label)).toEqual(['A NUMBER']);
    // The server reads it as a formula.
    expect(serverKind('price')).toBe('formula');
    expect(serverKind('cost')).toBe('cost');
  });
});
