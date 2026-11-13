import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';
import { makeTestDb, run, get } from './helpers/testDb.js';
import { drain, until } from './helpers/until.js';

/**
 * SPEND XP's price list (7f2a1; approved mockup docs/mockups/ranks-and-xp.html, 2026-11-12): what XP buys, RAISE A STAT
 * IN a group at a cost formula reading @old and @new, UP TO a most, a rank a step at a time to its top rank; AN OPTION
 * FROM a list that isn't levelled, never one held, its requirement met; checked, carried in the system file, told to the
 * sheet by name; and XP given where it is spent, though no level is earned by it.
 */

const require_ = createRequire(import.meta.url);
const { checkDefinition } = require_('../systemBuilder/definition');
const { spendOf, spendShown, priceOf, costOn } = require_('../systemBuilder/spendXp');
const { keepsXp, earnsXp, levelsShown, XP_KEY } = require_('../systemBuilder/levels');
const { PICKS_KEY } = require_('../systemBuilder/choices');
const { buildFile, readFile } = require_('../systemBuilder/citysys');
const { versionChanges } = require_('../systemBuilder/versionDiff');
const { xpLines } = require_('../systemBuilder/sheetImport');
const { xpFieldFor } = require_('../sheets/awardXp');
const runtime = require_('../systemBuilder/runtime');
const socketsFactory = require_('../sockets/index.js');

const SPENDER = {
  format: 1, name: 'Spender', core: { health: { model: 'pool' }, advancement: ['spend'] },
  stats: [
    { id: 'attrs', label: 'ATTRIBUTES', stats: [{ id: 'body', label: 'Body' }] },
    { id: 'skills', label: 'SKILLS', stats: [{ id: 'athletics', label: 'Athletics', rank: 'dots' }, { id: 'lore', label: 'Lore' }] },
  ],
  ranks: [{ id: 'dots', label: 'DOTS', list: [{ name: 'NONE', worth: '0' }, { name: 'ONE', worth: '1' }, { name: 'TWO', worth: '2' }] }],
  choices: [
    { id: 'feats', one: 'Feat', many: 'Feats', picks: 'any', options: [
      { id: 'alert', label: 'Alert', features: [{ id: 'alertness', label: 'Alertness', modifiers: [{ target: 'body', amount: '2' }] }] },
      { id: 'tough', label: 'Tough', requires: '@body >= 3' },
    ] },
    { id: 'classes', one: 'Class', many: 'Classes', levelled: true, options: [{ id: 'mage', label: 'Mage' }] },
  ],
  spend: {
    buys: [
      { id: 'attrs_up', what: 'stat', stats: 'attrs', cost: '@new * 5', most: 6 },
      { id: 'skills_up', what: 'stat', stats: 'skills', cost: '@new * 2 + @old' },
      { id: 'feats', what: 'option', list: 'feats', cost: '12 - @body * 2.5' },
    ],
    wait: true,
  },
};
const withBuys = (buys, more = {}) => ({ ...SPENDER, spend: { buys, ...more } });
const problemsOf = (def) => checkDefinition(def).problems.filter((p) => p.where.startsWith('spend'));

