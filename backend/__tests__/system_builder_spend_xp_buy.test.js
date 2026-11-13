import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';
import jwt from 'jsonwebtoken';
import { makeTestDb, run, get } from './helpers/testDb.js';
import { drain, until } from './helpers/until.js';

/**
 * SPEND XP, buying (7f2a2; approved mockup docs/mockups/ranks-and-xp.html, 2026-11-12): a purchase from the price list,
 * paid from XP unspent and kept in the sheet's ledger; a stat raised, a rank a step, an option picked and always
 * counting; PURCHASES WAIT FOR THE GM, the GM's APPROVE, DECLINE and UNDO; over the socket; and the sheet told what is
 * unspent and what each next purchase costs.
 */

const require_ = createRequire(import.meta.url);
const { spendAction, spendWorked, priceOf, ledgerOf, unspentOf, spendsXp, SPENT_KEY, LIMITS } = require_('../systemBuilder/spendXp');
const { PICKS_KEY, heldOf, WORKED_KEY } = require_('../systemBuilder/choices');
const { pickAction } = require_('../systemBuilder/picking');
const { XP_KEY } = require_('../systemBuilder/levels');
const { checkDefinition } = require_('../systemBuilder/definition');
const runtime = require_('../systemBuilder/runtime');
const templates = require_('../sheets/templates');
const socketsFactory = require_('../sockets/index.js');

const SPENDER = {
  format: 1, name: 'Spender', core: { health: { model: 'pool' }, advancement: ['spend'] },
  stats: [
    { id: 'attrs', label: 'ATTRIBUTES', stats: [{ id: 'body', label: 'Body' }] },
    { id: 'skills', label: 'SKILLS', stats: [{ id: 'athletics', label: 'Athletics', rank: 'dots' }] },
  ],
  ranks: [{ id: 'dots', label: 'DOTS', list: [{ name: 'NONE', worth: '0' }, { name: 'ONE', worth: '1' }, { name: 'TWO', worth: '2' }] }],
  choices: [
    { id: 'feats', one: 'Feat', many: 'Feats', picks: 1, options: [{ id: 'alert', label: 'Alert' }, { id: 'tough', label: 'Tough', requires: '@body >= 3' }, { id: 'quick', label: 'Quick' }] },
    { id: 'gifts', one: 'Gift', many: 'Gifts', picked: 'features', options: [{ id: 'sight', label: 'Sight' }] },
  ],
  spend: {
    buys: [
      { id: 'attrs_up', what: 'stat', stats: 'attrs', cost: '@new * 5', most: 4 },
      { id: 'skills_up', what: 'stat', stats: 'skills', cost: '@new * 2' },
      { id: 'feats', what: 'option', list: 'feats', cost: '10' },
      { id: 'gifts', what: 'option', list: 'gifts', cost: '6' },
    ],
  },
};
const WAITS = { ...SPENDER, spend: { ...SPENDER.spend, wait: true } };
const NOW = 1763000000000;
const buy = (def, data, b, target, gm = false) => spendAction(def, data, { kind: 'buy', buy: b, target }, { gm, now: NOW });
const gmDoes = (def, data, kind, entry) => spendAction(def, data, { kind, entry }, { gm: true, now: NOW });

