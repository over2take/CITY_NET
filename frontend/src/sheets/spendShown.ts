// SPEND XP on the sheet, as logic (7f2c1; approved mockup docs/mockups/ranks-and-xp.html, 2026-11-12): XP unspent, a
// line for each thing XP buys with its price or why it can't be bought, and the ledger of what was bought, newest first,
// with the GM's APPROVE, DECLINE and UNDO. The server works every price out (backend spendXp.js spendWorked, written on
// `_worked.spend` with each save) and settles every purchase (spendAction); nothing is priced or checked here. Pure, so
// SpendSection only draws it.

import type { ChoiceListShown } from './choicesShown';

/** What XP buys, by name (backend spendXp.js spendShown). */
export interface BuyShown {
  id: string; what: 'stat' | 'option';
  stats?: { id: string; label: string; ranks?: string[] }[]; most?: number;
  list?: string; one?: string; many?: string;
}
export interface SpendShown { buys: BuyShown[]; wait: boolean }
/** One price as the server worked it out: what it costs, a stat's step from and to (a rank's names too), or why not. */
export interface Price { cost?: number; from?: number; to?: number; fromName?: string; toName?: string; error?: string }
/** One purchase in the sheet's ledger (backend spendXp.js SPENT_KEY). */
export interface Purchase {
  n: number; buy: string; what: 'stat' | 'option'; target: string; list?: string; from?: number; to?: number;
  cost: number; by: 'gm' | 'player'; at?: number; state: 'done' | 'pending' | 'undone' | 'declined';
}
/** What the sheet asks the server: a purchase, or the GM settling one. */
export type SpendAction = { kind: 'buy'; buy: string; target: string } | { kind: 'undo' | 'approve' | 'decline'; entry: number };

export const SPENT_KEY = '_spent';
const STATES = ['done', 'pending', 'undone', 'declined'];

type Data = Record<string, unknown> | null | undefined;
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** What the server last worked out: XP unspent and each price, or null before a save has. */
export const spendWorkedOf = (data: Data): { unspent: number; prices: Record<string, Record<string, Price>> } | null => {
  const worked = isObject(data) && isObject(data._worked) && isObject(data._worked.spend) ? data._worked.spend : null;
  return worked && typeof worked.unspent === 'number' && isObject(worked.prices)
    ? { unspent: worked.unspent, prices: worked.prices as Record<string, Record<string, Price>> } : null;
};

/** The ledger as kept, those purchases whole enough to show, oldest first. */
export const ledgerOf = (data: Data): Purchase[] => (isObject(data) && Array.isArray(data[SPENT_KEY]) ? data[SPENT_KEY] as unknown[] : [])
  .filter((e): e is Purchase => isObject(e) && Number.isInteger(e.n) && Number.isInteger(e.cost) && STATES.includes(String(e.state))
    && typeof e.buy === 'string' && typeof e.target === 'string');

/** The totals line: XP awarded, spent, and waiting for the GM. */
export const spendTotals = (data: Data) => {
  const ledger = ledgerOf(data);
  const sum = (state: Purchase['state']) => ledger.filter((e) => e.state === state).reduce((n, e) => n + e.cost, 0);
  return { awarded: Math.round(num(isObject(data) ? data._xp : 0)), spent: sum('done'), waiting: sum('pending') };
};

/** One line of what XP buys: its name, where it is now, its price or why it can't be bought, and whether BUY goes. */
export interface BuyRow { buy: string; target: string; name: string; now: string | null; price: string; can: boolean; why: string | null }

/** A ranked stat's rank at a step, or the step itself where there are no names for it. */
const rankAt = (ranks: string[], step: number) => ranks[Math.min(ranks.length - 1, Math.max(0, Math.round(step)))] ?? String(step);

/**
 * Every line of what XP buys on this sheet: each stat of a RAISE A STAT, each option of AN OPTION's list (named from
 * the sheet's lists). `word` is what the system calls XP; `active` whether BUY can be pressed at all.
 */
export const buyRows = (shown: SpendShown | null | undefined, lists: ChoiceListShown[], data: Data, word: string, active: boolean): BuyRow[] => {
  const worked = spendWorkedOf(data);
  if (!shown || !worked) return [];
  const pending = ledgerOf(data).filter((e) => e.state === 'pending');
  const sheet = isObject(data) ? data : {};
  return shown.buys.flatMap((b) => {
    const prices = worked.prices[b.id] ?? {};
    const targets = b.what === 'stat'
      ? (b.stats ?? []).map((s) => ({
        id: s.id, name: s.label.toUpperCase(),
        now: s.ranks?.length ? rankAt(s.ranks, num(sheet[`${s.id}_rank`])) : String(num(sheet[s.id])),
      }))
      : (lists.find((l) => l.id === b.list)?.options ?? []).map((o) => ({ id: o.id, name: `${String(b.one ?? b.list).toUpperCase()} · ${String(o.label || o.id).toUpperCase()}`, now: null }));
    return targets.filter((t) => prices[t.id]).map((t) => {
      const p = prices[t.id];
      const waits = pending.some((e) => e.what === b.what && e.target === t.id);
      const cost = p.cost ?? 0;
      const priced = p.error ?? (b.what === 'stat' ? `TO ${p.toName ?? p.to}: ${cost} ${word}` : `${cost} ${word}`);
      const why = p.error ? null : waits ? 'WAITING FOR THE GM' : cost > worked.unspent ? `NOT ENOUGH ${word}` : null;
      return { buy: b.id, target: t.id, name: t.name, now: t.now, price: priced, can: active && !p.error && !why, why };
    });
  });
};

/** One line of the ledger: what was bought, its cost, who bought it, its state, and what the GM may do with it. */
export interface LedgerRow { n: number; what: string; cost: string; by: string; state: Purchase['state']; actions: ('approve' | 'decline' | 'undo')[] }

/** The ledger, newest first, in words: "ATHLETICS TRAINED → EXPERT", "FEAT · ALERT"; the GM's own BY THE GM. */
export const ledgerRows = (shown: SpendShown | null | undefined, lists: ChoiceListShown[], data: Data, word: string, gm: boolean): LedgerRow[] => {
  const stats = new Map((shown?.buys ?? []).flatMap((b) => b.stats ?? []).map((s) => [s.id, s]));
  const name = isObject(data) && typeof data.name === 'string' && data.name.trim() ? data.name.trim().toUpperCase() : 'THE PLAYER';
  return ledgerOf(data).slice().reverse().map((e) => {
    let what: string;
    if (e.what === 'stat') {
      const s = stats.get(e.target);
      const at = (n: number | undefined) => (n === undefined ? '?' : s?.ranks?.length ? rankAt(s.ranks, n) : String(n));
      what = `${(s?.label ?? e.target).toUpperCase()} ${at(e.from)} → ${at(e.to)}`;
    } else {
      const list = lists.find((l) => l.id === e.list);
      const option = list?.options.find((o) => o.id === e.target);
      what = `${String(list?.one || e.list || '').toUpperCase()} · ${String(option?.label || e.target).toUpperCase()}`;
    }
    return {
      n: e.n, what, cost: `${e.cost} ${word}`, by: e.by === 'gm' ? 'THE GM' : name, state: e.state,
      actions: !gm ? [] : e.state === 'pending' ? ['approve', 'decline'] : e.state === 'done' ? ['undo'] : [],
    };
  });
};
