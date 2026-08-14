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

  it('flags a traumatic hit when the die meets the TARGET trauma target', () => {
    // rng 0.9 -> d8 shows 8 >= TT 6 (default)
    const t = attackCwn.rollTrauma(weapon, true, undefined, rngOf(0.9));
    expect(t.traumatic).toBe(true);
    expect(t.tt).toBe(6);
    expect(t.rating).toBe(3); // rating is the damage multiplier, not the threshold
  });

  it('does not flag below the trauma target', () => {
    // rng 0.5 -> d8 shows 5 < TT 6 (would have beaten the old rating-3 threshold)
    const t = attackCwn.rollTrauma(weapon, true, undefined, rngOf(0.5));
    expect(t.traumatic).toBe(false);
  });

  it('respects a raised defender trauma target', () => {
    // rng 0.9 -> d8 shows 8; TT 9 from armor/cyber -> no trauma
    const t = attackCwn.rollTrauma(weapon, true, 9, rngOf(0.9));
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

// ─── vehicle mounts ───────────────────────────────────────────────────────────

/**
 * Mounted weapons resolve through the same `getWeapon` as personal ones, differing only
 * in the field prefix. A second implementation is the thing being avoided here — two
 * copies of dice parsing and skill validation would drift.
 */
describe('vehicle weapon mounts', () => {
  const sheet = {
    weapon1_name: 'Pistol', weapon1_dmg: '1d8+1', weapon1_skill: 'shoot',
    vehicle1_weapon1_name: 'Autocannon', vehicle1_weapon1_dmg: '2d8', vehicle1_weapon1_skill: 'shoot', vehicle1_weapon1_atk: '2',
    vehicle1_weapon2_name: 'Grenade Launcher', vehicle1_weapon2_dmg: '3d6', vehicle1_weapon2_skill: 'shoot',
    vehicle2_weapon1_name: 'Roof Gun', vehicle2_weapon1_dmg: '1d10', vehicle2_weapon1_skill: 'shoot',
  };

  it('reads a mount off the vehicle it belongs to', () => {
    const w = attackCwn.getVehicleWeapon(sheet, 1, 1);
    expect(w.name).toBe('Autocannon');
    expect(w.dmg).toBe('2d8');
    expect(w.atk).toBe(2);
  });

  it('keeps each vehicle mounts separate', () => {
    // Mount ids nest under the vehicle, so vehicle 2's gun is not vehicle 1's.
    expect(attackCwn.getVehicleWeapon(sheet, 2, 1).name).toBe('Roof Gun');
    expect(attackCwn.getVehicleWeapon(sheet, 1, 2).name).toBe('Grenade Launcher');
  });

  it('does not confuse a mount with a personal weapon', () => {
    expect(attackCwn.getWeapon(sheet, 1).name).toBe('Pistol');
    expect(attackCwn.getVehicleWeapon(sheet, 1, 1).name).toBe('Autocannon');
  });

  it('rejects a vehicle index outside the sheet', () => {
    expect(attackCwn.getVehicleWeapon(sheet, 0, 1)).toBeNull();
    expect(attackCwn.getVehicleWeapon(sheet, attackCwn.VEHICLE_ROWS + 1, 1)).toBeNull();
    expect(attackCwn.getVehicleWeapon(sheet, 'x', 1)).toBeNull();
  });

  it('rejects a mount index outside the vehicle', () => {
    expect(attackCwn.getVehicleWeapon(sheet, 1, 0)).toBeNull();
    expect(attackCwn.getVehicleWeapon(sheet, 1, attackCwn.VEHICLE_WEAPON_ROWS + 1)).toBeNull();
  });

  it('applies the same damage validation as a personal weapon', () => {
    // The point of sharing the resolver: no @field sneak-ins through the vehicle path.
    const bad = { ...sheet, vehicle1_weapon1_dmg: '@str_mod' };
    expect(attackCwn.getVehicleWeapon(bad, 1, 1)).toBeNull();
  });

  it('applies the same skill validation as a personal weapon', () => {
    const bad = { ...sheet, vehicle1_weapon1_skill: 'drive' };
    expect(attackCwn.getVehicleWeapon(bad, 1, 1)).toBeNull();
  });

  it('rolls damage for a mount exactly as for a personal weapon', () => {
    // Same resolver, so a mount is not a special case downstream either.
    const w = attackCwn.getVehicleWeapon(sheet, 1, 1);
    const rolled = attackCwn.rollDamage(sheet, w);
    expect(rolled.total).toBeGreaterThan(0);
  });

  it('leaves the personal weapon path unchanged when no prefix is given', () => {
    // Every existing caller passes two arguments; the default must stay `weapon`.
    expect(attackCwn.getWeapon(sheet, 1)).toEqual(attackCwn.getWeapon(sheet, 1, {}));
  });
});

// ─── vehicle combat rules ─────────────────────────────────────────────────────

/**
 * Not wired into an attack yet — a sheet-held vehicle cannot be targeted, because
 * getAttackTarget resolves only token rows. These pin the arithmetic so that wiring is
 * the only thing left to do, and so the AC/AR distinction cannot quietly invert.
 */
describe('vehicle combat rules', () => {
  it('makes a moving vehicle harder to hit, by its driver skill', () => {
    // A vehicle is only as hard to hit as its driver is good.
    expect(attackCwn.vehicleAc(12, { moving: true, driveSkill: 3 })).toBe(15);
    expect(attackCwn.vehicleAc(12, { moving: true, driveSkill: 0 })).toBe(12);
  });

  it('makes a stationary vehicle easier to hit, by a flat penalty', () => {
    expect(attackCwn.vehicleAc(12, { moving: false })).toBe(8);
    expect(attackCwn.vehicleAc(12)).toBe(8);
  });

  it('does not treat the two cases symmetrically', () => {
    // The bonus scales with the driver, the penalty does not. Worth pinning because a
    // "+/- driveSkill" implementation would look right and be wrong.
    const moving = attackCwn.vehicleAc(12, { moving: true, driveSkill: 6 });
    const stationary = attackCwn.vehicleAc(12, { moving: false, driveSkill: 6 });
    expect(moving).toBe(18);
    expect(stationary).toBe(8);
  });

  it('subtracts Armour Rating from damage rather than avoiding the hit', () => {
    // The distinction this whole subsystem turns on: AC decides whether a hit lands,
    // AR decides how much of a landed hit gets through.
    expect(attackCwn.applyArmorRating(10, 5)).toBe(5);
    expect(attackCwn.applyArmorRating(10, 0)).toBe(10);
  });

  it('lets armour absorb a hit entirely rather than going negative', () => {
    expect(attackCwn.applyArmorRating(3, 5)).toBe(0);
    expect(attackCwn.applyArmorRating(0, 5)).toBe(0);
  });

  it('treats missing or junk values as zero rather than NaN', () => {
    // Sheet fields arrive as strings and are often blank.
    expect(attackCwn.applyArmorRating('10', '5')).toBe(5);
    expect(attackCwn.applyArmorRating(10, '')).toBe(10);
    expect(attackCwn.vehicleAc('12', { moving: true, driveSkill: '3' })).toBe(15);
  });

  it('destroys a vehicle at zero HP, not below it', () => {
    expect(attackCwn.vehicleDestroyed(1)).toBe(false);
    expect(attackCwn.vehicleDestroyed(0)).toBe(true);
    expect(attackCwn.vehicleDestroyed(-3)).toBe(true);
  });

  it('keeps the moving-fire penalty at the value the rules give', () => {
    expect(attackCwn.MOVING_FIRE_PENALTY).toBe(-4);
    expect(attackCwn.VEHICLE_STATIONARY_AC_PENALTY).toBe(-4);
  });
});
