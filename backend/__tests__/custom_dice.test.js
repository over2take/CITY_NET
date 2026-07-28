import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { makeTestDb, get, all, run } from './helpers/testDb.js';
import customDiceRouteFactory from '../routes/custom_dice.js';

const ADMIN_TOKEN = jwt.sign(
  { id: 1, username: 'testadmin', role: 'admin', isTemporary: false },
  'test-secret'
);

const FATE_FACES = [
  { value: '+' }, { value: '+' }, { value: '-' },
  { value: '-' }, { value: '0' }, { value: '0' },
];

let db;
let app;
let emitted;

const makeApp = (database) => {
  const a = express();
  a.use(express.json());
  const io = { emit: (event, payload) => emitted.push({ event, payload }) };
  a.use('/api/custom_dice', customDiceRouteFactory(database, io, { emitUpdate: () => {}, recordAction: () => {} }));
  return a;
};

beforeEach(async () => {
  emitted = [];
  db = await makeTestDb();
  app = makeApp(db);
});

// ─── GET ──────────────────────────────────────────────────────────────────────

describe('GET /api/custom_dice', () => {
  it('returns an empty array when none exist', async () => {
    const res = await request(app).get('/api/custom_dice');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('is readable without a token so players see the GM dice', async () => {
    await run(db, `INSERT INTO custom_dice (name, sides, faces) VALUES (?, ?, ?)`,
      ['Fate', 6, JSON.stringify(FATE_FACES)]);
    const res = await request(app).get('/api/custom_dice');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it('parses faces back into an array', async () => {
    await run(db, `INSERT INTO custom_dice (name, sides, faces) VALUES (?, ?, ?)`,
      ['Fate', 6, JSON.stringify(FATE_FACES)]);
    const res = await request(app).get('/api/custom_dice');
    expect(res.body[0].faces).toEqual(FATE_FACES);
    expect(res.body[0].sides).toBe(6);
  });
});

// ─── POST ─────────────────────────────────────────────────────────────────────

describe('POST /api/custom_dice', () => {
  const post = (body, token = ADMIN_TOKEN) =>
    request(app).post('/api/custom_dice').set('Authorization', `Bearer ${token}`).send(body);

  it('creates a die and returns it with an id', async () => {
    const res = await post({ name: 'Fate', sides: 6, faces: FATE_FACES });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeGreaterThan(0);
    expect(res.body.name).toBe('Fate');
    expect(res.body.faces).toEqual(FATE_FACES);
  });

  it('rejects an unauthenticated request', async () => {
    const res = await request(app).post('/api/custom_dice').send({ name: 'Fate', sides: 6, faces: FATE_FACES });
    expect(res.status).toBe(401);
    expect(await all(db, 'SELECT * FROM custom_dice')).toHaveLength(0);
  });

  it('broadcasts the full list after creating', async () => {
    await post({ name: 'Fate', sides: 6, faces: FATE_FACES });
    // broadcast() runs async after the response; give it a tick
    await new Promise(r => setTimeout(r, 20));
    const update = emitted.find(e => e.event === 'customDiceUpdated');
    expect(update).toBeDefined();
    expect(update.payload).toHaveLength(1);
    expect(update.payload[0].name).toBe('Fate');
  });

  it('requires a name', async () => {
    const res = await post({ name: '   ', sides: 2, faces: [{ value: 'a' }, { value: 'b' }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/name is required/i);
  });

  it('rejects a name reserved by a standard die, case-insensitively', async () => {
    const res = await post({ name: 'D20', sides: 2, faces: [{ value: 'a' }, { value: 'b' }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/reserved/i);
  });

  it('rejects a duplicate name with 409', async () => {
    await post({ name: 'Fate', sides: 6, faces: FATE_FACES });
    const res = await post({ name: 'Fate', sides: 6, faces: FATE_FACES });
    expect(res.status).toBe(409);
  });

  it('rejects fewer than 2 sides', async () => {
    const res = await post({ name: 'Coin', sides: 1, faces: [{ value: 'h' }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least 2/i);
  });

  it('rejects more than 999 sides', async () => {
    const res = await post({ name: 'Huge', sides: 1000, faces: [] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/999/);
  });

  it('rejects a faces array whose length does not match sides', async () => {
    const res = await post({ name: 'Mismatch', sides: 6, faces: [{ value: 'a' }, { value: 'b' }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/length must equal sides/i);
  });

  it('rejects a blank face value', async () => {
    const res = await post({ name: 'Blank', sides: 2, faces: [{ value: 'a' }, { value: '  ' }] });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/every face needs a value/i);
  });

  it('trims face values and the name', async () => {
    const res = await post({ name: '  Fate  ', sides: 2, faces: [{ value: ' + ' }, { value: ' - ' }] });
    expect(res.body.name).toBe('Fate');
    expect(res.body.faces).toEqual([{ value: '+' }, { value: '-' }]);
  });

  it('accepts symbolic and non-numeric faces', async () => {
    const faces = [{ value: '⚡' }, { value: 'BOOM' }, { value: '3' }];
    const res = await post({ name: 'Chaos', sides: 3, faces });
    expect(res.status).toBe(200);
    expect(res.body.faces).toEqual(faces);
  });
});

// ─── PUT ──────────────────────────────────────────────────────────────────────

describe('PUT /api/custom_dice/:id', () => {
  let id;
  beforeEach(async () => {
    const r = await run(db, `INSERT INTO custom_dice (name, sides, faces) VALUES (?, ?, ?)`,
      ['Fate', 6, JSON.stringify(FATE_FACES)]);
    id = r.lastID;
  });

  const put = (body, token = ADMIN_TOKEN) =>
    request(app).put(`/api/custom_dice/${id}`).set('Authorization', `Bearer ${token}`).send(body);

  it('updates name, sides and faces', async () => {
    const res = await put({ name: 'Fudge', sides: 2, faces: [{ value: '+' }, { value: '-' }] });
    expect(res.status).toBe(200);
    const row = await get(db, 'SELECT * FROM custom_dice WHERE id = ?', [id]);
    expect(row.name).toBe('Fudge');
    expect(row.sides).toBe(2);
    expect(JSON.parse(row.faces)).toHaveLength(2);
  });

  it('lets a die keep its own name', async () => {
    const res = await put({ name: 'Fate', sides: 6, faces: FATE_FACES });
    expect(res.status).toBe(200);
  });

  it('rejects taking a name another die already holds', async () => {
    await run(db, `INSERT INTO custom_dice (name, sides, faces) VALUES (?, ?, ?)`,
      ['Chaos', 2, JSON.stringify([{ value: 'a' }, { value: 'b' }])]);
    const res = await put({ name: 'Chaos', sides: 6, faces: FATE_FACES });
    expect(res.status).toBe(409);
  });

  it('rejects an unauthenticated request', async () => {
    const res = await request(app).put(`/api/custom_dice/${id}`).send({ name: 'Hacked', sides: 6, faces: FATE_FACES });
    expect(res.status).toBe(401);
    const row = await get(db, 'SELECT * FROM custom_dice WHERE id = ?', [id]);
    expect(row.name).toBe('Fate');
  });

  it('404s for a missing die', async () => {
    const res = await request(app).put('/api/custom_dice/9999')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ name: 'Ghost', sides: 6, faces: FATE_FACES });
    expect(res.status).toBe(404);
  });

  it('broadcasts after updating', async () => {
    await put({ name: 'Fudge', sides: 2, faces: [{ value: '+' }, { value: '-' }] });
    await new Promise(r => setTimeout(r, 20));
    expect(emitted.some(e => e.event === 'customDiceUpdated')).toBe(true);
  });
});

// ─── DELETE ───────────────────────────────────────────────────────────────────

describe('DELETE /api/custom_dice/:id', () => {
  let id;
  beforeEach(async () => {
    const r = await run(db, `INSERT INTO custom_dice (name, sides, faces) VALUES (?, ?, ?)`,
      ['Fate', 6, JSON.stringify(FATE_FACES)]);
    id = r.lastID;
  });

  it('deletes the die', async () => {
    const res = await request(app).delete(`/api/custom_dice/${id}`).set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
    expect(await all(db, 'SELECT * FROM custom_dice')).toHaveLength(0);
  });

  it('rejects an unauthenticated request', async () => {
    const res = await request(app).delete(`/api/custom_dice/${id}`);
    expect(res.status).toBe(401);
    expect(await all(db, 'SELECT * FROM custom_dice')).toHaveLength(1);
  });

  it('404s for a missing die', async () => {
    const res = await request(app).delete('/api/custom_dice/9999').set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(404);
  });

  it('broadcasts after deleting', async () => {
    await request(app).delete(`/api/custom_dice/${id}`).set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    await new Promise(r => setTimeout(r, 20));
    const update = emitted.find(e => e.event === 'customDiceUpdated');
    expect(update).toBeDefined();
    expect(update.payload).toEqual([]);
  });
});
