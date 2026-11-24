// The builder's CONDITIONS page as logic (4e1b; approved mockup docs/mockups/builder-conditions.html,
// 2026-10-09). A system's conditions read from its definition and written back, storing only what
// differs from the standard set, as WORDS stores only renamed terms: a standard condition put back
// as it was leaves nothing behind. Mirrors backend/systemBuilder/conditions.js, which checks what is
// written and runs it; the tests hold the two together.

import { resistancesIn, type Resistance } from './resistances';
import type { Definition } from './systemsApi';
import { idFor } from './setup';
import { allStats, formulaList } from './statsRules';

export const LIMITS = { conditions: 60, name: 30, short: 8, description: 300, rounds: 99, modifiers: 10, amount: 99, number: 9999, times: 100, formula: 200, eachTurn: 3, endsOn: 9999 } as const;
export const ALL_ROLLS = 'all_rolls';

/** How a condition ends: when removed, after a number of rounds, at any of the rests named in `at` (4f, rests.ts), or AT THE END
 * OF ITS NEXT TURN (8a9a). */
export type Ends = 'removed' | 'rounds' | 'rest' | 'next_turn';

/** EACH TURN (8a9a; the builder's boxes 8a9b): when it fires, what it does, and who rolls it, as the server's conditions.js. */
export type EachTurnWhen = 'turn_start' | 'turn_end' | 'round_start' | 'round_end';
export type EachTurnDoes = 'damage' | 'heal' | 'roll_to_end' | 'just_roll';
export const WHENS: [EachTurnWhen, string][] = [['turn_start', 'START OF ITS TURN'], ['turn_end', 'END OF ITS TURN'], ['round_start', 'START OF ROUND'], ['round_end', 'END OF ROUND']];
export const DOES: [EachTurnDoes, string][] = [['damage', 'DAMAGE'], ['heal', 'HEAL'], ['roll_to_end', 'ROLL TO END'], ['just_roll', 'JUST ROLL']];
/** One thing a condition does each turn. Stored only where it differs: CHANGES HP on and ROLLED BY THE TABLE say nothing. */
export interface EachTurn { when: EachTurnWhen; does: EachTurnDoes; roll: string; ends_on?: number; changes_hp?: boolean; rolled_by?: 'table' | 'player' }
/** How a modifier counts (8a5e1): added (said by nothing), times, set to, or no more than. */
export type ModifierWay = 'add' | 'times' | 'set' | 'most';
export const WAYS: ModifierWay[] = ['add', 'times', 'set', 'most'];
/** A modifier: its target, and an amount, a number or (8a5e1) formula text, counted its way. */
export interface Modifier { target: string; amount: number | string; way?: ModifierWay }
export interface Condition {
  id: string;
  name: string;
  short: string;
  icon: string;
  /** A drawing on the 16 x 16 pad (8b1b), shown instead of the icon wherever it is drawn. */
  drawn?: string[];
  description: string;
  ends: Ends;
  rounds?: number;
  /** The rests it wears off at, when it ends at a rest. */
  at?: string[];
  modifiers: Modifier[];
  /** Its modifiers change the sheet's numbers (8a5e1), or are a reminder. */
  applied?: boolean;
  /** What it does on initiative turns (8a9a), each whole as the server reads it: none for most. */
  each_turn?: EachTurn[];
  /** 8b3b: what it resists while on (sheets/resistances.ts). */
  resistances?: Resistance[];
  standard: boolean;
}
/** A condition as the page lists it: whole, and whether it is on. */
export type Listed = Condition & { on: boolean };
/** What the page changes on one condition. */
/** `only_with`: the house rule it waits on (4j), or null for none. */
export type ConditionPatch = Partial<Pick<Condition, 'name' | 'short' | 'icon' | 'drawn' | 'description' | 'ends' | 'rounds' | 'at' | 'modifiers' | 'applied' | 'resistances'>> & { on?: boolean; only_with?: string | null; each_turn?: EachTurn[] };

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
/** A drawing as the server takes it (drawings.js): 16 rows of 4 hex digits. */
const isDrawing = (v: unknown): v is string[] => Array.isArray(v) && v.length === 16 && v.every((r) => typeof r === 'string' && /^[0-9a-f]{4}$/.test(r));
const storedOf = (def: Definition): Stored => (isObject(def.conditions)
  ? Object.fromEntries(Object.entries(def.conditions).filter(([, c]) => isObject(c))) as Stored : {});

/** A chip label from a name: its first word in capitals, cut to fit. */
export const shortFrom = (name: string) => name.trim().split(/\s+/)[0].toUpperCase().slice(0, LIMITS.short);

