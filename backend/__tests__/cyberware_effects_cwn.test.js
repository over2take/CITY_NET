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

describe('every attribute and skill CWN offers', () => {
  // Completeness rather than representative cases. A name the picker offers but the index
  // cannot match is a modifier a player can build that silently does nothing, and on the
  // page it is indistinguishable from a piece with no effect. One target per kind would
  // never find it - the same bar the Cyberpunk RED suite is held to.
  const { CWN_SKILLS } = createRequire(import.meta.url)('../sheets/rolls');

  const ATTR_NAMES = Object.values(fx.CWN_STAT_ALIASES).flat();
  const SKILL_LABELS = Object.values(CWN_SKILLS).map(([label]) => label);
  const ATTR_IDS = Object.keys(fx.CWN_STAT_ALIASES);

  it('has lists worth checking', () => {
    // Guards the guard: an empty list would make every case below pass for free.
    expect(ATTR_NAMES.length).toBe(12);   // six attributes, two spellings each
    expect(SKILL_LABELS.length).toBeGreaterThanOrEqual(10);
  });

  it.each(ATTR_NAMES)('%s resolves to an attribute and moves it', (name) => {
    const data = sheet([piece('P', [{ kind: 'stat', target: name, value: 2 }])]);
    const out = fx.effects(data, CWN);
    expect(out.unmatched).toEqual([]);
    expect(Object.values(out.fields).map((f) => f.value)).toEqual([2]);
  });

  it.each(SKILL_LABELS)('%s resolves to a skill and moves it', (label) => {
    const data = sheet([piece('P', [{ kind: 'skill', target: label, value: 3 }])]);
    const out = fx.effects(data, CWN);
    expect(out.unmatched).toEqual([]);
    expect(Object.values(out.fields).map((f) => f.value)).toEqual([3]);
  });

  it('gives every attribute and skill its own field rather than collapsing any together', () => {
    // Two names landing on one field is the failure that hides: the second modifier looks
    // applied and lands somewhere else.
    const names = [...ATTR_IDS, ...SKILL_LABELS];
    const ids = names.map((name) => {
      const data = sheet([piece('P', [{ kind: 'stat', target: name, value: 1 }])]);
      return Object.keys(fx.effects(data, CWN).fields)[0];
    });
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(new Set(names).size);
  });
});

describe('every kind of modifier against every attribute', () => {
  // The cross-product. Each kind has to work on each attribute, and each has to reach the
  // derived modifier that CWN actually rolls with.
  const ATTR_IDS = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

  const KINDS = [
    { kind: 'stat', value: 3, base: 10, expected: 13, why: 'adds' },
    { kind: 'statSet', value: 7, base: 10, expected: 7, why: 'replaces' },
    { kind: 'statFloor', value: 14, bonus: 2, base: 10, expected: 14, why: 'raises to the floor' },
    { kind: 'statFloor', value: 14, bonus: 2, base: 16, expected: 18, why: 'pays the bonus above the floor' },
  ];

  const cases = ATTR_IDS.flatMap((id) => KINDS.map((k) => ({ ...k, id })));

  it.each(cases)('$kind $why on $id', ({ id, kind, value, bonus, base, expected }) => {
    const mod = bonus === undefined ? { kind, target: id, value } : { kind, target: id, value, bonus };
    const data = sheet([piece('P', [mod])], { [id]: base });
    expect(fx.effects(data, CWN).fields[id].value).toBe(expected);
  });

  it.each(cases)('$kind $why on $id reaches its derived modifier', ({ id, kind, value, bonus, base, expected }) => {
    // 3 -> -2, 4-7 -> -1, 8-13 -> 0, 14-17 -> +1, 18+ -> +2
    const cwnMod = (s) => (s <= 0 ? 0 : s <= 3 ? -2 : s <= 7 ? -1 : s <= 13 ? 0 : s <= 17 ? 1 : 2);
    const mod = bonus === undefined ? { kind, target: id, value } : { kind, target: id, value, bonus };
    const data = sheet([piece('P', [mod])], { [id]: base, [id + '_mod']: cwnMod(base) });
    expect(fx.effectiveData(data, CWN)[id + '_mod']).toBe(cwnMod(expected));
  });
});

describe('every kind of modifier against every skill', () => {
  const { CWN_SKILLS } = createRequire(import.meta.url)('../sheets/rolls');
  const SKILL_IDS = Object.keys(CWN_SKILLS);

  // Targeted by printed label rather than field id: that is what the index matches, and
  // what a player picks. Most ids happen to equal their lowercased label, but Cast and
  // Summon do not - which is the whole reason to run every skill rather than a sample.
  const cases = SKILL_IDS.flatMap((id) => [
    { id, label: CWN_SKILLS[id][0], kind: 'skill', value: 2, base: 1, expected: 3, why: 'adds' },
    { id, label: CWN_SKILLS[id][0], kind: 'skillSet', value: 4, base: 1, expected: 4, why: 'replaces' },
  ]);

  it.each(cases)('$kind on $label', ({ id, label, kind, value, base, expected }) => {
    const data = sheet([piece('P', [{ kind, target: label, value }])], { [id]: base });
    expect(fx.effects(data, CWN).fields[id].value).toBe(expected);
  });

  it.each(SKILL_IDS)('a modifier on %s reaches the roll that skill is made with', (id) => {
    const [label, modField] = CWN_SKILLS[id];
    const data = sheet([piece('P', [{ kind: 'skill', target: label, value: 2 }])],
      { [id]: 1, [modField]: 0 });
    expect(fx.formulaModifiers(data, '2d6 + @' + id + ' + @' + modField, CWN))
      .toEqual([{ label: 'cyberware', value: 2 }]);
  });
});

