// The builder's CHOICES page as logic (7a2b1; approved mockup docs/mockups/builder-choices.html,
// 2026-10-27): a system's lists to pick from (classes, backgrounds, feats), each named one and many,
// how many a character picks, whether it is levelled and whether more can be added later; and their
// options, each with a name, words and an optional requirement; and each option's features (7a2b2):
// a name and words, the level it unlocks at in a levelled list, and what it does, any of modifiers,
// uses a rest refills, rolls it gives, changes it lets a roll take, and a list it opens. Mirrors
// backend/systemBuilder/choices.js,
// which checks what is written and works out what picks do; the tests hold the two together.
// 7a5a2: how a list is picked (on its own, through the features that open it, both, or everyone has
// it) and how many picks a feature opening a list gives. 7a5b: a list's table to roll on, each
// option's roll on it, and how players pick from it. 7d6a: an INCREASE, points the player spreads on
// stats as it unlocks.

import type { Definition } from './systemsApi';
import { idFor } from './setup';
import { allStats, formulaList, statGroups } from './statsRules';
import { healthLayout } from './setup';
import { restList } from './rests';
import { rollList } from './rolls';

/** backend choices.js LIMITS, held equal by a test. */
export const LIMITS = { lists: 20, options: 100, features: 40, modifiers: 10, rolls: 10, level: 30, picks: 100, label: 40, description: 1000, opens: 10, dieLeast: 2, dieMost: 100, tableDice: 4, increase: 10, cap: 9999 } as const;

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * An option of a list; a levelled list's may have a die, by its sides (R1a: recovery dice, level-up
 * health); a list with a table's has the roll, or range, that gives it (7a5b: '4', '4-5').
 */
/** What holding an option gives a new character as they finish (7c4e). */
export interface OptionGives { items?: { name: string; qty: number }[]; money?: Record<string, { how: 'number'; amount: number } | { how: 'roll'; each: string }> }
export interface ChoiceOption { id: string; label: string; description?: string; requires?: string; die?: number; roll?: string; gives?: OptionGives; features?: unknown[] }
/** How a list is picked (backend choices.js PICKED); on its own when it says nothing. */
export type Picked = 'own' | 'features' | 'both' | 'everyone';
/** How players pick from a list with a table (backend choices.js PLAYERS): by hand, by hand or rolled, rolled only. */
export type Players = 'hand' | 'either' | 'roll';
export interface ChoiceList { id: string; one: string; many: string; picks?: number | 'any'; levelled?: boolean; again?: boolean; picked?: Picked; table?: string; players?: Players; options: ChoiceOption[] }
/** A change to a list: `table: null` takes its table away, and its options' rolls with it. */
export type ListPatch = Partial<Pick<ChoiceList, 'one' | 'many' | 'picks' | 'levelled' | 'again' | 'picked' | 'players'>> & { table?: string | null };
/** A change to an option: `die: null` takes its die away; an empty roll takes its roll away. */
export type OptionPatch = Partial<Pick<ChoiceOption, 'label' | 'description' | 'requires' | 'roll' | 'gives'>> & { die?: number | null };
export interface Modifier { target: string; amount: string }
export interface Uses { count: string; refill?: string }
export interface RollChange { roll: string; change: string }
/**
 * An INCREASE (7d6a; backend choices.js): points the player spreads on stats, at most `most` on one
 * (all the points when absent), from one group of stats (all when absent), none past `cap` (no cap).
 */
export interface Increase { points: number; most?: number; stats?: string; cap?: number }
export interface Feature { id: string; label: string; text?: string; at?: number; modifiers?: Modifier[]; uses?: Uses; rolls?: string[]; changes?: RollChange[]; choice?: string; choice_count?: number; increase?: Increase }
/** A change to a feature: `uses: null`, `choice: null` and `increase: null` take them away. */
export type FeaturePatch = Partial<Omit<Feature, 'id' | 'uses' | 'choice' | 'increase'>> & { uses?: Uses | null; choice?: string | null; increase?: Increase | null };

const text = (v: unknown) => (typeof v === 'string' ? v : '');

