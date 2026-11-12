// The builder's ranks as logic (7f1b; approved mockup docs/mockups/ranks-and-xp.html, 2026-11-12): lists of named ranks,
// lowest first, each worth a number or a formula, shared by the stats that hold one (backend systemBuilder/ranks.js); the
// four presets; a stat's HOLDS (a number or a list) and its AT START, the highest step a new character may pick. Read
// from the definition and written back; the server checks it. A ranked stat's sample is its step.

import type { Definition } from './systemsApi';
import { idFor } from './setup';
import { statGroups, type Stat } from './statsRules';

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown) => (typeof v === 'string' ? v : '');

/** One rank: its name, and what it is worth to a formula (a number or a formula). */
export interface Rank { name: string; worth: string }
/** A list of ranks, lowest first. */
export interface RankList { id: string; label: string; list: Rank[] }
/** A stat as the page reads it, with what it holds (7f1). */
export type RankedStat = Stat & { rank?: string; atStart?: number };

export const LIMITS = { lists: 20, ranks: 20, name: 30, label: 40, worth: 200 };

/** The presets (the mockup's): Pathfinder 2e's proficiency, World of Darkness's dots, Fate's ladder, Genesys's skill ranks. */
export const PRESETS: { id: string; label: string; list: Rank[] }[] = [
  { id: 'proficiency', label: 'PROFICIENCY', list: [
    { name: 'UNTRAINED', worth: '0' }, { name: 'TRAINED', worth: '2 + @level' }, { name: 'EXPERT', worth: '4 + @level' },
    { name: 'MASTER', worth: '6 + @level' }, { name: 'LEGENDARY', worth: '8 + @level' },
  ] },
  { id: 'dots', label: 'DOTS', list: [1, 2, 3, 4, 5].map((n) => ({ name: '•'.repeat(n), worth: String(n) })) },
  { id: 'ladder', label: 'THE LADDER', list: [
    ['TERRIBLE', -2], ['POOR', -1], ['MEDIOCRE', 0], ['AVERAGE', 1], ['FAIR', 2], ['GOOD', 3], ['GREAT', 4], ['SUPERB', 5],
    ['FANTASTIC', 6], ['EPIC', 7], ['LEGENDARY', 8],
  ].map(([name, worth]) => ({ name: name as string, worth: String(worth) })) },
  { id: 'skill_ranks', label: 'SKILL RANKS', list: [0, 1, 2, 3, 4, 5].map((n) => ({ name: `RANK ${n}`, worth: String(n) })) },
];

/** The system's rank lists, those with an id, each with its ranks. */
export const rankLists = (def: Definition): RankList[] => (Array.isArray(def.ranks) ? def.ranks as unknown[] : [])
  .filter((r): r is Obj => isObject(r) && typeof r.id === 'string')
  .map((r) => ({ ...r, id: r.id as string, label: text(r.label),
    list: (Array.isArray(r.list) ? r.list as unknown[] : []).filter(isObject).map((k) => ({ ...k, name: text(k.name), worth: text(k.worth) })) }));

/** The definition with these lists; none stores nothing. */
const withLists = (def: Definition, lists: RankList[]): Definition => {
  const next: Definition = { ...def };
  if (lists.length) next.ranks = lists; else delete next.ranks;
  return next;
};

/** The definition with each stat changed by `change` (a stat changed to nothing keeps it as it was). */
const withStats = (def: Definition, change: (s: RankedStat) => RankedStat): Definition => {
  if (!Array.isArray(def.stats)) return def;
  return { ...def, stats: statGroups(def).map((g) => ({ ...g, stats: g.stats.map((s) => (isObject(s) ? change(s as RankedStat) : s)) })) };
};

// ─── LISTS ──────────────────────────────────────────────────────────────────

/** A new list at the end, from a preset or empty with one rank; its id from its name, its own. Null at the most. */
export const withNewRankList = (def: Definition, preset?: string): { definition: Definition; id: string } | null => {
  const lists = rankLists(def);
  if (lists.length >= LIMITS.lists) return null;
  const from = PRESETS.find((p) => p.id === preset);
  const label = from ? from.label : 'NEW RANKS';
  const id = idFor(label, lists.map((l) => l.id));
  const list = from ? from.list.map((k) => ({ ...k })) : [{ name: 'NONE', worth: '0' }];
  return { definition: withLists(def, [...lists, { id, label, list }]), id };
};

/** A list's name; its id stays. */
export const withRankListLabel = (def: Definition, id: string, label: string): Definition =>
  withLists(def, rankLists(def).map((l) => (l.id === id ? { ...l, label } : l)));

