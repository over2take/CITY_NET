// The catalogues a GM uploaded, as the window sees them.
//
// Mirrored from backend/shops/catalogueStore.js, which is what actually prices a purchase.
// This exists so the shelves and the SELL tab can SHOW what the server would sell - a shop
// that charges correctly for something it never lists is not much of a shop.
//
// The merge rules are the server's, and the asymmetry between them is deliberate there and
// copied here rather than reasoned out again:
//
//   priceOf    - uploaded first. A GM typing "Heavy Pistol, 250" is house-ruling a price.
//   findByName - the book first. A character carrying a Heavy Pistol bought before any
//                upload is still carrying the book's.
//
// Held in a module-level registry rather than React state because `ownedItems` is a plain
// function called from several places, and threading a context through all of them would
// buy nothing - there is one set of catalogues for one running game.

import type { ShopStock } from '../data/buildingTypes';

export interface UploadedEntry {
  id: string;
  name: string;
  price: number;
  /** What this item writes onto a sheet when bought. Keys are sheet field suffixes. */
  fields: Record<string, string>;
}

/** catalogue -> id -> entry. Replaced wholesale whenever the server sends a new set. */
let uploaded: Partial<Record<ShopStock, Record<string, UploadedEntry>>> = {};

/** Bumped on every load, so a hook can re-render without diffing the catalogues. */
let revision = 0;

/** Everything the server says a GM has uploaded, replacing whatever was held before. */
export const loadUploaded = (
  sections: Partial<Record<ShopStock, UploadedEntry[]>> | null | undefined,
): void => {
  const next: typeof uploaded = {};
  for (const [catalogue, entries] of Object.entries(sections ?? {})) {
    const table: Record<string, UploadedEntry> = {};
    for (const entry of entries ?? []) {
      if (!entry || !entry.id) continue;
      table[entry.id] = {
        id: entry.id,
        name: String(entry.name ?? ''),
        price: Number(entry.price) || 0,
        fields: entry.fields && typeof entry.fields === 'object' ? { ...entry.fields } : {},
      };
    }
    next[catalogue as ShopStock] = table;
  }
  uploaded = next;
  revision += 1;
};

export const clearUploaded = (): void => { uploaded = {}; revision += 1; };

/** Changes whenever the catalogues do, so a component can depend on it. */
export const uploadedRevision = (): number => revision;

/** The uploaded entries in one catalogue. */
export const uploadedIn = (catalogue: ShopStock): UploadedEntry[] =>
  Object.values(uploaded[catalogue] ?? {});

export const uploadedEntry = (
  catalogue: ShopStock, id: string,
): UploadedEntry | undefined => uploaded[catalogue]?.[id];

/** Whether anything at all has been uploaded, for deciding whether to say so. */
export const anyUploaded = (): boolean =>
  Object.values(uploaded).some((table) => Object.keys(table ?? {}).length > 0);
