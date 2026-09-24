/**
 * Buying onto any system's sheet, and selling it back off again.
 *
 * The window places a bought item and the server empties it on a sale, and they are two
 * different pieces of code in two different languages of the same idea. So the round trip
 * is run for real on every system: the window's writer puts an uploaded item on a sheet,
 * the server's own planner sells it, and what is left is compared with the sheet before the
 * purchase. Anything the purchase wrote and the sale did not clear is a half-deleted item.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'module';
import { placeUploaded, destinationOf, firstFreeSlot } from '../shopPlacement';
import { columnsFor } from '../catalogueSchema';
import { rowFields } from '../sheetSlots';
import { loadUploaded, clearUploaded, type UploadedEntry } from '../uploadedCatalogues';
import type { ShopStock } from '../../data/buildingTypes';

const require_ = createRequire(import.meta.url);
const store = require_('../../../../backend/shops/catalogueStore.js');
const { planSale } = require_('../../../../backend/shops/sell.js');

const SYSTEMS = ['cities_without_number', 'cyberpunk_red', 'shadowrun_6e', 'generic'];

/** One entry per catalogue shape, with fields from every system's columns in them. */
const ENTRIES: Partial<Record<ShopStock, UploadedEntry>> = {
  weapons: {
    id: 'test_gun', name: 'Test Gun', price: 100,
    fields: { dmg: '3d6', skill: 'Handgun', rof: '2', dv: '4P', ar: '8/10', mode: 'SA', enc: '1', attr: 'dex' },
  },
  vehicles: {
    id: 'test_bike', name: 'Test Bike', price: 1000,
    fields: { type: 'Bike', hp: '35', hp_max: '35', armor: '8', crew: '1', speed: '20', ac: '13', spd: '1' },
  },
  cyberware: {
    id: 'test_jack', name: 'Test Jack', price: 500,
    fields: { type: 'head', strain: '1', conc: 'touch', effect: 'Plugs into things' },
  },
  gear: { id: 'test_rope', name: 'Test Rope', price: 20, fields: { enc: '1' } },
};

afterEach(() => { store.clear(); clearUploaded(); });

/** Apply a patch the way the sheet does: each key replaces that field. */
const apply = (data: Record<string, unknown>, patch: Record<string, unknown>) => ({ ...data, ...patch });

/** A field is gone when it is missing or blank, which is what a sale writes. */
const blank = (v: unknown) => v === undefined || v === '' ;

describe('buy, own, sell, on every system', () => {
  for (const system of SYSTEMS) {
    for (const [catalogue, entry] of Object.entries(ENTRIES) as [ShopStock, UploadedEntry][]) {
      it(`${system}: ${catalogue} comes off the sheet the way it went on`, () => {
        store.load(system, { [catalogue]: [entry] });
        loadUploaded({ [catalogue]: [entry] });

        const before: Record<string, unknown> = {};
        const placed = placeUploaded(system, catalogue, entry, before);
        expect(placed.ok).toBe(true);
        if (!placed.ok) return;
        const bought = apply(before, placed.patch);

        const sale = planSale({
          data: bought,
          items: [{ catalogue, id: entry.id, qty: 1 }],
          catalogues: [catalogue],
          locationPct: 50,
          globalPct: null,
          system,
        });
        // Found as the uploaded item, and paid for at its price.
        expect(sale, JSON.stringify(placed.patch)).toMatchObject({ ok: true, payout: entry.price / 2 });

        // Nothing the purchase wrote is still there once the sale has gone through.
        const after = apply(bought, sale.patch);
        for (const key of Object.keys(placed.patch)) {
          const v = after[key];
          const empty = blank(v) || v === '[]' || (Array.isArray(v) && v.length === 0);
          expect(empty, `${key} = ${JSON.stringify(v)}`).toBe(true);
        }
      });
    }
  }
});

