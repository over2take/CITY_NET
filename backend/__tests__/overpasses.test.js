import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { makeTestDb, all, run } from './helpers/testDb.js';
import overpassesRouteFactory from '../routes/overpasses.js';

const ADMIN_TOKEN = jwt.sign(
  { id: 1, username: 'testadmin', role: 'admin', isTemporary: false },
  'test-secret'
);

const makeApp = (db) => {
  const app = express();
  app.use(express.json());
  const io = { emit: () => {} };
  app.use('/api/overpasses', overpassesRouteFactory(db, io, { emitUpdate: () => {}, recordAction: () => {} }));
  return app;
};

const samplePoints = [{ x: 0, z: 0 }, { x: 100, z: 0 }];
const validBody = { points: samplePoints, height: 10, width: 6, ramp_length: 20, pillar_spacing: 12 };

let db;
let app;

beforeEach(async () => {
  db = await makeTestDb();
  app = makeApp(db);
});

// ─── GET /api/overpasses ─────────────────────────────────────────────────────

describe('GET /api/overpasses', () => {
  it('returns an empty array when no overpasses exist', async () => {
    const res = await request(app).get('/api/overpasses');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns all saved overpasses', async () => {
    await run(db, `INSERT INTO overpasses (points, height, width, ramp_length, pillar_spacing) VALUES (?, ?, ?, ?, ?)`,
      [JSON.stringify(samplePoints), 10, 6, 20, 12]);
    await run(db, `INSERT INTO overpasses (points, height, width, ramp_length, pillar_spacing) VALUES (?, ?, ?, ?, ?)`,
      [JSON.stringify([{ x: 50, z: 0 }, { x: 150, z: 50 }]), 8, 4, 15, 10]);

    const res = await request(app).get('/api/overpasses');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });
});

// ─── POST /api/overpasses ─────────────────────────────────────────────────────

describe('POST /api/overpasses', () => {
  it('saves a row with correct points, height, width, ramp_length, pillar_spacing', async () => {
    const res = await request(app)
      .post('/api/overpasses')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send(validBody);

    expect(res.status).toBe(200);
    expect(res.body.id).toBeGreaterThan(0);

    const rows = await all(db, 'SELECT * FROM overpasses');
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].points)).toEqual(samplePoints);
    expect(rows[0].height).toBe(10);
    expect(rows[0].width).toBe(6);
    expect(rows[0].ramp_length).toBe(20);
    expect(rows[0].pillar_spacing).toBe(12);
  });

  it('accepts points as a pre-serialised JSON string', async () => {
    const res = await request(app)
      .post('/api/overpasses')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ ...validBody, points: JSON.stringify(samplePoints) });

    expect(res.status).toBe(200);
    const rows = await all(db, 'SELECT * FROM overpasses');
    expect(JSON.parse(rows[0].points)).toEqual(samplePoints);
  });

  it('defaults pillar_spacing to 12 when not provided', async () => {
    const { pillar_spacing: _omit, ...bodyWithout } = validBody;
    await request(app)
      .post('/api/overpasses')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send(bodyWithout);

    const rows = await all(db, 'SELECT * FROM overpasses');
    expect(rows[0].pillar_spacing).toBe(12);
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await request(app)
      .post('/api/overpasses')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ points: samplePoints, height: 10 }); // missing width + ramp_length

    expect(res.status).toBe(400);
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).post('/api/overpasses').send(validBody);
    expect(res.status).toBe(401);
  });
});

// ─── DELETE /api/overpasses/:id ───────────────────────────────────────────────

describe('DELETE /api/overpasses/:id', () => {
  it('removes the correct row and leaves others intact', async () => {
    await run(db, `INSERT INTO overpasses (points, height, width, ramp_length, pillar_spacing) VALUES (?, ?, ?, ?, ?)`,
      [JSON.stringify(samplePoints), 10, 6, 20, 12]);
    await run(db, `INSERT INTO overpasses (points, height, width, ramp_length, pillar_spacing) VALUES (?, ?, ?, ?, ?)`,
      [JSON.stringify(samplePoints), 8, 4, 15, 10]);

    const [first] = await all(db, 'SELECT id FROM overpasses ORDER BY id ASC LIMIT 1');
    const res = await request(app)
      .delete(`/api/overpasses/${first.id}`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

    expect(res.status).toBe(200);
    const remaining = await all(db, 'SELECT * FROM overpasses');
    expect(remaining).toHaveLength(1);
    expect(remaining[0].id).not.toBe(first.id);
  });

  it('returns 404 for a non-existent id', async () => {
    const res = await request(app)
      .delete('/api/overpasses/9999')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

    expect(res.status).toBe(404);
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).delete('/api/overpasses/1');
    expect(res.status).toBe(401);
  });
});
