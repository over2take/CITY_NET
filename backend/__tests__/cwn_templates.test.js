import { describe, it, expect } from 'vitest';

const { applyDerived, TEMPLATES } = require('../sheets/templates');
const { getRoll } = require('../sheets/rolls');

describe('CWN derived fields (recompute hook)', () => {
  it('computes attribute mods from the SWN/CWN table, not floor((stat-10)/2)', () => {
    const data = { str: 3, dex: 7, con: 8, int: 13, wis: 14, cha: 18 };
    applyDerived('cities_without_number', data, 'str');
    expect(data.str_mod).toBe(-2);
    expect(data.dex_mod).toBe(-1);
    expect(data.con_mod).toBe(0);
    expect(data.int_mod).toBe(0);
    expect(data.wis_mod).toBe(1);
    expect(data.cha_mod).toBe(2);
  });

  it('treats unset stats as neutral (mod 0), not stat-3', () => {
    const data = { str: 14 }; // everything else blank on a half-filled sheet
    applyDerived('cities_without_number', data, 'str');
    expect(data.str_mod).toBe(1);
    expect(data.int_mod).toBe(0);
    expect(data.wis_mod).toBe(0);
    expect(data.dex_mod).toBe(0);
  });

  it('computes saves as 16 - (level + best relevant mod)', () => {
    const data = { level: 3, str: 14, con: 8, dex: 18, int: 10, wis: 4, cha: 10 };
    applyDerived('cities_without_number', data, 'level');
    expect(data.save_physical).toBe(16 - (3 + 1)); // best of STR +1 / CON 0
    expect(data.save_evasion).toBe(16 - (3 + 2)); // best of DEX +2 / INT 0
    expect(data.save_mental).toBe(16 - (3 + 0)); // best of WIS -1 / CHA 0
    expect(data.save_luck).toBe(16 - 3);
  });

  it('sets system strain max to the CON score and effort maxes to min 1', () => {
    const data = { con: 12, int: 10, wis: 10, cha: 7, cast_skill: 0, summon_skill: 0 };
    applyDerived('cities_without_number', data, 'con');
    expect(data.system_strain_max).toBe(12);
    expect(data.mage_effort_max).toBe(1); // 0 mod + 0 skill, floored at 1
    expect(data.summoner_effort_max).toBe(1); // best of 0/-1 + 0, floored at 1
  });

  it('computes effort maxes from best mod + skill', () => {
    const data = { con: 10, int: 16, wis: 10, cha: 18, cast_skill: 2, summon_skill: 1 };
    applyDerived('cities_without_number', data, 'int');
    expect(data.mage_effort_max).toBe(1 + 2); // INT +1, Cast 2
    expect(data.summoner_effort_max).toBe(2 + 1); // CHA +2, Summon 1
  });

  it('returns the ids of changed fields and is idempotent', () => {
    const data = { str: 14, level: 1 };
    const first = applyDerived('cities_without_number', data, 'str');
    expect(first).toContain('str_mod');
    const second = applyDerived('cities_without_number', data, 'str');
    expect(second).toEqual([]);
  });

  it('does not disturb the CP:R divisor rule (Humanity -> EMP)', () => {
    const data = { humanity: 47 };
    const changed = applyDerived('cyberpunk_red', data, 'humanity');
    expect(changed).toEqual(['emp']);
    expect(data.emp).toBe(4);
  });

  it('registers CWN server metadata with AC as a combat field', () => {
    const meta = TEMPLATES.cities_without_number;
    expect(meta.combatFields).toContain('ac');
    expect(meta.linkedFields.hp).toBe('token_hp');
    expect(meta.maxPairs.system_strain_max).toBe('system_strain');
  });
});

