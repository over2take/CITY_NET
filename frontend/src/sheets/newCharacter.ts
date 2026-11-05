// The builder's NEW CHARACTER page as logic (7c1; approved mockup docs/mockups/new-character.html,
// 2026-11-03): the switch, and the steps a player is walked through, in the GM's order, each on or
// off. Mirrors backend/systemBuilder/creation.js, which checks what is written; the tests hold the
// two together. A step is read from what the system has, so a list made later joins by itself. The
// stats are one step, or one per group with GROUP BY GROUP (7c3a); a group left out is the same
// stats:<group> in `off` either way, so changing between them loses nothing.

import type { Definition } from './systemsApi';
import { choiceLists, pickedOf, type ChoiceList } from './choices';
import { statGroups } from './statsRules';
import { partIsOn } from './wordsFeatures';
import { referencesIn } from './graphModel';
import { isStatsStep, type StatWay } from './newCharacterFlow';

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

export interface CreationStep { id: string; off: boolean }

const section = (def: Definition): Obj => (isObject(def.creation) ? def.creation : {});
const isGroupStep = (id: string): boolean => id.startsWith('stats:');
const groupsWithStats = (def: Definition) => statGroups(def).filter((g) => g.stats.length);

/** GROUP BY GROUP: each stats group a step of its own. Unsaid, ONE WAY FOR ALL. */
export const statsByGroup = (def: Definition): boolean => section(def).statsBy === 'group';

/** Whether a stats group is left out: its step off, or left out of THE STATS. */
export const groupLeftOut = (def: Definition, groupId: string): boolean => strings(section(def).off).includes(`stats:${groupId}`);

/** Every step this system has, in the order they come until the GM moves them. */
const stepIdsOf = (def: Definition): string[] => [
  'who',
  ...(statsByGroup(def)
    ? groupsWithStats(def).map((g) => `stats:${g.id}`)
    : groupsWithStats(def).length ? ['stats'] : []),
  ...choiceLists(def).filter((c) => ['own', 'both'].includes(pickedOf(c))).map((c) => `list:${c.id}`),
  'kits',
  ...(partIsOn(def, 'bank') ? ['money'] : []),
];

/** Whether the flow is on: off unless the GM says so. */
export const creationOn = (def: Definition): boolean => section(def).on === true;

/**
 * The steps, the GM's order first, then any since added: a new list joining the lists, before KITS and
 * MONEY, a new group after the other groups. THE STATS and the groups' steps stand in for each other.
 */
export const creationSteps = (def: Definition): CreationStep[] => {
  const have = stepIdsOf(def);
  const c = section(def);
  const groups = have.filter(isGroupStep);
  const read = strings(c.order).flatMap((id) => {
    if (id === 'stats' && statsByGroup(def)) return groups;
    return isGroupStep(id) && !statsByGroup(def) ? ['stats'] : [id];
  });
  const ids = read.filter((id, i, all) => have.includes(id) && all.indexOf(id) === i);
  for (const id of have) {
    if (ids.includes(id)) continue;
    const lastGroup = ids.map(isGroupStep).lastIndexOf(true);
    const before = id.startsWith('list:') ? ids.findIndex((x) => x === 'kits' || x === 'money')
      : isGroupStep(id) && lastGroup >= 0 ? lastGroup + 1 : -1;
    if (before >= 0) ids.splice(before, 0, id); else ids.push(id);
  }
  const off = new Set(strings(c.off));
  return ids.map((id) => ({ id, off: id !== 'who' && off.has(id) }));
};

/** The list a step asks for, when it is a list's. */
export const stepList = (def: Definition, id: string): ChoiceList | undefined => (id.startsWith('list:')
  ? choiceLists(def).find((c) => c.id === id.slice('list:'.length)) : undefined);

/** The stats group a step sets, when it is a group's. */
export const stepGroup = (def: Definition, id: string) => (isGroupStep(id)
  ? statGroups(def).find((g) => g.id === id.slice('stats:'.length)) : undefined);

/** What the page calls a step: a group by its label, a list by its one name. */
export const stepName = (def: Definition, id: string): string => {
  if (id === 'who') return 'WHO THEY ARE';
  if (id === 'stats') return 'THE STATS';
  if (isGroupStep(id)) return (stepGroup(def, id)?.label || id).toUpperCase();
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
  if (c.statsBy !== 'group') delete c.statsBy;
  if (isObject(c.ways) && !Object.keys(c.ways).length) delete c.ways;
  const next: Definition = { ...def };
  if (Object.keys(c).length) next.creation = c; else delete next.creation;
  return next;
};