describe('buying', () => {
  it('the system is sound, and spends XP only where it says so, with the XP part on', () => {
    expect(checkDefinition(SPENDER).problems).toEqual([]);
    expect(spendsXp(SPENDER)).toBe(true);
    expect(spendsXp({ ...SPENDER, parts: { xp: { on: false } } })).toBe(false);
    expect(spendsXp({ ...SPENDER, core: { advancement: ['levels'] } })).toBe(false);
    expect(spendsXp(null)).toBe(false);
    expect(buy({ ...SPENDER, core: { advancement: ['levels'] } }, { [XP_KEY]: 99 }, 'attrs_up', 'body')).toEqual({ ok: false, error: 'XP isn\'t spent in this game' });
    // In the system's own word.
    expect(buy({ ...SPENDER, core: { advancement: [] }, words: { xp: { short: 'KARMA' } } }, {}, 'attrs_up', 'body').error).toBe('KARMA isn\'t spent in this game');
    expect(spendAction(SPENDER, {}, null).error).toBe('Nothing to do');
    expect(spendAction(SPENDER, {}, { kind: 'steal' }, { gm: true }).error).toBe('Nothing to do');
  });

  it('a stat: raised a step, paid from XP unspent, kept in the ledger', () => {
    const done = buy(SPENDER, { [XP_KEY]: 40, body: 2 }, 'attrs_up', 'body');
    const entry = { n: 1, buy: 'attrs_up', what: 'stat', target: 'body', from: 2, to: 3, cost: 15, by: 'player', at: NOW, state: 'done' };
    expect(done).toEqual({ ok: true, data: { [XP_KEY]: 40, body: 3, [SPENT_KEY]: [entry] }, entry });
    expect(unspentOf(done.data)).toBe(25);
    // XP itself is never lowered.
    expect(done.data[XP_KEY]).toBe(40);
    const again = buy(SPENDER, done.data, 'attrs_up', 'body');
    expect(again.entry).toMatchObject({ n: 2, from: 3, to: 4, cost: 20 });
    expect(unspentOf(again.data)).toBe(5);
  });

  it('a rank: a step, written as its picker writes it', () => {
    const done = buy(SPENDER, { [XP_KEY]: 10, athletics_rank: '1' }, 'skills_up', 'athletics');
    expect(done.data.athletics_rank).toBe('2');
    expect(done.entry).toMatchObject({ from: 1, to: 2, cost: 4 });
  });

  it('an option: picked, marked as bought, locked, and counting past what its list allows and however it is picked', () => {
    const start = { [XP_KEY]: 30, [PICKS_KEY]: { feats: ['alert'] } };
    const done = buy(SPENDER, start, 'feats', 'quick');
    expect(done.entry).toEqual({ n: 1, buy: 'feats', what: 'option', target: 'quick', list: 'feats', cost: 10, by: 'player', at: NOW, state: 'done' });
    expect(done.data[PICKS_KEY].feats).toEqual(['alert', { option: 'quick', locked: true, bought: 1 }]);
    const gift = buy(SPENDER, done.data, 'gifts', 'sight');
    const held = heldOf(SPENDER, gift.data);
    expect(held.map((p) => [p.option.id, p.active, p.bought])).toEqual([['alert', true, undefined], ['quick', true, 1], ['sight', true, 2]]);
    // A pick the list allows is still the list's: a bought one takes no room from it.
    const own = heldOf(SPENDER, { [PICKS_KEY]: { feats: [{ option: 'quick', locked: true, bought: 1 }, 'alert'] } });
    expect(own.map((p) => [p.option.id, p.active])).toEqual([['quick', true], ['alert', true]]);
    // Picking again keeps the mark.
    const picked = pickAction(SPENDER, { [PICKS_KEY]: { feats: [{ option: 'quick', locked: true, bought: 1 }] } }, { kind: 'pick', list: 'feats', option: 'alert' }, { gm: true });
    expect(picked.data[PICKS_KEY].feats).toEqual([{ option: 'quick', locked: true, bought: 1 }, { option: 'alert' }]);
  });

  it('never more than is unspent, nor what can\'t be bought', () => {
    expect(buy(SPENDER, { [XP_KEY]: 14, body: 2 }, 'attrs_up', 'body')).toEqual({ ok: false, error: 'That costs 15 XP, and 14 is unspent' });
    expect(buy(SPENDER, { [XP_KEY]: 15, body: 2 }, 'attrs_up', 'body').ok).toBe(true);
    expect(buy(SPENDER, { [XP_KEY]: 99, body: 4 }, 'attrs_up', 'body').error).toBe('Body stops at 4');
    expect(buy(SPENDER, { [XP_KEY]: 99, [PICKS_KEY]: { feats: ['alert'] } }, 'feats', 'alert').error).toBe('Alert is taken already');
    // No XP given yet.
    expect(buy(SPENDER, {}, 'feats', 'alert').error).toBe('That costs 10 XP, and 0 is unspent');
    const full = { [XP_KEY]: 99, [SPENT_KEY]: Array.from({ length: LIMITS.ledger }, (_, i) => ({ n: i + 1, buy: 'feats', what: 'option', target: 'x', cost: 0, state: 'undone' })) };
    expect(buy(SPENDER, full, 'feats', 'alert').error).toBe('No more purchases fit on this sheet');
  });

  it('the ledger read: only whole purchases, numbered on from the highest', () => {
    const messy = [{ n: 7, buy: 'feats', what: 'option', target: 'alert', cost: 3, state: 'done' }, 'x', { n: 'a', buy: 'feats', what: 'option', target: 'x', cost: 1, state: 'done' },
      { n: 9, buy: 'feats', target: 'x', cost: -1, state: 'done' }, { n: 9, buy: 'feats', target: 'x', cost: 1, state: 'lost' }, { n: 9, target: 'x', cost: 1, state: 'done' },
      { n: 9, buy: 'feats', cost: 1, state: 'done' }, { n: 8, buy: 'feats', what: 'option', target: 'quick', cost: 2, state: 'declined' }];
    expect(ledgerOf({ [SPENT_KEY]: messy }).map((e) => e.n)).toEqual([7, 8]);
    expect(unspentOf({ [XP_KEY]: '20', [SPENT_KEY]: messy })).toBe(17);
    // XP as a whole amount, however it was kept.
    expect(unspentOf({ [XP_KEY]: 20.6, [SPENT_KEY]: messy })).toBe(18);
    expect(ledgerOf(null)).toEqual([]);
    expect(buy(SPENDER, { [XP_KEY]: 20, [SPENT_KEY]: messy }, 'feats', 'tough').error).toBe('Tough needs BODY >= 3');
    expect(buy(SPENDER, { [XP_KEY]: 20, [SPENT_KEY]: messy }, 'feats', 'quick').entry.n).toBe(9);
  });
});

