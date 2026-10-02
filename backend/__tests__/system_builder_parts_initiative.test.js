import { describe, it, expect, beforeEach } from 'vitest';
import sqlite3 from 'sqlite3';
import { createRequire } from 'module';

/**
 * A custom system with initiative turned off (3b6a), on the server. A game running it starts
 * no tracker, whatever system the message names, and nothing is rolled into a combat of it.
 * A combat left from before can still be ended. Every built-in system, and a custom one that
 * kept initiative, starts and rolls as before.
 */

const require_ = createRequire(import.meta.url);
const runtime = require_('../systemBuilder/runtime');
const mod = await import('../sockets/initiative.js');
const registerInitiativeHandlers = mod.registerInitiativeHandlers || mod.default.registerInitiativeHandlers;

const NOINIT = 'sys_aaaaaaaaaaaaaaaa';
const KEPT = 'sys_bbbbbbbbbbbbbbbb';
const BUILT_INS = ['cities_without_number', 'cyberpunk_red', 'shadowrun_6e', 'generic'];

const run = (db, sql, p = []) => new Promise((res, rej) => db.run(sql, p, function (e) { e ? rej(e) : res(this); }));
const all = (db, sql, p = []) => new Promise((res, rej) => db.all(sql, p, (e, r) => (e ? rej(e) : res(r))));
/** Long enough for every callback a handler starts to have landed in an in-memory database. */
const settle = () => new Promise((r) => setTimeout(r, 40));

let db;
let handlers;
const running = async (system) => {
  db = new sqlite3.Database(':memory:');
  await run(db, `CREATE TABLE initiative_combat (id INTEGER PRIMARY KEY AUTOINCREMENT, turn_counter INTEGER DEFAULT 1,
    pass_counter INTEGER DEFAULT 1, system TEXT DEFAULT 'generic', mode TEXT DEFAULT 'individual', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  await run(db, `CREATE TABLE initiative_scene (scene_key TEXT PRIMARY KEY, combat_id INTEGER NOT NULL, combatants TEXT NOT NULL DEFAULT '[]',
    sides TEXT NOT NULL DEFAULT '[]', turn_index INTEGER DEFAULT 0, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  await run(db, `CREATE TABLE dice_rolls (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, total INTEGER, results TEXT,
    color TEXT, historyString TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  await run(db, 'CREATE TABLE global_settings (key TEXT PRIMARY KEY, value TEXT)');
  await run(db, `INSERT INTO global_settings (key, value) VALUES ('game_system', ?)`, [system]);
  await run(db, 'CREATE TABLE custom_systems (id TEXT PRIMARY KEY, name TEXT, draft TEXT, published TEXT, version INTEGER, deleted_at DATETIME)');
  const off = JSON.stringify({ format: 1, name: 'Hearth', parts: { initiative: { on: false } } });
  const kept = JSON.stringify({ format: 1, name: 'Kept' });
  await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1), (?, ?, ?, ?, 1)',
    [NOINIT, 'Hearth', off, off, KEPT, 'Kept', kept, kept]);
  await new Promise((resolve) => runtime.load(db, resolve));
  let connect;
  registerInitiativeHandlers({ on: (e, cb) => { if (e === 'connection') connect = cb; }, emit: () => {}, to: () => ({ emit: () => {} }) }, db);
  handlers = {};
  connect({ id: 'sock-1', on: (e, fn) => { handlers[e] = fn; }, emit: () => {}, use: () => {}, join: () => {} });
};

/** A combat already stored for `system`, as one started before initiative was turned off would be. */
const storedCombat = async (system) => {
  const { lastID } = await run(db, 'INSERT INTO initiative_combat (system) VALUES (?)', [system]);
  await run(db, `INSERT INTO initiative_scene (scene_key, combat_id, sides) VALUES ('city:0', ?, '[{"id":"pc","name":"PLAYERS","score":0,"isPlayerSide":true}]')`, [lastID]);
};
const combatants = async () => JSON.parse((await all(db, 'SELECT combatants FROM initiative_scene'))[0].combatants);
const roll = () => handlers['initiative:roll']({ sceneKey: 'city:0', combatant: { id: 'player:jade', name: 'JADE', score: 14 } });

beforeEach(async () => { await running('generic'); });

describe('starting a tracker', () => {
  it('starts nothing while the running game has initiative off, whatever the message names', async () => {
    await running(NOINIT);
    handlers['initiative:start']({ sceneKey: 'city:0', system: 'generic' });
    await settle();
    expect(await all(db, 'SELECT id FROM initiative_combat')).toEqual([]);
    expect(await all(db, 'SELECT scene_key FROM initiative_scene')).toEqual([]);
  });

  it('starts as before under every built-in system and a custom one that kept initiative', async () => {
    for (const system of [...BUILT_INS, KEPT]) {
      await running(system);
      handlers['initiative:start']({ sceneKey: 'city:0', system });
      await settle();
      expect((await all(db, 'SELECT system FROM initiative_combat')).map((r) => r.system), system).toEqual([system]);
    }
  });
});

describe('a combat of a system with initiative off', () => {
  it('takes no rolls, of a combatant or of the NPC side', async () => {
    await running(NOINIT);
    await storedCombat(NOINIT);
    roll();
    handlers['initiative:roll_side']({ sceneKey: 'city:0', score: 9 });
    await settle();
    expect(await combatants()).toEqual([]);
    expect(await all(db, 'SELECT id FROM dice_rolls')).toEqual([]);
  });

  it('can still be ended', async () => {
    await running(NOINIT);
    await storedCombat(NOINIT);
    handlers['initiative:end']({ sceneKey: 'city:0' });
    await settle();
    expect(await all(db, 'SELECT scene_key FROM initiative_scene')).toEqual([]);
  });

  it('is unlike a combat of a system that has it, which takes the roll', async () => {
    await storedCombat(KEPT);
    roll();
    await settle();
    expect((await combatants()).map((c) => c.id)).toEqual(['player:jade']);
  });
});
