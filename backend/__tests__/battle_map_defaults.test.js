/**
 * A battle map floor's start positions (8a9c2, folded in from the test gaps): the GM's SAVE keeps where each token stands on
 * a floor, LOAD puts them back there, a player with no token getting one. The GM's alone. Found and mended here: a save
 * with no list threw inside the handler, and a player saved in two places got two tokens.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { makeTestDb, get, run } from './helpers/testDb.js';
import { drain, until } from './helpers/until.js';

process.env.JWT_SECRET = 'test-secret';
const socketsFactory = (await import('../sockets/index.js')).default;
const GM = jwt.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, 'test-secret');

let db;
const all = (sql, args = []) => new Promise((ok, no) => db.all(sql, args, (e, rows) => (e ? no(e) : ok(rows))));

/** One connection as `who`, through the real socket handlers; what everyone was told, and the map's redraws. */
const connect = async (who, { admin = false } = {}) => {
  const told = [];
  const emitUpdate = vi.fn();
  const connections = [];
  const io = { on: (e, cb) => { if (e === 'connection') connections.push(cb); }, emit: (event, data) => told.push({ event, data }), to: () => ({ emit: () => {} }) };
  socketsFactory(io, db, { elevatedUsers: new Set(), emitUpdate, recordAction: vi.fn() });
  const handlers = {};
  const socket = { id: `sock-${who}-${Math.random()}`, on: (e, fn) => { handlers[e] = fn; }, emit: () => {},
    broadcast: { emit: () => {} }, use: () => {}, join: () => {}, disconnect: () => {} };
  connections.forEach((cb) => cb(socket));
  handlers.identify(admin ? { userName: who, isAdmin: true, token: GM } : who);
  await drain(db);
  return { handlers, told, emitUpdate };
};
const token = async (name, shape, owner = null, x = 0, z = 0) => (await run(db,
  'INSERT INTO locations (name, x, y, z, shape, owner) VALUES (?, ?, 0, ?, ?, ?)', [name, x, z, shape, owner])).lastID;
const at = async (id) => { const r = await get(db, 'SELECT x, z FROM locations WHERE id = ?', [id]); return [r.x, r.z]; };
const saved = (floor = 0) => all('SELECT rhombus_id, rhombus_owner, is_enemy, x, z FROM battle_map_defaults WHERE location_id = 9 AND floor_index = ? ORDER BY id', [floor]);

beforeEach(async () => {
  db = await makeTestDb();
  await run(db, `CREATE TABLE IF NOT EXISTS battle_map_defaults (id INTEGER PRIMARY KEY AUTOINCREMENT, location_id INTEGER NOT NULL,
    floor_index INTEGER NOT NULL, rhombus_id INTEGER, rhombus_owner TEXT, x REAL NOT NULL, z REAL NOT NULL, is_enemy INTEGER DEFAULT 0)`);
});

describe('SAVE', () => {
  it('each token where it stands: an enemy and a friendly by id, a player by name; again, that floor\'s replaced, another floor kept', async () => {
    const gm = await connect('gm', { admin: true });
    gm.handlers.save_battle_map_default({ locationId: 9, floorIndex: 1, positions: [{ id: 50, isEnemy: true, x: 9, z: 9 }] });
    gm.handlers.save_battle_map_default({ locationId: 9, floorIndex: 0, positions: [
      { id: 41, isEnemy: true, x: 1, z: 2 }, { id: 42, isFriendly: true, x: 3, z: 4 }, { userName: 'kes', x: 5, z: 6 },
    ] });
    await until(async () => (await saved()).length === 3, { label: 'saved' });
    expect(await saved()).toEqual([
      { rhombus_id: 41, rhombus_owner: null, is_enemy: 1, x: 1, z: 2 },
      { rhombus_id: 42, rhombus_owner: null, is_enemy: 2, x: 3, z: 4 },
      { rhombus_id: null, rhombus_owner: 'kes', is_enemy: 0, x: 5, z: 6 },
    ]);
    gm.handlers.save_battle_map_default({ locationId: 9, floorIndex: 0, positions: [{ userName: 'vex', x: 7, z: 8 }] });
    await until(async () => (await saved()).length === 1, { label: 'replaced' });
    expect(await saved()).toEqual([{ rhombus_id: null, rhombus_owner: 'vex', is_enemy: 0, x: 7, z: 8 }]);
    expect(await saved(1)).toEqual([{ rhombus_id: 50, rhombus_owner: null, is_enemy: 1, x: 9, z: 9 }]);
  });

  it('no list, or nothing at all: nothing kept and nothing thrown; a position without a place left out', async () => {
    const gm = await connect('gm', { admin: true });
    gm.handlers.save_battle_map_default({ locationId: 9, floorIndex: 0, positions: [{ userName: 'kes', x: 5, z: 6 }] });
    await until(async () => (await saved()).length === 1, { label: 'saved' });
    expect(() => gm.handlers.save_battle_map_default({ locationId: 9, floorIndex: 0 })).not.toThrow();
    expect(() => gm.handlers.save_battle_map_default({ locationId: 9, floorIndex: 0, positions: 'everyone' })).not.toThrow();
    expect(() => gm.handlers.save_battle_map_default()).not.toThrow();
    await drain(db);
    // What was kept stays: a broken save wipes nothing.
    expect(await saved()).toHaveLength(1);
    gm.handlers.save_battle_map_default({ locationId: 9, floorIndex: 0, positions: [{ userName: 'kes', x: 'left' }, null, { userName: 'vex', x: 1, z: 1 }] });
    await until(async () => (await saved())[0]?.rhombus_owner === 'vex', { label: 'resaved' });
    expect(await saved()).toEqual([{ rhombus_id: null, rhombus_owner: 'vex', is_enemy: 0, x: 1, z: 1 }]);
  });

  it('a player: nothing kept', async () => {
    const kes = await connect('kes');
    kes.handlers.save_battle_map_default({ locationId: 9, floorIndex: 0, positions: [{ userName: 'kes', x: 5, z: 6 }] });
    await drain(db);
    expect(await saved()).toEqual([]);
  });
});

