// A custom system's gear as a table per item type (8a3a; approved mockup docs/mockups/item-types.html, 2026-11-14). The
// types come in the render copy (backend itemTypes.js typesShown); each line of the inventory is one: the type it says,
// else the type of the item of its name (as 7e matches by name), else the first. Its columns are its own values, else
// its item's, where the item is of the same type: the server's lineColumns (backend itemTypes.js), mirrored. A line
// made by hand ("a stick, 1d4") says its type and fills its own. Pure, so the table only draws.

import type { InventoryItem } from './inventory';
import type { ItemsShown, ItemShown } from './gearItems';

export type ColumnKind = 'number' | 'text' | 'damage' | 'dice' | 'count' | 'pick';
/** A column as the render copy says it: its name and kind, with a NUMBER's unit, PICK ONE's words, a COUNT's button. */
export interface ColumnShown { id: string; label: string; kind: ColumnKind; unit?: string; options?: string[]; button?: string; refill?: string; reload?: string[] }
/** A type as the render copy says it: its name, what one is called, its columns. */
export interface TypeShown { id: string; label: string; one: string; columns: ColumnShown[] }
export type Value = string | number;

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const KINDS = ['number', 'text', 'damage', 'dice', 'count', 'pick'];
/** The most a COUNT holds, and the longest words, as the server's limits. */
export const LIMITS = { count: 1000, text: 200 };

/** The system's types, those well formed enough to draw; none where the render copy has none. */
export const typesOf = (shown: ItemsShown | null | undefined): TypeShown[] =>
  (Array.isArray(shown?.types) ? shown!.types : []).filter((t): t is TypeShown => isObject(t) && typeof t.id === 'string' && Array.isArray(t.columns))
    .map((t) => ({ ...t, label: t.label || t.id, one: t.one || t.label || t.id,
      columns: t.columns.filter((c): c is ColumnShown => isObject(c) && typeof c.id === 'string' && KINDS.includes(c.kind)) }));

/** Whether a value fits its column. Dice are any words here: the server says when one reads a name it hasn't. */
export const fits = (column: ColumnShown, v: unknown): v is Value => {
  switch (column.kind) {
    case 'number': return typeof v === 'number' && Number.isFinite(v);
    case 'text': return typeof v === 'string' && v.length <= LIMITS.text;
    case 'damage': case 'dice': return typeof v === 'string' && !!v.trim() && v.length <= LIMITS.text;
    case 'count': return Number.isInteger(v) && (v as number) >= 0 && (v as number) <= LIMITS.count;
    case 'pick': return typeof v === 'string' && (column.options ?? []).includes(v);
    default: return false;
  }
};

const key = (name: string) => name.trim().toLowerCase();
/** The system's item a line is named like, or none. */
export const itemOfLine = (shown: ItemsShown | null | undefined, line: InventoryItem): ItemShown | undefined =>
  (shown?.list ?? []).find((i) => key(i.label || i.id) === key(line.name));

/** One column of a line: its own value, its item's, and the one that counts (its own where it fits). */
export interface Cell { column: ColumnShown; own?: Value; given?: Value; value?: Value }
/** A line's type, the item it is named like, and its cells in its type's order. */
export interface LineColumns { type: TypeShown; item?: ItemShown; cells: Cell[] }

/** A line's type and columns. Null where the system has no types. */
export const lineColumns = (shown: ItemsShown | null | undefined, line: InventoryItem): LineColumns | null => {
  const types = typesOf(shown);
  if (!types.length) return null;
  const item = itemOfLine(shown, line);
  const type = types.find((t) => t.id === line.type) ?? (item ? types.find((t) => t.id === item.type) : undefined) ?? types[0];
  const own = isObject(line.values) ? line.values : {};
  // An item's values count only on a line of its own type: made a WEAPON, the Pistol Rounds keep none.
  const given = item && (types.find((t) => t.id === item.type) ?? types[0]).id === type.id && isObject(item.values) ? item.values : {};
  return {
    type, ...(item ? { item } : {}),
    cells: type.columns.map((column) => {
      const o = fits(column, own[column.id]) ? own[column.id] as Value : undefined;
      const g = fits(column, given[column.id]) ? given[column.id] as Value : undefined;
      const value = o ?? g;
      return { column, ...(o !== undefined ? { own: o } : {}), ...(g !== undefined ? { given: g } : {}), ...(value !== undefined ? { value } : {}) };
    }),
  };
};

/** One line in its table: where it is in the inventory, and its columns. */
export interface TableRow { index: number; line: InventoryItem; columns: LineColumns }
/** The gear as a table per type, in the system's order, every type there even with no lines. Empty where it has none. */
export const gearTables = (shown: ItemsShown | null | undefined, lines: InventoryItem[]): { type: TypeShown; rows: TableRow[] }[] => {
  const tables = typesOf(shown).map((type) => ({ type, rows: [] as TableRow[] }));
  lines.forEach((line, index) => {
    const columns = lineColumns(shown, line);
    if (columns) tables.find((t) => t.type.id === columns.type.id)!.rows.push({ index, line, columns });
  });
  return tables;
};

/** A value as a box shows it. */
export const valueText = (v: Value | undefined): string => (v === undefined ? '' : String(v));

/**
 * The cells a compact line shows (8a3c1; approved mockup docs/mockups/gear-compact.html): only those it has, its own value
 * or its item's. A column with neither is one it doesn't have (no AMMO on a Cutlass), with no separate N/A to set.
 */
export const shownCells = (columns: LineColumns): Cell[] => columns.cells.filter((c) => c.value !== undefined);

/** A cell as words on its line: its value, with a NUMBER's unit. */
export const cellWords = (cell: Cell): string =>
  `${valueText(cell.value)}${cell.column.kind === 'number' && cell.column.unit ? ` ${cell.column.unit}` : ''}`;

/**
 * A line with one of its own values as typed: blank takes it away (its item's shows again); a NUMBER a number, a COUNT
 * whole from 0 to the most; anything that doesn't read as its kind leaves the line as it was.
 */
export const withLineValue = (line: InventoryItem, column: ColumnShown, typed: string): InventoryItem => {
  const values: Record<string, Value> = { ...(isObject(line.values) ? line.values as Record<string, Value> : {}) };
  if (!typed.trim()) delete values[column.id];
  else if (column.kind === 'number' || column.kind === 'count') {
    const n = Number(typed);
    if (!Number.isFinite(n)) return line;
    values[column.id] = column.kind === 'count' ? Math.min(LIMITS.count, Math.max(0, Math.trunc(n))) : n;
  } else values[column.id] = typed.slice(0, LIMITS.text);
  const next: InventoryItem = { ...line, values };
  if (!Object.keys(values).length) delete next.values;
  return next;
};

/** A new line of a type, made by hand: one of it, stowed, its type said. */
export const newLineOf = (type: TypeShown): InventoryItem => ({ name: '', qty: 1, enc: '', bundled: false, carry: 'stowed', location: '', type: type.id });
