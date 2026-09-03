import { describe, it, expect } from 'vitest';

const cyberMods = require('../sheets/cwnCyberMods');
const attackCwn = require('../sheets/attackCwn');
const { cwnEffectiveAc } = require('../sheets/templates');

/**
 * Cyberware mods (p71), the third and last of the book's mod tables.
 *
 * Armour and weapon mods modify gear you carry; these modify the chrome itself, and are
 * fitted per implant rather than per character. Applied on read like the other two, so
 * taking one off gives back exactly what it took.
 *
 * Five of the ten change a number. That took three pieces of groundwork to be true: body
 * weaponry had to be a weapon before Monoblade and Targeting Processor had anything to
 * modify, and implant AC had to be a field before Hardened Weave did.
 */

const row = (over = {}) => ({
  name: 'Cyberlimb', type: 'limb', side: null, placed: true, equipped: true,
  hl: 1, conc: 'touch', mods: [], cyberMods: [], ...over,
});

const blade = (over = {}) => row({ name: 'Body Blades II', hl: 2, ...over });
const derm = (ac = 16, over = {}) =>
  row({ name: 'Dermal Armor I', type: 'skin', conc: 'medical', mods: [{ kind: 'note', target: 'Base AC', value: ac }], ...over });

describe('the table itself', () => {
  it('carries all ten the book prints', () => {
    expect(cyberMods.CYBER_MODS).toHaveLength(10);
  });

  it('gives each an id, a label, an effect line and a cost', () => {
    for (const m of cyberMods.CYBER_MODS) {
      expect(m.id, m.label).toMatch(/^[a-z_]+$/);
      expect(m.label.length, m.id).toBeGreaterThan(0);
      expect(m.effect.length, m.id).toBeGreaterThan(0);
      expect(m.skill, m.id).toMatch(/^Fix-\d\/Heal-\d$/);
      // Costs are a percentage of the system, not a price: it costs more to tune up
      // Enhanced Reflexes than a common synthlimb.
      expect(m.cost, m.id).toBeGreaterThan(0);
      expect(m.cost, m.id).toBeLessThanOrEqual(1);
    }
  });

  it('names each once', () => {
    const ids = cyberMods.CYBER_MODS.map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('a mod only works on what it fits', () => {
  it('takes Tailored Interface only on a system costing 2+ Strain', () => {
    // "only functions on cyber that inflicts 2+ points of permanent System Strain"
    expect(cyberMods.strainOf(row({ hl: 2, cyberMods: ['tailored_interface'] }))).toBe(1);
    expect(cyberMods.strainOf(row({ hl: 3, cyberMods: ['tailored_interface'] }))).toBe(2);
    // On a 1-Strain system it does nothing rather than quietly working.
    expect(cyberMods.strainOf(row({ hl: 1, cyberMods: ['tailored_interface'] }))).toBe(1);
  });

  it('never takes strain below zero', () => {
    expect(cyberMods.strainOf(row({ hl: 0, cyberMods: ['tailored_interface'] }))).toBe(0);
  });

  it('takes Monoblade only on a bladed system', () => {
    expect(cyberMods.rowEffects(blade({ cyberMods: ['monoblade'] })).damage).toBe(-2);
    // A Cyberlimb is not a blade.
    expect(cyberMods.rowEffects(row({ cyberMods: ['monoblade'] })).damage).toBe(0);
  });

  it('takes Hardened Weave only on cyber that grants an AC', () => {
    expect(cyberMods.rowEffects(derm(16, { cyberMods: ['hardened_weave'] })).implantAc).toBe(2);
    expect(cyberMods.rowEffects(row({ cyberMods: ['hardened_weave'] })).implantAc).toBe(0);
  });

  it('drops a mod that does not fit rather than applying it', () => {
    const fitted = cyberMods.activeMods(row({ hl: 1, cyberMods: ['tailored_interface', 'quick_detach'] }));
    expect(fitted.map((m) => m.id)).toEqual(['quick_detach']);
  });

  it('ignores an id it does not know', () => {
    expect(cyberMods.activeMods(row({ cyberMods: ['not_a_mod'] }))).toEqual([]);
  });

  it('reads a malformed mods field as none', () => {
    for (const v of [undefined, null, '', 'nonsense', 42, {}]) {
      expect(cyberMods.fittedIds(row({ cyberMods: v }))).toEqual([]);
    }
  });

  it('accepts a JSON string as well as an array', () => {
    expect(cyberMods.fittedIds(row({ cyberMods: '["quick_detach"]' }))).toEqual(['quick_detach']);
  });
});

describe('Monoblade trades damage for a keener edge', () => {
  const armed = (mods) => ({ cyberware: [blade({ cyberMods: mods })], stab: 1, str_mod: 0, dex_mod: 0 });

  it('adds to the trauma roll and takes off damage and Shock', () => {
    const w = attackCwn.getCyberWeapon(armed(['monoblade']), 1);
    expect(w.trauma.bonus).toBe(1);
    expect(w.dmgBonus).toBe(-2);
    expect(w.shock.dmg).toBe(2); // Body Blades II is 4, less 2
  });

  it('raises the roll rather than the die', () => {
    // "The weapon's Trauma Die gets a +1 bonus" - a d10 stays a d10.
    const w = attackCwn.getCyberWeapon(armed(['monoblade']), 1);
    const t = attackCwn.rollTrauma(w, true, 6, () => 0.5);
    expect(t.die).toBe(10);
    expect(t.roll).toBe(6 + 1);
  });

  it('can turn a miss into a traumatic hit at the margin', () => {
    // The whole point of the trade. A roll landing exactly one under the target.
    // A d10 at this rng rolls 6, against a Trauma Target of 7: one short bare, exactly
    // there with the blade. Armor raises a Trauma Target, so this margin is a real one.
    const at = (mods) => attackCwn.rollTrauma(
      attackCwn.getCyberWeapon(armed(mods), 1), true, 7, () => 0.5,
    ).traumatic;
    expect(at([])).toBe(false);
    expect(at(['monoblade'])).toBe(true);
  });

  it('never turns Shock into healing', () => {
    // Body Blades I is Shock 2, and -2 takes it to zero rather than below.
    const data = { cyberware: [row({ name: 'Body Blades I', hl: 1, cyberMods: ['monoblade'] })], stab: 1 };
    expect(attackCwn.getCyberWeapon(data, 1).shock.dmg).toBe(0);
  });

  it('leaves an ordinary weapon alone', () => {
    // Gear takes the p59 table; chrome takes this one. A weapon row has no trauma bonus.
    const w = attackCwn.getWeapon({ weapon1_dmg: '1d6', weapon1_skill: 'stab', weapon1_trauma: 'd8/x3' }, 1);
    const t = attackCwn.rollTrauma(w, true, 6, () => 0.5);
    expect(t.bonus).toBe(0);
    expect(t.roll).toBe(5);
  });
});

describe('Targeting Processor buys accuracy', () => {
  it('adds one to hit with a cyber weapon', () => {
    const data = { cyberware: [blade({ cyberMods: ['targeting_processor'] })], stab: 1 };
    expect(attackCwn.getCyberWeapon(data, 1).atk).toBe(1);
  });

  it('does not stack with itself', () => {
    // "An attack can only ever benefit from one instance of this mod."
    const eff = cyberMods.rowEffects(blade({ cyberMods: ['targeting_processor', 'targeting_processor'] }));
    expect(eff.hit).toBe(1);
  });
});

describe('Hardened Weave improves the AC the chrome grants', () => {
  it('adds two to the implant AC', () => {
    expect(cwnEffectiveAc({ cyberware: [derm(16, { cyberMods: ['hardened_weave'] })], dex: 10 }))
      .toEqual({ ranged: 18, melee: 18 });
  });

  it('still loses to better worn armour', () => {
    // It improves the implant, not the character: 16+2 is still under a Heavy Suit's 20.
    const out = cwnEffectiveAc({
      armor_ac: 20, armor_ac_melee: 19, dex: 10,
      cyberware: [derm(16, { cyberMods: ['hardened_weave'] })],
    });
    expect(out).toEqual({ ranged: 20, melee: 19 });
  });

  it('makes the system Obvious, which is the price', () => {
    expect(cyberMods.concOf(derm(16, { conc: 'medical', cyberMods: ['hardened_weave'] }))).toBe('obvious');
  });
});

describe('Profile Adjustment hides the chrome one step', () => {
  it('steps Sight to Touch and Touch to Medical', () => {
    expect(cyberMods.concOf(row({ conc: 'sight', cyberMods: ['profile_adjustment'] }))).toBe('touch');
    expect(cyberMods.concOf(row({ conc: 'touch', cyberMods: ['profile_adjustment'] }))).toBe('medical');
  });

  it('does nothing to a system already at Medical', () => {
    // "It has no benefit for a system that is already at a Medical grade of concealment."
    expect(cyberMods.concOf(row({ conc: 'medical', cyberMods: ['profile_adjustment'] }))).toBe('medical');
  });

  it('leaves an unrated row as it found it', () => {
    expect(cyberMods.concOf(row({ conc: '', cyberMods: ['profile_adjustment'] }))).toBe('');
  });

  it('steps down from Obvious when Hardened Weave forced it there', () => {
    // Both fitted: the plating goes on, then the profile work takes it back one.
    expect(cyberMods.concOf(derm(16, { conc: 'medical', cyberMods: ['hardened_weave', 'profile_adjustment'] })))
      .toBe('sight');
  });
});

describe('the five that change nothing are carried anyway', () => {
  it('applies no numbers for the narrative mods', () => {
    for (const id of ['biocapacitors', 'durable_system', 'firewalled', 'low_maintenance', 'quick_detach']) {
      const eff = cyberMods.rowEffects(blade({ cyberMods: [id] }));
      expect({ ...eff, installed: undefined }, id).toEqual({
        strain: 0, implantAc: 0, traumaBonus: 0, damage: 0, shock: 0, hit: 0,
        concSteps: 0, setConc: null, installed: undefined,
      });
    }
  });

  it('still reports them as fitted, so the chip shows', () => {
    expect(cyberMods.activeMods(blade({ cyberMods: ['quick_detach'] })).map((m) => m.id))
      .toEqual(['quick_detach']);
  });
});

describe('taking a mod off gives back what it took', () => {
  it('restores strain, AC and the weapon numbers', () => {
    // Applied on read and never written into the row, which is what makes this true.
    expect(cyberMods.strainOf(row({ hl: 2, cyberMods: [] }))).toBe(2);
    expect(cwnEffectiveAc({ cyberware: [derm(16)], dex: 10 })).toEqual({ ranged: 16, melee: 16 });
    const bare = attackCwn.getCyberWeapon({ cyberware: [blade()], stab: 1 }, 1);
    expect([bare.atk, bare.dmgBonus, bare.trauma.bonus, bare.shock.dmg]).toEqual([0, 0, 0, 4]);
  });
});
