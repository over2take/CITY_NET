import { describe, it, expect } from 'vitest';

const pharma = require('../sheets/cwnPharma');
const attackCwn = require('../sheets/attackCwn');
const rolls = require('../sheets/rolls');
const rollEngine = require('../sheets/rollEngine');

/**
 * Every drug against every roll the app makes.
 *
 * Two halves, and the second is the one worth having. The first says each drug does what
 * the book gives it. The second says each drug does NOTHING to the rolls it has no
 * business touching - skill checks, saving throws, stabilization - because Boneshaker and
 * Olympus are "+2 to hit ROLLS" and nothing wider. A bonus that quietly leaked into skill
 * checks would make every character on a combat drug better at picking locks, and no unit
 * test on the arithmetic would notice.
 *
 * EXPECTED is the specification, written out by hand from p60-61 rather than derived from
 * the catalogue - a table generated from the code under test proves only that the code
 * equals itself. A drug added to the catalogue without a row here fails the last block.
 */

const N = { hit: 0, damage: 0, shock: 0, incomingTrauma: 0, grantsHp: 0, majorInjury: 0, strain: 0 };

const EXPECTED = {
  avalanche: { ...N, grantsHp: 10, majorInjury: -1, duration: 'hour' },
  boneshaker: { ...N, hit: 2, damage: 2, shock: 2, incomingTrauma: 2, strain: 2, duration: 'scene' },
  chokeout: { ...N, duration: 'extended' },
  control_delete: { ...N, duration: 'extended' },
  hellbender: { ...N, duration: 'instant' },
  lurch: { ...N, duration: 'instant' },
  madeleine: { ...N, duration: 'hour' },
  medical_prescription: { ...N, duration: 'extended' },
  olympus: { ...N, hit: 2, strain: 1, duration: 'scene' },
  panacea: { ...N, duration: 'instant' },
  pillow: { ...N, duration: 'extended' },
  psycho: { ...N, duration: 'hour' },
  reset: { ...N, duration: 'instant' },
  sand: { ...N, duration: 'hour' },
  trauma_patch: { ...N, duration: 'instant' },
  window: { ...N, duration: 'scene' },
};

const IDS = Object.keys(EXPECTED);
const cases = IDS.map((id) => [id, EXPECTED[id]]);

/** A sheet with something in every field a CWN roll can read. */
const SHEET = {
  base_hit_bonus: 1, level: 3,
  str_mod: 1, dex_mod: 2, con_mod: 0, int_mod: 1, wis_mod: -1, cha_mod: 0,
  shoot: 1, stab: 2, punch: 0, heal: 1, notice: 2, exert: 1, sneak: 0, fix: 1,
  save_physical: 10, save_evasion: 11, save_mental: 12, save_luck: 13,
  trauma_target: 6, system_strain: 2, system_strain_max: 10, hp: 12, hp_max: 20,
  weapon1_name: 'Combat Rifle', weapon1_dmg: '1d12', weapon1_skill: 'shoot',
  weapon1_trauma: 'd10/x3', weapon1_shock: '3/15', weapon1_atk: 1,
};

const on = (id) => ({ ...SHEET, [pharma.FIELD]: [id] });

describe('what each drug gives a weapon', () => {
  it.each(cases)('%s', (id, want) => {
    const w = attackCwn.getWeapon(on(id), 1);
    // weapon1_atk is 1, so the drug is whatever is on top of it.
    expect(w.atk, 'to hit').toBe(1 + want.hit);
    expect(w.dmgBonus, 'damage').toBe(want.damage);
    expect(w.shock.dmg, 'shock').toBe(3 + want.shock);
  });

  it.each(cases)('%s reaches body weaponry the same way', (id, want) => {
    const bladed = {
      ...on(id),
      cyberware: [{ name: 'Body Blades I', type: 'body', placed: true, equipped: true, location: 'arm' }],
    };
    const w = attackCwn.getCyberWeapon(bladed, 1);
    expect(w.atk, 'to hit').toBe(want.hit);
    expect(w.dmgBonus, 'damage').toBe(want.damage);
  });

  it.each(cases)('%s reaches a vehicle mount the same way', (id, want) => {
    const driving = {
      ...on(id),
      vehicle1_hrdpt: 1,
      vehicle1_weapon1_dmg: '2d6', vehicle1_weapon1_skill: 'shoot', vehicle1_weapon1_atk: 0,
    };
    expect(attackCwn.getVehicleWeapon(driving, 1, 1).atk).toBe(want.hit);
  });
});

