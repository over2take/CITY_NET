/**
 * The sheet knows its token (8s3a), for the vitals strip (8s3b): every answer to requestMySheet carries the player's own
 * token, what the map shows of it and no more; and the open sheets re-read when its conditions or injuries change, as
 * they already did on a health change.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createRequire } from 'module';
import { makeTestDb, run } from './helpers/testDb.js';
import { drain } from './helpers/until.js';
import locationsRouteFactory from '../routes/locations.js';

process.env.JWT_SECRET = 'test-secret';
process.env.DICE_ANIM_MS = '0';
const require_ = createRequire(import.meta.url);
const { ownToken, TOKEN_FIELDS } = require_('../sheets/ownToken');
const socketsFactory = (await import('../sockets/index.js')).default;

let db;
beforeEach(async () => { db = await makeTestDb(); });

const token = (owner, { shape = 'rhombus', battle = null, hp = 10, conditions = '[]', name = owner } = {}) => run(db,
  `INSERT INTO locations (name, x, y, z, shape, owner, battle_map_id, hp_current, hp_max, hp_temp, conditions, injuries)
   VALUES (?, 0, 0, 0, ?, ?, ?, ?, 20, 2, ?, '{"head":true}')`, [name, shape, owner, battle, hp, conditions]);
const own = (username, opts = {}) => new Promise((resolve) => ownToken(db, username, opts, resolve));

describe('a player\'s own token', () => {
  it('none on the map: null', async () => {
    await token('ash');
    expect(await own('kes')).toBeNull();
  });

  it('their own rhombus only, the city\'s before a battle map\'s, with what the strip needs and nothing else', async () => {
    await token('kes', { shape: 'enemy_rhombus' });
    // The city's made first: the newest is the battle map's, and still not the one.
    const city = (await token('kes', { name: 'KES' })).lastID;
    const battle = (await token('kes', { battle: 4, name: 'KES ON THE MAP' })).lastID;
    const got = await own('kes');
    expect(got.id).toBe(city);
    expect(Object.keys(got).sort()).toEqual([...TOKEN_FIELDS].sort());
    expect(got).toMatchObject({ name: 'KES', shape: 'rhombus', owner: 'kes', hp_current: 10, hp_max: 20, hp_temp: 2, injuries: '{"head":true}', dying: null });
    // Down (8c3): their own, count and all, for the sheet's DYING box.
    const down = JSON.stringify({ state: 'dying', saves: 1, fails: 0, made: 0, turns: 1, due: false });
    await run(db, 'UPDATE locations SET dying = ? WHERE id = ?', [down, city]);
    expect((await own('kes')).dying).toBe(down);
    // With only a battle map's, that one.
    await run(db, 'DELETE FROM locations WHERE id = ?', [city]);
    expect((await own('kes')).id).toBe(battle);
  });

  it('which conditions, and the rounds each has left only when asked for (the GM\'s), as on the map', async () => {
    await token('kes', { conditions: '[{"id":"poisoned","left":2},{"id":"prone"}]' });
    expect((await own('kes')).conditions).toBe('[{"id":"poisoned"},{"id":"prone"}]');
    expect((await own('kes', { rounds: true })).conditions).toBe('[{"id":"poisoned","left":2},{"id":"prone"}]');
  });
});

/** The sockets module on a test db, as sr6_sockets.test.js boots it. */
const boot = () => {
  const emitted = [];
  let connectionCb;
  const io = {
    on: (event, cb) => { if (event === 'connection') connectionCb = cb; },
    emit: (event, data) => emitted.push({ event, data }),
    to: () => ({ emit: (event, data) => emitted.push({ event, data }) }),
  };
  socketsFactory(io, db, { elevatedUsers: new Set(), emitUpdate: vi.fn(), recordAction: vi.fn() });
  const handlers = {};
  connectionCb({ id: 'sock-1', on: (e, fn) => { handlers[e] = fn; }, emit: (event, data) => emitted.push({ event, data }), use: () => {}, join: () => {} });
  return { handlers, emitted };
};
const sheetFor = async (system, { sheet = true } = {}) => {
  await run(db, `INSERT INTO global_settings (key, value) VALUES ('game_system', ?)`, [system]);
  if (sheet) await run(db, `INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('kes', ?, '{}', 0)`, [system]);
  const { handlers, emitted } = boot();
  handlers.identify('kes');
  await drain(db);
  handlers.requestMySheet();
  await vi.waitFor(() => expect(emitted.find((e) => e.event === 'sheetData')).toBeTruthy());
  return emitted.find((e) => e.event === 'sheetData').data;
};

