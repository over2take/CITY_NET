import { describe, it, expect } from 'vitest';

const attackCwn = require('../sheets/attackCwn');
const cyber = require('../sheets/cwnCyberWeapons');

/**
 * Cyberware you attack with (p70).
 *
 * Body Blades were carried as a name and a strain cost with no stats, so a character who
 * had paid for them attacked exactly as if they had not. They are resolved from the
 * installed chrome rather than copied into a weapon row: a row is something a player types
 * and edits, this is a property of the implant, and a second copy is a second thing to
 * fall out of step.
 */

const blades = (name, over = {}) =>
  ({ name, type: 'limb', side: null, placed: true, equipped: true, hl: 1, mods: [], ...over });

const sheet = (rows, fields = {}) => ({ cyberware: rows, stab: 1, punch: 0, str_mod: 1, dex_mod: 0, ...fields });

describe('which implants are weapons', () => {
  it('finds Body Blades', () => {
    expect(cyber.list(sheet([blades('Body Blades I')]))).toHaveLength(1);
    expect(cyber.list(sheet([blades('Body Blades II')]))).toHaveLength(1);
  });

  it('ignores chrome that is not a weapon', () => {
    // Most of the sixty implants. A Cyberlimb is storage, not a blade.
    const rows = [blades('Cyberlimb'), blades('Dermal Armor I'), blades('Omnihand')];
    expect(cyber.list(sheet(rows))).toEqual([]);
  });

  it('ignores a piece that is owned but not fitted', () => {
    // Owning a piece costs nothing; only installing it does, and only an installed blade
    // is one you can swing.
    expect(cyber.list(sheet([blades('Body Blades I', { placed: false })]))).toEqual([]);
    expect(cyber.list(sheet([blades('Body Blades I', { equipped: false })]))).toEqual([]);
  });

  it('matches the name however it was typed', () => {
    expect(cyber.list(sheet([blades('  body blades ii  ')]))).toHaveLength(1);
  });

  it('reads a malformed cyberware field as no weapons', () => {
    for (const value of [undefined, null, 'not an array', 42, {}]) {
      expect(cyber.list({ cyberware: value })).toEqual([]);
    }
  });
});

describe('what a cyber weapon rolls', () => {
  it('gives Body Blades I the stats the book prints', () => {
    const w = attackCwn.getCyberWeapon(sheet([blades('Body Blades I')]), 1);
    expect(w.name).toBe('Body Blades I');
    expect(w.dmg).toBe('1d8');
    expect(w.shock).toEqual({ dmg: 2, ac: 15 });
    // bonus is 0 until a Monoblade is fitted (p71); see cwn_cyber_mods.test.js.
    expect(w.trauma).toEqual({ die: 8, rating: 3, vsVehicles: false, bonus: 0 });
    expect(w.attackType).toBe('melee');
  });

  it('gives Body Blades II its heavier stats', () => {
    const w = attackCwn.getCyberWeapon(sheet([blades('Body Blades II')]), 1);
    expect(w.dmg).toBe('2d6');
    expect(w.shock).toEqual({ dmg: 4, ac: 15 });
    expect(w.trauma).toEqual({ die: 10, rating: 3, vsVehicles: false, bonus: 0 });
  });

  it('rolls with whichever of Stab or Punch is better', () => {
    // The book allows either, and a player would take the better one every time.
    expect(attackCwn.getCyberWeapon(sheet([blades('Body Blades I')], { stab: 3, punch: 0 }), 1).skill).toBe('stab');
    expect(attackCwn.getCyberWeapon(sheet([blades('Body Blades I')], { stab: 0, punch: 3 }), 1).skill).toBe('punch');
    // A tie keeps the order the book prints them in.
    expect(attackCwn.getCyberWeapon(sheet([blades('Body Blades I')], { stab: 2, punch: 2 }), 1).skill).toBe('stab');
  });

  it('takes the better of Str and Dex, as an unarmed attack does', () => {
    const s = (str, dex) => sheet([blades('Body Blades I')], { str_mod: str, dex_mod: dex });
    expect(attackCwn.getCyberWeapon(s(2, 1), 1).mod).toBe('str_mod');
    expect(attackCwn.getCyberWeapon(s(1, 2), 1).mod).toBe('dex_mod');
  });

  it('is marked as chrome rather than a weapon row', () => {
    expect(attackCwn.getCyberWeapon(sheet([blades('Body Blades I')]), 1).cyber).toBe(true);
    expect(attackCwn.getWeapon({ weapon1_dmg: '1d6', weapon1_skill: 'stab' }, 1).cyber).toBeUndefined();
  });

  it('carries no gear mods, because gear mods are for gear', () => {
    // The p59 table modifies a weapon you own. A blade in your arm takes the p71 table.
    const w = attackCwn.getCyberWeapon(sheet([blades('Body Blades I')]), 1);
    expect(w.mods).toEqual([]);
    expect(w.dmgBonus).toBe(0);
    expect(w.atk).toBe(0);
  });
});

describe('naming one', () => {
  it('counts the cyber weapons, not the whole cyberware list', () => {
    // So adding unrelated chrome above a blade does not change which weapon index 1 is.
    const rows = [blades('Cyberlimb'), blades('Body Blades I'), blades('Omnihand'), blades('Body Blades II')];
    const data = sheet(rows);
    expect(attackCwn.getCyberWeapon(data, 1).name).toBe('Body Blades I');
    expect(attackCwn.getCyberWeapon(data, 2).name).toBe('Body Blades II');
  });

  it('refuses an index that names nothing', () => {
    const data = sheet([blades('Body Blades I')]);
    for (const i of [0, 2, -1, 'x', null, undefined, 1.5]) {
      expect(attackCwn.getCyberWeapon(data, i), String(i)).toBeNull();
    }
  });

  it('refuses when the character has none at all', () => {
    expect(attackCwn.getCyberWeapon(sheet([]), 1)).toBeNull();
    expect(attackCwn.getCyberWeapon({}, 1)).toBeNull();
  });
});

describe('it reaches the rolls', () => {
  const rngHalf = () => 0.5;

  it('rolls to hit with the skill and attribute it chose', () => {
    const data = sheet([blades('Body Blades I')], { base_hit_bonus: 2, stab: 3, punch: 0, str_mod: 1, dex_mod: 0 });
    const w = attackCwn.getCyberWeapon(data, 1);
    // bhb 2 + stab 3 + str 1
    expect(attackCwn.rollToHit(data, w, rngHalf).modTotal).toBe(6);
  });

  it('rolls its own damage dice plus the attribute', () => {
    const data = sheet([blades('Body Blades II')], { str_mod: 2, dex_mod: 0 });
    const w = attackCwn.getCyberWeapon(data, 1);
    expect(attackCwn.rollDamage(data, w, rngHalf).modTotal).toBe(2);
  });

  it('deals its Shock on a miss, like any melee weapon', () => {
    const data = sheet([blades('Body Blades II')], { str_mod: 2, dex_mod: 0 });
    const w = attackCwn.getCyberWeapon(data, 1);
    expect(attackCwn.shockDamage(data, w, 15)).toBe(6); // 4 base + 2 attribute
    expect(attackCwn.shockDamage(data, w, 16)).toBe(0); // above the shock AC
  });

  it('rolls a trauma die', () => {
    const data = sheet([blades('Body Blades II')]);
    const w = attackCwn.getCyberWeapon(data, 1);
    const t = attackCwn.rollTrauma(w, true, 6, () => 0.99);
    expect(t.die).toBe(10);
    expect(t.rating).toBe(3);
  });
});
