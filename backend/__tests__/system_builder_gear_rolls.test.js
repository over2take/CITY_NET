/**
 * A line of gear's DAMAGE or DICE rolled (8a3b; approved mockup item-types, 2026-11-14, decision 4): the line's own dice,
 * else its item's, read against the sheet as rolls read it, rolled with the server's dice into the log. Putting damage
 * on a target is 8b's.
 */

import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';
import { makeTestDb, run, get } from './helpers/testDb.js';
import { drain, until } from './helpers/until.js';

const require_ = createRequire(import.meta.url);
const { rollGear } = require_('../systemBuilder/gearRolls');
const runtime = require_('../systemBuilder/runtime');
const socketsFactory = require_('../sockets/index.js');

const ARMED = {
  format: 1, name: 'Armed', core: { health: { model: 'pool' } },
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }] }],
  derived: [{ id: 'might_mod', label: 'Might mod', formula: 'floor((@might - 10) / 2)' }],
  items: {
    types: [
      { id: 'gear', label: 'GEAR', columns: [{ id: 'weight', label: 'WEIGHT', kind: 'number' }] },
      { id: 'weapons', label: 'WEAPONS', one: 'Weapon', columns: [
        { id: 'damage', label: 'DAMAGE', kind: 'damage' }, { id: 'heals', label: 'HEALS', kind: 'dice' }, { id: 'range', label: 'RANGE', kind: 'text' }] },
    ],
    list: [{ id: 'sword', label: 'Longsword', type: 'weapons', values: { damage: '1d8 + @might_mod', heals: '2d4' } }],
  },
};
const lines = (...rows) => ({ inventory: JSON.stringify(rows.map((r) => ({ qty: 1, enc: '', bundled: false, carry: 'readied', location: '', ...r }))) });
/** Dice that answer in turn: 0.5 of a d8 is a 5. */
const dice = (...answers) => { let i = 0; return () => answers[i++ % answers.length]; };

describe('rolling a line\'s dice', () => {
  it('its item\'s DAMAGE, read against the sheet: the dice, what is added, the total, in the log\'s words', () => {
    const data = { might: 14, might_mod: 2, ...lines({ name: 'Longsword' }) };
    const r = rollGear(ARMED, data, 0, 'damage', { rng: dice(0.5), who: 'Wren' });
    expect(r).toMatchObject({ ok: true, line: 'Longsword', label: 'DAMAGE', kind: 'damage', text: '1d8 + @might_mod', value: 7, add: 2 });
    expect(r.dice).toEqual([{ count: 1, sides: 8, rolls: [5] }]);
    expect(r.history).toBe('Wren rolled Longsword DAMAGE 1d8 + @might_mod [5 + 2 = 7]');
  });

  it('a line\'s own dice over its item\'s; DICE as well as DAMAGE; several dice and nothing added; for an NPC', () => {
    const data = lines({ name: 'Longsword', values: { damage: '2d6 - 1' } }, { name: 'A stick', type: 'weapons', values: { heals: '2d4' } });
    const own = rollGear(ARMED, data, 0, 'damage', { rng: dice(0, 0.99), who: 'Wren' });
    expect(own).toMatchObject({ value: 6, add: -1 });
    expect(own.history).toBe('Wren rolled Longsword DAMAGE 2d6 - 1 [(1, 6) - 1 = 6]');
    const heal = rollGear(ARMED, data, 1, 'heals', { rng: dice(0.25), who: 'The GM', forName: 'Grub' });
    expect(heal).toMatchObject({ kind: 'dice', value: 4, add: 0 });
    expect(heal.history).toBe('The GM rolled A stick HEALS for Grub 2d4 [(2, 2) = 4]');
  });

  it('a line with no name says its type\'s one', () => {
    expect(rollGear(ARMED, lines({ name: ' ', type: 'weapons', values: { damage: '1d4' } }), 0, 'damage', { rng: dice(0), who: 'Wren' }).history)
      .toBe('Wren rolled Weapon DAMAGE 1d4 [1 = 1]');
  });

  it('nothing to roll: no such line, a column that isn\'t dice, none of its own or its item\'s, dice that don\'t read', () => {
    const data = lines({ name: 'Longsword' }, { name: 'Rope' }, { name: 'Club', type: 'weapons', values: { damage: '1d6 + @gone' } });
    const roll = (i, c) => rollGear(ARMED, data, i, c, { rng: dice(0.5), who: 'Wren' });
    expect(roll(9, 'damage')).toEqual({ ok: false, error: 'No such line' });
    expect(roll(-1, 'damage')).toEqual({ ok: false, error: 'No such line' });
    expect(roll('0', 'damage')).toEqual({ ok: false, error: 'No such line' });
    expect(roll(0, 'range')).toEqual({ ok: false, error: 'Not a DAMAGE or DICE column' });
    expect(roll(0, 'nope')).toEqual({ ok: false, error: 'Not a DAMAGE or DICE column' });
    expect(roll(1, 'damage')).toEqual({ ok: false, error: 'Not a DAMAGE or DICE column' });
    // The club's own dice read a name the system hasn't: passed over, and it has no item's.
    expect(roll(2, 'damage')).toEqual({ ok: false, error: 'Nothing to roll' });
    expect(rollGear(ARMED, { inventory: 'not json' }, 0, 'damage', { rng: dice(0.5), who: 'Wren' })).toEqual({ ok: false, error: 'No such line' });
    expect(rollGear(ARMED, { inventory: [{ name: 'Longsword' }] }, 0, 'damage', { rng: dice(0.5), who: 'Wren' })).toMatchObject({ ok: true, value: 5 });
  });
});

