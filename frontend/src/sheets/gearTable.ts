// A type's gear as a table (8e2a; approved mockup docs/mockups/gear-table.html, answered 2026-11-25): heads once, each line
// a row, every DAMAGE column under one DAMAGE head, a button each. What fits the width stays in the row; the rest folds
// under it, named, as today's line names it: words (TEXT) always in a narrow width, and a COUNT that reloads, which says
// what is carried to reload it from beside it. In a wide width every column has its own head. Measured, not by window, so
// SHEET.EXE and the CHARACTER_SHEET tab are the one table. Pure; GearTypeTables draws it.

import type { ColumnShown, TypeShown } from './gearTypes';
import type { InventoryItem } from './inventory';

/** At or past this width every column has its head: the CHARACTER_SHEET tab's, not SHEET.EXE's. */
export const WIDE_AT = 620;
/** The name's cell: what is left for the columns once it has this. */
export const NAME_ROOM = 150;

/** About how much room a column's cell takes in the row, by its kind: a short number, a button, a group of buttons. */
export const roomOf = (c: ColumnShown, damages: number): number => {
  if (c.kind === 'damage') return damages > 1 ? 160 : 110;
  if (c.kind === 'dice') return 80;
  if (c.kind === 'count') return 120;
  if (c.kind === 'pick') return 80;
  if (c.kind === 'number') return 70;
  return 140;
};

/** A head of the table: one column, or every DAMAGE column together under one. */
export type Head = { key: string; label: string; columns: ColumnShown[]; damage: boolean };

/**
 * The heads of a type's table and what folds under each row, for `width` (0, not measured, is narrow). In the columns'
 * order; the DAMAGE head where the first DAMAGE column is. A narrow width keeps the row's cells while they fit, never a TEXT
 * column nor a COUNT that reloads; a wide one keeps them all.
 */
export const tablePlan = (type: TypeShown, width: number): { heads: Head[]; folded: ColumnShown[]; wide: boolean } => {
  const wide = width >= WIDE_AT;
  const damages = type.columns.filter((c) => c.kind === 'damage');
  const all: Head[] = [];
  for (const c of type.columns) {
    if (c.kind === 'damage') {
      if (c === damages[0]) all.push({ key: 'damage', label: damages.length > 1 ? 'DAMAGE' : c.label.toUpperCase(), columns: damages, damage: true });
      continue;
    }
    all.push({ key: c.id, label: c.label.toUpperCase(), columns: [c], damage: false });
  }
  if (wide) return { heads: all, folded: [], wide };
  let room = Math.max(0, width - NAME_ROOM);
  const heads: Head[] = [];
  const folded: ColumnShown[] = [];
  for (const h of all) {
    const c = h.columns[0];
    const words = !h.damage && (c.kind === 'text' || (c.kind === 'count' && (c.reload?.length ?? 0) > 0));
    const need = roomOf(c, damages.length);
    // The first that won't fit folds, and the rest after it, so the row never skips one to fit a later one.
    if (words || need > room || folded.length) { folded.push(...h.columns); continue; }
    room -= need;
    heads.push(h);
  }
  return { heads, folded, wide };
};

export type TablePlan = ReturnType<typeof tablePlan>;

/** The table's columns: the name's, then each head's, words given room to wrap, the rest as wide as their cells. */
export const gridTemplate = (plan: TablePlan): string =>
  ['minmax(110px, 1fr)', ...plan.heads.map((h) => (!h.damage && h.columns[0].kind === 'text' ? 'minmax(0, 1.2fr)' : 'auto'))].join(' ');

const key = (name: unknown) => (typeof name === 'string' ? name.trim().toLowerCase() : '');
const carried = (line: InventoryItem) => line.carry === 'readied' || line.carry === 'stowed';

/**
 * What is carried to reload a COUNT from (8e2a; the user, 2026-11-25: "a weapon may only hold 20 but the player could have
 * 800"): each item it reloads from, with how many are carried, as RELOAD finds them (backend gearCounts.js): every other
 * line of that name, carried (readied or stowed, not in the stash), its quantity added.
 */
export const reserveOf = (items: InventoryItem[], reload: string[], index: number): { name: string; qty: number }[] =>
  reload.map((name) => ({
    name,
    qty: items.reduce((n, line, i) => (i !== index && carried(line) && key(line.name) === key(name) ? n + Math.max(1, Math.floor(Number(line.qty)) || 1) : n), 0),
  }));

/** The reserve said beside the COUNT: "ARROWS ×800 CARRIED", several joined, "NONE CARRIED" where there is none. */
export const reserveWords = (reserve: { name: string; qty: number }[]): string => {
  const some = reserve.filter((r) => r.qty > 0);
  return some.length ? `${some.map((r) => `${r.name.toUpperCase()} ×${r.qty}`).join(' · ')} CARRIED` : 'NONE CARRIED';
};
