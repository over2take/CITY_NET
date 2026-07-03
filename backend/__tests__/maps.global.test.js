import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { makeTestDb, get, all, run } from './helpers/testDb.js';
import mapsRouteFactory from '../routes/maps.js';

const ADMIN_TOKEN = jwt.sign(
  { id: 1, username: 'testadmin', role: 'admin', isTemporary: false },
  'test-secret'
);

const makeApp = (db) => {
  const app = express();
  app.use(express.json());
  const io = { emit: () => {} };
  app.use('/api/maps', mapsRouteFactory(db, io, { emitUpdate: () => {}, recordAction: () => {} }));
  return app;
};

const insertLocation = (db, overrides = {}) => {
  const loc = { name: 'CORPO', x: 0, y: 0, z: 0, is_global: 0, shape: 'box', ...overrides };
  return run(db,
    `INSERT INTO locations (name, x, y, z, is_global, shape) VALUES (?, ?, ?, ?, ?, ?)`,
    [loc.name, loc.x, loc.y, loc.z, loc.is_global, loc.shape]
  );
};

const seedSavedMap = (db, mapName, locations = []) =>
  run(db,
    `INSERT INTO saved_maps (name, locations_data, districts_data, roads_data) VALUES (?, ?, ?, ?)`,
    [mapName, JSON.stringify(locations), '[]', '[]']
  );

let db;
let app;

beforeEach(async () => {
  db = await makeTestDb();
  app = makeApp(db);
});

// ─── POST /api/maps/load/:name ────────────────────────────────────────────────

describe('POST /api/maps/load/:name — global structure preservation', () => {
  it('preserves global structures when loading a new map', async () => {
    await insertLocation(db, { name: 'Yakuza HQ', is_global: 1 });
    await insertLocation(db, { name: 'CORPO' });
    await seedSavedMap(db, 'city_base');

    const res = await request(app)
      .post('/api/maps/load/city_base')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(200);

    const rows = await all(db, 'SELECT name FROM locations');
    expect(rows.map(r => r.name)).toContain('Yakuza HQ');
    expect(rows.map(r => r.name)).not.toContain('CORPO');
  });

  it('preserves multiple global structures', async () => {
    await insertLocation(db, { name: 'Safe House', is_global: 1 });
    await insertLocation(db, { name: 'Black Market', is_global: 1 });
    await insertLocation(db, { name: 'URBAN' });
    await seedSavedMap(db, 'city_base');

    await request(app)
      .post('/api/maps/load/city_base')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

    const globals = await all(db, 'SELECT name FROM locations WHERE is_global = 1');
    expect(globals.map(r => r.name)).toEqual(expect.arrayContaining(['Safe House', 'Black Market']));
  });

  it('loads the new map locations alongside existing globals', async () => {
    await insertLocation(db, { name: 'Custom Tower', is_global: 1 });
    await seedSavedMap(db, 'city_base', [
      { id: 99, name: 'SLUMS', x: 5, y: 0, z: 5, shape: 'box', width: 1, height: 1, depth: 1,
        color: '#00ff00', is_global: 0, isFavorite: 0, isDanger: 0, polyCount: 5,
        map_scale_multiplier: 5 },
    ]);

    await request(app)
      .post('/api/maps/load/city_base')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

    const rows = await all(db, 'SELECT name FROM locations');
    const names = rows.map(r => r.name);
    expect(names).toContain('Custom Tower');
    expect(names).toContain('SLUMS');
  });

  it('global wins on ID conflict — map version skipped via INSERT OR IGNORE', async () => {
    await run(db,
      `INSERT INTO locations (id, name, x, y, z, is_global, shape) VALUES (99, 'Global Place', 0, 0, 0, 1, 'box')`
    );
    await seedSavedMap(db, 'city_base', [
      { id: 99, name: 'Map Place', x: 5, y: 0, z: 5, shape: 'box', width: 1, height: 1, depth: 1,
        color: '#00ff00', is_global: 0, isFavorite: 0, isDanger: 0, polyCount: 5,
        map_scale_multiplier: 5 },
    ]);

    await request(app)
      .post('/api/maps/load/city_base')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

    const row = await get(db, 'SELECT name FROM locations WHERE id = 99');
    expect(row.name).toBe('Global Place');
  });

  it('preserves active rhombuses (player tokens)', async () => {
    await insertLocation(db, { name: 'GHOST', shape: 'rhombus' });
    await seedSavedMap(db, 'city_base');

    await request(app)
      .post('/api/maps/load/city_base')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

    const row = await get(db, `SELECT name FROM locations WHERE shape = 'rhombus'`);
    expect(row.name).toBe('GHOST');
  });

  it('returns 404 for unknown map name', async () => {
    const res = await request(app)
      .post('/api/maps/load/nonexistent')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(404);
  });
});

// ─── POST /api/maps/clear ─────────────────────────────────────────────────────

describe('POST /api/maps/clear — global structure preservation', () => {
  it('preserves global structures on clear', async () => {
    await insertLocation(db, { name: 'Syndicate HQ', is_global: 1 });
    await insertLocation(db, { name: 'CORPO' });

    const res = await request(app)
      .post('/api/maps/clear')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(200);

    const rows = await all(db, 'SELECT name FROM locations');
    expect(rows.map(r => r.name)).toContain('Syndicate HQ');
    expect(rows.map(r => r.name)).not.toContain('CORPO');
  });

  it('removes all non-global, non-rhombus locations on clear', async () => {
    await insertLocation(db, { name: 'URBAN' });
    await insertLocation(db, { name: 'SLUMS' });
    await insertLocation(db, { name: 'INDUSTRIAL' });

    await request(app)
      .post('/api/maps/clear')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

    const rows = await all(db, 'SELECT * FROM locations');
    expect(rows).toHaveLength(0);
  });

  it('preserves all rhombus types on clear', async () => {
    await insertLocation(db, { name: 'GHOST', shape: 'rhombus' });
    await insertLocation(db, { name: 'ENEMY', shape: 'enemy_rhombus' });
    await insertLocation(db, { name: 'ALLY', shape: 'friendly_rhombus' });
    await insertLocation(db, { name: 'CORPO' });

    await request(app)
      .post('/api/maps/clear')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

    const rows = await all(db, 'SELECT name FROM locations');
    const names = rows.map(r => r.name);
    expect(names).toContain('GHOST');
    expect(names).toContain('ENEMY');
    expect(names).toContain('ALLY');
    expect(names).not.toContain('CORPO');
  });

  it('clears districts and roads', async () => {
    await run(db, `INSERT INTO districts (name, color) VALUES ('DOWNTOWN', '#ff0000')`);
    await run(db, `INSERT INTO roads (x1, z1, x2, z2, width) VALUES (0, 0, 10, 10, 2)`);

    await request(app)
      .post('/api/maps/clear')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

    const districts = await all(db, 'SELECT * FROM districts');
    const roads = await all(db, 'SELECT * FROM roads');
    expect(districts).toHaveLength(0);
    expect(roads).toHaveLength(0);
  });
});
