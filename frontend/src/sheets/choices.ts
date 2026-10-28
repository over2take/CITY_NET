// The builder's CHOICES page as logic (7a2b1; approved mockup docs/mockups/builder-choices.html,
// 2026-10-27): a system's lists to pick from (classes, backgrounds, feats), each named one and many,
// how many a character picks, whether it is levelled and whether more can be added later; and their
// options, each with a name, words and an optional requirement. A feature's boxes are 7a2b2's; the
// features an option already has are kept as they are. Mirrors backend/systemBuilder/choices.js,
// which checks what is written and works out what picks do; the tests hold the two together.

import type { Definition } from './systemsApi';
import { idFor } from './setup';
import { allStats, formulaList } from './statsRules';

/** backend choices.js LIMITS, held equal by a test. */
export const LIMITS = { lists: 20, options: 100, features: 40, modifiers: 10, rolls: 10, level: 30, picks: 100, label: 40, description: 1000 } as const;

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);

export interface ChoiceOption { id: string; label: string; description?: string; requires?: string; features?: unknown[] }
export interface ChoiceList { id: string; one: string; many: string; picks?: number | 'any'; levelled?: boolean; again?: boolean; options: ChoiceOption[] }
export type ListPatch = Partial<Pick<ChoiceList, 'one' | 'many' | 'picks' | 'levelled' | 'again'>>;
export type OptionPatch = Partial<Pick<ChoiceOption, 'label' | 'description' | 'requires'>>;

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

/** The names a levelled list's levels are read by in formulas: each option's, and the list's sum. */
export const levelNames = (c: ChoiceList): { list: string; options: Record<string, string> } => ({
  list: `@${c.id}_level`,
  options: Object.fromEntries(c.options.map((o) => [o.id, `@${o.id}_level`])),
});