describe('the price list, checked', () => {
  it('a sound one has no problems, and reads as written', () => {
    expect(checkDefinition(SPENDER).problems).toEqual([]);
    expect(spendOf(SPENDER)).toEqual({ buys: SPENDER.spend.buys, wait: true });
    // Every stat, no group named; waiting off when unsaid.
    expect(problemsOf(withBuys([{ id: 'any', what: 'stat', cost: '@new' }]))).toEqual([]);
    expect(spendOf(withBuys([])).wait).toBe(false);
    expect(spendOf({})).toEqual({ buys: [], wait: false });
    // A draft's buy not yet whole is passed over; waiting is on only when it says so.
    const good = { id: 'g', what: 'stat', cost: '1' };
    expect(spendOf(withBuys([{ id: 'a', what: 'thing', cost: '1' }, { id: 'b', what: 'stat' }, { what: 'stat', cost: '1' }, 'x', good], { wait: 'yes' }))).toEqual({ buys: [good], wait: false });
  });

  it('the section and its switch', () => {
    expect(problemsOf({ ...SPENDER, spend: 'x' })).toEqual([{ where: 'spend', message: 'Must say what XP buys' }]);
    expect(problemsOf({ ...SPENDER, spend: { buys: 'x', wait: 1, other: true } })).toEqual([
      { where: 'spend, other', message: 'Not part of SPEND XP' },
      { where: 'spend, wait', message: 'On or off' },
      { where: 'spend, buys', message: 'Must be a list of what XP buys' },
    ]);
    // Those past the most aren't read one by one.
    const many = [...Array.from({ length: 20 }, (_, i) => ({ id: `b${i}`, what: 'stat', cost: '1' })), { id: 'past', what: 'thing' }];
    expect(problemsOf(withBuys(many))).toEqual([{ where: 'spend, buys', message: 'At most 20' }]);
  });

  it('each buy: its id, what it is, and what belongs to it', () => {
    expect(problemsOf(withBuys(['x']))).toEqual([{ where: 'spend, buy 1', message: 'Must say what it buys' }]);
    expect(problemsOf(withBuys([{ id: 'Bad', what: 'stat', cost: '1' }, { id: 'b', what: 'stat', cost: '1' }, { id: 'b', what: 'stat', cost: '1' }]))).toEqual([
      { where: 'spend, buy Bad', message: 'Its id must start with a letter: lowercase letters, digits and _' },
      { where: 'spend, buy b', message: 'Named twice' },
    ]);
    expect(problemsOf(withBuys([{ id: 'b', what: 'thing', cost: '1' }]))).toEqual([{ where: 'spend, buy b, what', message: 'RAISE A STAT or AN OPTION' }]);
    expect(problemsOf(withBuys([{ id: 'b', what: 'stat', cost: '1', list: 'feats' }, { id: 'c', what: 'option', list: 'feats', cost: '1', most: 3 }]))).toEqual([
      { where: 'spend, buy b, list', message: 'Not part of RAISE A STAT' },
      { where: 'spend, buy c, most', message: 'Not part of AN OPTION' },
    ]);
  });

  it('RAISE A STAT: a group there is, with stats, and UP TO a whole number', () => {
    expect(problemsOf(withBuys([{ id: 'b', what: 'stat', stats: 'nope', cost: '1', most: 1.5 }]))).toEqual([
      { where: 'spend, buy b, stats', message: 'No group of stats is called nope' },
      { where: 'spend, buy b, most', message: 'UP TO is a whole number' },
    ]);
    const empty = { ...withBuys([{ id: 'b', what: 'stat', stats: 'none', cost: '1', most: -3 }]), stats: [...SPENDER.stats, { id: 'none', label: 'NONE', stats: [] }] };
    expect(problemsOf(empty)).toEqual([{ where: 'spend, buy b, stats', message: 'There are no stats to raise' }]);
    expect(problemsOf(withBuys([{ id: 'b', what: 'stat', cost: '1', most: 1000001 }]))).toEqual([{ where: 'spend, buy b, most', message: 'UP TO is a whole number' }]);
  });

  it('AN OPTION: a list there is, never a levelled one', () => {
    expect(problemsOf(withBuys([{ id: 'b', what: 'option', cost: '1' }, { id: 'c', what: 'option', list: 'nope', cost: '1' }, { id: 'd', what: 'option', list: 'classes', cost: '1' }]))).toEqual([
      { where: 'spend, buy b, list', message: 'Pick the list it buys from' },
      { where: 'spend, buy c, list', message: 'No list is called nope' },
      { where: 'spend, buy d, list', message: 'Classes goes up by LEVEL UP, never bought' },
    ]);
  });

  it('a cost: written, short, a formula, naming what a sheet has; @old and @new a stat\'s alone', () => {
    const cost = (c, what = 'stat') => problemsOf(withBuys([{ id: 'b', what, ...(what === 'option' ? { list: 'feats' } : {}), ...(c === undefined ? {} : { cost: c }) }]));
    expect(cost(undefined)).toEqual([{ where: 'spend, buy b, cost', message: 'Write what it costs: a number or a formula' }]);
    expect(cost('  ')).toEqual([{ where: 'spend, buy b, cost', message: 'Write what it costs: a number or a formula' }]);
    expect(cost('1'.repeat(1001))).toEqual([{ where: 'spend, buy b, cost', message: 'At most 1000 characters' }]);
    expect(cost('@new *')[0].where).toBe('spend, buy b, cost');
    expect(cost('@new + @old + @body + @lore + @athletics')).toEqual([]);
    expect(cost('@nope * 2')).toEqual([{ where: 'spend, buy b, cost', message: '@nope: no stat or formula is called that' }]);
    expect(cost('@new + @old', 'option')).toEqual([
      { where: 'spend, buy b, cost', message: '@new is a stat\'s, read only by RAISE A STAT' },
      { where: 'spend, buy b, cost', message: '@old is a stat\'s, read only by RAISE A STAT' },
    ]);
    expect(cost('if(has(alert), 5, 10)', 'option')).toEqual([]);
    expect(cost('if(has(nope), 5, 10)', 'option')).toEqual([{ where: 'spend, buy b, cost', message: 'has(nope): no option or feature is called that' }]);
  });
});

