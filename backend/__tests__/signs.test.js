import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { makeTestDb, all, run } from './helpers/testDb.js';
import signsRouteFactory from '../routes/signs.js';

const ADMIN_TOKEN = jwt.sign(
  { id: 1, username: 'testadmin', role: 'admin', isTemporary: false },
  'test-secret'
);

const makeApp = (db) => {
  const app = express();
  app.use(express.json());
  const io = { emit: () => {} };
  app.use('/api/signs', signsRouteFactory(db, io, { emitUpdate: () => {}, recordAction: () => {} }));
  return app;
};

let db;
let app;

beforeEach(async () => {
  db = await makeTestDb();
  app = makeApp(db);
});

// ─── GET /api/signs ───────────────────────────────────────────────────────────

describe('GET /api/signs', () => {
  it('returns an empty array when no signs exist', async () => {
    const res = await request(app).get('/api/signs');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns all stored signs', async () => {
    await run(db, `INSERT INTO signs (text, x, y, z) VALUES ('DINER', 1, 0, 2)`);
    await run(db, `INSERT INTO signs (text, x, y, z) VALUES ('BAR', 3, 0, 4)`);
    const res = await request(app).get('/api/signs');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
  });
});

// ─── POST /api/signs ──────────────────────────────────────────────────────────

describe('POST /api/signs', () => {
  it('creates a text sign and returns the row', async () => {
    const res = await request(app)
      .post('/api/signs')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ text: 'NOODLE BAR', x: 1, y: 0, z: 2 });

    expect(res.status).toBe(200);
    expect(res.body.text).toBe('NOODLE BAR');
    expect(res.body.id).toBeGreaterThan(0);
  });

  it('creates an image-only sign (no text required)', async () => {
    const res = await request(app)
      .post('/api/signs')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ image_url: '/signs/motel.svg', x: 1, y: 0, z: 2 });

    expect(res.status).toBe(200);
    expect(res.body.image_url).toBe('/signs/motel.svg');
  });

  it('rejects a sign with neither text nor image_url', async () => {
    const res = await request(app)
      .post('/api/signs')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ x: 1, y: 0, z: 2 });

    expect(res.status).toBe(400);
  });

  it('rejects when x/y/z are missing', async () => {
    const res = await request(app)
      .post('/api/signs')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ text: 'TEST' });

    expect(res.status).toBe(400);
  });

  it('clamps filter_intensity to [0, 2]', async () => {
    const hi = await request(app)
      .post('/api/signs')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ text: 'HI', x: 0, y: 0, z: 0, filter_intensity: 99 });
    expect(hi.body.filter_intensity).toBe(2);

    const lo = await request(app)
      .post('/api/signs')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ text: 'LO', x: 0, y: 0, z: 0, filter_intensity: -5 });
    expect(lo.body.filter_intensity).toBe(0);
  });

  it('strips javascript: and data: image_url schemes', async () => {
    const res = await request(app)
      .post('/api/signs')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ text: 'XSS', x: 0, y: 0, z: 0, image_url: 'javascript:alert(1)' });

    expect(res.status).toBe(200);
    expect(res.body.image_url).toBeNull();
  });

  it('requires auth', async () => {
    const res = await request(app)
      .post('/api/signs')
      .send({ text: 'TEST', x: 0, y: 0, z: 0 });
    expect(res.status).toBe(401);
  });
});

// ─── PATCH /api/signs/:id ─────────────────────────────────────────────────────

describe('PATCH /api/signs/:id', () => {
  it('updates sign fields', async () => {
    await run(db, `INSERT INTO signs (text, x, y, z) VALUES ('OLD', 0, 0, 0)`);
    const [{ id }] = await all(db, 'SELECT id FROM signs');

    const res = await request(app)
      .patch(`/api/signs/${id}`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ text: 'NEW', x: 5, y: 1, z: 3 });

    expect(res.status).toBe(200);
    const [row] = await all(db, 'SELECT * FROM signs WHERE id = ?', [id]);
    expect(row.text).toBe('NEW');
    expect(row.x).toBe(5);
  });

  it('preserves existing fields when not sent', async () => {
    await run(db, `INSERT INTO signs (text, x, y, z, filter_intensity) VALUES ('KEEP', 1, 2, 3, 1.5)`);
    const [{ id }] = await all(db, 'SELECT id FROM signs');

    await request(app)
      .patch(`/api/signs/${id}`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ x: 10 });

    const [row] = await all(db, 'SELECT * FROM signs WHERE id = ?', [id]);
    expect(row.text).toBe('KEEP');
    expect(row.filter_intensity).toBe(1.5);
  });

  it('returns 404 for unknown id', async () => {
    const res = await request(app)
      .patch('/api/signs/9999')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ text: 'X' });
    expect(res.status).toBe(404);
  });

  it('requires auth', async () => {
    await run(db, `INSERT INTO signs (text, x, y, z) VALUES ('T', 0, 0, 0)`);
    const [{ id }] = await all(db, 'SELECT id FROM signs');
    const res = await request(app).patch(`/api/signs/${id}`).send({ text: 'X' });
    expect(res.status).toBe(401);
  });
});

// ─── DELETE /api/signs/:id ────────────────────────────────────────────────────