describe('purchases that wait for the GM', () => {
  it('a player\'s waits, its XP held and nothing raised; one waiting at a time on a stat or option', () => {
    const done = buy(WAITS, { [XP_KEY]: 40, body: 2 }, 'attrs_up', 'body');
    expect(done.entry.state).toBe('pending');
    expect(done.data.body).toBe(2);
    expect(unspentOf(done.data)).toBe(25);
    expect(buy(WAITS, done.data, 'attrs_up', 'body').error).toBe('Body waits for the GM already');
    const option = buy(WAITS, { [XP_KEY]: 40 }, 'feats', 'quick');
    expect(option.data[PICKS_KEY]).toBeUndefined();
    expect(buy(WAITS, option.data, 'feats', 'quick').error).toBe('Quick waits for the GM already');
    // Another stat or option goes on.
    expect(buy(WAITS, option.data, 'feats', 'alert').ok).toBe(true);
  });

  it('the GM\'s own never waits', () => {
    const done = buy(WAITS, { [XP_KEY]: 40, body: 2 }, 'attrs_up', 'body', true);
    expect(done.entry).toMatchObject({ state: 'done', by: 'gm' });
    expect(done.data.body).toBe(3);
  });

  it('APPROVE makes it, checked on the sheet as it is now; DECLINE gives its XP back', () => {
    const waiting = buy(WAITS, { [XP_KEY]: 40, body: 2 }, 'attrs_up', 'body').data;
    const approved = gmDoes(WAITS, waiting, 'approve', 1);
    expect(approved.ok).toBe(true);
    expect(approved.data.body).toBe(3);
    expect(approved.entry.state).toBe('done');
    expect(ledgerOf(approved.data)[0].state).toBe('done');
    expect(unspentOf(approved.data)).toBe(25);
    // Body typed up to its most meanwhile: not made.
    expect(gmDoes(WAITS, { ...waiting, body: 4 }, 'approve', 1).error).toBe('Body stops at 4');
    // An option: picked once approved.
    const option = gmDoes(WAITS, buy(WAITS, { [XP_KEY]: 40 }, 'feats', 'quick').data, 'approve', 1);
    expect(option.data[PICKS_KEY].feats).toEqual([{ option: 'quick', locked: true, bought: 1 }]);
    const declined = gmDoes(WAITS, waiting, 'decline', 1);
    expect(declined.data.body).toBe(2);
    expect(declined.entry.state).toBe('declined');
    expect(unspentOf(declined.data)).toBe(40);
    for (const kind of ['approve', 'decline']) expect(gmDoes(WAITS, approved.data, kind, 1).error).toBe('That purchase isn\'t waiting for the GM');
    // One settled, the others still wait.
    const twoWaiting = buy(WAITS, waiting, 'feats', 'quick').data;
    expect(ledgerOf(gmDoes(WAITS, twoWaiting, 'approve', 1).data).map((e) => e.state)).toEqual(['done', 'pending']);
    expect(ledgerOf(gmDoes(WAITS, twoWaiting, 'decline', 2).data).map((e) => e.state)).toEqual(['pending', 'declined']);
  });
});

