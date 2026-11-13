// The builder's SPEND XP section on LEVELS, as logic (7f2b; approved mockup docs/mockups/ranks-and-xp.html, 2026-11-12):
// what XP buys and whether purchases wait for the GM, read from and written to `definition.spend`. RAISE A STAT IN a group
// (or every stat), COSTS a formula reading @old and @new, UP TO a most or no end; AN OPTION FROM a list without levels,
// COSTS a formula. The server's own is backend systemBuilder/spendXp.js, which checks it. Pure, so the page only draws.

import type { Definition } from './systemsApi';
import { statGroups } from './statsRules';
import { choiceLists } from './choices';

export type BuyWhat = 'stat' | 'option';
export interface Buy { id: string; what: BuyWhat; stats?: string; list?: string; cost: string; most?: number }
export interface SpendSet { buys: Buy[]; wait: boolean }

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** What a new one costs to start: so much for each point of the new rating, or a round number for an option. */
export const COST_STARTS: Record<BuyWhat, string> = { stat: '@new * 5', option: '10' };

/** The price list as stored, those buys whole enough to show, and whether purchases wait. */
export const spendSet = (d: Definition): SpendSet => {
  const raw = isObject(d.spend) ? d.spend : {};
  return {
    buys: (Array.isArray(raw.buys) ? raw.buys : []).filter((b): b is Buy => isObject(b) && typeof b.id === 'string' && (b.what === 'stat' || b.what === 'option'))
      .map((b) => ({ ...b, cost: typeof b.cost === 'string' ? b.cost : '' })),
    wait: raw.wait === true,
  };
};

/** The definition with its price list as given: none at all once nothing is bought and nothing waits. */
const write = (d: Definition, s: SpendSet): Definition => {
  const rest = { ...d };
  delete rest.spend;
  return s.buys.length || s.wait ? { ...rest, spend: { buys: s.buys, ...(s.wait ? { wait: true } : {}) } } : rest;
};

/** The groups RAISE A STAT can raise, by name. */
export const groupChoices = (d: Definition): { id: string; label: string }[] => statGroups(d)
  .filter((g) => typeof g.id === 'string' && g.stats.length).map((g) => ({ id: g.id, label: g.label || g.id }));
/** The lists AN OPTION can buy from: those without levels, as a class goes up by LEVEL UP. */
export const listChoices = (d: Definition): { id: string; label: string }[] => choiceLists(d)
  .filter((c) => c.levelled !== true).map((c) => ({ id: c.id, label: c.many || c.id }));

/** An id no other buy has: raise, raise_2, option, option_2. */
const freeId = (taken: Set<string>, base: string): string => {
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base}_${n}`)) n += 1;
  return `${base}_${n}`;
};

/** A new buy at the end: a stat raised in the first group, or an option from the first list without levels. */
export const withBuyAdded = (d: Definition, what: BuyWhat): Definition => {
  const s = spendSet(d);
  const id = freeId(new Set(s.buys.map((b) => b.id)), what === 'stat' ? 'raise' : 'option');
  const where = what === 'stat'
    ? (groupChoices(d)[0] ? { stats: groupChoices(d)[0].id } : {})
    : (listChoices(d)[0] ? { list: listChoices(d)[0].id } : {});
  return write(d, { ...s, buys: [...s.buys, { id, what, ...where, cost: COST_STARTS[what] }] });
};

/** A change to one buy: `stats: null` raises every stat, `most: null` has no end. */
export type BuyPatch = { stats?: string | null; list?: string; cost?: string; most?: number | null };
export const withBuy = (d: Definition, i: number, patch: BuyPatch): Definition => {
  const s = spendSet(d);
  return write(d, {
    ...s,
    buys: s.buys.map((b, n) => {
      if (n !== i) return b;
      const next: Buy = { ...b };
      if (patch.stats !== undefined) { if (patch.stats === null) delete next.stats; else next.stats = patch.stats; }
      if (patch.most !== undefined) { if (patch.most === null) delete next.most; else next.most = patch.most; }
      if (patch.list !== undefined) next.list = patch.list;
      if (patch.cost !== undefined) next.cost = patch.cost;
      return next;
    }),
  });
};
export const withBuyOff = (d: Definition, i: number): Definition => {
  const s = spendSet(d);
  return write(d, { ...s, buys: s.buys.filter((_, n) => n !== i) });
};
/** PURCHASES WAIT FOR THE GM. */
export const withWait = (d: Definition, wait: boolean): Definition => write(d, { ...spendSet(d), wait });

/** What a buy is called on the page: RAISE A STAT, AN OPTION. */
export const BUY_NAMES: Record<BuyWhat, string> = { stat: 'RAISE A STAT', option: 'AN OPTION' };

/** What the section says can't be bought yet, in the server's words where they are the same: a note for each. */
export const spendNotes = (d: Definition): string[] => {
  const s = spendSet(d);
  const groups = new Set(groupChoices(d).map((g) => g.id));
  const lists = new Map(choiceLists(d).map((c) => [c.id, c]));
  const notes: string[] = [];
  s.buys.forEach((b, i) => {
    const name = `${BUY_NAMES[b.what]} ${i + 1}`;
    if (!b.cost.trim()) notes.push(`${name}: write what it costs, a number or a formula`);
    if (b.what === 'stat' && b.stats !== undefined && !groups.has(b.stats)) notes.push(`${name}: no group of stats with stats in it is called ${b.stats}`);
    if (b.what === 'stat' && b.stats === undefined && !groups.size) notes.push(`${name}: there are no stats to raise. Make them on STATS & RULES`);
    if (b.what === 'option') {
      const c = b.list === undefined ? undefined : lists.get(b.list);
      if (!c) notes.push(`${name}: pick the list it buys from. Make one on CHOICES`);
      else if (c.levelled === true) notes.push(`${name}: ${c.many || c.id} goes up by LEVEL UP, never bought`);
    }
  });
  return notes;
};
