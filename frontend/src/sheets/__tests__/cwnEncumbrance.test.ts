import { describe, it, expect } from 'vitest';
import {
  encLimits, encState, carriedEnc, encumberedMove, describeEnc,
  ENC_MOVE_PENALTY, ENCUMBRANCE_RULE, CWN_ENC_SIZES,
} from '../cwnEncumbrance';
import { getTemplate } from '../index';

/**
 * Encumbrance (CWN p48).
 *
 * Counted always, charged only where the table asked - the book says outright that some
 * tables prefer not to use these rules.
 *
 * The penalty is the whole penalty: being overloaded costs SPEED and nothing else. No hit
 * penalty, no skill penalty, no AC change.
 */

describe('what you may carry', () => {
  it('readies half your Strength, rounded down', () => {
    expect(encLimits({ str: 10 })).toEqual({ readied: 5, stowed: 10 });
    expect(encLimits({ str: 13 }).readied).toBe(6);
  });

  it('stows up to all of it', () => {
    expect(encLimits({ str: 13 }).stowed).toBe(13);
  });

  it('reads a blank sheet as carrying nothing rather than going negative', () => {
    expect(encLimits({})).toEqual({ readied: 0, stowed: 0 });
    expect(encLimits({ str: -5 })).toEqual({ readied: 0, stowed: 0 });
  });
});

describe('the penalty for going over', () => {
  const at = (readied: number, stowed: number, str = 10) =>
    encState({ str }, { readied, stowed });

  it('costs nothing while within both limits', () => {
    expect(at(5, 10).overload).toBe(0);
    expect(at(5, 10).movePenalty).toBe(0);
  });

  it('takes 30% for the first push', () => {
    // "an additional two Ready and four Stowed items... their Move speed is cut by 30%"
    expect(at(6, 10).overload).toBe(1);
    expect(at(7, 10).overload).toBe(1);
    expect(at(5, 14).overload).toBe(1);
    expect(at(6, 10).movePenalty).toBe(0.3);
  });

  it('takes 50% for the second', () => {
    expect(at(8, 10).overload).toBe(2);
    expect(at(5, 18).overload).toBe(2);
    expect(at(8, 10).movePenalty).toBe(0.5);
  });

  it('measures both cuts from the base rate, not one after the other', () => {
    // The book works both from 10m: "from 10m to 7m", then "from 10m to 5m".
    expect(encumberedMove(10, at(6, 10))).toBe(7);
    expect(encumberedMove(10, at(8, 10))).toBe(5);
    expect(ENC_MOVE_PENALTY).toEqual([0, 0.3, 0.5]);
  });

  it('says when more is being carried than can be hauled at all', () => {
    // "More weight than this can't be practically hauled over significant distances."
    // With Str 10 the Readied ladder is 5, then 7 after one push, then 9 after two - so 9
    // is still legal and 10 is the first amount the book has no answer for.
    expect(at(9, 10).impossible).toBe(false);
    expect(at(10, 10).impossible).toBe(true);
    expect(at(5, 18).impossible).toBe(false);
    expect(at(5, 19).impossible).toBe(true);
  });

  it('is decided by whichever track is worse', () => {
    // A character can be fine on one and over on the other. Being fine on Stowed does not
    // pay for being two pushes over on Readied.
    expect(at(8, 0).overload).toBe(2);
    expect(at(0, 18).overload).toBe(2);
  });

  it('rounds the resulting Move down, and never below zero', () => {
    expect(encumberedMove(7, at(6, 10))).toBe(4);   // 7 * 0.7 = 4.9
    expect(encumberedMove(0, at(8, 10))).toBe(0);
  });
});

describe('what the sheet can count', () => {
  const sheet = (over = {}) => ({
    str: 10, armor_enc: 1,
    weapon1_name: 'Heavy Pistol', weapon1_enc: '1', weapon1_carry: 'readied',
    weapon2_name: 'Combat Rifle', weapon2_enc: '2', weapon2_carry: 'stowed',
    ...over,
  });

  it('counts worn armor as Readied, because it is', () => {
    expect(carriedEnc({ str: 10, armor_enc: 3 })).toEqual({ readied: 3, stowed: 0 });
  });

  it('counts a weapon where its CARRY says it is', () => {
    expect(carriedEnc(sheet())).toEqual({ readied: 2, stowed: 2 });
  });

  it('counts an unfiled weapon as Stowed rather than ignoring it', () => {
    // It is on the sheet, so it is being carried. Stowed is the more forgiving guess.
    expect(carriedEnc(sheet({ weapon1_carry: '' })).stowed).toBe(3);
  });

  it('ignores an empty weapon row', () => {
    // A blank slot is not a weapon that weighs nothing.
    expect(carriedEnc({ str: 10, weapon3_enc: '2' })).toEqual({ readied: 0, stowed: 0 });
  });

  it('adds what the player totalled for the gear notes', () => {
    const out = carriedEnc(sheet({ gear_enc_readied: 2, gear_enc_stowed: 4 }));
    expect(out).toEqual({ readied: 4, stowed: 6 });
  });
});

describe('the line it shows', () => {
  it('reads as a count while everything fits', () => {
    expect(describeEnc(encState({ str: 10 }, { readied: 3, stowed: 4 })))
      .toBe('READIED 3/5 · STOWED 4/10');
  });

  it('says what being over costs', () => {
    expect(describeEnc(encState({ str: 10 }, { readied: 6, stowed: 4 })))
      .toContain('Move -30%');
  });

  it('says when it cannot be carried at all', () => {
    expect(describeEnc(encState({ str: 10 }, { readied: 20, stowed: 4 })))
      .toContain('more than can be hauled');
  });
});

describe('where it lives', () => {
  const CWN = getTemplate('cities_without_number');
  const ids = CWN.sections.flatMap((s) => (s.fields ?? []).map((f) => f.id));

  it('names the house rule, which is off by default', () => {
    expect(ENCUMBRANCE_RULE).toBe('cwn_encumbrance');
  });

  it('keeps the guideline sizes, which are a guide and not a list', () => {
    // Not the set of legal values: the weapon and armour tables print their own - an
    // Automatic Rifle is 4, a Plated Longcoat 3 - and the last row of this one is 5+.
    expect(CWN_ENC_SIZES.map((o) => o.value)).toEqual(['0', '1', '2', '5', '12']);
  });

  it('puts the count at the top of GEAR', () => {
    const section = CWN.sections.find((s) => s.layout === 'encumbrance')!;
    expect(section.tab).toBe('GEAR');
    const gear = CWN.sections.filter((s) => s.tab === 'GEAR');
    expect(gear[0].id).toBe(section.id);
  });

  it('gives armor and every weapon an Enc', () => {
    expect(ids).toContain('armor_enc');
    for (let i = 1; i <= 4; i += 1) expect(ids).toContain(`weapon${i}_enc`);
  });

  it('gives the player somewhere to total the gear notes', () => {
    expect(ids).toContain('gear_enc_readied');
    expect(ids).toContain('gear_enc_stowed');
  });

  it('is on no other system', () => {
    for (const id of ['cyberpunk_red', 'shadowrun_6e', 'generic']) {
      const other = getTemplate(id).sections.flatMap((s) => (s.fields ?? []).map((f) => f.id));
      expect(other, id).not.toContain('armor_enc');
      expect(other, id).not.toContain('gear_enc_readied');
    }
  });
});
