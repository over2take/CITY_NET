import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { buysIn, boughtIn, shelvedIn, type ShopStock } from '../../data/buildingTypes';
import { registerCustomTemplate, clearCustomTemplates } from '../customTemplates';

// What a shop BUYS (8a7b1b): what it sells, or ANYTHING, every shelf the game prices; the server takes the same list
// (backend systemBuilder/itemTypes.js boughtAt).

const SYS = 'sys_baba0baba0baba0b';
const POTIONS = { id: 'potions', label: 'POTIONS', one: 'Potion', sold_at: ['apothecary'], columns: [] };

beforeEach(() => {
  clearCustomTemplates();
  registerCustomTemplate({
    id: SYS, name: 'Pawn', parts: {}, derived: [], sheet: { sections: [] }, words: {},
    buildings: { types: { general_store: { buys: 'anything' } }, catalogues: { vehicles: { on: false } },
      shops: [{ id: 'apothecary', name: 'Apothecary', on: true }, { id: 'fence', name: 'Fence', on: true, buys: 'anything' }] },
    items: { slots: [], list: [], types: [POTIONS] },
  } as never);
});
afterEach(() => clearCustomTemplates());

describe('what a shop buys', () => {
  it('ANYTHING where the game says so, on the app\'s shops and its own; else, and in a built-in game, what it sells', () => {
    expect(buysIn(SYS, 'general_store')).toBe('anything');
    expect(buysIn(SYS, 'fence')).toBe('anything');
    expect(buysIn(SYS, 'gun_shop')).toBe('sells');
    expect(buysIn(SYS, 'apothecary')).toBe('sells');
    expect(buysIn('cities_without_number', 'general_store')).toBe('sells');
  });

  it('the shelves it buys back from: what it sells, or every shelf the game has on and each of its types\'', () => {
    const sold = shelvedIn('gun_shop', SYS);
    expect(boughtIn('gun_shop', SYS, sold)).toEqual(sold);
    const all = boughtIn('general_store', SYS, ['gear' as ShopStock]);
    expect(all).toEqual(expect.arrayContaining(['gear', 'weapons', 'armor', 'pharmaceuticals', 'cyberware', 'type:potions']));
    // A catalogue turned off, or one no shop shelves, is bought nowhere.
    expect(all).not.toContain('vehicles');
    expect(all).not.toContain('cyber_mods');
    expect(new Set(all).size).toBe(all.length);
    // The game's own Fence, selling nothing, buys the same.
    expect([...boughtIn('fence', SYS, [])].sort()).toEqual([...all].sort());
    expect(boughtIn('general_store', 'cities_without_number', ['gear' as ShopStock])).toEqual(['gear']);
  });
});
