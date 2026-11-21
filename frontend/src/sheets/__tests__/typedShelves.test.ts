import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createRequire } from 'module';
import { shelvedIn, catalogueLabel, itemTypeOfShelf, ownItemTypes, typeNamedLike, type ShopStock } from '../../data/buildingTypes';
import { placeUploaded, destinationOf } from '../shopPlacement';
import { registerCustomTemplate, clearCustomTemplates } from '../customTemplates';
import { loadUploaded, loadBuyback, clearUploaded, type UploadedEntry } from '../uploadedCatalogues';
import { ownedItems, sellableAt } from '../ownedItems';

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
afterEach(() => { clearCustomTemplates(); clearUploaded(); });

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

  it('a shelf a type is named like: off while nothing is on it, as a [gear] section fills the type; on while lines sit there', () => {
    const NAMED = 'sys_ffffffffffffffff';
    registerCustomTemplate({ id: NAMED, name: 'Named', parts: {}, derived: [], sheet: { sections: [] }, words: {}, buildings: { catalogues: { cyberware: { name: 'Relics' } } }, items: { slots: [], list: [], types: [
      { id: 'gear', label: 'GEAR', one: 'Gear', sold_at: ['general_store'], columns: [] },
      { id: 'holy', label: 'RELICS', one: 'Relic', sold_at: [], columns: [] },
      { id: 'blades', label: 'WEAPONS', one: 'Blade', sold_at: ['gun_shop'], columns: [] },
    ] } } as never);
    expect(typeNamedLike(NAMED, 'gear' as ShopStock)?.id).toBe('gear');
    // By the shelf's name here, not only its id.
    expect(typeNamedLike(NAMED, 'weapons' as ShopStock)?.id).toBe('blades');
    expect(typeNamedLike(NAMED, 'weapon_mods' as ShopStock)).toBeUndefined();
    // A shelf the GM renamed: by that name.
    expect(typeNamedLike(NAMED, 'cyberware' as ShopStock)?.id).toBe('holy');
    expect(shelvedIn('ripperdoc', NAMED)).toEqual([]);
    expect(shelvedIn('general_store', NAMED)).toEqual(['type:gear']);
    expect(shelvedIn('gun_shop', NAMED)).toEqual(['weapon_mods', 'type:blades']);
    expect(shelvedIn('general_store', NAMED, (c) => c === 'gear')).toEqual(['gear', 'type:gear']);
    // A game with no types of its own: every shelf, as ever.
    expect(shelvedIn('general_store', 'cyberpunk_red')).toEqual(['gear']);
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

describe('sold back from the window (8a7a3c2)', () => {
  // A line of the type, bought from its shelf or one of the game's items; and the game's ring kept out of the shops.
  const sheet = { inventory: JSON.stringify([
    { name: 'Pistol', qty: 1, carry: 'stowed', type: 'guns', values: { damage: '2d6', ammo: 6 } },
    { name: 'Ring of Might', qty: 1, carry: 'stowed', type: 'guns' },
    { name: 'Lucky Rock', qty: 1, carry: 'stowed' },
  ]) };
  const line = (lines: ReturnType<typeof ownedItems>, label: string) => lines.find((l) => l.label === label);

  it('a typed line found on its type\'s shelf, priced as the shop sells it, sellable where the type is sold', () => {
    loadUploaded({ 'type:guns': [{ ...PISTOL, id: 'item:pistol' }] } as never);
    const lines = ownedItems(sheet, SYS);
    expect(line(lines, 'Pistol')).toMatchObject({ catalogue: 'type:guns', id: 'item:pistol', unitPrice: 250 });
    expect(sellableAt(lines, ['type:guns' as ShopStock]).map((l) => l.label)).toContain('Pistol');
    expect(sellableAt(lines, ['gear' as ShopStock]).map((l) => l.label)).not.toContain('Pistol');
  });

  it('one kept out of the shops: priced at its own to sell back, only where its type is sold; something unknown, none', () => {
    loadBuyback({ 'type:guns': [{ id: 'item:ring', name: 'Ring of Might', price: 5000 }] });
    const lines = ownedItems(sheet, SYS);
    expect(line(lines, 'Ring of Might')).toMatchObject({ catalogue: 'type:guns', id: 'item:ring', unitPrice: 5000 });
    expect(sellableAt(lines, ['weapons' as ShopStock]).map((l) => l.label)).not.toContain('Ring of Might');
    expect(line(lines, 'Lucky Rock')).toMatchObject({ catalogue: null, unitPrice: null });
  });
});
