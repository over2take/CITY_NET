/**
 * The CWN work must not reach the other systems, server side.
 *
 * The effects engine and the row model are shared - one engine with a profile per system
 * rather than four copies - which is the right shape and also exactly how bleed happens.
 * These assert the boundary from the side that resolves rolls and writes sheets, so a
 * future widening has to be deliberate.
 *
 * The client half of this lives in
 * frontend/src/components/__tests__/systemIsolation.test.tsx.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const req = createRequire(import.meta.url);
const fx = req('../sheets/cyberwareEffects');
const templates = req('../sheets/templates');

const piece = (mods) => ({ name: 'P', type: 'neural', placed: true, equipped: true, hl: 1, mods });
const sheet = (target) => ({ cool: 5, con: 10, cyberware: [piece([{ kind: 'stat', target, value: 2 }])] });

const CPR = 'cyberpunk_red';
const CWN = 'cities_without_number';

describe('a system only answers to its own vocabulary', () => {
  it('leaves CWN attributes unmatched under Cyberpunk RED', () => {
    for (const target of ['Constitution', 'Wisdom', 'Charisma']) {
      const out = fx.effects(sheet(target), CPR);
      expect(out.fields).toEqual({});
      expect(out.unmatched.map((u) => u.target)).toEqual([target]);
    }
  });

  it('leaves Cyberpunk RED stats unmatched under CWN', () => {
    for (const target of ['Reflexes', 'Technique', 'Empathy', 'Luck']) {
      const out = fx.effects(sheet(target), CWN);
      expect(out.fields).toEqual({});
      expect(out.unmatched.map((u) => u.target)).toEqual([target]);
    }
  });

  it('leaves Trauma Target unmatched under Cyberpunk RED', () => {
    // Reachable on CWN through the profile's extra fields, and nowhere else - CP:R has no
    // such stat, so it must fail loudly rather than land on a field that means something
    // different.
    const out = fx.effects(sheet('Trauma Target'), CPR);
    expect(out.fields).toEqual({});
    expect(out.unmatched.map((u) => u.target)).toEqual(['Trauma Target']);
  });
});

describe('a system with no profile gets nothing', () => {
  it.each(['shadowrun_6e', 'generic', 'not_a_system', ''])('%s', (system) => {
    const data = sheet('Cool');
    const out = fx.effects(data, system);
    expect(out.fields).toEqual({});
    // Not even reported as unmatched: there is no index to have failed against.
    expect(out.unmatched).toEqual([]);
    expect(fx.effectiveData(data, system)).toBe(data);
    expect(fx.formulaModifiers(data, '1d10 + @cool', system)).toEqual([]);
  });
});

describe('the CWN recompute runs for CWN alone', () => {
  it.each([CPR, 'shadowrun_6e', 'generic'])('writes no CWN derived field on %s', (system) => {
    // Every CWN-shaped input at once. A recompute leaking into another system would put
    // fields on a sheet that system has never heard of.
    const data = { con: 10, strain_mod: -2, armor_trauma_mod: 3, level: 1, dex: 14 };
    templates.applyDerived(system, data);
    for (const id of ['trauma_target', 'system_strain_max', 'dex_mod', 'save_evasion']) {
      expect(data[id]).toBeUndefined();
    }
  });

  it('still writes them for CWN', () => {
    // Guards the guard: a typo above would let the test pass for free.
    const data = { con: 10, strain_mod: -2, armor_trauma_mod: 3, level: 1, dex: 14 };
    templates.applyDerived(CWN, data);
    expect(data.trauma_target).toBe(9);
    expect(data.system_strain_max).toBe(8);
    expect(data.dex_mod).toBe(1);
  });
});

describe('Cyberpunk RED still behaves as it did', () => {
  it('applies a stat modifier and reaches the roll', () => {
    const data = { cool: 5, cyberware: [piece([{ kind: 'stat', target: 'Cool', value: 3 }])] };
    expect(fx.effects(data, CPR).fields.cool.value).toBe(8);
    expect(fx.formulaModifiers(data, '1d10 + @cool', CPR))
      .toEqual([{ label: 'cyberware', value: 3 }]);
  });

  it('gains no derived fields from the overlay', () => {
    // CWN's effectiveData reruns a recompute over the overlaid copy. CP:R has no such
    // layer, and the copy must carry nothing the sheet did not already have.
    const data = { cool: 5, cyberware: [piece([{ kind: 'stat', target: 'Cool', value: 3 }])] };
    const eff = fx.effectiveData(data, CPR);
    expect(Object.keys(eff).sort()).toEqual(Object.keys(data).sort());
    expect(eff.cool).toBe(8);
  });
});

describe('gear mods reach Cities Without Number alone', () => {
  const { applyDerived, cwnEffectiveAc } = require('../sheets/templates');
  const FITTED = JSON.stringify(['absorption_pads', 'active_response', 'customized_armor']);

  it('changes nothing on a sheet of another system', () => {
    // A sheet carrying an armor_mods value on any other system - pasted in, imported,
    // switched over - must come back untouched. Only the CWN recompute reads the field,
    // and only CWN has a recompute that could.
    for (const system of ['cyberpunk_red', 'shadowrun_6e', 'generic']) {
      const data = { armor_mods: FITTED, armor_soak: 8, armor_ac: 13 };
      const before = JSON.stringify(data);
      applyDerived(system, data);
      expect(data.armor_soak_total, system).toBeUndefined();
      expect(data.trauma_target, system).toBeUndefined();
      // Nothing else moved either, beyond that system's own derived fields.
      expect(JSON.parse(before).armor_mods).toBe(data.armor_mods);
    }
  });

  it('changes the numbers on a CWN sheet', () => {
    // Guards the guard: if the ids above were wrong, the test would pass for free.
    const data = { armor_mods: FITTED, armor_soak: 8, armor_trauma_mod: 0, con: 10, level: 1 };
    applyDerived('cities_without_number', data);
    expect(data.armor_soak_total).toBe(13);
    expect(data.trauma_target).toBe(7);
  });

  it('leaves the AC of a system that has no armor mods alone', () => {
    // cwnEffectiveAc is only ever called under a CWN guard, but the mods it now reads are
    // CWN's vocabulary and must not be reachable through any other path.
    expect(cwnEffectiveAc({ armor_ac: 13, armor_mods: FITTED }).ranged).toBe(14);
    expect(cwnEffectiveAc({ armor_ac: 13 }).ranged).toBe(13);
  });

  it('leaves the weapons of another system unchanged', () => {
    // Weapon mods are read inside attackCwn. Shadowrun has its own resolver with its own
    // weapon shape, and a mods field on one of its rows has to be inert rather than
    // quietly handing a Predator a +1 it never bought.
    const sr6 = require('../sheets/attackSr6');
    const base = {
      weapon1_name: 'Predator', weapon1_dv: '3P', weapon1_ar: 10,
      weapon1_skill: 'firearms', weapon1_atk: 0,
    };
    const fitted = { ...base, weapon1_mods: JSON.stringify(['autotargeting', 'predictive_guidance']) };
    expect(sr6.getWeapon(fitted, 1)).toEqual(sr6.getWeapon(base, 1));
  });

  it('reads them on a CWN weapon, which is the same guard the other way up', () => {
    const attackCwn = require('../sheets/attackCwn');
    const base = { weapon1_dmg: '1d6', weapon1_skill: 'shoot', weapon1_atk: 0, dex_mod: 0 };
    const fitted = { ...base, weapon1_mods: JSON.stringify(['autotargeting']) };
    expect(attackCwn.getWeapon(base, 1).atk).toBe(0);
    expect(attackCwn.getWeapon(fitted, 1).atk).toBe(1);
  });
});
