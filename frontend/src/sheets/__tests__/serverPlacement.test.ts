import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { placeUploaded } from '../shopPlacement';
import { columnsFor, layoutsOf } from '../catalogueSchema';
import { readInventory, normaliseItem, blankItem } from '../inventory';
import { CATALOGUES, type ShopStock } from '../../data/buildingTypes';
import type { UploadedEntry } from '../uploadedCatalogues';

/**
 * GIVE ITEM places a gift on the server (4g1a, the user's call 2026-10-12), so it must land exactly
 * where buying it in a shop would. The server's backend/shops/placement.js is held here to the
 * shop's own placement (shopPlacement.ts, inventory.ts) on the same sheets, for every built-in game
 * and every catalogue.
 */

const server = createRequire(import.meta.url)('../../../../backend/shops/placement.js');

const SYSTEMS = ['cities_without_number', 'cyberpunk_red', 'shadowrun_6e', 'generic'];
const STOCK = CATALOGUES.map((c) => c.id) as ShopStock[];

/** An entry carrying every column any game's rows have, and some no game has. */
const ENTRY: UploadedEntry = {
  id: 'thing', name: 'Thing', price: 250,
  fields: {
    dmg: '1d8', skill: 'Shoot', attr: 'DEX', trauma: '1d8/x3', shock: '2/15', enc: '1', range: '30/100', mag: '15',
    rof: '2', dv: '4P', ar: '8/10', mode: 'SA', type: 'car', hp: '30', hp_max: '30', armor: '6', ac: '13', spd: '1',
    tt: '8', crew: '1', hrdpt: '0', pow: '1', mass: '2', size: 'S', speed: '20', notes: 'roof rack', cost: '999',
    strain: '1', conc: 'touch', effect: 'Does a thing.', nonsense: 'ignored',
  },
} as unknown as UploadedEntry;

const full = (group: string, rows: number) => Object.fromEntries(Array.from({ length: rows }, (_, i) => [`${group}${i + 1}_name`, `Owned ${i + 1}`]));
const SHEETS: Record<string, Record<string, unknown>> = {
  empty: {},
  'some weapons and vehicles': { weapon1_name: 'Knife', weapon2_name: '', vehicle1_name: 'CAR' },
  // A row whose name is only spaces is free; one named 0 is not.
  'a row named only spaces': { weapon1_name: '   ', vehicle1_name: 0 },
  'junk in the inventory': { inventory: [null, 'rope', 7, { name: 'Thing', qty: -4, carry: 'stowed' }] },
  'every row full': { ...full('weapon', 6), ...full('vehicle', 6) },
  'a carried one already': { inventory: JSON.stringify([{ name: 'Thing', qty: 2, carry: 'stowed' }]) },
  'one in the stash': { inventory: [{ name: 'Thing', qty: 1, carry: 'stash', location: 'locker' }] },
  'an unreadable inventory': { inventory: '{not json' },
  'chrome already': { cyberware: [{ name: 'Cranial Jack', type: 'head', hl: 2, placed: true }] },
  // A mod fitted to an implant the character has must survive a gift of more chrome.
  'chrome with a mod fitted': { cyberware: [{ name: 'Body Blades I', type: 'r_arm', hl: 1, placed: true, cyberMods: ['tailored_interface'] }, 'junk'] },
};

/** An entry with its columns left blank: a blank one writes nothing. */
const BLANK: UploadedEntry = { id: 'blank', name: 'Blank', price: 0, fields: { dmg: '', type: '', enc: '' } } as unknown as UploadedEntry;

describe('a gift placed on the server', () => {
  it('lands exactly where the shop would put it, for every game, catalogue and sheet', () => {
    for (const system of SYSTEMS) {
      for (const catalogue of STOCK) {
        for (const [what, sheet] of Object.entries(SHEETS)) {
          for (const entry of [ENTRY, BLANK]) {
            expect(server.placeUploaded(system, catalogue, entry, sheet), `${system} ${catalogue} ${what} ${entry.name}`)
              .toEqual(placeUploaded(system, catalogue, entry, sheet));
          }
        }
      }
    }
  });

  it('takes the shape the shop\'s catalogue columns say, the cyberware table where the sheet draws one', () => {
    for (const system of SYSTEMS) {
      for (const catalogue of STOCK) expect(server.shapeOf(system, catalogue), `${system} ${catalogue}`).toBe(columnsFor(system, catalogue).shape);
      expect(server.CYBERWARE_TABLE.has(system), system).toBe(layoutsOf(system).has('cyberware'));
    }
  });

  it('reads and writes an inventory as the sheet does', () => {
    for (const raw of [{}, { name: 'Rope', qty: '3', enc: 1, carry: 'READIED' }, { qty: 0 }, { qty: -3 }, { qty: 2.9 }, null, 'x', { carry: 'pocket', bundled: 'yes' }]) {
      expect(server.normaliseItem(raw), JSON.stringify(raw)).toEqual(normaliseItem(raw));
    }
    for (const sheet of Object.values(SHEETS)) expect(server.readInventory(sheet)).toEqual(readInventory(sheet));
    expect(server.blankItem()).toEqual(blankItem());
  });
});