describe('the GM\'s UNDO', () => {
  it('a stat a step down, its XP back; a rank never below its lowest; an option\'s pick gone, and only it', () => {
    const stat = buy(SPENDER, { [XP_KEY]: 40, body: 2 }, 'attrs_up', 'body');
    const undone = gmDoes(SPENDER, { ...stat.data, body: 1 }, 'undo', 1);
    expect(undone.data.body).toBe(0);
    expect(undone.entry.state).toBe('undone');
    expect(unspentOf(undone.data)).toBe(40);
    expect(gmDoes(SPENDER, undone.data, 'undo', 1).error).toBe('Only a purchase made can be undone');
    const rank = buy(SPENDER, { [XP_KEY]: 40, athletics_rank: '0' }, 'skills_up', 'athletics');
    expect(gmDoes(SPENDER, rank.data, 'undo', 1).data.athletics_rank).toBe('0');
    expect(gmDoes(SPENDER, { ...rank.data, athletics_rank: '0' }, 'undo', 1).data.athletics_rank).toBe('0');
    const two = buy(SPENDER, buy(SPENDER, { [XP_KEY]: 40, [PICKS_KEY]: { feats: ['alert'] } }, 'feats', 'quick').data, 'feats', 'tough');
    expect(two.error).toBe('Tough needs BODY >= 3');
    const both = buy(SPENDER, { ...buy(SPENDER, { [XP_KEY]: 40, body: 3, [PICKS_KEY]: { feats: ['alert'] } }, 'feats', 'quick').data }, 'feats', 'tough');
    expect(gmDoes(SPENDER, both.data, 'undo', 1).data[PICKS_KEY].feats).toEqual(['alert', { option: 'tough', locked: true, bought: 2 }]);
  });

  it('the GM\'s alone, on a purchase there is', () => {
    const stat = buy(SPENDER, { [XP_KEY]: 40, body: 2 }, 'attrs_up', 'body');
    for (const kind of ['undo', 'approve', 'decline']) expect(spendAction(SPENDER, stat.data, { kind, entry: 1 }).error).toBe('That is the GM\'s to do');
    expect(gmDoes(SPENDER, stat.data, 'undo', 2).error).toBe('No purchase has that number');
  });
});

describe('the sheet is told', () => {
  it('XP unspent, and what each next purchase costs or why it can\'t be bought', () => {
    const data = { [XP_KEY]: 30, body: 4, athletics_rank: '1', [PICKS_KEY]: { feats: ['alert'] }, [SPENT_KEY]: [{ n: 1, buy: 'feats', what: 'option', target: 'x', cost: 5, state: 'pending' }] };
    expect(spendWorked(SPENDER, data)).toEqual({
      unspent: 25,
      prices: {
        attrs_up: { body: { error: 'Body stops at 4' } },
        skills_up: { athletics: { cost: 4, from: 1, to: 2, fromName: 'ONE', toName: 'TWO' } },
        feats: { alert: { error: 'Alert is taken already' }, tough: { cost: 10 }, quick: { cost: 10 } },
        gifts: { sight: { cost: 6 } },
      },
    });
    // What the sheet holds read once for every price: handed in, it is what is read.
    expect(priceOf(SPENDER, data, 'feats', 'alert', { held: [] })).toEqual({ cost: 10 });
    // A buy whose list is gone has nothing to price.
    expect(spendWorked({ ...SPENDER, spend: { buys: [{ id: 'g', what: 'option', list: 'gone', cost: '1' }] } }, {}).prices).toEqual({ g: {} });
  });

  it('with every save, where XP is spent', async () => {
    const db = await makeTestDb();
    const def = JSON.stringify(SPENDER);
    const plain = JSON.stringify({ ...SPENDER, core: { ...SPENDER.core, advancement: ['levels'] }, spend: undefined });
    await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', ['sys_buyerbuyerbuyer1', 'Spender', def, def]);
    await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', ['sys_plainplainplain1', 'Plain', plain, plain]);
    await new Promise((resolve) => runtime.load(db, resolve));
    const data = { [XP_KEY]: 12, body: 1 };
    templates.applyDerived('sys_buyerbuyerbuyer1', data);
    expect(data[WORKED_KEY].spend).toEqual(spendWorked(SPENDER, data));
    expect(data[WORKED_KEY].spend.unspent).toBe(12);
    // Kept beside what the picks show.
    expect(data[WORKED_KEY].picks).toEqual([]);
    const other = { [XP_KEY]: 12 };
    templates.applyDerived('sys_plainplainplain1', other);
    expect(other[WORKED_KEY] && other[WORKED_KEY].spend).toBeUndefined();
  });
});

