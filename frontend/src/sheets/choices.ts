// The builder's CHOICES page as logic (7a2b1; approved mockup docs/mockups/builder-choices.html,
// 2026-10-27): a system's lists to pick from (classes, backgrounds, feats), each named one and many,
// how many a character picks, whether it is levelled and whether more can be added later; and their
// options, each with a name, words and an optional requirement; and each option's features (7a2b2):
// a name and words, the level it unlocks at in a levelled list, and what it does, any of modifiers,
// uses a rest refills, rolls it gives, changes it lets a roll take, and a list it opens. Mirrors
// backend/systemBuilder/choices.js,
// which checks what is written and works out what picks do; the tests hold the two together.

import type { Definition } from './systemsApi';
import { idFor } from './setup';
import { allStats, formulaList } from './statsRules';
import { healthLayout } from './setup';
import { restList } from './rests';
import { rollList } from './rolls';

/** backend choices.js LIMITS, held equal by a test. */
export const LIMITS = { lists: 20, options: 100, features: 40, modifiers: 10, rolls: 10, level: 30, picks: 100, label: 40, description: 1000, opens: 10 } as const;

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

export interface ChoiceOption { id: string; label: string; description?: string; requires?: string; features?: unknown[] }
export interface ChoiceList { id: string; one: string; many: string; picks?: number | 'any'; levelled?: boolean; again?: boolean; options: ChoiceOption[] }
export type ListPatch = Partial<Pick<ChoiceList, 'one' | 'many' | 'picks' | 'levelled' | 'again'>>;
export type OptionPatch = Partial<Pick<ChoiceOption, 'label' | 'description' | 'requires'>>;
export interface Modifier { target: string; amount: string }
export interface Uses { count: string; refill?: string }
export interface RollChange { roll: string; change: string }
export interface Feature { id: string; label: string; text?: string; at?: number; modifiers?: Modifier[]; uses?: Uses; rolls?: string[]; changes?: RollChange[]; choice?: string }
/** A change to a feature: `uses: null` and `choice: null` take them away. */
export type FeaturePatch = Partial<Omit<Feature, 'id' | 'uses' | 'choice'>> & { uses?: Uses | null; choice?: string | null };

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
  const next: ChoiceList = { ...c, ...patch };
  if (next.picks !== 'any' && !(Number.isInteger(next.picks) && (next.picks as number) > 1)) delete next.picks;
  else if (typeof next.picks === 'number') next.picks = Math.min(next.picks, LIMITS.picks);
  if (next.levelled !== true) delete next.levelled;
  if (next.again !== true) delete next.again;
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

/** The definition with one option changed; its id stays. Empty words and requirement store nothing. */
export const withOption = (def: Definition, listId: string, optionId: string, patch: OptionPatch): Definition => withLists(def, choiceLists(def).map((c) => (c.id !== listId ? c : {
  ...c,
  options: c.options.map((o) => {
    if (o.id !== optionId) return o;
    const next: ChoiceOption = { ...o, ...patch };
    if (typeof next.description === 'string' && !next.description.trim()) delete next.description;
    if (typeof next.requires === 'string' && !next.requires.trim()) delete next.requires;
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
export type FeatureKind = 'modifier' | 'uses' | 'roll' | 'change' | 'choice' | 'text';
export const kindsOf = (f: Feature): FeatureKind[] => {
  const kinds: FeatureKind[] = [];
  if (f.modifiers?.length) kinds.push('modifier');
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
    definition: withFeatures(def, listId, optionId, (fs, c) => [...fs, { id, label: 'NEW FEATURE', ...(c.levelled && at && at > 1 ? { at: Math.min(at, LIMITS.level) } : {}) }]),
    id,
  };
};

/**
 * The definition with one feature changed; its id stays. Blank words, level 1 (or any level outside a
 * levelled list), no modifiers, rolls or changes, no uses and no list store nothing; a level past the
 * highest is the highest, and uses refilled by nothing keep no refill.
 */
export const withFeature = (def: Definition, listId: string, optionId: string, featureId: string, patch: FeaturePatch): Definition =>
  withFeatures(def, listId, optionId, (fs, c) => fs.map((f) => {
    if (f.id !== featureId) return f;
    const next = { ...f, ...patch } as Feature & { uses?: Uses | null; choice?: string | null };
    if (typeof next.text === 'string' && !next.text.trim()) delete next.text;
    if (!c.levelled || !(Number.isInteger(next.at) && (next.at as number) > 1)) delete next.at;
    else next.at = Math.min(next.at as number, LIMITS.level);
    for (const k of ['modifiers', 'rolls', 'changes'] as const) if (!next[k]?.length) delete next[k];
    if (!next.uses) delete next.uses;
    else if (!next.uses.refill) next.uses = { count: next.uses.count };
    if (!next.choice) delete next.choice;
    return next as Feature;
  }));

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