/** How a stats step is set (7c3b): typed in, unless the GM says otherwise. */
export const wayOfStep = (def: Definition, id: string): StatWay => {
  const way = isObject(section(def).ways) ? (section(def).ways as Obj)[id] : null;
  return isObject(way) && way.way === 'array' && Array.isArray(way.numbers) ? way as StatWay : { way: 'typed' };
};

/** A stats step's way changed; typed in stores nothing. */
export const withStepWay = (def: Definition, id: string, way: StatWay): Definition => {
  const ways: Obj = { ...(isObject(section(def).ways) ? section(def).ways as Obj : {}) };
  if (way.way === 'typed') delete ways[id]; else ways[id] = way;
  return withSection(def, { ways });
};

/** What is typed for an array's numbers: whole numbers with commas between them, or null. */
export const parseNumbers = (text: string): number[] | null => {
  const parts = text.split(',').map((p) => p.trim()).filter((p) => p !== '');
  return parts.every((p) => /^-?\d+$/.test(p)) ? parts.map(Number) : null;
};

/** The stats a step sets, without those the GM keeps to themselves on the sheet. */
const statsOfStep = (def: Definition, id: string) => {
  const sheet = isObject(def.sheet) && Array.isArray(def.sheet.sections) ? def.sheet.sections as { fields?: { id: string; edit?: string }[] }[] : [];
  const gmOnly = new Set(sheet.flatMap((s) => (Array.isArray(s.fields) ? s.fields : [])).filter((f) => f.edit === 'gm').map((f) => f.id));
  const groups = id === 'stats' ? groupsWithStats(def).filter((g) => !groupLeftOut(def, g.id)) : groupsWithStats(def).filter((g) => `stats:${g.id}` === id);
  return groups.flatMap((g) => g.stats).filter((s) => !gmOnly.has(s.id));
};

const counted = (n: number, what: string): string => `${n} ${what}${n === 1 ? '' : 's'}`;

/** What stops a step's way working at the table, in the server's words (backend creation.js stepWayProblems). */
export const stepWayProblems = (def: Definition, id: string): string[] => {
  const way = wayOfStep(def, id);
  if (way.way !== 'array') return [];
  const stats = statsOfStep(def, id);
  const numbers = way.numbers.filter(Number.isSafeInteger);
  const found: string[] = [];
  if (numbers.length < stats.length) found.push(`${counted(numbers.length, 'number')} for ${counted(stats.length, 'stat')}: each stat needs one`);
  for (const n of [...new Set(numbers)]) {
    for (const s of stats) {
      if (Number.isSafeInteger(s.min) && n < (s.min as number)) found.push(`${n} is below ${s.label || s.id}'s lowest, ${s.min}`);
      if (Number.isSafeInteger(s.max) && n > (s.max as number)) found.push(`${n} is above ${s.label || s.id}'s highest, ${s.max}`);
    }
  }
  return found;
};

/** ONE WAY FOR ALL or GROUP BY GROUP; the order and what is left out carry over. */
export const withStatsByGroup = (def: Definition, byGroup: boolean): Definition => withSection(def, { statsBy: byGroup ? 'group' : undefined });

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
 * What a GM should know of the order as it stands: a list asked before the step setting a stat, when
 * one of its options needs that stat, would have that option off until then.
 */
export const orderNotes = (def: Definition): string[] => {
  const steps = creationSteps(def).filter((s) => !s.off).map((s) => s.id);
  // Which step sets which stat; a group left out has none.
  const setBy = new Map<string, string>();
  for (const g of statGroups(def)) {
    const step = statsByGroup(def) ? `stats:${g.id}` : 'stats';
    if (!groupLeftOut(def, g.id) && steps.includes(step)) for (const s of g.stats) setBy.set(s.id, step);
  }
  return steps.flatMap((id, at) => {
    const options = stepList(def, id)?.options ?? [];
    const later = steps.slice(at + 1).filter(isStatsStep);
    return later.flatMap((stats) => {
      const needing = options.filter((o) => referencesIn(o.requires).fields.some((f) => setBy.get(f) === stats));
      return needing.length
        ? [`${stepName(def, id)} comes before ${stepName(def, stats)}, and ${needing.map((o) => (o.label || o.id).toUpperCase()).join(', ')} needs a stat: off until the stats are set, so it can't be picked here.`]
        : [];
    });
  });
};
