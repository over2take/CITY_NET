/**
 * The random-system soak, part two (4k3; plan row 4k random-system-soak): each random system
 * (helpers/randomSystem.js) running as the game, played through the real routes and sockets. A
 * player's token takes damage and heals the way its health model does, or is refused as the model
 * says; a condition the game offers goes on and one it doesn't is refused; a rest is called; a
 * tracker starts; a balance is asked for; the GM asks what can be given. Where the system turned a
 * part off, that part is refused and changes nothing. Nothing throws anywhere: an error in a
 * handler fails the run.
 *
 * A few seeds in CI; SOAK_SEEDS=200 runs more. Every failure names its seed.
 */

import { it, expect, vi, beforeAll, afterAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createRequire } from 'module';
import { makeTestDb, run, get, all } from './helpers/testDb.js';
import { drain, untilValue } from './helpers/until.js';
import locationsRouteFactory from '../routes/locations.js';

process.env.JWT_SECRET = 'test-secret';
const require_ = createRequire(import.meta.url);
const { randomSystem } = require_('./helpers/randomSystem');
const runtime = require_('../systemBuilder/runtime');
const sheetsRouteFactory = require_('../routes/sheets.js');
const socketsFactory = require_('../sockets/index.js');
const initiative = require_('../sockets/initiative.js');
const registerInitiativeHandlers = initiative.registerInitiativeHandlers || initiative.default.registerInitiativeHandlers;

const GM = jwt.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, 'test-secret');
const AS_GM = { Authorization: `Bearer ${GM}` };
const { partOn } = require_('../systemBuilder/parts');
const { HEALTH_MODELS } = require_('../systemBuilder/core');

/**
 * The seeds CI plays: the first from 2000 on for each thing worth playing (every health model, and
 * each part this run touches turned off), and a few more as they come. SOAK_SEEDS=N plays N in a
 * row instead.
 */
const chosenSeeds = () => {
  const wanted = [
    ...HEALTH_MODELS.map((m) => (d) => d.core.health.model === m.id && partOn(d, 'token_health')),
    ...['token_health', 'initiative', 'bank', 'give_items'].map((p) => (d) => !partOn(d, p)),
    (d) => d.conditions && Object.keys(d.conditions).some((c) => /^cond/.test(c)),
    (d) => d.rests && Object.keys(d.rests).some((r) => /^rest/.test(r)),
  ];
  const seeds = new Set([2000, 2001, 2002, 2003, 2004]);
  for (const test of wanted) {
    for (let seed = 2000; seed < 4000; seed += 1) if (test(randomSystem(seed))) { seeds.add(seed); break; }
  }
  return [...seeds].sort((x, y) => x - y);
};
const SEEDS = process.env.SOAK_SEEDS ? Array.from({ length: Number(process.env.SOAK_SEEDS) }, (_, i) => 2000 + i) : chosenSeeds();
const HEALTH_MODELS_WITH_AMOUNTS = new Set(['pool', 'tracks', 'typed', 'wounds', 'locations']);

const was = process.env.SECURE_MODE;
beforeAll(() => { process.env.SECURE_MODE = 'true'; vi.spyOn(console, 'log').mockImplementation(() => {}); });
afterAll(() => { if (was === undefined) delete process.env.SECURE_MODE; else process.env.SECURE_MODE = was; vi.restoreAllMocks(); });

let nextSocket = 0;
/** The game's sockets on `db`, one connection signed in as `who`, everything it is sent kept. */
const connect = async (db, who) => {
  const sent = [];
  const handlers = {};
  let onConnect;
  socketsFactory({
    on: (e, cb) => { if (e === 'connection') onConnect = cb; },
    emit: (event, data) => sent.push({ event, data }),
    to: () => ({ emit: (event, data) => sent.push({ event, data }) }),
  }, db, { elevatedUsers: new Set(), emitUpdate: vi.fn(), recordAction: vi.fn() });
  onConnect({ id: `soak-${(nextSocket += 1)}`, on: (e, fn) => { handlers[e] = fn; }, emit: (event, data) => sent.push({ event, data }),
    broadcast: { emit: () => {} }, use: () => {}, join: () => {}, disconnect: () => {} });
  handlers.identify(who);
  await drain(db);
  sent.length = 0;
  return { handlers, sent };
};

