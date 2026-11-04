/**
 * ROLL FOR IT at the table (7a5b2; approved mockup docs/mockups/nested-choices.html, version 2): on a
 * list with a table, a roll lands on an option, kept on the sheet until it is taken; nothing is
 * picked. BY HAND OR ROLL: the roll suggests, any option can still be picked, and players may roll
 * again. BY ROLL ONLY: a player rolls once and takes what came up; rolling again and picking
 * anything are the GM's. BY HAND: no rolling for players. Rolled on the secure dice, a dice-log line
 * for everyone, the tray throwing it.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'module';
import jwt from 'jsonwebtoken';
import { makeTestDb, get, run } from './helpers/testDb.js';
import { drain, until } from './helpers/until.js';

process.env.JWT_SECRET = 'test-secret';
const require_ = createRequire(import.meta.url);
const { pickAction, rollLine } = require_('../systemBuilder/picking');
const { PICKS_KEY, ROLLED_KEY, rolledOn, rolledOf, choicesShown } = require_('../systemBuilder/choices');
const { checkDefinition } = require_('../systemBuilder/definition');
const runtime = require_('../systemBuilder/runtime');
const socketsFactory = (await import('../sockets/index.js')).default;

const bgs = (players, more = {}) => ({
  id: 'bgs', one: 'Background', many: 'Backgrounds', table: 'd6', ...(players ? { players } : {}), ...more, options: [
    { id: 'dock', label: 'Dockhand', roll: '1-2' }, { id: 'scribe', label: 'Scribe', roll: '3-4' }, { id: 'thief', label: 'Thief', roll: '5-6', requires: '@luck >= 3' },
  ],
});
const SPECIALTIES = { id: 'specs', one: 'Specialty', many: 'Specialties', picked: 'features', table: '2d6', players: 'roll', options: [
  { id: 'duelist', label: 'Duelist', roll: '2-7' }, { id: 'vanguard', label: 'Vanguard', roll: '8-12' },
] };
const SOLDIER = { id: 'classes', one: 'Class', many: 'Classes', levelled: true, options: [
  { id: 'soldier', label: 'Soldier', features: [{ id: 'specialty', label: 'Specialty', at: 1, choice: 'specs' }] },
] };
const system = (list) => ({ format: 1, name: 'Hearth', stats: [{ id: 'luck', label: 'LUCK', stats: [{ id: 'luck', label: 'Luck' }] }], choices: [list, SOLDIER, SPECIALTIES] });
/** Dice that come up as given: each value is the face, 1 to the die's sides. */
const faces = (sides, ...values) => { const q = [...values]; return () => (q.shift() - 1) / sides; };
const act = (list, data, action, opts = {}) => pickAction(system(list), data, action, opts);
const roll = (list, data, { gm = false, from, values = [3] } = {}) => act(list, data, { kind: 'roll', list: from ? 'specs' : 'bgs', ...(from ? { from } : {}) }, { gm, rng: faces(from ? 6 : 6, ...values) });

