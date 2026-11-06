// The guided new character at the table, as logic (7c2; approved mockup docs/mockups/new-character.html,
// 2026-11-03): who is asked, where they are, what a step asks and whether it is answered. The steps
// come from the server (backend creation.js creationShown), which also keeps a character's place on
// their sheet; NewCharacterWindow only draws this.
//
// Who is asked is worked out here, because being asked only opens a window: a blank sheet, in a system
// with the flow on, that has never opened it. Anyone with a sheet already is never asked. KITS and
// MONEY come with 7c4, and the other ways to set stats with 7c3: here they are typed in.

import type { SheetField, SheetTemplate } from './types';
import { listShown, underFeature, WORKED_KEY, workedOn, type ChoiceListShown, type GiftsShown, type PickShown, type Worked } from './choicesShown';
import { currenciesFor, formatAmount } from './currencies';

type Obj = Record<string, unknown>;

export interface CreationStat { id: string; label: string; min?: number; max?: number }
/** A point buy (7c3d): no costs, 1 for 1 above the lowest. */
export interface BuyWay { way: 'buy'; points: number; lowest: number; highest: number; costs?: Record<string, number> }
/** A kit as a player sees it (7c4b): never the GM's own, nor a formula. */
export interface KitItem { name: string; qty: number }
export interface KitShown { id: string; name: string; items: KitItem[]; who: 'all' | 'pick' | 'needs'; needs?: string }
/** One currency's starting amount, as a player sees it (7c4d): a roll in words, never its dice worked out. */
export interface MoneyShown { id: string; name: string; how: 'number' | 'roll' | 'typed'; amount?: number; each?: string }
/** How a stats step is set (7c3b, 7c3c, 7c3d). */
export type StatWay = { way: 'typed' } | { way: 'array'; numbers: number[] } | { way: 'roll'; each: string; placed: 'order' | 'arrange' } | BuyWay;
export interface CreationShown {
  /** The steps asked, in the GM's order: who, stats or stats:<group>, list:<id>. */
  steps: string[];
  /** How the stats steps not typed in are set, by step. */
  ways?: Record<string, StatWay>;
  /** The kits a player sees. */
  kits?: KitShown[];
  /** What each currency starts at. */
  money?: MoneyShown[];
  /** The groups a player sets: those left out aren't here. */
  stats: { id: string; label: string; stats: CreationStat[] }[];
}

/** Where a sheet keeps its place in the flow (backend creation.js CREATING_KEY). */
export const CREATING_KEY = '_creating';

interface Place { at?: string; done?: boolean; uploaded?: boolean; rolled?: Record<string, unknown>; kit?: string; money?: Record<string, unknown>; gifts?: Record<string, unknown> }
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

/** Whether a step sets stats: THE STATS, or one group's with GROUP BY GROUP (7c3a). */
export const isStatsStep = (id: string): boolean => id === 'stats' || id.startsWith('stats:');

/** The steps asked: a list with nothing in it has nothing to ask, nor stats the GM keeps to themselves. */
export const flowSteps = (template: SheetTemplate): string[] => (template.creation?.steps ?? [])
  .filter((id) => !id.startsWith('list:') || !!listOfStep(template, id)?.options.length)
  .filter((id) => !isStatsStep(id) || statsToSet(template, id).length > 0);

/** The step a character is on: the one saved, or the first when it has gone since. Null: not started. */
export const savedStep = (template: SheetTemplate, data: Obj | null | undefined): string | null => {
  const at = placeOf(data)?.at;
  if (typeof at !== 'string') return null;
  const steps = flowSteps(template);
  return steps.includes(at) ? at : steps[0] ?? null;
};