/** One random system running as the game, with a player, their token and an NPC, ready to play. */
const playing = async (seed) => {
  const def = randomSystem(seed);
  const id = `sys_${String(seed).padStart(16, '0')}`;
  const db = await makeTestDb();
  await run(db, `CREATE TABLE IF NOT EXISTS dice_rolls (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, total INTEGER, results TEXT,
    color TEXT, historyString TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  await run(db, `CREATE TABLE IF NOT EXISTS initiative_combat (id INTEGER PRIMARY KEY AUTOINCREMENT, turn_counter INTEGER DEFAULT 1,
    pass_counter INTEGER DEFAULT 1, system TEXT DEFAULT 'generic', mode TEXT DEFAULT 'individual', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  await run(db, `CREATE TABLE IF NOT EXISTS initiative_scene (scene_key TEXT PRIMARY KEY, combat_id INTEGER NOT NULL, combatants TEXT NOT NULL DEFAULT '[]',
    sides TEXT NOT NULL DEFAULT '[]', turn_index INTEGER DEFAULT 0, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  const text = JSON.stringify(def);
  await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', [id, def.name, text, text]);
  await run(db, `INSERT INTO global_settings (key, value) VALUES ('game_system', ?)`, [id]);
  await new Promise((resolve) => runtime.refresh(db, id, resolve));
  await run(db, 'INSERT INTO character_sheets (username, system, data, is_npc) VALUES (?, ?, ?, 0)', ['vex', id, JSON.stringify({ name: 'Vex', ...def.samples })]);
  const token = (await run(db, `INSERT INTO locations (name, x, y, z, shape, owner, hp_current, hp_max, hp_temp, conditions) VALUES ('VEX', 0, 0, 0, 'rhombus', 'vex', 10, 10, 0, '[]')`)).lastID;
  await run(db, 'INSERT INTO bank_accounts (username, system, balance, debt) VALUES (?, ?, 100, 0)', ['vex', id]);
  const app = express();
  app.use(express.json());
  app.use('/api/locations', locationsRouteFactory(db, { emit: () => {} }, { emitUpdate: () => {}, recordAction: () => {} }));
  app.use('/api/sheets', sheetsRouteFactory(db, { emit: () => {} }));
  return { def, id, db, app, token };
};

it.each(SEEDS)('seed %i: played as the game, every part it has working and every part it turned off refused', async (seed) => {
  const { id, db, app, token } = await playing(seed);
  const on = (part) => runtime.partIn(id, part);
  const health = runtime.health(id);
  const hp = async () => get(db, 'SELECT hp_current, hp_max FROM locations WHERE id = ?', [token]);

  // HEALTH: damage, then heal, as its model takes them.
  const hurt = (action, extra = {}) => request(app).put(`/api/locations/${token}/health`).set(AS_GM).send({ action, amount: 2, ...extra });
  if (!on('token_health')) {
    expect((await hurt('damage')).status, `seed ${seed}`).toBe(409);
    expect(await hp(), `seed ${seed}`).toEqual({ hp_current: 10, hp_max: 10 });
  } else if (health && health.model === 'none') {
    expect((await hurt('damage')).status, `seed ${seed}`).toBe(400);
  } else {
    const model = health ? health.model : 'pool';
    const damaged = await hurt('damage');
    expect(damaged.status, `seed ${seed} ${model} ${JSON.stringify(damaged.body)}`).toBe(200);
    expect(Number.isInteger(damaged.body.hp_current), `seed ${seed}`).toBe(true);
    if (HEALTH_MODELS_WITH_AMOUNTS.has(model)) expect(damaged.body.hp_current, `seed ${seed} ${model}`).toBeLessThan(10);
    const healed = await hurt('heal', { amount: 1 });
    expect(healed.status, `seed ${seed} ${model} ${JSON.stringify(healed.body)}`).toBe(200);
  }

  // CONDITIONS: one the game offers goes on; one it doesn't is refused.
  const offered = runtime.conditionsIn(id);
  const put = (conditions) => request(app).put(`/api/locations/${token}/conditions`).set(AS_GM).send({ conditions });
  if (offered.length) {
    expect((await put([{ id: offered[0].id }])).status, `seed ${seed}`).toBe(200);
    expect(JSON.parse((await get(db, 'SELECT conditions FROM locations WHERE id = ?', [token])).conditions).map((c) => c.id), `seed ${seed}`).toEqual([offered[0].id]);
  }
  expect((await put([{ id: 'not_one_of_them' }])).status, `seed ${seed}`).toBe(400);

  // RESTS: the first the GAME tab offers, called for the players.
  const rests = (await request(app).get('/api/sheets/rests').set(AS_GM)).body;
  expect(rests.system, `seed ${seed}`).toBe(id);
  if (rests.rests.length) {
    const called = await request(app).post('/api/sheets/rest').set(AS_GM).send({ rest: rests.rests[0].id, players: true });
    expect(called.status, `seed ${seed} ${JSON.stringify(called.body)}`).toBe(200);
    expect(called.body.rest, `seed ${seed}`).toEqual(rests.rests[0]);
    expect(called.body.characters.map((c) => c.username), `seed ${seed}`).toContain('vex');
  }

  // INITIATIVE: a tracker starts where the game has it, and nothing starts where it doesn't.
  let onTracker;
  registerInitiativeHandlers({ on: (e, cb) => { if (e === 'connection') onTracker = cb; }, emit: () => {}, to: () => ({ emit: () => {} }) }, db);
  const tracker = {};
  onTracker({ id: `soak-init-${seed}`, on: (e, fn) => { tracker[e] = fn; }, emit: () => {}, use: () => {}, join: () => {} });
  tracker['initiative:start']({ sceneKey: 'city:0', system: id });
  if (on('initiative')) await untilValue(() => all(db, 'SELECT system FROM initiative_combat'), (rows) => rows.length > 0, { label: `seed ${seed} tracker` });
  await drain(db);
  expect((await all(db, 'SELECT system FROM initiative_combat')).map((r) => r.system), `seed ${seed}`).toEqual(on('initiative') ? [id] : []);

  // THE BANK: a balance told and money moved where the game has one; nothing where it doesn't.
  const vex = await connect(db, { userName: 'vex', playerToken: jwt.sign({ username: 'vex', role: 'player' }, 'test-secret') });
  vex.handlers.requestBankBalance({ username: 'vex' });
  await drain(db);
  if (on('bank')) await untilValue(() => vex.sent.find((e) => e.event === 'bankUpdate'), Boolean, { label: `seed ${seed} balance` });
  expect(vex.sent.some((e) => e.event === 'bankUpdate'), `seed ${seed}`).toBe(on('bank'));
  vex.handlers.withdrawFunds({ amount: 10 });
  await drain(db);
  const balance = () => get(db, 'SELECT balance FROM bank_accounts WHERE username = ? AND system = ?', ['vex', id]);
  if (on('bank')) await untilValue(balance, (row) => row.balance === 90, { label: `seed ${seed} withdrawal` });
  expect((await balance()).balance, `seed ${seed}`).toBe(on('bank') ? 90 : 100);

  // GIVE ITEM: the GM is told what can be given, or that the game doesn't give.
  const gm = await connect(db, { userName: 'gm', isAdmin: true, token: GM });
  gm.handlers.requestGivable();
  const givable = await untilValue(() => gm.sent.find((e) => e.event === 'givableItems'), Boolean, { label: `seed ${seed} givable` });
  expect(givable.data.ok, `seed ${seed} ${JSON.stringify(givable.data)}`).toBe(on('give_items'));
});
