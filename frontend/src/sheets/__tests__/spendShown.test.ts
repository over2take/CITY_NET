import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { buyRows, ledgerRows, ledgerOf, spendTotals, spendWorkedOf, type SpendShown } from '../spendShown';
import type { ChoiceListShown } from '../choicesShown';

/**
 * SPEND XP on the sheet, as logic (7f2c1): XP unspent and the totals, a line for each thing XP buys with its price or why
 * not, and the ledger in words with the GM's actions. The prices are the server's own (backend spendXp.js spendWorked).
 */

const require_ = createRequire(import.meta.url);
const { spendShown, spendWorked, spendAction } = require_('../../../../backend/systemBuilder/spendXp.js');

const DEF = {
  format: 1, name: 'Spender', core: { health: { model: 'pool' }, advancement: ['spend'] },
  stats: [
    { id: 'attrs', label: 'Attributes', stats: [{ id: 'body', label: 'Body' }] },
    { id: 'skills', label: 'Skills', stats: [{ id: 'athletics', label: 'Athletics', rank: 'dots' }] },
  ],
  ranks: [{ id: 'dots', label: 'DOTS', list: [{ name: 'NONE', worth: '0' }, { name: 'ONE', worth: '1' }, { name: 'TWO', worth: '2' }] }],
  choices: [{ id: 'feats', one: 'Feat', many: 'Feats', picks: 'any', options: [{ id: 'alert', label: 'Alert' }, { id: 'tough', label: 'Tough', requires: '@body >= 3' }] }],
  spend: { buys: [
    { id: 'attrs_up', what: 'stat', stats: 'attrs', cost: '@new * 5', most: 4 },
    { id: 'skills_up', what: 'stat', stats: 'skills', cost: '@new * 2' },
    { id: 'feats', what: 'option', list: 'feats', cost: '10' },
  ], wait: true },
};
const SHOWN: SpendShown = spendShown(DEF);
const LISTS = [{ id: 'feats', one: 'Feat', many: 'Feats', picks: 'any', again: false, levelled: false, options: [{ id: 'alert', label: 'Alert' }, { id: 'tough', label: 'Tough' }] }] as unknown as ChoiceListShown[];
/** A sheet as a save leaves it: the server's prices on `_worked.spend`. */
const saved = (data: Record<string, unknown>) => ({ ...data, _worked: { spend: spendWorked(DEF, data) } });
const bought = (data: Record<string, unknown>, buy: string, target: string, gm = false) => spendAction(DEF, data, { kind: 'buy', buy, target }, { gm, now: 1 }).data;

describe('what the server worked out', () => {
  it('read from the last save, or nothing before one; the ledger whole entries only', () => {
    expect(spendWorkedOf({})).toBeNull();
    expect(spendWorkedOf({ _worked: { spend: { unspent: 'x', prices: {} } } })).toBeNull();
    expect(spendWorkedOf(saved({ _xp: 20 }))?.unspent).toBe(20);
    expect(ledgerOf({ _spent: [{ n: 1, buy: 'a', what: 'stat', target: 'body', cost: 5, state: 'done' }, { n: 2, cost: 1, state: 'done' }, { n: 3, buy: 'a', target: 'x', cost: 1, state: 'lost' }, 'x'] }).map((e) => e.n)).toEqual([1]);
    expect(ledgerOf(null)).toEqual([]);
  });

  it('the totals: awarded, spent, waiting', () => {
    const data = bought(bought({ _xp: 40, body: 2 }, 'attrs_up', 'body', true), 'feats', 'alert');
    expect(spendTotals(data)).toEqual({ awarded: 40, spent: 15, waiting: 10 });
    expect(spendTotals({})).toEqual({ awarded: 0, spent: 0, waiting: 0 });
  });
});

describe('what XP buys, a line each', () => {
  it('a stat where it is and its price to the next, a rank by name, an option by its list; BUY while it can be bought', () => {
    const rows = buyRows(SHOWN, LISTS, saved({ _xp: 12, body: 2, athletics_rank: '1' }), 'XP', true);
    expect(rows).toEqual([
      { buy: 'attrs_up', target: 'body', name: 'BODY', now: '2', price: 'TO 3: 15 XP', can: false, why: 'NOT ENOUGH XP' },
      { buy: 'skills_up', target: 'athletics', name: 'ATHLETICS', now: 'ONE', price: 'TO TWO: 4 XP', can: true, why: null },
      { buy: 'feats', target: 'alert', name: 'FEAT · ALERT', now: null, price: '10 XP', can: true, why: null },
      { buy: 'feats', target: 'tough', name: 'FEAT · TOUGH', now: null, price: 'Tough needs BODY >= 3', can: false, why: null },
    ]);
  });

  it('why not: the server\'s words, waiting for the GM, not enough; nothing at all where the sheet can\'t be changed', () => {
    const data = saved(bought({ _xp: 40, body: 4, athletics_rank: '2' }, 'feats', 'alert'));
    const rows = buyRows(SHOWN, LISTS, data, 'KARMA', true);
    expect(rows.find((r) => r.target === 'body')).toMatchObject({ price: 'Body stops at 4', can: false });
    expect(rows.find((r) => r.target === 'athletics')).toMatchObject({ price: 'Athletics is at its top rank, TWO', can: false });
    expect(rows.find((r) => r.target === 'alert')).toMatchObject({ price: '10 KARMA', can: false, why: 'WAITING FOR THE GM' });
    expect(rows.find((r) => r.target === 'tough')).toMatchObject({ can: true });
    expect(buyRows(SHOWN, LISTS, data, 'XP', false).some((r) => r.can)).toBe(false);
  });

  it('nothing before a save has priced it, nor without a price list; a stat or option with no price left out', () => {
    expect(buyRows(SHOWN, LISTS, { _xp: 9 }, 'XP', true)).toEqual([]);
    expect(buyRows(null, LISTS, saved({ _xp: 9 }), 'XP', true)).toEqual([]);
    const some = { _xp: 9, _worked: { spend: { unspent: 9, prices: { feats: { alert: { cost: 1 } } } } } };
    expect(buyRows(SHOWN, LISTS, some, 'XP', true).map((r) => r.target)).toEqual(['alert']);
    // A list the sheet isn't told of: nothing to name its options by.
    expect(buyRows(SHOWN, [], saved({ _xp: 9 }), 'XP', true).map((r) => r.buy)).toEqual(['attrs_up', 'skills_up']);
  });
});