describe('CWN effective AC from armor', () => {
  const { cwnEffectiveAc } = require('../sheets/templates');

  it('returns null while armor_ac is unset (manual AC stands)', () => {
    expect(cwnEffectiveAc({})).toBeNull();
    expect(cwnEffectiveAc({ armor_ac: '' })).toBeNull();
    expect(cwnEffectiveAc({ armor_ac: 0 })).toBeNull();
  });

  it('adds the DEX mod to the armor base, on both ACs', () => {
    // p52: "A PC's Dexterity modifier is always applied to both ACs".
    expect(cwnEffectiveAc({ armor_ac: 14, dex: 14 })).toEqual({ ranged: 15, melee: 15 });
    expect(cwnEffectiveAc({ armor_ac: 14, dex: 4 })).toEqual({ ranged: 13, melee: 13 });
    expect(cwnEffectiveAc({ armor_ac: 14 })).toEqual({ ranged: 14, melee: 14 });
  });

  it('caps the DEX bonus for heavy armor (0 = none, blank = uncapped)', () => {
    // Not a CWN rule - the book applies the mod uncapped - but the field exists and
    // does nothing while blank, which is how every sheet has it. Pinned so that
    // whoever decides to remove it has to mean it.
    expect(cwnEffectiveAc({ armor_ac: 16, dex: 18, armor_dex_cap: 1 })).toEqual({ ranged: 17, melee: 17 });
    expect(cwnEffectiveAc({ armor_ac: 16, dex: 18, armor_dex_cap: 0 })).toEqual({ ranged: 16, melee: 16 });
    expect(cwnEffectiveAc({ armor_ac: 16, dex: 18, armor_dex_cap: '' })).toEqual({ ranged: 18, melee: 18 });
  });

  it('adds a shield bonus', () => {
    expect(cwnEffectiveAc({ armor_ac: 13, dex: 10, shield_bonus: 1 })).toEqual({ ranged: 14, melee: 14 });
  });

  it('reads a sheet written before the split exactly as it did', () => {
    // The whole reason melee falls back to ranged rather than to 10. Every existing
    // CWN character has armor_ac and nothing else, and must not silently change.
    expect(cwnEffectiveAc({ armor_ac: 16, dex: 14, shield_bonus: 1 }))
      .toEqual({ ranged: 18, melee: 18 });
  });

  it('gives the book the two numbers it prints', () => {
    // p53 armor table, ranged column then melee: War Harness 13/14, Impact Jacket
    // 12/14, Heavy Armored Suit 20/18 - which is the case that proves the melee value
    // is not simply the larger one.
    const at = (r, m) => cwnEffectiveAc({ armor_ac: r, armor_ac_melee: m });
    expect(at(13, 14)).toEqual({ ranged: 13, melee: 14 });
    expect(at(12, 14)).toEqual({ ranged: 12, melee: 14 });
    expect(at(20, 18)).toEqual({ ranged: 20, melee: 18 });
  });

  it('works the example in the book through', () => {
    // p52: a medium armored suit is 18 ranged and 14 melee; at +1 Dex the book says
    // the wearer has "a ranged AC of 19 and a melee AC of 15".
    expect(cwnEffectiveAc({ armor_ac: 18, armor_ac_melee: 14, dex: 14 }))
      .toEqual({ ranged: 19, melee: 15 });
  });

  it('splits the shield too, for a Riot Shield', () => {
    // p53 accessories: Riot Shield is +2 ranged and +4 melee. A single shield field
    // could not say that.
    expect(cwnEffectiveAc({ armor_ac: 13, armor_ac_melee: 12, shield_bonus: 2, shield_bonus_melee: 4 }))
      .toEqual({ ranged: 15, melee: 16 });
    // Blank melee shield means the same both ways, like Absorption Plates at +2/+2.
    expect(cwnEffectiveAc({ armor_ac: 13, armor_ac_melee: 12, shield_bonus: 2 }))
      .toEqual({ ranged: 15, melee: 14 });
  });

  it('clamps each AC on its own', () => {
    const out = cwnEffectiveAc({ armor_ac: 99, armor_ac_melee: 1, dex: 18, shield_bonus: 5 });
    expect(out.ranged).toBe(99);
    expect(out.melee).toBe(8);
  });
});

describe('which token AC columns a sheet edit writes', () => {
  const { acColumns, getLinkedFields } = require('../sheets/templates');

  it('writes only its own column when the system has two ACs', () => {
    const cwn = getLinkedFields('cities_without_number');
    expect(acColumns(cwn, { ac: 12 })).toEqual({ sets: 'melee_ac = ?', values: [12] });
    expect(acColumns(cwn, { ac_ranged: 15 })).toEqual({ sets: 'ranged_ac = ?', values: [15] });
    expect(acColumns(cwn, { ac: 12, ac_ranged: 15 }))
      .toEqual({ sets: 'melee_ac = ?, ranged_ac = ?', values: [12, 15] });
  });

  it('still writes both columns for a system with one AC', () => {
    // The no-bleed guarantee. Shadowrun keeps its Armor Rating in the melee slot and
    // has always written both; nothing about the CWN split may reach it.
    const sr6 = getLinkedFields('shadowrun_6e');
    expect(acColumns(sr6, { armor_rating: 7 }))
      .toEqual({ sets: 'melee_ac = ?, ranged_ac = ?', values: [7, 7] });
  });

  it('writes nothing for a system that links no AC at all', () => {
    for (const sys of ['generic', 'cyberpunk_red']) {
      expect(acColumns(getLinkedFields(sys), { ac: 12, armor_rating: 7 })).toBeNull();
    }
  });

  it('ignores a patch with no AC in it, and an unusable value', () => {
    const cwn = getLinkedFields('cities_without_number');
    expect(acColumns(cwn, { name: 'Kestrel' })).toBeNull();
    expect(acColumns(cwn, { ac: 'nonsense' })).toBeNull();
    expect(acColumns(cwn, { ac: -1 })).toBeNull();
    expect(acColumns(cwn, { ac: 100 })).toBeNull();
    // One good and one bad writes just the good one rather than failing both.
    expect(acColumns(cwn, { ac: 200, ac_ranged: 15 }))
      .toEqual({ sets: 'ranged_ac = ?', values: [15] });
  });
});

describe('CWN roll map', () => {
  it('skills roll 2d6 + skill + mod in plain sum shape (no explosion)', () => {
    const roll = getRoll('cities_without_number', 'shoot');
    expect(roll.formula).toBe('2d6 + @shoot + @dex_mod');
    expect(roll.shape).toBe('sum');
  });

  it('saves roll a bare d20', () => {
    const roll = getRoll('cities_without_number', 'save_physical');
    expect(roll.formula).toBe('1d20');
    expect(roll.shape).toBe('sum');
  });

  it('has no exploding rolls anywhere in the CWN map', () => {
    const { ROLLS } = require('../sheets/rolls');
    Object.values(ROLLS.cities_without_number).forEach((r) => {
      expect(r.shape).toBe('sum');
    });
  });
});
