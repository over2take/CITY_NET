/**
 * Conditions counting down, and who sees how long they have left (4e2a2). Approved mockup
 * builder-conditions (2026-10-09): a condition that ends after rounds loses one each new round of a
 * combat its token is in, and comes off at none; the GM, the token's owner and a player given a
 * friendly NPC see the rounds left and the modifiers; everyone else sees which conditions.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { createRequire } from 'module';
import { makeTestDb, get, run } from './helpers/testDb.js';
import { drain, untilValue } from './helpers/until.js';

process.env.JWT_SECRET = 'test-secret';
const require_ = createRequire(import.meta.url);
const { tickRound, combatTokens, tickCombat } = require_('../tokens/conditions');
const runtime = require_('../systemBuilder/runtime');
const socketsFactory = (await import('../sockets/index.js')).default;
const GM = jwt.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, 'test-secret');

describe('a round on', () => {
  it('takes one from every condition with rounds left, and takes off those at none', () => {
    expect(tickRound([{ id: 'prone' }, { id: 'poisoned', left: 3 }, { id: 'stunned', left: 1 }])).toEqual({
      list: [{ id: 'prone' }, { id: 'poisoned', left: 2 }], ended: ['stunned'], changed: true,
    });
  });

  it('changes nothing where nothing has rounds', () => {
    expect(tickRound([{ id: 'prone' }])).toEqual({ list: [{ id: 'prone' }], ended: [], changed: false });
    expect(tickRound([])).toEqual({ list: [], ended: [], changed: false });
  });
});

describe('a combat\'s tokens', () => {
  it('are its NPCs by token id and its players by name, each once', () => {
    expect(combatTokens([
      { id: 'npc:12' }, { id: 'player:vex' }, { id: 'npc:12' }, { id: 'player:vex' }, { id: 'npc:x' }, { id: 'c:A' }, { id: 7 }, null,
    ])).toEqual({ npcs: [12], players: ['vex'] });
    expect(combatTokens(undefined)).toEqual({ npcs: [], players: [] });
  });
});

let db;
const conditionsOf = async (id) => JSON.parse((await get(db, 'SELECT conditions FROM locations WHERE id = ?', [id])).conditions);
const token = async (name, shape, owner, conditions, controllers = null) => (await run(db,
  'INSERT INTO locations (name, x, y, z, shape, owner, conditions, controllers) VALUES (?, 0, 0, 0, ?, ?, ?, ?)',
  [name, shape, owner, JSON.stringify(conditions), controllers])).lastID;

describe('counting a combat down', () => {
  let ids;
  beforeEach(async () => {
    db = await makeTestDb();
    ids = {
      ganger: await token('GANGER', 'enemy_rhombus', 'gm', [{ id: 'poisoned', left: 2 }, { id: 'prone' }]),
      bystander: await token('BYSTANDER', 'enemy_rhombus', 'gm', [{ id: 'poisoned', left: 2 }]),
      vex: await token('VEX', 'rhombus', 'vex', [{ id: 'stunned', left: 1 }]),
      vexElsewhere: await token('VEX', 'rhombus', 'vex', [{ id: 'stunned', left: 1 }]),
      box: await token('CRATE', 'box', null, [{ id: 'poisoned', left: 2 }]),
    };
  });
  const tick = (combatants) => new Promise((resolve, reject) => tickCombat(db, combatants, (err, r) => (err ? reject(err) : resolve(r))));

  it('counts down the combat\'s tokens only, a player\'s on every token of theirs, once each', async () => {
    const r = await tick([{ id: `npc:${ids.ganger}` }, { id: 'player:vex' }, { id: `npc:${ids.ganger}` }]);
    expect(r).toEqual({ tokens: 3 });
    expect(await conditionsOf(ids.ganger)).toEqual([{ id: 'poisoned', left: 1 }, { id: 'prone' }]);
    expect(await conditionsOf(ids.vex)).toEqual([]);
    expect(await conditionsOf(ids.vexElsewhere)).toEqual([]);
    expect(await conditionsOf(ids.bystander)).toEqual([{ id: 'poisoned', left: 2 }]);
  });

  it('touches nothing that isn\'t an NPC token, and writes nothing when nothing counts down', async () => {
    expect(await tick([{ id: `npc:${ids.box}` }, { id: `npc:${ids.vex}` }])).toEqual({ tokens: 0 });
    expect(await conditionsOf(ids.box)).toEqual([{ id: 'poisoned', left: 2 }]);
    await run(db, `UPDATE locations SET conditions = '[{"id":"prone"}]' WHERE id = ?`, [ids.ganger]);
    expect(await tick([{ id: `npc:${ids.ganger}` }, { id: 'player:nobody' }, { id: 'npc:9999' }])).toEqual({ tokens: 0 });
  });

  it('takes a condition off after as many rounds as it was given', async () => {
    const combat = [{ id: `npc:${ids.ganger}` }];
    await tick(combat);
    await tick(combat);
    expect(await conditionsOf(ids.ganger)).toEqual([{ id: 'prone' }]);
  });
});

/** The tracker's tables, as db.js makes them. */
const initiativeTables = async () => {
  await run(db, `CREATE TABLE IF NOT EXISTS initiative_combat (id INTEGER PRIMARY KEY AUTOINCREMENT, turn_counter INTEGER DEFAULT 1,
    pass_counter INTEGER DEFAULT 1, system TEXT DEFAULT 'generic', mode TEXT DEFAULT 'individual', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  await run(db, `CREATE TABLE IF NOT EXISTS initiative_scene (scene_key TEXT PRIMARY KEY, combat_id INTEGER NOT NULL, combatants TEXT NOT NULL DEFAULT '[]',
    sides TEXT NOT NULL DEFAULT '[]', turn_index INTEGER DEFAULT 0, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  await run(db, `CREATE TABLE IF NOT EXISTS dice_rolls (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, total INTEGER, results TEXT, color TEXT, historyString TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)`);
};

/** One connection as `who`, through the real socket handlers, with what it was sent. */
const connect = async (who, { admin = false } = {}) => {
  const emitted = [];
  const emitUpdate = vi.fn();
  // The sockets module and the initiative tracker each listen for connections: both are called.
  const connections = [];
  const io = { on: (e, cb) => { if (e === 'connection') connections.push(cb); }, emit: () => {}, to: () => ({ emit: () => {} }) };
  socketsFactory(io, db, { elevatedUsers: new Set(), emitUpdate, recordAction: vi.fn() });
  const handlers = {};
  const socket = { id: `sock-${who}-${Math.random()}`, on: (e, fn) => { handlers[e] = fn; }, emit: (e, d) => emitted.push({ event: e, data: d }),
    broadcast: { emit: () => {} }, use: () => {}, join: () => {}, disconnect: () => {} };
  connections.forEach((cb) => cb(socket));
  handlers.identify(admin ? { userName: who, isAdmin: true, token: GM } : who);
  await drain(db);
  return { handlers, emitted, emitUpdate };
};

describe('the initiative tracker\'s new rounds', () => {
  let ganger;
  beforeEach(async () => {
    db = await makeTestDb();
    await initiativeTables();
    ganger = await token('GANGER', 'enemy_rhombus', 'gm', [{ id: 'poisoned', left: 2 }]);
  });
  const scene = async ({ system = 'generic', mode = 'individual', combatants, sides = [], turnIndex }) => {
    const combat = (await run(db, 'INSERT INTO initiative_combat (system, mode) VALUES (?, ?)', [system, mode])).lastID;
    await run(db, 'INSERT INTO initiative_scene (scene_key, combat_id, combatants, sides, turn_index) VALUES (?, ?, ?, ?, ?)',
      ['main', combat, JSON.stringify(combatants), JSON.stringify(sides), turnIndex]);
  };
  const leftOn = async () => (await conditionsOf(ganger))[0]?.left;

  it('counts down when the turn order wraps, not on every turn, and redraws the map', async () => {
    await scene({ combatants: [{ id: `npc:${ganger}`, score: 12 }, { id: 'player:vex', score: 8 }], turnIndex: 0 });
    const gm = await connect('gm', { admin: true });
    gm.handlers['initiative:next']({ sceneKey: 'main' });
    await drain(db);
    expect(await leftOn()).toBe(2);
    gm.handlers['initiative:next']({ sceneKey: 'main' });
    await untilValue(leftOn, (v) => v === 1, { label: 'a round counted down' });
    await untilValue(() => gm.emitUpdate.mock.calls.length, (n) => n > 0, { label: 'the map redrawn' });
  });

  it('counts down when the sides wrap, in side mode', async () => {
    await scene({ mode: 'side', combatants: [{ id: `npc:${ganger}`, sideId: 'npc' }], sides: [{ id: 'pc', score: 9 }, { id: 'npc', score: 4 }], turnIndex: 1 });
    const gm = await connect('gm', { admin: true });
    gm.handlers['initiative:next']({ sceneKey: 'main' });
    await untilValue(leftOn, (v) => v === 1, { label: 'a round counted down' });
  });

  it('counts down in Shadowrun only when every pass is spent, not at the end of a pass', async () => {
    await scene({ system: 'shadowrun_6e', combatants: [{ id: `npc:${ganger}`, score: 15 }], turnIndex: 0 });
    const gm = await connect('gm', { admin: true });
    gm.handlers['initiative:next']({ sceneKey: 'main' });
    await drain(db);
    // 15 - 10 leaves a pass to go: the same round.
    expect(await leftOn()).toBe(2);
    gm.handlers['initiative:next']({ sceneKey: 'main' });
    await untilValue(leftOn, (v) => v === 1, { label: 'the round counted down' });
  });
});

describe('a token\'s conditions, asked for over the socket', () => {
  const HEARTH = 'sys_aaaaaaaaaaaaaaaa';
  let ids;
  beforeEach(async () => {
    db = await makeTestDb();
    const def = JSON.stringify({ format: 1, name: 'Hearth', conditions: { poisoned: { ends: 'rounds', rounds: 3, modifiers: [{ target: 'all_rolls', amount: -1 }] } } });
    await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', [HEARTH, 'Hearth', def, def]);
    await new Promise((resolve) => runtime.load(db, resolve));
    await run(db, `INSERT INTO global_settings (key, value) VALUES ('game_system', ?)`, [HEARTH]);
    const list = [{ id: 'poisoned', left: 2 }, { id: 'prone' }];
    ids = {
      vex: await token('VEX', 'rhombus', 'vex', list),
      dog: await token('DOG', 'friendly_rhombus', 'gm', list, JSON.stringify({ all: false, users: ['vex'] })),
      ganger: await token('GANGER', 'enemy_rhombus', 'gm', list),
    };
  });
  const ask = async (c, id) => {
    c.handlers.requestTokenConditions({ location_id: id });
    return (await untilValue(() => c.emitted.find((e) => e.event === 'tokenConditions' && e.data.location_id === id), Boolean, { label: 'the reply' })).data;
  };
  const WHOLE = [{ id: 'poisoned', left: 2, modifiers: [{ target: 'all_rolls', amount: -1 }] }, { id: 'prone', modifiers: [] }];

  it('gives the GM, the owner and a player given a friendly NPC the rounds left and the modifiers', async () => {
    const gm = await connect('gm', { admin: true });
    expect(await ask(gm, ids.ganger)).toEqual({ location_id: ids.ganger, full: true, conditions: WHOLE });
    const vex = await connect('vex');
    expect(await ask(vex, ids.vex)).toEqual({ location_id: ids.vex, full: true, conditions: WHOLE });
    expect(await ask(vex, ids.dog)).toEqual({ location_id: ids.dog, full: true, conditions: WHOLE });
  });

  it('gives anyone else which conditions only', async () => {
    const ash = await connect('ash');
    expect(await ask(ash, ids.vex)).toEqual({ location_id: ids.vex, full: false, conditions: [{ id: 'poisoned' }, { id: 'prone' }] });
    const vex = await connect('vex');
    expect(await ask(vex, ids.ganger)).toEqual({ location_id: ids.ganger, full: false, conditions: [{ id: 'poisoned' }, { id: 'prone' }] });
  });

  it('answers nothing for what isn\'t a token, or someone who never said who they are', async () => {
    const box = (await run(db, `INSERT INTO locations (name, x, y, z, shape) VALUES ('CRATE', 0, 0, 0, 'box')`)).lastID;
    const gm = await connect('gm', { admin: true });
    gm.handlers.requestTokenConditions({ location_id: box });
    gm.handlers.requestTokenConditions({ location_id: 'x' });
    gm.handlers.requestTokenConditions(null);
    await drain(db);
    expect(gm.emitted.filter((e) => e.event === 'tokenConditions')).toEqual([]);
  });
});
