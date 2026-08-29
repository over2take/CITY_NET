/**
 * Cyberware effects under Cities Without Number.
 *
 * The point of difference from Cyberpunk RED is the derived layer. CWN rolls a skill as
 * `2d6 + skill + the attribute's modifier`, so an implant that raises DEX and stops there
 * would move no Dex roll at all. These check that a raised attribute reaches its modifier,
 * its saves, and the rolls built on them — without any of it being written to the sheet.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const fx = createRequire(import.meta.url)('../sheets/cyberwareEffects');

const CWN = 'cities_without_number';

/** A placed, equipped piece: anything less contributes nothing, by design. */
const piece = (name, mods) => ({ name, type: 'nerve', placed: true, equipped: true, hl: 1, mods });

const sheet = (rows, fields) => ({ cyberware: rows, level: 1, ...fields });

// 3 -> -2, 4-7 -> -1, 8-13 -> 0, 14-17 -> +1, 18+ -> +2
const DEX_9_MOD = 0;
const DEX_14_MOD = 1;

describe('attributes', () => {
  it('raises an attribute that is below the floor', () => {
    const data = sheet([piece('Coordination Augment I',
      [{ kind: 'statFloor', target: 'Dexterity', value: 14, bonus: 2 }])], { dex: 9 });
    expect(fx.effects(data, CWN).fields.dex.value).toBe(14);
  });

  it('pays the bonus when the attribute already clears the floor', () => {
    const data = sheet([piece('Coordination Augment I',
      [{ kind: 'statFloor', target: 'Dexterity', value: 14, bonus: 2 }])], { dex: 16 });
    expect(fx.effects(data, CWN).fields.dex.value).toBe(18);
  });

  it('answers to the book spelling and the sheet spelling alike', () => {
    for (const target of ['Dexterity', 'DEX']) {
      const data = sheet([piece('P', [{ kind: 'stat', target, value: 2 }])], { dex: 10 });
      expect(fx.effects(data, CWN).fields.dex.value).toBe(12);
    }
  });

  it('does not answer to a Cyberpunk RED stat CWN has no field for', () => {
    const data = sheet([piece('P', [{ kind: 'stat', target: 'Reflexes', value: 2 }])], { dex: 10 });
    const out = fx.effects(data, CWN);
    expect(out.fields).toEqual({});
    expect(out.unmatched).toEqual([{ name: 'P', target: 'Reflexes', kind: 'stat' }]);
  });
});

describe('the derived layer', () => {
  it('carries a raised attribute through to its modifier', () => {
    // The whole reason CWN needs a derive step: DEX 9 -> 14 is +0 -> +1, and every Dex
    // skill roll reads the modifier rather than the attribute.
    const data = sheet([piece('Coordination Augment I',
      [{ kind: 'statFloor', target: 'Dexterity', value: 14, bonus: 2 }])], { dex: 9, dex_mod: DEX_9_MOD });
    const eff = fx.effectiveData(data, CWN);
    expect(eff.dex).toBe(14);
    expect(eff.dex_mod).toBe(DEX_14_MOD);
  });

  it('carries it into the saves that hang off it', () => {
    // save_evasion is 16 - (level + best of DEX/INT mod).
    const data = sheet([piece('P', [{ kind: 'stat', target: 'Dexterity', value: 9 }])],
      { dex: 9, int: 8, level: 1 });
    const eff = fx.effectiveData(data, CWN);
    expect(eff.dex).toBe(18);
    expect(eff.save_evasion).toBe(16 - (1 + 2));
  });

  it('reaches a skill roll built on the modifier, not the attribute', () => {
    const data = sheet([piece('Coordination Augment I',
      [{ kind: 'statFloor', target: 'Dexterity', value: 14, bonus: 2 }])],
      { dex: 9, dex_mod: DEX_9_MOD, drive: 1 });
    // A modifier naming DEX moving a roll that names DEX MOD is exactly what the old
    // formula path could not do, since it only knew the fields the modifier named.
    expect(fx.formulaModifiers(data, '2d6 + @drive + @dex_mod', CWN))
      .toEqual([{ label: 'cyberware', value: DEX_14_MOD - DEX_9_MOD }]);
  });

  it('leaves the stored sheet untouched, derived fields included', () => {
    const data = sheet([piece('P', [{ kind: 'stat', target: 'Dexterity', value: 9 }])],
      { dex: 9, dex_mod: DEX_9_MOD, save_evasion: 15 });
    fx.effectiveData(data, CWN);
    expect(data.dex).toBe(9);
    expect(data.dex_mod).toBe(DEX_9_MOD);
    expect(data.save_evasion).toBe(15);
  });
});

describe('skills', () => {
  it('adds to a CWN skill by name', () => {
    const data = sheet([piece('P', [{ kind: 'skill', target: 'Drive', value: 2 }])], { drive: 1 });
    expect(fx.effects(data, CWN).fields.drive.value).toBe(3);
  });

  it('reaches the roll that skill is made with', () => {
    const data = sheet([piece('P', [{ kind: 'skill', target: 'Drive', value: 2 }])],
      { drive: 1, dex: 10, dex_mod: 0 });
    expect(fx.formulaModifiers(data, '2d6 + @drive + @dex_mod', CWN))
      .toEqual([{ label: 'cyberware', value: 2 }]);
  });
});

describe('what does not apply', () => {
  it('gives an unplaced piece no effect at all', () => {
    const data = sheet([{ ...piece('P', [{ kind: 'stat', target: 'Dexterity', value: 4 }]), placed: false }],
      { dex: 10 });
    expect(fx.effects(data, CWN).fields).toEqual({});
  });

  it('gives an unequipped piece no effect at all', () => {
    const data = sheet([{ ...piece('P', [{ kind: 'stat', target: 'Dexterity', value: 4 }]), equipped: false }],
      { dex: 10 });
    expect(fx.effects(data, CWN).fields).toEqual({});
  });

  it('returns nothing for a system with no profile', () => {
    const data = sheet([piece('P', [{ kind: 'stat', target: 'Dexterity', value: 4 }])], { dex: 10 });
    expect(fx.effects(data, 'shadowrun_6e').fields).toEqual({});
    expect(fx.effectiveData(data, 'shadowrun_6e')).toBe(data);
  });
});
