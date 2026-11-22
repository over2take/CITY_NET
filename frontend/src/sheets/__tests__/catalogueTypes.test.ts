import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import { exampleFor, currentFor, typeSection, typeColumns, ownTypesOf, catalogueHint } from '../catalogueSchema';
import { itemsCatalogue, landsAsGear, itemsInPreview } from '../catalogueItems';
import { registerCustomTemplate, clearCustomTemplates } from '../customTemplates';
import type { TypeShown } from '../gearTypes';
import type { ItemsShown } from '../gearItems';

// A catalogue section per item type (8a7a1; mockup docs/mockups/item-types-in-shops.html): each download the window
// writes for a system with types of its own goes back into the server's reader (backend shops/catalogueParse.js) unchanged,
// a type's lines with every column; the preview counts an item in a type's section as gear, where it is worn from.

const { parseCatalogue } = createRequire(import.meta.url)('../../../../backend/shops/catalogueParse.js');

const SYS = 'sys_0a1b2c3d4e5f6a7c';
const GUNS: TypeShown = {
  id: 'guns', label: 'GUNS', one: 'Gun', columns: [
    { id: 'damage', label: 'DAMAGE', kind: 'damage' },
    { id: 'range', label: 'RANGE', kind: 'text' },
    { id: 'ammo', label: 'AMMO', kind: 'count', button: 'FIRE' },
    { id: 'weight', label: 'WEIGHT', kind: 'number', unit: 'LB' },
    { id: 'grade', label: 'GRADE', kind: 'pick', options: ['LIGHT', 'HEAVY'] },
  ],
};
const ODD: TypeShown = { id: 'odds', label: 'ODDS & ENDS', one: 'Odd', columns: [{ id: 'weight', label: 'WEIGHT', kind: 'number' }] };
const ITEMS: ItemsShown = {
  slots: [], types: [GUNS, ODD],
  list: [
    { id: 'pistol', label: 'Pistol', description: 'A snub revolver, "Old Faithful".', needs: 'worn', features: [], type: 'guns', values: { damage: '2d6', ammo: 6, weight: 2, grade: 'LIGHT' } },
    { id: 'spoon', label: 'Spoon', needs: 'worn', features: [], type: 'odds', values: { weight: 0.1 } },
  ],
};
/** The server's reader, as the game reads it: its types, every name known. */
const read = (text: string) => parseCatalogue(text, { types: [GUNS, ODD], names: { known: () => true, refused: (n: string) => `@${n}` } });

beforeEach(() => {
  clearCustomTemplates();
  registerCustomTemplate({ id: SYS, name: 'Typed', parts: {}, derived: [], sheet: { sections: [] }, words: {}, items: ITEMS } as never);
});
afterEach(() => clearCustomTemplates());

describe('a type in a file', () => {
  it('its section by its name where that reads back as one, else by its id; its columns after name and price', () => {
    expect(typeSection(GUNS)).toBe('GUNS');
    expect(typeSection(ODD)).toBe('odds');
    expect(typeColumns(GUNS)).toEqual(['name', 'price', 'damage', 'range', 'ammo', 'weight', 'grade', 'description']);
  });

  it('only a custom system\'s own types: none for a built-in game', () => {
    expect(ownTypesOf(SYS).map((t) => t.id)).toEqual(['guns', 'odds']);
    expect(ownTypesOf('cities_without_number')).toEqual([]);
  });
});