describe('the ledger', () => {
  it('newest first, in words, by the GM or the character; the GM\'s actions by its state', () => {
    let data: Record<string, unknown> = { name: 'Wren', _xp: 60, body: 2, athletics_rank: '0' };
    data = bought(data, 'attrs_up', 'body', true);
    data = bought(data, 'skills_up', 'athletics');
    data = bought(data, 'feats', 'alert');
    data = spendAction(DEF, data, { kind: 'decline', entry: 3 }, { gm: true }).data;
    data = spendAction(DEF, data, { kind: 'approve', entry: 2 }, { gm: true }).data;
    data = spendAction(DEF, data, { kind: 'undo', entry: 2 }, { gm: true }).data;
    // Body 3 now, by the GM's purchase, so Tough is met.
    data = bought(data, 'feats', 'tough');
    expect(ledgerRows(SHOWN, LISTS, data, 'XP', true)).toEqual([
      { n: 4, what: 'FEAT · TOUGH', cost: '10 XP', by: 'WREN', state: 'pending', actions: ['approve', 'decline'] },
      { n: 3, what: 'FEAT · ALERT', cost: '10 XP', by: 'WREN', state: 'declined', actions: [] },
      { n: 2, what: 'ATHLETICS NONE → ONE', cost: '2 XP', by: 'WREN', state: 'undone', actions: [] },
      { n: 1, what: 'BODY 2 → 3', cost: '15 XP', by: 'THE GM', state: 'done', actions: ['undo'] },
    ]);
    // A player sees no actions.
    expect(ledgerRows(SHOWN, LISTS, data, 'XP', false).every((r) => !r.actions.length)).toBe(true);
  });

  it('what it no longer knows by its id; a nameless character as THE PLAYER', () => {
    const data = { _spent: [
      { n: 1, buy: 'x', what: 'stat', target: 'gone', from: 1, to: 2, cost: 3, by: 'player', state: 'done' },
      { n: 2, buy: 'y', what: 'option', list: 'lost', target: 'thing', cost: 3, by: 'player', state: 'done' },
      { n: 3, buy: 'z', what: 'stat', target: 'body', cost: 3, by: 'player', state: 'done' },
    ] };
    expect(ledgerRows(SHOWN, LISTS, data, 'XP', false).map((r) => [r.what, r.by])).toEqual([['BODY ? → ?', 'THE PLAYER'], ['LOST · THING', 'THE PLAYER'], ['GONE 1 → 2', 'THE PLAYER']]);
    expect(ledgerRows(null, [], data, 'XP', false)[2].what).toBe('GONE 1 → 2');
  });
});

describe('the edges', () => {
  it('a purchase with a buy but no target passed over; a rank past either end read as the end; all that is unspent may be spent', () => {
    expect(ledgerOf({ _spent: [{ n: 1, buy: 'a', what: 'stat', cost: 1, state: 'done' }] })).toEqual([]);
    const ranks = buyRows(SHOWN, LISTS, saved({ _xp: 0, athletics_rank: '7' }), 'XP', true).find((r) => r.target === 'athletics');
    expect(ranks?.now).toBe('TWO');
    expect(buyRows(SHOWN, LISTS, saved({ _xp: 0, athletics_rank: '-2' }), 'XP', true).find((r) => r.target === 'athletics')?.now).toBe('NONE');
    expect(buyRows(SHOWN, LISTS, saved({ _xp: 15, body: 2 }), 'XP', true).find((r) => r.target === 'body')).toMatchObject({ price: 'TO 3: 15 XP', can: true, why: null });
  });

  it('a stat in the ledger by its label', () => {
    const shown: SpendShown = { buys: [{ id: 'x', what: 'stat', stats: [{ id: 'grit', label: 'True Grit' }] }], wait: false };
    const data = { _spent: [{ n: 1, buy: 'x', what: 'stat', target: 'grit', from: 1, to: 2, cost: 1, by: 'gm', state: 'done' }] };
    expect(ledgerRows(shown, [], data, 'XP', false)[0].what).toBe('TRUE GRIT 1 → 2');
  });
});
