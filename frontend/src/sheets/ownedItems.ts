// What a character owns, gathered from the four places a sheet keeps things.
//
// Mirrored from backend/shops/owned.js, which is what a sale is actually checked against.
// This draws the SELL tab; that one decides what gets paid for. A test walks both over the
// same sheets, because a disagreement is either an item a player can see and cannot sell,
// or one the server pays for twice.
//
// **Derived, never cached.** A manifest updated whenever something was bought was
// considered and rejected - see the note at the top of the backend module. The sheet is
// the truth; this reads it.

import { readInventory } from './inventory';
import { readStash } from './cwnWeaponStash';
import { readRows as readCyberRows } from './cyberwareRows';
import { CWN_CYBERWARE } from './cwnCyberwarePresets';
import { CWN_WEAPONS } from './cwnWeaponPresets';
import { CWN_ARMOR } from './cwnArmorPresets';
import { CWN_GEAR } from './cwnGearPresets';
import { CWN_PHARMACEUTICALS } from './cwnPharma';
import { CWN_ARMOR_MODS, CWN_WEAPON_MODS } from './cwnGearMods';
import { VEHICLE_PRESETS } from './vehiclePresets';
import { VEHICLE_FITTINGS } from './vehicleFittings';
import { VEHICLE_WEAPONS } from './vehicleWeapons';
import { CWN_WEAPON_ROWS, CWN_VEHICLE_ROWS } from './templates/cities_without_number';
import type { ShopStock } from '../data/buildingTypes';

/** Where a thing lives, which decides how it is taken away again. */
export type OwnedSource = 'inventory' | 'weapon' | 'stash' | 'cyberware' | 'vehicle';

export interface OwnedAt {
  source: OwnedSource;
  qty: number;
  /** Inventory and stash rows: which entry in the array. */
  index?: number;
  /** Weapon and vehicle slots: which numbered slot. */
  slot?: number;
  /** Cyberware: whether it is currently installed in the body. */
  placed?: boolean;
  /** Vehicles: what the player called it, if anything. */
  named?: string;
}

export interface OwnedLine {
  key: string;
  /** Null for anything no catalogue carries. */
  catalogue: ShopStock | null;
  id: string | null;
  label: string;
  /** What one is worth on a shelf. Null where there is no book price. */
  unitPrice: number | null;
  qty: number;
  /** Every place one of these is sitting, so a sale knows what to empty. */
  at: OwnedAt[];
}

/**
 * Names are matched loosely, and deliberately so.
 *
 * A sheet's copy of a name has been through an import, a PDF, somebody's typing, or all
 * three, so "Heavy  Pistol" and "heavy pistol" have to find the same entry. Case and runs
 * of whitespace are the only things ignored; nothing fuzzier, because a wrong match here
 * offers to sell something the player does not own.
 */
export const normaliseName = (name: unknown): string =>
  String(name == null ? '' : name).trim().replace(/\s+/g, ' ').toLowerCase();

/**
 * Every catalogue, in the order the server builds its own lookup.
 *
 * The order is load-bearing: where two tables share a name, the first one wins, and both
 * sides have to pick the same one or a sale would price against a different entry than
 * the shelf showed.
 */
const CATALOGUES: { catalogue: ShopStock; rows: { id: string; label: string; price?: number }[] }[] = [
  { catalogue: 'cyberware', rows: CWN_CYBERWARE.map((c) => ({ id: c.id, label: c.name, price: c.price })) },
  { catalogue: 'weapons', rows: CWN_WEAPONS.map((w) => ({ id: w.id, label: w.name, price: w.price })) },
  { catalogue: 'armor', rows: CWN_ARMOR.map((a) => ({ id: a.id, label: a.label, price: a.cost })) },
  { catalogue: 'gear', rows: CWN_GEAR.map((g) => ({ id: g.id, label: g.label, price: g.cost })) },
  { catalogue: 'vehicles', rows: VEHICLE_PRESETS.map((v) => ({ id: v.id, label: v.label, price: v.cost })) },
  { catalogue: 'vehicle_fittings', rows: VEHICLE_FITTINGS.map((f) => ({ id: f.id, label: f.label, price: f.cost })) },
  { catalogue: 'vehicle_weapons', rows: VEHICLE_WEAPONS.map((w) => ({ id: w.id, label: w.label, price: w.cost })) },
  { catalogue: 'pharmaceuticals', rows: CWN_PHARMACEUTICALS.map((p) => ({ id: p.id, label: p.label, price: p.cost })) },
  { catalogue: 'armor_mods', rows: CWN_ARMOR_MODS.map((m) => ({ id: m.id, label: m.label, price: m.cost })) },
  { catalogue: 'weapon_mods', rows: CWN_WEAPON_MODS.map((m) => ({ id: m.id, label: m.label, price: m.cost })) },
];

