/**
 * Who may change a token through the HTTP routes (4b5a; moved into Phase 4 by the user
 * 2026-10-07). Before this, anyone could change any player's token: its HP, its injuries, its
 * whole row, owner included. Now the GM and granted editors may change any token, and a player
 * only their own, by their own login. Under Secure Mode nobody unnamed changes anything; without
 * it there are no accounts, so a player token may be changed as before.
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
const { mayChangeToken, updateProblem, callerOf } = require_('../tokens/tokenAccess');
const { elevatedUsers } = require_('../middleware/auth');

const sign = (payload) => jwt.sign(payload, 'test-secret');
const GM = sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false });
const EDITOR = sign({ username: 'ghost', isTemporary: true });
const VEX = sign({ username: 'vex', role: 'player' });
const ASH = sign({ username: 'ash', role: 'player' });
const RESET = sign({ username: 'vex', role: 'player', isTemporary: true });

const VEXS = { shape: 'rhombus', owner: 'vex' };
const ENEMY = { shape: 'enemy_rhombus', owner: 'gm' };
const FRIEND = { shape: 'friendly_rhombus', owner: 'gm' };

describe('the rule', () => {
  const editor = { editor: true, player: null };
  const vex = { editor: false, player: 'vex' };
  const nobody = { editor: false, player: null };

  it('lets the GM and editors change any token', () => {
    for (const row of [VEXS, ENEMY, FRIEND, { shape: 'box' }]) expect(mayChangeToken(row, editor, true)).toBe(true);
  });

  it('lets a player change only their own player token', () => {
    expect(mayChangeToken(VEXS, vex, true)).toBe(true);
    expect(mayChangeToken({ shape: 'rhombus', owner: 'ash' }, vex, true)).toBe(false);
    expect(mayChangeToken({ shape: 'rhombus', owner: null }, vex, true)).toBe(false);
    for (const row of [ENEMY, FRIEND, { shape: 'enemy_rhombus', owner: 'vex' }]) expect(mayChangeToken(row, vex, false)).toBe(false);
  });

  it('lets nobody unnamed change anything under Secure Mode, and only player tokens without it', () => {
    expect(mayChangeToken(VEXS, nobody, true)).toBe(false);
    expect(mayChangeToken(VEXS, nobody, false)).toBe(true);
    expect(mayChangeToken(ENEMY, nobody, false)).toBe(false);
    expect(mayChangeToken(null, editor, false)).toBe(false);
  });

  it('keeps whose a token is, and its kind, the GM\'s to change', () => {
    expect(updateProblem(VEXS, { owner: 'vex', shape: 'rhombus', color: '#f00' }, vex, true)).toBeNull();
    expect(updateProblem(VEXS, { color: '#f00' }, vex, true)).toBeNull();
    expect(updateProblem(VEXS, { owner: 'ash' }, vex, true)).toBe('Only the GM changes whose token it is');
    expect(updateProblem(VEXS, { owner: '' }, vex, true)).toBe('Only the GM changes whose token it is');
    expect(updateProblem(VEXS, { shape: 'enemy_rhombus' }, vex, true)).toBe('Only the GM changes what kind of token it is');
    expect(updateProblem(VEXS, { owner: 'ash', shape: 'box' }, editor, true)).toBeNull();
    expect(updateProblem(ENEMY, {}, vex, true)).toBe('You can only change your own token');
    expect(updateProblem({ shape: 'rhombus', owner: null }, { owner: null }, nobody, false)).toBeNull();
  });

  it('reads who is asking from the login token', () => {
    elevatedUsers.add('ghost');
    try {
      const of = (token) => callerOf({ headers: token ? { authorization: `Bearer ${token}` } : {} });
      expect(of(GM)).toEqual({ editor: true, player: null });
      expect(of(EDITOR)).toEqual({ editor: true, player: null });
      expect(of(VEX)).toEqual({ editor: false, player: 'vex' });
      // A password-reset token is not a login; a forged one is nobody.
      expect(of(RESET)).toEqual({ editor: false, player: null });
      expect(of(jwt.sign({ username: 'vex', role: 'player' }, 'wrong'))).toEqual({ editor: false, player: null });
      expect(of(null)).toEqual({ editor: false, player: null });
    } finally { elevatedUsers.delete('ghost'); }
  });
});

describe('the routes', () => {
  let db;
  let app;
  let ids;
  const was = process.env.SECURE_MODE;

  beforeEach(async () => {
    process.env.SECURE_MODE = 'true';
    db = await makeTestDb();
    app = express();
    app.use(express.json());
    app.use('/api/locations', locationsRouteFactory(db, { emit: () => {} }, { emitUpdate: () => {}, recordAction: () => {} }));
    const add = async (name, shape, owner) => (await run(db,
      'INSERT INTO locations (name, x, y, z, shape, owner, hp_current, hp_max, hp_temp) VALUES (?, 0, 0, 0, ?, ?, 10, 10, 0)', [name, shape, owner])).lastID;
    ids = { vex: await add('VEX', 'rhombus', 'vex'), ash: await add('ASH', 'rhombus', 'ash'), enemy: await add('GANGER', 'enemy_rhombus', 'gm') };
  });
  afterEach(() => {
    if (was === undefined) delete process.env.SECURE_MODE; else process.env.SECURE_MODE = was;
    elevatedUsers.delete('ghost');
  });

  const health = (id, token) => request(app).put(`/api/locations/${id}/health`).set(token ? { Authorization: `Bearer ${token}` } : {})
    .send({ action: 'damage', amount: 4 });
  const injuries = (id, token) => request(app).put(`/api/locations/${id}/injuries`).set(token ? { Authorization: `Bearer ${token}` } : {})
    .send({ injuries: { blind: true } });
  const update = (id, token, body) => request(app).put(`/api/locations/${id}`).set(token ? { Authorization: `Bearer ${token}` } : {})
    .send({ name: 'X', x: 5, y: 0, z: 5, shape: 'rhombus', ...body });
  const hpOf = async (id) => (await get(db, 'SELECT hp_current FROM locations WHERE id = ?', [id])).hp_current;

  it('lets a player hurt and heal their own token, and nobody else\'s', async () => {
    expect((await health(ids.vex, VEX)).status).toBe(200);
    expect(await hpOf(ids.vex)).toBe(6);
    expect(await health(ids.ash, VEX)).toMatchObject({ status: 403, body: { error: 'You can only change your own token' } });
    expect(await health(ids.enemy, VEX)).toMatchObject({ status: 403 });
    expect([await hpOf(ids.ash), await hpOf(ids.enemy)]).toEqual([10, 10]);
  });

  it('lets the GM and a granted editor change any token\'s health', async () => {
    elevatedUsers.add('ghost');
    expect((await health(ids.ash, GM)).status).toBe(200);
    expect((await health(ids.enemy, EDITOR)).status).toBe(200);
    expect([await hpOf(ids.ash), await hpOf(ids.enemy)]).toEqual([6, 6]);
  });

  it('refuses a caller who says nothing under Secure Mode, and lets them change a player token without it', async () => {
    expect(await health(ids.vex)).toMatchObject({ status: 401 });
    expect(await hpOf(ids.vex)).toBe(10);
    process.env.SECURE_MODE = 'false';
    expect((await health(ids.vex)).status).toBe(200);
    expect((await health(ids.enemy)).status).toBe(401);
  });

  it('holds injuries to the same rule', async () => {
    expect((await injuries(ids.vex, VEX)).status).toBe(200);
    expect((await injuries(ids.ash, VEX)).status).toBe(403);
    expect((await injuries(ids.enemy, VEX)).status).toBe(403);
    expect((await injuries(ids.ash)).status).toBe(401);
    expect((await injuries(ids.enemy, GM)).status).toBe(200);
    const blind = async (id) => JSON.parse((await get(db, 'SELECT injuries FROM locations WHERE id = ?', [id])).injuries || '{}').blind;
    expect([await blind(ids.vex), await blind(ids.ash), await blind(ids.enemy)]).toEqual([true, undefined, true]);
  });

  it('lets a player move and recolor their own token, never someone else\'s or whose it is', async () => {
    expect((await update(ids.vex, VEX, { owner: 'vex', color: '#ff0000' })).status).toBe(200);
    expect(await get(db, 'SELECT x, color, owner FROM locations WHERE id = ?', [ids.vex])).toEqual({ x: 5, color: '#ff0000', owner: 'vex' });
    expect(await update(ids.ash, VEX, { owner: 'ash' })).toMatchObject({ status: 403 });
    expect(await update(ids.vex, VEX, { owner: 'ash' })).toMatchObject({ status: 403, body: { error: 'Only the GM changes whose token it is' } });
    expect(await update(ids.vex, VEX, { owner: 'vex', shape: 'enemy_rhombus' })).toMatchObject({ status: 403, body: { error: 'Only the GM changes what kind of token it is' } });
    expect((await update(ids.enemy, VEX, { shape: 'enemy_rhombus', owner: 'gm' })).status).toBe(403);
    expect((await update(ids.vex, null, { owner: 'vex' })).status).toBe(401);
    expect((await get(db, 'SELECT owner FROM locations WHERE id = ?', [ids.vex])).owner).toBe('vex');
  });

  it('lets the GM change any token, whose it is included', async () => {
    expect((await update(ids.ash, GM, { owner: 'vex' })).status).toBe(200);
    expect((await get(db, 'SELECT owner FROM locations WHERE id = ?', [ids.ash])).owner).toBe('vex');
  });
});
