/**
 * The example the app hands out must survive being handed back.
 *
 * The two halves live apart on purpose - only the window has the sheet templates, so it
 * generates; only the server stores, so it parses. Nothing else checks that they agree, and
 * a GM downloading an example, changing one price and uploading it is the single most
 * likely thing anybody will do with this feature. If that round trip does not work, the
 * feature does not work.
 *
 * This caught a real one immediately: the sectioned format opens with `[weapons]`, and the
 * parser sniffed a leading `[` as JSON, so every example the app produced came back as
 * "not valid JSON".
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { exampleFor, columnsFor, currentFor } from '../catalogueSchema';
import { CATALOGUES, type ShopStock } from '../../data/buildingTypes';

const { parseCatalogue } = createRequire(import.meta.url)('../../../../backend/shops/catalogueParse.js');

const SYSTEMS = ['cities_without_number', 'cyberpunk_red', 'shadowrun_6e', 'generic'];

describe('an untouched example goes straight back in', () => {
  for (const system of SYSTEMS) {
    it(`round-trips for ${system}`, () => {
      const out = parseCatalogue(exampleFor(system));
      expect(out.format, 'read as the wrong format').toBe('delimited');
      expect(out.problems, `problems in an example this app wrote for ${system}`).toEqual([]);
    });
  }

  it('brings the demo rows back with their prices intact', () => {
    const out = parseCatalogue(exampleFor('cities_without_number'));
    const gear = out.sections.gear || [];
    const kit = gear.find((r: any) => r.name === 'Climbing kit');
    expect(kit).toBeTruthy();
    expect(kit.price).toBe(150);
    // The quoted description survived its commas.
    expect(kit.fields.description).toBe('Cord, grapnel, grip handholds and wall adhesive');
  });

  it('brings back a section for every catalogue the example offered', () => {
    const out = parseCatalogue(exampleFor('cities_without_number'));
    for (const c of CATALOGUES) {
      expect(Object.keys(out.sections), c.id).toContain(c.id);
    }
  });

  it('keeps the columns each system actually declared', () => {
    // A CP:R weapon has rof and no trauma; a CWN one is the other way round. The parse has
    // to preserve whichever the example wrote.
    const cpr = parseCatalogue(exampleFor('cyberpunk_red'));
    const sr6 = parseCatalogue(exampleFor('shadowrun_6e'));
    const cprWeapon = (cpr.sections.weapons || [])[0];
    if (cprWeapon) {
      expect(Object.keys(cprWeapon.fields).every((f) =>
        columnsFor('cyberpunk_red', 'weapons').columns.includes(f))).toBe(true);
    }
    expect(sr6.problems).toEqual([]);
  });
});

describe('an example a GM has edited', () => {
  const edited = (system: string, change: (line: string) => string) =>
    exampleFor(system).split('\n').map(change).join('\n');

  it('takes a changed price', () => {
    const text = edited('cities_without_number', (l) =>
      (l.startsWith('Climbing kit') ? l.replace('150', '999') : l));
    const out = parseCatalogue(text);
    expect(out.problems).toEqual([]);
    const kit = (out.sections.gear || []).find((r: any) => r.name === 'Climbing kit');
    expect(kit.price).toBe(999);
  });

  it('takes rows added underneath the demos', () => {
    const text = exampleFor('cities_without_number').replace(
      '[gear]', '[gear]',
    ).split('\n').flatMap((l) => (
      l.startsWith('Gas mask') ? [l, 'Rope, 20, 1, Fifty meters'] : [l]
    )).join('\n');
    const out = parseCatalogue(text);
    expect(out.problems).toEqual([]);
    expect((out.sections.gear || []).map((r: any) => r.name)).toContain('Rope');
  });

  it('survives every comment being deleted', () => {
    // A GM who tidies the file should not break it.
    const text = exampleFor('cities_without_number')
      .split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
    const out = parseCatalogue(text);
    expect(out.problems).toEqual([]);
  });

  it('survives the alignment padding being stripped', () => {
    // Anything that has been through a spreadsheet comes back without it.
    const text = exampleFor('cities_without_number')
      .split('\n')
      .map((l) => (l.trim().startsWith('#') || !l.includes(',') ? l : l.replace(/\s*,\s*/g, ',')))
      .join('\n');
    const out = parseCatalogue(text);
    expect(out.problems).toEqual([]);
    expect((out.sections.weapons || []).length).toBeGreaterThan(0);
  });

  it('says which line is wrong when one is', () => {
    const text = edited('cities_without_number', (l) =>
      (l.startsWith('Heavy Pistol') ? l.replace('200', 'ask the GM') : l));
    const out = parseCatalogue(text);
    expect(out.problems).toHaveLength(1);
    expect(out.problems[0]).toMatchObject({ catalogue: 'weapons', name: 'Heavy Pistol' });
    // And everything else still came through.
    expect((out.sections.gear || []).length).toBeGreaterThan(0);
  });
});

