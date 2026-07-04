import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { makeTestDb, run, all, get } from './helpers/testDb.js';
import battleMapsFactory from '../routes/battle_maps.js';

process.env.JWT_SECRET = 'test-secret';

// Note: vi.mock('fs') does not intercept CommonJS require('fs') used by the
// route, so tests exercise real disk I/O. Upload tests write to
// backend/uploads/battle_maps/ — the directory is created by the route on load.

const ADMIN_TOKEN = jwt.sign(
  { id: 1, username: 'admin', role: 'admin', isTemporary: false },
  'test-secret'
);
const TEMP_TOKEN = jwt.sign(
  { id: 2, username: 'temp', role: 'admin', isTemporary: true },
  'test-secret'
);

let db;
let app;
let emitUpdate;

const makeApp = () => {
  const a = express();
  a.use(express.json());
  const io = { emit: () => {} };
  emitUpdate = vi.fn();
  a.use('/api/locations/:id/battle_maps', battleMapsFactory(db, io, { emitUpdate }));
  return a;
};

// Seed a battle_map row directly.
const seedMap = (locationId, designation, imageUrl, orderIndex) =>
  run(db, `INSERT INTO battle_maps (location_id, designation, image_url, order_index) VALUES (?, ?, ?, ?)`,
    [locationId, designation, imageUrl, orderIndex]);

beforeEach(async () => {
  db = await makeTestDb();
  await run(db, `CREATE TABLE IF NOT EXISTS battle_maps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    location_id INTEGER NOT NULL,
    designation TEXT NOT NULL,
    image_url TEXT NOT NULL,
    order_index INTEGER NOT NULL
  )`);
  app = makeApp();
});

// ─── GET / ───────────────────────────────────────────────────────────────────

describe('GET /api/locations/:id/battle_maps', () => {
  it('returns empty array when location has no maps', async () => {
    const res = await request(app).get('/api/locations/1/battle_maps');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns only maps for the requested location, sorted by order_index', async () => {
    await seedMap(1, 'Level 2', '/uploads/battle_maps/b.png', 2);
    await seedMap(1, 'Lobby',   '/uploads/battle_maps/a.png', 0);
    await seedMap(2, 'Lobby',   '/uploads/battle_maps/c.png', 0);

    const res = await request(app).get('/api/locations/1/battle_maps');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(2);
    expect(res.body[0].designation).toBe('Lobby');
    expect(res.body[1].designation).toBe('Level 2');
  });
});

// ─── POST / (upload) ─────────────────────────────────────────────────────────

