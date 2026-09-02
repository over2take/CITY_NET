import { describe, it, expect } from 'vitest';

import fs from 'fs';
import path from 'path';

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
    expect(w.trauma).toEqual({ die: 8, rating: 3, vsVehicles: false });
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
    expect(attackCwn.parseTrauma('d10/x2')).toEqual({ die: 10, rating: 2, vsVehicles: false });
    expect(attackCwn.parseTrauma('d6/3')).toEqual({ die: 6, rating: 3, vsVehicles: false });
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
  const weapon = { trauma: { die: 8, rating: 3, vsVehicles: false } };

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
    vehicle1_hrdpt: 3, vehicle1_weapon1_name: 'Autocannon', vehicle1_weapon1_dmg: '2d8', vehicle1_weapon1_skill: 'shoot', vehicle1_weapon1_atk: '2',
    vehicle1_weapon2_name: 'Grenade Launcher', vehicle1_weapon2_dmg: '3d6', vehicle1_weapon2_skill: 'shoot',
    vehicle2_hrdpt: 3, vehicle2_weapon1_name: 'Roof Gun', vehicle2_weapon1_dmg: '1d10', vehicle2_weapon1_skill: 'shoot',
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

  it('declares as many vehicles as the sheet does', () => {
    // The sheet template and the resolver each carry a count. If the sheet declares more
    // vehicles than the resolver accepts, those vehicles render with mounts that
    // silently refuse to fire — which reads as a broken weapon, not a bad constant.
    const template = fs.readFileSync(
      path.join(import.meta.dirname, '..', '..', 'frontend', 'src', 'sheets', 'templates', 'cities_without_number.ts'),
      'utf8'
    );
    const rows = /export const CWN_VEHICLE_ROWS = (\d+);/.exec(template);
    const mounts = /export const CWN_VEHICLE_WEAPON_ROWS = (\d+);/.exec(template);
    expect(Number(rows[1])).toBe(attackCwn.VEHICLE_ROWS);
    expect(Number(mounts[1])).toBe(attackCwn.VEHICLE_WEAPON_ROWS);
  });

  it('keeps the moving-fire penalty at the value the rules give', () => {
    expect(attackCwn.MOVING_FIRE_PENALTY).toBe(-4);
    expect(attackCwn.VEHICLE_STATIONARY_AC_PENALTY).toBe(-4);
  });
});

describe('Damage Soak', () => {
  // A pool of temporary hit points the armour spends before the wearer does, refilling at
  // the start of a scene. Not AC, which decides whether a blow lands, and not vehicle
  // Armour Rating, which subtracts from every hit and never runs out.
  it('absorbs the whole hit while it has the points', () => {
    expect(attackCwn.applySoak(2, 5)).toEqual({ absorbed: 2, through: 0, soakLeft: 3 });
  });

  it('takes what it can and lets the rest through', () => {
    expect(attackCwn.applySoak(7, 3)).toEqual({ absorbed: 3, through: 4, soakLeft: 0 });
  });

  it('empties rather than going negative', () => {
    expect(attackCwn.applySoak(5, 5)).toEqual({ absorbed: 5, through: 0, soakLeft: 0 });
  });

  it('does nothing once spent', () => {
    // The second hit of an exchange meets what the first one left.
    expect(attackCwn.applySoak(10, 0)).toEqual({ absorbed: 0, through: 10, soakLeft: 0 });
  });

  it('treats an unset or negative pool as none', () => {
    for (const soak of [undefined, null, '', -3, 'x']) {
      expect(attackCwn.applySoak(4, soak)).toEqual({ absorbed: 0, through: 4, soakLeft: 0 });
    }
  });

  it('never turns a hit into healing', () => {
    expect(attackCwn.applySoak(0, 5)).toEqual({ absorbed: 0, through: 0, soakLeft: 5 });
    expect(attackCwn.applySoak(-2, 5).through).toBe(0);
  });

  it('is not the same thing as vehicle Armour Rating', () => {
    // AR subtracts from every hit for ever; soak is spent. Two hits of 4 against 5 of each:
    // the armour rating stops 4 both times, the soak stops 4 then 1.
    expect(attackCwn.applyArmorRating(4, 5)).toBe(0);
    expect(attackCwn.applyArmorRating(4, 5)).toBe(0);

    const first = attackCwn.applySoak(4, 5);
    expect(first.through).toBe(0);
    const second = attackCwn.applySoak(4, first.soakLeft);
    expect(second.through).toBe(3);
  });
});

/**
 * The weapon's attribute is the weapon's, not the skill's.
 *
 * p54: "Attr is the attribute that modifies the weapon's hit and damage roll. If two
 * attributes are listed, you can use whichever one has the better modifier." The app
 * inferred it from the attack skill, which agrees with the book for most of the table and
 * disagrees exactly where the book bothered to print something different - a Mortar is a
 * Shoot weapon that fires off Wis, and the melee weapons that read Str/Dex can be swung
 * with either.
 */