describe('what goes where', () => {
  it('writes a Cyberpunk RED gun into its own four fields and nothing else', () => {
    const placed = placeUploaded('cyberpunk_red', 'weapons', ENTRIES.weapons!, {});
    expect(placed).toEqual({
      ok: true,
      patch: { weapon1_dmg: '3d6', weapon1_skill: 'Handgun', weapon1_rof: '2', weapon1_name: 'Test Gun' },
    });
  });

  it('writes a Shadowrun gun with its DV and AR', () => {
    const placed = placeUploaded('shadowrun_6e', 'weapons', ENTRIES.weapons!, {});
    expect(placed.ok && placed.patch).toMatchObject({ weapon1_dv: '4P', weapon1_ar: '8/10', weapon1_mode: 'SA' });
    expect(placed.ok && placed.patch).not.toHaveProperty('weapon1_rof');
  });

  it('only ever writes fields the row declares', () => {
    for (const system of SYSTEMS) {
      for (const [catalogue, entry] of Object.entries(ENTRIES) as [ShopStock, UploadedEntry][]) {
        const placed = placeUploaded(system, catalogue, entry, {});
        if (!placed.ok || columnsFor(system, catalogue).shape !== 'slots') continue;
        const group = catalogue === 'weapons' ? 'weapon' : 'vehicle';
        const allowed = new Set(rowFields(system, group, 1));
        for (const key of Object.keys(placed.patch)) expect(allowed.has(key), `${system} ${key}`).toBe(true);
      }
    }
  });

  it('records a Cyberpunk RED vehicle\'s cost from the price', () => {
    const placed = placeUploaded('cyberpunk_red', 'vehicles', ENTRIES.vehicles!, {});
    expect(placed.ok && placed.patch).toMatchObject({ vehicle1_cost: '1000', vehicle1_name: 'Test Bike' });
  });

  it('takes the first free row, not the first row', () => {
    const data = { weapon1_name: 'Taken', weapon3_name: 'Also taken' };
    const placed = placeUploaded('cyberpunk_red', 'weapons', ENTRIES.weapons!, data);
    expect(placed.ok && placed.patch.weapon2_name).toBe('Test Gun');
  });

  it('refuses when every row is full, before anything is paid for', () => {
    const data = { weapon1_name: 'a', weapon2_name: 'b', weapon3_name: 'c', weapon4_name: 'd' };
    expect(firstFreeSlot(data, 'weapon', 4)).toBeNull();
    expect(placeUploaded('cyberpunk_red', 'weapons', ENTRIES.weapons!, data))
      .toMatchObject({ ok: false, reason: expect.stringMatching(/all 4 are full/) });
  });

  it('puts a vehicle in the inventory on a sheet with no vehicle rows', () => {
    const placed = placeUploaded('shadowrun_6e', 'vehicles', ENTRIES.vehicles!, {});
    expect(placed.ok && Object.keys(placed.patch)).toEqual(['inventory']);
  });

  it('adds cyberware unplaced where the sheet has a cyberware table', () => {
    const placed = placeUploaded('cyberpunk_red', 'cyberware', ENTRIES.cyberware!, {});
    expect(placed.ok && placed.patch.cyberware).toEqual([
      expect.objectContaining({ name: 'Test Jack', placed: false, cost: 500, hl: 1 }),
    ]);
  });

  it('puts cyberware in the inventory where the sheet has no table for it', () => {
    // Shadowrun keeps chrome in a notes box, and generic has nowhere at all.
    for (const system of ['shadowrun_6e', 'generic']) {
      const placed = placeUploaded(system, 'cyberware', ENTRIES.cyberware!, {});
      expect(placed.ok && Object.keys(placed.patch), system).toEqual(['inventory']);
      expect(columnsFor(system, 'cyberware').unavailable, system).toMatch(/no cyberware table/);
    }
  });

  it('stacks onto a carried inventory line of the same name, never a stashed one', () => {
    const data = {
      inventory: JSON.stringify([
        { name: 'Test Rope', qty: 1, carry: 'stash' },
        { name: 'Test Rope', qty: 2, carry: 'stowed' },
      ]),
    };
    const placed = placeUploaded('generic', 'gear', ENTRIES.gear!, data);
    const rows = JSON.parse(String(placed.ok && placed.patch.inventory));
    expect(rows.map((r: { qty: number }) => r.qty)).toEqual([1, 3]);
  });

  it('says where each shelf puts things', () => {
    expect(destinationOf('cyberpunk_red', 'weapons')).toBe('GOES INTO ONE OF YOUR 4 WEAPON SLOTS');
    expect(destinationOf('shadowrun_6e', 'vehicles')).toBe('GOES INTO YOUR INVENTORY');
    expect(destinationOf('cyberpunk_red', 'cyberware')).toMatch(/CYBERWARE, UNPLACED/);
  });
});
