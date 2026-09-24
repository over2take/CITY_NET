/**
 * The shape of an uploaded storefront catalogue.
 *
 * The point of this module is that **nothing here is written down twice**: the columns come
 * out of each system's own sheet template, so the example a GM downloads is right for the
 * system that is loaded and cannot drift as templates change. Most of what is worth testing
 * is therefore that the derivation really is a derivation - that it tracks the template
 * rather than a list somebody typed - and that the awkward systems degrade honestly.
 */

import { describe, it, expect } from 'vitest';
import { rowGroupsOf, columnsFor, exampleFor, shopsSelling } from '../catalogueSchema';
import { CWN_WEAPON_ROWS } from '../templates/cities_without_number';

describe('reading the row groups out of a template', () => {
  it('finds the groups each system actually has', () => {
    expect(Object.keys(rowGroupsOf('cities_without_number')).sort())
      .toEqual(['spell', 'vehicle', 'weapon']);
    expect(Object.keys(rowGroupsOf('cyberpunk_red')).sort()).toEqual(['vehicle', 'weapon']);
    expect(Object.keys(rowGroupsOf('shadowrun_6e'))).toEqual(['weapon']);
  });

  it('says plainly that generic has none', () => {
    // Not a gap to be filled - the generic sheet has nowhere typed to put a weapon, and
    // the uploader has to say so rather than pretend otherwise.
    expect(rowGroupsOf('generic')).toEqual({});
  });

  it('reads the fields each system gives a weapon, which are not the same', () => {
    expect(rowGroupsOf('cyberpunk_red').weapon.sort()).toEqual(['dmg', 'name', 'rof', 'skill']);
    expect(rowGroupsOf('shadowrun_6e').weapon.sort())
      .toEqual(['ar', 'atk', 'dv', 'mode', 'name', 'skill']);
  });

  it('takes the shape from row one and does not repeat it per row', () => {
    // Six weapon rows, one set of columns.
    expect(CWN_WEAPON_ROWS).toBeGreaterThan(1);
    const suffixes = rowGroupsOf('cities_without_number').weapon;
    expect(new Set(suffixes).size).toBe(suffixes.length);
  });

  it('does not mistake a vehicle mount for a group of its own', () => {
    // `vehicle1_weapon1_dmg` belongs to its vehicle. A catalogue row does not fill it.
    expect(Object.keys(rowGroupsOf('cities_without_number'))).not.toContain('vehicle1_weapon');
  });
});

describe('the columns for a catalogue', () => {
  it('always starts with name and price', () => {
    for (const system of ['cities_without_number', 'cyberpunk_red', 'shadowrun_6e', 'generic']) {
      for (const cat of ['weapons', 'gear', 'cyberware'] as const) {
        expect(columnsFor(system, cat).columns.slice(0, 2), `${system}/${cat}`)
          .toEqual(['name', 'price']);
      }
    }
  });

  it('gives a weapon the fields its own system has', () => {
    expect(columnsFor('cyberpunk_red', 'weapons').columns).toEqual(['name', 'price', 'dmg', 'skill', 'rof']);
    expect(columnsFor('cities_without_number', 'weapons').columns)
      .toEqual(['name', 'price', 'dmg', 'skill', 'attr', 'trauma', 'shock', 'enc']);
  });

  it('leaves out what belongs to the character rather than the shelf', () => {
    /**
     * A shop does not sell an attack bonus, every gun in the case is neither readied nor
     * stowed, and nothing has been modded yet. Offering these would invite a GM to fill in
     * something the purchase overwrites.
     */
    const cols = columnsFor('cities_without_number', 'weapons').columns;
    for (const per of ['atk', 'carry', 'mods']) expect(cols, per).not.toContain(per);
  });

  it('leaves out the vehicle columns that are per instance or duplicates', () => {
    const cols = columnsFor('cities_without_number', 'vehicles').columns;
    // `cost` is the same number as `price` under the sheet's own name for it.
    for (const per of ['cost', 'fittings', 'moving']) expect(cols, per).not.toContain(per);
    expect(cols).toContain('hp_max');
  });

  it('falls back to an inventory line where the system has no such row', () => {
    // A Shadowrun vehicle has nowhere typed to go, but a GM can still sell one.
    const sr6 = columnsFor('shadowrun_6e', 'vehicles');
    expect(sr6.shape).toBe('inventory');
    expect(sr6.columns).toEqual(['name', 'price', 'enc', 'description']);
    expect(sr6.unavailable).toMatch(/no vehicle rows/);
  });

  it('puts everything in the inventory for a system with no rows at all', () => {
    const g = columnsFor('generic', 'weapons');
    expect(g.shape).toBe('inventory');
    expect(g.unavailable).toMatch(/generic/);
  });

  it('gives gear an inventory line without calling it a fallback', () => {
    // Gear has no row group anywhere and never did. That is where it belongs, not a
    // disappointment to be explained.
    const gear = columnsFor('cities_without_number', 'gear');
    expect(gear.shape).toBe('inventory');
    expect(gear.unavailable).toBeUndefined();
  });

  it('gives cyberware its own shape, which is a list rather than slots', () => {
    const cw = columnsFor('cities_without_number', 'cyberware');
    expect(cw.shape).toBe('list');
    expect(cw.columns).toEqual(['name', 'price', 'type', 'strain', 'conc', 'effect']);
  });
});

