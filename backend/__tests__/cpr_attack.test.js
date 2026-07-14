import { describe, it, expect } from 'vitest';
import {
  AIMED_PENALTY, getWeapon, rollToHit, rollDamage, applyArmor, applyShield,
  isCriticalInjury, rollDeathSave, MELEE_SKILLS, RANGED_SKILLS, checkPenalties,
  resolveLuckSpend,
} from '../sheets/attack.js';

// Deterministic RNG: feed die faces in order (works for any sides because the
// engine floors rng()*sides — pass the fraction for the face you want).
const dieRng = (sides, ...faces) => {
  const queue = [...faces];
  return () => (queue.shift() - 1 + 0.5) / sides;
};

const sheet = {
  ref: 7, dex: 6, handgun: 5, melee_weapon: 3, body: 6,
  weapon1_name: 'Militech Avenger', weapon1_dmg: '2d6', weapon1_skill: 'handgun', weapon1_rof: 2,
  weapon2_name: 'Sword', weapon2_dmg: '3d6', weapon2_skill: 'melee_weapon', weapon2_rof: 2,
  weapon3_name: 'Bad Row', weapon3_dmg: '2d6 + @ref', weapon3_skill: 'handgun',
  weapon4_name: 'No Skill', weapon4_dmg: '2d6', weapon4_skill: 'perception',
};

describe('getWeapon', () => {
  it('reads a valid ranged weapon row', () => {
    expect(getWeapon(sheet, 1)).toEqual({
      name: 'Militech Avenger', dmg: '2d6', skill: 'handgun', attackType: 'ranged',
    });
  });

  it('classifies melee skills as melee attacks', () => {
    expect(getWeapon(sheet, 2).attackType).toBe('melee');
  });

  it('rejects damage that is not pure dice (no field refs or flat bonuses)', () => {
    expect(getWeapon(sheet, 3)).toBeNull();
  });

  it('rejects non-weapon skills', () => {
    expect(getWeapon(sheet, 4)).toBeNull();
  });

  it('rejects out-of-range and non-integer indexes', () => {
    expect(getWeapon(sheet, 0)).toBeNull();
    expect(getWeapon(sheet, 5)).toBeNull();
    expect(getWeapon(sheet, '1; DROP')).toBeNull();
  });

  it('falls back to WEAPON N when the row has no name', () => {
    const s = { ...sheet, weapon1_name: '' };
    expect(getWeapon(s, 1).name).toBe('WEAPON 1');
  });
});

describe('rollToHit', () => {
  const weapon = getWeapon(sheet, 1); // handgun keys off REF

  it('rolls 1d10 + stat + skill', () => {
    const out = rollToHit(sheet, weapon, false, dieRng(10, 6));
    expect(out.total).toBe(6 + 7 + 5);
    expect(out.critical).toBeNull();
  });

  it('applies the aimed-shot penalty', () => {
    const out = rollToHit(sheet, weapon, true, dieRng(10, 6));
    expect(out.total).toBe(6 + 7 + 5 - AIMED_PENALTY);
  });

  it('explodes on a natural 10', () => {
    const out = rollToHit(sheet, weapon, false, dieRng(10, 10, 4));
    expect(out.critical).toBe('success');
    expect(out.total).toBe(10 + 4 + 7 + 5);
  });

  it('implodes on a natural 1', () => {
    const out = rollToHit(sheet, weapon, false, dieRng(10, 1, 4));
    expect(out.critical).toBe('failure');
    expect(out.total).toBe(1 - 4 + 7 + 5);
  });
});

describe('rollDamage', () => {
  it('rolls the weapon dice as a plain sum (no explosion)', () => {
    const weapon = getWeapon(sheet, 2); // 3d6
    const out = rollDamage(weapon, dieRng(6, 6, 6, 6));
    expect(out.total).toBe(18);
    expect(out.critical).toBeNull();
  });
});

describe('applyArmor', () => {
  it('SP soaks damage; only the excess gets through and armor ablates', () => {
    expect(applyArmor(10, 7, false)).toEqual({ through: 3, ablated: true });
  });

  it('no penetration means no damage and no ablation', () => {
    expect(applyArmor(7, 7, false)).toEqual({ through: 0, ablated: false });
    expect(applyArmor(3, 7, false)).toEqual({ through: 0, ablated: false });
  });

  it('aimed (head) hits double the damage that gets through', () => {
    expect(applyArmor(10, 7, true)).toEqual({ through: 6, ablated: true });
  });

  it('treats missing/negative SP as 0', () => {
    expect(applyArmor(5, undefined, false)).toEqual({ through: 5, ablated: true });
    expect(applyArmor(5, -3, false)).toEqual({ through: 5, ablated: true });
  });
});

describe('rollDeathSave', () => {
  it('succeeds when die + penalty <= BODY', () => {
    expect(rollDeathSave(6, 0, dieRng(10, 5)).success).toBe(true);
    expect(rollDeathSave(6, 0, dieRng(10, 6)).success).toBe(true);
  });

  it('fails when die + penalty > BODY', () => {
    expect(rollDeathSave(6, 0, dieRng(10, 7)).success).toBe(false);
  });

  it('escalating penalty makes later saves harder', () => {
    // BODY 6: a 5 passes untreated round 1, but fails with +2 penalty
    expect(rollDeathSave(6, 0, dieRng(10, 5)).success).toBe(true);
    const later = rollDeathSave(6, 2, dieRng(10, 5));
    expect(later.total).toBe(7);
    expect(later.success).toBe(false);
  });

  it('a natural 10 always fails, even with a huge BODY', () => {
    expect(rollDeathSave(20, 0, dieRng(10, 10)).success).toBe(false);
  });

  it('clamps a negative stored penalty to 0', () => {
    expect(rollDeathSave(6, -3, dieRng(10, 5)).penalty).toBe(0);
  });
});