describe('the rules', () => {
  it('the systems check clean', () => {
    for (const p of [undefined, 'hand', 'roll']) expect(checkDefinition(system(bgs(p))).problems).toEqual([]);
  });

  it('a kept roll is read safely: anything else is no roll', () => {
    expect(rolledOf({ [ROLLED_KEY]: { bgs: { option: 'dock', roll: 2 } } }, 'bgs')).toEqual({ option: 'dock', roll: 2 });
    expect(rolledOf({ [ROLLED_KEY]: { bgs: { option: 3, roll: 2 } } }, 'bgs')).toEqual({ option: null, roll: 2 });
    for (const bad of [{ bgs: 'dock' }, { bgs: { option: 'dock', roll: '2' } }, { bgs: { option: 'dock' } }, 'x', null]) {
      expect(rolledOf({ [ROLLED_KEY]: bad }, 'bgs'), JSON.stringify(bad)).toBeNull();
    }
    expect(rolledOf(null, 'bgs')).toBeNull();
  });

  it('a roll lands on the option it is on, or none', () => {
    expect([1, 2, 3, 6].map((n) => rolledOn(bgs(), n)?.id)).toEqual(['dock', 'dock', 'scribe', 'thief']);
    expect([0, 7].map((n) => rolledOn(bgs(), n))).toEqual([null, null]);
  });

  it('BY HAND OR ROLL: the roll is kept, nothing picked; rolled again, and any option picked, which clears it', () => {
    const done = roll(bgs(), {}, { values: [4] });
    expect(done.ok).toBe(true);
    expect(done.data).toEqual({ [ROLLED_KEY]: { bgs: { option: 'scribe', roll: 4 } } });
    expect(done.rolled).toMatchObject({ dice: 'd6', sides: 6, rolls: [4], total: 4, option: { id: 'scribe' } });
    const again = roll(bgs(), done.data, { values: [1] });
    expect(rolledOf(again.data, 'bgs')).toEqual({ option: 'dock', roll: 1 });
    const picked = act(bgs(), again.data, { kind: 'pick', list: 'bgs', option: 'scribe' });
    expect(picked.data).toEqual({ [PICKS_KEY]: { bgs: [{ option: 'scribe' }] } });
  });

  it('BY ROLL ONLY: a player rolls once and takes what came up; the GM rolls again and picks anything', () => {
    const done = roll(bgs('roll'), {}, { values: [2] });
    expect(rolledOf(done.data, 'bgs')).toEqual({ option: 'dock', roll: 2 });
    expect(roll(bgs('roll'), done.data)).toEqual({ ok: false, error: 'Rolled already: take what came up, or ask the GM to roll again' });
    expect(act(bgs('roll'), done.data, { kind: 'pick', list: 'bgs', option: 'scribe' })).toEqual({ ok: false, error: 'The Backgrounds are picked by roll: ROLL FOR IT' });
    expect(act(bgs('roll'), {}, { kind: 'pick', list: 'bgs', option: 'dock' })).toEqual({ ok: false, error: 'The Backgrounds are picked by roll: ROLL FOR IT' });
    expect(act(bgs('roll'), done.data, { kind: 'pick', list: 'bgs', option: 'dock' }).data).toEqual({ [PICKS_KEY]: { bgs: [{ option: 'dock' }] } });
    const gmAgain = roll(bgs('roll'), done.data, { gm: true, values: [6] });
    expect(rolledOf(gmAgain.data, 'bgs')).toEqual({ option: 'thief', roll: 6 });
    expect(act(bgs('roll'), done.data, { kind: 'pick', list: 'bgs', option: 'scribe' }, { gm: true }).data).toEqual({ [PICKS_KEY]: { bgs: [{ option: 'scribe' }] } });
  });

  it('a rolled option the character doesn\'t meet says what it needs, as picking does', () => {
    const done = roll(bgs('roll'), { luck: 1 }, { values: [5] });
    expect(act(bgs('roll'), done.data, { kind: 'pick', list: 'bgs', option: 'thief' })).toEqual({ ok: false, error: 'Thief needs LUCK >= 3' });
  });

  it('BY HAND: a player can\'t roll, the GM can; no table, nothing to roll; no room, no roll', () => {
    expect(roll(bgs('hand'), {})).toEqual({ ok: false, error: 'The Backgrounds are picked by hand' });
    expect(roll(bgs('hand'), {}, { gm: true }).ok).toBe(true);
    const { table: _t, ...plain } = bgs();
    expect(roll({ ...plain, options: plain.options.map(({ roll: _r, ...o }) => o) }, {}, { gm: true })).toEqual({ ok: false, error: 'The Backgrounds have no table to roll on' });
    expect(roll(bgs(), { [PICKS_KEY]: { bgs: [{ option: 'dock' }] } }, { gm: true })).toEqual({ ok: false, error: 'No more Backgrounds can be picked' });
  });

  it('rolls on the secure dice when none are handed in', () => {
    for (let i = 0; i < 20; i += 1) {
      const done = act(bgs(), {}, { kind: 'roll', list: 'bgs' });
      expect(done.rolled.total).toBeGreaterThanOrEqual(1);
      expect(done.rolled.total).toBeLessThanOrEqual(6);
    }
  });

  it('several dice add up, and a roll on nothing is kept as nothing', () => {
    const list = { ...bgs(), table: '2d6', options: [{ id: 'dock', label: 'Dockhand', roll: '2-6' }, { id: 'scribe', label: 'Scribe', roll: '7-11' }] };
    const done = act(list, {}, { kind: 'roll', list: 'bgs' }, { rng: faces(6, 6, 6) });
    expect(done.rolled).toMatchObject({ rolls: [6, 6], total: 12, option: null });
    expect(rolledOf(done.data, 'bgs')).toEqual({ option: null, roll: 12 });
  });

  it('under a feature that opens the list, kept by that feature, taken there', () => {
    const data = { [PICKS_KEY]: { classes: [{ option: 'soldier', level: 1 }] } };
    const done = roll(bgs(), data, { from: 'specialty', values: [4, 5] });
    expect(done.ok).toBe(true);
    expect(done.data[ROLLED_KEY]).toEqual({ 'specs@specialty': { option: 'vanguard', roll: 9 } });
    expect(rolledOf(done.data, 'specs')).toBeNull();
    const taken = act(bgs(), done.data, { kind: 'pick', list: 'specs', option: 'vanguard', from: 'specialty' });
    expect(taken.data[PICKS_KEY].specs).toEqual([{ option: 'vanguard', from: 'specialty' }]);
    expect(taken.data).not.toHaveProperty(ROLLED_KEY);
    expect(act(bgs(), data, { kind: 'roll', list: 'specs' }, { rng: faces(6, 1, 1) })).toEqual({ ok: false, error: 'The Specialties are picked under the features that open them' });
  });

  it('the sheet is told each list\'s table, how players pick, and each option\'s roll, tidied', () => {
    const shown = choicesShown(system({ ...bgs('roll'), options: [{ id: 'dock', label: 'Dockhand', roll: ' 1 - 3 ' }, { id: 'scribe', label: 'Scribe', roll: '4-6' }] }));
    expect(shown[0]).toMatchObject({ table: 'd6', players: 'roll', options: [{ id: 'dock', roll: '1-3' }, { id: 'scribe', roll: '4-6' }] });
    expect(choicesShown(system({ ...bgs(), options: [{ id: 'dock', label: 'Dockhand', roll: '6' }] }))[0].options[0].roll).toBe('6');
    expect(shown[1]).toMatchObject({ players: 'hand' });
    expect(shown[1]).not.toHaveProperty('table');
  });

  it('the dice-log line names the character, the list, the dice and what it landed on', () => {
    const list = bgs();
    expect(rollLine('Wren', { list, dice: '2d6', rolls: [3, 4], total: 7, option: list.options[1] })).toBe('Wren rolled Background (2d6) [3 + 4 = 7] — SCRIBE');
    expect(rollLine('Wren', { list, dice: 'd6', rolls: [9], total: 9, option: null })).toBe('Wren rolled Background (d6) [9 = 9] — NOTHING ON THE TABLE');
  });
});

