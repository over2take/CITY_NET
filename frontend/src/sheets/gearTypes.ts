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
export interface TypeShown {
  id: string; label: string; one: string; columns: ColumnShown[];
  /** The kinds of shop that sell its lines (8a7a2), as the server works them out: the General Store where the GM said none. */
  sold_at?: string[];
  /** Its band on the GEAR tab (G1), as the server works it out: PACK where unsaid. */
  on_sheet?: 'equipped' | 'usable' | 'pack';
}
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

/**
 * The GEAR tab's bands (G2; approved mockup docs/mockups/sheet-gear-layout.html, layout A, 2026-11-20): EQUIPPED, USABLE and
 * PACK, each type's lines in its type's band (its ON THE SHEET, G1; PACK where unsaid), in hand first; and STASH, every line
 * left in the stash whatever its type. Within a band, a group per type that has lines. A line worn, attuned or installed
 * (`on`, by its place) is on you, so EQUIPPED whatever its type's band (the user, 2026-11-22: "my Cutlass is worn, should it
 * be in EQUIPPED?"); in the stash it is still the STASH's.
 */
export type GearBand = 'equipped' | 'usable' | 'pack' | 'stash';
export const GEAR_BANDS: { id: GearBand; label: string }[] = [
  { id: 'equipped', label: 'EQUIPPED' }, { id: 'usable', label: 'USABLE' }, { id: 'pack', label: 'PACK' }, { id: 'stash', label: 'STASH' },
];
export interface BandShown { band: GearBand; label: string; count: number; groups: { type: TypeShown; rows: TableRow[] }[]; loose: { type: TypeShown; row: TableRow }[] }
export const gearBands = (shown: ItemsShown | null | undefined, lines: InventoryItem[], on: (index: number) => boolean = () => false): BandShown[] => {
  const bands: BandShown[] = GEAR_BANDS.map((b) => ({ band: b.id, label: b.label, count: 0, groups: [], loose: [] }));
  const at = (id: GearBand) => bands.find((b) => b.band === id)!;
  const inHand = (r: TableRow) => (r.line.carry === 'readied' ? 0 : 1);
  const inOrder = (rows: TableRow[]) => rows.map((r, n) => ({ r, n })).sort((a, b) => inHand(a.r) - inHand(b.r) || a.n - b.n).map(({ r }) => r);
  for (const { type, rows } of gearTables(shown, lines)) {
    const home: GearBand = type.on_sheet === 'equipped' || type.on_sheet === 'usable' ? type.on_sheet : 'pack';
    const here = rows.filter((r) => r.line.carry !== 'stash');
    // Its type's band, and EQUIPPED for what is on you: a group each, in the system's order of types.
    const worn = here.filter((r) => on(r.index));
    const rest = here.filter((r) => !on(r.index));
    if (home === 'equipped') { if (here.length) at('equipped').groups.push({ type, rows: inOrder(here) }); }
    else {
      if (worn.length) at('equipped').groups.push({ type, rows: inOrder(worn) });
      if (rest.length) at(home).groups.push({ type, rows: inOrder(rest) });
    }
    for (const row of rows.filter((r) => r.line.carry === 'stash')) at('stash').loose.push({ type, row });
  }
  for (const b of bands) b.count = b.groups.reduce((n, g) => n + g.rows.length, 0) + b.loose.length;
  return bands;
};

/** A value as a box shows it. */
export const valueText = (v: Value | undefined): string => (v === undefined ? '' : String(v));

/**
 * The cells a compact line shows (8a3c1; approved mockup docs/mockups/gear-compact.html): only those it has, its own value
 * or its item's. A column with neither is one it doesn't have (no AMMO on a Cutlass), with no separate N/A to set.
 */
export const shownCells = (columns: LineColumns): Cell[] => columns.cells.filter((c) => c.value !== undefined);

/**
 * A COUNT on a line (8a4b): how many are left and the most it holds. Left is the line's own (`counts`, written by the
 * server's FIRE and RELOAD), held to 0 to the most, as many as it holds where unsaid: the server's lineColumns, mirrored.
 */
export const countOf = (line: InventoryItem, cell: Cell): { now: number; most: number } => {
  const most = typeof cell.value === 'number' ? cell.value : 0;
  const left = isObject(line.counts) ? line.counts[cell.column.id] : undefined;
  return { now: Number.isInteger(left) ? Math.max(0, Math.min(most, left as number)) : most, most };
};

/** A cell as words on its line: its value, with a NUMBER's unit; a COUNT as so many of so many ("4 / 6"). */
export const cellWords = (cell: Cell, line?: InventoryItem): string => {
  if (cell.column.kind === 'count' && line) { const { now, most } = countOf(line, cell); return `${now} / ${most}`; }
  return `${valueText(cell.value)}${cell.column.kind === 'number' && cell.column.unit ? ` ${cell.column.unit}` : ''}`;
};

/** What the server answers FIRE or RELOAD (sockets countAction): done, the carried lines to ask between, or why not. */
export type CountAnswer =
  | { ok: true; now: number; most: number }
  | { ok: false; ask: { line: number; name: string; qty: number }[] }
  | { ok: false; error: string };
/** FIRE (the column's button) or RELOAD, from the line named once asked. */
export type CountKind = 'spend' | 'reload';
/** A sheet's way to FIRE or RELOAD a line's COUNT: the server's answer, or null where none came. */
export type GearCount = (line: number, column: string, kind: CountKind, from?: number) => Promise<CountAnswer | null>;

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