describe('at the table', () => {
  const setUp = async () => {
    const db = await makeTestDb();
    await run(db, `CREATE TABLE IF NOT EXISTS dice_rolls (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, total INTEGER, results TEXT, color TEXT, historyString TEXT,
      players_history TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    const ID = 'sys_armedarmedarmed1';
    await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', [ID, 'Armed', JSON.stringify(ARMED), JSON.stringify(ARMED)]);
    await new Promise((resolve) => runtime.load(db, resolve));
    await run(db, 'INSERT INTO global_settings (key, value) VALUES (\'game_system\', ?)', [ID]);
    await run(db, 'INSERT INTO character_sheets (username, system, data, is_npc) VALUES (\'kes\', ?, ?, 0)', [ID, JSON.stringify({ name: 'Kes', might: 14, might_mod: 2, ...lines({ name: 'Longsword' }) })]);
    let connection;
    const emitted = [];
    socketsFactory({ on: (e, cb) => { if (e === 'connection') connection = cb; }, emit: (event, data) => emitted.push({ event, data }), to: () => ({ emit: () => {} }) },
      db, { elevatedUsers: new Set(), emitUpdate: vi.fn(), recordAction: vi.fn() });
    const join = async (who) => {
      const handlers = {};
      const said = [];
      connection({ id: `gear-${who}-${Math.random()}`, on: (e, fn) => { handlers[e] = fn; }, emit: (e, p) => said.push([e, p]), broadcast: { emit: () => {} }, use: () => {}, join: () => {}, disconnect: () => {} });
      handlers.identify(who);
      await drain(db);
      return { handlers, said };
    };
    const rolls = () => emitted.filter((e) => e.event === 'diceRollBroadcast').map((e) => e.data);
    return { db, join, rolls };
  };

  it('a player rolls their line\'s DAMAGE into the log and the tray, kept with the rolls', async () => {
    const { db, join, rolls } = await setUp();
    const kes = await join('kes');
    kes.handlers.requestSheetRoll({ gear: { line: 0, column: 'damage' } });
    await until(() => rolls().length === 1, { label: 'the damage roll' });
    const [r] = rolls();
    expect(r.total).toBeGreaterThanOrEqual(3);
    expect(r.total).toBeLessThanOrEqual(10);
    expect(r.diceSides).toEqual([8]);
    expect(r.modifiers).toEqual([2]);
    expect(r.historyString).toMatch(/^Kes rolled Longsword DAMAGE 1d8 \+ @might_mod \[\d \+ 2 = \d+\]$/);
    await until(async () => (await get(db, 'SELECT COUNT(*) AS n FROM dice_rolls')).n === 1, { label: 'kept' });
    expect((await get(db, 'SELECT historyString FROM dice_rolls')).historyString).toBe(r.historyString);
  });

  it('nothing to roll, nothing in the log; a gear roll without a column, or with a line that isn\'t whole, is passed over', async () => {
    const { join, rolls } = await setUp();
    const kes = await join('kes');
    for (const gear of [{ line: 0, column: 'range' }, { line: 5, column: 'damage' }, { line: 0 }, { line: 0.5, column: 'damage' }, { line: '0', column: 'damage' }, 'x']) {
      kes.handlers.requestSheetRoll({ gear });
    }
    // A roll sent after them comes through alone.
    kes.handlers.requestSheetRoll({ gear: { line: 0, column: 'damage' } });
    await until(() => rolls().length === 1, { label: 'the one that rolls' });
    expect(rolls()).toHaveLength(1);
  });
});
