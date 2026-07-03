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
  const loc = { name: 'CORPO', x: 0, y: 0, z: 0, shape: 'box', ...overrides };
  return run(db,
    `INSERT INTO locations (name, x, y, z, shape) VALUES (?, ?, ?, ?, ?)`,
    [loc.name, loc.x, loc.y, loc.z, loc.shape]
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

describe('POST /api/maps/load/:name', () => {
  it('clears all non-rhombus locations including named ones', async () => {
    await insertLocation(db, { name: 'Yakuza HQ' });
    await insertLocation(db, { name: 'CORPO' });
    await seedSavedMap(db, 'city_base');

    const res = await request(app)
      .post('/api/maps/load/city_base')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(200);

    const rows = await all(db, 'SELECT name FROM locations');
    expect(rows.map(r => r.name)).not.toContain('Yakuza HQ');
    expect(rows.map(r => r.name)).not.toContain('CORPO');
  });

  it('loads the new map locations', async () => {
    await seedSavedMap(db, 'city_base', [
      { id: 99, name: 'SLUMS', x: 5, y: 0, z: 5, shape: 'box', width: 1, height: 1, depth: 1,
        color: '#00ff00', isFavorite: 0, isDanger: 0, polyCount: 5, map_scale_multiplier: 5 },
    ]);

    await request(app)
      .post('/api/maps/load/city_base')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

    const rows = await all(db, 'SELECT name FROM locations');
    expect(rows.map(r => r.name)).toContain('SLUMS');
  });

  it('preserves active rhombuses (player tokens)', async () => {
    await insertLocation(db, { name: 'GHOST', shape: 'rhombus' });
    await insertLocation(db, { name: 'ENEMY', shape: 'enemy_rhombus' });
    await insertLocation(db, { name: 'ALLY', shape: 'friendly_rhombus' });
    await seedSavedMap(db, 'city_base');

    await request(app)
      .post('/api/maps/load/city_base')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

    const names = (await all(db, 'SELECT name FROM locations')).map(r => r.name);
    expect(names).toContain('GHOST');
    expect(names).toContain('ENEMY');
    expect(names).toContain('ALLY');
  });

  it('returns 404 for unknown map name', async () => {
    const res = await request(app)
      .post('/api/maps/load/nonexistent')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(404);
  });
});

// ─── POST /api/maps/clear ─────────────────────────────────────────────────────

describe('POST /api/maps/clear', () => {
  it('removes all non-rhombus locations including named ones', async () => {
    await insertLocation(db, { name: 'Syndicate HQ' });
    await insertLocation(db, { name: 'CORPO' });

    const res = await request(app)
      .post('/api/maps/clear')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(200);

    const rows = await all(db, 'SELECT name FROM locations');
    expect(rows.map(r => r.name)).not.toContain('Syndicate HQ');
    expect(rows.map(r => r.name)).not.toContain('CORPO');
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

    const names = (await all(db, 'SELECT name FROM locations')).map(r => r.name);
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
