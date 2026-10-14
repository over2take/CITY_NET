/**
 * Switching a custom system's house rules at the table (4j2b; approved mockup
 * docs/mockups/optional-rules.html, 2026-10-14): the GM or a granted editor, from TTRPG_SYSTEM; the
 * running game takes them at once; and a condition a rule switched off hides stays on its tokens.
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
const { elevatedUsers } = require_('../middleware/auth');
const runtime = require_('../systemBuilder/runtime');
const systemsRoute = require_('../routes/systems.js');
const { checkTokenConditions } = require_('../tokens/conditions');

const sign = (payload) => jwt.sign(payload, 'test-secret');
const GM = sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false });
const EDITOR = sign({ username: 'ghost', isTemporary: true });
const PLAYER = sign({ username: 'vex', role: 'player' });
const as = (token) => (token ? { Authorization: `Bearer ${token}` } : {});

const HEARTH = 'sys_aaaaaaaaaaaaaaaa';
const PLAIN = 'sys_bbbbbbbbbbbbbbbb';
const DEF = {
  format: 1, name: 'Hearth',
  house_rules: [{ id: 'magic', name: 'MAGIC', starts: false }, { id: 'markets', name: 'TOWN MARKETS', starts: true }],
  parts: { shops: { on: true, only_with: 'markets' } },
  conditions: { hexed: { name: 'Hexed', only_with: 'magic' }, warded: { name: 'Warded', only_with: 'magic' }, stunned: { only_with: 'magic' } },
};

let db;
let app;
let emitted;
let enemy;
const was = process.env.SECURE_MODE;
beforeEach(async () => {
  process.env.SECURE_MODE = 'true';
  elevatedUsers.add('ghost');
  db = await makeTestDb();
  for (const [id, def] of [[HEARTH, DEF], [PLAIN, { format: 1, name: 'Plain' }]]) {
    const text = JSON.stringify(def);
    await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', [id, def.name, text, text]);
  }
  await run(db, `INSERT INTO global_settings (key, value) VALUES ('game_system', ?)`, [HEARTH]);
  await new Promise((resolve) => runtime.load(db, resolve));
  emitted = [];
  app = express();
  app.use(express.json());
  app.use('/api/systems', systemsRoute(db, { emit: (event, data) => emitted.push([event, data]) }));
  app.use('/api/locations', locationsRouteFactory(db, { emit: () => {} }, { emitUpdate: () => {}, recordAction: () => {} }));
  enemy = (await run(db, `INSERT INTO locations (name, x, y, z, shape, owner, conditions) VALUES ('GANGER', 0, 0, 0, 'enemy_rhombus', 'gm', '[]')`)).lastID;
});
afterEach(() => {
  if (was === undefined) delete process.env.SECURE_MODE; else process.env.SECURE_MODE = was;
  elevatedUsers.delete('ghost');
});

const choose = (rules, token = GM, system = HEARTH) => request(app).put(`/api/systems/${system}/house-rules`).set(as(token)).send({ rules });
const setting = async (rule) => (await get(db, 'SELECT value FROM global_settings WHERE key = ?', [`house_rule:${HEARTH}:${rule}`]) || {}).value;
const onNow = () => runtime.houseRulesIn(HEARTH).filter((r) => r.on).map((r) => r.id);

describe('switching them', () => {
  it('takes any number at once, runs them, keeps them, and tells every browser', async () => {
    const res = await choose({ magic: true, markets: false });
    expect(res.status).toBe(200);
    expect(res.body.house_rules.map((r) => [r.id, r.on])).toEqual([['magic', true], ['markets', false]]);
    expect([await setting('magic'), await setting('markets')]).toEqual(['1', '0']);
    expect(onNow()).toEqual(['magic']);
    expect(runtime.partIn(HEARTH, 'shops')).toBe(false);
    expect(runtime.conditionsIn(HEARTH).map((c) => c.id)).toContain('hexed');
    expect(emitted).toEqual([['customSystemChanged', { id: HEARTH }]]);
    // Kept across a restart.
    await new Promise((resolve) => runtime.load(db, resolve));
    expect(onNow()).toEqual(['magic']);
    expect((await choose({ magic: false })).body.house_rules.map((r) => r.on)).toEqual([false, false]);
    expect(await setting('magic')).toBe('0');
  });

  it('refuses a rule the system hasn\'t, a choice that isn\'t on or off, and nothing at all, changing nothing', async () => {
    for (const [rules, error] of [
      [{ magic: true, nope: true }, '"nope" is not one of this system\'s house rules'],
      [{ magic: 'yes' }, 'Say on or off for magic'],
      [{}, 'Say which house rules are on'],
      [['magic'], 'Say which house rules are on'],
      [undefined, 'Say which house rules are on'],
    ]) {
      expect(await choose(rules), JSON.stringify(rules)).toMatchObject({ status: 400, body: { error } });
    }
    expect(await setting('magic')).toBeUndefined();
    expect(onNow()).toEqual(['markets']);
    expect(emitted).toEqual([]);
  });

  it('only for a system running with house rules', async () => {
    for (const system of [PLAIN, 'cities_without_number', 'sys_zzzzzzzzzzzzzzzz']) {
      expect(await choose({ magic: true }, GM, system), system).toMatchObject({ status: 404, body: { error: 'That system has no house rules running' } });
    }
  });

  it('by the GM or a granted editor, never a player', async () => {
    expect((await choose({ magic: true }, EDITOR)).status).toBe(200);
    expect((await choose({ magic: false }, PLAYER)).status).toBe(403);
    expect((await choose({ magic: false }, null)).status).toBe(401);
    expect(onNow()).toEqual(['magic', 'markets']);
  });
});

describe('a condition a rule hides', () => {
  const put = (conditions) => request(app).put(`/api/locations/${enemy}/conditions`).set(as(GM)).send({ conditions });
  const stored = async () => JSON.parse((await get(db, 'SELECT conditions FROM locations WHERE id = ?', [enemy])).conditions);

  it('stays on its token out of sight, whatever is changed beside it, until the rule is back', async () => {
    await choose({ magic: true });
    expect((await put([{ id: 'hexed' }])).status).toBe(200);
    await choose({ magic: false });
    expect([...runtime.hiddenConditionsIn(HEARTH)].sort()).toEqual(['hexed', 'stunned', 'warded']);
    // The browser sends the whole list, the hidden one too: it is kept as it was.
    expect(await put([{ id: 'hexed' }, { id: 'prone' }])).toMatchObject({ status: 200, body: { conditions: [{ id: 'prone' }, { id: 'hexed' }] } });
    // Left off the list, it is kept all the same.
    expect((await put([])).status).toBe(200);
    expect(await stored()).toEqual([{ id: 'hexed' }]);
    // None can be put on while hidden, standard or the system's own.
    for (const id of ['warded', 'stunned']) {
      expect(await put([{ id }]), id).toMatchObject({ status: 400, body: { error: `"${id}" is not a condition this game has` } });
    }
    await choose({ magic: true });
    expect(runtime.hiddenConditionsIn(HEARTH).size).toBe(0);
    expect((await put([])).status).toBe(200);
    expect(await stored()).toEqual([]);
  });

  it('in the check itself: kept as stored, rounds and all, asked for or not', () => {
    const offered = [{ id: 'prone', ends: 'removed' }];
    const kept = [{ id: 'hexed', left: 2 }];
    expect(checkTokenConditions([{ id: 'hexed', left: 9 }, { id: 'prone' }], offered, kept)).toEqual({ ok: true, value: [{ id: 'prone' }, { id: 'hexed', left: 2 }] });
    expect(checkTokenConditions([], offered, kept)).toEqual({ ok: true, value: kept });
    expect(checkTokenConditions([{ id: 'hexed' }], offered)).toMatchObject({ ok: false });
  });

  it('has nothing hidden for a system without house rules, or a built-in game', () => {
    expect(runtime.hiddenConditionsIn(PLAIN).size).toBe(0);
    expect(runtime.hiddenConditionsIn('cities_without_number').size).toBe(0);
  });
});
