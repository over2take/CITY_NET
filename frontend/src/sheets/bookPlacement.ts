// Where an item from the CWN book lands on a sheet (4g1b): the shop's shelves' own placement, taken
// out of ShopWindow so it is one pure function the shop calls and the server's twin
// (backend/shops/bookPlacement.js, for GIVE ITEM) is tested against, item by item.
//
//   weapons            a carried weapon row, Stowed: you walk off with it in a bag
//   vehicles           a vehicle row from the sheet's own preset, the * / ** immunity in its notes
//   cyberware          a cyberware row, not yet placed: buying is not surgery
//   armor, gear        an inventory line with its Encumbrance (blank where the book prints a symbol)
//   pharmaceuticals    an inventory line, stacked onto a dose of the same drug by any of its names
//   mods, fittings,    an inventory line, unfitted or unmounted
//   vehicle weapons
//
// Every inventory line stacks onto a carried one, never the stash. Pure: a sheet in, a patch out.

import type { ShopStock } from '../data/buildingTypes';
import type { Placement } from './shopPlacement';
import { weaponToStashed, type CwnWeaponPreset } from './cwnWeaponPresets';
import { firstFreeRow, stashedToCarried } from './cwnWeaponStash';
import { CWN_WEAPON_ROWS, CWN_VEHICLE_ROWS } from './templates/cities_without_number';
import { pharmaByName } from './cwnPharma';
import type { CwnCyberPreset } from './cwnCyberwarePresets';
import { CYBERWARE_FIELD, readRows, normaliseRow } from './cyberwareRows';
import { presetFields, type VehiclePreset } from './vehiclePresets';
import { INVENTORY_FIELD, readInventory, writeInventory, blankItem, type InventoryItem } from './inventory';

type Data = Record<string, unknown>;

/**
 * The inventory with one more of something: stacked onto a carried line `same` matches, or a new
 * line. Stash lines are never stacked onto: a box of stims in a locker is yours, but it is not
 * what you just walked out of the shop holding.
 */
export const withOneMore = (data: Data, label: string, enc: string, same: (item: InventoryItem) => boolean): Data => {
  const items = readInventory(data);
  const i = items.findIndex((item) => item.carry !== 'stash' && same(item));
  const next = i >= 0
    ? items.map((item, n) => (n === i ? { ...item, qty: item.qty + 1 } : item))
    : [...items, { ...blankItem(), name: label, qty: 1, enc }];
  return { [INVENTORY_FIELD]: writeInventory(next) };
};

/** The first vehicle slot with nothing in it, or null when every one is full. */
const firstFreeVehicle = (data: Data): number | null => {
  for (let i = 1; i <= CWN_VEHICLE_ROWS; i += 1) {
    if (!String(data[`vehicle${i}_name`] ?? '').trim()) return i;
  }
  return null;
};

/**
 * An uploaded entry as a row on one of the book's shelves (a GM's own Zip Gun beside the Heavy
 * Pistol), so it is placed the CWN way. Both spellings, because the shelves are not consistent:
 * weapons and cyberware use `name`, everything newer uses `label`.
 */
export const asBookRow = (e: { id: string; name: string; price: number; fields?: Record<string, unknown> }): BookRow => ({
  id: e.id, name: e.name, label: e.name, price: e.price, cost: e.price, ...(e.fields ?? {}),
});

/** A row on one of the book's shelves: a book entry, or an uploaded one (asBookRow). */
export type BookRow = { id: string; [field: string]: unknown };

/** An Encumbrance as a line keeps it: blank when there is none, never the word "undefined". */
const encText = (v: unknown) => (v === undefined || v === null ? '' : String(v));
const text = (v: unknown) => (v === undefined || v === null ? '' : String(v));

const line = (data: Data, label: string, enc = ''): Placement => ({ ok: true, patch: withOneMore(data, label, enc, (item) => item.name === label) });

/** One row of a book shelf onto a sheet, as that shelf places it, or why it can't go. */
export const placeBook = (catalogue: ShopStock, row: BookRow, data: Data | null | undefined): Placement => {
  const sheet = data && typeof data === 'object' ? data : {};
  switch (catalogue) {
    case 'weapons': {
      const slot = firstFreeRow(sheet, CWN_WEAPON_ROWS);
      if (slot === null) return { ok: false, reason: `No free weapon row — all ${CWN_WEAPON_ROWS} are full. Clear one on the sheet first.` };
      return { ok: true, patch: stashedToCarried(weaponToStashed(row as unknown as CwnWeaponPreset), slot) };
    }
    case 'vehicles': {
      const slot = firstFreeVehicle(sheet);
      if (slot === null) return { ok: false, reason: `No free vehicle slot — all ${CWN_VEHICLE_ROWS} are full. Clear one on the sheet first.` };
      const preset = row as unknown as VehiclePreset;
      const fields: Data = presetFields(slot, preset);
      if (preset.note) fields[`vehicle${slot}_notes`] = preset.note;
      return { ok: true, patch: fields };
    }
    case 'cyberware': {
      // Unplaced: owning a piece and having it in your body are two different facts, and the
      // diagram is the only thing that decides the second.
      const item = row as unknown as CwnCyberPreset;
      const made = normaliseRow({
        name: item.name, type: item.type, hl: item.strain, cost: item.price, conc: item.conc, data: item.effect,
        mods: (item.mods ?? []).map((m) => ({ ...m })), equipped: true, placed: false,
      });
      return { ok: true, patch: { [CYBERWARE_FIELD]: [...readRows(sheet), made] } };
    }
    case 'pharmaceuticals':
      // Stacked onto a dose of the same drug by any of its names.
      return { ok: true, patch: withOneMore(sheet, text(row.label), '', (item) => pharmaByName(item.name)?.id === row.id) };
    case 'armor':
      return line(sheet, text(row.label), encText(row.enc));
    case 'gear':
      // The symbol rows carry no Encumbrance the sheet can add up, so they go in blank rather
      // than as a zero somebody would later mistake for a measurement.
      return line(sheet, text(row.label), row.encNote ? '' : encText(row.enc));
    case 'weapon_mods':
    case 'armor_mods':
    case 'vehicle_fittings':
    case 'vehicle_weapons':
      return line(sheet, text(row.label));
    default:
      return { ok: false, reason: 'Not one of the book\'s shelves.' };
  }
};