describe('the weapon attribute column', () => {
  const STATS = { str_mod: 2, dex_mod: 1, wis_mod: -1, shoot: 1, stab: 1, base_hit_bonus: 0 };

  it('falls back to the skill when the weapon names no attribute', () => {
    // Every sheet written before the column existed. Shoot means Dex, Stab means Str,
    // and nothing about those characters may change.
    expect(attackCwn.weaponAttr(STATS, '', 'shoot')).toBe('dex_mod');
    expect(attackCwn.weaponAttr(STATS, '', 'stab')).toBe('str_mod');
    expect(attackCwn.weaponAttr(STATS, undefined, 'punch')).toBe('str_mod');
  });

  it('uses the attribute the weapon names, over the skill', () => {
    // The Mortar: a Shoot weapon that would otherwise roll Dex.
    expect(attackCwn.weaponAttr(STATS, 'wis', 'shoot')).toBe('wis_mod');
    expect(attackCwn.weaponAttr(STATS, 'str', 'shoot')).toBe('str_mod');
    expect(attackCwn.weaponAttr(STATS, 'dex', 'stab')).toBe('dex_mod');
  });

  it('takes the better of a pair, per the sheet it is read against', () => {
    expect(attackCwn.weaponAttr({ str_mod: 2, dex_mod: 1 }, 'str_dex', 'stab')).toBe('str_mod');
    expect(attackCwn.weaponAttr({ str_mod: 1, dex_mod: 2 }, 'str_dex', 'stab')).toBe('dex_mod');
    // A tie keeps the first, which is the order the book prints the pair in.
    expect(attackCwn.weaponAttr({ str_mod: 1, dex_mod: 1 }, 'str_dex', 'stab')).toBe('str_mod');
    // Negatives compare like numbers, not like strings.
    expect(attackCwn.weaponAttr({ str_mod: -2, dex_mod: -1 }, 'str_dex', 'stab')).toBe('dex_mod');
  });

  it('resolves the pair fresh rather than remembering a choice', () => {
    // The reason this is not stored on the weapon: a character who trains Str past their
    // Dex starts swinging their knife with it, without anyone editing the row.
    const knife = { weapon1_dmg: '1d4', weapon1_skill: 'stab', weapon1_attr: 'str_dex' };
    expect(attackCwn.getWeapon({ ...knife, str_mod: 0, dex_mod: 2 }, 1).mod).toBe('dex_mod');
    expect(attackCwn.getWeapon({ ...knife, str_mod: 3, dex_mod: 2 }, 1).mod).toBe('str_mod');
  });

  it('gives a weapon with no attribute at all none', () => {
    // The book's dash: a demo charge and a land mine are not swung or aimed.
    expect(attackCwn.weaponAttr(STATS, 'none', 'shoot')).toBeNull();
    expect(attackCwn.getWeapon({ weapon1_dmg: '3d10', weapon1_skill: 'shoot', weapon1_attr: 'none' }, 1).mod)
      .toBeNull();
  });

  it('ignores a value it does not recognise instead of rolling nothing', () => {
    // A hand-edited sheet or an import with a typo keeps the old behaviour rather than
    // silently dropping the character's attribute out of every roll.
    expect(attackCwn.weaponAttr(STATS, 'charisma', 'shoot')).toBe('dex_mod');
    expect(attackCwn.weaponAttr(STATS, '  ', 'stab')).toBe('str_mod');
  });

  it('reaches the to-hit roll', () => {
    const data = { ...STATS, weapon1_dmg: '3d6', weapon1_skill: 'shoot', weapon1_attr: 'wis' };
    const w = attackCwn.getWeapon(data, 1);
    const roll = attackCwn.rollToHit(data, w, rngOf(0.5));
    // bhb 0 + shoot 1 + wis -1 = 0. Had it used the skill's Dex it would be 2.
    expect(roll.modTotal).toBe(0);
    expect(attackCwn.rollToHit(data, { ...w, mod: 'dex_mod' }, rngOf(0.5)).modTotal).toBe(2);
  });

  it('reaches the damage roll', () => {
    const data = { ...STATS, weapon1_dmg: '1d4', weapon1_skill: 'stab', weapon1_attr: 'dex' };
    const w = attackCwn.getWeapon(data, 1);
    const roll = attackCwn.rollDamage(data, w, rngOf(0.5));
    expect(roll.modTotal).toBe(1); // dex_mod 1, not str_mod 2
  });

  it('reaches shock damage, which the book also modifies by it', () => {
    const data = { ...STATS, weapon1_dmg: '1d4', weapon1_skill: 'stab', weapon1_shock: '2/15', weapon1_attr: 'dex' };
    const w = attackCwn.getWeapon(data, 1);
    expect(attackCwn.shockDamage(data, w, 13)).toBe(3); // 2 + dex 1, not 2 + str 2
  });

  it('adds no term at all for a weapon with no attribute', () => {
    // Rather than adding a zero, so the breakdown does not claim a modifier it has not got.
    const data = { ...STATS, weapon1_dmg: '3d10', weapon1_skill: 'shoot', weapon1_shock: '2/15', weapon1_attr: 'none' };
    const w = attackCwn.getWeapon(data, 1);
    expect(w.mod).toBeNull();
    expect(attackCwn.rollToHit(data, w, rngOf(0.5)).modTotal).toBe(1);  // bhb 0 + shoot 1
    expect(attackCwn.rollDamage(data, w, rngOf(0.5)).modTotal).toBe(0);
    expect(attackCwn.shockDamage(data, w, 13)).toBe(2);
  });

  it('offers exactly the column the book prints', () => {
    expect(Object.keys(attackCwn.WEAPON_ATTRS).sort())
      .toEqual(['dex', 'none', 'str', 'str_dex', 'wis']);
  });
});
