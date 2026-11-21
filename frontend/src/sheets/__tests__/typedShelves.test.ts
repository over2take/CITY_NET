import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import { shelvedIn, catalogueLabel, itemTypeOfShelf, ownItemTypes, type ShopStock } from '../../data/buildingTypes';
import { placeUploaded, destinationOf } from '../shopPlacement';
import { registerCustomTemplate, clearCustomTemplates } from '../customTemplates';
import type { UploadedEntry } from '../uploadedCatalogues';

// A shelf of an item type (8a7a2; mockup docs/mockups/item-types-in-shops.html): sold at the kinds of shop its SOLD AT says
// (the server's, in the render copy), named as the type, and a line bought from it a line of the type with its columns as
// values, held to the server's own placement (backend shops/placement.js), which GIVE uses, on the same sheets.

const server = createRequire(import.meta.url)('../../../../backend/shops/placement.js');

const SYS = 'sys_eeeeeeeeeeeeeeee';
const GUNS = { id: 'guns', label: 'GUNS', one: 'Gun', sold_at: ['gun_shop', 'general_store'], columns: [{ id: 'damage', label: 'DAMAGE', kind: 'damage' }, { id: 'ammo', label: 'AMMO', kind: 'count' }] };
const POTIONS = { id: 'potions', label: 'POTIONS', one: 'Potion', sold_at: [], columns: [{ id: 'heals', label: 'HEALS', kind: 'dice' }] };
const PISTOL = { id: 'pistol', name: 'Pistol', price: 250, fields: { damage: '2d6', ammo: 6, description: 'Snub.' } } as unknown as UploadedEntry;
const COLUMNS = ['damage', 'ammo'];

beforeEach(() => {
  clearCustomTemplates();
  registerCustomTemplate({ id: SYS, name: 'Typed', parts: {}, derived: [], sheet: { sections: [] }, words: {}, items: { slots: [], list: [], types: [GUNS, POTIONS] } } as never);
});
afterEach(() => clearCustomTemplates());

describe('a type\'s shelf', () => {
  it('at each kind of shop it is sold at, after the shop\'s own; at none for a type sold nowhere', () => {
    expect(shelvedIn('gun_shop', SYS)).toEqual(['weapons', 'weapon_mods', 'type:guns']);
    expect(shelvedIn('general_store', SYS)).toEqual(['gear', 'type:guns']);
    expect(shelvedIn('clinic', SYS)).toEqual(['pharmaceuticals']);
    // A built-in game: as ever.
    expect(shelvedIn('gun_shop', 'cities_without_number')).toEqual(['weapons', 'weapon_mods']);
  });

  it('named as the type; which type a shelf is; only a custom system\'s own', () => {
    expect(catalogueLabel('type:guns' as ShopStock, SYS)).toBe('GUNS');
    expect(itemTypeOfShelf(SYS, 'type:guns')?.one).toBe('Gun');
    expect(itemTypeOfShelf(SYS, 'gear')).toBeUndefined();
    expect(itemTypeOfShelf(SYS, 'type:wands')).toBeUndefined();
    expect(ownItemTypes('cities_without_number')).toEqual([]);
  });

  it('says where a line lands: into the gear, as one of the type', () => {
    expect(destinationOf(SYS, 'type:guns' as ShopStock)).toBe('GOES INTO YOUR GEAR AS A GUN');
  });
});

describe('a line bought from it', () => {
  // Each line says it is stowed: one that says nothing is read as in the stash, on both sides.
  const SHEETS: Record<string, Record<string, unknown>> = {
    empty: {},
    'the same one, untouched': { inventory: JSON.stringify([{ name: 'Pistol', qty: 1, carry: 'stowed', type: 'guns', values: { damage: '2d6', ammo: 6 } }]) },
    'one made UNIQUE': { inventory: JSON.stringify([{ name: 'Pistol', qty: 1, carry: 'stowed', type: 'guns', values: { damage: '2d8', ammo: 6 } }]) },
    'one half fired': { inventory: JSON.stringify([{ name: 'Pistol', qty: 1, carry: 'stowed', type: 'guns', values: { damage: '2d6', ammo: 6 }, counts: { ammo: 2 } }]) },
    'one of another type': { inventory: JSON.stringify([{ name: 'Pistol', qty: 1, carry: 'stowed', type: 'rifles', values: { damage: '2d6', ammo: 6 } }]) },
    'one in the stash': { inventory: JSON.stringify([{ name: 'Pistol', qty: 1, type: 'guns', values: { damage: '2d6', ammo: 6 }, carry: 'stash' }]) },
    'junk': { inventory: [null, 'rope', 7] },
  };

  it('a line of the type, its values its columns; stacked only onto the same thing untouched', () => {
    const lines = (data: Record<string, unknown>) => {
      const placed = placeUploaded(SYS, 'type:guns' as ShopStock, PISTOL, data, COLUMNS);
      if (!placed.ok) throw new Error(placed.reason);
      return JSON.parse(String(placed.patch.inventory)) as { name: string; qty: number; type?: string; values?: object }[];
    };
    expect(lines(SHEETS.empty)).toEqual([expect.objectContaining({ name: 'Pistol', qty: 1, carry: 'stowed', type: 'guns', values: { damage: '2d6', ammo: 6 } })]);
    expect(lines(SHEETS['the same one, untouched']).map((l) => l.qty)).toEqual([2]);
    for (const apart of ['one made UNIQUE', 'one half fired', 'one of another type', 'one in the stash']) expect(lines(SHEETS[apart]).map((l) => l.qty), apart).toEqual([1, 1]);
  });

  it('exactly as the server places it, which GIVE uses, on every sheet', () => {
    for (const [name, data] of Object.entries(SHEETS)) {
      const mine = placeUploaded(SYS, 'type:guns' as ShopStock, PISTOL, data, COLUMNS);
      const theirs = server.placeUploaded(SYS, 'type:guns', PISTOL, data, COLUMNS);
      expect(mine.ok, name).toBe(theirs.ok);
      if (mine.ok && theirs.ok) expect(JSON.parse(String(mine.patch.inventory)), name).toEqual(JSON.parse(String(theirs.patch.inventory)));
    }
  });
});