/** A list removed; a stat holding it goes back to holding a number. */
export const withoutRankList = (def: Definition, id: string): Definition =>
  withStats(withLists(def, rankLists(def).filter((l) => l.id !== id)), (s) => (s.rank !== id ? s : unranked(s)));

// ─── RANKS ──────────────────────────────────────────────────────────────────

const withRanks = (def: Definition, listId: string, change: (list: Rank[]) => Rank[]): Definition =>
  withLists(def, rankLists(def).map((l) => (l.id === listId ? { ...l, list: change(l.list) } : l)));

/** A new rank at the top, a step up from the last. Null at the most. */
export const withNewRank = (def: Definition, listId: string): Definition | null => {
  const l = rankLists(def).find((x) => x.id === listId);
  if (!l || l.list.length >= LIMITS.ranks) return null;
  const last = l.list[l.list.length - 1];
  const worth = last && /^-?\d+$/.test(last.worth.trim()) ? String(Number(last.worth) + 1) : '0';
  return withRanks(def, listId, (list) => [...list, { name: `RANK ${list.length + 1}`, worth }]);
};

/** A rank's name or worth. */
export const withRank = (def: Definition, listId: string, at: number, patch: Partial<Rank>): Definition =>
  withRanks(def, listId, (list) => list.map((k, i) => (i === at ? { ...k, ...patch } : k)));

/** A rank moved a step down (-1) or up (+1) the list; the stats' highest at the start follow it. */
export const withRankMoved = (def: Definition, listId: string, at: number, by: -1 | 1): Definition => {
  const l = rankLists(def).find((x) => x.id === listId);
  const to = at + by;
  if (!l || at < 0 || to < 0 || at >= l.list.length || to >= l.list.length) return def;
  const swapped = withRanks(def, listId, (list) => list.map((k, i) => (i === at ? list[to] : i === to ? list[at] : k)));
  return withStats(swapped, (s) => (s.rank !== listId || s.atStart === undefined ? s
    : { ...s, atStart: s.atStart === at ? to : s.atStart === to ? at : s.atStart }));
};

/** A rank removed (never the last); a highest at the start past the new top comes down to it. */
export const withoutRank = (def: Definition, listId: string, at: number): Definition => {
  const l = rankLists(def).find((x) => x.id === listId);
  if (!l || l.list.length <= 1 || at < 0 || at >= l.list.length) return def;
  const fewer = withRanks(def, listId, (list) => list.filter((_, i) => i !== at));
  return withStats(fewer, (s) => (s.rank !== listId || s.atStart === undefined ? s
    : { ...s, atStart: s.atStart > at ? s.atStart - 1 : Math.min(s.atStart, l.list.length - 2) }));
};

// ─── A STAT'S HOLDS ─────────────────────────────────────────────────────────

/** A stat without these keys. */
const without = (s: RankedStat, keys: string[]): RankedStat => Object.fromEntries(Object.entries(s).filter(([k]) => !keys.includes(k))) as RankedStat;

/** A stat back to holding a number: no list, no highest at the start. */
const unranked = (s: RankedStat): RankedStat => without(s, ['rank', 'atStart']);

/** What a stat holds: a list's id, or null for a number. Held as a list, it has no lowest or highest of its own. */
export const withStatRank = (def: Definition, statId: string, listId: string | null): Definition =>
  withStats(def, (s) => {
    if (s.id !== statId) return s;
    if (!listId || !rankLists(def).some((l) => l.id === listId)) return unranked(s);
    return { ...without(s, ['min', 'max', 'atStart']), rank: listId };
  });

/** The highest step a new character may pick, or null for any. */
export const withStatAtStart = (def: Definition, statId: string, step: number | null): Definition =>
  withStats(def, (s) => {
    if (s.id !== statId || !s.rank) return s;
    const rest = without(s, ['atStart']);
    return step === null || !Number.isInteger(step) || step < 0 ? rest : { ...rest, atStart: step };
  });

/** The list a stat holds, or null. */
export const rankListOf = (def: Definition, stat: RankedStat): RankList | null =>
  (stat.rank ? rankLists(def).find((l) => l.id === stat.rank) ?? null : null);

/** The stats holding a list, by name, for the page to say who uses it. */
export const statsHolding = (def: Definition, listId: string): string[] =>
  statGroups(def).flatMap((g) => g.stats).filter((s) => isObject(s) && (s as RankedStat).rank === listId).map((s) => s.label || s.id);