describe('skill lists', () => {
  it('melee and ranged lists do not overlap', () => {
    expect(MELEE_SKILLS.filter(s => RANGED_SKILLS.includes(s))).toEqual([]);
  });
});

describe('applyShield', () => {
  it('shield absorbs damage and loses points', () => {
    expect(applyShield(4, 10)).toEqual({ absorbed: 4, remaining: 0, newShield: 6, destroyed: false });
  });

  it('overflow past the shield passes on and the shield is destroyed', () => {
    expect(applyShield(12, 10)).toEqual({ absorbed: 10, remaining: 2, newShield: 0, destroyed: true });
  });

  it('no shield means everything passes through untouched', () => {
    expect(applyShield(8, 0)).toEqual({ absorbed: 0, remaining: 8, newShield: 0, destroyed: false });
    expect(applyShield(8, undefined)).toEqual({ absorbed: 0, remaining: 8, newShield: 0, destroyed: false });
  });
});

describe('isCriticalInjury', () => {
  it('two dice at max face is a critical injury', () => {
    expect(isCriticalInjury({ 6: [6, 6, 2] })).toBe(true);
  });

  it('one max die is not', () => {
    expect(isCriticalInjury({ 6: [6, 3, 2] })).toBe(false);
  });

  it('works across die sizes (max face per size)', () => {
    expect(isCriticalInjury({ 8: [8, 8] })).toBe(true);
    expect(isCriticalInjury({ 8: [6, 6] })).toBe(false); // 6 is not max on a d8
  });

  it('handles missing rolls', () => {
    expect(isCriticalInjury(undefined)).toBe(false);
    expect(isCriticalInjury({})).toBe(false);
  });
});

describe('checkPenalties', () => {
  it('armor penalty hits REF/DEX checks only', () => {
    const data = { armor_penalty: 2 };
    expect(checkPenalties(data, 'ref', 20)).toEqual([{ label: 'armor', value: -2 }]);
    expect(checkPenalties(data, 'dex', 20)).toEqual([{ label: 'armor', value: -2 }]);
    expect(checkPenalties(data, 'int', 20)).toEqual([]);
  });

  it('seriously wounded gives -2, mortally wounded -4', () => {
    const data = { seriously_wounded: 17 };
    expect(checkPenalties(data, 'int', 20)).toEqual([]);
    expect(checkPenalties(data, 'int', 17)).toEqual([{ label: 'wounded', value: -2 }]);
    expect(checkPenalties(data, 'int', 0)).toEqual([{ label: 'mortally wounded', value: -4 }]);
  });

  it('no hp info means no wound penalty', () => {
    expect(checkPenalties({ seriously_wounded: 17 }, 'int', null)).toEqual([]);
  });

  it('penalties stack: wounded solo in heavy armor', () => {
    const mods = checkPenalties({ armor_penalty: 1, seriously_wounded: 17 }, 'ref', 10);
    expect(mods.reduce((a, m) => a + m.value, 0)).toBe(-3);
  });
});

describe('rollToHit with LUCK and penalties', () => {
  const weapon = getWeapon(sheet, 1); // handgun, REF 7 + skill 5

  it('adds declared LUCK as a flat bonus', () => {
    const out = rollToHit(sheet, weapon, false, dieRng(10, 6), { luck: 3 });
    expect(out.total).toBe(6 + 7 + 5 + 3);
  });

  it('noFumble keeps a natural 1 at face value (fumble shield / house rule)', () => {
    const out = rollToHit(sheet, weapon, false, dieRng(10, 1), { noFumble: true });
    expect(out.critical).toBeNull();
    expect(out.total).toBe(1 + 7 + 5);
  });

  it('LUCK bonus alone does NOT negate a fumble (RAW)', () => {
    const out = rollToHit(sheet, weapon, false, dieRng(10, 1, 4), { luck: 1 });
    expect(out.critical).toBe('failure');
    expect(out.total).toBe(1 - 4 + 7 + 5 + 1);
  });

  it('without LUCK a natural 1 still fumbles', () => {
    const out = rollToHit(sheet, weapon, false, dieRng(10, 1, 4));
    expect(out.critical).toBe('failure');
  });

  it('applies armor and wound penalties to the attack', () => {
    const armored = { ...sheet, armor_penalty: 2, seriously_wounded: 17 };
    const out = rollToHit(armored, weapon, false, dieRng(10, 6), { hp: 10 });
    expect(out.total).toBe(6 + 7 + 5 - 2 - 2);
  });
});


describe('resolveLuckSpend', () => {
  it('bonus is clamped to the pool', () => {
    expect(resolveLuckSpend(2, 5, false)).toEqual({ bonus: 2, negate: false, total: 2 });
  });

  it('the fumble shield is paid first, bonus gets the rest', () => {
    expect(resolveLuckSpend(3, 5, true)).toEqual({ bonus: 2, negate: true, total: 3 });
  });

  it('shield alone costs exactly 1', () => {
    expect(resolveLuckSpend(4, 0, true)).toEqual({ bonus: 0, negate: true, total: 1 });
  });

  it('no pool means no shield and no bonus', () => {
    expect(resolveLuckSpend(0, 3, true)).toEqual({ bonus: 0, negate: false, total: 0 });
  });
});
