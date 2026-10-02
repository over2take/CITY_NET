import { describe, it, expect, beforeEach } from 'vitest';
import sqlite3 from 'sqlite3';
import { createRequire } from 'module';

/**
 * The dice log's initiative lines, written by the server (3a5a). Under every built-in system,
 * and a custom system that did not rename initiative, they read exactly as today; under a
 * custom system that renamed it, they use its word. The combat records which system it runs.
 */

const require_ = createRequire(import.meta.url);
const runtime = require_('../systemBuilder/runtime');
const mod = await import('../sockets/initiative.js');
const registerInitiativeHandlers = mod.registerInitiativeHandlers || mod.default.registerInitiativeHandlers;

const RENAMED = 'sys_aaaaaaaaaaaaaaaa';
const PLAIN = 'sys_bbbbbbbbbbbbbbbb';

const run = (db, sql, p = []) => new Promise((res, rej) => db.run(sql, p, function (e) { e ? rej(e) : res(this); }));
const all = (db, sql, p = []) => new Promise((res, rej) => db.all(sql, p, (e, r) => (e ? rej(e) : res(r))));
const waitFor = async (fn, timeout = 2000) => {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeout) throw new Error('timed out');
    await new Promise((r) => setTimeout(r, 5));
  }
};

const makeDb = async () => {
  const db = new sqlite3.Database(':memory:');
  await run(db, `CREATE TABLE initiative_combat (id INTEGER PRIMARY KEY AUTOINCREMENT, turn_counter INTEGER DEFAULT 1,
    pass_counter INTEGER DEFAULT 1, system TEXT DEFAULT 'generic', mode TEXT DEFAULT 'individual', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  await run(db, `CREATE TABLE initiative_scene (scene_key TEXT PRIMARY KEY, combat_id INTEGER NOT NULL, combatants TEXT NOT NULL DEFAULT '[]',
    sides TEXT NOT NULL DEFAULT '[]', turn_index INTEGER DEFAULT 0, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  await run(db, `CREATE TABLE dice_rolls (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, total INTEGER, results TEXT,
    color TEXT, historyString TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  // Starting a tracker asks the running game whether it has initiative (3b6a).
  await run(db, `CREATE TABLE global_settings (key TEXT PRIMARY KEY, value TEXT)`);
  // Two published custom systems, loaded the way the server loads them on start.
  await run(db, `CREATE TABLE custom_systems (id TEXT PRIMARY KEY, name TEXT, draft TEXT, published TEXT, version INTEGER, deleted_at DATETIME)`);
  const renamed = JSON.stringify({ format: 1, name: 'Hearth', words: { initiative: { singular: 'order', short: 'ORD' } } });
  const plain = JSON.stringify({ format: 1, name: 'Plain' });
  await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1), (?, ?, ?, ?, 1)',
    [RENAMED, 'Hearth', renamed, renamed, PLAIN, 'Plain', plain, plain]);
  await new Promise((resolve) => runtime.load(db, resolve));
  return db;
};

const boot = (db) => {
  let connect;
  registerInitiativeHandlers({ on: (e, cb) => { if (e === 'connection') connect = cb; }, emit: () => {}, to: () => ({ emit: () => {} }) }, db);
  const handlers = {};
  connect({ id: 'sock-1', on: (e, fn) => { handlers[e] = fn; }, emit: () => {}, use: () => {}, join: () => {} });
  return handlers;
};

let db;
let handlers;
beforeEach(async () => {
  db = await makeDb();
  handlers = boot(db);
});

/** Start a combat under `system`, roll as asked, and return what the dice log says. */
const logged = async (system, mode, roll) => {
  handlers['initiative:start']({ sceneKey: 'city:0', system, mode });
  await waitFor(async () => (await all(db, 'SELECT scene_key FROM initiative_scene')).length);
  roll();
  return (await waitFor(async () => {
    const rows = await all(db, 'SELECT historyString FROM dice_rolls');
    return rows.length ? rows : null;
  }))[0].historyString;
};
const rollOne = (breakdown) => () => handlers['initiative:roll']({
  sceneKey: 'city:0', combatant: { id: 'player:jade', name: 'JADE', score: 14, ...(breakdown ? { breakdown } : {}) },
});
const rollSide = (breakdown) => () => handlers['initiative:roll_side']({ sceneKey: 'city:0', score: 9, ...(breakdown ? { breakdown } : {}) });

describe('a combatant\'s roll in the dice log', () => {
  it('reads as today under every built-in system, and a custom one that renamed nothing', async () => {
    for (const system of ['cities_without_number', 'cyberpunk_red', 'shadowrun_6e', 'generic', PLAIN]) {
      db = await makeDb();
      handlers = boot(db);
      expect(await logged(system, 'individual', rollOne()), system).toBe('JADE rolled INITIATIVE [14]');
    }
    db = await makeDb();
    handlers = boot(db);
    expect(await logged('generic', 'individual', rollOne('1d20 (14)'))).toBe('JADE INITIATIVE: 1d20 (14)');
  });

  it('uses a custom system\'s own word, in capitals like the rest of the line', async () => {
    expect(await logged(RENAMED, 'individual', rollOne())).toBe('JADE rolled ORDER [14]');
    db = await makeDb();
    handlers = boot(db);
    expect(await logged(RENAMED, 'individual', rollOne('1d20 (14)'))).toBe('JADE ORDER: 1d20 (14)');
  });
});

describe('the NPC side\'s roll in the dice log', () => {
  it('reads as today under a built-in system, and uses a custom system\'s own word', async () => {
    expect(await logged('cities_without_number', 'side', rollSide())).toBe('NPC SIDE rolled INITIATIVE [9]');
    db = await makeDb();
    handlers = boot(db);
    expect(await logged(PLAIN, 'side', rollSide('1d8 (9)'))).toBe('NPC SIDE INITIATIVE: 1d8 (9)');
    db = await makeDb();
    handlers = boot(db);
    expect(await logged(RENAMED, 'side', rollSide())).toBe('NPC SIDE rolled ORDER [9]');
    db = await makeDb();
    handlers = boot(db);
    expect(await logged(RENAMED, 'side', rollSide('1d8 (9)'))).toBe('NPC SIDE ORDER: 1d8 (9)');
  });
});
