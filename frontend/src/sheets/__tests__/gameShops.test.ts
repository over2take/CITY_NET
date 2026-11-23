import { describe, it, expect } from 'vitest';
import type { Definition } from '../systemsApi';
import { ownShopsOf, shopChoices, soldAtOf, withSoldAtToggled, withNewShop, soldAtWords, SHOPS_MOST, DEFAULT_SOLD_AT, withOwnShop, withoutOwnShop, typesSoldAt } from '../gameShops';
import { PRESETS, PRESET_NEW_SHOP, withNewType, itemTypes } from '../itemTypes';
import { withBuilding } from '../wordsFeatures';

// SOLD AT and + NEW SHOP (8a7b2; approved mockup docs/mockups/types-in-shops.html, section 2): the game's shops by their
// names here then its own, a type's ticks kept in that order, a shop of its own made from a name, the words under them.

const def = (more: object = {}) => ({ format: 1, name: 'A', items: { types: [{ id: 'potions', label: 'POTIONS', columns: [] }] }, ...more }) as unknown as Definition;
const potions = (d: Definition) => itemTypes(d)[0];

describe('the shops to tick', () => {
  it('the app\'s, named as this game names them, on or off; then the game\'s own, well formed only', () => {
    const d = def({ buildings: { types: { gun_shop: { name: 'Blacksmith' }, garage: { on: false } },
      shops: [{ id: 'apothecary', name: 'Apothecary' }, { id: 'fence', name: 'Fence', on: false }, { id: 'bar', name: 'Taken' }, { name: 'No id' }, { id: 'nameless' }] } });
    expect(shopChoices(d)).toEqual([
      { id: 'ripperdoc', name: 'Ripperdoc', own: false, on: true }, { id: 'gun_shop', name: 'Blacksmith', own: false, on: true },
      { id: 'clinic', name: 'Clinic', own: false, on: true }, { id: 'garage', name: 'Garage', own: false, on: false },
      { id: 'armorer', name: 'Armorer', own: false, on: true }, { id: 'general_store', name: 'General Store', own: false, on: true },
      { id: 'apothecary', name: 'Apothecary', own: true, on: true }, { id: 'fence', name: 'Fence', own: true, on: false },
    ]);
    expect(ownShopsOf(def())).toEqual([]);
  });

  it('a type\'s: what it says, else the General Store', () => {
    expect(DEFAULT_SOLD_AT).toEqual(['general_store']);
    expect(soldAtOf({ id: 'a', label: 'A', columns: [] })).toEqual(['general_store']);
    expect(soldAtOf({ id: 'a', label: 'A', columns: [], sold_at: [] })).toEqual([]);
  });
});

describe('ticking one', () => {
  it('stored in the order the shops are shown; ticked again, gone; unsaid starts from the General Store', () => {
    let d = withSoldAtToggled(def(), 'potions', 'clinic');
    expect(potions(d).sold_at).toEqual(['clinic', 'general_store']);
    d = withSoldAtToggled(d, 'potions', 'ripperdoc');
    expect(potions(d).sold_at).toEqual(['ripperdoc', 'clinic', 'general_store']);
    d = withSoldAtToggled(d, 'potions', 'clinic');
    expect(potions(d).sold_at).toEqual(['ripperdoc', 'general_store']);
    expect(withSoldAtToggled(d, 'wands', 'clinic')).toBe(d);
  });

  it('a shop it is sold at that the game no longer makes stays at the end, to be ticked off', () => {
    const d = def({ items: { types: [{ id: 'potions', label: 'POTIONS', columns: [], sold_at: ['gone'] }] } });
    expect(potions(withSoldAtToggled(d, 'potions', 'clinic')).sold_at).toEqual(['clinic', 'gone']);
  });
});

describe('+ NEW SHOP', () => {
  it('made from its name, tidied, at the end; its id never one the app has', () => {
    const made = withNewShop(def(), '  Magic   Shop ')!;
    expect(made.id).toBe('magic_shop');
    expect(ownShopsOf(made.definition)).toEqual([{ id: 'magic_shop', name: 'Magic Shop' }]);
    const bar = withNewShop(made.definition, 'Bar')!;
    expect(bar.id).not.toBe('bar');
    expect(ownShopsOf(bar.definition).map((s) => s.name)).toEqual(['Magic Shop', 'Bar']);
  });

  it('a name already a shop, the app\'s by its name here or the game\'s own, any case: that one, nothing made', () => {
    const d = def({ buildings: { types: { gun_shop: { name: 'Blacksmith' } }, shops: [{ id: 'fence', name: 'Fence' }] } });
    expect(withNewShop(d, 'blacksmith')).toEqual({ definition: d, id: 'gun_shop' });
    expect(withNewShop(d, 'FENCE')).toEqual({ definition: d, id: 'fence' });
    expect(withNewShop(d, 'General store')).toEqual({ definition: d, id: 'general_store' });
  });

  it('none from a blank name, nor past the most; a name kept to 40 characters', () => {
    expect(withNewShop(def(), '   ')).toBeNull();
    expect(SHOPS_MOST).toBe(20);
    const full = def({ buildings: { shops: Array.from({ length: 20 }, (_, n) => ({ id: `shop_${n}`, name: `Shop ${n}` })) } });
    expect(withNewShop(full, 'One more')).toBeNull();
    expect(withNewShop(full, 'Shop 3')).toEqual({ definition: full, id: 'shop_3' });
    expect(ownShopsOf(withNewShop(def(), 'x'.repeat(50))!.definition)[0].name).toHaveLength(40);
  });
});

