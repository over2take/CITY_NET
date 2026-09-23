/**
 * Reading a catalogue a GM typed, pasted or uploaded.
 *
 * The cases worth having are the ones where a file does not say what it looks like it says:
 * a comma inside a name, a semicolon separator from a European Excel, a byte-order mark, a
 * price written with a currency symbol. Each of those parses to something plausible and
 * wrong if handled carelessly, which is the worst kind of bug to have in a price list.
 *
 * Nothing here throws. A GM with one bad row wants to know which row and to keep the other
 * forty, so every failure is a reported line number.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const { parseCatalogue, splitRow, delimiterOf, readPrice, slug } =
  createRequire(import.meta.url)('../shops/catalogueParse');

const rows = (out, catalogue) => out.sections[catalogue] || [];
const names = (out, catalogue) => rows(out, catalogue).map((r) => r.name);

describe('the format it was given', () => {
  it('reads the sectioned example the app hands out', () => {
    const out = parseCatalogue([
      '# a comment',
      '',
      '[weapons]',
      'name, price, dmg',
      'Heavy Pistol, 200, 1d8',
      'Rifle, 1000, 2d8',
      '',
      '[gear]',
      'name, price, enc',
      'Climbing kit, 150, 2',
    ].join('\n'));

    expect(out.problems).toEqual([]);
    expect(names(out, 'weapons')).toEqual(['Heavy Pistol', 'Rifle']);
    expect(names(out, 'gear')).toEqual(['Climbing kit']);
  });

  it('reads a table pasted out of a spreadsheet, which arrives tab separated', () => {
    const out = parseCatalogue('[weapons]\nname\tprice\tdmg\nHeavy Pistol\t200\t1d8');
    expect(out.problems).toEqual([]);
    expect(rows(out, 'weapons')[0]).toMatchObject({ name: 'Heavy Pistol', price: 200 });
  });

  it('reads JSON keyed by catalogue', () => {
    const out = parseCatalogue(JSON.stringify({
      weapons: [{ name: 'Rifle', price: 1000, dmg: '2d8' }],
    }));
    expect(out.format).toBe('json');
    expect(rows(out, 'weapons')[0]).toMatchObject({ name: 'Rifle', price: 1000 });
  });

  it('reads a flat JSON list where each row says what it is', () => {
    const out = parseCatalogue(JSON.stringify([
      { catalogue: 'weapons', name: 'Rifle', price: 1000 },
      { catalogue: 'gear', name: 'Rope', price: 20 },
    ]));
    expect(names(out, 'weapons')).toEqual(['Rifle']);
    expect(names(out, 'gear')).toEqual(['Rope']);
  });

  it('says so rather than throwing when the JSON is broken', () => {
    const out = parseCatalogue('{ "weapons": [ {"name": "Rifle",} ] }');
    expect(out.sections).toEqual({});
    expect(out.problems[0].message).toMatch(/not valid JSON/);
  });
});

describe('the things that parse to something plausible and wrong', () => {
  it('keeps a comma inside a quoted name', () => {
    /**
     * Not hypothetical. The CharWN importer carries a note about exports containing
     * "Kit, Cyberdoc". Split naively and every column after it shifts by one, which
     * stores a wrong price rather than failing.
     */
    const out = parseCatalogue('[gear]\nname,price,enc\n"Kit, Cyberdoc",500,2');
    expect(out.problems).toEqual([]);
    expect(rows(out, 'gear')[0]).toMatchObject({ name: 'Kit, Cyberdoc', price: 500 });
    expect(rows(out, 'gear')[0].fields.enc).toBe('2');
  });

  it('reads a doubled quote as one quote', () => {
    const out = parseCatalogue('[gear]\nname,price\n"The ""Special""",10');
    expect(rows(out, 'gear')[0].name).toBe('The "Special"');
  });

  it('reports an unclosed quote instead of eating the rest of the file', () => {
    const out = parseCatalogue([
      '[gear]', 'name,price', '"Broken,10', 'Rope,20',
    ].join('\n'));
    expect(out.problems.some((p) => /never closed/.test(p.message))).toBe(true);
    // The good row after it still came through.
    expect(names(out, 'gear')).toEqual(['Rope']);
  });

  it('takes semicolons from a European Excel', () => {
    // Excel writes the regional list separator, which is a semicolon across much of
    // Europe. A GM there should not have to know that.
    const out = parseCatalogue('[gear]\nname;price;enc\nRope;20;1');
    expect(out.problems).toEqual([]);
    expect(rows(out, 'gear')[0]).toMatchObject({ name: 'Rope', price: 20 });
  });

  it('survives the byte-order mark Excel puts at the front of a file', () => {
    const out = parseCatalogue('﻿[gear]\nname,price\nRope,20');
    expect(out.problems).toEqual([]);
    expect(names(out, 'gear')).toEqual(['Rope']);
  });

  it('reads a price written the way a person writes one', () => {
    expect(readPrice('1,000')).toBe(1000);
    expect(readPrice('$500')).toBe(500);
    expect(readPrice(' 250 ')).toBe(250);
    expect(readPrice('0')).toBe(0);
  });

  it('refuses a price that is not one, rather than reading it as free', () => {
    for (const bad of ['', 'ask the GM', '-5', 'N/A', null, undefined]) {
      expect(readPrice(bad), String(bad)).toBeNull();
    }
  });
});

