import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { exampleItemsFile, itemsListFile, itemsFileName, withImportedItems, itemPartText, itemIdsOf, MAX_BYTES , itemsHint } from '../itemsImport';
import type { Definition } from '../systemsApi';

/**
 * The ITEMS tab's IMPORT as logic (8aL3b; approved mockup docs/mockups/items-layout.html, 2026-11-14, section 5): the
 * example made from the system (the user's call), the list as it is, read back by the server's own reader
 * (backend systemBuilder/itemsImport.js): the example without a mistake, the list unchanged.
 */

const require_ = createRequire(import.meta.url);
const { readItemsFile } = require_('../../../../backend/systemBuilder/itemsImport.js');
const { MAX_BYTES: SERVER_MAX } = require_('../../../../backend/systemBuilder/choicesImport.js');
const { checkDefinition } = require_('../../../../backend/systemBuilder/definition.js');

const TESTFALL = {
  format: 1, name: 'Testfall',
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }, { id: 'strain', label: 'Strain' }] }],
  derived: [{ id: 'might_mod', label: 'Might mod', formula: 'floor((@might - 10) / 2)' }],
  items: {
    slots: [{ id: 'attuned', label: 'ATTUNED', count: 3 }],
    installs: [{ id: 'cyberware', label: 'CYBERWARE', against: 'strain', limit: '@might' }],
    types: [
      { id: 'gear', label: 'GEAR', one: 'Gear', columns: [{ id: 'weight', label: 'WEIGHT', kind: 'number', unit: 'LB' }, { id: 'price', label: 'PRICE', kind: 'number' }] },
      { id: 'weapons', label: 'WEAPONS', one: 'Weapon', columns: [
        { id: 'damage', label: 'DAMAGE', kind: 'damage' }, { id: 'heals', label: 'HEALS', kind: 'dice' }, { id: 'range', label: 'RANGE', kind: 'text' },
        { id: 'ammo', label: 'AMMO', kind: 'count', button: 'FIRE' }, { id: 'grade', label: 'GRADE', kind: 'pick', options: ['LIGHT', 'HEAVY'] }] },
      { id: 'empty', label: 'EMPTY', columns: [] },
    ],
    list: [
      { id: 'pistol', label: 'Pistol', type: 'weapons', values: { damage: '2d6 + @might_mod', range: '30 m, more or less', ammo: 6, grade: 'LIGHT' }, description: 'A snub revolver; loud.' },
      { id: 'rounds', label: 'Pistol Rounds', type: 'gear', values: { weight: 0.05, price: 1 } },
      { id: 'jack', label: 'Cranial Jack', type: 'gear', needs: 'cyberware', cost: 0.25 },
      { id: 'boots', label: 'Boots of Quiet', needs: 'carried', features: [{ id: 'quiet', label: 'Quiet Step', text: 'Hush, now.', uses: { count: '1', refill: 'long_rest' } }] },
      { id: 'ring', label: 'Ring of Might', needs: 'attuned', features: [{ id: 'mighty', label: 'Mighty', modifiers: [{ target: 'might', amount: '2' }] }] },
    ],
  },
} as unknown as Definition;
const PLAIN = { format: 1, name: 'Marshford', stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'str', label: 'Str' }] }], items: { list: [{ id: 'rope', label: 'Rope', values: { weight: 10 } }] } } as unknown as Definition;

