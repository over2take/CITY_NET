// A character's installed chrome, as the sheet stores it.
//
// Mirrored from `backend/sheets/cyberware.js`, the same way the vehicle seat ids are: the
// server owns the shape, this owns how it is drawn. Kept deliberately small so the two
// staying in step is a matter of reading twenty lines rather than trusting a comment.
//
// One array under one field rather than numbered fields. Numbered fields need a maximum
// decided up front, which is a limit invented for the storage rather than for the game.

import { typeById, describe as describeType, type Side } from './cyberwareLocations';

/** The sheet field holding the array. */
export const CYBERWARE_FIELD = 'cyberware';

export interface CyberRow {
  name: string;
  /** A type id, or '' for a piece nobody has filed yet. */
  type: string;
  side: Side;
  /** Humanity loss. Always a number: an import states it, so 0 means zero. */
  hl: number;
  /**
   * Price in eddies, or null when nobody wrote it down.
   *
   * Blank rather than 0 on purpose. Humanity loss can default to zero because an import
   * always carries it, but eddies appear nowhere in an export, and a column of zeroes
   * hides the difference between free and unknown.
   */
  cost: number | null;
  /** What it does. */
  data: string;
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/** A row with every field present, whatever it was handed. */
export function normaliseRow(raw: unknown): CyberRow {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  // Number(null) is 0 and Number('') is 0, so an unpriced piece would arrive costing
  // nothing — and then sort as the cheapest thing on the sheet. Absent has to be checked
  // before the conversion, not after it.
  const cost = r.cost === null || r.cost === undefined || r.cost === ''
    ? null
    : Number(r.cost);
  return {
    name: typeof r.name === 'string' ? r.name : '',
    type: typeof r.type === 'string' ? r.type : '',
    side: r.side === 'l' || r.side === 'r' ? r.side : null,
    hl: num(r.hl),
    cost: cost !== null && Number.isFinite(cost) ? cost : null,
    data: typeof r.data === 'string' ? r.data : '',
  };
}

/**
 * Whatever the sheet holds, as rows.
 *
 * Defensive because the field is free-form JSON on a sheet people import into and edit by
 * hand: it may be missing, a string, or an array with holes. A window that throws on a
 * malformed sheet is worse than one that shows an empty list.
 */
export function readRows(data: Record<string, unknown> | undefined | null): CyberRow[] {
  const value = data?.[CYBERWARE_FIELD];
  if (!Array.isArray(value)) return [];
  return value.filter((r) => r && typeof r === 'object').map(normaliseRow);
}

/** What the chrome has cost, for showing beside Humanity. */
export const totalHumanityLoss = (rows: CyberRow[]): number =>
  rows.reduce((sum, r) => sum + num(r.hl), 0);

/** What it cost in money, ignoring anything nobody priced. */
export const totalCost = (rows: CyberRow[]): number =>
  rows.reduce((sum, r) => sum + (r.cost ?? 0), 0);

/** `Cyberarm R`, or `Unfiled` for a row that has not been placed yet. */
export const rowLocation = (row: CyberRow): string =>
  (row.type ? describeType(row.type, row.side) : 'Unfiled');

/** Rows for one panel of the diagram: same type, and same side when the type is paired. */
export function rowsForPanel(rows: CyberRow[], typeId: string, side: Side): CyberRow[] {
  const t = typeById(typeId);
  return rows.filter((r) => r.type === typeId && (!t?.paired || r.side === side));
}

/** Everything that has not been given a place yet, which is how every import arrives. */
export const unfiledRows = (rows: CyberRow[]): CyberRow[] => rows.filter((r) => !r.type);
