import { describe, it, expect } from 'vitest';

const gearMods = require('../sheets/cwnGearMods');
const attackCwn = require('../sheets/attackCwn');
const { cwnEffectiveAc, applyDerived } = require('../sheets/templates');

/**
 * Armor and weapon mods (p58-59).
 *
 * A third modifier system, parallel to cyberware and separate from it: cyberware modifies
 * the body, these modify the gear. They are applied on read rather than written into the
 * sheet, which is what makes uninstalling one undo it - the same rule the chrome follows,
 * and the opposite of the vehicle fittings next door, which are printed only because they
 * rewrite stored stat-block numbers that could never be restored.
 */

const fit = (...ids) => JSON.stringify(ids);

describe('what a weapon mod does to a weapon', () => {
  const WEAPON = {
    dex_mod: 1, shoot: 1, base_hit_bonus: 0,
    weapon1_dmg: '1d6', weapon1_skill: 'shoot', weapon1_trauma: 'd8/x3',
    weapon1_shock: '2/13', weapon1_atk: 0,
  };
  const withMods = (...ids) => attackCwn.getWeapon({ ...WEAPON, weapon1_mods: fit(...ids) }, 1);

  it('leaves a weapon with no mods exactly as it was', () => {
    const bare = attackCwn.getWeapon(WEAPON, 1);
    expect(bare.atk).toBe(0);
    expect(bare.dmgBonus).toBe(0);
    expect(bare.shock).toEqual({ dmg: 2, ac: 13 });
    expect(bare.trauma).toEqual({ die: 8, rating: 3, vsVehicles: false });
  });

  it('adds a hit bonus to the weapon attack bonus', () => {
    expect(withMods('autotargeting').atk).toBe(1);
    expect(withMods('autotargeting', 'customized_weapon').atk).toBe(2);
  });

  it('adds damage and shock together', () => {
    // Savage Impact is +1 to both; Integral Toxins is +2 to both.
    const w = withMods('savage_impact', 'integral_toxins');
    expect(w.dmgBonus).toBe(3);
    expect(w.shock).toEqual({ dmg: 5, ac: 13 }); // 2 + 3
  });

  it('caps hit and damage at the +3 the book allows', () => {
    // "No combination of mods can improve a weapon's hit or damage bonus by more than +3."
    const w = withMods('autotargeting', 'customized_weapon', 'predictive_guidance');
    expect(w.atk).toBe(3);
    // Damage stacked past the cap comes back at the cap, not at its raw total.
    const heavy = withMods('integral_toxins', 'thermal_charge', 'savage_impact');
    expect(heavy.dmgBonus).toBe(3); // 2 + 2 + 1 = 5, capped
  });

  it('caps each bonus on its own, not their total', () => {
    // +3 hit and +3 damage at once is legal; the cap is per bonus, as the book words it.
    const w = withMods('autotargeting', 'customized_weapon', 'predictive_guidance',
      'integral_toxins', 'thermal_charge');
    expect(w.atk).toBe(3);
    expect(w.dmgBonus).toBe(3);
  });

  it('does not clamp a penalty back up', () => {
    // Stun Rounds' -2 is a cost the player accepted, not a bonus to cap.
    expect(withMods('stun_rounds').dmgBonus).toBe(-2);
  });

  it('stacks on top of the weapon own ATK bonus', () => {
    // A smartlink or a quality weapon is not a mod; the two add.
    const w = attackCwn.getWeapon({ ...WEAPON, weapon1_atk: 2, weapon1_mods: fit('autotargeting') }, 1);
    expect(w.atk).toBe(3);
  });

  it('lets Heavy Sabot bite machines', () => {
    // The book's ! marker, which the trauma die already understood.
    expect(withMods('heavy_sabot').trauma.vsVehicles).toBe(true);
    expect(withMods().trauma.vsVehicles).toBe(false);
  });

  it('takes the trauma die away entirely for Stun Rounds', () => {
    expect(withMods('stun_rounds').trauma).toBeNull();
  });

  it('never turns shock into healing', () => {
    const w = attackCwn.getWeapon(
      { ...WEAPON, weapon1_shock: '1/13', weapon1_mods: fit('stun_rounds') }, 1);
    expect(w.shock.dmg).toBe(1); // stun rounds carry no shock penalty, only damage
  });

  it('ignores an id it does not know', () => {
    // A hand-edited sheet, or one from a later printing. Nothing is guessed at.
    expect(withMods('autotargeting', 'not_a_real_mod').atk).toBe(1);
  });

  it('reaches the damage roll', () => {
    const data = { ...WEAPON, weapon1_mods: fit('savage_impact') };
    const w = attackCwn.getWeapon(data, 1);
    const roll = attackCwn.rollDamage(data, w, () => 0.5);
    expect(roll.modTotal).toBe(2); // dex 1 + savage impact 1
  });

  it('reaches the to-hit roll', () => {
    const data = { ...WEAPON, weapon1_mods: fit('predictive_guidance') };
    const w = attackCwn.getWeapon(data, 1);
    expect(attackCwn.rollToHit(data, w, () => 0.5).modTotal).toBe(3); // shoot 1 + dex 1 + mod 1
  });

  it('reaches shock damage', () => {
    const data = { ...WEAPON, weapon1_mods: fit('thermal_charge') };
    const w = attackCwn.getWeapon(data, 1);
    expect(attackCwn.shockDamage(data, w, 13)).toBe(5); // 2 base + 2 mod + 1 dex
  });
});