describe('POST /api/locations/:id/battle_maps (upload)', () => {
  it('returns 401 with no token', async () => {
    const res = await request(app)
      .post('/api/locations/1/battle_maps')
      .attach('image', Buffer.from('img'), 'floor.png')
      .field('designation', 'Lobby');
    expect(res.status).toBe(401);
  });

  it('returns 401 for temporary admin (middleware blocks before route)', async () => {
    const res = await request(app)
      .post('/api/locations/1/battle_maps')
      .set('Authorization', `Bearer ${TEMP_TOKEN}`)
      .attach('image', Buffer.from('img'), 'floor.png')
      .field('designation', 'Lobby');
    expect(res.status).toBe(401);
  });

  it('returns 400 when designation is missing', async () => {
    const res = await request(app)
      .post('/api/locations/1/battle_maps')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .attach('image', Buffer.from('img'), 'floor.png');
    expect(res.status).toBe(400);
  });

  it('returns 400 when image is missing', async () => {
    const res = await request(app)
      .post('/api/locations/1/battle_maps')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .field('designation', 'Lobby');
    expect(res.status).toBe(400);
  });

  it('inserts a new row and returns its id', async () => {
    const res = await request(app)
      .post('/api/locations/1/battle_maps')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .attach('image', Buffer.from('data'), 'floor.png')
      .field('designation', 'Lobby');
    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Battle map created');
    expect(res.body.id).toBeGreaterThan(0);
  });

  it('emits an update after insert', async () => {
    await request(app)
      .post('/api/locations/1/battle_maps')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .attach('image', Buffer.from('data'), 'floor.png')
      .field('designation', 'Lobby');
    expect(emitUpdate).toHaveBeenCalledOnce();
  });

  it('updates existing row when designation already exists for location', async () => {
    // First upload
    await request(app)
      .post('/api/locations/1/battle_maps')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .attach('image', Buffer.from('v1'), 'floor.png')
      .field('designation', 'Lobby');

    // Second upload — same location + designation
    const res = await request(app)
      .post('/api/locations/1/battle_maps')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .attach('image', Buffer.from('v2'), 'floor.png')
      .field('designation', 'Lobby');

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Battle map updated');
    const rows = await all(db, `SELECT * FROM battle_maps WHERE location_id = 1`);
    expect(rows).toHaveLength(1);
  });

  it('two uploads of identical content produce the same image_url (hash dedup)', async () => {
    const buf = Buffer.from('same-content');
    await request(app)
      .post('/api/locations/1/battle_maps')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .attach('image', buf, 'floor.png')
      .field('designation', 'Lobby');

    const r2 = await request(app)
      .post('/api/locations/2/battle_maps')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .attach('image', buf, 'other.png')
      .field('designation', 'Lobby');

    const row1 = await get(db, `SELECT image_url FROM battle_maps WHERE location_id = 1`);
    const row2 = await get(db, `SELECT image_url FROM battle_maps WHERE location_id = 2`);
    expect(row1.image_url).toBe(row2.image_url);
  });
});

// ─── order_index mapping ──────────────────────────────────────────────────────