/** What the window calls a step: a stats group by its label, a list by its one name. */
export const flowStepName = (template: SheetTemplate, id: string): string => {
  if (id === 'who') return 'WHO THEY ARE';
  if (id === 'stats') return 'THE STATS';
  if (isStatsStep(id)) return ((template.creation?.stats ?? []).find((g) => g.id === id.slice('stats:'.length))?.label || id).toUpperCase();
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

/**
 * The stats a step sets: THE STATS every group asked, a group's step only that group, without any the
 * GM keeps to themselves on the sheet.
 */
export const statsToSet = (template: SheetTemplate, step = 'stats'): CreationShown['stats'] => {
  const gmOnly = new Set(fieldsOf(template).filter((f) => f.gmOnly).map((f) => f.id));
  return (template.creation?.stats ?? [])
    .filter((g) => step === 'stats' || step === `stats:${g.id}`)
    .map((g) => ({ ...g, stats: g.stats.filter((s) => !gmOnly.has(s.id)) }))
    .filter((g) => g.stats.length);
};

/** How a stats step is set: typed in, unless the GM says otherwise. */
export const stepWay = (template: SheetTemplate, id: string): StatWay => template.creation?.ways?.[id] ?? { way: 'typed' };

/** What was rolled or typed for a currency so far (backend creation.js moneyHeld), or null. */
export const moneyHeldOn = (data: Obj | null | undefined, id: string): number | null => {
  const held = placeOf(data)?.money;
  const amount = isObject(held) ? held[id] : null;
  return Number.isInteger(amount) ? amount as number : null;
};

/** An amount as a player reads it: in the currency's own way, or the app's money as a plain number. */
export const moneyWords = (system: string | null | undefined, id: string, amount: number): string => {
  const currency = currenciesFor(system).find((c) => c.id === id);
  return currency ? formatAmount(currency, amount) : String(amount);
};

/** What an option's money rolled so far on this sheet (backend creation.js giftRolled), or null. */
export const giftRolledOn = (data: Obj | null | undefined, option: string, id: string): number | null => {
  const gifts = placeOf(data)?.gifts;
  const rolled = isObject(gifts) ? gifts[option] : null;
  const amount = isObject(rolled) ? rolled[id] : null;
  return Number.isInteger(amount) ? amount as number : null;
};

/** What an option gives, in a line: "Crowbar, 3x Rations · Gold: 3d6 * 10 · Honor: 5 Honor". */
export const giftWords = (gives: GiftsShown, system: string | null | undefined): string => [
  ...(gives.items?.length ? [kitItemsText(gives.items)] : []),
  ...(gives.money ?? []).map((m) => `${m.name}: ${m.how === 'roll' ? m.each : moneyWords(system, m.id, m.amount ?? 0)}`),
].join(' · ');

/** A kit's items as they read: "Rope, 3x Rations". */
export const kitItemsText = (items: KitItem[]): string => items.map((i) => (i.qty === 1 ? i.name : `${i.qty}x ${i.name}`)).join(', ');

/**
 * The KITS step as it stands on this sheet: what everyone gets, what is offered with what each still
 * needs, and the one picked. What isn't met is worked out by the server, as an option's is.
 */
export const kitsShownOn = (template: SheetTemplate, data: Obj | null | undefined) => {
  const worked = data?.[WORKED_KEY];
  const unmet = new Set(isObject(worked) && Array.isArray(worked.kitsUnmet) ? worked.kitsUnmet as string[] : []);
  const kits = template.creation?.kits ?? [];
  const offered = kits.filter((k) => k.who !== 'all').map((kit) => ({ kit, unmet: unmet.has(kit.id) ? kit.needs ?? 'a requirement' : null }));
  const chosen = placeOf(data)?.kit;
  return { everyone: kits.filter((k) => k.who === 'all'), offered, picked: offered.find((o) => o.kit.id === chosen) ?? null };
};

/** What a number costs in a point buy (backend creation.js costOf). */
export const buyCost = (way: BuyWay, n: number): number => {
  if (!way.costs) return n - way.lowest;
  return Number.isSafeInteger(way.costs[n]) ? way.costs[n] : 0;
};

/**
 * A point buy as it stands on this sheet: what each stat holds, the lowest until bought up (backend
 * creation.js heldIn), the points spent and left, and whether a stat can go up or down from here.
 */
export const buyShown = (way: BuyWay, stats: { id: string }[], data: Obj | null | undefined) => {
  const held: Record<string, number> = {};
  for (const s of stats) {
    const n = data?.[s.id];
    held[s.id] = Number.isInteger(n) && (n as number) >= way.lowest && (n as number) <= way.highest ? n as number : way.lowest;
  }
  const spent = stats.reduce((sum, s) => sum + buyCost(way, held[s.id]), 0);
  return {
    held,
    spent,
    left: way.points - spent,
    canLower: (id: string) => held[id] > way.lowest,
    canRaise: (id: string) => held[id] < way.highest && spent - buyCost(way, held[id]) + buyCost(way, held[id] + 1) <= way.points,
  };
};

/** What a step's ROLL came to on this sheet, or null: not rolled yet (backend creation.js rolledOn). */
export const rolledPool = (data: Obj | null | undefined, id: string): number[] | null => {
  const rolled = placeOf(data)?.rolled;
  const pool = isObject(rolled) ? rolled[id] : null;
  return Array.isArray(pool) ? pool as number[] : null;
};

/**
 * Which numbers of a pool the stats hold, and those left: a number counts once, and a value the pool
 * doesn't have isn't placed (backend creation.js placedFrom).
 */
export const placedFrom = (pool: number[], stats: { id: string }[], data: Obj | null | undefined): { placed: Record<string, number>; left: number[] } => {
  const left = [...pool];
  const placed: Record<string, number> = {};
  for (const s of stats) {
    const at = left.indexOf(data?.[s.id] as number);
    if (at >= 0) placed[s.id] = left.splice(at, 1)[0];
  }
  return { placed, left };
};

/**
 * The sheet as a player may write it just now: a stat set some way other than typing is locked while
 * the character is being made, as the server holds it (backend creation.js lockedWhileCreating).
 */
export const withCreationLocks = (template: SheetTemplate, data: Obj | null | undefined): SheetTemplate => {
  if (flowState(template, data) !== 'going') return template;
  const locked = new Set(flowSteps(template)
    .filter((id) => isStatsStep(id) && stepWay(template, id).way !== 'typed')
    .flatMap((id) => statsToSet(template, id).flatMap((g) => g.stats.map((s) => s.id))));
  if (!locked.size) return template;
  return { ...template, sections: template.sections.map((s) => ({ ...s, fields: s.fields.map((f) => (locked.has(f.id) ? { ...f, gmOnly: true } : f)) })) };
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

/** A pick whose money is still to be rolled (7c4e), or one under it, however deep. */
const owesGiftRoll = (p: PickShown, lists: ChoiceListShown[], worked: Worked, data: Obj | null | undefined): boolean => (
  (p.option.gives?.money ?? []).some((m) => m.how === 'roll' && giftRolledOn(data, p.option.id, m.id) === null)
  || p.unlocked.some((f) => !!underFeature(f, lists, worked)?.picks.some((q) => owesGiftRoll(q, lists, worked, data)))
);

/**
 * Whether a list's step is answered: as many picks as it asks for, or all the requirements let them
 * make, every feature those unlock answered too, and the money they give rolled. A list of ANY needs none.
 */
const listAnswered = (template: SheetTemplate, list: ChoiceListShown, data: Obj | null | undefined): boolean => {
  const worked = workedOn(data);
  const view = listShown(list, worked);
  if (list.picks !== 'any' && view.picks.length < list.picks && view.open.some((o) => !o.unmet)) return false;
  return !view.picks.some((p) => owesPick(p, template.choices ?? [], worked) || owesGiftRoll(p, template.choices ?? [], worked, data));
};

/** Whether NEXT can be pressed. A step this code doesn't know has nothing to answer. */
export const stepAnswered = (template: SheetTemplate, id: string, data: Obj | null | undefined): boolean => {
  if (id === 'who') {
    const name = data?.[template.header?.nameField ?? 'name'];
    return typeof name === 'string' && name.trim() !== '';
  }
  if (isStatsStep(id)) {
    const stats = statsToSet(template, id).flatMap((g) => g.stats);
    const way = stepWay(template, id);
    if (way.way === 'buy') return buyShown(way, stats, data).left >= 0;
    if (way.way !== 'typed') {
      const pool = way.way === 'array' ? way.numbers : rolledPool(data, id);
      if (!pool) return false;
      const { placed } = placedFrom(pool, stats, data);
      return stats.every((s) => placed[s.id] !== undefined);
    }
    return stats.every((s) => typedIn(data?.[s.id]) && !statProblem(s, data?.[s.id]));
  }
  if (id === 'money') return (template.creation?.money ?? []).every((m) => m.how === 'number' || moneyHeldOn(data, m.id) !== null);
  if (id === 'kits') {
    const { offered, picked } = kitsShownOn(template, data);
    return picked ? !picked.unmet : !offered.some((o) => !o.unmet);
  }
  const list = listOfStep(template, id);
  return list ? listAnswered(template, list, data) : true;
};
