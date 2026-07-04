import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { makeTestDb, get, all, run } from './helpers/testDb.js';
import adminRouteFactory from '../routes/admin.js';

process.env.JWT_SECRET = 'test-secret';

const ADMIN_TOKEN = jwt.sign(
  { id: 1, username: 'testadmin', role: 'admin', isTemporary: false },
  'test-secret'
);

const makeApp = (db) => {
  const app = express();
  app.use(express.json());
  const io = { emit: () => {} };
  app.use('/api/admin', adminRouteFactory(db, io, { emitUpdate: () => {}, recordAction: () => {} }));
  return app;
};

let db;
let app;

beforeEach(async () => {
  db = await makeTestDb();
  app = makeApp(db);
});

// ─── POST /api/admin/login ────────────────────────────────────────────────────

describe('POST /api/admin/login', () => {
  const seedAdmin = async (db, username = 'admin', password = 'secret') => {
    const hash = await bcrypt.hash(password, 1);
    await run(db, `INSERT INTO admin (username, password) VALUES (?, ?)`, [username, hash]);
  };

  it('returns a JWT token on valid credentials', async () => {
    await seedAdmin(db);
    const res = await request(app)
      .post('/api/admin/login')
      .send({ username: 'admin', password: 'secret' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    const decoded = jwt.verify(res.body.token, 'test-secret');
    expect(decoded.username).toBe('admin');
    expect(decoded.role).toBe('admin');
  });

  it('returns 400 for wrong password', async () => {
    await seedAdmin(db);
    const res = await request(app)
      .post('/api/admin/login')
      .send({ username: 'admin', password: 'wrong' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/invalid password/i);
  });

  it('returns 400 for unknown username', async () => {
    const res = await request(app)
      .post('/api/admin/login')
      .send({ username: 'ghost', password: 'anything' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/user not found/i);
  });
});

// ─── GET /api/admin/districts ─────────────────────────────────────────────────

describe('GET /api/admin/districts', () => {
  it('returns empty array when no districts exist', async () => {
    const res = await request(app).get('/api/admin/districts');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns all districts', async () => {
    await run(db, `INSERT INTO districts (name, color) VALUES ('DOWNTOWN', '#ff0000')`);
    await run(db, `INSERT INTO districts (name, color) VALUES ('SLUMS', '#00ff00')`);
    const res = await request(app).get('/api/admin/districts');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });
});

// ─── POST /api/admin/districts ────────────────────────────────────────────────

describe('POST /api/admin/districts', () => {
  it('returns 401 without a token', async () => {
    const res = await request(app).post('/api/admin/districts').send({ name: 'X', color: '#fff' });
    expect(res.status).toBe(401);
  });

  it('returns 400 when name is missing', async () => {
    const res = await request(app)
      .post('/api/admin/districts')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ color: '#fff' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when color is missing', async () => {
    const res = await request(app)
      .post('/api/admin/districts')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ name: 'DOWNTOWN' });
    expect(res.status).toBe(400);
  });

  it('creates a district and returns it with an id', async () => {
    const res = await request(app)
      .post('/api/admin/districts')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ name: 'CORPO', color: '#00ff00' });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeTruthy();
    expect(res.body.name).toBe('CORPO');
    const row = await get(db, `SELECT * FROM districts WHERE name = 'CORPO'`);
    expect(row).toBeTruthy();
  });
});

// ─── DELETE /api/admin/districts/:name ───────────────────────────────────────

describe('DELETE /api/admin/districts/:name', () => {
  it('returns 401 without a token', async () => {
    const res = await request(app).delete('/api/admin/districts/DOWNTOWN');
    expect(res.status).toBe(401);
  });

  it('deletes the district', async () => {
    await run(db, `INSERT INTO districts (name, color) VALUES ('DOWNTOWN', '#ff0000')`);
    const res = await request(app)
      .delete('/api/admin/districts/DOWNTOWN')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
    const row = await get(db, `SELECT * FROM districts WHERE name = 'DOWNTOWN'`);
    expect(row).toBeUndefined();
  });

  it('clears district_name on locations that belonged to the deleted district', async () => {
    await run(db, `INSERT INTO districts (name, color) VALUES ('SLUMS', '#00ff00')`);
    await run(db, `INSERT INTO locations (name, x, y, z, district_name, district_color) VALUES ('SHACK', 0, 0, 0, 'SLUMS', '#00ff00')`);
    await request(app)
      .delete('/api/admin/districts/SLUMS')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    const loc = await get(db, `SELECT district_name FROM locations WHERE name = 'SHACK'`);
    expect(loc.district_name).toBeNull();
  });
});

// ─── GET /api/admin/water ─────────────────────────────────────────────────────

describe('GET /api/admin/water', () => {
  it('returns empty array when no water bodies exist', async () => {
    const res = await request(app).get('/api/admin/water');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns water bodies with parsed points array', async () => {
    await run(db, `INSERT INTO water_bodies (points_json) VALUES ('[{"x":1,"z":2}]')`);
    const res = await request(app).get('/api/admin/water');
    expect(res.status).toBe(200);
    expect(res.body[0].points).toEqual([{ x: 1, z: 2 }]);
  });
});

// ─── POST /api/admin/water ────────────────────────────────────────────────────

describe('POST /api/admin/water', () => {
  it('returns 401 without a token', async () => {
    const res = await request(app).post('/api/admin/water').send({ points: [] });
    expect(res.status).toBe(401);
  });

  it('returns 400 for invalid points', async () => {
    const res = await request(app)
      .post('/api/admin/water')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ points: 'not-an-array' });
    expect(res.status).toBe(400);
  });

  it('creates a water body and returns its id', async () => {
    const res = await request(app)
      .post('/api/admin/water')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ points: [{ x: 0, z: 0 }, { x: 10, z: 10 }] });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeTruthy();
    const rows = await all(db, 'SELECT * FROM water_bodies');
    expect(rows).toHaveLength(1);
  });

  it('records water_create in action_history', async () => {
    await request(app)
      .post('/api/admin/water')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ points: [{ x: 0, z: 0 }] });
    const row = await get(db, `SELECT * FROM action_history WHERE type = 'water_create'`);
    expect(row).toBeTruthy();
    expect(JSON.parse(row.payload).ids).toHaveLength(1);
  });
});

// ─── DELETE /api/admin/water/:id ─────────────────────────────────────────────

describe('DELETE /api/admin/water/:id', () => {
  it('returns 401 without a token', async () => {
    const res = await request(app).delete('/api/admin/water/1');
    expect(res.status).toBe(401);
  });

  it('deletes a single water body', async () => {
    const r = await run(db, `INSERT INTO water_bodies (points_json) VALUES ('[]')`);
    const res = await request(app)
      .delete(`/api/admin/water/${r.lastID}`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
    const rows = await all(db, 'SELECT * FROM water_bodies');
    expect(rows).toHaveLength(0);
  });
});

// ─── DELETE /api/admin/water (purge all) ─────────────────────────────────────

describe('DELETE /api/admin/water (purge all)', () => {
  it('deletes all water bodies', async () => {
    await run(db, `INSERT INTO water_bodies (points_json) VALUES ('[]')`);
    await run(db, `INSERT INTO water_bodies (points_json) VALUES ('[]')`);
    const res = await request(app)
      .delete('/api/admin/water')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
    const rows = await all(db, 'SELECT * FROM water_bodies');
    expect(rows).toHaveLength(0);
  });
});
