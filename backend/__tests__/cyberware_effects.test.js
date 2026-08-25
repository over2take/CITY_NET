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
const piece = (name, mods, extra = {}) => ({ name, equipped: true, mods, ...extra });

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