interface Entry { catalogue: ShopStock; id: string; label: string; price: number }

const BY_ID = new Map<string, Entry>();
const BY_NAME = new Map<string, Entry>();
for (const { catalogue, rows } of CATALOGUES) {
  for (const row of rows) {
    // A line with no price is not sold and cannot be bought back.
    if (typeof row.price !== 'number' || !Number.isFinite(row.price)) continue;
    const entry: Entry = { catalogue, id: row.id, label: row.label, price: row.price };
    BY_ID.set(`${catalogue}/${row.id}`, entry);
    const key = normaliseName(row.label);
    if (key && !BY_NAME.has(key)) BY_NAME.set(key, entry);
  }
}

/** Which catalogue entry a thing on a sheet came from, or null for anything unrecognised. */
export const findByName = (name: unknown): { catalogue: ShopStock; id: string } | null => {
  const hit = BY_NAME.get(normaliseName(name));
  return hit ? { catalogue: hit.catalogue, id: hit.id } : null;
};

export const priceOf = (catalogue: ShopStock, id: string): number | null =>
  BY_ID.get(`${catalogue}/${id}`)?.price ?? null;

export const labelOf = (catalogue: ShopStock, id: string): string | null =>
  BY_ID.get(`${catalogue}/${id}`)?.label ?? null;

/** Add one owned thing to the tally, merging onto a line that is already there. */
const tally = (
  into: Map<string, OwnedLine>, name: unknown, source: OwnedSource, extra: Partial<OwnedAt> = {},
) => {
  const label = String(name ?? '').trim();
  if (!label) return;
  const hit = findByName(label);
  const key = hit ? `${hit.catalogue}/${hit.id}` : `?/${normaliseName(label)}`;
  const qty = Math.max(0, Math.floor(Number(extra.qty) || 1));
  if (qty <= 0) return;
  const existing = into.get(key);
  const line: OwnedLine = existing ?? {
    key,
    catalogue: hit ? hit.catalogue : null,
    id: hit ? hit.id : null,
    label: hit ? (labelOf(hit.catalogue, hit.id) ?? label) : label,
    unitPrice: hit ? priceOf(hit.catalogue, hit.id) : null,
    qty: 0,
    at: [],
  };
  line.qty += qty;
  line.at.push({ source, ...extra, qty } as OwnedAt);
  into.set(key, line);
};

/**
 * Everything this character owns, as lines a shop could put a price on.
 *
 * Four shapes, because a sheet genuinely stores these differently: inventory rows carry a
 * quantity, weapons and vehicles sit in numbered slots one apiece, and cyberware is a list
 * that may or may not be installed. Quantity is why they cannot simply be concatenated -
 * two slots holding the same gun is one line reading x2.
 */
export const ownedItems = (data: Record<string, unknown> | null | undefined): OwnedLine[] => {
  const sheet = data && typeof data === 'object' ? data : {};
  const lines = new Map<string, OwnedLine>();

  readInventory(sheet).forEach((item, index) => {
    // No carry state: selling takes a thing whether it is readied, stowed or in a
    // locker, and leaving it out keeps this identical to the server's reader.
    tally(lines, item.name, 'inventory', {
      index, qty: Math.max(1, Math.floor(Number(item.qty) || 1)),
    });
  });

  for (let i = 1; i <= CWN_WEAPON_ROWS; i += 1) {
    tally(lines, sheet[`weapon${i}_name`], 'weapon', { slot: i });
  }

  readStash(sheet).forEach((w, index) => tally(lines, w.name, 'stash', { index }));

  // Installed chrome sells too. Taking it out is surgery in the book, and the app does
  // not model that on the way out yet - deliberately, rather than by omission.
  readCyberRows(sheet).forEach((row, index) => {
    tally(lines, row.name, 'cyberware', { index, placed: !!row.placed });
  });

  // Keyed by type rather than by name: a vehicle somebody has called "Betty" is still a
  // Motorcycle and still worth what one is worth.
  for (let i = 1; i <= CWN_VEHICLE_ROWS; i += 1) {
    const typeId = String(sheet[`vehicle${i}_type`] ?? '').trim();
    const named = String(sheet[`vehicle${i}_name`] ?? '').trim();
    if (!typeId && !named) continue;
    const label = typeId ? labelOf('vehicles', typeId) : null;
    tally(lines, label || named, 'vehicle', { slot: i, named });
  }

  return [...lines.values()];
};

/** What this shop will take: only the catalogues it deals in, plus anything unpriced. */
export const sellableAt = (owned: OwnedLine[], catalogues: ShopStock[]): OwnedLine[] =>
  owned.filter((l) => l.catalogue === null || catalogues.includes(l.catalogue));
