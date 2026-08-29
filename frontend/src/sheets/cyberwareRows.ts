// A character's installed chrome, as the sheet stores it.
//
// Mirrored from `backend/sheets/cyberware.js`, the same way the vehicle seat ids are: the
// server owns the shape, this owns how it is drawn. Kept deliberately small so the two
// staying in step is a matter of reading twenty lines rather than trusting a comment.
//
// One array under one field rather than numbered fields. Numbered fields need a maximum
// decided up front, which is a limit invented for the storage rather than for the game.

import { typeById, describe as describeType, looksLike, type Side } from './cyberwareLocations';

/** The sheet field holding the array. */
export const CYBERWARE_FIELD = 'cyberware';

/**
 * Concealment ratings, easiest to hardest to detect.
 *
 * Stored as these ids rather than the printed words, so relabelling never rewrites a
 * saved sheet. Mirrors CONC_VALUES in backend/sheets/cyberware.js.
 */
export type Conc = '' | 'obvious' | 'sight' | 'touch' | 'medical';

export const CONC_VALUES: Exclude<Conc, ''>[] = ['obvious', 'sight', 'touch', 'medical'];

export const CONC_LABEL: Record<Exclude<Conc, ''>, string> = {
  obvious: 'Obvious',
  sight: 'Sight',
  touch: 'Touch',
  medical: 'Medical',
};

/**
 * What a modifier changes, and whether it adjusts the value or replaces it.
 *
 * The Companion holds these in five buckets — `modifyStatsBy`, `setStatsTo`,
 * `modifySkillsBy`, `setSkillTo`, `modifyRollTypesBy` — flattened on import. Adjusting and
 * setting stay apart: +3 Cool and "Cool becomes 3" are different claims.
 */
export type ModKind = 'stat' | 'statSet' | 'skill' | 'skillSet' | 'roll' | 'note';

export const MOD_KINDS: ModKind[] = ['stat', 'statSet', 'skill', 'skillSet', 'roll', 'note'];

/**
 * A note is a labelled number the app never applies — "Quickhack DV 10".
 *
 * Some chrome does something the sheet has no field for and no dice to roll. Buried in the
 * effect text it gets missed; as a modifier it is a chip the GM and the table can see.
 * Kept apart from the mechanical kinds so nothing tries to apply it and nothing reports it
 * as a target that failed to match.
 */
export const isNoteKind = (kind: ModKind): boolean => kind === 'note';

/** What each kind is called where a player picks one. */
export const MOD_KIND_LABEL: Record<ModKind, string> = {
  stat: 'Modify Stat By',
  statSet: 'Set Stat To',
  skill: 'Modify Skill By',
  skillSet: 'Set Skill To',
  roll: 'Modify Roll Type By',
  note: 'Note (not applied)',
};

/** Whether a kind adjusts the existing value or replaces it, which is how it is shown. */
export const isSetKind = (kind: ModKind): boolean => kind === 'statSet' || kind === 'skillSet';

export interface CyberMod {
  kind: ModKind;
  /** A stat, skill or roll-type name — free text, since the lists differ per system. */
  target: string;
  value: number;
}

/**
 * A modifier as a short label: `+6 Business`, or `Cool = 3` when it sets rather than adds.
 *
 * The sign is explicit on adjustments because a modifier of -2 and one of +2 differ only
 * by that character, and a bare `2` reads as neither.
 */