describe('a section this system cannot type properly', () => {
  it('still round-trips, as an inventory line', () => {
    // Shadowrun has no vehicle rows. The example says so in a comment and offers
    // name/price/enc/description instead, which must still parse.
    const out = parseCatalogue(exampleFor('shadowrun_6e', ['vehicles'] as ShopStock[]));
    expect(out.problems).toEqual([]);
    expect(Object.keys(out.sections)).toContain('vehicles');
  });
});

describe('downloading what you already have', () => {
  /**
   * The trap this avoids: a file listing every book item would, on re-upload, turn all 216
   * of them into overrides - and the book would stop tracking the app. Book rows are
   * written behind a #, so the file is a complete picture that changes nothing unless a GM
   * deliberately uncomments a line.
   */
  const entries = {
    weapons: [
      { id: 'heavy_pistol', name: 'Heavy Pistol', price: 200, source: 'book' as const },
      { id: 'zip_gun', name: 'Zip Gun', price: 15, fields: { dmg: '1d4' }, source: 'uploaded' as const },
    ],
  };

  it('brings back only what was uploaded, not the book', () => {
    const text = currentFor('cities_without_number', entries, ['weapons']);
    const out = parseCatalogue(text);
    expect(out.problems).toEqual([]);
    expect((out.sections.weapons || []).map((r: any) => r.name)).toEqual(['Zip Gun']);
  });

  it('still shows the book rows, so they can be read and copied', () => {
    const text = currentFor('cities_without_number', entries, ['weapons']);
    expect(text).toMatch(/#\s+Heavy Pistol\s*,\s*200/);
  });

  it('overrides a book row the moment its # is removed', () => {
    // The deliberate act. Uncomment, change the price, upload.
    const text = currentFor('cities_without_number', entries, ['weapons'])
      .split('\n')
      .map((l) => (/^#\s+Heavy Pistol/.test(l) ? l.replace(/^#\s+/, '').replace('200', '250') : l))
      .join('\n');
    const out = parseCatalogue(text);
    expect(out.problems).toEqual([]);
    const hit = (out.sections.weapons || []).find((r: any) => r.name === 'Heavy Pistol');
    expect(hit.price).toBe(250);
  });

  it('round-trips an uploaded row with its sheet fields intact', () => {
    const out = parseCatalogue(currentFor('cities_without_number', entries, ['weapons']));
    const zip = (out.sections.weapons || []).find((r: any) => r.name === 'Zip Gun');
    expect(zip).toMatchObject({ price: 15 });
    expect(zip.fields.dmg).toBe('1d4');
  });

  it('says in the file itself what the # rows mean', () => {
    const text = currentFor('cities_without_number', entries, ['weapons']);
    expect(text).toMatch(/came with the app/);
    expect(text).toMatch(/delete its # and edit it/);
  });

  it('is empty of live rows for a system with nothing uploaded', () => {
    const out = parseCatalogue(currentFor('cyberpunk_red', {}, ['weapons']));
    expect(out.problems).toEqual([]);
    expect(out.sections.weapons || []).toEqual([]);
  });
});
