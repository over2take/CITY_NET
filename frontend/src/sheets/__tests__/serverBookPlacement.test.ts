import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { placeBook, asBookRow, type BookRow } from '../bookPlacement';
import { CWN_WEAPONS } from '../cwnWeaponPresets';
import { VEHICLE_PRESETS } from '../vehiclePresets';
import { CWN_CYBERWARE } from '../cwnCyberwarePresets';
import { CWN_ARMOR } from '../cwnArmorPresets';
import { CWN_GEAR } from '../cwnGearPresets';
import { CWN_PHARMACEUTICALS } from '../cwnPharma';
import { CWN_WEAPON_MODS, CWN_ARMOR_MODS } from '../cwnGearMods';
import { VEHICLE_FITTINGS } from '../vehicleFittings';
import { VEHICLE_WEAPONS } from '../vehicleWeapons';
import { readInventory } from '../inventory';
import type { ShopStock } from '../../data/buildingTypes';

/**
 * GIVE ITEM places a CWN book item on the server (4g1b). The server's backend/shops/bookPlacement.js
 * (and its copy of the book, bookItems.js) is held here to the shop's own placement
 * (sheets/bookPlacement.ts, which ShopWindow's shelves call): every book item, and a GM's uploaded
 * rows on those shelves, placed both ways on the same sheets.
 */

const server = createRequire(import.meta.url)('../../../../backend/shops/bookPlacement.js');

/**
 * What the book sells. A vehicle weapon with no price comes with a hull and isn't sold on its own
 * (the shop's shelf won't sell it), so it isn't given either: the server has no row for it.
 */
const UNSOLD = VEHICLE_WEAPONS.filter((w) => w.cost === undefined);
const BOOK: Record<string, BookRow[]> = {
  weapons: CWN_WEAPONS as unknown as BookRow[],
  vehicles: VEHICLE_PRESETS as unknown as BookRow[],
  cyberware: CWN_CYBERWARE as unknown as BookRow[],
  armor: CWN_ARMOR as unknown as BookRow[],
  gear: CWN_GEAR as unknown as BookRow[],
  pharmaceuticals: CWN_PHARMACEUTICALS as unknown as BookRow[],
  weapon_mods: CWN_WEAPON_MODS as unknown as BookRow[],
  armor_mods: CWN_ARMOR_MODS as unknown as BookRow[],
  vehicle_fittings: VEHICLE_FITTINGS as unknown as BookRow[],
  vehicle_weapons: VEHICLE_WEAPONS.filter((w) => w.cost !== undefined) as unknown as BookRow[],
};

const rows = (group: string, n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`${group}${i + 1}_name`, `Owned ${i + 1}`]));
const SHEETS: Record<string, Record<string, unknown>> = {
  empty: {},
  'five weapon rows and a blank-named one': { ...rows('weapon', 5), weapon6_name: '  ' },
  'every row full': { ...rows('weapon', 6), ...rows('vehicle', 6) },
  'some vehicles': { vehicle1_name: 'CAR', vehicle3_name: 'MOTORCYCLE' },
  'lines to stack onto': { inventory: JSON.stringify([
    ...CWN_ARMOR.slice(0, 2).map((a) => ({ name: a.label, qty: 1, carry: 'stowed' })),
    ...CWN_GEAR.slice(0, 2).map((g) => ({ name: g.label, qty: 2, carry: 'readied' })),
    ...VEHICLE_FITTINGS.slice(0, 1).map((f) => ({ name: f.label, qty: 1, carry: 'stash' })),
  ]) },
  // A dose matched by another of its names: the id, or the label written differently.
  'doses under other names': { inventory: [
    ...CWN_PHARMACEUTICALS.slice(0, 4).map((p, i) => ({ name: i % 2 ? p.id.toUpperCase() : p.label.toLowerCase(), qty: 1, carry: 'stowed' })),
    // Two-word names written another way: "trauma-patch" is a Trauma Patch.
    { name: 'trauma-patch', qty: 1, carry: 'stowed' },
    { name: 'Medical.Prescription', qty: 2, carry: 'readied' },
  ] },
  'chrome with a mod fitted': { cyberware: [{ name: 'Body Blades I', type: 'r_arm', hl: 1, placed: true, cyberMods: ['tailored_interface'] }] },
  'junk': { inventory: '{nope', cyberware: 'nope' },
};

describe('a book item given on the server', () => {
  it('has a row on the server for every item in the book, and nothing else', () => {
    for (const [catalogue, list] of Object.entries(BOOK)) {
      for (const item of list) expect(server.bookRow(catalogue, item.id), `${catalogue} ${item.id}`).not.toBeNull();
      expect(server.bookRow(catalogue, 'no_such_thing')).toBeNull();
    }
    expect(UNSOLD.length).toBeGreaterThan(0);
    for (const w of UNSOLD) expect(server.bookRow('vehicle_weapons', w.id), w.id).toBeNull();
    expect([...server.BOOK_CATALOGUES].sort()).toEqual(Object.keys(BOOK).sort());
    expect(server.bookRow('nonsense', 'knife')).toBeNull();
  });

  it('lands exactly where the shop\'s shelf would put it, item by item, sheet by sheet', () => {
    for (const [catalogue, list] of Object.entries(BOOK)) {
      for (const item of list) {
        for (const [what, sheet] of Object.entries(SHEETS)) {
          expect(server.placeBook(catalogue, server.bookRow(catalogue, item.id), sheet), `${catalogue} ${item.id} on ${what}`)
            .toEqual(placeBook(catalogue as ShopStock, item, sheet));
        }
      }
    }
  });
});

describe('a GM\'s own item on a book shelf, given on the server', () => {
  const UPLOADS = [
    { id: 'zip_gun', name: 'Zip Gun', price: 15, fields: { dmg: '1d4', skill: 'shoot', attr: 'dex', enc: '1', note: 'Home-made.' } },
    { id: 'bare', name: 'Bare Thing', price: 0 },
    { id: 'heavy_pistol', name: 'House Pistol', price: 300, fields: { dmg: '1d10', encNote: 'worn', strain: '2', type: 'body', conc: 'touch', hp: '12' } },
  ];

  it('is shaped as the shop shapes it, and placed the same way', () => {
    for (const e of UPLOADS) {
      expect(server.asBookRow(e)).toEqual(asBookRow(e));
      for (const catalogue of Object.keys(BOOK)) {
        for (const [what, sheet] of Object.entries(SHEETS)) {
          expect(server.placeBook(catalogue, server.asBookRow(e), sheet), `${catalogue} ${e.id} on ${what}`)
            .toEqual(placeBook(catalogue as ShopStock, asBookRow(e), sheet));
        }
      }
    }
  });

  it('writes no Encumbrance at all, rather than the word "undefined", when the GM gave none', () => {
    for (const catalogue of ['armor', 'gear'] as ShopStock[]) {
      const placed = placeBook(catalogue, asBookRow({ id: 'cloak', name: 'Cloak', price: 5 }), {});
      expect(placed.ok && readInventory(placed.patch)[0].enc, catalogue).toBe('');
    }
  });

  it('refuses a shelf the book hasn\'t got', () => {
    expect(placeBook('nonsense' as ShopStock, asBookRow({ id: 'x', name: 'X', price: 1 }), {})).toEqual({ ok: false, reason: 'Not one of the book\'s shelves.' });
    expect(server.placeBook('nonsense', server.asBookRow({ id: 'x', name: 'X', price: 1 }), {})).toEqual({ ok: false, reason: 'Not one of the book\'s shelves.' });
  });
});
