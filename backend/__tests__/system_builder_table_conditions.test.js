/**
 * A built-in game's own conditions (4e2c1). Approved mockup builder-conditions (2026-10-09), stage 3:
 * the table adds conditions of its own to a built-in game from the GAME tab, beside the standard
 * set, with a name, icon and description only, so the game's rules don't change. Main admin only;
 * a custom system's conditions stay in the builder.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createRequire } from 'module';
import { makeTestDb, run, get } from './helpers/testDb.js';
import locationsRouteFactory from '../routes/locations.js';

process.env.JWT_SECRET = 'test-secret';
const require_ = createRequire(import.meta.url);
const { checkTableConditions, tableConditionsOf, loadTableConditions } = require_('../systemBuilder/tableConditions');
const { STANDARD } = require_('../systemBuilder/conditions');
const runtime = require_('../systemBuilder/runtime');
const { elevatedUsers } = require_('../middleware/auth');
const systemsRoute = require_('../routes/systems.js');

const GM = jwt.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, 'test-secret');
const EDITOR = jwt.sign({ username: 'ghost', isTemporary: true }, 'test-secret');
const PLAYER = jwt.sign({ username: 'vex', role: 'player' }, 'test-secret');
const HASH = 'a'.repeat(64);
const WIRED = { wired: { name: 'Wired', icon: 'bolt', description: 'Jacked in; the body is slow to answer.' } };

describe('the checks', () => {
  const messages = (entries) => checkTableConditions(entries).map((p) => `${p.where}: ${p.message}`);

  it('take a table\'s own conditions with a name, label, icon (drawn or uploaded) and description', () => {
    expect(messages({ ...WIRED, fragged: { name: 'Fragged', short: 'FRAG', icon: `/uploads/condition_icons/${HASH}.png` } })).toEqual([]);
    expect(messages({})).toEqual([]);
  });

  it('refuse what isn\'t a set, a standard condition\'s id, and modifiers or rounds that would change the rules', () => {
    expect(messages([])).toEqual(['conditions: Must be a set of conditions']);
    expect(messages({ prone: { name: 'Down' } })).toEqual(['condition prone: A standard condition is already there']);
    expect(messages({ wired: { name: 'Wired', modifiers: [{ target: 'all_rolls', amount: -1 }], ends: 'rounds', rounds: 2 } })).toEqual([
      'condition wired, modifiers: A built-in game\'s conditions have a name, label, icon and description only',
      'condition wired, ends: A built-in game\'s conditions have a name, label, icon and description only',
      'condition wired, rounds: A built-in game\'s conditions have a name, label, icon and description only',
    ]);
  });

  it('hold them to the condition checks: a name, a real icon, sixty in all', () => {
    expect(messages({ wired: { icon: 'bolt' } })).toEqual(['condition wired, name: Required']);
    expect(messages({ wired: { name: 'Wired', icon: 'eye' } })).toEqual(['condition wired, icon: Must be one of the drawn icons or an uploaded one']);
    const many = (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`c${i}`, { name: `C${i}` }]));
    expect(messages(many(60 - STANDARD.length))).toEqual([]);
    expect(messages(many(61 - STANDARD.length))).toEqual(['conditions: At most 60 conditions, the 10 standard ones included']);
  });
});

describe('the route', () => {
  let db;
  let app;
  let emitted;
  beforeEach(async () => {
    elevatedUsers.add('ghost');
    db = await makeTestDb();
    await new Promise((resolve) => runtime.load(db, resolve));
    await run(db, `INSERT INTO global_settings (key, value) VALUES ('game_system', 'cities_without_number')`);
    emitted = [];
    app = express();
    app.use(express.json());
    const io = { emit: (event, data) => emitted.push({ event, data }) };
    app.use('/api/systems', systemsRoute(db, io));
    app.use('/api/locations', locationsRouteFactory(db, io, { emitUpdate: () => {}, recordAction: () => {} }));
  });
  afterEach(() => elevatedUsers.delete('ghost'));
  const put = (system, conditions, token = GM) => request(app).put(`/api/systems/table-conditions/${system}`).set(token ? { Authorization: `Bearer ${token}` } : {}).send({ conditions });

  it('adds a built-in game\'s own after the standard ones, tells every screen, and answers the game\'s list', async () => {
    const res = await put('cities_without_number', WIRED);
    expect(res.status).toBe(200);
    expect(res.body.conditions.map((c) => c.id)).toEqual([...STANDARD.map((c) => c.id), 'wired']);
    expect(res.body.conditions.at(-1)).toMatchObject({ name: 'Wired', short: 'WIRED', icon: 'bolt', standard: false, modifiers: [] });
    expect(emitted).toEqual([{ event: 'conditionsChanged', data: { system: 'cities_without_number' } }]);
    expect((await request(app).get('/api/systems/conditions/cities_without_number')).body.map((c) => c.id)).toContain('wired');
  });

  it('keeps each built-in game\'s own apart', async () => {
    await put('cities_without_number', WIRED);
    expect(runtime.conditionsIn('shadowrun_6e').map((c) => c.id)).toEqual(STANDARD.map((c) => c.id));
  });

  it('lets a token take one, and refuses it once taken away', async () => {
    const enemy = (await run(db, `INSERT INTO locations (name, x, y, z, shape, owner) VALUES ('GANGER', 0, 0, 0, 'enemy_rhombus', 'gm')`)).lastID;
    const onToken = (list) => request(app).put(`/api/locations/${enemy}/conditions`).set({ Authorization: `Bearer ${GM}` }).send({ conditions: list });
    expect((await onToken([{ id: 'wired' }])).status).toBe(400);
    await put('cities_without_number', WIRED);
    expect((await onToken([{ id: 'wired' }, { id: 'prone' }])).status).toBe(200);
    await put('cities_without_number', {});
    expect((await onToken([{ id: 'wired' }])).status).toBe(400);
  });

  it('is kept across a restart', async () => {
    await put('cyberpunk_red', WIRED);
    expect(JSON.parse((await get(db, `SELECT value FROM global_settings WHERE key = 'table_conditions:cyberpunk_red'`)).value)).toEqual(WIRED);
    await run(db, `UPDATE global_settings SET value = '{"fragged":{"name":"Fragged"}}' WHERE key = 'table_conditions:cyberpunk_red'`);
    await new Promise((resolve) => loadTableConditions(db, resolve));
    expect(tableConditionsOf('cyberpunk_red')).toEqual({ fragged: { name: 'Fragged' } });
  });

  it('refuses a custom system, and what the checks find, changing nothing', async () => {
    expect(await put('sys_aaaaaaaaaaaaaaaa', WIRED)).toMatchObject({ status: 400, body: { error: 'A custom system\'s conditions are edited in the builder' } });
    const bad = await put('cities_without_number', { prone: { name: 'Down' } });
    expect(bad.status).toBe(400);
    expect(bad.body).toMatchObject({ error: 'condition prone: A standard condition is already there', problems: [{ where: 'condition prone' }] });
    expect(tableConditionsOf('cities_without_number')).toEqual({});
    expect(emitted).toEqual([]);
  });

  it('is the main admin\'s alone', async () => {
    expect((await put('cities_without_number', WIRED, EDITOR)).status).toBe(403);
    expect((await put('cities_without_number', WIRED, PLAYER)).status).toBe(403);
    expect((await put('cities_without_number', WIRED, null)).status).toBe(401);
    expect(tableConditionsOf('cities_without_number')).toEqual({});
  });
});