describe('what each drug does to a Trauma Die rolled against you', () => {
  it.each(cases)('%s', (id, want) => {
    expect(pharma.activeEffects(on(id)).incomingTrauma).toBe(want.incomingTrauma);
  });

  it('and the penalty actually moves the roll', () => {
    const w = attackCwn.getWeapon(SHEET, 1);
    const lowest = () => 0;
    const bare = attackCwn.rollTrauma(w, true, 6, lowest).roll;
    const open = attackCwn.rollTrauma(w, true, 6, lowest, {
      defenderBonus: pharma.activeEffects(on('boneshaker')).incomingTrauma,
    }).roll;
    expect(open).toBe(bare + 2);
  });
});

describe('what each drug costs and how long it lasts', () => {
  it.each(cases)('%s', (id, want) => {
    const drug = pharma.byId(id);
    expect(drug.duration, 'duration').toBe(want.duration);
    expect(Number(drug.strain) || 0, 'strain billed at the end').toBe(want.strain);
    expect(Number(drug.grantsHp) || 0, 'hit points granted').toBe(want.grantsHp);
    expect(Number(drug.majorInjury) || 0, 'Major Injury').toBe(want.majorInjury);
  });

  it.each(cases)('%s bills its Strain only when it is scene-length', (id, want) => {
    // Window lasts a scene and bills per USE, so ending the scene charges nothing for it.
    const billed = want.duration === 'scene' ? want.strain : 0;
    expect(pharma.endScene(on(id)).strain).toBe(billed);
  });
});

/**
 * The half that matters.
 *
 * Every roll CWN makes that is NOT an attack, asserted identical dosed and sober. These
 * resolve through rollEngine off the sheet, so a drug could only reach them by someone
 * wiring it in - which is exactly the mistake this catches.
 */
describe('no drug touches a roll it has no business touching', () => {
  const SKILLS = ['shoot', 'stab', 'punch', 'heal', 'notice', 'exert', 'sneak', 'fix'];
  const SAVES = ['save_physical', 'save_evasion', 'save_mental', 'save_luck'];

  /** The resolved formula, with every @field substituted - the roll minus its dice. */
  const resolve = (data, fieldId) => {
    const def = rolls.getRoll('cities_without_number', fieldId);
    expect(def, `no roll defined for ${fieldId}`).toBeTruthy();
    return JSON.stringify(rollEngine.resolveFormula(def.formula, data));
  };

  it.each(cases)('%s changes no skill check', (id) => {
    for (const skill of SKILLS) {
      expect(resolve(on(id), skill), skill).toBe(resolve(SHEET, skill));
    }
  });

  it.each(cases)('%s changes no saving throw', (id) => {
    for (const save of SAVES) {
      expect(resolve(on(id), save), save).toBe(resolve(SHEET, save));
    }
  });

  it.each(cases)('%s changes no stabilization check', (id) => {
    // An ally's 2d6 + Heal + Int against a rising DC. Nothing in the drug table modifies
    // it - Trauma Patch has its own separate check, which the app does not roll.
    const fixed = () => 0.5;
    const sober = attackCwn.rollStabilize(SHEET, 2, false, fixed);
    const dosed = attackCwn.rollStabilize(on(id), 2, false, fixed);
    expect(dosed.total).toBe(sober.total);
    expect(dosed.dc).toBe(sober.dc);
  });

  it.each(cases)('%s changes no Trauma Target', (id) => {
    // Being drugged does not make you harder to traumatise; Boneshaker makes it easier,
    // and that lands on the ROLL rather than on the target.
    const w = attackCwn.getWeapon(SHEET, 1);
    expect(attackCwn.rollTrauma(w, true, on(id).trauma_target, () => 0).tt).toBe(6);
  });
});

describe('the table and the catalogue agree about what exists', () => {
  it('has a row here for every drug in the book', () => {
    expect(IDS.sort()).toEqual(pharma.PHARMACEUTICALS.map((p) => p.id).sort());
  });

  it('leaves exactly three drugs changing a rolled number', () => {
    const numeric = IDS.filter((id) => {
      const e = EXPECTED[id];
      return e.hit || e.damage || e.shock || e.incomingTrauma || e.grantsHp;
    });
    expect(numeric.sort()).toEqual(['avalanche', 'boneshaker', 'olympus']);
  });

  it('gives a sober character none of it', () => {
    const w = attackCwn.getWeapon(SHEET, 1);
    expect([w.atk, w.dmgBonus, w.shock.dmg]).toEqual([1, 0, 3]);
    expect(pharma.activeEffects(SHEET)).toMatchObject({ hit: 0, damage: 0, shock: 0 });
  });
});