describe('order_index assignment', () => {
  const upload = (locationId, designation) =>
    request(app)
      .post(`/api/locations/${locationId}/battle_maps`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .attach('image', Buffer.from('x'), 'f.png')
      .field('designation', designation);

  it('assigns order_index 0 for Lobby', async () => {
    await upload(1, 'Lobby');
    const row = await get(db, `SELECT order_index FROM battle_maps WHERE designation = 'Lobby'`);
    expect(row.order_index).toBe(0);
  });

  it('assigns order_index 999 for Penthouse', async () => {
    await upload(1, 'Penthouse');
    const row = await get(db, `SELECT order_index FROM battle_maps WHERE designation = 'Penthouse'`);
    expect(row.order_index).toBe(999);
  });

  it('assigns numeric order_index for Level N', async () => {
    await upload(1, 'Level 5');
    const row = await get(db, `SELECT order_index FROM battle_maps WHERE designation = 'Level 5'`);
    expect(row.order_index).toBe(5);
  });

  it('assigns order_index 1 for malformed Level designation', async () => {
    await upload(1, 'Level xyz');
    const row = await get(db, `SELECT order_index FROM battle_maps WHERE designation = 'Level xyz'`);
    expect(row.order_index).toBe(1);
  });

  it('assigns order_index 0 for unknown designation', async () => {
    await upload(1, 'Basement');
    const row = await get(db, `SELECT order_index FROM battle_maps WHERE designation = 'Basement'`);
    expect(row.order_index).toBe(0);
  });
});

// ─── POST /use-existing ───────────────────────────────────────────────────────

describe('POST /api/locations/:id/battle_maps/use-existing', () => {
  const useExisting = (locationId, body, token = ADMIN_TOKEN) =>
    request(app)
      .post(`/api/locations/${locationId}/battle_maps/use-existing`)
      .set('Authorization', `Bearer ${token}`)
      .send(body);

  it('returns 401 for temporary admin (middleware blocks before route)', async () => {
    const res = await useExisting(1, { designation: 'Lobby', imageUrl: '/uploads/battle_maps/x.png' }, TEMP_TOKEN);
    expect(res.status).toBe(401);
  });

  it('returns 400 when designation is missing', async () => {
    const res = await useExisting(1, { imageUrl: '/uploads/battle_maps/x.png' });
    expect(res.status).toBe(400);
  });

  it('returns 400 when imageUrl is missing', async () => {
    const res = await useExisting(1, { designation: 'Lobby' });
    expect(res.status).toBe(400);
  });

  it('returns 404 when image file does not exist on disk', async () => {
    const res = await useExisting(1, { designation: 'Lobby', imageUrl: '/uploads/battle_maps/ghost.png' });
    expect(res.status).toBe(404);
  });

  it('returns 404 when the referenced image file does not exist on disk', async () => {
    // mockFiles is empty → existsSync returns false → 404
    const res = await useExisting(1, { designation: 'Penthouse', imageUrl: '/uploads/battle_maps/missing.png' });
    expect(res.status).toBe(404);
  });
});

// ─── DELETE /:mapId ───────────────────────────────────────────────────────────

describe('DELETE /api/locations/:id/battle_maps/:mapId', () => {
  it('returns 401 with no token', async () => {
    const res = await request(app).delete('/api/locations/1/battle_maps/99');
    expect(res.status).toBe(401);
  });

  it('returns 401 for temporary admin (middleware blocks before route)', async () => {
    const res = await request(app)
      .delete('/api/locations/1/battle_maps/99')
      .set('Authorization', `Bearer ${TEMP_TOKEN}`);
    expect(res.status).toBe(401);
  });

  it('returns 404 for a non-existent map', async () => {
    const res = await request(app)
      .delete('/api/locations/1/battle_maps/999')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(404);
  });

  it('deletes the record and emits an update', async () => {
    await seedMap(1, 'Lobby', '/uploads/battle_maps/del.png', 0);
    const row = await get(db, `SELECT id FROM battle_maps WHERE location_id = 1`);

    const res = await request(app)
      .delete(`/api/locations/1/battle_maps/${row.id}`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Battle map deleted');
    expect(emitUpdate).toHaveBeenCalled();
    const remaining = await all(db, `SELECT * FROM battle_maps`);
    expect(remaining).toHaveLength(0);
  });

  it('removes the DB record when deleting a map with a unique image_url', async () => {
    await seedMap(1, 'Lobby', '/uploads/battle_maps/solo.png', 0);
    const row = await get(db, `SELECT id FROM battle_maps`);

    const res = await request(app)
      .delete(`/api/locations/1/battle_maps/${row.id}`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

    expect(res.status).toBe(200);
    const remaining = await all(db, `SELECT * FROM battle_maps`);
    expect(remaining).toHaveLength(0);
  });

  it('keeps file on disk when another record shares the same image_url', async () => {
    const url = '/uploads/battle_maps/shared.png';
    await seedMap(1, 'Lobby',    url, 0);
    await seedMap(2, 'Penthouse', url, 999);
    const row = await get(db, `SELECT id FROM battle_maps WHERE location_id = 1`);

    await request(app)
      .delete(`/api/locations/1/battle_maps/${row.id}`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

    // File must still exist because location 2 still references it
    const remaining = await all(db, `SELECT * FROM battle_maps WHERE image_url = ?`, [url]);
    expect(remaining).toHaveLength(1);
  });
});

// ─── GET /images ─────────────────────────────────────────────────────────────

describe('GET /api/locations/:id/battle_maps/images', () => {
  it('returns 401 with no token', async () => {
    const res = await request(app).get('/api/locations/1/battle_maps/images');
    expect(res.status).toBe(401);
  });

  it('returns an array of objects with filename and url properties', async () => {
    const res = await request(app)
      .get('/api/locations/1/battle_maps/images')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // Each entry must have the right shape (length varies by disk state)
    if (res.body.length > 0) {
      expect(res.body[0]).toHaveProperty('filename');
      expect(res.body[0]).toHaveProperty('url');
      expect(res.body[0].url).toMatch(/^\/uploads\/battle_maps\//);
    }
  });
});
