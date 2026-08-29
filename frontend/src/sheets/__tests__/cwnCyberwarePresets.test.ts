/**
 * Pins the CWN cyberware table.
 *
 * The data was transcribed from the book, so the risk is not that the code is wrong but
 * that a number is. These assert the shape of the whole table and spot-check the rows most
 * likely to have been mangled on the way in — the two that are formatted unlike every
 * other row, and the ones carrying modifiers.
 */

import { describe, it, expect } from 'vitest';
import { CWN_CYBERWARE, cyberById, cyberByType, type CwnCyberType } from '../cwnCyberwarePresets';
import { CONC_VALUES, MOD_KINDS } from '../cyberwareRows';
import { CWN_TYPES } from '../cyberwareLocations';

describe('the table as a whole', () => {
  it('has all sixty pieces', () => {
    expect(CWN_CYBERWARE).toHaveLength(60);
  });

  it('splits by type exactly as the book prints them', () => {
    const counts: Record<string, number> = {};
    for (const c of CWN_CYBERWARE) counts[c.type] = (counts[c.type] ?? 0) + 1;
    expect(counts).toEqual({ body: 18, head: 11, skin: 8, limb: 12, nerve: 11 });
  });

  it('files everything under a type the body diagram knows', () => {
    // A piece filed under a type with no panel would be installable nowhere.
    const known = new Set(CWN_TYPES.map((t) => t.id));
    for (const c of CWN_CYBERWARE) expect(known.has(c.type)).toBe(true);
  });

  it('gives every piece a unique id', () => {
    expect(new Set(CWN_CYBERWARE.map((c) => c.id)).size).toBe(CWN_CYBERWARE.length);
  });

  it('rates every piece for concealment', () => {
    for (const c of CWN_CYBERWARE) expect(CONC_VALUES).toContain(c.conc);
  });

  it('prices everything above zero', () => {
    // A free implant would read as a transcription slip, not a bargain.
    for (const c of CWN_CYBERWARE) expect(c.price).toBeGreaterThan(0);
  });

  it('uses only the strain values the book prints', () => {
    const seen = [...new Set(CWN_CYBERWARE.map((c) => c.strain))].sort((a, b) => a - b);
    expect(seen).toEqual([0, 0.25, 0.5, 1, 2, 3, 4]);
  });

  it('keeps fractional strain fractional', () => {
    // Rounding here would quietly overcharge a character a quarter point at a time.
    const fractional = CWN_CYBERWARE.filter((c) => !Number.isInteger(c.strain));
    expect(fractional.length).toBeGreaterThan(10);
  });
});

describe('the rows formatted unlike the others', () => {
  it('reads Skinmod as $250 rather than $250K', () => {
    // The one price with no thousands suffix. Read as 250000 it would be the priciest
    // cosmetic mod in the book by two orders of magnitude.
    expect(cyberById('skinmod')?.price).toBe(250);
  });

  it('reads Full Body Conversion in millions', () => {
    expect(cyberById('full-body-conversion')?.price).toBe(6_000_000);
  });

  it('reads the Medusa Implant strain as a half, not a five', () => {
    // Printed `.5` with no leading zero, the only row that does.
    expect(cyberById('medusa-implant')?.strain).toBe(0.5);
  });
});

describe('the modifiers that were safe to attach', () => {
  it('uses only kinds the row model declares', () => {
    for (const c of CWN_CYBERWARE) {
      for (const m of c.mods ?? []) expect(MOD_KINDS).toContain(m.kind);
    }
  });

  it('reads the attribute augments as floors with a bonus', () => {
    expect(cyberById('coordination-augment-i')?.mods)
      .toEqual([{ kind: 'statFloor', target: 'Dexterity', value: 14, bonus: 2 }]);
    expect(cyberById('muscle-fiber-replacement-i')?.mods)
      .toEqual([{ kind: 'statFloor', target: 'Strength', value: 14, bonus: 2 }]);
  });

  it('gives the flat-set augments no phantom bonus', () => {
    // "Str 18" with no "or +N if higher" clause, so the bonus is zero rather than invented.
    expect(cyberById('muscle-fiber-replacement-ii')?.mods?.[0]).toMatchObject({ value: 18, bonus: 0 });
    expect(cyberById('coordination-augment-ii')?.mods?.[0]).toMatchObject({ value: 18, bonus: 0 });
  });

  it('leaves the pieces needing interpretation unmodified', () => {
    // "Gain Con 12 for cyber purposes" is conditional in a way the sheet cannot express,
    // so it carries no modifier rather than a wrong one.
    expect(cyberById('cybernetic-infrastructure-baseline')?.mods).toBeUndefined();
    expect(cyberById('neural-buffer')?.mods).toBeUndefined();
  });
});

describe('lookups', () => {
  it('finds a piece by id', () => {
    expect(cyberById('cranial-jack')?.name).toBe('Cranial Jack');
  });

  it('is undefined for an id nobody has', () => {
    expect(cyberById('nope')).toBeUndefined();
  });

  it('groups by install type', () => {
    for (const t of ['body', 'head', 'skin', 'limb', 'nerve'] as CwnCyberType[]) {
      const group = cyberByType(t);
      expect(group.length).toBeGreaterThan(0);
      for (const c of group) expect(c.type).toBe(t);
    }
  });
});
