// The guided new character at the table, as logic (7c2; approved mockup docs/mockups/new-character.html,
// 2026-11-03): who is asked, where they are, what a step asks and whether it is answered. The steps
// come from the server (backend creation.js creationShown), which also keeps a character's place on
// their sheet; NewCharacterWindow only draws this.
//
// Who is asked is worked out here, because being asked only opens a window: a blank sheet, in a system
// with the flow on, that has never opened it. Anyone with a sheet already is never asked. KITS and
// MONEY come with 7c4, and the other ways to set stats with 7c3: here they are typed in.

import type { SheetField, SheetTemplate } from './types';
import { listShown, underFeature, workedOn, type ChoiceListShown, type PickShown, type Worked } from './choicesShown';

type Obj = Record<string, unknown>;

export interface CreationStat { id: string; label: string; min?: number; max?: number }
export interface CreationShown {
  /** The steps asked, in the GM's order: who, stats, list:<id>. */
  steps: string[];
  stats: { id: string; label: string; stats: CreationStat[] }[];
}

/** Where a sheet keeps its place in the flow (backend creation.js CREATING_KEY). */
export const CREATING_KEY = '_creating';

interface Place { at?: string; done?: boolean; uploaded?: boolean }
const isObject = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const placeOf = (data: Obj | null | undefined): Place | null => {
  const place = data?.[CREATING_KEY];
  return isObject(place) ? place as Place : null;
};
const fieldsOf = (template: SheetTemplate): SheetField[] => template.sections.flatMap((s) => s.fields);

/** Whether a stored value says anything: a 0, an empty box or an empty list says nothing. */
const says = (v: unknown): boolean => {
  if (typeof v === 'string') return v.trim() !== '';
  if (typeof v === 'number') return v !== 0;
  if (Array.isArray(v)) return v.length > 0;
  if (isObject(v)) return Object.values(v).some(says);
  return v === true;
};

/**
 * Whether a sheet has nothing on it yet. Worked-out values and those linked from elsewhere (the token's
 * health, the bank) don't count, being there before anyone types; of a sheet's own bookkeeping, only
 * picks and a roll waiting to be taken do. A value for a field no longer on the sheet counts, so a
 * character is never asked by mistake.
 */
export const isBlankSheet = (template: SheetTemplate, data: Obj | null | undefined): boolean => {
  const notTyped = new Set(fieldsOf(template).filter((f) => f.derived || f.source).map((f) => f.id));
  return !Object.entries(data ?? {}).some(([k, v]) => {
    if (k.startsWith('_')) return (k === '_choices' || k === '_rolled') && says(v);
    return !notTyped.has(k) && says(v);
  });
};

/** 'new': never opened, on a blank sheet, so the buttons blink. 'going': opened, not finished. */
export type FlowState = 'none' | 'new' | 'going';

export const flowState = (template: SheetTemplate | null | undefined, data: Obj | null | undefined): FlowState => {
  if (!template?.creation) return 'none';
  const place = placeOf(data);
  if (place) return place.done === true ? 'none' : 'going';
  return isBlankSheet(template, data) ? 'new' : 'none';
};

/** Whether a sheet's flow has ended, as finished or uploaded. */
export const flowDone = (data: Obj | null | undefined): boolean => placeOf(data)?.done === true;

/** The list a step asks for, when it is a list's. */
const listOfStep = (template: SheetTemplate, id: string): ChoiceListShown | undefined => (id.startsWith('list:')
  ? (template.choices ?? []).find((l) => l.id === id.slice('list:'.length)) : undefined);

export const stepListId = (id: string): string | null => (id.startsWith('list:') ? id.slice('list:'.length) : null);

/** The steps asked: a list with nothing in it has nothing to ask. */
export const flowSteps = (template: SheetTemplate): string[] => (template.creation?.steps ?? [])
  .filter((id) => !id.startsWith('list:') || !!listOfStep(template, id)?.options.length);

/** The step a character is on: the one saved, or the first when it has gone since. Null: not started. */
export const savedStep = (template: SheetTemplate, data: Obj | null | undefined): string | null => {
  const at = placeOf(data)?.at;
  if (typeof at !== 'string') return null;
  const steps = flowSteps(template);
  return steps.includes(at) ? at : steps[0] ?? null;
};

/** What the window calls a step: a list by its one name. */
export const flowStepName = (template: SheetTemplate, id: string): string => {
  if (id === 'who') return 'WHO THEY ARE';
  if (id === 'stats') return 'THE STATS';
  const list = listOfStep(template, id);
  return (list?.one || list?.many || id).toUpperCase();
};

/** The sheet's own NAME, CONCEPT and DESCRIPTION, as far as this sheet has them and the player may write them. */
export const whoFields = (template: SheetTemplate): SheetField[] => {
  const nameId = template.header?.nameField ?? 'name';
  const all = fieldsOf(template);
  return [nameId, 'concept', 'description']
    .map((id) => all.find((f) => f.id === id))
    .filter((f): f is SheetField => !!f && !f.gmOnly && !f.derived);
};

/** The stats a player sets: every group, without any the GM keeps to themselves on the sheet. */
export const statsToSet = (template: SheetTemplate): CreationShown['stats'] => {
  const gmOnly = new Set(fieldsOf(template).filter((f) => f.gmOnly).map((f) => f.id));
  return (template.creation?.stats ?? [])
    .map((g) => ({ ...g, stats: g.stats.filter((s) => !gmOnly.has(s.id)) }))
    .filter((g) => g.stats.length);
};

/** What is wrong with what is typed into a stat, in words, or null. Nothing typed yet says nothing. */
export const statProblem = (stat: CreationStat, value: unknown): string | null => {
  if (value === undefined || value === null || value === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return 'A number';
  if (stat.min !== undefined && n < stat.min) return `At least ${stat.min}`;
  if (stat.max !== undefined && n > stat.max) return `At most ${stat.max}`;
  return null;
};

const typedIn = (value: unknown): boolean => value !== undefined && value !== null && value !== '';

/** A pick with a feature still waiting for a pick under it that can be made, however deep. */
const owesPick = (p: PickShown, lists: ChoiceListShown[], worked: Worked): boolean => p.unlocked.some((f) => {
  const under = underFeature(f, lists, worked);
  if (!under) return false;
  if (under.room > 0 && under.open.some((o) => !o.unmet)) return true;
  return under.picks.some((q) => owesPick(q, lists, worked));
});

/**
 * Whether a list's step is answered: as many picks as it asks for, or all the requirements let them
 * make, and every feature those unlock answered too. A list of ANY needs none.
 */
const listAnswered = (template: SheetTemplate, list: ChoiceListShown, data: Obj | null | undefined): boolean => {
  const worked = workedOn(data);
  const view = listShown(list, worked);
  if (list.picks !== 'any' && view.picks.length < list.picks && view.open.some((o) => !o.unmet)) return false;
  return !view.picks.some((p) => owesPick(p, template.choices ?? [], worked));
};

/** Whether NEXT can be pressed. A step this code doesn't know has nothing to answer. */
export const stepAnswered = (template: SheetTemplate, id: string, data: Obj | null | undefined): boolean => {
  if (id === 'who') {
    const name = data?.[template.header?.nameField ?? 'name'];
    return typeof name === 'string' && name.trim() !== '';
  }
  if (id === 'stats') {
    return statsToSet(template).every((g) => g.stats.every((s) => typedIn(data?.[s.id]) && !statProblem(s, data?.[s.id])));
  }
  const list = listOfStep(template, id);
  return list ? listAnswered(template, list, data) : true;
};