describe('over the socket', () => {
  it('a player buys and waits; the GM approves and undoes; a player can\'t', async () => {
    const db = await makeTestDb();
    const ID = 'sys_buysocketbuysock';
    const def = JSON.stringify(WAITS);
    await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', [ID, 'Waits', def, def]);
    await new Promise((resolve) => runtime.load(db, resolve));
    await run(db, 'INSERT INTO global_settings (key, value) VALUES (\'game_system\', ?)', [ID]);
    await run(db, 'INSERT INTO character_sheets (username, system, data, is_npc) VALUES (\'kes\', ?, ?, 0)', [ID, JSON.stringify({ name: 'Kes', [XP_KEY]: 40, body: 2 })]);
    let connection;
    socketsFactory({ on: (e, cb) => { if (e === 'connection') connection = cb; }, emit: () => {}, to: () => ({ emit: () => {} }) },
      db, { elevatedUsers: new Set(), emitUpdate: vi.fn(), recordAction: vi.fn() });
    const join = async (who, identity) => {
      const handlers = {};
      const said = [];
      connection({ id: `buy-${who}`, on: (e, fn) => { handlers[e] = fn; }, emit: (e, p) => said.push([e, p]), broadcast: { emit: () => {} }, use: () => {}, join: () => {}, disconnect: () => {} });
      handlers.identify(identity);
      await drain(db);
      return { handlers, said };
    };
    const stored = async () => JSON.parse((await get(db, 'SELECT data FROM character_sheets WHERE username = ?', ['kes'])).data);
    const kes = await join('kes', 'kes');
    kes.handlers.spendAction({ kind: 'buy', buy: 'attrs_up', target: 'body' });
    await until(async () => ledgerOf(await stored()).length === 1, { label: 'bought' });
    expect(ledgerOf(await stored())[0]).toMatchObject({ state: 'pending', by: 'player', cost: 15 });
    expect((await stored())[WORKED_KEY].spend.unspent).toBe(25);
    kes.handlers.spendAction({ kind: 'approve', entry: 1 });
    await until(() => kes.said.some(([e, p]) => e === 'choicesRefused' && p.error === 'That is the GM\'s to do'), { label: 'refused' });
    const GM = jwt.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, 'test-secret');
    const gm = await join('gm', { userName: 'gm', isAdmin: true, token: GM });
    gm.handlers.spendAction({ kind: 'approve', entry: 1, username: 'kes' });
    await until(async () => (await stored()).body === 3, { label: 'approved' });
    expect(ledgerOf(await stored())[0].state).toBe('done');
    gm.handlers.spendAction({ kind: 'undo', entry: 1, username: 'kes' });
    await until(async () => ledgerOf(await stored())[0].state === 'undone', { label: 'undone' });
    expect((await stored()).body).toBe(2);
    expect((await stored())[WORKED_KEY].spend.unspent).toBe(40);
  });
});

describe('the sheet\'s SPEND XP section (7f2c1)', () => {
  const { starterSheet, checkSheet, LAYOUTS } = require_('../systemBuilder/sheet');
  it('on the starter sheet\'s CHARACTER tab where XP is spent, named with the system\'s word; a layout a sheet may use', () => {
    expect(LAYOUTS).toContain('spend');
    expect(starterSheet(SPENDER).sections.filter((s) => s.layout === 'spend')).toEqual([{ id: 'spend', label: 'SPEND XP', layout: 'spend', tab: 'CHARACTER', fields: [] }]);
    expect(starterSheet({ ...SPENDER, words: { xp: { short: 'Karma' } } }).sections.find((s) => s.layout === 'spend').label).toBe('SPEND KARMA');
    for (const off of [{ ...SPENDER, core: { advancement: ['levels'] } }, { ...SPENDER, parts: { xp: { on: false } } }, { ...SPENDER, core: undefined }]) {
      expect(starterSheet(off).sections.some((s) => s.layout === 'spend')).toBe(false);
    }
    const problems = [];
    checkSheet({ tabs: ['CHARACTER'], sections: [{ id: 'spend', label: 'SPEND', layout: 'spend', tab: 'CHARACTER', fields: [] }] }, new Set(), problems);
    expect(problems).toEqual([]);
  });
});