export const describeMod = (mod: CyberMod): string => {
  // A note is neither an adjustment nor a replacement, so it gets no sign and no equals:
  // "Quickhack DV 10" is the whole statement.
  if (isNoteKind(mod.kind)) return `${mod.target} ${mod.value}`;
  return isSetKind(mod.kind)
    ? `${mod.target} = ${mod.value}`
    : `${mod.value >= 0 ? '+' : ''}${mod.value} ${mod.target}`;
};

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
  /**
   * How hard the piece is to spot: '' where the system does not rate it.
   *
   * Cities Without Number gives every implant one of four ratings; Cyberpunk RED rates
   * none, so a CP:R row leaves this blank rather than claiming a value it never had.
   */
  conc: Conc;
  /** What it does. */
  data: string;
  /**
   * Whether it is currently installed and working.
   *
   * A piece can be owned but switched off, and the Companion export says which. Only an
   * equipped piece's modifiers reach the sheet — otherwise taking chrome offline would
   * change nothing, which is the opposite of what the flag means.
   */
  equipped: boolean;
  /**
   * Whether it has been put in the body, as opposed to merely owned.
   *
   * Its own fact rather than something read off the type. Saying a piece is a Cybereye and
   * putting it in an eye are two decisions, and inferring the second from the first made
   * naming a type install the piece on the spot.
   */
  placed: boolean;
  /**
   * The mechanical effects, when there are any.
   *
   * The one part of an import that carries real mechanics: descriptions arrive blank
   * because the Companion renders flavour text from its own catalogue, but a modifier is
   * something the player typed, so it comes across intact.
   */
  mods: CyberMod[];
}

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

/**
 * Whatever was handed over, as well-formed modifiers.
 *
 * A modifier with no target is dropped — it can be neither shown nor applied — but a
 * value of 0 is kept, since a player can park one at zero while they decide.
 */
export function normaliseMods(raw: unknown): CyberMod[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((m): m is Record<string, unknown> => Boolean(m) && typeof m === 'object')
    .map((m) => ({
      kind: MOD_KINDS.includes(m.kind as ModKind) ? (m.kind as ModKind) : 'stat',
      target: String(m.target ?? '').trim(),
      value: num(m.value),
    }))
    .filter((m) => m.target);
}

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
    // Blank on a system that does not rate concealment, and on any row saved before the
    // column existed. Unknown is not the same as the easiest thing to hide.
    conc: (CONC_VALUES as string[]).includes(r.conc as string) ? (r.conc as Conc) : '',
    data: typeof r.data === 'string' ? r.data : '',
    // Installed unless it says otherwise, so rows stored before this field existed do not
    // all switch themselves off.
    equipped: r.equipped !== false,
    // Rows written before placement was recorded have no opinion, and defaulting those to
    // false would uninstall chrome nobody touched. Placement used to be inferred exactly
    // the old way, so that rule is kept for exactly the rows stored under it.
    placed: typeof r.placed === 'boolean'
      ? r.placed
      : Boolean(r.type) && (!typeById(String(r.type))?.paired || Boolean(r.side)),
    mods: normaliseMods(r.mods),
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
  // Placed, not merely typed: a piece marked Fashionware that nobody has fitted belongs in
  // the waiting list, not hanging off the diagram.
  return rows.filter((r) => r.placed && r.type === typeId && (!t?.paired || r.side === side));
}

/**
 * Whether a row still needs somewhere to go.
 *
 * Placement is stored, not deduced. Naming a type says what a piece is and makes it rank
 * as a match when you press + on a matching body part; it does not fit the piece. That
 * only happens on the diagram, which is the one place that knows where things go.
 */
export const needsPlacing = (row: CyberRow): boolean => !row.placed;

/**
 * How well a piece suits a panel, for ordering the chooser: 2 says so, 1 hints, 0 neither.
 *
 * Two signals of very different strength. A row that already carries the panel's type has
 * been *told* what it is — by an import, or by someone filling in the form — and only
 * wants a side; that is not a guess and it ranks above everything. A row with no type at
 * all falls back to reading its name, which is a hint and nothing more.
 *
 * A row typed as something else scores nothing, whatever it is called: the type is the
 * answer, so a Cyberarm named "Leg Booster" does not belong in a leg.
 */
export const panelRank = (row: CyberRow, typeId: string): number => {
  if (row.type) return row.type === typeId ? 2 : 0;
  return looksLike(typeId, row.name) ? 1 : 0;
};

/** Everything that has not been given a place yet, which is how every import arrives. */
export const unfiledRows = (rows: CyberRow[]): CyberRow[] => rows.filter(needsPlacing);