/** A definition's lists, those well formed enough to show, each with its options. */
export const choiceLists = (def: Definition): ChoiceList[] => (Array.isArray(def.choices) ? def.choices as unknown[] : [])
  .filter((c): c is Obj => isObject(c) && typeof c.id === 'string')
  .map((c) => ({
    ...c,
    id: c.id as string,
    one: text(c.one),
    many: text(c.many),
    options: (Array.isArray(c.options) ? c.options : []).filter((o): o is Obj => isObject(o) && typeof o.id === 'string')
      .map((o) => ({ ...o, id: o.id as string, label: text(o.label) })),
  }) as ChoiceList);

const withLists = (def: Definition, lists: ChoiceList[]): Definition => {
  const next: Definition = { ...def };
  if (lists.length) next.choices = lists; else delete next.choices;
  return next;
};

/**
 * Ids a new option may not take: every option's and feature's (they share one set, as has() will
 * read them), and any whose level name (@x_level) a stat or formula already has.
 */
const takenIds = (def: Definition): string[] => [
  ...choiceLists(def).flatMap((c) => c.options.flatMap((o) => [o.id, ...(o.features ?? []).filter(isObject).map((f) => f.id).filter((id): id is string => typeof id === 'string')])),
  ...[...allStats(def).map((s) => s.id), ...formulaList(def).map((f) => f.id)].filter((id) => typeof id === 'string' && id.endsWith('_level')).map((id) => id.slice(0, -'_level'.length)),
];

/** The lists the GRAPH shows (7a5c): one with levels, or a feature that changes a number. The rest stay off the map. */
export const listsOnMap = (def: Definition): ChoiceList[] => choiceLists(def).filter((c) => c.levelled === true
  || c.options.some((o) => featureList(o).some((f) => Array.isArray(f.modifiers) && f.modifiers.length > 0)));

/** How a list is picked: on its own when it says nothing. */
export const pickedOf = (c: ChoiceList): Picked => (c.picked === 'features' || c.picked === 'both' || c.picked === 'everyone' ? c.picked : 'own');

/** A list's table as dice (backend choices.js tableOf): { count, sides, low, high }, or null. */
export const tableOf = (c: Pick<ChoiceList, 'table'>): { count: number; sides: number; low: number; high: number } | null => {
  const m = typeof c.table === 'string' ? /^([1-9]\d*)?d(\d+)$/.exec(c.table.trim().toLowerCase()) : null;
  if (!m) return null;
  const count = m[1] ? Number(m[1]) : 1;
  const sides = Number(m[2]);
  if (count > LIMITS.tableDice || sides < LIMITS.dieLeast || sides > LIMITS.dieMost) return null;
  return { count, sides, low: count, high: count * sides };
};

/** An option's roll, `4` or `4-5`, as [from, to] (backend choices.js rollRangeOf), or null. */
export const rollRangeOf = (roll: unknown): [number, number] | null => {
  const m = typeof roll === 'string' ? /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(roll) : null;
  if (!m) return null;
  const from = Number(m[1]);
  const to = m[2] === undefined ? from : Number(m[2]);
  return from <= to ? [from, to] : null;
};

/** How players pick from a list (backend choices.js playersOf): by hand without a table, by hand or rolled when unsaid. */
export const playersOf = (c: ChoiceList): Players => (!tableOf(c) ? 'hand' : c.players === 'hand' || c.players === 'roll' ? c.players : 'either');

/** The dice a table may be, as the page offers them: d6, 2d6, d20, d100, and the system's own that a table can roll. */
export const tableDiceChoices = (def: Definition): string[] => {
  const own = isObject(def.core) && Array.isArray(def.core.dice) ? def.core.dice.filter((d): d is string => typeof d === 'string') : [];
  return [...new Set(['d6', '2d6', 'd20', 'd100', ...own.map((d) => d.trim().toLowerCase())])].filter((d) => tableOf({ table: d }));
};

/** Each option's roll on `table`, the rolls shared out evenly in order (the mockup's fill): d6 over three is 1-2, 3-4, 5-6. */
export const evenRolls = (options: Pick<ChoiceOption, 'id'>[], table: string): Record<string, string> => {
  const t = tableOf({ table });
  if (!t || !options.length) return {};
  const span = t.high - t.low + 1;
  const out: Record<string, string> = {};
  let at = t.low;
  options.forEach((o, i) => {
    const n = Math.floor(span / options.length) + (i < span % options.length ? 1 : 0);
    out[o.id] = n <= 0 ? '' : n === 1 ? `${at}` : `${at}-${at + n - 1}`;
    at += n;
  });
  return out;
};

