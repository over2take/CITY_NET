/**
 * What an encumbrance band means, and a condition it puts on (8a5d1; approved mockup docs/mockups/encumbrance-bands.html,
 * 2026-11-18, the user: "word + optional (on/off) condition"): each band and the word past them may say WHAT IT MEANS and
 * name one of the system's conditions, on the character's token while they are in that band and off when they leave it.
 * The band takes off only what it put on, says each in the log, a table can switch it off, and no token means nothing.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'module';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import adminRouteFactory from '../routes/admin.js';
import { makeTestDb, get, run } from './helpers/testDb.js';
import { drain, until } from './helpers/until.js';

const require_ = createRequire(import.meta.url);
const { bandAt, carryingOf } = require_('../systemBuilder/encumbrance');
const { checkDefinition } = require_('../systemBuilder/definition');
const { bandStep, BAND_KEY, BAND_SETTING, syncAllBandConditions } = require_('../sheets/bandConditions');
const runtime = require_('../systemBuilder/runtime');
const socketsFactory = (await import('../sockets/index.js')).default;

const LADEN = {
  format: 1, name: 'Laden', core: { health: { model: 'pool' } },
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }] }],
  conditions: { slowed: { name: 'Slowed', short: 'SLOW', icon: 'snow', description: 'Half speed.' }, blinded: { on: false } },
  items: {
    types: [{ id: 'gear', label: 'GEAR', one: 'Gear', columns: [{ id: 'weight', label: 'WEIGHT', kind: 'number', unit: 'LB' }, { id: 'ammo', label: 'AMMO', kind: 'count', reload: ['rounds'] }] }],
    list: [
      { id: 'pack', label: 'Pack', type: 'gear', values: { weight: 10 } },
      { id: 'pistol', label: 'Pistol', type: 'gear', values: { weight: 2, ammo: 6 } },
      { id: 'rounds', label: 'Rounds', type: 'gear', values: { weight: 1 } },
    ],
    encumbrance: {
      column: 'weight', unit: 'LB', capacity: '@might * 10',
      bands: [{ word: 'LIGHT', upto: 50 }, { word: 'ENCUMBERED', upto: 100, says: 'Speed -10 ft.', condition: 'slowed' }],
      past: 'OVERLOADED', past_says: 'Speed -20 ft.', past_condition: 'exhausted',
    },
  },
};
const line = (name, more = {}) => ({ name, qty: 1, enc: '', bundled: false, carry: 'stowed', location: '', ...more });

describe('the checks', () => {
  const problems = (encumbrance) => checkDefinition({ ...LADEN, items: { ...LADEN.items, encumbrance } }).problems;
  const base = { column: 'weight', capacity: '10', bands: [{ word: 'LIGHT', upto: 50 }], past: 'OVER' };

  it('words and a condition on a band and past them; the condition one of the system\'s that is on', () => {
    expect(checkDefinition(LADEN).problems).toEqual([]);
    expect(problems({ ...base, bands: [{ word: 'LIGHT', upto: 50, condition: 'gone' }] }))
      .toEqual([{ where: 'items, encumbrance, band 1, condition', message: 'No condition is called gone: make it on CONDITIONS, or turn it on' }]);
    // A standard one turned off is no condition of this system's.
    expect(problems({ ...base, past_condition: 'blinded' }))
      .toEqual([{ where: 'items, encumbrance, past_condition', message: 'No condition is called blinded: make it on CONDITIONS, or turn it on' }]);
    expect(problems({ ...base, past_condition: 3 })).toEqual([{ where: 'items, encumbrance, past_condition', message: 'One of this system\'s conditions' }]);
    expect(problems({ ...base, bands: [{ word: 'LIGHT', upto: 50, says: 'x'.repeat(201) }] }))
      .toEqual([{ where: 'items, encumbrance, band 1, says', message: 'Longer than 200 characters' }]);
    expect(problems({ ...base, past_says: 'x'.repeat(200) })).toEqual([]);
  });

  it('nothing past the last band without bands to be past', () => {
    expect(problems({ column: 'weight', past_says: 'Heavy.' })).toEqual([{ where: 'items, encumbrance, past_says', message: 'Past the last band, with bands to be past' }]);
    expect(problems({ column: 'weight', capacity: '10', bands: [], past_condition: 'slowed' }))
      .toEqual([{ where: 'items, encumbrance, past_condition', message: 'Past the last band, with bands to be past' }]);
  });

  it('the band carried is in, with what it means and its condition, as the sheet is told it', () => {
    expect(bandAt(LADEN, 20, 50)).toEqual({ word: 'LIGHT', says: null, condition: null });
    expect(bandAt(LADEN, 30, 50)).toEqual({ word: 'ENCUMBERED', says: 'Speed -10 ft.', condition: 'slowed' });
    expect(bandAt(LADEN, 60, 50)).toEqual({ word: 'OVERLOADED', says: 'Speed -20 ft.', condition: 'exhausted' });
    expect(carryingOf(LADEN, { capacity: 50, inventory: JSON.stringify([line('Pack', { qty: 3 })]) }))
      .toEqual({ carried: 30, capacity: 50, unit: 'LB', band: 'ENCUMBERED', says: 'Speed -10 ft.', condition: 'slowed',
        bands: [{ word: 'LIGHT', upto: 50 }, { word: 'ENCUMBERED', upto: 100 }], past: 'OVERLOADED', conditionName: 'Slowed' });
    // Words of nothing but spaces say nothing.
    const blank = { ...LADEN, items: { ...LADEN.items, encumbrance: { ...LADEN.items.encumbrance, past_says: '  ' } } };
    expect(bandAt(blank, 60, 50).says).toBeNull();
  });
});

describe("the GAME tab's switches a system has (8a6b)", () => {
  const ID = 'sys_switchswitchswitc';
  const switchesOf = async (definition) => {
    const db = await makeTestDb();
    const def = JSON.stringify(definition);
    await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', [ID, definition.name, def, def]);
    await new Promise((resolve) => runtime.load(db, resolve));
    return runtime.render(ID).switches;
  };
  it('encumbrance counted, a band naming a condition, a condition APPLIED: each its own', async () => {
    // What the system says of a hit (8b5b): CONFIRM and worked out to start.
    const damage = { apply: 'confirm', work_out: true };
    expect(await switchesOf(LADEN)).toEqual({ encumbrance: true, band_conditions: true, applied_conditions: false, turn_effects: false, gear: true, damage });
    const plain = { ...LADEN, items: { ...LADEN.items, encumbrance: { column: 'weight', capacity: '10' } } };
    expect(await switchesOf(plain)).toEqual({ encumbrance: true, band_conditions: false, applied_conditions: false, turn_effects: false, gear: true, damage });
    expect((await switchesOf({ ...LADEN, damage: { apply: 'off', work_out: false } })).damage).toEqual({ apply: 'off', work_out: false });
    const { encumbrance, ...noCount } = LADEN.items;
    const applied = { ...LADEN, items: noCount, conditions: { ...LADEN.conditions, slowed: { ...LADEN.conditions.slowed, applied: true, modifiers: [{ target: 'might', amount: -1 }] } } };
    expect(await switchesOf(applied)).toEqual({ encumbrance: false, band_conditions: false, applied_conditions: true, turn_effects: false, gear: true, damage });
    // PLAYERS CHANGE GEAR (G6a): only where the system makes its own item types.
    expect((await switchesOf({ ...LADEN, items: { list: [{ id: 'pack', label: 'Pack' }] } })).gear).toBe(false);
    // CONDITION TURN EFFECTS (8a9c): where a condition has an EACH TURN; ending at the end of its next turn alone switches nothing.
    const burning = { burning: { name: 'Burning', each_turn: [{ when: 'turn_start', does: 'damage', roll: '1' }] } };
    expect((await switchesOf({ ...LADEN, items: noCount, conditions: { ...LADEN.conditions, ...burning } })).turn_effects).toBe(true);
    expect((await switchesOf({ ...LADEN, items: noCount, conditions: { ...LADEN.conditions, dazed: { name: 'Dazed', ends: 'next_turn' } } })).turn_effects).toBe(false);
  });
});

describe('what to do', () => {
  const on = (...ids) => new Set(ids);
  it('on when the band names one; off what it put on; the GM\'s left alone; nothing when nothing changed', () => {
    expect(bandStep({ want: 'slowed', had: null, onToken: on() })).toEqual({ remove: null, add: 'slowed', record: 'slowed' });
    expect(bandStep({ want: null, had: 'slowed', onToken: on('slowed') })).toEqual({ remove: 'slowed', add: null, record: null });
    expect(bandStep({ want: 'exhausted', had: 'slowed', onToken: on('slowed') })).toEqual({ remove: 'slowed', add: 'exhausted', record: 'exhausted' });
    // Already on the token, put there by the GM: left, and never the band's to take off.
    expect(bandStep({ want: 'slowed', had: null, onToken: on('slowed') })).toEqual({ remove: null, add: null, record: null });
    // Taken off by the GM while the band held it: gone already, and the band forgets it.
    expect(bandStep({ want: null, had: 'slowed', onToken: on() })).toEqual({ remove: null, add: null, record: null });
    expect(bandStep({ want: 'slowed', had: 'slowed', onToken: on() })).toEqual({ remove: null, add: null, record: 'slowed' });
  });
});

describe('at the table', () => {
  let db;
  const ID = 'sys_ladenladenladenl';
  const table = async () => {
    const shared = [];
    let connection;
    const io = { on: (e, cb) => { if (e === 'connection') connection = cb; }, emit: (event, data) => shared.push({ event, data }), to: () => ({ emit: () => {} }) };
    socketsFactory(io, db, { elevatedUsers: new Set(), emitUpdate: vi.fn(), recordAction: vi.fn() });
    const handlers = {};
    connection({ id: `band-${Math.random()}`, on: (e, fn) => { handlers[e] = fn; }, emit: () => {}, broadcast: { emit: () => {} }, use: () => {}, join: () => {}, disconnect: () => {} });
    handlers.identify('kes');
    await drain(db);
    return { shared, carry: (...rows) => handlers.updateSheetField({ fieldId: 'inventory', value: JSON.stringify(rows) }), handlers };
  };
  const token = async () => JSON.parse((await get(db, "SELECT conditions FROM locations WHERE owner = 'kes'")).conditions).map((c) => c.id);
  const sheet = async () => JSON.parse((await get(db, "SELECT data FROM character_sheets WHERE username = 'kes'")).data);
  const lines = () => new Promise((ok) => db.all('SELECT historyString FROM dice_rolls ORDER BY id', (e, rows) => ok((rows || []).map((r) => r.historyString))));

  beforeEach(async () => {
    db = await makeTestDb();
    await run(db, `CREATE TABLE IF NOT EXISTS dice_rolls (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, total INTEGER NOT NULL,
      results TEXT NOT NULL, color TEXT NOT NULL, historyString TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    const def = JSON.stringify(LADEN);
    await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', [ID, 'Laden', def, def]);
    await new Promise((resolve) => runtime.load(db, resolve));
    await run(db, 'INSERT INTO global_settings (key, value) VALUES (\'game_system\', ?)', [ID]);
    await run(db, 'INSERT INTO character_sheets (username, system, data, is_npc) VALUES (\'kes\', ?, ?, 0)', [ID, JSON.stringify({ name: 'Kes', might: 5, capacity: 50 })]);
    await run(db, 'INSERT INTO locations (name, x, y, z, shape, owner, hp_current, hp_max, hp_temp, conditions) VALUES (?, 0, 0, 0, ?, ?, 10, 10, 0, ?)', ['Kes', 'rhombus', 'kes', '[{"id":"prone"}]']);
  });

  it('into a band naming one: on the token, kept on the sheet, said in the log; out again, off, said', async () => {
    const { carry, shared } = await table();
    carry(line('Pack', { qty: 3 }));
    await until(async () => (await token()).includes('slowed') && (await lines()).length === 1, { label: 'slowed on' });
    expect(await token()).toEqual(['prone', 'slowed']);
    await until(async () => (await sheet())[BAND_KEY] === 'slowed', { label: 'kept on the sheet' });
    expect(await lines()).toEqual(['KES · ENCUMBERED: SLOWED ON']);
    expect(shared.some((e) => e.event === 'diceRollBroadcast' && e.data.quiet === true && e.data.historyString === 'KES · ENCUMBERED: SLOWED ON')).toBe(true);
    expect(shared.some((e) => e.event === 'dataUpdated')).toBe(true);
    expect((await sheet())._worked.carrying).toMatchObject({ band: 'ENCUMBERED', says: 'Speed -10 ft.', condition: 'slowed' });
    carry(line('Pack'));
    await until(async () => (await lines()).length === 2 && (await sheet())[BAND_KEY] === undefined, { label: 'slowed off' });
    expect(await token()).toEqual(['prone']);
    expect((await lines())[1]).toBe('KES · LIGHT: SLOWED OFF');
  });

  it('one band to the next: the first off and the next on, in one line', async () => {
    const { carry } = await table();
    carry(line('Pack', { qty: 3 }));
    await until(async () => (await sheet())[BAND_KEY] === 'slowed', { label: 'slowed' });
    carry(line('Pack', { qty: 6 }));
    await until(async () => (await sheet())[BAND_KEY] === 'exhausted' && (await lines()).length === 2, { label: 'exhausted' });
    expect(await token()).toEqual(['prone', 'exhausted']);
    expect((await lines())[1]).toBe('KES · OVERLOADED: SLOWED OFF, EXHAUSTED ON');
  });

  it('a SLOWED the GM put on stays when the pack comes off: the band only takes off what it put on', async () => {
    await run(db, "UPDATE locations SET conditions = '[{\"id\":\"slowed\"}]' WHERE owner = 'kes'");
    const { carry } = await table();
    carry(line('Pack', { qty: 3 }));
    await until(async () => (await sheet())._worked?.carrying?.band === 'ENCUMBERED', { label: 'encumbered' });
    carry(line('Pack'));
    await until(async () => (await sheet())._worked?.carrying?.band === 'LIGHT', { label: 'light again' });
    await drain(db);
    expect(await token()).toEqual(['slowed']);
    expect(await lines()).toEqual([]);
    expect((await sheet())[BAND_KEY]).toBeUndefined();
  });

  it('switched off at this table, nothing goes on, and what had is taken off at the next save', async () => {
    const { carry } = await table();
    carry(line('Pack', { qty: 3 }));
    await until(async () => (await sheet())[BAND_KEY] === 'slowed', { label: 'slowed' });
    await run(db, 'INSERT INTO global_settings (key, value) VALUES (?, \'0\')', [BAND_SETTING]);
    carry(line('Pack', { qty: 4 }));
    await until(async () => (await sheet())[BAND_KEY] === undefined && !(await token()).includes('slowed'), { label: 'taken off' });
    carry(line('Pack', { qty: 6 }));
    await until(async () => (await sheet())._worked?.carrying?.band === 'OVERLOADED', { label: 'overloaded' });
    await drain(db);
    expect(await token()).toEqual(['prone']);
  });

  describe("the GAME tab's BAND CONDITIONS switched (8a6b)", () => {
    const GM = jwt.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, 'test-secret');
    const was = process.env.SECURE_MODE;
    afterEach(() => { if (was === undefined) delete process.env.SECURE_MODE; else process.env.SECURE_MODE = was; });

    it('off takes what the bands put on off every player at once, said in the log; on puts it back', async () => {
      const { carry } = await table();
      carry(line('Pack', { qty: 3 }));
      await until(async () => (await sheet())[BAND_KEY] === 'slowed', { label: 'slowed' });
      process.env.SECURE_MODE = 'true';
      const app = express();
      app.use(express.json());
      app.use('/api/admin', adminRouteFactory(db, { emit: vi.fn() }, { emitUpdate: () => {}, recordAction: () => {} }));
      await request(app).post('/api/admin/settings').set({ Authorization: `Bearer ${GM}` }).send({ key: BAND_SETTING, value: '0' });
      await until(async () => !(await token()).includes('slowed') && (await sheet())[BAND_KEY] === undefined, { label: 'off at once' });
      expect(await token()).toEqual(['prone']);
      await until(async () => (await lines()).length === 2, { label: 'said' });
      expect((await lines())[1]).toBe('KES · ENCUMBERED: SLOWED OFF');
      await request(app).post('/api/admin/settings').set({ Authorization: `Bearer ${GM}` }).send({ key: BAND_SETTING, value: '1' });
      await until(async () => (await token()).includes('slowed') && (await sheet())[BAND_KEY] === 'slowed', { label: 'on again' });
    });

    it("only the game being played, and never an NPC's sheet; done when every one is", async () => {
      await run(db, "INSERT INTO global_settings (key, value) VALUES (?, '0')", [BAND_SETTING]);
      await run(db, "UPDATE character_sheets SET data = ? WHERE username = 'kes'", [JSON.stringify({ name: 'Kes', capacity: 50, [BAND_KEY]: 'slowed', inventory: JSON.stringify([line('Pack', { qty: 3 })]) })]);
      await run(db, "UPDATE locations SET conditions = '[{\"id\":\"slowed\"}]' WHERE owner = 'kes'");
      await run(db, "INSERT INTO character_sheets (username, system, data, is_npc, npc_label) VALUES ('kes', ?, ?, 1, 'Kes double')", [ID, JSON.stringify({ [BAND_KEY]: 'slowed' })]);
      await syncAllBandConditions(db, { io: { emit: vi.fn() }, runtime });
      expect(await token()).toEqual([]);
      expect((await sheet())[BAND_KEY]).toBeUndefined();
      // The NPC's sheet left as it was.
      expect(JSON.parse((await get(db, 'SELECT data FROM character_sheets WHERE is_npc = 1')).data)[BAND_KEY]).toBe('slowed');
      // Another game running: this one's sheets aren't touched.
      await run(db, "UPDATE global_settings SET value = '0' WHERE key = ?", [BAND_SETTING]);
      await run(db, "UPDATE locations SET conditions = '[{\"id\":\"slowed\"}]' WHERE owner = 'kes'");
      await run(db, "UPDATE character_sheets SET data = ? WHERE username = 'kes' AND is_npc = 0", [JSON.stringify({ name: 'Kes', capacity: 50, [BAND_KEY]: 'slowed' })]);
      await run(db, "UPDATE global_settings SET value = 'generic' WHERE key = 'game_system'");
      await syncAllBandConditions(db, { io: { emit: vi.fn() }, runtime });
      expect(await token()).toEqual(['slowed']);
    });
  });

  it('no token on the map: nothing put on, nothing kept', async () => {
    await run(db, "DELETE FROM locations WHERE owner = 'kes'");
    const { carry } = await table();
    carry(line('Pack', { qty: 3 }));
    await until(async () => (await sheet())._worked?.carrying?.band === 'ENCUMBERED', { label: 'encumbered' });
    await drain(db);
    expect((await sheet())[BAND_KEY]).toBeUndefined();
    expect(await lines()).toEqual([]);
  });

  it('a system no longer naming it: what the band put on comes off at the next save', async () => {
    const { carry } = await table();
    carry(line('Pack', { qty: 3 }));
    await until(async () => (await sheet())[BAND_KEY] === 'slowed', { label: 'slowed' });
    const plain = JSON.stringify({ ...LADEN, items: { ...LADEN.items, encumbrance: { ...LADEN.items.encumbrance, bands: LADEN.items.encumbrance.bands.map(({ condition, ...b }) => b), past_condition: undefined } } });
    await run(db, 'UPDATE custom_systems SET published = ? WHERE id = ?', [plain, ID]);
    await new Promise((resolve) => runtime.load(db, resolve));
    carry(line('Pack', { qty: 4 }));
    await until(async () => (await sheet())[BAND_KEY] === undefined && !(await token()).includes('slowed'), { label: 'taken off' });
  });

  it('only the word past them naming one is enough; an NPC\'s sheet, or another game\'s, never moves a player\'s token', async () => {
    const pastOnly = JSON.stringify({ ...LADEN, items: { ...LADEN.items, encumbrance: { ...LADEN.items.encumbrance, bands: LADEN.items.encumbrance.bands.map(({ condition, ...b }) => b) } } });
    await run(db, 'UPDATE custom_systems SET published = ? WHERE id = ?', [pastOnly, ID]);
    await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', ['sys_otherotherotherot', 'Other', pastOnly, pastOnly]);
    await new Promise((resolve) => runtime.load(db, resolve));
    const heavy = JSON.stringify([line('Pack', { qty: 6 })]);
    await run(db, 'INSERT INTO character_sheets (username, system, data, is_npc, npc_label) VALUES (\'kes\', ?, ?, 1, \'Kes double\')', [ID, JSON.stringify({ capacity: 50 })]);
    await run(db, 'INSERT INTO character_sheets (username, system, data, is_npc) VALUES (\'kes\', \'sys_otherotherotherot\', ?, 0)', [JSON.stringify({ capacity: 50 })]);
    const { mutateSheet } = require_('../sheets/mutate');
    const { carry } = await table();
    const write = (where) => new Promise((resolve) => db.get(`SELECT id FROM character_sheets WHERE ${where}`, (e, row) => mutateSheet(db, row.id, (d) => ({ ...d, inventory: heavy }), resolve)));
    await write('is_npc = 1');
    await write("system = 'sys_otherotherotherot'");
    await drain(db);
    expect(await token()).toEqual(['prone']);
    // The player's own sheet in the game being played: OVERLOADED, past them, puts EXHAUSTED on.
    carry(line('Pack', { qty: 6 }));
    await until(async () => (await token()).includes('exhausted'), { label: 'exhausted on' });
  });

  it('a band\'s condition APPLIED changes the numbers (8a5e1), and one raising CAN CARRY never lifts them out of its band and back', async () => {
    const strong = JSON.stringify({ ...LADEN, conditions: { ...LADEN.conditions, slowed: { ...LADEN.conditions.slowed, applied: true, modifiers: [{ target: 'might', way: 'times', amount: 3 }] } } });
    await run(db, 'UPDATE custom_systems SET published = ? WHERE id = ?', [strong, ID]);
    await new Promise((resolve) => runtime.load(db, resolve));
    const { carry } = await table();
    carry(line('Pack', { qty: 3 }));
    await until(async () => (await sheet())._conditions_applied?.includes('slowed'), { label: 'applied on the sheet' });
    await until(async () => (await sheet()).capacity === 150, { label: 'might tripled' });
    await drain(db);
    // Still ENCUMBERED, read without its own condition: one line, no going round.
    expect(await lines()).toEqual(['KES · ENCUMBERED: SLOWED ON']);
    expect(await token()).toEqual(['prone', 'slowed']);
    expect((await sheet())._worked.carrying).toMatchObject({ carried: 30, capacity: 50, band: 'ENCUMBERED' });
  });

  it('RELOAD using a line up works the sheet out again, its band following', async () => {
    const { carry, handlers } = await table();
    carry(line('Pistol', { counts: { ammo: 0 } }), line('Rounds', { qty: 6 }), line('Pack', { qty: 2 }));
    await until(async () => (await sheet())._worked?.carrying?.carried === 28, { label: 'carrying 28' });
    // The token follows a moment after the sheet: waited for itself.
    await until(async () => (await sheet())[BAND_KEY] === 'slowed', { label: 'slowed on' });
    await new Promise((resolve) => handlers.countAction({ kind: 'reload', line: 0, column: 'ammo' }, resolve));
    await until(async () => (await sheet())._worked.carrying.carried === 22, { label: 'carrying 22' });
    // 22 of 50: LIGHT again, and SLOWED comes off with it.
    expect((await sheet())._worked.carrying.band).toBe('LIGHT');
    await until(async () => !(await token()).includes('slowed'), { label: 'slowed off after the reload' });
  });
});