describe('DOWNLOAD EXAMPLE', () => {
  it('a section per type, its header, a sample line behind a # in each column\'s shape; straight back in', () => {
    const file = exampleFor(SYS);
    expect(file).toMatch(/^\[GUNS\]$/m);
    expect(file).toMatch(/^\[odds\]$/m);
    expect(file).toMatch(/^name\s*, price, damage, range, ammo, weight, grade, description$/m);
    expect(file).toMatch(/^# Example Gun\s*, 10\s*, 1d6\s*, words, 6\s*, 1\s*, LIGHT, Copy this line$/m);
    const out = read(file);
    expect(out.problems).toEqual([]);
    expect(out.sections['type:guns']).toEqual([]);
    // The sample line, its # taken off, is a line of the type.
    const sample = read(file.replace(/^# (Example Gun.*)$/m, '$1'));
    expect(sample.problems).toEqual([]);
    expect(sample.sections['type:guns'][0]).toMatchObject({ name: 'Example Gun', fields: { damage: '1d6', range: 'words', ammo: 6, weight: 1, grade: 'LIGHT' } });
  });
});

describe('DOWNLOAD CURRENT', () => {
  it('each type\'s lines as saved, every column; back in unchanged', () => {
    const stored = [{ id: 'pistol', name: 'Pistol', price: 250, source: 'uploaded' as const, fields: { damage: '2d6 + @might', range: '30 m', ammo: 6, weight: 2, grade: 'LIGHT', description: 'Snub, "short"' } }];
    const out = read(currentFor(SYS, { 'type:guns': stored }));
    expect(out.problems).toEqual([]);
    expect(out.sections['type:guns']).toEqual([expect.objectContaining({ name: 'Pistol', price: 250, fields: stored[0].fields })]);
  });

  it('the game\'s own items behind a #, on sale by themselves: uploading the file back repeats none of them (8a7a3a)', () => {
    const item = { id: 'item:derringer', name: 'Derringer', price: 90, source: 'items' as const, fields: { damage: '1d4', ammo: 2 } };
    const file = currentFor(SYS, { 'type:guns': [item] });
    expect(file).toMatch(/^# Derringer\s*, 90\s*, 1d4/m);
    expect(read(file).sections['type:guns']).toEqual([]);
  });
});

describe('DOWNLOAD ITEMS', () => {
  it('each item in its type\'s section with its columns, the price left to fill in; priced, back in as the items', () => {
    const file = itemsCatalogue(SYS, ITEMS)!;
    expect(file).toMatch(/^\[GUNS\]$/m);
    const priced = file.replace(/^Pistol\s*,\s*,/m, 'Pistol, 250,').replace(/^Spoon\s*,\s*,/m, 'Spoon, 1,');
    const out = read(priced);
    expect(out.problems).toEqual([]);
    expect(out.sections['type:guns']).toEqual([expect.objectContaining({ name: 'Pistol', price: 250, fields: { damage: '2d6', ammo: 6, weight: 2, grade: 'LIGHT', description: 'A snub revolver, "Old Faithful".' } })]);
    expect(out.sections['type:odds']).toEqual([expect.objectContaining({ name: 'Spoon', fields: { weight: 0.1 } })]);
    // Unpriced, each says so: nothing is sold free by mistake.
    expect(read(file).problems.map((p: { name: string }) => p.name)).toEqual(['Pistol', 'Spoon']);
  });

  it('a system without types of its own: the shelf, as before', () => {
    registerCustomTemplate({ id: SYS, name: 'Plain', parts: {}, derived: [], sheet: { sections: [] }, words: {}, items: { ...ITEMS, types: undefined } } as never);
    expect(itemsCatalogue(SYS, { ...ITEMS, types: undefined })).toMatch(/^\[gear\]$/m);
  });
});

describe('the preview', () => {
  it('an item in a type\'s section is gear, where it is worn from', () => {
    expect(landsAsGear(SYS, 'type:guns')).toBe(true);
    const found = itemsInPreview(SYS, ITEMS, { 'type:guns': [{ name: 'Pistol', line: 3 }] });
    expect(found.matched).toEqual([expect.objectContaining({ name: 'Pistol', lands: true })]);
  });
});

describe('price listed once, and the box\'s hint (8a7a5)', () => {
  const PRICED: TypeShown = { id: 'kit', label: 'KIT', one: 'Kit', columns: [{ id: 'weight', label: 'WEIGHT', kind: 'number' }, { id: 'price', label: 'PRICE', kind: 'number' }] };

  it('a type\'s own price column is the file\'s price, listed once', () => {
    expect(typeColumns(PRICED)).toEqual(['name', 'price', 'weight', 'description']);
  });

  it('the hint: the system\'s first type, its columns and a line, read back without a mistake as a line of that type', () => {
    const hint = catalogueHint(SYS);
    expect(hint).toBe('Paste a table here, or upload a file. DOWNLOAD EXAMPLE gives one in the right shape.\n\n[GUNS]\nname, price, damage, range, ammo, weight, grade\nExample Gun, 10, 1d6, words, 6, 1, LIGHT');
    const back = read(hint.split('\n\n')[1]);
    expect(back.problems).toEqual([]);
    expect(back.sections['type:guns']).toEqual([expect.objectContaining({ name: 'Example Gun', price: 10, fields: { damage: '1d6', range: 'words', ammo: 6, weight: 1, grade: 'LIGHT' } })]);
  });

  it('a first type with a PRICE column of its own: price once in the hint too', () => {
    const KITTED = 'sys_0a1b2c3d4e5f6a7d';
    registerCustomTemplate({ id: KITTED, name: 'Kitted', parts: {}, derived: [], sheet: { sections: [] }, words: {}, items: { slots: [], list: [], types: [PRICED] } } as never);
    expect(catalogueHint(KITTED).split('\n').slice(-2)).toEqual(['name, price, weight', 'Example Kit, 10, 1']);
  });

  it('a built-in game: its first shelf in its own columns, never another game\'s', () => {
    const hint = catalogueHint('cyberpunk_red');
    expect(hint).not.toMatch(/Zip Gun/);
    expect(hint).toMatch(/^Paste a table here[^\n]*\n\n\[[a-z_]+\]\nname, price[^\n]*\nExample, 10$/);
  });
});
