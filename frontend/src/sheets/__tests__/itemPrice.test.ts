import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import {
  priceColumnOf, itemPriceOf, inShopsOf, priceNeeded, withItemPrice, withInShops, withItemType, PRICE_COLUMN,
} from '../itemTypes';
import { itemList, type Item } from '../items';
import type { Definition } from '../systemsApi';

// An item's PRICE and IN SHOPS on the ITEMS page (8a7a3b1; decided 2026-11-21, mockup docs/mockups/types-in-shops.html): the
// price kept in its type's PRICE column where it has one, else its own; IN SHOPS as switched, one saved before the switch by
// whether it has a price; read exactly as the server reads them (backend itemTypes.js itemPrice, inShops), on the same items.

const server = createRequire(import.meta.url)('../../../../backend/systemBuilder/itemTypes.js');

const WEAPONS = { id: 'weapons', label: 'WEAPONS', one: 'Weapon', columns: [{ id: 'damage', label: 'DAMAGE', kind: 'damage' }, { id: 'price', label: 'PRICE', kind: 'number' }] };
const ARMOR = { id: 'armor', label: 'ARMOR', one: 'Armor', columns: [{ id: 'defense', label: 'DEFENSE', kind: 'number' }] };
const ITEMS: Item[] = [
  { id: 'pistol', label: 'Pistol', type: 'weapons', values: { damage: '2d6', price: 200 } },
  { id: 'jacket', label: 'Leather Jacket', type: 'armor', values: { defense: 2 }, price: 50, in_shops: true },
  { id: 'ring', label: 'Ring of Might', type: 'armor', price: 5000, in_shops: false },
  { id: 'rope', label: 'Rope', type: 'armor' },
  { id: 'new', label: 'NEW ARMOR', type: 'armor', in_shops: true },
  { id: 'odd', label: 'Odd', type: 'armor', values: { price: 9 } },
  { id: 'cheap', label: 'Cheap', type: 'weapons', values: { price: -5 } },
];
const DEF = { items: { types: [WEAPONS, ARMOR], list: ITEMS } } as unknown as Definition;
const item = (def: Definition, id: string) => itemList(def).find((i) => i.id === id)!;

describe('read', () => {
  it('the price: its own, else its type\'s PRICE column\'s; IN SHOPS; a price needed', () => {
    expect(ITEMS.map((i) => itemPriceOf(DEF, i))).toEqual([200, 50, 5000, undefined, undefined, undefined, undefined]);
    expect(ITEMS.map((i) => inShopsOf(DEF, i))).toEqual([true, true, false, false, true, false, false]);
    expect(ITEMS.map((i) => priceNeeded(DEF, i))).toEqual([false, false, false, false, true, false, false]);
    expect(priceColumnOf(DEF, ITEMS[0])?.id).toBe(PRICE_COLUMN);
    expect(priceColumnOf(DEF, ITEMS[1])).toBeUndefined();
  });

  it('a column called price that isn\'t a NUMBER is no PRICE column; an own price the server would refuse, none in the box', () => {
    const WORDY = { items: { types: [{ ...WEAPONS, columns: [{ id: 'price', label: 'PRICE', kind: 'text' }] }], list: [] } } as unknown as Definition;
    const told = { id: 'told', label: 'Told', type: 'weapons', values: { price: 9 } } as Item;
    expect(priceColumnOf(WORDY, told)).toBeUndefined();
    expect(itemPriceOf(WORDY, told)).toBeUndefined();
    expect(server.itemPrice(WORDY, told)).toBeUndefined();
    expect(itemPriceOf(DEF, { id: 'bad', label: 'Bad', type: 'armor', price: -1 })).toBeUndefined();
  });

  it('exactly as the server reads them, on every item', () => {
    for (const i of ITEMS) {
      expect(itemPriceOf(DEF, i) ?? null, i.label).toEqual(server.itemPrice(DEF, i) ?? null);
      expect(inShopsOf(DEF, i), i.label).toBe(server.inShops(DEF, i));
    }
  });
});

describe('changed', () => {
  it('a price kept in the type\'s PRICE column where it has one, else its own; blank takes it away', () => {
    expect(item(withItemPrice(DEF, 'pistol', 180), 'pistol')).toEqual({ ...ITEMS[0], values: { damage: '2d6', price: 180 } });
    expect(item(withItemPrice(DEF, 'rope', 3), 'rope')).toEqual({ ...ITEMS[3], price: 3 });
    expect(Object.keys(item(withItemPrice(DEF, 'pistol', undefined), 'pistol').values!)).toEqual(['damage']);
    expect(item(withItemPrice(DEF, 'jacket', undefined), 'jacket')).not.toHaveProperty('price');
    // A stray own price on a type with a PRICE column goes, the column holding it.
    const stray = { items: { types: [WEAPONS], list: [{ ...ITEMS[0], price: 1 }] } } as unknown as Definition;
    expect(item(withItemPrice(stray, 'pistol', 150), 'pistol')).toEqual({ ...ITEMS[0], values: { damage: '2d6', price: 150 } });
    // Only the one item.
    expect(item(withItemPrice(DEF, 'rope', 3), 'jacket')).toEqual(ITEMS[1]);
  });

  it('IN SHOPS as switched', () => {
    expect(item(withInShops(DEF, 'pistol', false), 'pistol').in_shops).toBe(false);
    expect(item(withInShops(DEF, 'rope', true), 'rope').in_shops).toBe(true);
    expect(item(withInShops(DEF, 'rope', true), 'pistol')).toEqual(ITEMS[0]);
  });

  it('made another type, its price goes with it: into the new type\'s PRICE column, or its own', () => {
    expect(item(withItemType(DEF, 'pistol', 'armor'), 'pistol')).toEqual({ id: 'pistol', label: 'Pistol', type: 'armor', price: 200 });
    expect(item(withItemType(DEF, 'jacket', 'weapons'), 'jacket')).toEqual({ id: 'jacket', label: 'Leather Jacket', type: 'weapons', values: { price: 50 }, in_shops: true });
    // No price, nothing made up.
    expect(item(withItemType(DEF, 'rope', 'weapons'), 'rope')).toEqual({ id: 'rope', label: 'Rope', type: 'weapons' });
  });
});