describe('DOWNLOAD EXAMPLE: made from the system it comes from', () => {
  it('a section per type with its own columns; needs in its words; cost because it has an install; read back without a mistake', () => {
    const file = exampleItemsFile(TESTFALL);
    // In shops (8a7a3b2): the first sold, the second kept out; a type without a PRICE column has its own price column.
    expect(file).toContain('\n[gear]\nname, weight, price, in shops, needs, cost, words\nSample Gear, 2, 25, yes, worn, , What the table reads about it.\nSample Gear 2, 1, 5, no, attuned, , \n');
    expect(file).toContain('\n[weapons]\nname, damage, heals, range, ammo, grade, price, in shops, needs, cost, words\nSample Weapon, 1d8 + @might_mod, 2d4 + 2, 30 m, 6, LIGHT, 25, yes, worn, , What the table reads about it.\nSample Weapon 2, 1d6, 1d4, melee, 1, HEAVY, , no, attuned, , \n');
    expect(file).toContain('\n[empty]\nname, price, in shops, needs, cost, words\n');
    expect(file).toContain('# price is what it costs in the shops, a number (a type with a PRICE column of its own has it there). in shops is yes or no:');
    expect(file).toContain('[features]\nitem, feature, words, uses, refill\nSample Gear, A feature, "What it does, in words.", 1, Short rest');
    expect(file).toContain('# needs is when its features count: worn, carried, attuned (a slot), cyberware (an install).');
    expect(file).toContain('# PICK ONE is one of its words: WEAPONS GRADE: LIGHT, HEAVY.');
    const read = readItemsFile(TESTFALL, file);
    expect(read.skipped).toEqual([]);
    expect(read.added.items.map((i: { item: string }) => i.item)).toEqual(['Sample Gear', 'Sample Gear 2', 'Sample Weapon', 'Sample Weapon 2', 'Sample EMPTY', 'Sample EMPTY 2']);
    expect(checkDefinition(withImportedItems(TESTFALL, read.items)).problems).toEqual([]);
  });

  it('a system with GEAR alone and no slots or installs: [gear], worn or carried, no cost column', () => {
    const file = exampleItemsFile(PLAIN);
    expect(file).toContain('\n[gear]\nname, weight, price, needs, words\nSample Gear, 2, 25, worn, What the table reads about it.\nSample Gear 2, 1, 5, carried, \n');
    expect(file).not.toContain('cost');
    expect(file).toContain('# needs is when its features count: worn, carried.');
    expect(file).toContain('1d8 + @str');
    expect(readItemsFile(PLAIN, file).skipped).toEqual([]);
  });

  it('an install and no slot: the second row installed, at a cost of 1', () => {
    const wired = { ...TESTFALL, items: { ...(TESTFALL.items as object), slots: [] } } as unknown as Definition;
    expect(exampleItemsFile(wired)).toContain('Sample Gear 2, 1, 5, no, cyberware, 1, \n');
    expect(readItemsFile(wired, exampleItemsFile(wired)).skipped).toEqual([]);
  });
});

describe('DOWNLOAD THIS LIST: the items as they are, back unchanged', () => {
  it('each type\'s items under its own columns, features below, notes for what a file never carries', () => {
    const file = itemsListFile(TESTFALL);
    expect(file).toContain('\n[weapons]\nname, damage, heals, range, ammo, grade, price, in shops, needs, cost, words\nPistol, 2d6 + @might_mod, , "30 m, more or less", 6, LIGHT, , , worn, , "A snub revolver; loud."\n');
    expect(file).toContain('\n[gear]\nname, weight, price, in shops, needs, cost, words\nPistol Rounds, 0.05, 1, , worn, , \nCranial Jack, , , , cyberware, 0.25, \nBoots of Quiet, , , , carried, , \nRing of Might, , , , attuned, , \n');
    // A type with no items has no section.
    expect(file).not.toContain('[empty]');
    expect(file).toContain('Boots of Quiet, Quiet Step, "Hush, now.", 1, Long rest');
    expect(file).toContain('# Ring of Might · Mighty also has modifiers, set in the builder');
    const read = readItemsFile(TESTFALL, file);
    expect(read).toMatchObject({ changes: 0, skipped: [] });
    expect(read.items).toEqual(TESTFALL.items);
  });

  it('a name starting with #, a slot named apart from its id: written so they read back unchanged', () => {
    const odd = { ...TESTFALL, items: { ...(TESTFALL.items as object), slots: [{ id: 'attuned', label: 'Bonded', count: 1 }],
      list: [{ id: 'pick', label: '#1 Pick', type: 'gear', needs: 'attuned' }] } } as unknown as Definition;
    const file = itemsListFile(odd);
    expect(file).toContain('"#1 Pick", , , , bonded, , ');
    const read = readItemsFile(odd, file);
    expect(read).toMatchObject({ changes: 0, skipped: [] });
    expect(read.items).toEqual(odd.items);
  });

  it('a system making no types: one [gear] section, back unchanged', () => {
    const file = itemsListFile(PLAIN);
    expect(file).toContain('[gear]\nname, weight, price, needs, words\nRope, 10, , worn, \n');
    expect(readItemsFile(PLAIN, file)).toMatchObject({ changes: 0, skipped: [] });
  });

  it('a column or type named like another, or like what every item has, goes by its id', () => {
    const odd = { ...PLAIN, items: { types: [{ id: 'a', label: 'KIT', columns: [{ id: 'w1', label: 'WEIGHT', kind: 'number' }, { id: 'w2', label: 'WEIGHT', kind: 'number' }, { id: 'n', label: 'NAME', kind: 'text' }] }, { id: 'b', label: 'KIT', columns: [] }],
      list: [{ id: 'x', label: 'X', type: 'a', values: { w1: 1, w2: 2, n: 'n' } }, { id: 'y', label: 'Y', type: 'b' }] } } as unknown as Definition;
    const file = itemsListFile(odd);
    expect(file).toContain('[a]\nname, w1, w2, n, price, in shops, needs, words');
    expect(file).toContain('[b]\nname, price, in shops, needs, words');
  });
});