describe('the sheet is told it', () => {
  it('by name, never a formula; an option\'s list named', () => {
    expect(spendShown(SPENDER)).toEqual({
      buys: [
        { id: 'attrs_up', what: 'stat', stats: [{ id: 'body', label: 'Body' }], most: 6 },
        { id: 'skills_up', what: 'stat', stats: [{ id: 'athletics', label: 'Athletics', ranks: ['NONE', 'ONE', 'TWO'] }, { id: 'lore', label: 'Lore' }] },
        { id: 'feats', what: 'option', list: 'feats', one: 'Feat', many: 'Feats' },
      ],
      wait: true,
    });
    // A list gone, or levelled since: nothing to buy there.
    expect(spendShown(withBuys([{ id: 'x', what: 'option', list: 'classes', cost: '1' }, { id: 'y', what: 'option', list: 'gone', cost: '1' }])).buys).toEqual([]);
  });

  it('with the system\'s template, while XP is spent', async () => {
    const db = await makeTestDb();
    const def = JSON.stringify(SPENDER);
    const levelled = JSON.stringify({ ...SPENDER, core: { ...SPENDER.core, advancement: ['levels'] } });
    await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', ['sys_spenderspender12', 'Spender', def, def]);
    await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', ['sys_levelledlevelled', 'Levelled', levelled, levelled]);
    await new Promise((resolve) => runtime.load(db, resolve));
    expect(runtime.render('sys_spenderspender12').spend).toEqual(spendShown(SPENDER));
    expect(runtime.render('sys_levelledlevelled').spend).toBeNull();
  });
});

