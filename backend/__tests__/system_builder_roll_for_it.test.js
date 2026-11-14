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
const { PICKS_KEY, ROLLED_KEY, rolledOn, rolledOf, choicesShown, workedOf } = require_('../systemBuilder/choices');
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

  it('BY HAND OR ROLL: a roll picks what it lands on and locks it; not rolling, any option picked by hand', () => {
    const done = roll(bgs(), {}, { values: [4] });
    expect(done.ok).toBe(true);
    expect(done.data).toEqual({ [PICKS_KEY]: { bgs: [{ option: 'scribe', locked: true, roll: 4 }] } });
    expect(done.rolled).toMatchObject({ dice: 'd6', sides: 6, rolls: [4], total: 4, option: { id: 'scribe' } });
    expect(act(bgs(), {}, { kind: 'pick', list: 'bgs', option: 'scribe' }).data).toEqual({ [PICKS_KEY]: { bgs: [{ option: 'scribe' }] } });
  });

  it('BY ROLL ONLY: nothing to pick by hand; a roll picks and locks it as well', () => {
    expect(act(bgs('roll'), {}, { kind: 'pick', list: 'bgs', option: 'dock' })).toEqual({ ok: false, error: 'The Backgrounds are picked by roll: ROLL FOR IT' });
    expect(roll(bgs('roll'), {}, { values: [2] }).data).toEqual({ [PICKS_KEY]: { bgs: [{ option: 'dock', locked: true, roll: 2 }] } });
  });

  describe('a roll locked in (the user\'s flow, 2026-11-06)', () => {
    const CREATING = { _creating: { at: 'list:bgs' } };
    const ON = (list) => ({ ...system(list), creation: { on: true } });
    const rolledIn = (players) => roll(bgs(players), {}, { values: [1] }).data;

    for (const players of [undefined, 'roll']) {
      it(`${players ?? 'either'}: a player can't roll again, drop it, or pick another, with room or without`, () => {
        const many = { ...bgs(players), picks: 2 };
        const data = rolledIn(players);
        expect(roll(bgs(players), data)).toEqual({ ok: false, error: 'No more Backgrounds can be picked' });
        expect(pickAction(ON(bgs(players)), { ...data, ...CREATING }, { kind: 'drop', list: 'bgs', option: 'dock' }).ok).toBe(false);
        expect(act(many, data, { kind: 'level', list: 'bgs', option: 'dock', level: 2 }).ok).toBe(false);
      });
    }

    it('a player making a character can\'t take a locked pick back, though they can one picked by hand', () => {
      const data = { ...rolledIn(), ...CREATING };
      expect(pickAction(ON(bgs()), data, { kind: 'drop', list: 'bgs', option: 'dock' })).toEqual({ ok: false, error: 'Rolled, and kept: your GM can clear it for another go' });
      const byHand = { [PICKS_KEY]: { bgs: [{ option: 'dock' }] }, ...CREATING };
      expect(pickAction(ON(bgs()), byHand, { kind: 'drop', list: 'bgs', option: 'dock' }).ok).toBe(true);
    });

    it('stays locked through a level or a use changing', () => {
      const list = { ...bgs(), levelled: true };
      const done = act(list, roll(list, {}, { values: [1] }).data, { kind: 'level', list: 'bgs', option: 'dock', level: 3 });
      expect(done.data[PICKS_KEY].bgs).toEqual([{ option: 'dock', level: 3, locked: true, roll: 1 }]);
    });

    it('a list picking more than one rolls on: each locked in its turn', () => {
      const many = { ...bgs(), picks: 2 };
      const first = roll(many, {}, { values: [1] }).data;
      const second = roll(many, first, { values: [4] }).data;
      expect(second[PICKS_KEY].bgs).toEqual([{ option: 'dock', locked: true, roll: 1 }, { option: 'scribe', locked: true, roll: 4 }]);
    });

    it('landing on one already held picks nothing, and they may roll again', () => {
      const many = { ...bgs(), picks: 2 };
      const first = roll(many, {}, { values: [1] }).data;
      const same = roll(many, first, { values: [2] });
      expect(same.data).toEqual(first);
      expect(same.rolled.option.id).toBe('dock');
    });

    it('one they don\'t meet is kept, marked, with no pick: nothing else until they meet it or the GM acts', () => {
      const done = roll(bgs(), { luck: 1 }, { values: [5] });
      expect(done.data).toEqual({ luck: 1, [ROLLED_KEY]: { bgs: { option: 'thief', roll: 5 } } });
      expect(roll(bgs(), done.data)).toEqual({ ok: false, error: 'Rolled, and kept: your GM can clear it for another go' });
      expect(act(bgs(), done.data, { kind: 'pick', list: 'bgs', option: 'dock' })).toEqual({ ok: false, error: 'Rolled, and kept: your GM can clear it for another go' });
      expect(act(bgs(), done.data, { kind: 'pick', list: 'bgs', option: 'thief' })).toEqual({ ok: false, error: 'Thief needs LUCK >= 3' });
      // Come to meet it, it is theirs, locked.
      const taken = act(bgs(), { ...done.data, luck: 3 }, { kind: 'pick', list: 'bgs', option: 'thief' });
      expect(taken.data).toEqual({ luck: 3, [PICKS_KEY]: { bgs: [{ option: 'thief', locked: true, roll: 5 }] } });
    });

    describe('the GM', () => {
      const gm = { gm: true };

      it('clears it: the pick gone, and the player can roll or pick again', () => {
        const done = act(bgs(), rolledIn(), { kind: 'clear', list: 'bgs', option: 'dock' }, gm);
        expect(done.data).toEqual({ [PICKS_KEY]: { bgs: [] } });
        expect(roll(bgs(), done.data, { values: [4] }).ok).toBe(true);
        expect(act(bgs(), done.data, { kind: 'pick', list: 'bgs', option: 'scribe' }).ok).toBe(true);
      });

      it('clearing leaves the list\'s other picks', () => {
        const many = { ...bgs(), picks: 2 };
        const both = roll(many, roll(many, {}, { values: [1] }).data, { values: [4] }).data;
        expect(act(many, both, { kind: 'clear', list: 'bgs', option: 'dock' }, gm).data[PICKS_KEY].bgs).toEqual([{ option: 'scribe', locked: true, roll: 4 }]);
      });

      it('clearing is theirs alone, and only what is locked', () => {
        expect(act(bgs(), rolledIn(), { kind: 'clear', list: 'bgs', option: 'dock' })).toEqual({ ok: false, error: 'That is the GM\'s to do' });
        expect(act(bgs(), {}, { kind: 'clear', list: 'bgs' })).toEqual({ ok: false, error: 'That is the GM\'s to do' });
        expect(act(bgs(), {}, { kind: 'clear', list: 'bgs', option: 'dock' }, gm)).toEqual({ ok: false, error: 'Dockhand isn\'t picked' });
        const byHand = { [PICKS_KEY]: { bgs: [{ option: 'dock' }] } };
        expect(act(bgs(), byHand, { kind: 'clear', list: 'bgs', option: 'dock' }, gm)).toEqual({ ok: false, error: 'Nothing rolled there to clear' });
      });

      it('clears a roll waiting, marked, with no pick to take', () => {
        const waiting = roll(bgs(), { luck: 1 }, { values: [5] }).data;
        expect(act(bgs(), waiting, { kind: 'clear', list: 'bgs' }, gm).data).toEqual({ luck: 1 });
        expect(act(bgs(), { luck: 1 }, { kind: 'clear', list: 'bgs' }, gm)).toEqual({ ok: false, error: 'Nothing rolled there to clear' });
      });

      it('rolls again for them: the old pick replaced by what comes up, locked', () => {
        const done = act(bgs(), rolledIn(), { kind: 'roll', list: 'bgs', again: 'dock' }, { gm: true, rng: faces(6, 4) });
        expect(done.data[PICKS_KEY].bgs).toEqual([{ option: 'scribe', locked: true, roll: 4 }]);
        expect(done.rolled.option.id).toBe('scribe');
      });

      it('rolling again may land on the same one', () => {
        const done = act(bgs(), rolledIn(), { kind: 'roll', list: 'bgs', again: 'dock' }, { gm: true, rng: faces(6, 2) });
        expect(done.data[PICKS_KEY].bgs).toEqual([{ option: 'dock', locked: true, roll: 2 }]);
      });

      it('a player can\'t use rolling again to get round the lock', () => {
        expect(act(bgs(), rolledIn(), { kind: 'roll', list: 'bgs', again: 'dock' }, { rng: faces(6, 4) })).toEqual({ ok: false, error: 'No more Backgrounds can be picked' });
      });

      it('a roll of theirs needs nothing met: it is the GM\'s say', () => {
        expect(roll(bgs(), { luck: 1 }, { gm: true, values: [5] }).data[PICKS_KEY].bgs).toEqual([{ option: 'thief', locked: true, roll: 5 }]);
      });

      it('picking by hand on a list a player could roll on locks it, with no roll to say', () => {
        for (const players of [undefined, 'roll']) {
          expect(act(bgs(players), {}, { kind: 'pick', list: 'bgs', option: 'scribe' }, gm).data[PICKS_KEY].bgs).toEqual([{ option: 'scribe', locked: true }]);
        }
        expect(act(bgs('hand'), {}, { kind: 'pick', list: 'bgs', option: 'scribe' }, gm).data[PICKS_KEY].bgs).toEqual([{ option: 'scribe' }]);
      });

      it('a pick on a list with no table is as it always was', () => {
        const { table: _t, ...plain } = bgs();
        const list = { ...plain, options: plain.options.map(({ roll: _r, ...o }) => o) };
        expect(act(list, {}, { kind: 'pick', list: 'bgs', option: 'scribe' }, gm).data[PICKS_KEY].bgs).toEqual([{ option: 'scribe' }]);
      });

      it('the sheet is told what is locked and what it rolled', () => {
        const shown = workedOf(system(bgs()), rolledIn()).picks;
        expect(shown[0]).toMatchObject({ list: 'bgs', option: 'dock', locked: true, roll: 1 });
        const hand = workedOf(system(bgs()), { [PICKS_KEY]: { bgs: [{ option: 'dock', roll: 3 }] } }).picks;
        expect(hand[0]).not.toHaveProperty('locked');
        expect(hand[0]).not.toHaveProperty('roll');
      });
    });
  });

  it('BY HAND: a player can\'t roll, the GM can; no table, nothing to roll; no room, no roll', () => {
    expect(roll(bgs('hand'), {})).toEqual({ ok: false, error: 'The Backgrounds are picked by hand' });
    expect(roll(bgs('hand'), {}, { gm: true }).ok).toBe(true);
    const { table: _t, ...plain } = bgs();
    expect(roll({ ...plain, options: plain.options.map(({ roll: _r, ...o }) => o) }, {}, { gm: true })).toEqual({ ok: false, error: 'The Backgrounds have no table to roll on' });
    expect(roll(bgs(), { [PICKS_KEY]: { bgs: [{ option: 'dock' }] } }, { gm: true })).toEqual({ ok: false, error: 'No more Backgrounds can be picked' });
    expect(roll(bgs(), { [PICKS_KEY]: { bgs: [{ option: 'dock' }] } })).toEqual({ ok: false, error: 'No more Backgrounds can be picked' });
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

  it('under a feature that opens the list, picked and locked there', () => {
    const data = { [PICKS_KEY]: { classes: [{ option: 'soldier', level: 1 }] } };
    const done = roll(bgs(), data, { from: 'specialty', values: [4, 5] });
    expect(done.ok).toBe(true);
    expect(done.data[PICKS_KEY].specs).toEqual([{ option: 'vanguard', from: 'specialty', locked: true, roll: 9 }]);
    expect(done.data).not.toHaveProperty(ROLLED_KEY);
    expect(act(bgs(), done.data, { kind: 'roll', list: 'specs', from: 'specialty' }, { rng: faces(6, 1, 1) }).ok).toBe(false);
    const again = act(bgs(), done.data, { kind: 'roll', list: 'specs', from: 'specialty', again: 'vanguard' }, { gm: true, rng: faces(6, 1, 1) });
    expect(again.data[PICKS_KEY].specs).toEqual([{ option: 'duelist', from: 'specialty', locked: true, roll: 2 }]);
    const cleared = act(bgs(), done.data, { kind: 'clear', list: 'specs', option: 'vanguard' }, { gm: true });
    expect(cleared.data[PICKS_KEY].specs).toEqual([]);
    expect(act(bgs(), data, { kind: 'roll', list: 'specs' }, { rng: faces(6, 1, 1) })).toEqual({ ok: false, error: 'The Specialties are picked under the features that open them' });
  });

  it('under a feature, one not met waits by that feature, taken there, and cleared there', () => {
    const list = { ...SPECIALTIES, options: [{ id: 'duelist', label: 'Duelist', roll: '2-7', requires: '@luck >= 3' }, { id: 'vanguard', label: 'Vanguard', roll: '8-12' }] };
    const def = { ...system(bgs()), choices: system(bgs()).choices.map((c) => (c.id === 'specs' ? list : c)) };
    const data = { luck: 1, [PICKS_KEY]: { classes: [{ option: 'soldier', level: 1 }] } };
    const done = pickAction(def, data, { kind: 'roll', list: 'specs', from: 'specialty' }, { rng: faces(6, 1, 1) });
    expect(done.data[ROLLED_KEY]).toEqual({ 'specs@specialty': { option: 'duelist', roll: 2 } });
    expect(rolledOf(done.data, 'specs')).toBeNull();
    const taken = pickAction(def, { ...done.data, luck: 3 }, { kind: 'pick', list: 'specs', option: 'duelist', from: 'specialty' });
    expect(taken.data[PICKS_KEY].specs).toEqual([{ option: 'duelist', from: 'specialty', locked: true, roll: 2 }]);
    expect(taken.data).not.toHaveProperty(ROLLED_KEY);
    expect(pickAction(def, done.data, { kind: 'clear', list: 'specs', from: 'specialty' }, { gm: true }).data).not.toHaveProperty(ROLLED_KEY);
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

  it('a player rolls: locked in on the sheet, a dice-log line, the tray throwing it; once, then refused', async () => {
    const { wren, shared } = await table();
    wren.handlers.choicesAction({ kind: 'roll', list: 'bgs' });
    await until(async () => !!((await stored())[PICKS_KEY] || (await stored())[ROLLED_KEY]), { label: 'the roll kept' });
    const after = await stored();
    // Thief needs Luck, so a 5 or 6 waits, marked, and anything else is picked.
    const kept = after[PICKS_KEY]?.bgs?.[0] ?? after[ROLLED_KEY].bgs;
    const total = kept.roll;
    expect(total).toBeGreaterThanOrEqual(1);
    expect(total).toBeLessThanOrEqual(6);
    if (after[PICKS_KEY]) expect(kept.locked).toBe(true);
    await until(async () => (await lines()).length === 1, { label: 'the log line' });
    const [line] = await lines();
    const landed = { 1: 'DOCKHAND', 2: 'DOCKHAND', 3: 'SCRIBE', 4: 'SCRIBE', 5: 'THIEF', 6: 'THIEF' }[total];
    expect(line).toMatchObject({ username: 'wren', total, results: JSON.stringify({ 6: [total] }), historyString: `Wren rolled Background (d6) [${total} = ${total}] — ${landed}` });
    const thrown = shared.find((e) => e.event === 'diceRollBroadcast');
    expect(thrown.data).toMatchObject({ userName: 'Wren', account: 'wren', total, historyString: line.historyString });
    expect(thrown.data.board).toBeTruthy();
    expect(shared.some((e) => e.event === 'sheetUpdated' && e.data.username === 'wren')).toBe(true);

    wren.handlers.choicesAction({ kind: 'roll', list: 'bgs' });
    await until(() => wren.refused().length === 1, { label: 'the second roll refused' });
    expect(await lines()).toHaveLength(1);
  });

  it('a player can\'t clear through the socket; the GM can, naming them', async () => {
    const { wren, gm } = await table();
    wren.handlers.choicesAction({ kind: 'roll', list: 'bgs' });
    await until(async () => (await lines()).length === 1, { label: 'the roll' });
    wren.handlers.choicesAction({ kind: 'clear', list: 'bgs', option: 'dock' });
    await until(() => wren.refused().length === 1, { label: 'the player refused' });
    expect(wren.refused()).toEqual(['That is the GM\'s to do']);
    const kept = await stored();
    const held = kept[PICKS_KEY]?.bgs?.[0]?.option;
    gm.handlers.choicesAction({ kind: 'clear', list: 'bgs', ...(held ? { option: held } : {}), username: 'wren' });
    await until(async () => { const d = await stored(); return !d[PICKS_KEY]?.bgs?.length && !d[ROLLED_KEY]; }, { label: 'cleared' });
    expect(gm.refused()).toEqual([]);
  });

  it('the GM rolls again on the player they name', async () => {
    const { wren, gm } = await table();
    wren.handlers.choicesAction({ kind: 'roll', list: 'bgs' });
    await until(async () => (await lines()).length === 1, { label: 'the player\'s roll' });
    const held = (await stored())[PICKS_KEY]?.bgs?.[0]?.option;
    gm.handlers.choicesAction({ kind: 'roll', list: 'bgs', ...(held ? { again: held } : {}), username: 'wren' });
    await until(async () => (await lines()).length === 2, { label: 'the GM\'s roll' });
    expect((await lines())[1].username).toBe('wren');
    expect(gm.refused()).toEqual([]);
  });
});
