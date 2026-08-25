/**
 * What the chrome does to the numbers on the sheet.
 *
 * The server is authoritative — it resolves every roll — so the job here is agreeing with
 * it. A skill that reads 3 on the page and rolls at 9 is worse than showing nothing, so
 * the matching rules and the set/adjust order are tested against the same cases the
 * backend suite uses.
 */

import { describe, it, expect } from 'vitest';
import { getTemplate } from '../index';
import { sheetEffects, effectiveValue, describeSources, norm, normRoll } from '../cyberwareEffects';

const CPR = getTemplate('cyberpunk_red');
// Placed by default: an unplaced piece is not installed and changes no numbers, so a
// fixture without a type would test nothing. Tests about placement pass their own.
const piece = (name: string, mods: unknown[], extra = {}) =>
  ({ name, equipped: true, type: 'fashionware', side: null, mods, ...extra });
const sheet = (rows: unknown[], fields = {}) => ({ ...fields, cyberware: rows });

describe('matching a name to a field', () => {
  it('sees through the punctuation the two vocabularies disagree on', () => {
    expect(norm('Conceal & Reveal Object')).toBe(norm('Conceal/Reveal Object'));
  });

  it('sees through the (x2) that marks a double-cost skill', () => {
    expect(norm('Demolitions')).toBe(norm('Demolitions (x2)'));
  });

  it('strips the trailing Roll the Companion appends, and only there', () => {
    expect(normRoll('Initiative Roll')).toBe('initiative');
    // Autofire Damage Roll must not collapse into Damage Roll.
    expect(normRoll('Autofire Damage Roll')).not.toBe(normRoll('Damage Roll'));
  });
});

describe('what the sheet should show', () => {
  it('adds a skill modifier to what the player typed', () => {
    const data = sheet([piece('EMP Threading', [{ kind: 'skill', target: 'Business', value: 6 }])], { business: 3 });
    expect(sheetEffects(data, CPR).fields.business.value).toBe(9);
  });

  it('reads the Companion\'s stat wording as well as the sheet\'s', () => {
    const data = sheet([
      piece('A', [{ kind: 'stat', target: 'Reflexes', value: 2 }]),
      piece('B', [{ kind: 'stat', target: 'REF', value: 1 }]),
    ], { ref: 5 });
    expect(sheetEffects(data, CPR).fields.ref.value).toBe(8);
  });

  it('applies a set before the adjustments', () => {
    const data = sheet([
      piece('Sets', [{ kind: 'statSet', target: 'Cool', value: 3 }]),
      piece('Adds', [{ kind: 'stat', target: 'Cool', value: 2 }]),
    ], { cool: 9 });
    expect(sheetEffects(data, CPR).fields.cool.value).toBe(5);
  });

  it('reports the difference, which is what the badge needs', () => {
    const data = sheet([piece('A', [{ kind: 'stat', target: 'Cool', value: 3 }])], { cool: 5 });
    const effect = sheetEffects(data, CPR).fields.cool;
    expect(effect.base).toBe(5);
    expect(effect.value).toBe(8);
    expect(effect.delta).toBe(3);
  });

  it('ignores a piece nobody has placed on the body yet', () => {
    // Reported: a sheet reading "0 INSTALLED" while a stat sat at 300 from a piece that
    // was owned but in no limb. Owning chrome is not the same as running it.
    const data = sheet([piece('my stuff', [{ kind: 'statSet', target: 'INT', value: 300 }], { type: '' })], { int: 6 });
    expect(sheetEffects(data, CPR).fields.int).toBeUndefined();
  });

  it('ignores a paired piece that has a type but no side', () => {
    // It knows it is a Cyberleg but is in neither leg, so it is installed nowhere.
    const data = sheet([piece('my stuff', [{ kind: 'statSet', target: 'INT', value: 300 }], { type: 'cyberleg', side: null })], { int: 6 });
    expect(sheetEffects(data, CPR).fields.int).toBeUndefined();
  });

  it('counts it once it is actually in a leg', () => {
    const data = sheet([piece('my stuff', [{ kind: 'statSet', target: 'INT', value: 300 }], { type: 'cyberleg', side: 'r' })], { int: 6 });
    expect(sheetEffects(data, CPR).fields.int.value).toBe(300);
  });

  it('counts an unpaired type as placed the moment it has one', () => {
    // Fashionware has no left or right, so naming the type is the whole answer.
    const data = sheet([piece('Tattoo', [{ kind: 'stat', target: 'Cool', value: 3 }], { type: 'fashionware' })], { cool: 5 });
    expect(sheetEffects(data, CPR).fields.cool.value).toBe(8);
  });

  it('ignores chrome that is switched off', () => {
    const data = sheet([piece('Off', [{ kind: 'stat', target: 'Cool', value: 9 }], { equipped: false })], { cool: 5 });
    expect(sheetEffects(data, CPR).fields.cool).toBeUndefined();
  });

  it('leaves roll types alone, since no field on the page holds one', () => {
    const data = sheet([piece('Sandy', [{ kind: 'roll', target: 'Initiative Roll', value: 2 }])]);
    const out = sheetEffects(data, CPR);
    expect(out.fields).toEqual({});
    expect(out.unmatched).toEqual([]);
  });

  it('reports a name this sheet has no field for', () => {
    const data = sheet([piece('Odd', [{ kind: 'stat', target: 'Combat #', value: 2 }])]);
    expect(sheetEffects(data, CPR).unmatched).toEqual([{ name: 'Odd', target: 'Combat #' }]);
  });

  it('does nothing for another system', () => {
    const data = sheet([piece('A', [{ kind: 'stat', target: 'Cool', value: 2 }])], { cool: 5 });
    expect(sheetEffects(data, getTemplate('shadowrun_6e')).fields).toEqual({});
  });

  it('never changes what is stored', () => {
    const data = sheet([piece('A', [{ kind: 'stat', target: 'Cool', value: 3 }])], { cool: 5 });
    sheetEffects(data, CPR);
    expect(data.cool).toBe(5);
  });
});