/**
 * What is wrong with a list's table, in the server's words (backend choices.js checkTable), each
 * with the option it is about: a roll out of the dice, a roll on two options, and rolls on none.
 */
export const tableProblems = (c: ChoiceList): { option?: string; message: string }[] => {
  const t = tableOf(c);
  if (!t) return [];
  const out: { option?: string; message: string }[] = [];
  const on = new Map<number, string>();
  for (const o of c.options.slice(0, LIMITS.options)) {
    const range = rollRangeOf(o.roll);
    const name = o.label.trim() || o.id;
    if (!range || range[0] < t.low || range[1] > t.high) { out.push({ option: o.id, message: `A roll from ${t.low} to ${t.high}, or a range like ${t.low}-${t.low + 1}` }); continue; }
    for (let n = range[0]; n <= range[1]; n += 1) {
      if (on.has(n)) out.push({ option: o.id, message: `${n} is both ${on.get(n)} and ${name}` });
      else on.set(n, name);
    }
  }
  const gaps: number[] = [];
  for (let n = t.low; n <= t.high; n += 1) if (!on.has(n)) gaps.push(n);
  if (gaps.length) out.push({ message: `Nothing on ${gaps.slice(0, 6).join(', ')}${gaps.length > 6 ? '…' : ''}` });
  return out;
};

/**
 * Whether a list's features unlock at a level (backend choices.js unlocksByLevelOf): a levelled list's,
 * by its pick's; one everyone has, by the character's; one picked through features and opened from one
 * of those, by the level of the pick that opened it (7a5d: Champion by the Fighter's).
 */
export const unlocksByLevel = (def: Definition, c: ChoiceList, seen: ReadonlySet<string> = new Set()): boolean => {
  if (c.levelled === true || pickedOf(c) === 'everyone') return true;
  if (pickedOf(c) === 'own' || seen.has(c.id)) return false;
  const next = new Set(seen).add(c.id);
  return openedBy(def, c.id).some((o) => unlocksByLevel(def, o.list, next));
};

/** The picks a list's levels follow, when it has none of its own (7a5d): the options opening it from a list with levels. */
export const followedBy = (def: Definition, c: ChoiceList): ChoiceOption[] => (c.levelled === true || pickedOf(c) === 'everyone' || pickedOf(c) === 'own' ? []
  : [...new Map(openedBy(def, c.id).filter((o) => unlocksByLevel(def, o.list, new Set([c.id]))).map((o) => [o.option.id, o.option])).values()]);

/** Every feature, in another list, that opens this one: OPENED BY on its page. */
export const openedBy = (def: Definition, listId: string): { list: ChoiceList; option: ChoiceOption; feature: Feature }[] => choiceLists(def)
  .filter((c) => c.id !== listId)
  .flatMap((c) => c.options.flatMap((option) => featureList(option).filter((feature) => feature.choice === listId).map((feature) => ({ list: c, option, feature }))));

/** How many a list lets a character pick, as the page shows it: 1 when it says nothing. */
export const picksOf = (c: ChoiceList): number | 'any' => (c.picks === 'any' ? 'any' : Number.isInteger(c.picks) ? c.picks as number : 1);

/** The definition with a new list, named to be renamed, and its id. Null at the limit. */
export const withNewList = (def: Definition): { definition: Definition; id: string } | null => {
  const lists = choiceLists(def);
  if (lists.length >= LIMITS.lists) return null;
  const id = idFor('new list', [...lists.map((c) => c.id), ...takenIds(def)]);
  return { definition: withLists(def, [...lists, { id, one: 'NEW CHOICE', many: 'NEW CHOICES', options: [] }]), id };
};

/**
 * The definition with one list changed; its id stays, so characters' picks stay theirs. Names are
 * kept as typed (blank is a problem to fix); one pick, not levelled and not again store nothing.
 */