describe('what one purchase would be', () => {
  it('a number: its cost reading @old and @new, UP TO stopping it', () => {
    expect(priceOf(SPENDER, { body: 2 }, 'attrs_up', 'body')).toEqual({ cost: 15, from: 2, to: 3 });
    expect(priceOf(SPENDER, {}, 'attrs_up', 'body')).toEqual({ cost: 5, from: 0, to: 1 });
    expect(priceOf(SPENDER, { body: 5 }, 'attrs_up', 'body')).toEqual({ cost: 30, from: 5, to: 6 });
    expect(priceOf(SPENDER, { body: 6 }, 'attrs_up', 'body')).toEqual({ error: 'Body stops at 6' });
    // No UP TO: no end.
    expect(priceOf(SPENDER, { lore: 40 }, 'skills_up', 'lore')).toEqual({ cost: 122, from: 40, to: 41 });
  });

  it('a rank: a step at a time, its steps read, to its top rank', () => {
    expect(priceOf(SPENDER, { athletics_rank: '1' }, 'skills_up', 'athletics')).toEqual({ cost: 5, from: 1, to: 2, fromName: 'ONE', toName: 'TWO' });
    expect(priceOf(SPENDER, {}, 'skills_up', 'athletics')).toEqual({ cost: 2, from: 0, to: 1, fromName: 'NONE', toName: 'ONE' });
    expect(priceOf(SPENDER, { athletics_rank: '2' }, 'skills_up', 'athletics')).toEqual({ error: 'Athletics is at its top rank, TWO' });
    // A step below the lowest, or between two, read as a step there is.
    expect(priceOf(SPENDER, { athletics_rank: '-3' }, 'skills_up', 'athletics')).toMatchObject({ from: 0, to: 1 });
    expect(priceOf(SPENDER, { athletics_rank: '0.6' }, 'skills_up', 'athletics')).toMatchObject({ from: 1, to: 2 });
    // UP TO is a number's: a rank stops at its top alone.
    const capped = withBuys([{ id: 'skills_up', what: 'stat', stats: 'skills', cost: '1', most: 0 }]);
    expect(priceOf(capped, { athletics_rank: '1' }, 'skills_up', 'athletics')).toMatchObject({ cost: 1, to: 2 });
  });

  it('an option: its cost on the sheet, whole and never below 0; never one held, nor one whose requirement isn\'t met', () => {
    expect(priceOf(SPENDER, { body: 1 }, 'feats', 'alert')).toEqual({ cost: 10 });
    expect(priceOf(SPENDER, { body: 3 }, 'feats', 'tough')).toEqual({ cost: 5 });
    expect(priceOf(SPENDER, { body: 9 }, 'feats', 'alert')).toEqual({ cost: 0 });
    expect(priceOf(SPENDER, { body: 2 }, 'feats', 'tough')).toEqual({ error: 'Tough needs BODY >= 3' });
    expect(priceOf(SPENDER, { [PICKS_KEY]: { feats: ['alert'] } }, 'feats', 'alert')).toEqual({ error: 'Alert is taken already' });
    // The sheet as it reads, bonuses and all: Alertness's +2 makes Body 3, so Tough is met, at 12 - 7.5.
    expect(priceOf(SPENDER, { body: 1, [PICKS_KEY]: { feats: ['alert'] } }, 'feats', 'tough')).toEqual({ cost: 5 });
  });

  it('nothing to buy: no such buy, a stat or option not in it, a cost that can\'t be worked out', () => {
    expect(priceOf(SPENDER, {}, 'nope', 'body')).toEqual({ error: 'XP buys nothing called that' });
    expect(priceOf(SPENDER, {}, 'attrs_up', 'lore')).toEqual({ error: 'That stat isn\'t raised here' });
    expect(priceOf(SPENDER, {}, 'feats', 'mage')).toEqual({ error: 'That isn\'t one of Feats' });
    // A list levelled, or gone, since.
    expect(priceOf(withBuys([{ id: 'x', what: 'option', list: 'classes', cost: '1' }]), {}, 'x', 'mage')).toEqual({ error: 'That isn\'t one of Classes' });
    expect(priceOf(withBuys([{ id: 'x', what: 'option', list: 'gone', cost: '1' }]), {}, 'x', 'mage')).toEqual({ error: 'That isn\'t one of its list' });
    // A draft's cost that isn't a formula yet (a published one always is).
    const broken = withBuys([{ id: 'a', what: 'stat', cost: '@old *' }, { id: 'f', what: 'option', list: 'feats', cost: '@body *' }]);
    expect(priceOf(broken, {}, 'a', 'body')).toEqual({ error: 'Its cost can\'t be worked out' });
    expect(priceOf(broken, {}, 'a', 'athletics')).toEqual({ error: 'Its cost can\'t be worked out' });
    expect(priceOf(broken, {}, 'f', 'alert')).toEqual({ error: 'Its cost can\'t be worked out' });
    expect(costOn(SPENDER, {}, '@body *')).toBeNull();
    // Worked out, it is always a number: 1 / 0 reads 0, as every formula does.
    expect(costOn(SPENDER, {}, '1 / @body')).toBe(0);
  });
});