describe('reading a value off the sheet', () => {
  it('gives the modified number where there is one', () => {
    const data = sheet([piece('A', [{ kind: 'stat', target: 'Cool', value: 3 }])], { cool: 5 });
    const fx = sheetEffects(data, CPR);
    expect(effectiveValue(fx, 'cool', 5)).toBe(8);
  });

  it('falls back to what is stored for an untouched field', () => {
    const fx = sheetEffects(sheet([]), CPR);
    expect(effectiveValue(fx, 'ref', 7)).toBe(7);
    expect(effectiveValue(fx, 'ref', undefined)).toBe(0);
  });

  it('names what did it, for the tooltip', () => {
    const data = sheet([
      piece('Kerenzikov', [{ kind: 'stat', target: 'Cool', value: 2 }]),
      piece('Tattoo', [{ kind: 'statSet', target: 'Cool', value: 4 }]),
    ], { cool: 5 });
    expect(describeSources(sheetEffects(data, CPR).fields.cool))
      .toBe('Kerenzikov +2, Tattoo = 4');
  });
});

describe('agreeing with the server', () => {
  // The server resolves every roll, so a disagreement here is a sheet that lies about what
  // it is about to roll. Cross-checked against the real backend module rather than a copy
  // of its rules, the same way the roll formulas already are.
  const cases: { why: string; rows: unknown[]; fields: Record<string, number> }[] = [
    {
      why: 'a skill bonus',
      rows: [piece('Threading', [{ kind: 'skill', target: 'Business', value: 6 }])],
      fields: { business: 3 },
    },
    {
      why: "the Companion's stat wording",
      rows: [piece('A', [{ kind: 'stat', target: 'Intelligence', value: 2 }])],
      fields: { int: 4 },
    },
    {
      why: 'punctuation that differs between the two vocabularies',
      rows: [piece('A', [{ kind: 'skill', target: 'Conceal & Reveal Object', value: 3 }])],
      fields: { conceal_reveal: 1 },
    },
    {
      why: 'a set and an adjustment together',
      rows: [
        piece('Sets', [{ kind: 'statSet', target: 'Cool', value: 3 }]),
        piece('Adds', [{ kind: 'stat', target: 'Cool', value: 2 }]),
      ],
      fields: { cool: 9 },
    },
    {
      why: 'two pieces both setting the same stat',
      rows: [
        piece('Low', [{ kind: 'statSet', target: 'Cool', value: 3 }]),
        piece('High', [{ kind: 'statSet', target: 'Cool', value: 7 }]),
      ],
      fields: { cool: 5 },
    },
    {
      why: 'chrome that is switched off',
      rows: [piece('Off', [{ kind: 'stat', target: 'Cool', value: 9 }], { equipped: false })],
      fields: { cool: 5 },
    },
  ];

  it.each(cases)('reaches the same numbers for $why', async ({ rows, fields }) => {
    const backend = await import('../../../../backend/sheets/cyberwareEffects.js');
    const data = sheet(rows, fields);

    const mine = sheetEffects(data, CPR).fields;
    const theirs = backend.default.effects(data).fields;

    expect(Object.keys(mine).sort()).toEqual(Object.keys(theirs).sort());
    for (const id of Object.keys(mine)) {
      expect(`${id}=${mine[id].value}`).toBe(`${id}=${theirs[id].value}`);
    }
  });

  it('agrees on a name neither can place', async () => {
    const backend = await import('../../../../backend/sheets/cyberwareEffects.js');
    const data = sheet([piece('Odd', [{ kind: 'stat', target: 'Combat #', value: 2 }])]);

    expect(sheetEffects(data, CPR).unmatched.map((u) => u.target))
      .toEqual(backend.default.effects(data).unmatched.map((u: { target: string }) => u.target));
  });
});