export const withList = (def: Definition, id: string, patch: ListPatch): Definition => withLists(def, choiceLists(def).map((c) => {
  if (c.id !== id) return c;
  const { table, ...rest } = patch;
  const next: ChoiceList = { ...c, ...rest };
  // A table picked (7a5b): its rolls shared out evenly over the options, as the mockup fills them;
  // taken away, or a list everyone has (never rolled for), the rolls and how players pick go too.
  if (typeof table === 'string' && tableOf({ table }) && table !== c.table) {
    const rolls = evenRolls(next.options, table);
    next.table = table;
    next.options = next.options.map((o) => ({ ...o, roll: rolls[o.id] }));
  }
  if (table === null || next.picked === 'everyone' || !tableOf(next)) {
    delete next.table;
    delete next.players;
    if (next.options.some((o) => o.roll !== undefined)) next.options = next.options.map((o) => { const copy = { ...o }; delete copy.roll; return copy; });
  } else if (next.players === 'either') delete next.players;
  if (next.picks !== 'any' && !(Number.isInteger(next.picks) && (next.picks as number) > 1)) delete next.picks;
  else if (typeof next.picks === 'number') next.picks = Math.min(next.picks, LIMITS.picks);
  if (next.levelled !== true) delete next.levelled;
  if (next.again !== true) delete next.again;
  // On its own stores nothing; a list everyone has has no levels of its own (the server refuses both).
  if (pickedOf(next) === 'own') delete next.picked;
  if (next.picked === 'everyone') delete next.levelled;
  // A list without levels has no dice (R1b): turning LEVELLED off takes its options' with it.
  if (next.levelled !== true && next.options.some((o) => o.die !== undefined)) next.options = next.options.map((o) => { const copy = { ...o }; delete copy.die; return copy; });
  return next;
}));

/** The definition without one list, and with no feature left opening it from another. */
export const withoutList = (def: Definition, id: string): Definition => withLists(def, choiceLists(def).filter((c) => c.id !== id).map((c) => ({
  ...c,
  options: c.options.map((o) => (Array.isArray(o.features)
    ? { ...o, features: o.features.map((f) => { if (!isObject(f) || f.choice !== id) return f; const rest = { ...f }; delete rest.choice; return rest; }) }
    : o)),
})));

/** The definition with a new option on a list, named to be renamed, and its id. Null at the limit. */
export const withNewOption = (def: Definition, listId: string): { definition: Definition; id: string } | null => {
  const list = choiceLists(def).find((c) => c.id === listId);
  if (!list || list.options.length >= LIMITS.options) return null;
  const id = idFor('new option', takenIds(def));
  return { definition: withLists(def, choiceLists(def).map((c) => (c.id === listId ? { ...c, options: [...c.options, { id, label: 'NEW OPTION' }] } : c))), id };
};

/**
 * The definition with one option changed; its id stays. Empty words and requirement store nothing;
 * a die is kept to its 2 to 100 sides, and only on a levelled list's option.
 */
export const withOption = (def: Definition, listId: string, optionId: string, patch: OptionPatch): Definition => withLists(def, choiceLists(def).map((c) => (c.id !== listId ? c : {
  ...c,
  options: c.options.map((o) => {
    if (o.id !== optionId) return o;
    const { die, ...rest } = patch;
    const next: ChoiceOption = { ...o, ...rest };
    if (typeof next.description === 'string' && !next.description.trim()) delete next.description;
    if (typeof next.requires === 'string' && !next.requires.trim()) delete next.requires;
    // What it gives: nothing stored once it says nothing.
    if (next.gives) {
      const gives: OptionGives = { ...next.gives };
      if (!gives.items?.length) delete gives.items;
      if (!Object.keys(gives.money ?? {}).length) delete gives.money;
      if (Object.keys(gives).length) next.gives = gives; else delete next.gives;
    }
    // A roll only on a list with a table (7a5b), trimmed; empty takes it away.
    if (typeof next.roll === 'string') next.roll = next.roll.trim();
    if (!tableOf(c) || next.roll === '') delete next.roll;
    if (die === null) delete next.die;
    else if (die !== undefined && c.levelled === true && Number.isInteger(die)) next.die = Math.min(Math.max(die, LIMITS.dieLeast), LIMITS.dieMost);
    return next;
  }),
})));

/** The definition without one option, its features with it. */
export const withoutOption = (def: Definition, listId: string, optionId: string): Definition => withLists(def, choiceLists(def)
  .map((c) => (c.id !== listId ? c : { ...c, options: c.options.filter((o) => o.id !== optionId) })));

