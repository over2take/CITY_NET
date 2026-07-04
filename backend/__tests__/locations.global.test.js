import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { makeTestDb, get, all, run } from './helpers/testDb.js';
import locationsRouteFactory from '../routes/locations.js';

const ADMIN_TOKEN = jwt.sign(
  { id: 1, username: 'testadmin', role: 'admin', isTemporary: false },
  'test-secret'
);

const makeApp = (db) => {
  const app = express();
  app.use(express.json());
  const io = { emit: () => {} };
  const router = locationsRouteFactory(db, io, { emitUpdate: () => {}, recordAction: () => {} });
  app.use('/api/locations', router);
  return app;
};

let db;
let app;

beforeEach(async () => {
  db = await makeTestDb();
  app = makeApp(db);
});

// ─── POST /api/locations — no longer auto-globalises ─────────────────────────

describe('POST /api/locations — map-scoped behavior', () => {
  it('does NOT set is_global for a user-named location', async () => {
    const res = await request(app)
      .post('/api/locations')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send([{ name: 'Yakuza HQ', x: 10, y: 0, z: 20, width: 8, height: 16, depth: 8 }]);

    expect(res.status).toBe(200);
    const row = await get(db, 'SELECT is_global FROM locations WHERE name = ?', ['Yakuza HQ']);
    expect(row.is_global).toBeFalsy();
  });

  it('does NOT add a user-named location to custom_structure_library', async () => {
    await request(app)
      .post('/api/locations')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send([{ name: 'Safe House', x: 5, y: 0, z: 5 }]);

    const lib = await all(db, 'SELECT * FROM custom_structure_library');
    expect(lib).toHaveLength(0);
  });

  it('does NOT add a zone-type location to library', async () => {
    await request(app)
      .post('/api/locations')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send([{ name: 'CORPO', x: 0, y: 0, z: 0 }]);

    const lib = await all(db, 'SELECT * FROM custom_structure_library');
    expect(lib).toHaveLength(0);
  });
});

// ─── PUT /api/locations/:id — no longer auto-globalises ──────────────────────

describe('PUT /api/locations/:id — map-scoped behavior', () => {
  it('does NOT set is_global when renaming to a user-defined name', async () => {
    await run(db, `INSERT INTO locations (name, x, y, z, is_global) VALUES ('CORPO', 0, 0, 0, 0)`);
    const row = await get(db, 'SELECT id FROM locations WHERE name = "CORPO"');

    await request(app)
      .put(`/api/locations/${row.id}`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ name: 'Arasaka Tower', x: 0, y: 0, z: 0, width: 8, height: 16, depth: 8 });

    const updated = await get(db, 'SELECT is_global FROM locations WHERE id = ?', [row.id]);
    expect(updated.is_global).toBeFalsy();
  });

  it('does NOT add to library when renamed to a user-defined name', async () => {
    await run(db, `INSERT INTO locations (name, x, y, z) VALUES ('CORPO', 0, 0, 0)`);
    const row = await get(db, 'SELECT id FROM locations WHERE name = "CORPO"');

    await request(app)
      .put(`/api/locations/${row.id}`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ name: 'Arasaka Tower', x: 0, y: 0, z: 0, width: 8, height: 16, depth: 8 });

    const lib = await all(db, 'SELECT * FROM custom_structure_library');
    expect(lib).toHaveLength(0);
  });
});

// ─── POST /api/locations/join — library via JOIN → CUSTOM ────────────────────

describe('POST /api/locations/join — CUSTOM classification saves to library', () => {
  it('saves root to library when classified as CUSTOM', async () => {
    await run(db, `INSERT INTO locations (name, x, y, z, shape) VALUES ('Police HQ', 0, 0, 0, 'box')`);
    const root = await get(db, 'SELECT id FROM locations WHERE name = "Police HQ"');

    const res = await request(app)
      .post('/api/locations/join')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ ids: [root.id], classification: 'CUSTOM' });

    expect(res.status).toBe(200);
    // saveGroupToLibrary fires async DB callbacks after the response — wait for them
    await new Promise(r => setTimeout(r, 50));
    const lib = await all(db, `SELECT * FROM custom_structure_library WHERE classification = 'CUSTOM'`);
    expect(lib).toHaveLength(1);
    expect(lib[0].name).toBe('Police HQ');
  });

  it('saves root and children to library when classified as CUSTOM', async () => {
    await run(db, `INSERT INTO locations (name, x, y, z, shape) VALUES ('Market Hall', 0, 0, 0, 'box')`);
    const root = await get(db, 'SELECT id FROM locations WHERE name = "Market Hall"');
    await run(db, `INSERT INTO locations (name, x, y, z, shape, parent_id) VALUES ('Market Hall_PART', 5, 0, 0, 'box', ${root.id})`);
    const child = await get(db, `SELECT id FROM locations WHERE parent_id = ${root.id}`);

    await request(app)
      .post('/api/locations/join')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ ids: [root.id, child.id], classification: 'CUSTOM' });

    await new Promise(r => setTimeout(r, 50));
    const lib = await all(db, 'SELECT * FROM custom_structure_library');
    expect(lib.length).toBeGreaterThanOrEqual(1);
    const libRoot = lib.find(r => !r.parent_id);
    expect(libRoot).toBeDefined();
    expect(libRoot.classification).toBe('CUSTOM');
  });

  it('does NOT save to library when classification is not CUSTOM', async () => {
    await run(db, `INSERT INTO locations (name, x, y, z, shape) VALUES ('CORPO', 0, 0, 0, 'box')`);
    const root = await get(db, 'SELECT id FROM locations WHERE name = "CORPO"');

    await request(app)
      .post('/api/locations/join')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ ids: [root.id], classification: 'LANDMARK' });

    const lib = await all(db, 'SELECT * FROM custom_structure_library');
    expect(lib).toHaveLength(0);
  });
});

// ─── GET /api/locations/custom-library ───────────────────────────────────────

describe('GET /api/locations/custom-library', () => {
  it('returns only CUSTOM-classified entries', async () => {
    await run(db, `INSERT INTO custom_structure_library (id, name, classification) VALUES (1, 'My Building', 'CUSTOM')`);
    await run(db, `INSERT INTO custom_structure_library (id, name, classification) VALUES (2, 'Old Named', NULL)`);

    const res = await request(app)
      .get('/api/locations/custom-library')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].name).toBe('My Building');
  });

  it('nests child parts under their root entry', async () => {
    await run(db, `INSERT INTO custom_structure_library (id, name, classification) VALUES (10, 'Tower', 'CUSTOM')`);
    await run(db, `INSERT INTO custom_structure_library (id, name, parent_id) VALUES (11, 'Tower_PART', 10)`);

    const res = await request(app)
      .get('/api/locations/custom-library')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].parts).toHaveLength(1);
    expect(res.body[0].parts[0].name).toBe('Tower_PART');
  });

  it('returns empty array when library is empty', async () => {
    const res = await request(app)
      .get('/api/locations/custom-library')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(0);
  });
});
