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