describe('what it tells a GM about a bad row', () => {
  it('names the line and keeps everything else', () => {
    const out = parseCatalogue([
      '[gear]',
      'name,price',
      'Rope,20',
      'Broken,not a number',
      'Torch,5',
    ].join('\n'));

    expect(names(out, 'gear')).toEqual(['Rope', 'Torch']);
    expect(out.problems).toHaveLength(1);
    expect(out.problems[0]).toMatchObject({ line: 4, catalogue: 'gear', name: 'Broken' });
    expect(out.problems[0].message).toMatch(/not a number/);
  });

  it('refuses a row with no name, since there is nothing to sell', () => {
    const out = parseCatalogue('[gear]\nname,price\n,20');
    expect(rows(out, 'gear')).toEqual([]);
    expect(out.problems[0].message).toMatch(/no name/);
  });

  it('says when a header is missing the columns everything needs', () => {
    const noPrice = parseCatalogue('[gear]\nname,enc\nRope,1');
    expect(noPrice.problems[0].message).toMatch(/no price column/);
    const noName = parseCatalogue('[gear]\nprice,enc\n20,1');
    expect(noName.problems[0].message).toMatch(/no name column/);
  });

  it('says when a row arrives before any section', () => {
    const out = parseCatalogue('name,price\nRope,20');
    expect(out.problems[0].message).toMatch(/before any \[section\]/);
  });

  it('says when there is nothing to read at all', () => {
    for (const empty of ['', '   ', null, undefined]) {
      expect(parseCatalogue(empty).problems[0].message, String(empty)).toMatch(/nothing to read/);
    }
  });

  it('keeps the later of two rows for the same thing, and says it did', () => {
    // A GM editing in a hurry, not a pistol with two prices.
    const out = parseCatalogue([
      '[gear]', 'name,price', 'Rope,20', 'Rope,35',
    ].join('\n'));
    expect(rows(out, 'gear')).toHaveLength(1);
    expect(rows(out, 'gear')[0].price).toBe(35);
    expect(out.problems[0].message).toMatch(/a second "Rope"/);
  });
});

describe('what a row becomes', () => {
  it('fills the sheet from every column that is not name or price', () => {
    const out = parseCatalogue('[weapons]\nname,price,dmg,skill\nRifle,1000,2d8,shoot');
    expect(rows(out, 'weapons')[0].fields).toEqual({ dmg: '2d8', skill: 'shoot' });
  });

  it('drops a blank cell rather than storing an empty one', () => {
    // An empty column must never overwrite something on the sheet.
    const out = parseCatalogue('[weapons]\nname,price,dmg,skill\nRifle,1000,,shoot');
    expect(rows(out, 'weapons')[0].fields).toEqual({ skill: 'shoot' });
  });

  it('gives a row an id from its name, so a GM need not invent one', () => {
    // The name is what the sheet stores anyway, and what a later sale matches on.
    expect(slug('Heavy Pistol')).toBe('heavy_pistol');
    expect(slug('Kit, Cyberdoc')).toBe('kit_cyberdoc');
    expect(slug('  Odd   Name!  ')).toBe('odd_name');
  });

  it('ignores the comments and blank lines the example is full of', () => {
    const out = parseCatalogue([
      '# CITY_NET storefront catalogue',
      '# system: generic',
      '',
      '# ── GEAR ──',
      '# sold by: General Store',
      '[gear]',
      'name, price',
      'Rope, 20',
      '',
    ].join('\n'));
    expect(out.problems).toEqual([]);
    expect(names(out, 'gear')).toEqual(['Rope']);
  });
});

describe('the pieces on their own', () => {
  it('prefers tabs, then whichever of comma and semicolon is commoner', () => {
    expect(delimiterOf('a\tb,c;d')).toBe('\t');
    expect(delimiterOf('a,b,c;d')).toBe(',');
    expect(delimiterOf('a;b;c,d')).toBe(';');
  });

  it('splits a row on the delimiter and not inside quotes', () => {
    expect(splitRow('a,"b,c",d', ',').cells).toEqual(['a', 'b,c', 'd']);
    expect(splitRow('a,b', ',').closed).toBe(true);
    expect(splitRow('a,"b', ',').closed).toBe(false);
  });
});
