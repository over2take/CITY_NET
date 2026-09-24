/**
 * Where each system keeps weapons and vehicles, on both sides of the wire.
 *
 * The window reads the shape out of the sheet templates; the server holds a copy, because
 * its own templates carry no field ids. The server's copy is what a sale empties, so if the
 * two disagree, selling something leaves part of it on the sheet - which is exactly what the
 * hand-written list this replaced did to CWN vehicles.
 *
 * Compared entry for entry, so a template that grows a field fails here by name.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { slotsOf, rowFields, templateFieldIds } from '../sheetSlots';

const backend = createRequire(import.meta.url)('../../../../backend/shops/sheetSlots.js');

const SYSTEMS = ['cities_without_number', 'cyberpunk_red', 'shadowrun_6e', 'generic'];

describe('the server has the same sheet shapes as the templates', () => {
  for (const system of SYSTEMS) {
    it(`agrees for ${system}`, () => {
      expect(backend.slotsOf(system)).toEqual(slotsOf(system));
    });
  }

  it('knows every system the app does', () => {
    expect(Object.keys(backend.SLOTS).sort()).toEqual([...SYSTEMS].sort());
  });
});

describe('what each sheet actually has', () => {
  it('gives each system the rows its sheet draws', () => {
    expect(slotsOf('cities_without_number').weapon?.rows).toBe(6);
    expect(slotsOf('cities_without_number').vehicle?.rows).toBe(6);
    expect(slotsOf('cyberpunk_red').weapon?.rows).toBe(4);
    expect(slotsOf('cyberpunk_red').vehicle?.rows).toBe(4);
    expect(slotsOf('shadowrun_6e').weapon?.rows).toBe(4);
  });

  it('says plainly when a system has no such row', () => {
    // Not a gap to be filled: these sheets have nowhere typed to put the thing.
    expect(slotsOf('shadowrun_6e').vehicle).toBeUndefined();
    expect(slotsOf('generic')).toEqual({});
  });

  it('gives each system its own weapon fields', () => {
    expect(slotsOf('cyberpunk_red').weapon?.fields).toEqual(['name', 'dmg', 'skill', 'rof']);
    expect(slotsOf('shadowrun_6e').weapon?.fields).toEqual(['name', 'dv', 'ar', 'skill', 'mode', 'atk']);
  });
});

describe('emptying a row', () => {
  it('takes every field the template gives that row', () => {
    // The check that the hand-written list failed: a row is emptied of exactly what the
    // sheet draws in it, so nothing is left behind and nothing imaginary is cleared.
    for (const system of SYSTEMS) {
      const ids = new Set(templateFieldIds(system));
      for (const [group, spec] of Object.entries(slotsOf(system))) {
        for (let n = 1; n <= (spec?.rows ?? 0); n += 1) {
          const declared = [...ids].filter((id) => id.startsWith(`${group}${n}_`)).sort();
          expect(rowFields(system, group as 'weapon', n).sort(), `${system} ${group}${n}`)
            .toEqual(declared);
        }
      }
    }
  });

  it('takes a CWN vehicle\'s mounted guns and fittings with it', () => {
    // Exactly the fields the old hand-written list missed.
    const fields = rowFields('cities_without_number', 'vehicle', 1);
    for (const f of ['vehicle1_weapon1_type', 'vehicle1_weapon1_skill', 'vehicle1_weapon1_atk', 'vehicle1_fittings']) {
      expect(fields, f).toContain(f);
    }
    // And none of the mount columns that never existed.
    for (const f of ['vehicle1_weapon1_range', 'vehicle1_weapon1_mag', 'vehicle1_weapon1_notes']) {
      expect(fields, f).not.toContain(f);
    }
  });

  it('leaves a CP:R weapon without its rof on the server too', () => {
    expect(backend.rowFields('cyberpunk_red', 'weapon', 3)).toEqual(
      ['weapon3_name', 'weapon3_dmg', 'weapon3_skill', 'weapon3_rof'],
    );
  });

  it('clears a vehicle\'s moving flag on the server, which no template declares', () => {
    // Runtime state, set during play, kept apart from the generated table.
    expect(backend.rowFields('cities_without_number', 'vehicle', 2)).toContain('vehicle2_moving');
  });
});
