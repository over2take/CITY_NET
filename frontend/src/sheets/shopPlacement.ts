// Where a bought item lands on a sheet, for any system.
//
// The CWN shelves place things their own way - a weapon arrives Stowed and counts against
// Encumbrance, a vehicle carries its immunity note - because CWN has those rules and a book
// table to fill them from. Every other system's shops sell only what a GM uploaded, and an
// uploaded entry is a name, a price and whatever sheet fields the GM filled in. This is the
// one writer for that: it reads where things go out of the system's own template, so a
// Cyberpunk RED gun gets its rate of fire and a Shadowrun gun its DV, and neither gets a
// CWN field it does not have.
//
// Pure, like the server's sale planner: it takes a sheet and hands back a patch. The window
// runs it twice - once before any money moves, to refuse a purchase with nowhere to go, and
// again when the receipt arrives, against the sheet as it is by then.
//
// Three shapes, the same three the catalogue file is written in:
//
//   slots      - the first free numbered row of the group (weapon, vehicle).
//   list       - a new cyberware row, not yet placed on the body.
//   inventory  - a line in the inventory, stacked onto one of the same name.

import type { ShopStock } from '../data/buildingTypes';
import { columnsFor } from './catalogueSchema';
import { slotsOf, type SlotGroup } from './sheetSlots';
import { CYBERWARE_FIELD, readRows, normaliseRow } from './cyberwareRows';
import {
  INVENTORY_FIELD, readInventory, writeInventory, blankItem,
} from './inventory';
import type { UploadedEntry } from './uploadedCatalogues';

export type Placement =
  | { ok: true; patch: Record<string, unknown> }
  | { ok: false; reason: string };

/** Which numbered group each slot-shaped catalogue fills. */
const GROUP_OF: Partial<Record<ShopStock, SlotGroup>> = {
  weapons: 'weapon',
  vehicles: 'vehicle',
};

/**
 * The first row of a group with no name in it, or null when every one is taken.
 *
 * A row is free when it has no name: every template writes the name first and clears it
 * last, so "has a name" and "has something in it" are the same question.
 */
export const firstFreeSlot = (
  data: Record<string, unknown>, group: SlotGroup, rows: number,
): number | null => {
  for (let i = 1; i <= rows; i += 1) {
    if (!String(data[`${group}${i}_name`] ?? '').trim()) return i;
  }
  return null;
};

/** Where this catalogue's items go on this system's sheet, for the shelf's notice line. */
export const destinationOf = (system: string, catalogue: ShopStock): string => {
  const spec = columnsFor(system, catalogue);
  const group = GROUP_OF[catalogue];
  if (spec.shape === 'slots' && group) {
    return `GOES INTO ONE OF YOUR ${slotsOf(system)[group]?.rows ?? 0} ${group.toUpperCase()} SLOTS`;
  }
  if (spec.shape === 'list') return 'GOES INTO YOUR CYBERWARE, UNPLACED — BUYING IS NOT SURGERY';
  return 'GOES INTO YOUR INVENTORY';
};

/** Put one uploaded item onto a sheet, or say why it cannot go. */
export const placeUploaded = (
  system: string,
  catalogue: ShopStock,
  entry: UploadedEntry,
  data: Record<string, unknown> | null | undefined,
): Placement => {
  const sheet = data && typeof data === 'object' ? data : {};
  const spec = columnsFor(system, catalogue);
  const fields = entry.fields ?? {};

  const group = GROUP_OF[catalogue];
  const slots = group ? slotsOf(system)[group] : undefined;
  if (spec.shape === 'slots' && group && slots) {
    const row = firstFreeSlot(sheet, group, slots.rows);
    if (row === null) {
      return {
        ok: false,
        reason: `No free ${group} slot — all ${slots.rows} are full. Clear one on the sheet first.`,
      };
    }
    // Only what the row actually has. A GM's file can carry a column from another game's
    // sheet, and writing it would leave a field no template draws and no sale clears.
    const patch: Record<string, unknown> = {};
    for (const suffix of slots.fields) {
      if (suffix === 'name') continue;
      const value = fields[suffix];
      if (value !== undefined && value !== '') patch[`${group}${row}_${suffix}`] = String(value);
    }
    // The sheet's own record of what it cost, where the row has one. The catalogue leaves
    // `cost` out as a column so there is one answer to the question, and this is it.
    if (slots.fields.includes('cost')) patch[`${group}${row}_cost`] = String(entry.price);
    patch[`${group}${row}_name`] = entry.name;
    return { ok: true, patch };
  }

  if (spec.shape === 'list') {
    // Unplaced: owning a piece and having it in your body are two different facts.
    const row = normaliseRow({
      name: entry.name,
      type: fields.type ?? '',
      hl: fields.strain ?? 0,
      cost: entry.price,
      conc: fields.conc ?? '',
      data: fields.effect ?? '',
      equipped: true,
      placed: false,
    });
    return { ok: true, patch: { [CYBERWARE_FIELD]: [...readRows(sheet), row] } };
  }

  // An inventory line, stacked onto a carried one of the same name. Stash rows are never
  // stacked onto: a box in a locker is yours, but it is not what you just walked out with.
  const items = readInventory(sheet);
  const i = items.findIndex((item) => item.carry !== 'stash' && item.name === entry.name);
  const next = i >= 0
    ? items.map((item, n) => (n === i ? { ...item, qty: item.qty + 1 } : item))
    : [...items, { ...blankItem(), name: entry.name, qty: 1, enc: String(fields.enc ?? '') }];
  return { ok: true, patch: { [INVENTORY_FIELD]: writeInventory(next) } };
};
