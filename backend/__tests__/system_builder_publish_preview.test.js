/**
 * What PUBLISH would change, through the route (4h1b; approved mockup docs/mockups/version-preview.html,
 * 2026-10-13): the draft against the published version for every character playing it, with what
 * lives outside their sheets (token health, money, conditions on tokens) read where the system keeps
 * it, or on the SAMPLE values when nobody plays it. The main admin only; nothing is written.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createRequire } from 'module';
import { makeTestDb, get, run } from './helpers/testDb.js';

process.env.JWT_SECRET = 'test-secret';
const require_ = createRequire(import.meta.url);
const { elevatedUsers } = require_('../middleware/auth');
const systemsRoute = require_('../routes/systems.js');

const GM = jwt.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, 'test-secret');
const EDITOR = jwt.sign({ username: 'ghost', isTemporary: true }, 'test-secret');
const PLAYER = jwt.sign({ username: 'vex', role: 'player' }, 'test-secret');
const bearer = (t) => ({ Authorization: `Bearer ${t}` });

const HEARTH = 'sys_aaaaaaaaaaaaaaaa';
const EMBER = 'sys_bbbbbbbbbbbbbbbb';
const NEW = 'sys_cccccccccccccccc';

const sheet = (fields) => ({ tabs: ['MAIN'], sections: [{ id: 'main', label: 'MAIN', layout: 'list', fields }] });
const FIELDS = [
  { id: 'name', label: 'Name', type: 'text' },
  { id: 'reputation', label: 'Reputation', type: 'number' },
  { id: 'hp', label: 'HP', type: 'number', source: 'token_hp' },
  { id: 'cash', label: 'Cash', type: 'number', source: 'bank_balance' },
];
const V2 = {
  format: 1, name: 'Hearth',
  stats: [{ id: 'attrs', label: 'ATTRIBUTES', stats: [{ id: 'agility', label: 'Agility', min: 3, max: 18 }] }],
  samples: { agility: 14 },
  derived: [{ id: 'defense', label: 'Defense', formula: '10 + @agility' }],
  sheet: sheet(FIELDS),
  currencies: [{ id: 'gold', name: 'Gold' }, { id: 'favor', name: 'Favor' }],
  conditions: { cursed: { name: 'Cursed' } },
};
const V3 = {
  ...V2,
  derived: [{ id: 'defense', label: 'Defense', formula: '10 + @agility + 2' }, { id: 'grit', label: 'Grit', formula: '@hp + @cash' }],
  sheet: sheet(FIELDS.filter((f) => f.id !== 'reputation')),
  currencies: [{ id: 'gold', name: 'Gold' }],
  conditions: {},
};

let db;
let app;
let ids;

const add = (id, draft, published, version) => run(db,
  'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, ?)',
  [id, draft.name, JSON.stringify(draft), published ? JSON.stringify(published) : null, version]);
const sheetRow = async (username, data, isNpc = 0, system = HEARTH, label = username) => (await run(db,
  'INSERT INTO character_sheets (username, system, data, is_npc, npc_label) VALUES (?, ?, ?, ?, ?)',
  [username, system, JSON.stringify(data), isNpc, isNpc ? label : null])).lastID;
const token = async (name, shape, owner, hp, conditions = []) => (await run(db,
  'INSERT INTO locations (name, x, y, z, shape, owner, hp_current, hp_max, melee_ac, conditions) VALUES (?, 0, 0, 0, ?, ?, ?, ?, 10, ?)',
  [name, shape, owner, hp, hp, JSON.stringify(conditions)])).lastID;
const running = (system) => run(db, `INSERT OR REPLACE INTO global_settings (key, value) VALUES ('game_system', ?)`, [system]);

beforeEach(async () => {
  elevatedUsers.add('ghost');
  db = await makeTestDb();
  app = express();
  app.use(express.json());
  app.use('/api/systems', systemsRoute(db, { emit: () => {} }));
  await add(HEARTH, V3, V2, 2);
  await add(EMBER, { ...V3, name: 'Ember' }, { ...V2, name: 'Ember' }, 1);
  await add(NEW, { format: 1, name: 'Kindling' }, null, 0);
  ids = {
    vex: await sheetRow('vex', { name: 'Vex', agility: 14, reputation: 3 }),
    rook: await sheetRow('rook', { name: '  ', agility: 12 }),
    ganger: await sheetRow('npc_ganger', { agility: 10 }, 1, HEARTH, 'Ganger'),
    elsewhere: await sheetRow('vex', { name: 'Vex', agility: 18 }, 0, 'cities_without_number'),
    vexToken: await token('VEX', 'rhombus', 'vex', 9, [{ id: 'cursed' }, { id: 'prone' }]),
    // On a battle map: the city map's token is the one read.
    vexInside: await run(db, `INSERT INTO locations (name, x, y, z, shape, owner, hp_current, hp_max, battle_map_id, conditions) VALUES ('VEX', 0, 0, 0, 'rhombus', 'vex', 1, 1, 77, '[]')`),
    gangerToken: await token('GANGER', 'enemy_rhombus', 'gm', 4),
  };
  await run(db, 'INSERT INTO npc_sheet_links (location_id, sheet_id) VALUES (?, ?)', [ids.gangerToken, ids.ganger]);
  await run(db, 'INSERT INTO bank_accounts (username, system, balance, debt) VALUES (?, ?, ?, ?)', ['vex', HEARTH, 50, 0]);
  await run(db, 'INSERT INTO bank_balances (username, system, currency, balance, debt) VALUES (?, ?, ?, ?, ?)', ['vex', HEARTH, 'favor', 12, 0]);
  await run(db, 'INSERT INTO bank_balances (username, system, currency, balance, debt) VALUES (?, ?, ?, ?, ?)', ['rook', HEARTH, 'favor', 0, 0]);
  // An account by an NPC's name is a player's, never the NPC's.
  await run(db, 'INSERT INTO bank_accounts (username, system, balance, debt) VALUES (?, ?, ?, ?)', ['npc_ganger', HEARTH, 100, 0]);
  await run(db, 'INSERT INTO bank_balances (username, system, currency, balance, debt) VALUES (?, ?, ?, ?, ?)', ['npc_ganger', HEARTH, 'favor', 5, 0]);
  await running(HEARTH);
});
afterEach(() => { elevatedUsers.delete('ghost'); });

const preview = (system = HEARTH, as = GM) => request(app).get(`/api/systems/${system}/publish-preview`).set(bearer(as));
const byName = (body, name) => body.characters.find((c) => c.name === name);

describe('the preview', () => {
  it('is v2 to v3, with the changes and every character playing it, players then NPCs', async () => {
    const res = await preview();
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ first: false, from: 2, to: 3, problems: 0, sample: null });
    expect(res.body.changes.map((c) => `${c.kind} ${c.change} ${c.id}`)).toEqual([
      'sheet removed reputation', 'formula changed defense', 'formula added grit', 'currency removed favor', 'condition removed cursed',
    ]);
    expect(res.body.characters.map((c) => [c.kind, c.username ?? c.sheet_id, c.name])).toEqual([
      ['player', 'rook', 'rook'], ['player', 'vex', 'Vex'], ['npc', ids.ganger, 'Ganger'],
    ]);
  });

  it('says for each what they hold that stops showing, their numbers, money and conditions', async () => {
    const vex = byName((await preview()).body, 'Vex');
    expect(vex.changes).toEqual([
      { kind: 'sheet', change: 'removed', id: 'reputation', label: 'Reputation', value: 3 },
      { kind: 'formula', change: 'value', id: 'defense', label: 'Defense', from: 24, to: 26 },
      // Worked out with the token's health and the bank's cash, as the sheet shows them.
      { kind: 'formula', change: 'value', id: 'grit', label: 'Grit', from: null, to: 59 },
      { kind: 'currency', change: 'held', id: 'favor', label: 'Favor', balance: 12, debt: 0 },
      { kind: 'condition', change: 'on_token', id: 'cursed', label: 'Cursed' },
    ]);
  });

  it('leaves out an empty balance, no token, and no money for an NPC', async () => {
    const body = (await preview()).body;
    expect(byName(body, 'rook').changes).toEqual([
      { kind: 'formula', change: 'value', id: 'defense', label: 'Defense', from: 22, to: 24 },
      { kind: 'formula', change: 'value', id: 'grit', label: 'Grit', from: null, to: 0 },
    ]);
    expect(byName(body, 'Ganger').changes).toEqual([
      { kind: 'formula', change: 'value', id: 'defense', label: 'Defense', from: 20, to: 22 },
      { kind: 'formula', change: 'value', id: 'grit', label: 'Grit', from: null, to: 4 },
    ]);
  });

  it('reads a token from where the system keeps it while another game runs', async () => {
    await running('cities_without_number');
    await run(db, 'INSERT INTO token_vitals (location_id, system, hp_current, hp_max, melee_ac, conditions) VALUES (?, ?, 7, 7, 10, ?)', [ids.vexToken, 'cyberpunk_red', '[]']);
    await run(db, 'INSERT INTO token_vitals (location_id, system, hp_current, hp_max, melee_ac, conditions) VALUES (?, ?, 3, 3, 10, ?)', [ids.vexToken, HEARTH, '[]']);
    const vex = byName((await preview()).body, 'Vex');
    expect(vex.changes.find((c) => c.id === 'grit')).toMatchObject({ to: 53 });
    expect(vex.changes.find((c) => c.kind === 'condition')).toBeUndefined();
  });

  it('reads a removed first currency from the main account', async () => {
    await run(db, 'UPDATE custom_systems SET draft = ? WHERE id = ?', [JSON.stringify({ ...V2, currencies: [{ id: 'favor', name: 'Favor' }] }), HEARTH]);
    const vex = byName((await preview()).body, 'Vex');
    expect(vex.changes.filter((c) => c.kind === 'currency')).toEqual([{ kind: 'currency', change: 'held', id: 'gold', label: 'Gold', balance: 50, debt: 0 }]);
  });

  it('reads a linked field only the draft has', async () => {
    const v3 = { ...V3, sheet: sheet([...FIELDS, { id: 'hp_top', label: 'Max HP', type: 'number', source: 'token_hp_max' }]), derived: [...V3.derived, { id: 'spare', label: 'Spare', formula: '@hp_top - @hp' }] };
    await run(db, 'UPDATE custom_systems SET draft = ? WHERE id = ?', [JSON.stringify(v3), HEARTH]);
    await run(db, 'UPDATE locations SET hp_max = 20 WHERE id = ?', [ids.vexToken]);
    expect(byName((await preview()).body, 'Vex').changes.find((c) => c.id === 'spare')).toMatchObject({ from: null, to: 11 });
  });

  it('works the numbers out on the SAMPLE values when nobody plays it', async () => {
    const res = await preview(EMBER);
    expect(res.body).toMatchObject({ first: false, from: 1, to: 2, characters: [] });
    expect(res.body.sample).toEqual([
      { kind: 'formula', change: 'value', id: 'defense', label: 'Defense', from: 24, to: 26 },
      { kind: 'formula', change: 'value', id: 'grit', label: 'Grit', from: null, to: 0 },
    ]);
  });

  it('has nothing to compare a first version with', async () => {
    expect((await preview(NEW)).body).toEqual({ first: true, problems: 0 });
  });

  it('counts the problems PUBLISH would refuse', async () => {
    await run(db, 'UPDATE custom_systems SET draft = ? WHERE id = ?', [JSON.stringify({ ...V3, derived: [{ id: 'defense', formula: '10 +' }] }), HEARTH]);
    expect((await preview()).body.problems).toBeGreaterThan(0);
  });

  it('writes nothing', async () => {
    const before = await get(db, 'SELECT data FROM character_sheets WHERE id = ?', [ids.vex]);
    const system = await get(db, 'SELECT draft, published, version FROM custom_systems WHERE id = ?', [HEARTH]);
    await preview();
    expect(await get(db, 'SELECT data FROM character_sheets WHERE id = ?', [ids.vex])).toEqual(before);
    expect(await get(db, 'SELECT draft, published, version FROM custom_systems WHERE id = ?', [HEARTH])).toEqual(system);
  });
});

describe('who may ask', () => {
  it('the main admin only', async () => {
    expect((await preview(HEARTH, EDITOR)).status).toBe(403);
    expect((await preview(HEARTH, PLAYER)).status).toBe(403);
    expect((await request(app).get(`/api/systems/${HEARTH}/publish-preview`)).status).toBe(401);
  });

  it('about a system that exists', async () => {
    expect((await preview('sys_eeeeeeeeeeeeeeee')).status).toBe(404);
    expect((await preview('cities_without_number')).status).toBe(404);
  });
});