/** An option's features, those well formed enough to show. */
export const featureList = (o: ChoiceOption): Feature[] => (Array.isArray(o.features) ? o.features : [])
  .filter((f): f is Obj => isObject(f) && typeof f.id === 'string')
  .map((f) => ({ ...f, id: f.id as string, label: text(f.label) }) as Feature);

/** The level a feature unlocks at: 1 when it says none, as the server reads it. */
export const levelOf = (f: Feature): number => (Number.isInteger(f.at) && (f.at as number) >= 1 ? f.at as number : 1);

/** What a feature does, in the order the page lists them; none is words only. */
export type FeatureKind = 'modifier' | 'increase' | 'uses' | 'roll' | 'change' | 'choice' | 'text';
export const kindsOf = (f: Feature): FeatureKind[] => {
  const kinds: FeatureKind[] = [];
  if (f.modifiers?.length) kinds.push('modifier');
  if (f.increase) kinds.push('increase');
  if (f.uses) kinds.push('uses');
  if (f.rolls?.length) kinds.push('roll');
  if (f.changes?.length) kinds.push('change');
  if (f.choice) kinds.push('choice');
  return kinds.length ? kinds : ['text'];
};

const withFeatures = (def: Definition, listId: string, optionId: string, change: (features: Feature[], list: ChoiceList) => Feature[]): Definition =>
  withLists(def, choiceLists(def).map((c) => (c.id !== listId ? c : {
    ...c,
    options: c.options.map((o) => {
      if (o.id !== optionId) return o;
      const features = change(featureList(o), c);
      const next: ChoiceOption = { ...o, features };
      if (!features.length) delete next.features;
      return next;
    }),
  })));

/** The definition with a new feature on an option, named to be renamed, and its id. Null at the limit. */
export const withNewFeature = (def: Definition, listId: string, optionId: string, at?: number): { definition: Definition; id: string } | null => {
  const option = choiceLists(def).find((c) => c.id === listId)?.options.find((o) => o.id === optionId);
  if (!option || featureList(option).length >= LIMITS.features) return null;
  const id = idFor('new feature', takenIds(def));
  return {
    definition: withFeatures(def, listId, optionId, (fs, c) => [...fs, { id, label: 'NEW FEATURE', ...(unlocksByLevel(def, c) && at && at > 1 ? { at: Math.min(at, LIMITS.level) } : {}) }]),
    id,
  };
};

/**
 * The definition with one feature changed; its id stays. Blank words, level 1 (or any level outside a
 * levelled list), no modifiers, rolls or changes, no uses, no list and no increase store nothing; a level past the
 * highest is the highest, and uses refilled by nothing keep no refill. An increase keeps its points
 * from 1 to the most, its most on one from 1 to its points (stored as nothing when it is all of them),
 * and stores no group for all stats and no cap for none.
 */
export const withFeature = (def: Definition, listId: string, optionId: string, featureId: string, patch: FeaturePatch): Definition =>
  withFeatures(def, listId, optionId, (fs, c) => fs.map((f) => {
    if (f.id !== featureId) return f;
    const next = { ...f, ...patch } as Feature & { uses?: Uses | null; choice?: string | null; increase?: Increase | null };
    if (typeof next.text === 'string' && !next.text.trim()) delete next.text;
    if (!unlocksByLevel(def, c) || !(Number.isInteger(next.at) && (next.at as number) > 1)) delete next.at;
    else next.at = Math.min(next.at as number, LIMITS.level);
    for (const k of ['modifiers', 'rolls', 'changes'] as const) if (!next[k]?.length) delete next[k];
    if (!next.uses) delete next.uses;
    else if (!next.uses.refill) next.uses = { count: next.uses.count };
    if (!next.choice) delete next.choice;
    // How many it opens: only with a list, 1 stored as nothing, no more than the most.
    if (!next.choice || !Number.isInteger(next.choice_count) || (next.choice_count as number) <= 1) delete next.choice_count;
    else next.choice_count = Math.min(next.choice_count as number, LIMITS.opens);
    if (!next.increase) delete next.increase;
    else next.increase = increaseKept(next.increase);
    return next as Feature;
  }));

