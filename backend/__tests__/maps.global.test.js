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

const seedSavedMap = (db, mapName, { locations = [], districts = [], roads = [], overpasses = [], waterBodies = [] } = {}) =>
  run(db,
    `INSERT INTO saved_maps (name, locations_data, districts_data, roads_data, overpasses_data, water_bodies_data) VALUES (?, ?, ?, ?, ?, ?)`,
    [mapName, JSON.stringify(locations), JSON.stringify(districts), JSON.stringify(roads), JSON.stringify(overpasses), JSON.stringify(waterBodies)]
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
    await seedSavedMap(db, 'city_base', {});

    const res = await request(app)
      .post('/api/maps/load/city_base')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(200);

    const rows = await all(db, 'SELECT name FROM locations');
    expect(rows.map(r => r.name)).not.toContain('Yakuza HQ');
    expect(rows.map(r => r.name)).not.toContain('CORPO');
  });

  it('loads the new map locations', async () => {
    await seedSavedMap(db, 'city_base', { locations: [
      { id: 99, name: 'SLUMS', x: 5, y: 0, z: 5, shape: 'box', width: 1, height: 1, depth: 1,
        color: '#00ff00', isFavorite: 0, isDanger: 0, polyCount: 5, map_scale_multiplier: 5 },
    ]});

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
    await seedSavedMap(db, 'city_base', {});

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

  it('clears overpasses and water bodies', async () => {
    await run(db, `INSERT INTO overpasses (points, height, width, ramp_length) VALUES ('[]', 10, 4, 20)`);
    await run(db, `INSERT INTO water_bodies (points_json) VALUES ('[{"x":0,"z":0}]')`);

    await request(app)
      .post('/api/maps/clear')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

    const overpasses = await all(db, 'SELECT * FROM overpasses');
    const water = await all(db, 'SELECT * FROM water_bodies');
    expect(overpasses).toHaveLength(0);
    expect(water).toHaveLength(0);
  });
});

// ─── POST /api/maps/save ──────────────────────────────────────────────────────

describe('POST /api/maps/save', () => {
  it('returns 400 when name is missing', async () => {
    const res = await request(app)
      .post('/api/maps/save')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({});
    expect(res.status).toBe(400);
  });

  it('returns 401 without a token', async () => {
    const res = await request(app).post('/api/maps/save').send({ name: 'test' });
    expect(res.status).toBe(401);
  });

  it('saves current roads, overpasses, and water bodies into the snapshot', async () => {
    await run(db, `INSERT INTO roads (x1, z1, x2, z2, width) VALUES (0, 0, 10, 0, 4)`);
    await run(db, `INSERT INTO overpasses (points, height, width, ramp_length) VALUES ('[{"x":0,"z":0}]', 10, 4, 20)`);
    await run(db, `INSERT INTO water_bodies (points_json) VALUES ('[{"x":5,"z":5}]')`);

    const res = await request(app)
      .post('/api/maps/save')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ name: 'snapshot_1' });
    expect(res.status).toBe(200);

    const row = await get(db, `SELECT * FROM saved_maps WHERE name = 'snapshot_1'`);
    expect(JSON.parse(row.roads_data)).toHaveLength(1);
    expect(JSON.parse(row.overpasses_data)).toHaveLength(1);
    expect(JSON.parse(row.water_bodies_data)).toHaveLength(1);
  });

  it('upserts — saving again under the same name replaces the snapshot', async () => {
    await run(db, `INSERT INTO roads (x1, z1, x2, z2, width) VALUES (0, 0, 10, 0, 4)`);
    await request(app)
      .post('/api/maps/save')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ name: 'city' });

    await run(db, `DELETE FROM roads`);
    await run(db, `INSERT INTO roads (x1, z1, x2, z2, width) VALUES (1, 1, 5, 5, 6)`);
    await run(db, `INSERT INTO roads (x1, z1, x2, z2, width) VALUES (5, 5, 9, 9, 6)`);
    await request(app)
      .post('/api/maps/save')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ name: 'city' });

    const rows = await all(db, `SELECT * FROM saved_maps WHERE name = 'city'`);
    expect(rows).toHaveLength(1);
    expect(JSON.parse(rows[0].roads_data)).toHaveLength(2);
  });
});

// ─── POST /api/maps/load — overpasses + water ─────────────────────────────────

