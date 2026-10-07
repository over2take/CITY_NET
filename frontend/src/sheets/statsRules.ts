// The builder's STATS & RULES page as logic (4b2c): a system's stats (in groups), its sample
// character, its formulas and its lookup tables, read from its definition and written back. Pure,
// so the page only draws it. Approved mockup docs/mockups/builder-stats-rules.html (2026-10-06).
//
// The server checks all of it (backend/systemBuilder: stats.js, derived.js, expression.js) and works
// the formulas out (POST /api/systems/preview-values; systemsApi.previewValues), so there is one
// engine for the builder and the game. New entries get ids from their first names, kept when the
// name changes, so formulas reading them never break (the user, same day).

import type { Definition } from './systemsApi';
import { idFor, healthLayout } from './setup';

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

export interface Stat { id: string; label: string; min?: number; max?: number; tie?: string }
export interface StatGroup { id: string; label: string; stats: Stat[] }
export interface Formula { id: string; label?: string; formula: string }
export interface Band { upTo?: number; value: number }
export interface Table { id: string; label?: string; bands: Band[] }

/** Functions every formula can call (expression.js BUILTINS): a table may not take these names. */
export const FUNCTIONS = ['min', 'max', 'floor', 'ceil', 'round', 'abs', 'clamp', 'if'];
/** Fields the starter sheet always has (sheet.js): a stat may not take these ids. */
const STARTER_IDS = ['name', 'concept', 'description', 'cash', 'notes'];

/** The system's stat groups, as stored. */
export const statGroups = (def: Definition): StatGroup[] =>
  (Array.isArray(def.stats) ? def.stats.filter((g) => isObject(g) && Array.isArray((g as Obj).stats)) as unknown as StatGroup[] : []);
/** Every stat, in order. */
export const allStats = (def: Definition): Stat[] => statGroups(def).flatMap((g) => g.stats.filter(isObject) as Stat[]);
/** The system's formulas, as stored. */
export const formulaList = (def: Definition): Formula[] =>
  (Array.isArray(def.derived) ? def.derived.filter((d) => isObject(d) && typeof (d as Obj).id === 'string') as unknown as Formula[] : []);
/** The system's tables, in the order written. */
export const tableList = (def: Definition): Table[] => (isObject(def.lookups)
  ? Object.entries(def.lookups).filter(([, t]) => isObject(t)).map(([id, t]) => ({ id, ...(t as Obj) } as Table)) : []);

/** Every id a new stat, formula or table must not take. */
export const takenIds = (def: Definition): string[] => [
  ...STARTER_IDS,
  ...healthLayout(isObject(def.core) ? (def.core as Obj).health : undefined).sections.flatMap((s) => s.fields.map((f) => f.id)),
  ...statGroups(def).map((g) => g.id),
  ...allStats(def).map((s) => s.id),
  ...formulaList(def).map((f) => f.id),
  ...tableList(def).map((t) => t.id),
  ...FUNCTIONS,
  // A customized sheet's own fields (4b3): a new stat or formula taking one's id would land in it.
  ...(isObject(def.sheet) && Array.isArray((def.sheet as Obj).sections)
    ? ((def.sheet as Obj).sections as unknown[]).flatMap((s) => (isObject(s) && Array.isArray(s.fields) ? s.fields : []))
      .filter((f): f is Obj => isObject(f) && typeof f.id === 'string').map((f) => f.id as string)
    : []),
];

const withList = (def: Definition, key: 'stats' | 'derived', list: unknown[]): Definition => {
  const next: Definition = { ...def };
  if (list.length) next[key] = list; else delete next[key];
  return next;
};

// ─── STATS ──────────────────────────────────────────────────────────────────

/** A new, empty group named `label`. */
export const withNewGroup = (def: Definition, label = 'NEW GROUP'): Definition =>
  withList(def, 'stats', [...statGroups(def), { id: idFor(label, takenIds(def)), label, stats: [] }]);