describe('what SOLD AT says', () => {
  it('every shop it is sold at by name; dashed explained only where the game made some; sold nowhere', () => {
    const d = def({ buildings: { types: { gun_shop: { name: 'Blacksmith' } } } });
    expect(soldAtWords(d, { ...potions(d), sold_at: ['gun_shop', 'general_store'] })).toBe('Sold at every Blacksmith, every General Store in this game.');
    const own = withNewShop(d, 'Fence')!.definition;
    expect(soldAtWords(own, { ...potions(own), sold_at: ['fence'] })).toBe('Sold at every Fence in this game. Dashed: shops this game made.');
    expect(soldAtWords(d, { ...potions(d), sold_at: [] })).toBe('Sold nowhere: only given, from GIVE.EXE.');
  });
});

describe('the presets\' shops', () => {
  it('WEAPON the Gun Shop, ARMOR the Armorer, GEAR the General Store unsaid, CONSUMABLE the Clinic, SPELL none with a Magic Shop to ADD', () => {
    expect(PRESETS.map((p) => `${p.id}:${soldAtOf(p.type).join('+')}`)).toEqual(['weapon:gun_shop', 'armor:armorer', 'gear:general_store', 'consumable:clinic', 'spell:']);
    expect(PRESETS.find((p) => p.id === 'gear')!.type).not.toHaveProperty('sold_at');
    expect(PRESET_NEW_SHOP).toEqual({ spell: 'Magic Shop' });
    expect(itemTypes(withNewType(def(), 'weapon')!.definition)[1].sold_at).toEqual(['gun_shop']);
  });
});

describe('FEATURES keeps what a shop BUYS (8a7b1b)', () => {
  it('renamed or turned off, a shop that buys anything still does; one that buys what it sells stores nothing', () => {
    const d = def({ buildings: { types: { general_store: { buys: 'anything' } } } });
    const named = withBuilding(d, 'types', 'general_store', { name: 'Pawn' });
    expect((named as unknown as { buildings: object }).buildings).toEqual({ types: { general_store: { name: 'Pawn', buys: 'anything' } } });
    const back = withBuilding(named, 'types', 'general_store', { buys: 'sells', name: '' });
    expect(back as unknown as object).not.toHaveProperty('buildings');
  });
});

describe('the game\'s own shops on FEATURES (8a7b3b)', () => {
  const herbal = () => def({ buildings: { types: { gun_shop: { name: 'Blacksmith' } }, shops: [{ id: 'apothecary', name: 'Apothecary' }, { id: 'fence', name: 'Fence', buys: 'anything' }] },
    items: { types: [{ id: 'potions', label: 'POTIONS', columns: [], sold_at: ['apothecary', 'general_store'] }, { id: 'herbs', label: '', columns: [], sold_at: ['apothecary'] }] } });

  it('renamed, switched off, set to buy anything; on, and buying what it sells, store nothing', () => {
    let d = withOwnShop(herbal(), 'apothecary', { name: 'Herbalist', on: false, buys: 'anything' });
    expect(ownShopsOf(d)[0]).toEqual({ id: 'apothecary', name: 'Herbalist', on: false, buys: 'anything' });
    d = withOwnShop(d, 'apothecary', { on: true, buys: 'sells' });
    expect(ownShopsOf(d)[0]).toEqual({ id: 'apothecary', name: 'Herbalist' });
    // A blank name kept while it is typed; the other shop untouched.
    expect(ownShopsOf(withOwnShop(d, 'apothecary', { name: '' }))).toEqual([{ id: 'apothecary', name: '' }, { id: 'fence', name: 'Fence', buys: 'anything' }]);
  });

  it('deleted: gone from the shops and every type\'s SOLD AT; the last one gone, nothing stored but what else was set', () => {
    let d = withoutOwnShop(herbal(), 'apothecary');
    expect(ownShopsOf(d).map((s) => s.id)).toEqual(['fence']);
    expect(itemTypes(d).map((t) => t.sold_at)).toEqual([['general_store'], []]);
    d = withoutOwnShop(d, 'fence');
    expect((d as unknown as { buildings: object }).buildings).toEqual({ types: { gun_shop: { name: 'Blacksmith' } } });
    const bare = withoutOwnShop(def({ buildings: { shops: [{ id: 'fence', name: 'Fence' }] } }), 'fence');
    expect(bare as unknown as object).not.toHaveProperty('buildings');
    // A game with no types of its own: only the shop goes.
    expect((withoutOwnShop(def({ items: undefined, buildings: { shops: [{ id: 'fence', name: 'Fence' }] } }), 'fence') as unknown as { items?: object }).items).toBeUndefined();
  });

  it('what a shop of its own sells: the types that tick it, by name', () => {
    expect(typesSoldAt(herbal(), 'apothecary')).toEqual(['POTIONS', 'herbs']);
    expect(typesSoldAt(herbal(), 'fence')).toEqual([]);
    expect(typesSoldAt(def({ items: undefined }), 'general_store')).toEqual([]);
  });
});
