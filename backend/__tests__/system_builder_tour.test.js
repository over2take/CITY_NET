/**
 * Whether the builder's first-time tour has been seen (4i; approved mockup
 * docs/mockups/builder-help.html, 2026-10-13): one setting on the server, the main admin's alone,
 * so a new browser doesn't show the tour again.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createRequire } from 'module';
import { makeTestDb } from './helpers/testDb.js';

process.env.JWT_SECRET = 'test-secret';
const require_ = createRequire(import.meta.url);
const { elevatedUsers } = require_('../middleware/auth');
const systemsRoute = require_('../routes/systems.js');

const GM = jwt.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, 'test-secret');
const EDITOR = jwt.sign({ username: 'ghost', isTemporary: true }, 'test-secret');
const PLAYER = jwt.sign({ username: 'vex', role: 'player' }, 'test-secret');

let app;
let db;
beforeEach(async () => {
  elevatedUsers.add('ghost');
  db = await makeTestDb();
  app = express();
  app.use(express.json());
  app.use('/api/systems', systemsRoute(db));
});
afterEach(() => elevatedUsers.delete('ghost'));

const as = (token = GM) => ({ Authorization: `Bearer ${token}` });
const seen = (token) => request(app).get('/api/systems/tour').set(as(token));
const mark = (body, token) => request(app).put('/api/systems/tour').set(as(token)).send(body);
const stored = () => new Promise((resolve, reject) => {
  db.get(`SELECT value FROM global_settings WHERE key = 'builder_tour_seen'`, (err, row) => (err ? reject(err) : resolve(row ? row.value : undefined)));
});

describe('the tour', () => {
  it('starts unseen, is marked seen, and stays seen when marked twice', async () => {
    expect(await seen()).toMatchObject({ status: 200, body: { seen: false } });
    expect(await mark({ seen: true })).toMatchObject({ status: 200, body: { seen: true } });
    expect((await seen()).body).toEqual({ seen: true });
    expect(await stored()).toBe('1');
    expect((await mark({ seen: true })).status).toBe(200);
    expect((await seen()).body).toEqual({ seen: true });
  });

  it('can be shown again, leaving nothing behind', async () => {
    await mark({ seen: true });
    expect(await mark({ seen: false })).toMatchObject({ status: 200, body: { seen: false } });
    expect((await seen()).body).toEqual({ seen: false });
    expect(await stored()).toBeUndefined();
  });

  it('is not a system: "tour" is never read as a system id', async () => {
    const got = await seen();
    expect(got.body).not.toHaveProperty('error');
    expect(Object.keys(got.body)).toEqual(['seen']);
  });

  it('takes true or false, nothing else', async () => {
    for (const body of [{}, { seen: 'yes' }, { seen: 1 }, { seen: null }]) {
      expect(await mark(body), JSON.stringify(body)).toMatchObject({ status: 400, body: { error: 'Seen is true or false' } });
    }
    expect((await seen()).body).toEqual({ seen: false });
  });

  it('is the main admin\'s alone', async () => {
    for (const token of [EDITOR, PLAYER]) {
      expect((await seen(token)).status).toBe(403);
      expect((await mark({ seen: true }, token)).status).toBe(403);
    }
    expect((await request(app).get('/api/systems/tour')).status).toBe(401);
    expect((await request(app).put('/api/systems/tour').send({ seen: true })).status).toBe(401);
    expect(await stored()).toBeUndefined();
  });
});