describe('what an armor mod does to a suit', () => {
  const ARMOR = { armor_ac: 13, armor_ac_melee: 14, dex: 14 };

  it('leaves an unmodded suit exactly as it was', () => {
    expect(cwnEffectiveAc(ARMOR)).toEqual({ ranged: 14, melee: 15 });
  });

  it('adds Customized to both ACs', () => {
    expect(cwnEffectiveAc({ ...ARMOR, armor_mods: fit('customized_armor') }))
      .toEqual({ ranged: 15, melee: 16 });
  });

  it('takes Discreet Design off both', () => {
    // The one mod in either table that is a straight trade: subtle, at -2.
    expect(cwnEffectiveAc({ ...ARMOR, armor_mods: fit('discreet_design') }))
      .toEqual({ ranged: 12, melee: 13 });
  });

  it('adds soak, five points at a time', () => {
    const soakOf = (...ids) => {
      const d = { con: 10, level: 1, armor_soak: 8, armor_mods: fit(...ids) };
      applyDerived('cities_without_number', d);
      return d.armor_soak_total;
    };
    expect(soakOf()).toBe(8);
    expect(soakOf('absorption_pads')).toBe(13);
    expect(soakOf('absorption_pads', 'trauma_dampers')).toBe(18);
  });

  it('raises the Trauma Target', () => {
    const d = { con: 10, level: 1, armor_trauma_mod: 2, armor_mods: fit('active_response') };
    applyDerived('cities_without_number', d);
    expect(d.trauma_target).toBe(9); // 6 + 2 armor + 1 mod
  });

  it('takes it all back when the mod comes off', () => {
    // The whole reason these are overlaid rather than written into the sheet.
    const base = { con: 10, level: 1, armor_soak: 8, armor_trauma_mod: 0 };
    const modded = { ...base, armor_mods: fit('absorption_pads', 'active_response') };
    applyDerived('cities_without_number', modded);
    expect([modded.armor_soak_total, modded.trauma_target]).toEqual([13, 7]);

    const stripped = { ...modded, armor_mods: fit() };
    applyDerived('cities_without_number', stripped);
    expect([stripped.armor_soak_total, stripped.trauma_target]).toEqual([8, 6]);
  });

  it('has no cap, because the book puts one on weapons only', () => {
    const d = { con: 10, level: 1, armor_soak: 0, armor_mods: fit('absorption_pads', 'trauma_dampers') };
    applyDerived('cities_without_number', d);
    expect(d.armor_soak_total).toBe(10);
  });
});

describe('the tables themselves', () => {
  it('carries every mod the book prints', () => {
    expect(gearMods.ARMOR_MODS).toHaveLength(11);
    expect(gearMods.WEAPON_MODS).toHaveLength(13);
  });

  it('gives every mod an id, a label, a cost and the effect line', () => {
    for (const m of [...gearMods.ARMOR_MODS, ...gearMods.WEAPON_MODS]) {
      expect(m.id, m.label).toMatch(/^[a-z_]+$/);
      expect(m.label.length, m.id).toBeGreaterThan(0);
      expect(m.effect.length, m.id).toBeGreaterThan(0);
      expect(m.skill, m.id).toMatch(/^Fix-\d$/);
      expect(Number.isFinite(m.cost), m.id).toBe(true);
    }
  });

  it('names each mod once across both tables', () => {
    // The two Customizeds are deliberately distinct ids: one goes on armor, one on a
    // weapon, and they are not the same mod.
    const ids = [...gearMods.ARMOR_MODS, ...gearMods.WEAPON_MODS].map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('points a prerequisite at a mod that exists', () => {
    for (const m of gearMods.ARMOR_MODS) {
      if (m.requires) expect(gearMods.ARMOR_BY_ID[m.requires], m.id).toBeDefined();
    }
  });

  it('reads a tag list however it arrives', () => {
    expect(gearMods.parseIds('["autotargeting"]')).toEqual(['autotargeting']);
    expect(gearMods.parseIds(['autotargeting'])).toEqual(['autotargeting']);
    expect(gearMods.parseIds('')).toEqual([]);
    expect(gearMods.parseIds(undefined)).toEqual([]);
    expect(gearMods.parseIds('not json')).toEqual([]);
    expect(gearMods.parseIds('{"a":1}')).toEqual([]);
  });
});