/** An increase as it is stored (7d6a): whole numbers within their limits, nothing for what is all or none. */
const increaseKept = (inc: Increase): Increase => {
  const whole = (n: unknown, least: number, most: number, none: number) => (Number.isFinite(n) ? Math.min(most, Math.max(least, Math.trunc(n as number))) : none);
  const points = whole(inc.points, 1, LIMITS.increase, 1);
  const most = whole(inc.most, 1, points, points);
  return {
    points,
    ...(most < points ? { most } : {}),
    ...(typeof inc.stats === 'string' && inc.stats ? { stats: inc.stats } : {}),
    ...(Number.isFinite(inc.cap) ? { cap: whole(inc.cap, -LIMITS.cap, LIMITS.cap, 0) } : {}),
  };
};

/** What a new INCREASE starts as: D&D's, 2 points and at most 2 on one, from every stat, with no cap. */
export const NEW_INCREASE: Increase = { points: 2 };

/** The groups of stats an INCREASE may raise (7d6a): those with a stat in them, by name. */
export const increaseGroups = (def: Definition): { id: string; label: string }[] => statGroups(def)
  .filter((g) => g.stats.some((s) => isObject(s) && typeof s.id === 'string'))
  .map((g) => ({ id: g.id, label: (g.label || g.id).toUpperCase() }));

/** An increase in words, as the CHOICES page says it under its rows: 2 POINTS · AT MOST 1 ON ONE · FROM ABILITIES · STOPS AT 20. */
export const increaseWords = (def: Definition, inc: Increase): string => {
  const group = increaseGroups(def).find((g) => g.id === inc.stats);
  const most = inc.most ?? inc.points;
  return [
    `${inc.points} ${inc.points === 1 ? 'POINT' : 'POINTS'}`,
    ...(inc.points > 1 ? [most < inc.points ? `AT MOST ${most} ON ONE` : 'ALL ON ONE IF THEY LIKE'] : []),
    group ? `FROM ${group.label}` : 'ANY STAT',
    inc.cap === undefined ? 'NO LIMIT' : `STOPS AT ${inc.cap}`,
  ].join(' · ');
};

/** The definition without one feature. */
export const withoutFeature = (def: Definition, listId: string, optionId: string, featureId: string): Definition =>
  withFeatures(def, listId, optionId, (fs) => fs.filter((f) => f.id !== featureId));

/** What a modifier can change, as the page offers it: the system's stats, formulas and health fields. */
export const modifierTargets = (def: Definition): { group: string; items: { id: string; label: string }[] }[] => {
  const named = (id: string, label: unknown) => ({ id, label: (typeof label === 'string' && label.trim() ? label : id).toUpperCase() });
  const health = healthLayout(isObject(def.core) ? (def.core as Obj).health : undefined).sections.flatMap((s) => s.fields);
  return [
    { group: 'STATS', items: allStats(def).map((s) => named(s.id, s.label)) },
    { group: 'FORMULAS', items: formulaList(def).map((f) => named(f.id, f.label)) },
    { group: 'HEALTH', items: health.map((f) => named(f.id, f.label)) },
  ].filter((g) => g.items.length);
};

/** The rests that can refill uses, by name, the off ones said so (the server takes any of them). */
export const refillRests = (def: Definition): { id: string; label: string }[] => restList(def)
  .map((r) => ({ id: r.id, label: `${(r.name.trim() || r.id).toUpperCase()}${r.on ? '' : ' (OFF)'}` }));

/** The system's rolls a feature can give, and each one's changes for one it lets a roll take. */
export const rollChoices = (def: Definition): { id: string; label: string; changes: { id: string; label: string }[] }[] => rollList(def)
  .map((r) => ({ id: r.id, label: (r.label || r.id).toUpperCase(), changes: (r.changes ?? []).map((ch) => ({ id: ch.id, label: (ch.label || ch.id).toUpperCase() })) }));

/** The names a levelled list's levels are read by in formulas: each option's, and the list's sum. */
export const levelNames = (c: ChoiceList): { list: string; options: Record<string, string> } => ({
  list: `@${c.id}_level`,
  options: Object.fromEntries(c.options.map((o) => [o.id, `@${o.id}_level`])),
});
