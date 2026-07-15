import { describe, it, expect } from 'vitest';

const attackCwn = require('../sheets/attackCwn');

// Deterministic rng: returns each queued value in order (0..1).
const rngOf = (...vals) => { let i = 0; return () => vals[i++ % vals.length]; };

const SHEET = {
  base_hit_bonus: 2,
  shoot: 1, stab: 2, punch: 0, heal: 2,
  dex_mod: 1, str_mod: 1, int_mod: 1,
  weapon1_name: 'Heavy Pistol', weapon1_dmg: '1d8+1', weapon1_skill: 'shoot',
  weapon1_trauma: 'd8/x3', weapon1_shock: '2/13', weapon1_atk: 1,
  weapon2_name: 'Knife', weapon2_dmg: '1d6', weapon2_skill: 'stab',
  weapon2_trauma: '', weapon2_shock: '', weapon2_atk: 0,
  weapon3_dmg: '1d6+@str_mod', weapon3_skill: 'shoot', // formula sneak-in
};

describe('CWN weapon parsing', () => {
  it('reads a full 6-field row with trauma and shock', () => {
    const w = attackCwn.getWeapon(SHEET, 1);
    expect(w.name).toBe('Heavy Pistol');
    expect(w.dmg).toBe('1d8+1');
    expect(w.mod).toBe('dex_mod');
    expect(w.atk).toBe(1);
    expect(w.trauma).toEqual({ die: 8, rating: 3 });
    expect(w.shock).toEqual({ dmg: 2, ac: 13 });
    expect(w.attackType).toBe('ranged');
  });

  it('treats blank trauma/shock as none and stab as melee', () => {
    const w = attackCwn.getWeapon(SHEET, 2);
    expect(w.trauma).toBeNull();
    expect(w.shock).toBeNull();
    expect(w.attackType).toBe('melee');
  });

  it('rejects damage with field references (client sneak-in)', () => {
    expect(attackCwn.getWeapon(SHEET, 3)).toBeNull();
  });

  it('rejects bad indexes and unknown skills', () => {
    expect(attackCwn.getWeapon(SHEET, 0)).toBeNull();
    expect(attackCwn.getWeapon(SHEET, 5)).toBeNull();
    expect(attackCwn.getWeapon({ weapon1_dmg: '1d6', weapon1_skill: 'perception' }, 1)).toBeNull();
  });

  it('parses trauma and shock string variants', () => {
    expect(attackCwn.parseTrauma('d10/x2')).toEqual({ die: 10, rating: 2 });
    expect(attackCwn.parseTrauma('d6/3')).toEqual({ die: 6, rating: 3 });
    expect(attackCwn.parseTrauma('garbage')).toBeNull();
    expect(attackCwn.parseShock('2/AC13')).toEqual({ dmg: 2, ac: 13 });
    expect(attackCwn.parseShock('3 / 15')).toEqual({ dmg: 3, ac: 15 });
    expect(attackCwn.parseShock('')).toBeNull();
  });
});

describe('CWN to-hit and damage', () => {
  it('rolls 1d20 + BHB + skill + mod + weapon atk', () => {
    const w = attackCwn.getWeapon(SHEET, 1);
    // rng 0.5 -> d20 shows 11; mods: BHB 2 + shoot 1 + dex 1 + atk 1 = 5
    const out = attackCwn.rollToHit(SHEET, w, rngOf(0.5));
    expect(out.total).toBe(11 + 5);
  });

  it('adds the attribute mod to damage', () => {
    const w = attackCwn.getWeapon(SHEET, 1);
    // rng 0 -> d8 shows 1; +1 flat +1 dex mod
    const out = attackCwn.rollDamage(SHEET, w, rngOf(0));
    expect(out.total).toBe(1 + 1 + 1);
  });
});

describe('CWN trauma (optional rule)', () => {
  const weapon = { trauma: { die: 8, rating: 3 } };

  it('returns null when the rule is off or the weapon has no trauma', () => {
    expect(attackCwn.rollTrauma(weapon, false)).toBeNull();
    expect(attackCwn.rollTrauma({ trauma: null }, true)).toBeNull();
  });

  it('flags a traumatic hit when the die meets the rating', () => {
    // rng 0.9 -> d8 shows 8 >= 3
    const t = attackCwn.rollTrauma(weapon, true, rngOf(0.9));
    expect(t.traumatic).toBe(true);
    expect(t.rating).toBe(3);
  });

  it('does not flag below the rating', () => {
    // rng 0 -> d8 shows 1 < 3
    const t = attackCwn.rollTrauma(weapon, true, rngOf(0));
    expect(t.traumatic).toBe(false);
  });
});

describe('CWN shock on a miss', () => {
  const weapon = { shock: { dmg: 2, ac: 13 }, mod: 'dex_mod' };

  it('applies when the target AC is covered', () => {
    expect(attackCwn.shockDamage(SHEET, weapon, 13)).toBe(2 + 1);
    expect(attackCwn.shockDamage(SHEET, weapon, 10)).toBe(3);
  });

  it('does not apply above the shock AC or without shock', () => {
    expect(attackCwn.shockDamage(SHEET, weapon, 14)).toBe(0);
    expect(attackCwn.shockDamage(SHEET, { shock: null, mod: 'dex_mod' }, 10)).toBe(0);
  });
});

describe('CWN stabilization', () => {
  it('rolls 2d6 + Heal + INT vs 8 + rounds down', () => {
    // rng 0.5,0.5 -> 4+4 = 8; +heal 2 +int 1 = 11 vs DC 8+2 = 10
    const out = attackCwn.rollStabilize(SHEET, 2, false, rngOf(0.5));
    expect(out.dc).toBe(10);
    expect(out.total).toBe(11);
    expect(out.success).toBe(true);
  });

  it('adds +2 to the DC without tools', () => {
    const out = attackCwn.rollStabilize(SHEET, 0, true, rngOf(0));
    expect(out.dc).toBe(10);
    // 1+1 dice + 3 mods = 5 vs 10
    expect(out.success).toBe(false);
  });
});