/** A group renamed; its id stays. */
export const withGroupLabel = (def: Definition, groupId: string, label: string): Definition =>
  withList(def, 'stats', statGroups(def).map((g) => (g.id === groupId ? { ...g, label } : g)));

/** A group removed, with its stats, their samples and any ties to them. */
export const withoutGroup = (def: Definition, groupId: string): Definition => {
  const gone = new Set((statGroups(def).find((g) => g.id === groupId)?.stats ?? []).map((s) => s.id));
  const next = withList(def, 'stats', statGroups(def).filter((g) => g.id !== groupId));
  return forgetStats(next, gone);
};

/** A new stat at the end of a group, 0 to 10 until the GM says otherwise. */
export const withNewStat = (def: Definition, groupId: string, label = 'New stat'): Definition => {
  const id = idFor(label, takenIds(def));
  return withList(def, 'stats', statGroups(def).map((g) => (g.id === groupId ? { ...g, stats: [...g.stats, { id, label, min: 0, max: 10 }] } : g)));
};

/**
 * A stat changed; its id stays. An empty lowest or highest (null) is left out; an empty tie means
 * none.
 */
export const withStat = (def: Definition, statId: string, patch: { label?: string; min?: number | null; max?: number | null; tie?: string | null }): Definition =>
  withList(def, 'stats', statGroups(def).map((g) => ({
    ...g,
    stats: g.stats.map((s) => {
      if (s.id !== statId) return s;
      const next: Stat = { ...s };
      if (patch.label !== undefined) next.label = patch.label;
      for (const end of ['min', 'max'] as const) {
        if (patch[end] === null) delete next[end];
        else if (patch[end] !== undefined) next[end] = patch[end]!;
      }
      if (patch.tie !== undefined) { if (patch.tie) next.tie = patch.tie; else delete next.tie; }
      return next;
    }),
  })));

/** A stat removed, with its sample and any ties to it. */
export const withoutStat = (def: Definition, statId: string): Definition =>
  forgetStats(withList(def, 'stats', statGroups(def).map((g) => ({ ...g, stats: g.stats.filter((s) => s.id !== statId) }))), new Set([statId]));

/** Samples and ties to stats that are gone, removed. */
const forgetStats = (def: Definition, gone: Set<string>): Definition => {
  let next = withList(def, 'stats', statGroups(def).map((g) => ({
    ...g, stats: g.stats.map((s) => { if (s.tie && gone.has(s.tie)) { const { tie: _t, ...rest } = s; return rest; } return s; }),
  })));
  for (const id of gone) next = withSample(next, id, null);
  return next;
};

/** The sample character's value for a stat, or null when it has none (it reads as 0). */
export const sampleOf = (def: Definition, statId: string): number | null => {
  const v = isObject(def.samples) ? def.samples[statId] : undefined;
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
};

/** A sample value set, or cleared with null. */
export const withSample = (def: Definition, statId: string, value: number | null): Definition => {
  const samples = { ...(isObject(def.samples) ? def.samples : {}) };
  if (value === null || !Number.isFinite(value)) delete samples[statId]; else samples[statId] = value;
  const next: Definition = { ...def };
  if (Object.keys(samples).length) next.samples = samples; else delete next.samples;
  return next;
};

// ─── FORMULAS ───────────────────────────────────────────────────────────────

/** A new formula at the end, worth 0 until written. */
export const withNewFormula = (def: Definition, label = 'New formula'): Definition =>
  withList(def, 'derived', [...formulaList(def), { id: idFor(label, takenIds(def)), label, formula: '0' }]);

/** A formula's name or text changed; its id stays. A blank name shows its id, so it isn't stored. */
export const withFormula = (def: Definition, id: string, patch: { label?: string; formula?: string }): Definition =>
  withList(def, 'derived', formulaList(def).map((f) => {
    if (f.id !== id) return f;
    const next: Formula = { ...f, ...patch };
    if (patch.label !== undefined && !patch.label.trim()) delete next.label;
    return next;
  }));

