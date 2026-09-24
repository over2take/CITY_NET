// Where each game system's sheet keeps weapons and vehicles.
//
// **Read out of the sheet templates, never written down.** A Cities Without Number sheet has
// six weapon rows of ten fields; a Cyberpunk RED sheet has four, of name/dmg/skill/rof; a
// Shadowrun sheet has four of name/dv/ar/skill/mode/atk and no vehicles at all; generic has
// neither. Buying something has to write into exactly the right one of those, and selling it
// has to clear exactly the right one - so the shape comes from the template that draws the
// sheet, and cannot disagree with it.
//
// Writing it down by hand had already gone wrong once, for CWN alone. The sale code's list
// of vehicle fields cleared mount columns the sheet does not have (range, mag, notes) and
// missed the ones it does (type, skill, atk) along with the vehicle's fittings, so selling a
// car left half of it behind. Its test compared the result against the same hand-written
// list, and passed.
//
// Mirrored to backend/shops/sheetSlots.js, which is what the server empties on a sale, and
// compared entry for entry by a test.

import { getTemplate } from './index';

/** The row groups a shop can put things into. Spells are rows too, but nothing sells one. */
export const SLOT_GROUPS = ['weapon', 'vehicle'] as const;
export type SlotGroup = typeof SLOT_GROUPS[number];

export interface Slots {
  /** How many rows of this group the sheet has. */
  rows: number;
  /**
   * Every field one row owns, as the part after `<group><n>_`.
   *
   * Nested ones included - a CWN vehicle's mounted guns are `weapon1_dmg` and so on under
   * `vehicle1_` - because clearing a row has to take everything in it.
   */
  fields: string[];
}

/** Every field id a system's template declares, in the order it declares them. */
export const templateFieldIds = (system: string): string[] => {
  const ids: string[] = [];
  const walk = (node: unknown): void => {
    if (!node) return;
    if (Array.isArray(node)) { node.forEach(walk); return; }
    if (typeof node === 'object') {
      const o = node as Record<string, unknown>;
      if (typeof o.id === 'string') ids.push(o.id);
      Object.values(o).forEach(walk);
    }
  };
  walk(getTemplate(system) as unknown);
  return ids;
};

/**
 * The weapon and vehicle rows a system's sheet has.
 *
 * A group the sheet does not have is simply absent, so "can this system hold a vehicle" is
 * `'vehicle' in slotsOf(system)` rather than a separate list somebody has to keep in step.
 */
export const slotsOf = (system: string): Partial<Record<SlotGroup, Slots>> => {
  const ids = templateFieldIds(system);
  const out: Partial<Record<SlotGroup, Slots>> = {};

  for (const group of SLOT_GROUPS) {
    // The row count is the highest numbered name field. Every row has a name, so it is the
    // one field guaranteed to exist once per row.
    let rows = 0;
    for (const id of ids) {
      const m = new RegExp(`^${group}(\\d+)_name$`).exec(id);
      if (m) rows = Math.max(rows, Number(m[1]));
    }
    if (!rows) continue;

    // Row 1 defines the shape; the rest are copies of it.
    const prefix = `${group}1_`;
    const fields: string[] = [];
    for (const id of ids) {
      if (!id.startsWith(prefix)) continue;
      const suffix = id.slice(prefix.length);
      if (!fields.includes(suffix)) fields.push(suffix);
    }
    out[group] = { rows, fields };
  }
  return out;
};

/** Every sheet field row `n` of a group owns, for emptying it. */
export const rowFields = (system: string, group: SlotGroup, n: number): string[] =>
  (slotsOf(system)[group]?.fields ?? []).map((f) => `${group}${n}_${f}`);
