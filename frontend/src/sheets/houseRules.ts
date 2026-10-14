// The builder's HOUSE RULES as logic (4j3a; approved mockup docs/mockups/optional-rules.html,
// 2026-10-14): a system's own house rules, made once, and what waits on each. A rule is a name, what
// it means and whether it starts on; things go under one where they live (a FEATURES part, a sheet or
// NPC stat block section, a condition: only_with; a formula's alternative). Deleting a rule leaves
// what was under it always there. Mirrors backend/systemBuilder/houseRules.js, which checks what is
// written and runs it; the tests hold the two together. Named "house rules", never "rules": a
// formula's $name is one of the engine's built-in rules.

import type { Definition } from './systemsApi';
import type { BuilderPage } from './builderSession';
import { idFor } from './setup';
import { conditionList } from './conditions';
import { formulaList } from './statsRules';
import { PART_ROWS } from './wordsFeatures';

export const LIMITS = { rules: 20, name: 40, description: 300 } as const;

export interface HouseRule { id: string; name: string; description?: string; starts?: boolean }
export type HouseRulePatch = Partial<Pick<HouseRule, 'name' | 'description' | 'starts'>>;

/** Something under a house rule, as the HOUSE RULES page lists it, with the page GO TO opens. */
export interface Waiting { kind: 'FEATURES PART' | 'SHEET SECTION' | 'NPC SECTION' | 'CONDITION' | 'FORMULA'; id: string; label: string; page: BuilderPage }

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

/** A definition's house rules, in order, those well formed enough to show. */
export const houseRuleList = (def: Definition): HouseRule[] => (Array.isArray(def.house_rules) ? def.house_rules as unknown[] : [])
  .filter((r): r is HouseRule => isObject(r) && typeof r.id === 'string')
  .map((r) => ({ ...r, name: typeof r.name === 'string' ? r.name : '' }));

const withList = (def: Definition, list: HouseRule[]): Definition => {
  const next: Definition = { ...def };
  if (list.length) next.house_rules = list; else delete next.house_rules;
  return next;
};

/** The definition with a new house rule, named to be renamed and starting off, and its id. Null at the limit. */
export const withNewHouseRule = (def: Definition): { definition: Definition; id: string } | null => {
  const list = houseRuleList(def);
  if (list.length >= LIMITS.rules) return null;
  const id = idFor('new rule', list.map((r) => r.id));
  return { definition: withList(def, [...list, { id, name: 'NEW RULE' }]), id };
};

/**
 * The definition with one house rule changed; its id stays, so what waits on it stays with it. A
 * name is kept as typed (blank is a problem to fix, not a lost rule); an empty description, and
 * starting off, store nothing.
 */
export const withHouseRule = (def: Definition, id: string, patch: HouseRulePatch): Definition => withList(def, houseRuleList(def).map((r) => {
  if (r.id !== id) return r;
  const next: HouseRule = { ...r, ...patch };
  if (typeof next.description === 'string' && !next.description.trim()) delete next.description;
  if (next.starts !== true) delete next.starts;
  return next;
}));

/** A sheet layout with no section waiting on `id`. */
const sheetFreed = (sheet: unknown, id: string) => {
  if (!isObject(sheet) || !Array.isArray(sheet.sections)) return sheet;
  return { ...sheet, sections: sheet.sections.map((s) => (isObject(s) && s.only_with === id ? (({ only_with: _gone, ...rest }) => rest)(s) : s)) };
};

/**
 * The definition without one house rule, and with everything that waited on it always there: no
 * part, section or condition waits on it any more, and a formula whose alternative followed it
 * loses the alternative, its own formula staying.
 */
export const withoutHouseRule = (def: Definition, id: string): Definition => {
  const next = withList(def, houseRuleList(def).filter((r) => r.id !== id));
  if (isObject(def.parts)) {
    next.parts = Object.fromEntries(Object.entries(def.parts).map(([part, p]) => [part, isObject(p) && p.only_with === id ? (({ only_with: _gone, ...rest }) => rest)(p) : p]));
  }
  if (def.sheet !== undefined) next.sheet = sheetFreed(def.sheet, id) as Definition['sheet'];
  if (isObject(def.npc) && def.npc.sheet !== undefined) next.npc = { ...def.npc, sheet: sheetFreed(def.npc.sheet, id) };
  if (isObject(def.conditions)) {
    const conditions: Obj = {};
    for (const [c, entry] of Object.entries(def.conditions)) {
      if (!(isObject(entry) && entry.only_with === id)) { conditions[c] = entry; continue; }
      const { only_with: _gone, ...rest } = entry;
      // A standard condition with nothing else changed stores nothing; one of the system's own keeps its name.
      if (Object.keys(rest).length) conditions[c] = rest;
    }
    if (Object.keys(conditions).length) next.conditions = conditions; else delete next.conditions;
  }
  if (Array.isArray(def.derived)) {
    next.derived = (def.derived as unknown[]).map((d) => (isObject(d) && isObject(d.alternative) && d.alternative.rule === id
      ? (({ alternative: _gone, ...rest }) => rest)(d) : d)) as Definition['derived'];
  }
  return next;
};

const sectionsWaiting = (sheet: unknown, id: string, kind: Waiting['kind'], page: BuilderPage): Waiting[] => (isObject(sheet) && Array.isArray(sheet.sections) ? sheet.sections : [])
  .filter((s): s is Obj => isObject(s) && s.only_with === id && typeof s.id === 'string')
  .map((s) => ({ kind, id: s.id as string, label: typeof s.label === 'string' && s.label ? s.label : s.id as string, page }));

/** Everything waiting on house rule `id`, by the page it lives on: parts, sections, conditions, formulas. */
export const waitingOn = (def: Definition, id: string): Waiting[] => {
  const parts = isObject(def.parts) ? def.parts : {};
  const conditions = isObject(def.conditions) ? def.conditions : {};
  return [
    ...PART_ROWS.filter((row) => isObject(parts[row.id]) && (parts[row.id] as Obj).only_with === id)
      .map((row): Waiting => ({ kind: 'FEATURES PART', id: row.id, label: row.label, page: 'features' })),
    ...sectionsWaiting(def.sheet, id, 'SHEET SECTION', 'sheet'),
    ...sectionsWaiting(isObject(def.npc) ? def.npc.sheet : undefined, id, 'NPC SECTION', 'npcs'),
    ...conditionList(def).filter((c) => isObject(conditions[c.id]) && (conditions[c.id] as Obj).only_with === id)
      .map((c): Waiting => ({ kind: 'CONDITION', id: c.id, label: c.name || c.id, page: 'conditions' })),
    ...formulaList(def).filter((f) => f.alternative?.rule === id)
      .map((f): Waiting => ({ kind: 'FORMULA', id: f.id, label: f.label || f.id, page: 'rules' })),
  ];
};