describe('which shops sell what', () => {
  it('names the storefronts, so a GM can find their section', () => {
    expect(shopsSelling('weapons', 'cities_without_number')).toEqual(['Gun Shop']);
    expect(shopsSelling('armor_mods', 'cities_without_number')).toEqual(['Armorer']);
    expect(shopsSelling('vehicle_fittings', 'cities_without_number')).toEqual(['Garage']);
  });

  it('names them the way this game does', () => {
    expect(shopsSelling('cyberware', 'cities_without_number')).toEqual(['Ripperdoc']);
    expect(shopsSelling('cyberware', 'shadowrun_6e')).toEqual(['Street Doc']);
    expect(shopsSelling('cyberware', 'generic')).toEqual(['Cyber Clinic']);
  });

  it('heads a section with the catalogue this game would call it', () => {
    expect(exampleFor('cities_without_number')).toMatch(/^# OPERATOR GEAR$/m);
    expect(exampleFor('cyberpunk_red')).toMatch(/^# GEAR$/m);
    expect(exampleFor('cyberpunk_red')).not.toMatch(/OPERATOR GEAR/);
  });
});

describe('the example a GM downloads', () => {
  const cwn = exampleFor('cities_without_number');

  it('has a section per catalogue', () => {
    for (const cat of ['cyberware', 'weapons', 'armor', 'gear', 'vehicles']) {
      expect(cwn, cat).toContain(`[${cat}]`);
    }
  });

  it('says which storefront each section is for', () => {
    expect(cwn).toMatch(/# sold by: Ripperdoc/);
    expect(cwn).toMatch(/# sold by: General Store/);
  });

  it('comes with real rows rather than a blank form', () => {
    expect(cwn).toContain('Cranial Jack');
    expect(cwn).toContain('Heavy Pistol');
    expect(cwn).toContain('Climbing kit');
  });

  it('quotes a value containing a comma', () => {
    /**
     * Not a hypothetical. The CharWN importer carries a note about their exports
     * containing "Kit, Cyberdoc" - an unquoted comma in a name silently shifts every
     * column after it.
     */
    expect(cwn).toContain('"Cord, grapnel, grip handholds and wall adhesive"');
  });

  it('heads every section with the columns for that system', () => {
    expect(exampleFor('cyberpunk_red')).toMatch(/\[weapons\]\nname\s*,\s*price\s*,\s*dmg\s*,\s*skill\s*,\s*rof/);
  });

  it('warns in the file itself where a system cannot take a catalogue properly', () => {
    expect(exampleFor('shadowrun_6e')).toMatch(/# note: .*no vehicle rows/);
    expect(exampleFor('generic')).toMatch(/# note: .*no weapon rows/);
  });

  it('can be narrowed to one shop\'s catalogues', () => {
    const justGuns = exampleFor('cities_without_number', ['weapons', 'weapon_mods']);
    expect(justGuns).toContain('[weapons]');
    expect(justGuns).not.toContain('[cyberware]');
  });

  it('says at the top which system it is for, so two downloads cannot be confused', () => {
    expect(cwn).toContain('# system: cities_without_number');
    expect(exampleFor('cyberpunk_red')).toContain('# system: cyberpunk_red');
  });
});
