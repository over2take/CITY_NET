import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

/**
 * The system builder's engine, held to the hand-written code it would one day replace.
 *
 * CWN's and Shadowrun's derived values are written out as data (systemBuilder/definitions.js)
 * and worked out by the engine, then compared with cwnRecompute and sr6Recompute - the
 * functions every sheet actually uses - over thousands of generated sheets. Blank fields,
 * text where a number belongs, decimals, negatives, huge values, broken JSON, stale derived
 * values: every sheet must come out identical, with the same list of changed fields in the
 * same order. This is the proof the engine can carry a real system before any is moved onto
 * it; until then the app does not call it at all.
 */

const require_ = createRequire(import.meta.url);
const { TEMPLATES } = require_('../sheets/templates');
const { ARMOR_MODS } = require_('../sheets/cwnGearMods');
const { compileSystem } = require_('../systemBuilder/derived');
const { CITIES_WITHOUT_NUMBER, SHADOWRUN_6E } = require_('../systemBuilder/definitions');

const SHEETS = 3000;

/** A small seeded generator, so a failure names a sheet that can be made again. */
const mulberry32 = (seed) => () => {
  let t = (seed += 0x6d2b79f5);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const makeGen = (seed) => {
  const r = mulberry32(seed);
  const int = (lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
  const pick = (list) => list[Math.floor(r() * list.length)];
  const chance = (p) => r() < p;
  /** A value as a sheet might really hold one - usually a sensible number, sometimes not. */
  const value = (lo, hi) => {
    if (chance(0.65)) return int(lo, hi);
    return pick([
      undefined, null, '', '  ', 'abc', true, false, 0, -1, -0.5, 2.5, 13.999,
      String(int(lo, hi)), ` ${int(lo, hi)} `, '1e2', 1e9, -1e9, Infinity, NaN, [], [7], {},
    ]);
  };
  return { r, int, pick, chance, value };
};

const cwnSheet = (g) => {
  const sheet = {};
  for (const s of ['str', 'dex', 'con', 'int', 'wis', 'cha']) sheet[s] = g.value(1, 20);
  for (const [f, lo, hi] of [
    ['level', 0, 12], ['strain_mod', -2, 2], ['armor_trauma_mod', 0, 3], ['armor_soak', 0, 20],
    ['move_mod', -5, 5], ['cast_skill', 0, 4], ['summon_skill', 0, 4],
  ]) {
    if (g.chance(0.85)) sheet[f] = g.value(lo, hi);
  }
  if (g.chance(0.5)) {
    const ids = Array.from({ length: g.int(0, 4) }, () => g.pick(ARMOR_MODS).id);
    sheet.armor_mods = g.pick([JSON.stringify(ids), ids, ids.join(','), '{broken', null]);
  }
  if (g.chance(0.5)) {
    sheet.cyberware = Array.from({ length: g.int(0, 3) }, () => {
      const mods = Array.from({ length: g.int(0, 3) }, () => ({
        target: g.pick(['Move (meters)', 'Move (metres)', 'move', 'base AC', 'Base AC', 'strain', '']),
        value: g.value(0, 12),
      }));
      return {
        name: 'Implant',
        equipped: g.chance(0.8),
        placed: g.chance(0.8),
        mods: g.chance(0.3) ? JSON.stringify(mods) : mods,
      };
    });
    if (g.chance(0.1)) sheet.cyberware.push(null, 'junk');
  }
  return sheet;
};

const sr6Sheet = (g) => {
  const sheet = {};
  for (const f of ['body', 'willpower', 'reaction', 'intuition', 'charisma', 'magic']) {
    if (g.chance(0.9)) sheet[f] = g.value(1, 9);
  }
  if (g.chance(0.6)) {
    const powers = Array.from({ length: g.int(0, 5) }, () => ({
      name: 'Power',
      cost: g.pick([0.25, 0.5, 1, 1.5, '0.25', 'x', null, 0.1, 0.2]),
    }));
    sheet.adept_powers = g.pick([JSON.stringify(powers), '{broken', '', '"text"', '{}']);
  }
  return sheet;
};

/**
 * Derived fields as a sheet would carry them before a write: missing, already right, stale,
 * or the right number stored as text. `truth` is the sheet as the real code leaves it.
 */
const withStoredDerived = (g, sheet, ids, truth) => {
  for (const id of ids) {
    const roll = g.r();
    if (roll < 0.25) continue;
    if (roll < 0.5) sheet[id] = truth[id];
    else if (roll < 0.7) sheet[id] = String(truth[id]);
    else sheet[id] = g.value(-5, 25);
  }
  return sheet;
};

const clone = (x) => structuredClone(x);

const holdsTo = (name, definition, recompute, makeSheet, seed) => {
  describe(`${name}: the engine against the hand-written function`, () => {
    const compiled = compileSystem(definition);

    it('compiles', () => {
      expect(compiled.problems).toBeUndefined();
      expect(compiled.ok).toBe(true);
    });

    it(`gives the same sheet and the same changed fields on ${SHEETS} generated sheets`, () => {
      const g = makeGen(seed);
      const { ids } = compiled.system;
      for (let n = 0; n < SHEETS; n += 1) {
        const base = makeSheet(g);
        const truth = clone(base);
        recompute(truth);
        const sheet = withStoredDerived(g, base, ids, truth);

        const expected = clone(sheet);
        const expectedChanged = recompute(expected);
        const actual = clone(sheet);
        const actualChanged = compiled.system.apply(actual);

        const where = `sheet ${n} (seed ${seed}): ${JSON.stringify(sheet)}`;
        expect(actualChanged, where).toEqual(expectedChanged);
        expect(actual, where).toEqual(expected);
      }
    });

    it('agrees on a sheet with nothing filled in at all', () => {
      const expected = {};
      const actual = {};
      expect(compiled.system.apply(actual)).toEqual(recompute(expected));
      expect(actual).toEqual(expected);
    });
  });
};

holdsTo('Cities Without Number', CITIES_WITHOUT_NUMBER,
  TEMPLATES.cities_without_number.recompute, cwnSheet, 20260929);
holdsTo('Shadowrun 6E', SHADOWRUN_6E,
  TEMPLATES.shadowrun_6e.recompute, sr6Sheet, 6);

describe('a few CWN characters, by hand', () => {
  const { system } = compileSystem(CITIES_WITHOUT_NUMBER);

  it('works out a level 3 street samurai', () => {
    const v = system.evaluate({ str: 16, dex: 14, con: 12, int: 9, wis: 7, cha: 10, level: 3 });
    expect(v).toMatchObject({
      str_mod: 1, dex_mod: 1, con_mod: 0, int_mod: 0, wis_mod: -1, cha_mod: 0,
      save_physical: 12, save_evasion: 12, save_mental: 13, save_luck: 13,
      system_strain_max: 12, trauma_target: 6, move: 10, spells_prepared_max: 2,
    });
  });

  it('counts Coordination Augment II toward Move, and a heavy suit toward Trauma Target', () => {
    const v = system.evaluate({
      armor_trauma_mod: 3,
      armor_mods: JSON.stringify(['active_response']),
      cyberware: [{ equipped: true, placed: true, mods: [{ target: 'Move (meters)', value: 10 }] }],
    });
    expect(v.move).toBe(20);
    expect(v.trauma_target).toBe(10);
  });
});
