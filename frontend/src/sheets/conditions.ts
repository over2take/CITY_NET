// The builder's CONDITIONS page as logic (4e1b; approved mockup docs/mockups/builder-conditions.html,
// 2026-10-09). A system's conditions read from its definition and written back, storing only what
// differs from the standard set, as WORDS stores only renamed terms: a standard condition put back
// as it was leaves nothing behind. Mirrors backend/systemBuilder/conditions.js, which checks what is
// written and runs it; the tests hold the two together.

import type { Definition } from './systemsApi';
import { idFor } from './setup';
import { allStats, formulaList } from './statsRules';

export const LIMITS = { conditions: 60, name: 30, short: 8, description: 300, rounds: 99, modifiers: 10, amount: 99 } as const;
export const ALL_ROLLS = 'all_rolls';

/** When removed, after a number of rounds, or at any of the rests named in `at` (4f, rests.ts). */
export type Ends = 'removed' | 'rounds' | 'rest';
export interface Modifier { target: string; amount: number }
export interface Condition {
  id: string;
  name: string;
  short: string;
  icon: string;
  description: string;
  ends: Ends;
  rounds?: number;
  /** The rests it wears off at, when it ends at a rest. */
  at?: string[];
  modifiers: Modifier[];
  standard: boolean;
}
/** A condition as the page lists it: whole, and whether it is on. */
export type Listed = Condition & { on: boolean };
/** What the page changes on one condition. */
export type ConditionPatch = Partial<Pick<Condition, 'name' | 'short' | 'icon' | 'description' | 'ends' | 'rounds' | 'at' | 'modifiers'>> & { on?: boolean };

/** The standard set every system starts with, as the server has it. */
export const STANDARD: Omit<Condition, 'ends' | 'modifiers' | 'standard'>[] = [
  { id: 'blinded', name: 'Blinded', short: 'BLIND', icon: 'blind', description: 'Can\'t see.' },
  { id: 'bleeding', name: 'Bleeding', short: 'BLEED', icon: 'drop', description: 'Losing blood until treated.' },
  { id: 'poisoned', name: 'Poisoned', short: 'POISON', icon: 'skull', description: 'Sickened by a toxin.' },
  { id: 'prone', name: 'Prone', short: 'PRONE', icon: 'down', description: 'On the ground.' },
  { id: 'stunned', name: 'Stunned', short: 'STUN', icon: 'star', description: 'Reeling, unable to act.' },
  { id: 'grappled', name: 'Grappled', short: 'GRAB', icon: 'hand', description: 'Held in place by someone.' },
  { id: 'frightened', name: 'Frightened', short: 'FEAR', icon: 'ghost', description: 'Shaken by fear.' },
  { id: 'unconscious', name: 'Unconscious', short: 'OUT', icon: 'zzz', description: 'Knocked out and unaware.' },
  { id: 'restrained', name: 'Restrained', short: 'BOUND', icon: 'chain', description: 'Tied, cuffed or pinned.' },
  { id: 'exhausted', name: 'Exhausted', short: 'TIRED', icon: 'battery', description: 'Running on empty.' },
];
const standardOf = (id: string) => STANDARD.find((s) => s.id === id);

type Stored = Record<string, Record<string, unknown>>;
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const storedOf = (def: Definition): Stored => (isObject(def.conditions)
  ? Object.fromEntries(Object.entries(def.conditions).filter(([, c]) => isObject(c))) as Stored : {});

/** A chip label from a name: its first word in capitals, cut to fit. */
export const shortFrom = (name: string) => name.trim().split(/\s+/)[0].toUpperCase().slice(0, LIMITS.short);

const whole = (base: { id: string; name: string; short?: string; icon?: string; description?: string }, c: Record<string, unknown>, standard: boolean): Condition => {
  const text = (v: unknown) => (typeof v === 'string' ? v : undefined);
  const ends: Ends = c.ends === 'rounds' || c.ends === 'rest' ? c.ends : 'removed';
  return {
    id: base.id,
    name: text(c.name)?.trim() || base.name,
    short: text(c.short)?.trim().toUpperCase() || base.short || shortFrom(text(c.name) || base.name),
    icon: text(c.icon) || base.icon || 'target',
    description: text(c.description) ?? base.description ?? '',
    ends,
    ...(ends === 'rounds' && Number.isInteger(c.rounds) ? { rounds: c.rounds as number } : {}),
    ...(ends === 'rest' ? { at: Array.isArray(c.at) ? c.at.filter((id): id is string => typeof id === 'string') : [] } : {}),
    modifiers: Array.isArray(c.modifiers) ? (c.modifiers.filter(isObject) as unknown as Modifier[]).map((m) => ({ target: m.target, amount: m.amount })) : [],
    standard,
  };
};

