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

describe('modifiers taken from the descriptions, not just the effect column', () => {
  it('gives the Aesthetic Augmentation Suite its Charisma floor', () => {
    // The column says only "Cha bonus"; the description says a Charisma score of 14, or
    // +2 if already 14 or greater. Reading only the column left this doing nothing.
    expect(cyberById('aesthetic-augmentation-suite')?.mods)
      .toEqual([{ kind: 'statFloor', target: 'Charisma', value: 14, bonus: 2 }]);
  });

  it('notes what the sheet has no field for rather than aiming a stat modifier at it', () => {
    // Base AC and Trauma Target are not stats or skills, so a stat modifier naming one
    // would sit in the unmatched list doing nothing at all.
    const mods = cyberById('dermal-armor-i')!.mods!;
    expect(mods.every((m) => m.kind === 'note')).toBe(true);
    expect(mods.map((m) => m.target)).toEqual(['Base AC', 'Trauma Target']);
  });

  it('notes a conditional bonus rather than applying it flat', () => {
    // "+2 to Heal checks made on you" is not "+2 Heal". Applying it would be a wrong
    // number quietly beating no number.
    const mods = cyberById('medical-support-readout')!.mods!;
    expect(mods).toEqual([{ kind: 'note', target: 'Heal checks on you', value: 2 }]);
  });

  it('carries both halves of an augment that does two things', () => {
    const mods = cyberById('coordination-augment-ii')!.mods!;
    expect(mods[0]).toMatchObject({ kind: 'statFloor', target: 'Dexterity', value: 18 });
    expect(mods[1]).toEqual({ kind: 'note', target: 'Move (metres)', value: 10 });
  });

  it('only ever names a stat the sheet actually has', async () => {
    // Every applied modifier has to resolve, or it is a chip that looks mechanical and is
    // not. Checked against the real server index rather than a list of names.
    const backend = await import('../../../../backend/sheets/cyberwareEffects.js');
    for (const item of CWN_CYBERWARE) {
      for (const m of item.mods ?? []) {
        if (m.kind === 'note' || m.kind === 'roll') continue;
        // Named so a failure says which piece, not just "expected null to be truthy".
        const resolved = backend.default.fieldFor(m.target, 'cities_without_number');
        expect(`${item.id} → ${m.target} → ${resolved}`)
          .toBe(`${item.id} → ${m.target} → ${resolved ?? 'UNMATCHED'}`);
        expect(resolved).toBeTruthy();
      }
    }
  });
});