describe('through the socket', () => {
  let db;
  const GM = jwt.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, 'test-secret');
  const ID = 'sys_rollforitrollfor';

  const table = async () => {
    const shared = [];
    let connection;
    const io = { on: (e, cb) => { if (e === 'connection') connection = cb; }, emit: (event, data) => shared.push({ event, data }), to: () => ({ emit: () => {} }) };
    socketsFactory(io, db, { elevatedUsers: new Set(), emitUpdate: vi.fn(), recordAction: vi.fn() });
    const join = async (who, identity) => {
      const heard = [];
      const handlers = {};
      connection({ id: `s-${who}`, on: (e, fn) => { handlers[e] = fn; }, emit: (event, d) => heard.push({ event, data: d }), broadcast: { emit: () => {} }, use: () => {}, join: () => {}, disconnect: () => {} });
      handlers.identify(identity);
      await drain(db);
      return { handlers, refused: () => heard.filter((e) => e.event === 'choicesRefused').map((e) => e.data.error) };
    };
    return { shared, gm: await join('gm', { userName: 'gm', isAdmin: true, token: GM }), wren: await join('wren', 'wren') };
  };
  const stored = async () => JSON.parse((await get(db, 'SELECT data FROM character_sheets WHERE username = ?', ['wren'])).data);
  const lines = () => new Promise((ok) => db.all('SELECT username, total, results, historyString FROM dice_rolls ORDER BY id', (e, rows) => ok(rows || [])));

  beforeEach(async () => {
    db = await makeTestDb();
    await run(db, `CREATE TABLE IF NOT EXISTS dice_rolls (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, total INTEGER NOT NULL,
      results TEXT NOT NULL, color TEXT NOT NULL, historyString TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    const def = JSON.stringify(system(bgs('roll')));
    await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', [ID, 'Hearth', def, def]);
    await new Promise((resolve) => runtime.load(db, resolve));
    await run(db, `INSERT INTO global_settings (key, value) VALUES ('game_system', ?)`, [ID]);
    await run(db, `INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('wren', ?, ?, 0)`, [ID, JSON.stringify({ name: 'Wren', luck: 5 })]);
  });

  it('a player rolls: kept on the sheet, a dice-log line, the tray throwing it; once, then refused; TAKE IT picks it', async () => {
    const { wren, shared } = await table();
    wren.handlers.choicesAction({ kind: 'roll', list: 'bgs' });
    await until(async () => !!(await stored())[ROLLED_KEY], { label: 'the roll kept' });
    const kept = (await stored())[ROLLED_KEY].bgs;
    expect(kept.roll).toBeGreaterThanOrEqual(1);
    expect(kept.roll).toBeLessThanOrEqual(6);
    await until(async () => (await lines()).length === 1, { label: 'the log line' });
    const [line] = await lines();
    const landed = { 1: 'DOCKHAND', 2: 'DOCKHAND', 3: 'SCRIBE', 4: 'SCRIBE', 5: 'THIEF', 6: 'THIEF' }[kept.roll];
    expect(line).toMatchObject({ username: 'wren', total: kept.roll, results: JSON.stringify({ 6: [kept.roll] }), historyString: `Wren rolled Background (d6) [${kept.roll} = ${kept.roll}] — ${landed}` });
    const thrown = shared.find((e) => e.event === 'diceRollBroadcast');
    expect(thrown.data).toMatchObject({ userName: 'Wren', account: 'wren', total: kept.roll, historyString: line.historyString });
    expect(thrown.data.board).toBeTruthy();
    expect(shared.some((e) => e.event === 'sheetUpdated' && e.data.username === 'wren')).toBe(true);

    wren.handlers.choicesAction({ kind: 'roll', list: 'bgs' });
    await until(() => wren.refused().length === 1, { label: 'the second roll refused' });
    expect(wren.refused()).toEqual(['Rolled already: take what came up, or ask the GM to roll again']);
    expect(await lines()).toHaveLength(1);

    wren.handlers.choicesAction({ kind: 'pick', list: 'bgs', option: kept.option });
    await until(async () => !!(await stored())[PICKS_KEY], { label: 'taken' });
    expect((await stored())[PICKS_KEY].bgs).toEqual([{ option: kept.option }]);
    expect(await stored()).not.toHaveProperty(ROLLED_KEY);
  });

  it('the GM rolls again on the player they name', async () => {
    const { wren, gm } = await table();
    wren.handlers.choicesAction({ kind: 'roll', list: 'bgs' });
    await until(async () => (await lines()).length === 1, { label: 'the player\'s roll' });
    gm.handlers.choicesAction({ kind: 'roll', list: 'bgs', username: 'wren' });
    await until(async () => (await lines()).length === 2, { label: 'the GM\'s roll' });
    expect((await lines())[1].username).toBe('wren');
    expect(gm.refused()).toEqual([]);
  });
});