describe('the system file', () => {
  it('carries the price list beside the definition, and back unchanged', () => {
    const file = buildFile({ definition: SPENDER, version: 1, origin: 'sys_spenderspender12' });
    expect(file.spend).toEqual(SPENDER.spend);
    expect(file.definition).not.toHaveProperty('spend');
    const read = readFile(JSON.stringify(file));
    expect(read.problems).toEqual([]);
    expect(read.file.definition.spend).toEqual(SPENDER.spend);
  });

  it('a new version says the price list changed', () => {
    expect(versionChanges(SPENDER, withBuys([]))).toEqual([{ kind: 'other', change: 'changed', id: 'spend' }]);
  });
});

describe('XP where it is spent', () => {
  const MILESTONE = { ...SPENDER, core: { ...SPENDER.core, advancement: ['milestone'] } };
  const OFF = { ...SPENDER, parts: { xp: { on: false } } };

  it('is given, though it earns no level and shows no meter', () => {
    expect(keepsXp(SPENDER)).toBe(true);
    expect(keepsXp({ ...SPENDER, core: { advancement: ['levels'] } })).toBe(true);
    expect(keepsXp(MILESTONE)).toBe(false);
    expect(keepsXp(OFF)).toBe(false);
    expect(keepsXp(null)).toBe(false);
    expect(earnsXp(SPENDER)).toBe(false);
    expect(levelsShown(SPENDER)).toBeNull();
    // AWARD XP and SET TO write it; the sheet import asks for it.
    expect(xpFieldFor('sys_spenderspender12', SPENDER)).toBe(XP_KEY);
    expect(xpFieldFor('sys_x', MILESTONE)).toBeNull();
    expect(xpLines(SPENDER).map((l) => l.id)).toEqual([XP_KEY]);
    expect(xpLines(MILESTONE)).toEqual([]);
  });

  it('an upload brings it', async () => {
    const db = await makeTestDb();
    const ID = 'sys_spentspentspent1';
    const def = JSON.stringify(SPENDER);
    await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', [ID, 'Spender', def, def]);
    await new Promise((resolve) => runtime.load(db, resolve));
    await run(db, 'INSERT INTO global_settings (key, value) VALUES (\'game_system\', ?)', [ID]);
    await run(db, 'INSERT INTO character_sheets (username, system, data, is_npc) VALUES (\'kes\', ?, ?, 0)', [ID, JSON.stringify({ name: 'Kes' })]);
    let connection;
    socketsFactory({ on: (e, cb) => { if (e === 'connection') connection = cb; }, emit: () => {}, to: () => ({ emit: () => {} }) },
      db, { elevatedUsers: new Set(), emitUpdate: vi.fn(), recordAction: vi.fn() });
    const handlers = {};
    connection({ id: 'spend-kes', on: (e, fn) => { handlers[e] = fn; }, emit: () => {}, broadcast: { emit: () => {} }, use: () => {}, join: () => {}, disconnect: () => {} });
    handlers.identify('kes');
    await drain(db);
    const stored = async () => JSON.parse((await get(db, 'SELECT data FROM character_sheets WHERE username = ?', ['kes'])).data);
    handlers.importSheetFields({ fields: { name: 'Kestrel', [XP_KEY]: '1,250' }, replace: true });
    await until(async () => (await stored()).name === 'Kestrel', { label: 'uploaded' });
    expect((await stored())[XP_KEY]).toBe(1250);
  });
});