/**
 * Every condition the page lists: the standard set in order, each with its edits and whether it is
 * on, then the system's own in the order written (a nameless one listed by its id, to be named).
 */
export const conditionList = (def: Definition): Listed[] => {
  const stored = storedOf(def);
  const standard = STANDARD.map((s) => ({ ...whole(s, stored[s.id] ?? {}, true), on: stored[s.id]?.on !== false }));
  const own = Object.entries(stored)
    .filter(([id]) => !standardOf(id))
    .map(([id, c]) => ({ ...whole({ id, name: typeof c.name === 'string' ? c.name : '' }, c, false), on: true }));
  return [...standard, ...own];
};

/** The conditions the game offers: those on, as the server's conditionsOf gives them. */
export const conditionsOf = (def: Definition): Condition[] => conditionList(def)
  .filter((c) => c.on && c.name.trim())
  .map(({ on, ...c }) => c)
  .slice(0, LIMITS.conditions);

/** How many conditions a system has, the standard ones included, against the limit of 60. */
export const conditionCount = (def: Definition) => STANDARD.length + Object.keys(storedOf(def)).filter((id) => !standardOf(id)).length;

const withStored = (def: Definition, stored: Stored): Definition => {
  const next: Definition = { ...def };
  if (Object.keys(stored).length) next.conditions = stored; else delete next.conditions;
  return next;
};

/**
 * The definition with one condition changed. A standard condition keeps only what differs from the
 * standard (a name put back, or left blank, stores nothing); one of the system's own keeps its
 * name as typed, so a blank one is a problem to fix rather than a lost condition. Either way an
 * end of "when removed" stores nothing and drops any rounds or rests; "after rounds" starts at 1;
 * "at a rest" keeps the rests it names, none to start with (a problem until one is picked).
 */
export const withCondition = (def: Definition, id: string, patch: ConditionPatch): Definition => {
  const stored = storedOf(def);
  const base = standardOf(id);
  const entry: Record<string, unknown> = { ...(stored[id] ?? {}), ...patch };
  if (entry.ends === 'rounds') {
    if (!Number.isInteger(entry.rounds)) entry.rounds = 1;
    delete entry.at;
  } else if (entry.ends === 'rest') {
    entry.at = Array.isArray(entry.at) ? entry.at.filter((id): id is string => typeof id === 'string') : [];
    delete entry.rounds;
  } else {
    delete entry.ends;
    delete entry.rounds;
    delete entry.at;
  }
  if (Array.isArray(entry.modifiers) && entry.modifiers.length === 0) delete entry.modifiers;
  if (typeof entry.short === 'string' && !entry.short.trim()) delete entry.short;
  if (typeof entry.description === 'string' && !entry.description && !base) delete entry.description;
  if (base) {
    if (entry.on !== false) delete entry.on;
    // Back to the standard, or a name, label or icon left blank: nothing to store. A description
    // emptied on purpose is kept, since it differs from the standard one.
    for (const key of ['name', 'short', 'icon', 'description'] as const) {
      const v = entry[key];
      if (typeof v !== 'string') continue;
      const same = key === 'short' ? v.trim().toUpperCase() === base.short : v.trim() === base[key];
      const blank = key !== 'description' && !v.trim();
      if (same || blank) delete entry[key];
    }
  } else {
    delete entry.on;
  }
  const next = { ...stored };
  if (Object.keys(entry).length || !base) next[id] = entry; else delete next[id];
  return withStored(def, next);
};

/** The definition with a new condition of its own, named to be renamed, and its id. Null at the limit. */
export const withNewCondition = (def: Definition): { definition: Definition; id: string } | null => {
  if (conditionCount(def) >= LIMITS.conditions) return null;
  const stored = storedOf(def);
  const id = idFor('new condition', [...STANDARD.map((s) => s.id), ...Object.keys(stored)]);
  return { definition: withStored(def, { ...stored, [id]: { name: 'New condition' } }), id };
};

/** The definition without one of the system's own conditions; a standard one is only turned off. */
export const withoutCondition = (def: Definition, id: string): Definition => {
  if (standardOf(id)) return def;
  const { [id]: _gone, ...rest } = storedOf(def);
  return withStored(def, rest);
};

/** What a modifier may name: all rolls, then the system's stats and formulas by the names players see. */
export const modifierTargets = (def: Definition): { id: string; label: string }[] => [
  { id: ALL_ROLLS, label: 'ALL ROLLS' },
  ...allStats(def).map((s) => ({ id: s.id, label: s.label || s.id })),
  ...formulaList(def).map((f) => ({ id: f.id, label: (f as { label?: string }).label || f.id.replace(/_/g, ' ').toUpperCase() })),
];
