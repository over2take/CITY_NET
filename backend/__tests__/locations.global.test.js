import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { makeTestDb, get, all } from './helpers/testDb.js';
import locationsRouteFactory from '../routes/locations.js';

const ADMIN_TOKEN = jwt.sign(
  { id: 1, username: 'testadmin', role: 'admin', isTemporary: false },
  'test-secret'
);

const ZONE_NAMES = ['CORPO', 'URBAN', 'SLUMS', 'INDUSTRIAL', 'PARK', 'HOLOTREE_CANOPY'];

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

// ─── POST /api/locations ──────────────────────────────────────────────────────

describe('POST /api/locations — custom structure (user-defined name)', () => {
  it('sets is_global = 1 for a user-named location', async () => {
    const res = await request(app)
      .post('/api/locations')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send([{ name: 'Yakuza HQ', x: 10, y: 0, z: 20, width: 8, height: 16, depth: 8 }]);

    expect(res.status).toBe(200);
    const row = await get(db, 'SELECT is_global FROM locations WHERE name = ?', ['Yakuza HQ']);
    expect(row.is_global).toBe(1);
  });

  it('adds user-named location to custom_structure_library', async () => {
    await request(app)
      .post('/api/locations')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send([{ name: 'Safe House', x: 5, y: 0, z: 5 }]);

    const lib = await all(db, 'SELECT * FROM custom_structure_library');
    expect(lib).toHaveLength(1);
    expect(lib[0].name).toBe('Safe House');
  });

  it('does NOT set is_global for a zone-type location', async () => {
    await request(app)
      .post('/api/locations')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send([{ name: 'CORPO', x: 0, y: 0, z: 0 }]);

    const row = await get(db, 'SELECT is_global FROM locations WHERE name = ?', ['CORPO']);
    expect(row.is_global).toBe(0);
  });

  it('does NOT add zone-type location to library', async () => {
    await request(app)
      .post('/api/locations')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send([{ name: 'URBAN', x: 0, y: 0, z: 0 }]);

    const lib = await all(db, 'SELECT * FROM custom_structure_library');
    expect(lib).toHaveLength(0);
  });

  it('handles multiple locations — only user-named ones become global', async () => {
    await request(app)
      .post('/api/locations')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send([
        { name: 'Corpo Tower', x: 0, y: 0, z: 0 },
        { name: 'SLUMS', x: 10, y: 0, z: 0 },
        { name: 'Black Market', x: 20, y: 0, z: 0 },
      ]);

    const globals = await all(db, 'SELECT name FROM locations WHERE is_global = 1');
    expect(globals.map(r => r.name)).toEqual(expect.arrayContaining(['Corpo Tower', 'Black Market']));
    expect(globals.map(r => r.name)).not.toContain('SLUMS');

    const lib = await all(db, 'SELECT name FROM custom_structure_library');
    expect(lib.map(r => r.name)).toEqual(expect.arrayContaining(['Corpo Tower', 'Black Market']));
    expect(lib.map(r => r.name)).not.toContain('SLUMS');
  });

  it.each(ZONE_NAMES)('does not globalise zone-type name "%s"', async (zoneName) => {
    await request(app)
      .post('/api/locations')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send([{ name: zoneName, x: 0, y: 0, z: 0 }]);
    const row = await get(db, 'SELECT is_global FROM locations WHERE name = ?', [zoneName]);
    expect(row.is_global).toBe(0);
  });
});

// ─── PUT /api/locations/:id ───────────────────────────────────────────────────

describe('PUT /api/locations/:id — updating a custom structure', () => {
  it('sets is_global and upserts library when name becomes user-defined', async () => {
    await new Promise((res, rej) =>
      db.run(`INSERT INTO locations (name, x, y, z, is_global) VALUES ('CORPO', 0, 0, 0, 0)`,
        function(err) { err ? rej(err) : res(this.lastID); })
    );
    const row = await get(db, 'SELECT id FROM locations WHERE name = "CORPO"');

    await request(app)
      .put(`/api/locations/${row.id}`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ name: 'Arasaka Tower', x: 0, y: 0, z: 0, width: 8, height: 16, depth: 8 });

    const updated = await get(db, 'SELECT is_global FROM locations WHERE id = ?', [row.id]);
    expect(updated.is_global).toBe(1);

    const lib = await all(db, 'SELECT name FROM custom_structure_library');
    expect(lib[0].name).toBe('Arasaka Tower');
  });

  it('updates library entry when custom structure is edited', async () => {
    await request(app)
      .post('/api/locations')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send([{ name: 'Old Name', x: 0, y: 0, z: 0 }]);
    const row = await get(db, 'SELECT id FROM locations WHERE name = "Old Name"');

    await request(app)
      .put(`/api/locations/${row.id}`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ name: 'New Name', x: 1, y: 0, z: 1, width: 10, height: 10, depth: 10 });

    const lib = await get(db, 'SELECT name FROM custom_structure_library WHERE id = ?', [row.id]);
    expect(lib.name).toBe('New Name');
  });

  it('does NOT add to library when renamed to a zone type', async () => {
    await request(app)
      .post('/api/locations')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send([{ name: 'Custom Place', x: 0, y: 0, z: 0 }]);
    const row = await get(db, 'SELECT id FROM locations WHERE name = "Custom Place"');

    await request(app)
      .put(`/api/locations/${row.id}`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ name: 'CORPO', x: 0, y: 0, z: 0, width: 8, height: 8, depth: 8 });

    const lib = await all(db, 'SELECT name FROM custom_structure_library WHERE name = "CORPO"');
    expect(lib).toHaveLength(0);
  });
});