describe('PRICE and IN SHOPS (8a7a3b2)', () => {
  const SHOPPED = { ...TESTFALL, items: { ...(TESTFALL.items as object), list: [
    { id: 'pistol', label: 'Pistol', type: 'weapons', values: { damage: '2d6', ammo: 6 }, price: 200, in_shops: true },
    { id: 'rounds', label: 'Pistol Rounds', type: 'gear', values: { weight: 0.05, price: 1 }, in_shops: true },
    { id: 'ring', label: 'Ring of Might', type: 'gear', price: 5000, in_shops: false },
    { id: 'rope', label: 'Rope', type: 'gear' },
  ] } } as unknown as Definition;

  it('written as each item has them: its own price where its type has no PRICE column; IN SHOPS only where it says; back unchanged', () => {
    const file = itemsListFile(SHOPPED);
    expect(file).toContain('\nPistol, 2d6, , , 6, , 200, yes, worn, , \n');
    expect(file).toContain('\nPistol Rounds, 0.05, 1, yes, worn, , \nRing of Might, , , no, worn, , \nRope, , , , worn, , \n');
    const read = readItemsFile(SHOPPED, file);
    expect(read).toMatchObject({ changes: 0, skipped: [] });
    expect(read.items).toEqual(SHOPPED.items);
    expect(checkDefinition(withImportedItems(SHOPPED, read.items)).problems).toEqual([]);
  });

  it('a column named PRICE under another id holds the price too: no own price column beside it', () => {
    const named = { ...PLAIN, items: { types: [{ id: 'kit', label: 'KIT', columns: [{ id: 'cost', label: 'PRICE', kind: 'number' }] }], list: [{ id: 'x', label: 'X', type: 'kit', values: { cost: 4 } }] } } as unknown as Definition;
    expect(itemsListFile(named)).toContain('[kit]\nname, price, in shops, needs, words\nX, 4, , worn, \n');
  });

  it('a game without types of its own: neither column, as before', () => {
    expect(itemsListFile(PLAIN)).not.toContain('in shops');
    expect(exampleItemsFile(PLAIN)).not.toContain('in shops');
  });
});

describe('the import box\'s hint (8a7a5)', () => {
  it('the system\'s first type headed by the columns its file has, and the features; read back without a mistake', () => {
    const hint = itemsHint(TESTFALL);
    expect(hint).toBe('Paste a table here, or upload a file. DOWNLOAD EXAMPLE gives one in the right shape.\n\n[gear]\nname, weight, price, in shops, needs, cost, words\n\n[features]\nitem, feature, words, uses, refill');
    // Its table, below the words: read back without a mistake.
    expect(readItemsFile(TESTFALL, hint.slice(hint.indexOf('\n\n') + 2)).skipped).toEqual([]);
    expect(itemsHint(PLAIN)).toContain('[gear]\nname, weight, price, needs, words\n');
  });
});

describe('the rest', () => {
  it('file names; the limit as the server\'s; a preview put in place; each change in words; the ids', () => {
    expect(itemsFileName(TESTFALL, 'example')).toBe('testfall-items-example.csv');
    expect(itemsFileName(TESTFALL, 'list')).toBe('testfall-items.csv');
    expect(MAX_BYTES).toBe(SERVER_MAX);
    expect(withImportedItems(TESTFALL, { list: [] }).items).toEqual({ list: [] });
    expect(withImportedItems(TESTFALL, {})).not.toHaveProperty('items');
    expect(itemPartText(TESTFALL, { part: 'needs', from: 'worn', to: 'attuned' })).toBe('NEEDS WORN → ATTUNED');
    expect(itemPartText(TESTFALL, { part: 'needs', from: 'cyberware', to: '' })).toBe('NEEDS CYBERWARE → nothing');
    expect(itemPartText(TESTFALL, { part: 'words', from: '', to: 'x'.repeat(70) })).toBe(`WORDS nothing → "${'x'.repeat(59)}…"`);
    expect(itemPartText(TESTFALL, { part: 'refill', from: 'long_rest', to: 'short_rest' })).toBe('REFILL LONG REST → SHORT REST');
    expect(itemPartText(TESTFALL, { part: 'damage', from: '2d6', to: '3d6' })).toBe('DAMAGE 2d6 → 3d6');
    expect(itemIdsOf(TESTFALL.items as Record<string, unknown>)).toEqual(['pistol', 'rounds', 'jack', 'boots', 'quiet', 'ring', 'mighty']);
    expect(itemIdsOf(undefined)).toEqual([]);
  });
});