describe('modifiers stacking, as several pieces of chrome do', () => {
  it('adds two pieces together on one attribute', () => {
    const data = sheet([
      piece('A', [{ kind: 'stat', target: 'Dexterity', value: 2 }]),
      piece('B', [{ kind: 'stat', target: 'DEX', value: 3 }]),
    ], { dex: 10 });
    expect(fx.effects(data, CWN).fields.dex.value).toBe(15);
  });

  it('applies a set before the adjustments, whichever order they are listed in', () => {
    const data = sheet([
      piece('Adds', [{ kind: 'stat', target: 'Dexterity', value: 2 }]),
      piece('Sets', [{ kind: 'statSet', target: 'Dexterity', value: 8 }]),
    ], { dex: 16 });
    expect(fx.effects(data, CWN).fields.dex.value).toBe(10);
  });

  it('lets the higher of two sets win, and names both', () => {
    const data = sheet([
      piece('Low', [{ kind: 'statSet', target: 'Dexterity', value: 8 }]),
      piece('High', [{ kind: 'statSet', target: 'Dexterity', value: 12 }]),
    ], { dex: 10 });
    const entry = fx.effects(data, CWN).fields.dex;
    expect(entry.value).toBe(12);
    expect(entry.sources.map((s) => s.name).sort()).toEqual(['High', 'Low']);
  });

  it('does not let two floors bootstrap each other', () => {
    // Both compare against the stored attribute, so a DEX 9 character reaches 14 once and
    // does not then also collect the bonus for already clearing it.
    const mod = { kind: 'statFloor', target: 'Dexterity', value: 14, bonus: 2 };
    const data = sheet([piece('A', [mod]), piece('B', [mod])], { dex: 9 });
    expect(fx.effects(data, CWN).fields.dex.value).toBe(14);
  });

  it('a floor and an adjustment combine, floor first', () => {
    const data = sheet([
      piece('Floor', [{ kind: 'statFloor', target: 'Dexterity', value: 14, bonus: 2 }]),
      piece('Adds', [{ kind: 'stat', target: 'Dexterity', value: 1 }]),
    ], { dex: 9 });
    expect(fx.effects(data, CWN).fields.dex.value).toBe(15);
  });

  it('carries a stacked total through to the derived modifier', () => {
    const data = sheet([
      piece('A', [{ kind: 'stat', target: 'Dexterity', value: 4 }]),
      piece('B', [{ kind: 'stat', target: 'Dexterity', value: 5 }]),
    ], { dex: 9, dex_mod: 0 });
    // 9 + 9 = 18, which is +2 on the table.
    expect(fx.effectiveData(data, CWN).dex_mod).toBe(2);
  });
});

describe('Trauma Target', () => {
  // 6 for any normal creature, raised by the armour's mod and by chrome. The interesting
  // part is the ordering: the recompute owns the base, so a modifier has to land after it.
  const armour = (mods) => ({ name: 'Dermal Armor I', type: 'skin', placed: true, equipped: true, hl: 1, mods });
  const TT = [{ kind: 'stat', target: 'Trauma Target', value: 1 }];

  it('is 6 on a character with no armour and no chrome', () => {
    const data = sheet([], { con: 10 });
    const out = fx.effectiveData(data, CWN);
    // Nothing to overlay, so the sheet's own stored value stands - which the recompute
    // sets on save. Checked directly against the recompute here.
    const templates = createRequire(import.meta.url)('../sheets/templates');
    const copy = { con: 10, level: 1 };
    templates.applyDerived(CWN, copy);
    expect(copy.trauma_target).toBe(6);
    expect(out).toBe(data);
  });

  it('adds the armour mod to the base', () => {
    const templates = createRequire(import.meta.url)('../sheets/templates');
    const copy = { con: 10, level: 1, armor_trauma_mod: 3 };
    templates.applyDerived(CWN, copy);
    expect(copy.trauma_target).toBe(9);
  });

  it('adds chrome on top of the base', () => {
    const data = sheet([armour(TT)], { con: 10 });
    expect(fx.effectiveData(data, CWN).trauma_target).toBe(7);
  });

  it('adds chrome on top of the armour, not instead of it', () => {
    // The ordering that matters: the recompute rewrites the field, so a modifier applied
    // before it would simply be erased.
    const data = sheet([armour(TT)], { con: 10, armor_trauma_mod: 1 });
    expect(fx.effectiveData(data, CWN).trauma_target).toBe(8);
  });

  it('stacks two pieces of chrome', () => {
    const data = sheet([armour(TT), armour([{ kind: 'stat', target: 'Trauma Target', value: 2 }])], { con: 10 });
    expect(fx.effectiveData(data, CWN).trauma_target).toBe(9);
  });

  it('answers to the sheet spelling as well as the book one', () => {
    const data = sheet([armour([{ kind: 'stat', target: 'TRAUMA TGT', value: 1 }])], { con: 10 });
    expect(fx.effects(data, CWN).unmatched).toEqual([]);
    expect(fx.effectiveData(data, CWN).trauma_target).toBe(7);
  });

  it('ignores chrome that is not installed', () => {
    const data = sheet([{ ...armour(TT), placed: false }], { con: 10, armor_trauma_mod: 1 });
    expect(fx.effectiveData(data, CWN)).toBe(data);
  });

  it('never writes any of it to the sheet', () => {
    const data = sheet([armour(TT)], { con: 10, armor_trauma_mod: 1, trauma_target: 7 });
    fx.effectiveData(data, CWN);
    expect(data.trauma_target).toBe(7);
  });
});
