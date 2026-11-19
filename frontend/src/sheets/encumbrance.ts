// The builder's ENCUMBRANCE as logic (8a5c; approved mockup docs/mockups/item-types.html, 2026-11-14, decision 7): what
// a character carries counted by a NUMBER column of the item types (COUNTED BY), its unit, CAN CARRY a formula, and
// bands as words at a share of it, the GM's to name and place (the user, 2026-11-18). Shown, never enforced. Read from
// the definition and written back; the server checks it (backend systemBuilder/encumbrance.js) and these mirror its
// limits. What it gives formulas to read, and what is worn summed by column (8a5b), are here too, for INSERT.

import type { Definition } from './systemsApi';
import { itemTypes, ownTypes } from './itemTypes';

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

export interface Band { word: string; upto: number; says?: string; condition?: string }
export interface Encumbrance { column: string; unit?: string; capacity?: string; bands?: Band[]; past?: string; past_says?: string; past_condition?: string }

/** As the server's (encumbrance.js). */
export const LIMITS = { bands: 5, upto: 1000, word: 30, unit: 12 };
/** The bands it starts with (8a5c): the mockup's, each the GM's to change or take away. */
export const START_BANDS: Band[] = [{ word: 'LIGHT', upto: 50 }, { word: 'ENCUMBERED', upto: 100 }];
export const START_PAST = 'OVERLOADED';

const itemsPart = (def: Definition): Obj => (isObject(def.items) ? def.items : {});

/** The system's encumbrance, where it counts one. */
export const encumbranceOf = (def: Definition): Encumbrance | null => {
  const e = itemsPart(def).encumbrance;
  if (!isObject(e) || typeof e.column !== 'string') return null;
  return {
    ...(e as Obj), column: e.column,
    // What a band means and its condition (8a5d1) kept as they are: their boxes come in 8a5d2.
    ...(Array.isArray(e.bands) ? { bands: e.bands.filter(isObject).map((b) => ({ ...b, word: typeof b.word === 'string' ? b.word : '', upto: Number(b.upto) }) as Band) } : {}),
  } as Encumbrance;
};

/** The definition with this encumbrance, or none. Whatever else the items hold is kept as it is. */
export const withEncumbrance = (def: Definition, e: Encumbrance | null): Definition => {
  const rest: Obj = { ...itemsPart(def) };
  delete rest.encumbrance;
  const part = e ? { ...rest, encumbrance: tidy(e) } : rest;
  const next: Definition = { ...def };
  if (Object.keys(part).length) next.items = part; else delete next.items;
  return next;
};

/** Only what it says: a blank unit or CAN CARRY unsaid, no bands and no word past them where there are none. */
const tidy = (e: Encumbrance): Encumbrance => {
  const next: Encumbrance = { column: e.column };
  if (e.unit && e.unit.trim()) next.unit = e.unit.slice(0, LIMITS.unit);
  if (e.capacity !== undefined && e.capacity.trim()) next.capacity = e.capacity;
  if (e.bands && e.bands.length) {
    next.bands = e.bands.slice(0, LIMITS.bands);
    next.past = (e.past ?? '').slice(0, LIMITS.word);
    if (e.past_says !== undefined) next.past_says = e.past_says;
    if (e.past_condition !== undefined) next.past_condition = e.past_condition;
  }
  return next;
};

/** A NUMBER column it can count, by id, with each type that has it. */
export interface Countable { id: string; label: string; unit?: string; types: string[] }

/** The NUMBER columns of the types, each once by id (WEIGHT, SLOTS), with the types that have it. */
export const countable = (def: Definition): Countable[] => {
  const byId = new Map<string, Countable>();
  for (const t of itemTypes(def)) {
    for (const c of t.columns.filter((x) => x.kind === 'number')) {
      const had = byId.get(c.id);
      if (had) had.types.push(t.label || t.id);
      else byId.set(c.id, { id: c.id, label: c.label || c.id, ...(c.unit ? { unit: c.unit } : {}), types: [t.label || t.id] });
    }
  }
  return [...byId.values()];
};

