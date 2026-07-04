import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { makeTestDb, all, run } from './helpers/testDb.js';
import roadsRouteFactory from '../routes/roads.js';

const ADMIN_TOKEN = jwt.sign(
  { id: 1, username: 'testadmin', role: 'admin', isTemporary: false },
  'test-secret'
);

const makeApp = (db) => {
  const app = express();
  app.use(express.json());
  const io = { emit: () => {} };
  app.use('/api/roads', roadsRouteFactory(db, io, { emitUpdate: () => {}, recordAction: () => {} }));
  return app;
};

let db;
let app;

beforeEach(async () => {
  db = await makeTestDb();
  app = makeApp(db);
});

// ─── GET /api/roads ───────────────────────────────────────────────────────────

describe('GET /api/roads', () => {
  it('returns an empty array when no roads exist', async () => {
    const res = await request(app).get('/api/roads');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns all stored road segments', async () => {
    await run(db, `INSERT INTO roads (x1, z1, x2, z2, width) VALUES (0, 0, 10, 10, 4)`);
    await run(db, `INSERT INTO roads (x1, z1, x2, z2, width) VALUES (10, 10, 20, 20, 3)`);

    const res = await request(app).get('/api/roads');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });
});

// ─── POST /api/roads ──────────────────────────────────────────────────────────

describe('POST /api/roads', () => {
  it('stores a single road segment', async () => {
    const res = await request(app)
      .post('/api/roads')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send([{ x1: 0, z1: 0, x2: 10, z2: 10, width: 4 }]);

    expect(res.status).toBe(200);
    const rows = await all(db, 'SELECT * FROM roads');
    expect(rows).toHaveLength(1);
    expect(rows[0].x1).toBe(0);
    expect(rows[0].x2).toBe(10);
    expect(rows[0].width).toBe(4);
  });

  it('stores multiple road segments in one request', async () => {
    const segments = [
      { x1: 0, z1: 0, x2: 10, z2: 0, width: 4 },
      { x1: 10, z1: 0, x2: 20, z2: 0, width: 4 },
      { x1: 20, z1: 0, x2: 30, z2: 0, width: 3 },
    ];

    const res = await request(app)
      .post('/api/roads')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send(segments);

    expect(res.status).toBe(200);
    const rows = await all(db, 'SELECT * FROM roads');
    expect(rows).toHaveLength(3);
  });

  it('defaults width to 4 when not provided', async () => {
    await request(app)
      .post('/api/roads')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send([{ x1: 0, z1: 0, x2: 5, z2: 5 }]);

    const rows = await all(db, 'SELECT * FROM roads');
    expect(rows[0].width).toBe(4);
  });

  it('returns 401 without a token', async () => {
    const res = await request(app)
      .post('/api/roads')
      .send([{ x1: 0, z1: 0, x2: 10, z2: 10, width: 4 }]);

    expect(res.status).toBe(401);
  });
});

// ─── DELETE /api/roads ────────────────────────────────────────────────────────

describe('DELETE /api/roads', () => {
  it('removes all road segments', async () => {
    await run(db, `INSERT INTO roads (x1, z1, x2, z2, width) VALUES (0, 0, 10, 10, 4)`);
    await run(db, `INSERT INTO roads (x1, z1, x2, z2, width) VALUES (10, 10, 20, 20, 4)`);

    const res = await request(app)
      .delete('/api/roads')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

    expect(res.status).toBe(200);
    const rows = await all(db, 'SELECT * FROM roads');
    expect(rows).toHaveLength(0);
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).delete('/api/roads');
    expect(res.status).toBe(401);
  });
});
