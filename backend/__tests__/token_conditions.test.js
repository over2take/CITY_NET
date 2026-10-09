/**
 * Conditions on tokens, on the server (4e2a1). Approved mockup builder-conditions (2026-10-09):
 * every system's tokens carry conditions, built-in games the standard set and a custom system its
 * own; whoever may change a token's health puts them on and takes them off; everyone sees which,
 * and only the GM how many rounds each has left; each game keeps its own, as with health.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createRequire } from 'module';
import { makeTestDb, get, run } from './helpers/testDb.js';
import locationsRouteFactory from '../routes/locations.js';

process.env.JWT_SECRET = 'test-secret';
const require_ = createRequire(import.meta.url);
const { parseTokenConditions, checkTokenConditions, publicTokenConditions, LIMITS } = require_('../tokens/conditions');
const { conditionsOf, STANDARD } = require_('../systemBuilder/conditions');
const runtime = require_('../systemBuilder/runtime');
const { switchSystem, FIELDS } = require_('../tokens/vitals');
const { elevatedUsers } = require_('../middleware/auth');
const systemsRoute = require_('../routes/systems.js');

const sign = (payload) => jwt.sign(payload, 'test-secret');
const GM = sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false });
const EDITOR = sign({ username: 'ghost', isTemporary: true });
const VEX = sign({ username: 'vex', role: 'player' });
const ASH = sign({ username: 'ash', role: 'player' });

const HEARTH = 'sys_aaaaaaaaaaaaaaaa';
const HEARTH_DEF = {
  format: 1, name: 'Hearth',
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'str', label: 'Strength' }] }],
  conditions: {
    blinded: { on: false },
    poisoned: { ends: 'rounds', rounds: 3, modifiers: [{ target: 'all_rolls', amount: -1 }] },
    glitching: { name: 'Glitching', icon: 'signal', modifiers: [{ target: 'str', amount: -2 }] },
  },
};
const OFFERED = conditionsOf(HEARTH_DEF);

describe('a token\'s stored conditions', () => {
  it('read whatever the column holds as a list of { id, left }, never a throw', () => {
    expect(parseTokenConditions('[{"id":"prone"},{"id":"poisoned","left":2}]')).toEqual([{ id: 'prone' }, { id: 'poisoned', left: 2 }]);
    for (const junk of ['', 'nope', '{}', null, undefined, '42', '[1,"x",null,{"left":2}]']) expect(parseTokenConditions(junk), String(junk)).toEqual([]);
    expect(parseTokenConditions('[{"id":"prone","left":0},{"id":"stunned","left":1.5},{"id":"x","extra":1}]')).toEqual([{ id: 'prone' }, { id: 'stunned' }, { id: 'x' }]);
  });

  it('show everyone which conditions, never the rounds left', () => {
    expect(publicTokenConditions('[{"id":"prone"},{"id":"poisoned","left":2}]')).toBe('[{"id":"prone"},{"id":"poisoned"}]');
    expect(publicTokenConditions('broken')).toBe('[]');
  });
});

describe('checking a token\'s conditions against what the game offers', () => {
  it('takes the system\'s own, starting one that ends after rounds at its own rounds', () => {
    expect(checkTokenConditions([{ id: 'prone' }, { id: 'poisoned' }, { id: 'glitching' }], OFFERED))
      .toEqual({ ok: true, value: [{ id: 'prone' }, { id: 'poisoned', left: 3 }, { id: 'glitching' }] });
  });

  it('takes rounds set when it is put on, on any condition, and drops nothing else sent', () => {
    expect(checkTokenConditions([{ id: 'poisoned', left: 1 }, { id: 'prone', left: 4, note: 'x' }], OFFERED))
      .toEqual({ ok: true, value: [{ id: 'poisoned', left: 1 }, { id: 'prone', left: 4 }] });
    expect(checkTokenConditions([{ id: 'prone', left: null }], OFFERED)).toEqual({ ok: true, value: [{ id: 'prone' }] });
    expect(checkTokenConditions([], OFFERED)).toEqual({ ok: true, value: [] });
  });

  it('refuses one the game doesn\'t have, turned off or never there, by name', () => {
    expect(checkTokenConditions([{ id: 'blinded' }], OFFERED)).toEqual({ ok: false, error: '"blinded" is not a condition this game has' });
    expect(checkTokenConditions([{ id: 'hungry' }], OFFERED)).toEqual({ ok: false, error: '"hungry" is not a condition this game has' });
    expect(checkTokenConditions(['prone'], OFFERED)).toEqual({ ok: false, error: 'That is not a condition this game has' });
  });

  it('refuses a list that isn\'t one, one twice, rounds out of range, or more than sixty', () => {
    expect(checkTokenConditions('prone', OFFERED)).toEqual({ ok: false, error: 'Conditions must be a list' });
    expect(checkTokenConditions([{ id: 'prone' }, { id: 'prone' }], OFFERED)).toEqual({ ok: false, error: 'Prone is on the list twice' });
    for (const left of [0, 100, 2.5, '2']) {
      expect(checkTokenConditions([{ id: 'poisoned', left }], OFFERED), String(left)).toEqual({ ok: false, error: 'Rounds left on Poisoned must be a whole number from 1 to 99' });
    }
    expect(checkTokenConditions(Array.from({ length: LIMITS.conditions + 1 }, () => ({ id: 'prone' })), OFFERED))
      .toEqual({ ok: false, error: 'At most 60 conditions on a token' });
  });
});

describe('the routes', () => {
  let db;
  let app;
  let ids;
  let updates;
  const was = process.env.SECURE_MODE;

  beforeEach(async () => {
    process.env.SECURE_MODE = 'true';
    elevatedUsers.add('ghost');
    db = await makeTestDb();
    const text = JSON.stringify(HEARTH_DEF);
    await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', [HEARTH, 'Hearth', text, text]);
    await new Promise((resolve) => runtime.load(db, resolve));
    await run(db, `INSERT INTO global_settings (key, value) VALUES ('game_system', ?)`, [HEARTH]);
    updates = 0;
    app = express();
    app.use(express.json());
    app.use('/api/locations', locationsRouteFactory(db, { emit: () => {} }, { emitUpdate: () => { updates += 1; }, recordAction: () => {} }));
    app.use('/api/systems', systemsRoute(db));
    const add = async (name, shape, owner, controllers = null) => (await run(db,
      'INSERT INTO locations (name, x, y, z, shape, owner, controllers) VALUES (?, 0, 0, 0, ?, ?, ?)', [name, shape, owner, controllers])).lastID;
    ids = {
      vex: await add('VEX', 'rhombus', 'vex'),
      vexOnMap: await add('VEX', 'rhombus', 'vex'),
      ash: await add('ASH', 'rhombus', 'ash'),
      enemy: await add('GANGER', 'enemy_rhombus', 'gm'),
      dog: await add('DOG', 'friendly_rhombus', 'gm', JSON.stringify({ all: false, users: ['vex'] })),
    };
  });
  afterEach(() => {
    if (was === undefined) delete process.env.SECURE_MODE; else process.env.SECURE_MODE = was;
    elevatedUsers.delete('ghost');
  });

  const put = (id, conditions, token) => request(app).put(`/api/locations/${id}/conditions`)
    .set(token ? { Authorization: `Bearer ${token}` } : {}).send({ conditions });
  const storedOn = async (id) => JSON.parse((await get(db, 'SELECT conditions FROM locations WHERE id = ?', [id])).conditions);

  it('puts conditions on a token and takes them off, as the running game offers them, telling every screen', async () => {
    const res = await put(ids.enemy, [{ id: 'poisoned' }, { id: 'glitching' }], GM);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: ids.enemy, conditions: [{ id: 'poisoned', left: 3 }, { id: 'glitching' }] });
    expect(await storedOn(ids.enemy)).toEqual([{ id: 'poisoned', left: 3 }, { id: 'glitching' }]);
    expect(updates).toBe(1);
    expect((await put(ids.enemy, [], GM)).status).toBe(200);
    expect(await storedOn(ids.enemy)).toEqual([]);
  });

  it('refuses one the running game doesn\'t have, changing nothing', async () => {
    const res = await put(ids.enemy, [{ id: 'blinded' }], GM);
    expect(res).toMatchObject({ status: 400, body: { error: '"blinded" is not a condition this game has' } });
    expect(await storedOn(ids.enemy)).toEqual([]);
    expect(updates).toBe(0);
  });

  it('is for whoever may change the token\'s health: the GM and editors any, a player their own and a friendly NPC given to them', async () => {
    expect((await put(ids.vex, [{ id: 'prone' }], VEX)).status).toBe(200);
    expect((await put(ids.ash, [{ id: 'prone' }], VEX)).status).toBe(403);
    expect((await put(ids.enemy, [{ id: 'prone' }], VEX)).status).toBe(403);
    expect((await put(ids.dog, [{ id: 'prone' }], VEX)).status).toBe(200);
    expect((await put(ids.dog, [{ id: 'prone' }], ASH)).status).toBe(403);
    expect((await put(ids.ash, [{ id: 'prone' }], EDITOR)).status).toBe(200);
    expect((await put(ids.ash, [{ id: 'prone' }])).status).toBe(401);
    expect((await put(9999, [], GM)).status).toBe(404);
  });

  it('follows a player onto every token of theirs, as their health does', async () => {
    await put(ids.vex, [{ id: 'prone' }], VEX);
    expect(await storedOn(ids.vexOnMap)).toEqual([{ id: 'prone' }]);
    expect(await storedOn(ids.ash)).toEqual([]);
  });

  it('shows everyone which conditions a token has, and only the GM and editors the rounds left', async () => {
    await put(ids.enemy, [{ id: 'poisoned' }, { id: 'prone' }], GM);
    const listed = async (token) => {
      const res = await request(app).get('/api/locations').set(token ? { Authorization: `Bearer ${token}` } : {});
      return JSON.parse(res.body.find((l) => l.id === ids.enemy).conditions);
    };
    expect(await listed(GM)).toEqual([{ id: 'poisoned', left: 3 }, { id: 'prone' }]);
    expect(await listed(EDITOR)).toEqual([{ id: 'poisoned', left: 3 }, { id: 'prone' }]);
    expect(await listed(VEX)).toEqual([{ id: 'poisoned' }, { id: 'prone' }]);
    expect(await listed(null)).toEqual([{ id: 'poisoned' }, { id: 'prone' }]);
  });

  it('offers the standard set under a built-in game, with no modifiers, so its rules don\'t change', async () => {
    await run(db, `UPDATE global_settings SET value = 'cities_without_number' WHERE key = 'game_system'`);
    expect((await put(ids.enemy, [{ id: 'blinded' }], GM)).status).toBe(200);
    expect((await put(ids.enemy, [{ id: 'glitching' }], GM)).status).toBe(400);
    expect(runtime.conditionsIn('cities_without_number')).toEqual(conditionsOf(null));
    expect(runtime.conditionsIn('cities_without_number').map((c) => c.id)).toEqual(STANDARD.map((c) => c.id));
    expect(runtime.conditionsIn('cities_without_number').every((c) => c.modifiers.length === 0)).toBe(true);
  });

  it('lists a game\'s conditions for everyone, their modifiers only for the GM and editors', async () => {
    const list = async (token) => (await request(app).get(`/api/systems/conditions/${HEARTH}`).set(token ? { Authorization: `Bearer ${token}` } : {})).body;
    expect(await list(GM)).toEqual(OFFERED);
    expect(await list(EDITOR)).toEqual(OFFERED);
    const players = await list(VEX);
    expect(players.map((c) => c.id)).toEqual(OFFERED.map((c) => c.id));
    expect(players.every((c) => c.modifiers.length === 0)).toBe(true);
    expect(players.find((c) => c.id === 'glitching')).toMatchObject({ name: 'Glitching', icon: 'signal' });
    expect((await list(null)).find((c) => c.id === 'poisoned').modifiers).toEqual([]);
    expect((await request(app).get('/api/systems/conditions/generic')).body).toEqual(conditionsOf(null));
  });

  it('keeps each game\'s own, swapped with the token\'s health when the game changes', async () => {
    expect(FIELDS).toContain('conditions');
    await put(ids.enemy, [{ id: 'glitching' }], GM);
    await switchSystem(db, 'cities_without_number');
    expect(await storedOn(ids.enemy)).toEqual([]);
    await put(ids.enemy, [{ id: 'prone' }], GM);
    await switchSystem(db, HEARTH);
    expect(await storedOn(ids.enemy)).toEqual([{ id: 'glitching' }]);
    await switchSystem(db, 'cities_without_number');
    expect(await storedOn(ids.enemy)).toEqual([{ id: 'prone' }]);
  });
});