/** A formula removed. Formulas reading it show the problem until they're changed. */
export const withoutFormula = (def: Definition, id: string): Definition => withList(def, 'derived', formulaList(def).filter((f) => f.id !== id));

/** The names of the formulas that read @id. */
export const usedBy = (def: Definition, id: string): string[] => {
  const reads = new RegExp(`@${id}(?![a-z0-9_])`);
  return formulaList(def).filter((f) => f.id !== id && reads.test(f.formula ?? '')).map((f) => f.label || f.id);
};

/** A formula's problems, by its id, from the preview's list ("derived save, formula" is save's). */
export const problemsByFormula = (problems: { where: string; message: string }[]): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const p of problems) {
    const m = /^derived ([a-z][a-z0-9_]*)(,|$)/.exec(p.where);
    if (m && !out[m[1]]) out[m[1]] = p.message;
  }
  return out;
};

/** `text` with `token` put in at `at`, and where the cursor goes: inside a table's or function's ( ). */
export const insertToken = (text: string, at: number, token: string): { text: string; cursor: number } => {
  const p = Math.max(0, Math.min(at, text.length));
  const call = token.endsWith('()');
  return { text: text.slice(0, p) + token + text.slice(p), cursor: p + token.length - (call ? 1 : 0) };
};

// ─── TABLES ─────────────────────────────────────────────────────────────────

const withTables = (def: Definition, tables: Table[]): Definition => {
  const next: Definition = { ...def };
  if (tables.length) next.lookups = Object.fromEntries(tables.map(({ id, ...rest }) => [id, rest]));
  else delete next.lookups;
  return next;
};

/** A new table that gives 0 for everything, until rows are added. */
export const withNewTable = (def: Definition, label = 'New table'): Definition =>
  withTables(def, [...tableList(def), { id: idFor(label, takenIds(def)), label, bands: [{ value: 0 }] }]);

/** A table renamed; its id (what formulas call) stays. */
export const withTableLabel = (def: Definition, id: string, label: string): Definition =>
  withTables(def, tableList(def).map((t) => (t.id === id ? { ...t, label } : t)));

/** A table removed. Formulas calling it show the problem until they're changed. */
export const withoutTable = (def: Definition, id: string): Definition => withTables(def, tableList(def).filter((t) => t.id !== id));

/**
 * A table's rows changed: a row added above the open last one (one more than the row before it),
 * a row's "up to" or value set, or a row removed. The last row always stays, catching everything
 * higher.
 */
export const withBands = (def: Definition, id: string, change: { add: true } | { remove: number } | { set: number; upTo?: number; value?: number }): Definition =>
  withTables(def, tableList(def).map((t) => {
    if (t.id !== id) return t;
    let bands = [...t.bands];
    if ('add' in change) {
      const closed = bands.filter((b) => b.upTo !== undefined);
      const upTo = closed.length ? closed[closed.length - 1].upTo! + 1 : 0;
      bands.splice(bands.length - 1, 0, { upTo, value: 0 });
    } else if ('remove' in change) {
      if (change.remove >= bands.length - 1) return t;
      bands = bands.filter((_, i) => i !== change.remove);
    } else {
      bands = bands.map((b, i) => (i === change.set ? {
        ...b, ...(change.upTo !== undefined && i < bands.length - 1 ? { upTo: change.upTo } : {}), ...(change.value !== undefined ? { value: change.value } : {}),
      } : b));
    }
    return { ...t, bands };
  }));

/** What a table gives for `x`, read top to bottom (derived.js lookupIn). */
export const lookupIn = (bands: Band[], x: number): number => {
  for (const b of bands) if (b.upTo === undefined || x <= b.upTo) return b.value;
  return 0;
};
