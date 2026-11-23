import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ownShopsIn, ownShopIn, buildingTypeIn, typeOn, isShopIn, typeLabel, onlyBuysIn, shelvedIn } from '../../data/buildingTypes';
import { registerCustomTemplate, clearCustomTemplates } from '../customTemplates';

// The game's own shops at the table (8a7b3a; approved mockup docs/mockups/types-in-shops.html): building types of the game,
// by their names, shops while on, selling the types SOLD AT them; one that sells nothing and buys anything only buys.

const SYS = 'sys_cafe0cafe0cafe0c';
const POTIONS = { id: 'potions', label: 'POTIONS', one: 'Potion', sold_at: ['apothecary'], columns: [] };

beforeEach(() => {
  clearCustomTemplates();
  registerCustomTemplate({
    id: SYS, name: 'Herbal', parts: {}, derived: [], sheet: { sections: [] }, words: {},
    buildings: { types: { general_store: { buys: 'anything' } }, shops: [{ id: 'apothecary', name: 'Apothecary', on: true }, { id: 'fence', name: 'Fence', on: true, buys: 'anything' }, { id: 'shrine', name: 'Shrine', on: false }] },
    items: { slots: [], list: [], types: [POTIONS] },
  } as never);
});
afterEach(() => clearCustomTemplates());

describe('the game\'s own shops', () => {
  it('read from its render copy; none in a built-in game', () => {
    expect(ownShopsIn(SYS).map((s) => s.id)).toEqual(['apothecary', 'fence', 'shrine']);
    expect(ownShopIn(SYS, 'fence')?.name).toBe('Fence');
    expect(ownShopIn(SYS, 'tavern')).toBeUndefined();
    expect(ownShopsIn('cities_without_number')).toEqual([]);
  });

  it('a building type of the game: a shop selling none of the app\'s, by its name; on as it says', () => {
    expect(buildingTypeIn(SYS, 'apothecary')).toEqual({ id: 'apothecary', label: 'Apothecary', shop: true, sells: [] });
    expect(buildingTypeIn(SYS, 'gun_shop')?.label).toBe('Gun Shop');
    expect(buildingTypeIn(SYS, 'tavern')).toBeUndefined();
    expect(buildingTypeIn('cyberpunk_red', 'apothecary')).toBeUndefined();
    expect(typeLabel('apothecary', SYS)).toBe('Apothecary');
    expect(typeOn(SYS, 'apothecary')).toBe(true);
    expect(typeOn(SYS, 'shrine')).toBe(false);
    expect(isShopIn(SYS, 'apothecary')).toBe(true);
    expect(isShopIn(SYS, 'shrine')).toBe(false);
    expect(isShopIn('cyberpunk_red', 'apothecary')).toBe(false);
    expect(isShopIn(SYS, 'bar')).toBe(false);
  });

  it('its shelves the types SOLD AT it; one selling nothing that buys anything only buys', () => {
    expect(shelvedIn('apothecary', SYS)).toEqual(['type:potions']);
    expect(onlyBuysIn(SYS, 'fence')).toBe(true);
    expect(onlyBuysIn(SYS, 'apothecary')).toBe(false);
    expect(onlyBuysIn(SYS, 'shrine')).toBe(false);
    // Buying anything while it sells its gear: not only buying.
    expect(onlyBuysIn(SYS, 'general_store')).toBe(false);
  });
});
