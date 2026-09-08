import { describe, it, expect } from 'vitest';

const pharma = require('../sheets/cwnPharma');
const gearMods = require('../sheets/cwnGearMods');
const attackCwn = require('../sheets/attackCwn');

/**
 * Pharmaceuticals (p60-61) as the resolver sees them.
 *
 * The catalogue and the stacking rule are tested against the frontend mirror in
 * frontend/src/sheets/__tests__/cwnPharma.test.ts. What is tested HERE is the wiring: that
 * a drug a character is on actually reaches the weapon they are holding and the trauma die
 * rolled against them. A bonus that computes correctly and never reaches an attack is the
 * failure mode this file exists to catch - the same one the cyberware mods had.
 */

const dosed = (...ids) => ({ [pharma.FIELD]: ids });

const WEAPON = {
  dex_mod: 1, shoot: 1, base_hit_bonus: 0,
  weapon1_dmg: '1d6', weapon1_skill: 'shoot', weapon1_trauma: 'd8/x3',
  weapon1_shock: '2/13', weapon1_atk: 0,
};

describe('a drug reaches the weapon', () => {
  it('leaves a sober character exactly as they were', () => {
    const w = attackCwn.getWeapon(WEAPON, 1);
    expect(w.atk).toBe(0);
    expect(w.dmgBonus).toBe(0);
    expect(w.shock.dmg).toBe(2);
  });

  it('puts Boneshaker on hit, damage AND Shock', () => {
    // p60 names all three, and p54 already established Shock is modified alongside them.
    const w = attackCwn.getWeapon({ ...WEAPON, ...dosed('boneshaker') }, 1);
    expect(w.atk).toBe(2);
    expect(w.dmgBonus).toBe(2);
    expect(w.shock.dmg).toBe(4);
  });

  it('puts Olympus on hit only', () => {
    const w = attackCwn.getWeapon({ ...WEAPON, ...dosed('olympus') }, 1);
    expect(w.atk).toBe(2);
    expect(w.dmgBonus).toBe(0);
    expect(w.shock.dmg).toBe(2);
  });

  it('gives nothing for a drug that changes no number we roll', () => {
    // Psycho's +2 is Morale, which this app never rolls for a character. It is a running
    // state with no arithmetic, and claiming otherwise would be inventing a rule.
    const w = attackCwn.getWeapon({ ...WEAPON, ...dosed('psycho', 'sand', 'madeleine') }, 1);
    expect(w.atk).toBe(0);
    expect(w.dmgBonus).toBe(0);
  });

  it('does not stack two drugs onto the same roll', () => {
    const w = attackCwn.getWeapon({ ...WEAPON, ...dosed('boneshaker', 'olympus') }, 1);
    expect(w.atk).toBe(2);
  });

  it('follows the character to a vehicle mount', () => {
    // The chemical is in the person, not the gun, so it applies to whatever they fire.
    const data = {
      ...WEAPON, ...dosed('boneshaker'),
      vehicle1_hrdpt: 1,
      vehicle1_weapon1_dmg: '2d6', vehicle1_weapon1_skill: 'shoot',
      vehicle1_weapon1_atk: 0,
    };
    expect(attackCwn.getVehicleWeapon(data, 1, 1).atk).toBe(2);
  });
});

describe('drugs and gear mods are separate ceilings', () => {
  // p59 caps MODS at +3: "no combination of mods can improve a weapon's hit or damage
  // bonus by more than +3". Boneshaker is not a mod, so it is not part of that
  // combination - it rides on top and follows the shooter to their next gun.
  const maxed = JSON.stringify(['autotargeting', 'customized_weapon', 'predictive_guidance']);

  it('caps the mods at +3 on their own', () => {
    const w = attackCwn.getWeapon({ ...WEAPON, weapon1_mods: maxed }, 1);
    expect(w.atk).toBe(gearMods.WEAPON_BONUS_CAP);
  });

  it('adds the drug on top of a maxed-out weapon', () => {
    const w = attackCwn.getWeapon({ ...WEAPON, weapon1_mods: maxed, ...dosed('boneshaker') }, 1);
    expect(w.atk).toBe(gearMods.WEAPON_BONUS_CAP + 2);
  });
});

describe('the trauma die rolled against a drugged defender', () => {
  const weapon = attackCwn.getWeapon(WEAPON, 1);
  // A die that always shows its lowest face, so the bonus is the only thing moving.
  const lowest = () => 0;

  it('rolls bare when the defender is on nothing', () => {
    const t = attackCwn.rollTrauma(weapon, true, 6, lowest);
    expect(t.roll).toBe(1);
    expect(t.defenderBonus).toBe(0);
  });

  it('adds Boneshaker to the roll, because it is the defender who is wide open', () => {
    // "All attacks against them add +2 to any Trauma Die rolls" (p60). The bonus belongs
    // to the person being shot, so it is passed in rather than read off the weapon.
    const t = attackCwn.rollTrauma(weapon, true, 6, lowest, { defenderBonus: 2 });
    expect(t.roll).toBe(3);
    expect(t.defenderBonus).toBe(2);
  });

  it('can turn a miss into a traumatic hit', () => {
    // The whole point of the penalty: a d8 showing 5 against TT 6 is nothing, and the
    // same roll on Boneshaker is a multiplied hit.
    const five = () => 4 / 8;
    expect(attackCwn.rollTrauma(weapon, true, 6, five).traumatic).toBe(false);
    expect(attackCwn.rollTrauma(weapon, true, 6, five, { defenderBonus: 2 }).traumatic).toBe(true);
  });

  it('reads the penalty off the defender sheet the socket hands it', () => {
    expect(pharma.activeEffects(dosed('boneshaker')).incomingTrauma).toBe(2);
    expect(pharma.activeEffects(dosed('olympus')).incomingTrauma).toBe(0);
  });
});

describe('what ending a scene costs', () => {
  it('bills Boneshaker and Olympus together', () => {
    expect(pharma.endScene(dosed('boneshaker', 'olympus'))).toEqual({
      remaining: [], ended: ['boneshaker', 'olympus'], strain: 3,
    });
  });

  it('leaves an hour-long dose running', () => {
    expect(pharma.endScene(dosed('avalanche', 'boneshaker'))).toEqual({
      remaining: ['avalanche'], ended: ['boneshaker'], strain: 2,
    });
  });
});

describe('the shelf', () => {
  it('stocks the whole table, cheapest first', () => {
    const stock = pharma.shopStock();
    expect(stock).toHaveLength(16);
    expect(stock[0].id).toBe('sand');
    expect(stock[stock.length - 1].id).toBe('reset');
    // Sorting must not disturb the catalogue, which is printed in the book's order.
    expect(pharma.PHARMACEUTICALS[0].id).toBe('avalanche');
  });
});
