/**
 * Calling a rest at the table (4f2b). Approved mockup builder-rests (2026-10-09): the GM, or a granted
 * editor, picks one of the running custom system's rests and who rests (every player character, the
 * ones named, and chosen NPC tokens); a preview says what each will get without rolling or writing;
 * calling it writes each sheet through its queue, the token's health and conditions after, and one
 * dice-log line per character for everyone.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createRequire } from 'module';
import { makeTestDb, get, all, run } from './helpers/testDb.js';
import sheetsRouteFactory from '../routes/sheets.js';

const require_ = createRequire(import.meta.url);
const runtime = require_('../systemBuilder/runtime');
const { whoProblem } = require_('../sheets/rests');
const { restLine, restDice } = require_('../systemBuilder/resting');
const { elevatedUsers } = require_('../middleware/auth');

const sign = (payload) => jwt.sign(payload, 'test-secret');
const GM = sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false });
const EDITOR = sign({ username: 'ghost', isTemporary: true });
const PLAYER = sign({ username: 'vex', role: 'player' });

const HEARTH = 'sys_aaaaaaaaaaaaaaaa';
const HEARTH_DEF = {
  format: 1, name: 'Hearth',
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'con_mod', label: 'Con mod' }] }],
  derived: [{ id: 'ward', label: 'Ward', formula: '@fatigue + 10' }],
  sheet: {
    sections: [
      { id: 'who', label: 'WHO', layout: 'list', fields: [{ id: 'name', label: 'Name', type: 'text' }, { id: 'notes', label: 'Notes', type: 'textarea' }] },
      { id: 'body', label: 'BODY', layout: 'grid', fields: [
        { id: 'hp', label: 'HP', type: 'number', source: 'token_hp', maxField: 'hp_max' },
        { id: 'hp_max', label: 'MAX', type: 'number', source: 'token_hp_max' },
        { id: 'fatigue', label: 'Fatigue', type: 'number' },
        { id: 'ward', label: 'Ward', type: 'number' },
      ] },
      { id: 'magic', label: 'MAGIC', layout: 'grid', fields: [
        { id: 'slots', label: 'Spell slots', type: 'number', maxField: 'slots_max' },
        { id: 'slots_max', label: 'Slots max', type: 'number' },
      ] },
    ],
  },
  rests: {
    short_rest: { refills: [{ what: 'health', how: 'by', amount: '1d8 + @con_mod' }] },
    long_rest: { counts_as: ['short_rest'], refills: [{ what: 'health', how: 'full' }, { what: 'fatigue', how: 'by', amount: '-1' }, { what: 'section:magic', how: 'max' }] },
    end_of_scene: { on: false },
    end_of_session: { refills: [{ what: 'slots', how: 'to', amount: '@ward - 10' }] },
  },
  conditions: { exhausted: { ends: 'rest', at: ['long_rest'] }, bleeding: { ends: 'rest', at: ['short_rest'] } },
};

let db;
let app;
let emitted;
let ids;

// A granted editor is one the server has on its list (middleware/auth.js).
afterEach(() => { elevatedUsers.delete('ghost'); });

beforeEach(async () => {
  elevatedUsers.add('ghost');
  db = await makeTestDb();
  await run(db, `CREATE TABLE IF NOT EXISTS dice_rolls (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, total INTEGER NOT NULL,
    results TEXT NOT NULL, color TEXT NOT NULL, historyString TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  const text = JSON.stringify(HEARTH_DEF);
  await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', [HEARTH, 'Hearth', text, text]);
  await new Promise((resolve) => runtime.load(db, resolve));
  await run(db, `INSERT INTO global_settings (key, value) VALUES ('game_system', ?)`, [HEARTH]);
  emitted = [];
  app = express();
  app.use(express.json());
  app.use('/api/sheets', sheetsRouteFactory(db, { emit: (event, payload) => emitted.push({ event, payload }) }));

  const sheet = async (username, system, data, isNpc = 0) => (await run(db,
    'INSERT INTO character_sheets (username, system, data, is_npc, npc_label) VALUES (?, ?, ?, ?, ?)',
    [username, system, JSON.stringify(data), isNpc, isNpc ? username : null])).lastID;
  const token = async (name, shape, owner, hp, conditions = []) => (await run(db,
    'INSERT INTO locations (name, x, y, z, shape, owner, hp_current, hp_max, hp_temp, conditions) VALUES (?, 0, 0, 0, ?, ?, ?, ?, 0, ?)',
    [name, shape, owner, hp[0], hp[1], JSON.stringify(conditions)])).lastID;

  ids = {
    vexSheet: await sheet('vex', HEARTH, { name: 'Vex', con_mod: 2, fatigue: 3, slots: 0, slots_max: 4, notes: 'keep me' }),
    ashSheet: await sheet('ash', HEARTH, { name: '', fatigue: 1, slots: 1, slots_max: 2 }),
    junoOther: await sheet('juno', 'cyberpunk_red', { fatigue: 5 }),
    gangerSheet: await sheet('Ganger', HEARTH, { fatigue: 2 }, 1),
    rookSheet: await sheet('Rook', HEARTH, { name: 'Rook', fatigue: 4 }),
    dogOtherSheet: await sheet('Dog', 'cyberpunk_red', { fatigue: 3 }, 1),
    vex: await token('VEX', 'rhombus', 'vex', [9, 22], [{ id: 'exhausted' }, { id: 'prone' }, { id: 'bleeding' }]),
    vexOnMap: await token('VEX', 'rhombus', 'vex', [9, 22], [{ id: 'exhausted' }, { id: 'prone' }, { id: 'bleeding' }]),
    juno: await token('JUNO', 'rhombus', 'juno', [3, 10]),
    ganger: await token('GANGER', 'enemy_rhombus', 'gm', [4, 12], [{ id: 'exhausted' }]),
    dog: await token('DOG', 'friendly_rhombus', 'gm', [1, 6]),
    shop: await token('SHOP', 'box', null, [0, 0]),
  };
  await run(db, 'INSERT INTO npc_sheet_links (location_id, sheet_id) VALUES (?, ?)', [ids.ganger, ids.gangerSheet]);
  await run(db, 'INSERT INTO npc_sheet_links (location_id, sheet_id) VALUES (?, ?)', [ids.dog, ids.dogOtherSheet]);
});

const rest = (body, as = GM) => request(app).post('/api/sheets/rest').set('Authorization', `Bearer ${as}`).send(body);
const dataOf = async (id) => JSON.parse((await get(db, 'SELECT data FROM character_sheets WHERE id = ?', [id])).data);
const tokenOf = async (id) => {
  const row = await get(db, 'SELECT hp_current, hp_max, conditions FROM locations WHERE id = ?', [id]);
  return { hp: [row.hp_current, row.hp_max], conditions: JSON.parse(row.conditions) };
};
const named = (characters) => characters.map((c) => c.name);

describe('the rests the GAME tab offers', () => {
  it('are the running custom system\'s that are on; a built-in game has none here', async () => {
    const res = await request(app).get('/api/sheets/rests').set('Authorization', `Bearer ${GM}`);
    expect(res.body).toEqual({ system: HEARTH, rests: [{ id: 'short_rest', name: 'Short rest' }, { id: 'long_rest', name: 'Long rest' }, { id: 'end_of_session', name: 'End of session' }] });
    await run(db, `UPDATE global_settings SET value = 'cities_without_number' WHERE key = 'game_system'`);
    expect((await request(app).get('/api/sheets/rests').set('Authorization', `Bearer ${EDITOR}`)).body).toEqual({ system: 'cities_without_number', rests: [] });
    expect((await request(app).get('/api/sheets/rests').set('Authorization', `Bearer ${PLAYER}`)).status).toBe(403);
  });
});

describe('a preview', () => {
  it('says what each player character would get, dice unrolled, and writes nothing', async () => {
    const res = await rest({ rest: 'short_rest', players: true, preview: true });
    expect(res.status).toBe(200);
    expect(res.body.rest).toEqual({ id: 'short_rest', name: 'Short rest' });
    expect(res.body.preview).toBe(true);
    // In this system only, a player with no token on the map included, by name or else login.
    expect(res.body.characters).toEqual([
      { kind: 'player', username: 'ash', name: 'ash', changes: [], gone: [] },
      { kind: 'player', username: 'Rook', name: 'Rook', changes: [], gone: [] },
      { kind: 'player', username: 'vex', name: 'Vex', changes: [{ what: 'health', label: 'HP', from: 9, to: null, pending: ['1d8 + @con_mod'] }], gone: ['Bleeding'] },
    ]);
    expect(await tokenOf(ids.vex)).toEqual({ hp: [9, 22], conditions: [{ id: 'exhausted' }, { id: 'prone' }, { id: 'bleeding' }] });
    expect(await all(db, 'SELECT * FROM dice_rolls')).toEqual([]);
    expect(emitted).toEqual([]);
  });
});

describe('calling a rest', () => {
  it('writes each player\'s sheet, every token of theirs, and a dice-log line each, telling every screen', async () => {
    const res = await rest({ rest: 'long_rest', players: true });
    expect(res.status).toBe(200);
    expect(named(res.body.characters)).toEqual(['ash', 'Rook', 'Vex']);
    const vex = res.body.characters[2];
    expect(vex.changes).toEqual([
      { what: 'health', label: 'HP', from: 9, to: 22 },
      { what: 'fatigue', label: 'Fatigue', from: 3, to: 2 },
      { what: 'slots', label: 'Spell slots', from: 0, to: 4 },
    ]);
    expect(vex.gone).toEqual(['Exhausted', 'Bleeding']);

    // The sheet, its formulas worked out again (ward reads fatigue), and nothing else touched.
    expect(await dataOf(ids.vexSheet)).toEqual({ name: 'Vex', con_mod: 2, fatigue: 2, slots: 4, slots_max: 4, notes: 'keep me', ward: 12 });
    expect(await dataOf(ids.ashSheet)).toMatchObject({ fatigue: 0, slots: 2 });
    for (const id of [ids.vex, ids.vexOnMap]) expect(await tokenOf(id)).toEqual({ hp: [22, 22], conditions: [{ id: 'prone' }] });
    // Another game's character and every NPC rest only when asked.
    expect(await dataOf(ids.junoOther)).toEqual({ fatigue: 5 });
    expect(await tokenOf(ids.juno)).toEqual({ hp: [3, 10], conditions: [] });
    expect(await tokenOf(ids.ganger)).toEqual({ hp: [4, 12], conditions: [{ id: 'exhausted' }] });

    const lines = await all(db, 'SELECT username, total, results, color, historyString FROM dice_rolls ORDER BY id');
    expect(lines.map((l) => l.username)).toEqual(['ash', 'Rook', 'vex']);
    expect(lines[2].historyString).toMatch(/^LONG REST · Vex: HP 9 → 22, Fatigue 3 → 2, Spell slots 0 → 4; Exhausted, Bleeding wore off; rolled 1d8 \+ @con_mod = \d+ \(1d8: \d\)$/);
    expect(res.body.characters[2].line).toBe(lines[2].historyString);
    // The short rest's die was rolled even though full health settled it: the log shows it.
    const vexDie = JSON.parse(lines[2].results);
    expect(Object.keys(vexDie)).toEqual(['8']);
    expect(lines[2].total).toBe(vexDie[8][0]);

    expect(emitted.filter((e) => e.event === 'diceRollBroadcast').map((e) => e.payload.historyString)).toEqual(lines.map((l) => l.historyString));
    expect(emitted.filter((e) => e.event === 'sheetUpdated').map((e) => e.payload.username)).toEqual(['ash', 'Rook', 'vex']);
    expect(emitted.filter((e) => e.event === 'dataUpdated')).toEqual([{ event: 'dataUpdated', payload: { isRhombusOnly: true } }]);
  });

  it('rolls the short rest\'s dice for health, up to the maximum', async () => {
    await rest({ rest: 'short_rest', players: ['VEX'] });
    const [line] = await all(db, 'SELECT results, total, historyString FROM dice_rolls');
    const die = JSON.parse(line.results)[8][0];
    expect(die).toBeGreaterThanOrEqual(1);
    expect(die).toBeLessThanOrEqual(8);
    expect((await tokenOf(ids.vex)).hp).toEqual([9 + die + 2, 22]);
    expect(line.historyString).toBe(`SHORT REST · Vex: HP 9 → ${9 + die + 2}; Bleeding wore off; rolled 1d8 + @con_mod = ${die + 2} (1d8: ${die})`);
  });

  it('rests only the players named, whatever their case, and no player at all for false', async () => {
    const res = await rest({ rest: 'long_rest', players: ['ASH', 'rook'] });
    expect(named(res.body.characters)).toEqual(['ash', 'Rook']);
    expect((await tokenOf(ids.vex)).hp).toEqual([9, 22]);
    const npcsOnly = await rest({ rest: 'long_rest', players: false, npcs: [ids.ganger] });
    expect(named(npcsOnly.body.characters)).toEqual(['GANGER']);
  });

  it('reads the character\'s formulas worked out', async () => {
    // Ward is fatigue + 10, never stored on Vex's sheet: slots become 3 + 10 - 10.
    await rest({ rest: 'end_of_session', players: ['vex'] });
    expect(await dataOf(ids.vexSheet)).toMatchObject({ slots: 3 });
  });

  it('works each rest out from the sheet as it stands when written, so two at once both land', async () => {
    await Promise.all([rest({ rest: 'long_rest', players: ['vex'] }), rest({ rest: 'long_rest', players: ['vex'] })]);
    expect(await dataOf(ids.vexSheet)).toMatchObject({ fatigue: 1 });
  });

  it('rests the chosen NPC tokens, with their linked sheet or none, and nothing that isn\'t an NPC', async () => {
    const res = await rest({ rest: 'long_rest', npcs: [ids.ganger, ids.dog, ids.shop, ids.vex] });
    expect(named(res.body.characters)).toEqual(['GANGER', 'DOG']);
    expect(res.body.characters[0]).toMatchObject({ kind: 'npc', location_id: ids.ganger, gone: ['Exhausted'] });
    expect(await dataOf(ids.gangerSheet)).toMatchObject({ fatigue: 1 });
    expect(await tokenOf(ids.ganger)).toEqual({ hp: [12, 12], conditions: [] });
    expect(await tokenOf(ids.dog)).toEqual({ hp: [6, 6], conditions: [] });
    // The dog's sheet is another game's: not this game's to rest.
    expect(await dataOf(ids.dogOtherSheet)).toEqual({ fatigue: 3 });
    expect((await tokenOf(ids.vex)).hp).toEqual([9, 22]);
    expect(emitted.filter((e) => e.event === 'sheetUpdated')).toEqual([]);
    expect((await all(db, 'SELECT username FROM dice_rolls ORDER BY id')).map((l) => l.username)).toEqual(['GANGER', 'DOG']);
  });

  it('keeps an edit a player makes to their sheet while the rest is written', async () => {
    const [rested, edited] = await Promise.all([
      rest({ rest: 'long_rest', players: ['vex'] }),
      request(app).put('/api/sheets/user/vex').set('Authorization', `Bearer ${GM}`).send({ fields: { notes: 'edited mid-rest' } }),
    ]);
    expect(rested.status).toBe(200);
    expect(edited.status).toBe(200);
    expect(await dataOf(ids.vexSheet)).toMatchObject({ notes: 'edited mid-rest', fatigue: 2, slots: 4 });
  });

  it('tells nobody when nobody rests', async () => {
    const res = await rest({ rest: 'long_rest', players: ['nobody'] });
    expect(res.body.characters).toEqual([]);
    expect(emitted).toEqual([]);
  });
});

describe('refusals', () => {
  it('are the GM\'s and granted editors\' to call', async () => {
    expect((await rest({ rest: 'long_rest', players: true }, PLAYER)).status).toBe(403);
    expect((await rest({ rest: 'long_rest', players: true }, EDITOR)).status).toBe(200);
  });

  it('name a rest the game hasn\'t got, has turned off, or a built-in game\'s', async () => {
    expect((await rest({ rest: 'nap', players: true })).body).toEqual({ error: 'Not one of this game\'s rests' });
    expect((await rest({ rest: 'end_of_scene', players: true })).status).toBe(400);
    await run(db, `UPDATE global_settings SET value = 'cities_without_number' WHERE key = 'game_system'`);
    const builtIn = await rest({ rest: 'long_rest', players: true });
    expect(builtIn.status).toBe(409);
    expect(builtIn.body).toEqual({ error: 'This game\'s rests are its own buttons' });
  });

  it('read who rests only as true or a list of names, and NPCs only as token ids', async () => {
    for (const [players, npcs] of [['all', undefined], [[1], undefined], [Array(101).fill('x'), undefined], [true, 'all'], [true, [0]], [true, [1.5]], [true, Array(101).fill(1)]]) {
      expect(whoProblem(players, npcs), JSON.stringify([players, npcs]).slice(0, 40)).not.toBeNull();
    }
    for (const [players, npcs] of [[undefined, undefined], [true, undefined], [false, [1, 2]], [['vex'], []]]) {
      expect(whoProblem(players, npcs)).toBeNull();
    }
    expect((await rest({ rest: 'long_rest', players: 'all' })).body).toEqual({ error: 'players: true, or a list of up to 100 player names' });
    expect((await rest({ rest: 'long_rest', npcs: ['x'] })).body).toEqual({ error: 'npcs: a list of up to 100 token ids' });
  });
});

describe('the dice-log line and its dice', () => {
  it('reads as the mockup\'s, with nothing changed said so', () => {
    const result = { changes: [{ label: 'HP', from: 9, to: 16 }, { label: 'Focus', from: 1, to: null, pending: ['1d4', '-1'] }], gone: ['poisoned'], rolls: [
      { amount: '1d8 + 2', value: 7, dice: [{ count: 1, sides: 8, rolls: [5] }] }, { amount: '-1', value: -1, dice: [] }, { amount: '0d6', value: 0, dice: [{ count: 0, sides: 6, rolls: [] }] },
    ] };
    expect(restLine({}, 'Long rest', 'Vex', result)).toBe('LONG REST · Vex: HP 9 → 16, Focus 1 → 1 + 1d4 + -1; Poisoned wore off; rolled 1d8 + 2 = 7 (1d8: 5), 0d6 = 0 (0d6: -)');
    expect(restLine({}, 'Nap', 'Ash', { changes: [], gone: [], rolls: [] })).toBe('NAP · Ash: nothing changed');
    expect(restDice(result)).toEqual({ results: { 8: [5], 6: [] }, total: 5 });
    expect(restDice({ rolls: [{ dice: [{ sides: 6, rolls: [2, 3] }] }, { dice: [{ sides: 6, rolls: [4] }] }] })).toEqual({ results: { 6: [2, 3, 4] }, total: 9 });
  });
});