/** The types that don't have the column: they weigh nothing. */
export const typesWithout = (def: Definition, column: string): string[] =>
  itemTypes(def).filter((t) => !t.columns.some((c) => c.id === column && c.kind === 'number')).map((t) => t.label || t.id);

/**
 * Encumbrance switched on (8a5c): counting WEIGHT where a type has it, else the first NUMBER column, in its unit; CAN
 * CARRY ten times the first stat, so the bands have something to be a share of; the starting bands. Null with no NUMBER
 * column to count.
 */
export const started = (def: Definition, firstStat: string | null): Encumbrance | null => {
  const cols = countable(def);
  const col = cols.find((c) => c.id === 'weight') ?? cols[0];
  if (!col) return null;
  return {
    column: col.id, ...(col.unit ? { unit: col.unit } : {}), capacity: firstStat ? `@${firstStat} * 10` : '100',
    bands: START_BANDS.map((b) => ({ ...b })), past: START_PAST,
  };
};

/** COUNTED BY another column, its unit coming with it where it has one. */
export const countedBy = (def: Definition, e: Encumbrance, column: string): Encumbrance => {
  const col = countable(def).find((c) => c.id === column);
  return { ...e, column, ...(col?.unit ? { unit: col.unit } : {}) };
};

/** A band added after the last, further than it (doubled, up to the most); none past the most bands. */
export const withNewBand = (e: Encumbrance): Encumbrance | null => {
  const bands = e.bands ?? [];
  if (bands.length >= LIMITS.bands) return null;
  const last = bands.length ? bands[bands.length - 1].upto : 0;
  const upto = Math.min(LIMITS.upto, last ? last * 2 : 50);
  return { ...e, bands: [...bands, { word: 'NEW BAND', upto }], past: e.past ?? START_PAST };
};
export const withBand = (e: Encumbrance, at: number, patch: Partial<Band>): Encumbrance =>
  ({ ...e, bands: (e.bands ?? []).map((b, i) => (i === at ? { ...b, ...patch } : b)) });
export const withoutBand = (e: Encumbrance, at: number): Encumbrance => ({ ...e, bands: (e.bands ?? []).filter((_, i) => i !== at) });

/** What is wrong with a band's share, as the server says it, or null: 1 to 1000, each further than the one before. */
export const bandProblem = (bands: Band[], at: number): string | null => {
  const b = bands[at];
  if (!Number.isInteger(b.upto) || b.upto < 1 || b.upto > LIMITS.upto) return `Up to what share of CAN CARRY: 1 to ${LIMITS.upto}%`;
  if (at > 0 && b.upto <= bands[at - 1].upto) return 'Each band goes further than the one before';
  return null;
};

/** One name a formula can read, as INSERT shows it. */
export interface GearToken { token: string; label: string }

/** What is worn, summed by column (8a5b; the server's wornSums.js): @type_column for each NUMBER column of a type of its own. */
export const wornTokens = (def: Definition): GearToken[] => (ownTypes(def)
  ? itemTypes(def).flatMap((t) => t.columns.filter((c) => c.kind === 'number')
    .map((c) => ({ token: `@${t.id}_${c.id}`, label: `${(t.one || t.label || t.id)} ${c.label || c.id} WORN`.toUpperCase() })))
  : []);

/** What formulas read of the gear: @carried and @capacity where encumbrance says, then what is worn by column. */
export const gearTokens = (def: Definition): GearToken[] => {
  const e = encumbranceOf(def);
  return [
    ...(e ? [{ token: '@carried', label: 'CARRIED' }] : []),
    ...(e && e.capacity && e.capacity.trim() ? [{ token: '@capacity', label: 'CAN CARRY' }] : []),
    ...wornTokens(def),
  ];
};
