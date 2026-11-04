// The builder's NEW CHARACTER page as logic (7c1; approved mockup docs/mockups/new-character.html,
// 2026-11-03): the switch, and the steps a player is walked through, in the GM's order, each on or
// off. Mirrors backend/systemBuilder/creation.js, which checks what is written; the tests hold the
// two together. A step is read from what the system has, so a list made later joins by itself.

import type { Definition } from './systemsApi';
import { choiceLists, pickedOf, type ChoiceList } from './choices';
import { allStats, statGroups } from './statsRules';
import { partIsOn } from './wordsFeatures';
import { referencesIn } from './graphModel';

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

export interface CreationStep { id: string; off: boolean }

const section = (def: Definition): Obj => (isObject(def.creation) ? def.creation : {});

/** Every step this system has, in the order they come until the GM moves them. */
const stepIdsOf = (def: Definition): string[] => [
  'who',
  ...(statGroups(def).some((g) => g.stats.length) ? ['stats'] : []),
  ...choiceLists(def).filter((c) => ['own', 'both'].includes(pickedOf(c))).map((c) => `list:${c.id}`),
  'kits',
  ...(partIsOn(def, 'bank') ? ['money'] : []),
];

/** Whether the flow is on: off unless the GM says so. */
export const creationOn = (def: Definition): boolean => section(def).on === true;

/** The steps, the GM's order first, then any since added: a new list joining the lists, before KITS and MONEY. */
export const creationSteps = (def: Definition): CreationStep[] => {
  const have = stepIdsOf(def);
  const c = section(def);
  const ids = strings(c.order).filter((id, i, all) => have.includes(id) && all.indexOf(id) === i);
  for (const id of have) {
    if (ids.includes(id)) continue;
    const before = id.startsWith('list:') ? ids.findIndex((x) => x === 'kits' || x === 'money') : -1;
    if (before >= 0) ids.splice(before, 0, id); else ids.push(id);
  }
  const off = new Set(strings(c.off));
  return ids.map((id) => ({ id, off: id !== 'who' && off.has(id) }));
};

/** The list a step asks for, when it is a list's. */
export const stepList = (def: Definition, id: string): ChoiceList | undefined => (id.startsWith('list:')
  ? choiceLists(def).find((c) => c.id === id.slice('list:'.length)) : undefined);

/** What the page calls a step: a list by its one name. */
export const stepName = (def: Definition, id: string): string => {
  if (id === 'who') return 'WHO THEY ARE';
  if (id === 'stats') return 'THE STATS';
  if (id === 'kits') return 'KITS';
  if (id === 'money') return 'MONEY';
  const c = stepList(def, id);
  return (c?.one || c?.many || id).toUpperCase();
};

/** The definition with its `creation` changed; nothing stored once it says nothing. */
const withSection = (def: Definition, patch: Obj): Definition => {
  const c: Obj = { ...section(def), ...patch };
  if (c.on !== true) delete c.on;
  if (!strings(c.order).length) delete c.order;
  if (!strings(c.off).length) delete c.off;
  const next: Definition = { ...def };
  if (Object.keys(c).length) next.creation = c; else delete next.creation;
  return next;
};

/** GUIDED NEW CHARACTER on or off; the steps stay set for when it is on. */
export const withCreationOn = (def: Definition, on: boolean): Definition => withSection(def, { on });

/** A step moved one place up (-1) or down (+1); the whole order kept once any has moved. */
export const withStepMoved = (def: Definition, id: string, dir: -1 | 1): Definition => {
  const ids = creationSteps(def).map((s) => s.id);
  const i = ids.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= ids.length) return def;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  return withSection(def, { order: ids });
};

/** A step switched on or off. WHO THEY ARE is always asked: a character needs a name. */
export const withStepOff = (def: Definition, id: string, off: boolean): Definition => {
  if (id === 'who') return def;
  const now = new Set(strings(section(def).off));
  if (off) now.add(id); else now.delete(id);
  return withSection(def, { off: [...now] });
};

/**
 * What a GM should know of the order as it stands: a list asked before THE STATS, when one of its
 * options needs a stat, would have that option off until then.
 */
export const orderNotes = (def: Definition): string[] => {
  const steps = creationSteps(def).filter((s) => !s.off).map((s) => s.id);
  const stats = steps.indexOf('stats');
  if (stats < 0) return [];
  const statIds = new Set(allStats(def).map((s) => s.id));
  return steps.slice(0, stats).flatMap((id) => {
    const c = stepList(def, id);
    const needing = (c?.options ?? []).filter((o) => referencesIn(o.requires).fields.some((f) => statIds.has(f)));
    return needing.length
      ? [`${stepName(def, id)} comes before THE STATS, and ${needing.map((o) => (o.label || o.id).toUpperCase()).join(', ')} needs a stat: off until the stats are set, so it can't be picked here.`]
      : [];
  });
};