describe('LOAD', () => {
  it('everyone back where they started, a player with no token given one there; everyone told once every move is written', async () => {
    const ganger = await token('GANGER', 'enemy_rhombus', null, 0, 0);
    const medic = await token('MEDIC', 'friendly_rhombus', null, 0, 0);
    const kes = await token('kes', 'rhombus', 'kes', 0, 0);
    const gm = await connect('gm', { admin: true });
    gm.handlers.save_battle_map_default({ locationId: 9, floorIndex: 0, positions: [
      { id: ganger, isEnemy: true, x: 1, z: 2 }, { id: medic, isFriendly: true, x: 3, z: 4 }, { userName: 'kes', x: 5, z: 6 }, { userName: 'vex', x: 7, z: 8 },
    ] });
    await until(async () => (await saved()).length === 4, { label: 'saved' });
    // The moves read the moment everyone is told.
    let seen = null;
    gm.handlers.load_battle_map_default({ locationId: 9, floorIndex: 0 });
    await until(async () => {
      if (!gm.told.some((t) => t.event === 'default_loaded')) return false;
      seen = seen || { ganger: await at(ganger), medic: await at(medic), kes: await at(kes), vex: await get(db, "SELECT x, z, y, shape, name FROM locations WHERE owner = 'vex'") };
      return true;
    }, { label: 'told' });
    expect(seen).toEqual({ ganger: [1, 2], medic: [3, 4], kes: [5, 6], vex: { x: 7, z: 8, y: 0.1, shape: 'rhombus', name: 'vex' } });
    expect(gm.told.find((t) => t.event === 'default_loaded').data).toEqual({ locationId: 9, floorIndex: 0, updates: [
      { id: ganger, x: 1, z: 2, isEnemy: true, isFriendly: false },
      { id: medic, x: 3, z: 4, isEnemy: false, isFriendly: true },
      { userName: 'kes', x: 5, z: 6, isEnemy: false, isFriendly: false },
      { userName: 'vex', x: 7, z: 8, isEnemy: false, isFriendly: false },
    ] });
    expect(gm.emitUpdate).toHaveBeenCalledWith({ isRhombusOnly: true });
    // Loaded again: Vex's token moved, not a second one made.
    gm.told.length = 0;
    gm.handlers.load_battle_map_default({ locationId: 9, floorIndex: 0 });
    await until(async () => gm.told.some((t) => t.event === 'default_loaded'), { label: 'told again' });
    expect(await all("SELECT id FROM locations WHERE owner = 'vex'")).toHaveLength(1);
  });

  it('a player with two places saved: one token made, not two', async () => {
    const gm = await connect('gm', { admin: true });
    await run(db, "INSERT INTO battle_map_defaults (location_id, floor_index, rhombus_owner, is_enemy, x, z) VALUES (9, 0, 'vex', 0, 1, 1), (9, 0, 'vex', 0, 2, 2)");
    gm.handlers.load_battle_map_default({ locationId: 9, floorIndex: 0 });
    await until(async () => gm.told.some((t) => t.event === 'default_loaded'), { label: 'told' });
    expect(await all("SELECT id FROM locations WHERE owner = 'vex'")).toHaveLength(1);
  });

  it('nothing saved for that floor: told so, nothing moved; a player: nothing at all', async () => {
    const ganger = await token('GANGER', 'enemy_rhombus', null, 4, 4);
    const gm = await connect('gm', { admin: true });
    gm.handlers.load_battle_map_default({ locationId: 9, floorIndex: 3 });
    await until(async () => gm.told.some((t) => t.event === 'default_loaded'), { label: 'told' });
    expect(gm.told.find((t) => t.event === 'default_loaded').data.updates).toEqual([]);
    await run(db, 'INSERT INTO battle_map_defaults (location_id, floor_index, rhombus_id, is_enemy, x, z) VALUES (9, 0, ?, 1, 1, 1)', [ganger]);
    const kes = await connect('kes');
    kes.handlers.load_battle_map_default({ locationId: 9, floorIndex: 0 });
    expect(() => gm.handlers.load_battle_map_default()).not.toThrow();
    await drain(db);
    expect(kes.told.some((t) => t.event === 'default_loaded')).toBe(false);
    expect(await at(ganger)).toEqual([4, 4]);
  });
});
