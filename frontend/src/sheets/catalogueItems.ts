// A system's items in the shops' catalogues (7e3c; approved with the items mockup, docs/mockups/items.html, the user's
// "perfect" of 2026-11-10). A catalogue line named as an item is that item once bought (a gear line of its name, items.js),
// so CATALOGUES.EXE's preview says which lines are items and which only nearly are, and a download starts a catalogue
// from the system's items, each price left for the GM to fill in.
//
// The preview's rows are the server's own reading (the same parser as SAVE); this only reads them against the items.
// Pure, so CatalogueWindow only draws.

import type { ShopStock } from '../data/buildingTypes';
import { CATALOGUES, catalogueOn } from '../data/buildingTypes';
import { columnsFor, writeCatalogueFile } from './catalogueSchema';
import type { ItemsShown } from './gearItems';

/** A row as the preview sends it back (backend shops/catalogueParse.js). */
export interface PreviewRow { name: string; line?: number }

/** A line named as an item: bought, it is that item, where it lands in the gear. */
export interface ItemLine { catalogue: string; name: string; item: string; lands: boolean; line?: number }
/** A line that is nearly an item's name: bought, it is not. */
export interface NearLine { catalogue: string; name: string; item: string; line?: number }

/** As a gear line is matched to an item (backend items.js carriedIn): trimmed, in any case. */
const same = (a: string) => a.trim().toLowerCase();
/** Letters and digits only, for what nearly matches: "Ring-of-Might" and "Ring of Might." are near. */
const bare = (a: string) => a.toLowerCase().replace(/[^a-z0-9]/g, '');

/** How many letters apart two words are (adding, removing or changing one is one). */
export const distance = (a: string, b: string): number => {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    const row = [i];
    for (let j = 1; j <= b.length; j += 1) row.push(Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)));
    prev = row;
  }
  return prev[b.length];
};

/** Whether a name is nearly an item's: the same but for spaces and marks, or a letter or two off (one for a short name). */
const near = (name: string, label: string) => {
  const n = bare(name);
  const l = bare(label);
  if (!n || !l) return false;
  return n === l || distance(n, l) <= (l.length >= 8 ? 2 : 1);
};

/** Whether a catalogue's lines land as gear lines (an inventory line), where an item is worn from. */
export const landsAsGear = (system: string, catalogue: string) => columnsFor(system, catalogue as ShopStock).shape === 'inventory';

/**
 * The preview's rows read against the system's items: those named as one (with whether they land as gear, where an item
 * is worn from), and those that nearly are (the closest item named). Nothing without items.
 */
export const itemsInPreview = (
  system: string, items: ItemsShown | undefined, sections: Record<string, PreviewRow[]> | undefined,
): { matched: ItemLine[]; near: NearLine[] } => {
  const list = (items?.list ?? []).filter((i) => i.label.trim());
  const matched: ItemLine[] = [];
  const nearly: NearLine[] = [];
  if (!list.length) return { matched, near: nearly };
  for (const [catalogue, rows] of Object.entries(sections ?? {})) {
    for (const row of rows ?? []) {
      if (typeof row?.name !== 'string') continue;
      const line = Number.isInteger(row.line) ? { line: row.line } : {};
      const exact = list.find((i) => same(i.label) === same(row.name));
      if (exact) { matched.push({ catalogue, name: row.name, item: exact.label, lands: landsAsGear(system, catalogue), ...line }); continue; }
      const close = list.filter((i) => near(row.name, i.label))
        .sort((a, b) => distance(bare(row.name), bare(a.label)) - distance(bare(row.name), bare(b.label)))[0];
      if (close) nearly.push({ catalogue, name: row.name, item: close.label, ...line });
    }
  }
  return { matched, near: nearly };
};

/** The catalogue a starter file puts the items in: the gear's if this game sells it as gear lines, or the first that does. */
export const itemsShelf = (system: string): ShopStock | null => {
  const on = CATALOGUES.map((c) => c.id).filter((c) => catalogueOn(system, c) && landsAsGear(system, c));
  return on.includes('gear') ? 'gear' : on[0] ?? null;
};

/** A starter catalogue of the system's items: each a row of its name and words, its price left to fill in. Null with none. */
export const itemsCatalogue = (system: string, items: ItemsShown | undefined): string | null => {
  const list = (items?.list ?? []).filter((i) => i.label.trim());
  const shelf = itemsShelf(system);
  if (!list.length || !shelf) return null;
  return writeCatalogueFile(
    system,
    () => list.map((i) => ({ values: { name: i.label.trim(), price: '', ...(i.description ? { description: i.description } : {}) } })),
    [shelf],
    [
      "Your system's items, to sell in its shops. Fill in each price, then upload this.",
      'A row without a price is left out, so nothing is sold free by mistake.',
      '',
      "Keep each name as it is: a line named as an item is that item once bought, ready to WEAR and ATTUNE.",
    ],
  );
};