describe('POST /api/maps/load/:name — overpasses and water', () => {
  it('clears existing overpasses before loading', async () => {
    await run(db, `INSERT INTO overpasses (points, height, width, ramp_length) VALUES ('[]', 8, 4, 20)`);
    await seedSavedMap(db, 'empty_map', {});

    await request(app)
      .post('/api/maps/load/empty_map')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

    const overpasses = await all(db, 'SELECT * FROM overpasses');
    expect(overpasses).toHaveLength(0);
  });

  it('restores overpasses from the saved snapshot', async () => {
    await seedSavedMap(db, 'arch_city', {
      overpasses: [{ id: 5, points: '[{"x":0,"z":0}]', height: 12, width: 4, ramp_length: 30, pillar_spacing: 12 }],
    });

    await request(app)
      .post('/api/maps/load/arch_city')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

    const overpasses = await all(db, 'SELECT * FROM overpasses');
    expect(overpasses).toHaveLength(1);
    expect(overpasses[0].height).toBe(12);
  });

  it('clears existing water bodies before loading', async () => {
    await run(db, `INSERT INTO water_bodies (points_json) VALUES ('[{"x":0,"z":0}]')`);
    await seedSavedMap(db, 'dry_map', {});

    await request(app)
      .post('/api/maps/load/dry_map')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

    const water = await all(db, 'SELECT * FROM water_bodies');
    expect(water).toHaveLength(0);
  });

  it('restores water bodies from the saved snapshot', async () => {
    await seedSavedMap(db, 'wet_city', {
      waterBodies: [{ id: 3, points_json: '[{"x":10,"z":10}]', map_scale_multiplier: '[1]' }],
    });

    await request(app)
      .post('/api/maps/load/wet_city')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

    const water = await all(db, 'SELECT * FROM water_bodies');
    expect(water).toHaveLength(1);
    expect(JSON.parse(water[0].points_json)[0].x).toBe(10);
  });

  it('loads overpasses and water from a snapshot with no overpasses_data column value (legacy)', async () => {
    await run(db, `INSERT INTO saved_maps (name, locations_data, districts_data, roads_data) VALUES ('legacy', '[]', '[]', '[]')`);

    const res = await request(app)
      .post('/api/maps/load/legacy')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

    expect(res.status).toBe(200);
    const overpasses = await all(db, 'SELECT * FROM overpasses');
    const water = await all(db, 'SELECT * FROM water_bodies');
    expect(overpasses).toHaveLength(0);
    expect(water).toHaveLength(0);
  });
});

// ─── GET /api/maps ────────────────────────────────────────────────────────────

describe('GET /api/maps', () => {
  it('returns an empty array when no maps are saved', async () => {
    const res = await request(app).get('/api/maps');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('returns saved map names ordered by most recent first', async () => {
    await run(db, `INSERT INTO saved_maps (name, locations_data, districts_data, roads_data, timestamp) VALUES ('alpha', '[]', '[]', '[]', datetime('now', '-10 seconds'))`);
    await run(db, `INSERT INTO saved_maps (name, locations_data, districts_data, roads_data, timestamp) VALUES ('beta', '[]', '[]', '[]', datetime('now'))`);

    const res = await request(app).get('/api/maps');
    expect(res.status).toBe(200);
    expect(res.body[0].name).toBe('beta');
    expect(res.body[1].name).toBe('alpha');
  });

  it('does not expose locations_data in the listing', async () => {
    await seedSavedMap(db, 'secret', {});
    const res = await request(app).get('/api/maps');
    expect(res.body[0].locations_data).toBeUndefined();
  });
});

// ─── DELETE /api/maps/:id ─────────────────────────────────────────────────────

describe('DELETE /api/maps/:id', () => {
  it('returns 401 without a token', async () => {
    const res = await request(app).delete('/api/maps/1');
    expect(res.status).toBe(401);
  });

  it('deletes a saved map by id', async () => {
    const r = await seedSavedMap(db, 'to_delete', {});
    const res = await request(app)
      .delete(`/api/maps/${r.lastID}`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
    const rows = await all(db, 'SELECT * FROM saved_maps');
    expect(rows).toHaveLength(0);
  });

  it('returns 200 even for a non-existent id (sqlite behaviour)', async () => {
    const res = await request(app)
      .delete('/api/maps/9999')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
  });
});