describe('DELETE /api/signs/:id', () => {
  it('deletes an existing sign', async () => {
    await run(db, `INSERT INTO signs (text, x, y, z) VALUES ('BYE', 0, 0, 0)`);
    const [{ id }] = await all(db, 'SELECT id FROM signs');

    const res = await request(app)
      .delete(`/api/signs/${id}`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

    expect(res.status).toBe(200);
    const rows = await all(db, 'SELECT * FROM signs WHERE id = ?', [id]);
    expect(rows).toHaveLength(0);
  });

  it('returns 404 for unknown id', async () => {
    const res = await request(app)
      .delete('/api/signs/9999')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(404);
  });

  it('requires auth', async () => {
    await run(db, `INSERT INTO signs (text, x, y, z) VALUES ('T', 0, 0, 0)`);
    const [{ id }] = await all(db, 'SELECT id FROM signs');
    const res = await request(app).delete(`/api/signs/${id}`);
    expect(res.status).toBe(401);
  });
});

// ─── rotation on all three axes ───────────────────────────────────────────────

// Signs originally stored yaw only, so a sign pitched flat to act as a ground label
// silently reverted to upright on reload. rotation_x and rotation_z fix that.

const LAY_FLAT = -Math.PI / 2;

describe('sign rotation persistence', () => {
  it('defaults all three axes to 0 when none are supplied', async () => {
    const res = await request(app)
      .post('/api/signs')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ text: 'PLAZA', x: 0, y: 0, z: 0 });
    expect(res.status).toBe(200);
    expect(res.body.rotation_x).toBe(0);
    expect(res.body.rotation_y).toBe(0);
    expect(res.body.rotation_z).toBe(0);
  });

  it('stores a lay-flat pitch on create', async () => {
    const res = await request(app)
      .post('/api/signs')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ text: 'DOCKS', x: 1, y: 0, z: 2, rotation_x: LAY_FLAT });
    expect(res.status).toBe(200);
    expect(res.body.rotation_x).toBeCloseTo(LAY_FLAT);
  });

  it('round-trips all three axes through create and read', async () => {
    await request(app)
      .post('/api/signs')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ text: 'TILTED', x: 0, y: 0, z: 0, rotation_x: 0.5, rotation_y: 1.25, rotation_z: -0.75 });

    const res = await request(app).get('/api/signs');
    expect(res.body[0].rotation_x).toBeCloseTo(0.5);
    expect(res.body[0].rotation_y).toBeCloseTo(1.25);
    expect(res.body[0].rotation_z).toBeCloseTo(-0.75);
  });

  it('persists a pitch applied via PATCH — the reported bug', async () => {
    await run(db, `INSERT INTO signs (text, x, y, z) VALUES ('LABEL', 0, 0, 0)`);
    const [sign] = await all(db, 'SELECT * FROM signs');

    const patch = await request(app)
      .patch(`/api/signs/${sign.id}`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ rotation_x: LAY_FLAT });
    expect(patch.status).toBe(200);

    const rows = await all(db, 'SELECT * FROM signs');
    expect(rows[0].rotation_x).toBeCloseTo(LAY_FLAT);
  });

  it('keeps existing rotation on a PATCH that does not mention it', async () => {
    await run(
      db,
      `INSERT INTO signs (text, x, y, z, rotation_x, rotation_y, rotation_z) VALUES ('KEEP', 0, 0, 0, ?, ?, ?)`,
      [LAY_FLAT, 1.1, 0.25],
    );
    const [sign] = await all(db, 'SELECT * FROM signs');

    await request(app)
      .patch(`/api/signs/${sign.id}`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ text: 'RENAMED' });

    const rows = await all(db, 'SELECT * FROM signs');
    expect(rows[0].text).toBe('RENAMED');
    expect(rows[0].rotation_x).toBeCloseTo(LAY_FLAT);
    expect(rows[0].rotation_y).toBeCloseTo(1.1);
    expect(rows[0].rotation_z).toBeCloseTo(0.25);
  });

  it('allows rotation to be reset to 0, rather than treating it as absent', async () => {
    await run(
      db,
      `INSERT INTO signs (text, x, y, z, rotation_x) VALUES ('FLAT', 0, 0, 0, ?)`,
      [LAY_FLAT],
    );
    const [sign] = await all(db, 'SELECT * FROM signs');

    await request(app)
      .patch(`/api/signs/${sign.id}`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ rotation_x: 0 });

    const rows = await all(db, 'SELECT * FROM signs');
    expect(rows[0].rotation_x).toBe(0);
  });

  it('rejects non-finite angles rather than letting them blank the sign', async () => {
    const res = await request(app)
      .post('/api/signs')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ text: 'NAN', x: 0, y: 0, z: 0, rotation_x: 'not-a-number', rotation_z: null });
    expect(res.status).toBe(200);
    expect(res.body.rotation_x).toBe(0);
    expect(res.body.rotation_z).toBe(0);
  });

  it('falls back to the stored angle when a PATCH sends a non-finite value', async () => {
    await run(
      db,
      `INSERT INTO signs (text, x, y, z, rotation_x) VALUES ('KEEP', 0, 0, 0, ?)`,
      [LAY_FLAT],
    );
    const [sign] = await all(db, 'SELECT * FROM signs');

    await request(app)
      .patch(`/api/signs/${sign.id}`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ rotation_x: 'garbage' });

    const rows = await all(db, 'SELECT * FROM signs');
    expect(rows[0].rotation_x).toBeCloseTo(LAY_FLAT);
  });
});