/** A condition's EACH TURN as the game runs it (the server's eachTurnOf): the well-formed ones, each whole. */
export const eachTurnOf = (c: Record<string, unknown>): EachTurn[] => (Array.isArray(c.each_turn) ? c.each_turn : []).slice(0, LIMITS.eachTurn)
  .filter((e): e is EachTurn => isObject(e) && WHENS.some(([w]) => w === e.when) && DOES.some(([d]) => d === e.does) && typeof e.roll === 'string' && !!e.roll.trim()
    && (e.does !== 'roll_to_end' || Number.isInteger(e.ends_on)))
  .map((e) => ({
    when: e.when, does: e.does, roll: e.roll.trim(),
    ...(e.does === 'roll_to_end' ? { ends_on: e.ends_on } : {}),
    ...(e.does === 'damage' || e.does === 'heal' ? { changes_hp: e.changes_hp !== false } : {}),
    rolled_by: e.rolled_by === 'player' ? 'player' as const : 'table' as const,
  }));

const whole = (base: { id: string; name: string; short?: string; icon?: string; description?: string }, c: Record<string, unknown>, standard: boolean): Condition => {
  const text = (v: unknown) => (typeof v === 'string' ? v : undefined);
  const ends: Ends = c.ends === 'rounds' || c.ends === 'rest' || c.ends === 'next_turn' ? c.ends : 'removed';
  return {
    id: base.id,
    name: text(c.name)?.trim() || base.name,
    short: text(c.short)?.trim().toUpperCase() || base.short || shortFrom(text(c.name) || base.name),
    icon: text(c.icon) || base.icon || 'target',
    ...(isDrawing(c.drawn) ? { drawn: c.drawn } : {}),
    description: text(c.description) ?? base.description ?? '',
    ends,
    ...(ends === 'rounds' && Number.isInteger(c.rounds) ? { rounds: c.rounds as number } : {}),
    ...(ends === 'rest' ? { at: Array.isArray(c.at) ? c.at.filter((id): id is string => typeof id === 'string') : [] } : {}),
    // A modifier's way and a condition's APPLIED (8a5e1), as the server's conditionsOf: the way said where it isn't an ADD.
    modifiers: Array.isArray(c.modifiers) ? (c.modifiers.filter(isObject) as unknown as Modifier[])
      .map((m) => ({ target: m.target, amount: m.amount, ...(m.way && m.way !== 'add' && WAYS.includes(m.way) ? { way: m.way } : {}) })) : [],
    ...(c.applied === true ? { applied: true } : {}),
    ...(eachTurnOf(c).length ? { each_turn: eachTurnOf(c) } : {}),
    ...(resistancesIn(c.resistances).length ? { resistances: resistancesIn(c.resistances) } : {}),
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
  .map((c) => { const whole: Partial<Listed> = { ...c }; delete whole.on; return whole as Condition; })
  .slice(0, LIMITS.conditions);

/**
 * The conditions that change every roll (6b3b): those the game offers with a modifier on all rolls,
 * each with what its modifiers on all rolls come to, for TEST ROLL's switches. As the server's
 * tableRolls.termsOf reads them: whole numbers, never 0.
 */
export const onAllRolls = (def: Definition): { id: string; short: string; amount: number }[] => conditionsOf(def).flatMap((c) => {
  const counted = c.modifiers.filter((m): m is Modifier & { amount: number } => m.target === ALL_ROLLS && Number.isInteger(m.amount) && m.amount !== 0);
  return counted.length ? [{ id: c.id, short: c.short, amount: counted.reduce((n, m) => n + m.amount, 0) }] : [];
});

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
  // One picture (8b1b): an icon picked takes the drawing off, a drawing the icon.
  if (patch.icon !== undefined) delete entry.drawn;
  if (patch.drawn !== undefined) delete entry.icon;
  if (entry.ends === 'rounds') {
    if (!Number.isInteger(entry.rounds)) entry.rounds = 1;
    delete entry.at;
  } else if (entry.ends === 'rest') {
    entry.at = Array.isArray(entry.at) ? entry.at.filter((id): id is string => typeof id === 'string') : [];
    delete entry.rounds;
  } else if (entry.ends === 'next_turn') {
    // Kept through any other edit (8a9a); it has no rounds or rests.
    delete entry.rounds;
    delete entry.at;
  } else {
    delete entry.ends;
    delete entry.rounds;
    delete entry.at;
  }
  if (Array.isArray(entry.modifiers) && entry.modifiers.length === 0) delete entry.modifiers;
  if (Array.isArray(entry.each_turn) && entry.each_turn.length === 0) delete entry.each_turn;
  if (Array.isArray(entry.resistances) && entry.resistances.length === 0) delete entry.resistances;
  // A reminder, as every condition was before 8a5e: nothing to store.
  if (entry.applied !== true) delete entry.applied;
  if (typeof entry.only_with !== 'string' || !entry.only_with) delete entry.only_with;
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

/** What a modifier's amount box holds as it is kept (8a5e2): a number where it reads as one, else formula text. */
export const amountFrom = (typed: string): number | string => (/^\s*-?\d+(\.\d+)?\s*$/.test(typed) ? Number(typed) : typed);

/**
 * A modifier changed (8a5e2): an ADD says no way; ALL ROLLS only adds, a whole number (a formula or a fraction there becomes -1,
 * as + MODIFIER starts one).
 */
export const withModifier = (m: Modifier, patch: Partial<Modifier>): Modifier => {
  const next: Modifier = { ...m, ...patch };
  if (next.target === ALL_ROLLS) {
    delete next.way;
    if (!Number.isInteger(next.amount) || next.amount === 0) next.amount = -1;
  } else if (!next.way || next.way === 'add') delete next.way;
  return next;
};

/** What + EACH TURN starts (8a9b): 1d4 damage at the start of its turn, onto the token, rolled by the table. */
export const NEW_EACH_TURN: EachTurn = { when: 'turn_start', does: 'damage', roll: '1d4' };

/**
 * One EACH TURN changed (8a9b), kept tidy as the server checks it: ENDS ON only for a ROLL TO END (10 to start), CHANGES HP only
 * for DAMAGE and HEAL and stored only when off, ROLLED BY stored only when the player rolls.
 */
export const withEachTurn = (e: EachTurn, patch: Partial<EachTurn>): EachTurn => {
  const next: EachTurn = { ...e, ...patch };
  if (next.does === 'roll_to_end') { if (!Number.isInteger(next.ends_on)) next.ends_on = 10; } else delete next.ends_on;
  if ((next.does !== 'damage' && next.does !== 'heal') || next.changes_hp !== false) delete next.changes_hp;
  if (next.rolled_by !== 'player') delete next.rolled_by;
  return next;
};

const WHEN_PHRASE: Record<EachTurnWhen, string> = { turn_start: 'at the start of its turn', turn_end: 'at the end of its turn', round_start: 'at the start of the round', round_end: 'at the end of the round' };
/**
 * An EACH TURN in the GM's words (8a9b; the mockup's line under each): "BURNING: 1d4 DAMAGE at the start of its turn, onto the
 * token"; "POISONED: a save, d20 + Con mod, at the end of its turn, the player (the GM for an NPC) asked to roll; off on 13 or
 * more". `named` says a roll's @names by the system's own names (rollNamed).
 */
export const eachTurnWords = (name: string, e: EachTurn, named: (roll: string) => string = (r) => r): string => {
  const who = e.rolled_by === 'player' ? ', the player (the GM for an NPC) asked to roll' : '';
  const when = WHEN_PHRASE[e.when];
  const roll = named(e.roll.trim()) || '(nothing to roll yet)';
  const head = name.trim().toUpperCase() || 'IT';
  if (e.does === 'roll_to_end') return `${head}: a save, ${roll}, ${when}${who}; off on ${e.ends_on ?? 10} or more`;
  if (e.does === 'just_roll') return `${head}: ${roll} rolled ${when}${who}, to the log`;
  const word = e.does === 'damage' ? 'DAMAGE' : 'HEALED';
  return `${head}: ${roll} ${word} ${when}${who}, ${e.changes_hp === false ? 'for the GM to apply' : 'onto the token'}`;
};

/** A roll's @names said by the system's own names (8a9b): "d20 + @con_mod" as "d20 + Con mod"; a name it doesn't have left as typed. */
export const rollNamed = (def: Definition) => {
  const labels = new Map(modifierTargets(def).filter((t) => t.id !== ALL_ROLLS).map((t) => [t.id, t.label]));
  return (roll: string) => roll.replace(/@([a-z][a-z0-9_]*)/g, (m, id: string) => labels.get(id) ?? m);
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
  const rest = { ...storedOf(def) };
  delete rest[id];
  return withStored(def, rest);
};

/** What a modifier may name: all rolls, then the system's stats and formulas by the names players see. */
export const modifierTargets = (def: Definition): { id: string; label: string }[] => [
  { id: ALL_ROLLS, label: 'ALL ROLLS' },
  ...allStats(def).map((s) => ({ id: s.id, label: s.label || s.id })),
  ...formulaList(def).map((f) => ({ id: f.id, label: (f as { label?: string }).label || f.id.replace(/_/g, ' ').toUpperCase() })),
];