describe('the sheet carries it', () => {
  it('a game without vehicles', async () => {
    const id = (await token('kes', { conditions: '[{"id":"prone","left":1}]' })).lastID;
    const got = await sheetFor('generic');
    expect(got.token).toMatchObject({ id, hp_current: 10, conditions: '[{"id":"prone"}]' });
  });

  it('a game with vehicles, whose answer is built another way', async () => {
    const id = (await token('kes')).lastID;
    const got = await sheetFor('cities_without_number');
    expect(got.token).toMatchObject({ id, owner: 'kes' });
    expect(got).toHaveProperty('inVehicle');
  });

  it('a sheet made on first opening', async () => {
    const id = (await token('kes')).lastID;
    const got = await sheetFor('generic', { sheet: false });
    expect(got.token).toMatchObject({ id });
  });

  it('none on the map: null', async () => {
    expect((await sheetFor('generic')).token).toBeNull();
  });
});

describe('the open sheets re-read when the token\'s conditions or injuries change', () => {
  const GM = jwt.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, 'test-secret');
  const app = () => {
    const emitted = [];
    const a = express();
    a.use(express.json());
    a.use('/api/locations', locationsRouteFactory(db, { emit: (event, data) => emitted.push({ event, data }) }, { emitUpdate: () => {}, recordAction: () => {} }));
    return { a, emitted };
  };
  const reread = (emitted) => emitted.filter((e) => e.event === 'sheetUpdated').map((e) => e.data.username);

  it('a player\'s token: their sheets', async () => {
    await run(db, `INSERT INTO global_settings (key, value) VALUES ('game_system', 'generic')`);
    const id = (await token('kes')).lastID;
    const { a, emitted } = app();
    expect((await request(a).put(`/api/locations/${id}/conditions`).set('Authorization', `Bearer ${GM}`).send({ conditions: [{ id: 'prone' }] })).status).toBe(200);
    expect((await request(a).put(`/api/locations/${id}/injuries`).set('Authorization', `Bearer ${GM}`).send({ injuries: { head: true } })).status).toBe(200);
    expect(reread(emitted)).toEqual(['kes', 'kes']);
  });

  it('anyone else\'s token: no sheet to tell', async () => {
    await run(db, `INSERT INTO global_settings (key, value) VALUES ('game_system', 'generic')`);
    const id = (await token('gm', { shape: 'enemy_rhombus' })).lastID;
    const { a, emitted } = app();
    expect((await request(a).put(`/api/locations/${id}/conditions`).set('Authorization', `Bearer ${GM}`).send({ conditions: [{ id: 'prone' }] })).status).toBe(200);
    expect((await request(a).put(`/api/locations/${id}/injuries`).set('Authorization', `Bearer ${GM}`).send({ injuries: { head: true } })).status).toBe(200);
    expect(reread(emitted)).toEqual([]);
  });
});

describe('its armor class (8s3c)', () => {
  const GM = jwt.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, 'test-secret');
  const put = (a, id, body) => request(a).put(`/api/locations/${id}`).set('Authorization', `Bearer ${GM}`)
    .send({ name: 'KES', x: 0, y: 0, z: 0, width: 1, height: 1, depth: 1, shape: 'rhombus', owner: 'kes', ...body });

  it('sent with the token', async () => {
    const id = (await token('kes')).lastID;
    await run(db, 'UPDATE locations SET melee_ac = 14, ranged_ac = 16 WHERE id = ?', [id]);
    expect(await own('kes')).toMatchObject({ melee_ac: 14, ranged_ac: 16 });
  });

  it('changed on a player\'s token, their open sheets re-read; anything else changed, or another\'s token, not', async () => {
    await run(db, `INSERT INTO global_settings (key, value) VALUES ('game_system', 'generic')`);
    const id = (await token('kes')).lastID;
    const emitted = [];
    const a = express();
    a.use(express.json());
    a.use('/api/locations', locationsRouteFactory(db, { emit: (event, data) => emitted.push({ event, data }) }, { emitUpdate: () => {}, recordAction: () => {} }));
    expect((await put(a, id, { melee_ac: 14 })).status).toBe(200);
    expect((await put(a, id, { melee_ac: 14, x: 5 })).status).toBe(200);
    expect((await put(a, id, { melee_ac: 14, ranged_ac: 12 })).status).toBe(200);
    const enemy = (await token('gm', { shape: 'enemy_rhombus' })).lastID;
    expect((await put(a, enemy, { shape: 'enemy_rhombus', owner: 'gm', melee_ac: 9 })).status).toBe(200);
    expect(emitted.filter((e) => e.event === 'sheetUpdated').map((e) => e.data.username)).toEqual(['kes', 'kes']);
  });
});
