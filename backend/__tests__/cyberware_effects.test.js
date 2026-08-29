/**
 * What a character's chrome does to their numbers.
 *
 * The load-bearing part is name matching: modifiers are stored against a name, the sheet
 * works in field ids, and the two vocabularies that write these names do not agree with
 * each other. A modifier that quietly matches nothing is the failure mode to guard, since
 * it looks identical to a piece that does nothing.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const fx = require('../sheets/cyberwareEffects');

const withChrome = (rows, sheet = {}) => ({ ...sheet, cyberware: rows });
// Placed by default: an unplaced piece is installed nowhere and changes no numbers, so a
// fixture without a type would be testing that nothing happens. Placement has its own tests.
const piece = (name, mods, extra = {}) =>
  ({ name, equipped: true, type: 'fashionware', side: null, mods, ...extra });

describe('finding the field a modifier means', () => {
  it('matches the sheet\'s own label, which is what our picker stores', () => {
    expect(fx.fieldFor('COOL')).toBe('cool');
    expect(fx.fieldFor('Business')).toBe('business');
  });

  it('matches the Companion\'s wording, which is what an import stores', () => {
    // Their pickers say Intelligence and Movement where the sheet says INT and MOVE.
    expect(fx.fieldFor('Intelligence')).toBe('int');
    expect(fx.fieldFor('Movement')).toBe('move');
    expect(fx.fieldFor('Willpower')).toBe('will');
    expect(fx.fieldFor('Empathy')).toBe('emp');
  });

  it('sees through the punctuation the two vocabularies disagree on', () => {
    // "Conceal & Reveal Object" against the sheet's "Conceal/Reveal Object".
    expect(fx.fieldFor('Conceal & Reveal Object')).toBe('conceal_reveal');
    expect(fx.fieldFor('Conceal/Reveal Object')).toBe('conceal_reveal');
  });

  it('sees through the (x2) that marks a double-cost skill', () => {
    // The Companion drops it; the sheet keeps it. Same skill either way.
    expect(fx.fieldFor('Demolitions')).toBe('demolitions');
    expect(fx.fieldFor('Demolitions (x2)')).toBe('demolitions');
    expect(fx.fieldFor('Autofire')).toBe('autofire');
  });

  it('refuses to guess at something the sheet does not have', () => {
    // The Companion offers "Combat #", which this sheet has no field for. Forcing it onto
    // a near-match would put a bonus somewhere nobody asked for.
    expect(fx.fieldFor('Combat #')).toBeNull();
    expect(fx.fieldFor('')).toBeNull();
  });
});

describe('what the chrome adds up to', () => {
  it('adds a skill modifier to what the player typed', () => {
    const data = withChrome([piece('EMP Threading', [{ kind: 'skill', target: 'Business', value: 6 }])], { business: 3 });
    expect(fx.effects(data).fields.business.value).toBe(9);
  });

  it('stacks two pieces on the same stat', () => {
    const data = withChrome([
      piece('A', [{ kind: 'stat', target: 'Cool', value: 2 }]),
      piece('B', [{ kind: 'stat', target: 'COOL', value: 1 }]),
    ], { cool: 5 });
    expect(fx.effects(data).fields.cool.value).toBe(8);
  });

  it('applies a set before the adjustments', () => {
    // A piece setting COOL to 3 and another adding 2 leaves 5. The other order would let
    // the +2 piece do nothing, which reads as a bug every time someone notices.
    const data = withChrome([
      piece('Sets', [{ kind: 'statSet', target: 'Cool', value: 3 }]),
      piece('Adds', [{ kind: 'stat', target: 'Cool', value: 2 }]),
    ], { cool: 9 });
    expect(fx.effects(data).fields.cool.value).toBe(5);
  });

  it('lets a set override a higher typed value', () => {
    const data = withChrome([piece('Sets', [{ kind: 'statSet', target: 'Cool', value: 3 }])], { cool: 9 });
    expect(fx.effects(data).fields.cool.value).toBe(3);
  });

  it('takes the highest when two pieces both set the same thing', () => {
    // A genuine conflict with no right answer, so it resolves predictably and names both.
    const data = withChrome([
      piece('Low', [{ kind: 'statSet', target: 'Cool', value: 3 }]),
      piece('High', [{ kind: 'statSet', target: 'Cool', value: 7 }]),
    ], { cool: 5 });
    const entry = fx.effects(data).fields.cool;
    expect(entry.value).toBe(7);
    expect(entry.sources.map((s) => s.name)).toEqual(['Low', 'High']);
  });

  it('treats a missing stat as 0 rather than throwing', () => {
    const data = withChrome([piece('A', [{ kind: 'stat', target: 'Cool', value: 2 }])]);
    expect(fx.effects(data).fields.cool.value).toBe(2);
  });

  it('ignores a piece nobody has placed on the body yet', () => {
    // Owning chrome is not running it. Every import arrives unplaced, so without this a
    // character's stats change the moment they import, before anyone says where anything
    // went.
    const data = withChrome([piece('my stuff', [{ kind: 'statSet', target: 'INT', value: 300 }], { type: '' })], { int: 6 });
    expect(fx.effects(data).fields.int).toBeUndefined();
  });

  it('ignores a paired piece with a type but no side', () => {
    const data = withChrome([piece('leg', [{ kind: 'stat', target: 'Cool', value: 9 }], { type: 'cyberleg', side: null })], { cool: 5 });
    expect(fx.effects(data).fields.cool).toBeUndefined();
  });

  it('counts it once it is in a specific leg', () => {
    const data = withChrome([piece('leg', [{ kind: 'stat', target: 'Cool', value: 9 }], { type: 'cyberleg', side: 'l' })], { cool: 5 });
    expect(fx.effects(data).fields.cool.value).toBe(14);
  });

  it('ignores chrome that is switched off', () => {
    // Otherwise the equipped flag means nothing.
    const data = withChrome([
      piece('Off', [{ kind: 'stat', target: 'Cool', value: 9 }], { equipped: false }),
    ], { cool: 5 });
    expect(fx.effects(data).fields.cool).toBeUndefined();
  });

  it('reports a modifier it could not place instead of dropping it', () => {
    const data = withChrome([piece('Odd', [{ kind: 'stat', target: 'Combat #', value: 2 }])]);
    expect(fx.effects(data).unmatched).toEqual([
      { name: 'Odd', target: 'Combat #', kind: 'stat' },
    ]);
  });

  it('does nothing at all for another system', () => {
    const data = withChrome([piece('A', [{ kind: 'stat', target: 'Cool', value: 2 }])], { cool: 5 });
    expect(fx.effects(data, 'shadowrun_6e').fields).toEqual({});
  });
});

describe('every kind of modifier, end to end', () => {
  // One case per kind, so none of the five can quietly stop working. Written as a table
  // because the interesting thing is that the set is complete, not any single row.
  const KINDS = [
    {
      kind: 'stat', target: 'Cool', value: 3,
      field: 'cool', base: 5, expected: 8, why: 'adds to a stat',
    },
    {
      kind: 'statSet', target: 'Cool', value: 3,
      field: 'cool', base: 5, expected: 3, why: 'replaces a stat',
    },
    {
      kind: 'skill', target: 'Business', value: 6,
      field: 'business', base: 3, expected: 9, why: 'adds to a skill',
    },
    {
      kind: 'skillSet', target: 'Business', value: 6,
      field: 'business', base: 9, expected: 6, why: 'replaces a skill',
    },
    {
      kind: 'statFloor', target: 'Cool', value: 14, bonus: 2,
      field: 'cool', base: 5, expected: 14, why: 'raises a stat that is below the floor',
    },
    {
      kind: 'statFloor', target: 'Cool', value: 14, bonus: 2,
      field: 'cool', base: 16, expected: 18, why: 'pays the bonus when the stat already clears it',
    },
  ];

  const mod = ({ kind, target, value, bonus }) =>
    (bonus === undefined ? { kind, target, value } : { kind, target, value, bonus });

  it.each(KINDS)('$kind $why', (c) => {
    const data = withChrome([piece('P', [mod(c)])], { [c.field]: c.base });
    expect(fx.effects(data).fields[c.field].value).toBe(c.expected);
  });

  it.each(KINDS)('$kind reaches a roll built on that field ($why)', (c) => {
    // The sheet showing a number the dice do not use would be the worst of both.
    const { field, base, expected } = c;
    const data = withChrome([piece('P', [mod(c)])], { [field]: base });
    expect(fx.formulaModifiers(data, `1d10 + @${field}`))
      .toEqual([{ label: 'cyberware', value: expected - base }]);
  });

  it('roll changes a roll type rather than any field', () => {
    // The fifth kind. It has no field to land on, which is exactly what distinguishes it.
    const data = withChrome([piece('P', [{ kind: 'roll', target: 'Attack', value: 2 }])], { cool: 5 });
    expect(fx.effects(data).fields).toEqual({});
    expect(fx.rollBonus(data, 'Attack')).toBe(2);
  });

  it('note is read, not applied, and is not an unmatched target', () => {
    // A note names something the sheet has never heard of on purpose — "Quickhack DV" is
    // not a stat. Reporting it as unmatched would file a deliberate choice as a mistake.
    const data = withChrome([piece('P', [{ kind: 'note', target: 'Quickhack DV', value: 10 }])], { cool: 5 });
    const out = fx.effects(data);
    expect(out.fields).toEqual({});
    expect(out.unmatched).toEqual([]);
    expect(fx.rollBonus(data, 'Quickhack DV')).toBe(0);
  });

  it('a note reaches no roll either', () => {
    const data = withChrome([piece('P', [{ kind: 'note', target: 'Quickhack DV', value: 10 }])], { cool: 5 });
    expect(fx.formulaModifiers(data, '1d10 + @cool')).toEqual([]);
  });

  it('covers every kind the row model can hold', () => {
    // If another kind is added, this fails until it is given a case above.
    const cyberware = require('../sheets/cyberware');
    const covered = new Set([...KINDS.map((k) => k.kind), 'roll', 'note']);
    const declared = new Set([
      ...Object.values(cyberware.MOD_KINDS),
      ...cyberware.LOCAL_KINDS,
    ]);
    expect([...declared].sort()).toEqual([...covered].sort());
  });
});

describe('every stat, skill and roll type the app offers', () => {
  // Completeness, not representative cases. A name the picker offers but the index cannot
  // match is a modifier a player can build that silently does nothing, and it looks
  // exactly like a piece with no effect. One target per kind would never find it.
  const { CPR_SKILLS } = require('../sheets/rolls');
  const STAT_NAMES = Object.values(fx.CPR_STAT_ALIASES).flat();
  const SKILL_LABELS = Object.values(CPR_SKILLS).map(([label]) => label);
  const ROLL_TYPES = ['Initiative', 'Attack', 'Damage', 'Aimed Shot', 'Autofire'];

  it('has lists worth checking', () => {
    // Guards the guard: an empty list would make every case below pass for free.
    expect(STAT_NAMES.length).toBe(20);      // ten stats, two vocabularies each
    expect(SKILL_LABELS.length).toBeGreaterThanOrEqual(60);
  });

  it.each(STAT_NAMES)('%s resolves to a stat and moves it', (name) => {
    const data = withChrome([piece('P', [{ kind: 'stat', target: name, value: 2 }])]);
    const out = fx.effects(data);
    expect(out.unmatched).toEqual([]);
    expect(Object.values(out.fields).map((f) => f.value)).toEqual([2]);
  });

  it.each(SKILL_LABELS)('%s resolves to a skill and moves it', (label) => {
    const data = withChrome([piece('P', [{ kind: 'skill', target: label, value: 3 }])]);
    const out = fx.effects(data);
    expect(out.unmatched).toEqual([]);
    expect(Object.values(out.fields).map((f) => f.value)).toEqual([3]);
  });

  it('gives every skill its own field rather than collapsing any together', () => {
    // Found "Language (Streetslang)" and "Language (Other)" landing on the same field,
    // because the normaliser stripped every bracket to cope with "(x2)".
    const ids = SKILL_LABELS.map((label) => fx.fieldFor(label));
    expect(new Set(ids).size).toBe(SKILL_LABELS.length);
  });

  it('gives every stat its own field', () => {
    const ids = Object.keys(fx.CPR_STAT_ALIASES);
    expect(new Set(ids.map((id) => fx.fieldFor(id.toUpperCase()))).size).toBe(ids.length);
  });

  it.each(ROLL_TYPES)('%s is reachable as a roll modifier', (type) => {
    const data = withChrome([piece('P', [{ kind: 'roll', target: type, value: 2 }])]);
    expect(fx.rollBonus(data, type)).toBe(2);
  });

  it.each(ROLL_TYPES)('%s is reachable when spelled the Companion way', (type) => {
    // They append "Roll" to most of these.
    const data = withChrome([piece('P', [{ kind: 'roll', target: `${type} Roll`, value: 2 }])]);
    expect(fx.rollBonus(data, type)).toBe(2);
  });

  it('keeps roll types apart from one another', () => {
    const data = withChrome([piece('P', [{ kind: 'roll', target: 'Attack', value: 2 }])]);
    for (const other of ROLL_TYPES.filter((t) => t !== 'Attack')) {
      expect(fx.rollBonus(data, other)).toBe(0);
    }
  });
});

describe('never writing to the sheet', () => {
  it('leaves the stored value exactly as the player typed it', () => {
    // The whole design rests on this: write the total back and the next recompute adds the
    // bonus again, and taking the chrome out never gives it back.
    const data = withChrome([piece('A', [{ kind: 'stat', target: 'Cool', value: 3 }])], { cool: 5 });
    fx.effects(data);
    fx.effectiveData(data);
    expect(data.cool).toBe(5);
  });

  it('hands the dice a copy with the modified value in it', () => {
    const data = withChrome([piece('A', [{ kind: 'stat', target: 'Cool', value: 3 }])], { cool: 5 });
    const out = fx.effectiveData(data);
    expect(out.cool).toBe(8);
    expect(out).not.toBe(data);
  });

  it('returns the sheet untouched when there is no chrome to apply', () => {
    const data = { cool: 5 };
    expect(fx.effectiveData(data)).toBe(data);
  });
});

describe('what a roll picks up', () => {
  const data = withChrome([
    piece('Threading', [{ kind: 'skill', target: 'Business', value: 6 }]),
    piece('Sandy', [{ kind: 'roll', target: 'Initiative Roll', value: 2 }]),
  ], { business: 3, cool: 5, int: 4 });

  it('adds a term for a field the formula actually uses', () => {
    expect(fx.formulaModifiers(data, '1d10 + @int + @business'))
      .toEqual([{ label: 'cyberware', value: 6 }]);
  });

  it('adds nothing to a roll the chrome does not touch', () => {
    expect(fx.formulaModifiers(data, '1d10 + @ref')).toEqual([]);
  });

  it('is a labelled term rather than a bigger stat', () => {
    // So the breakdown can say where the bonus came from, the way LUCK already does.
    const [term] = fx.formulaModifiers(data, '1d10 + @business');
    expect(term.label).toBe('cyberware');
  });

  it('turns a set into whatever term makes the total right', () => {
    const setting = withChrome([piece('S', [{ kind: 'statSet', target: 'Cool', value: 3 }])], { cool: 5 });
    expect(fx.formulaModifiers(setting, '1d10 + @cool'))
      .toEqual([{ label: 'cyberware', value: -2 }]);
  });

  it('follows the formula\'s own sign', () => {
    const out = fx.formulaModifiers(data, '1d10 - @business');
    expect(out).toEqual([{ label: 'cyberware', value: -6 }]);
  });

  it('matches a roll type however it was spelled', () => {
    // Ours says "Initiative"; the Companion stored "Initiative Roll".
    expect(fx.rollBonus(data, 'Initiative')).toBe(2);
    expect(fx.rollBonus(data, 'initiative roll')).toBe(2);
    expect(fx.rollBonus(data, 'Attack')).toBe(0);
  });
});
