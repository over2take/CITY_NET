import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import https from 'https';
import { vi } from 'vitest';
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

// ─── update routes ────────────────────────────────────────────────────────────

/**
 * These test the wiring, not the logic — updater.test.js covers the logic.
 *
 * The gap they close is real: every fault this branch fixed lived in the seam between
 * the route and what it called, and a module can be correct while the route ignores it.
 */
describe('update routes', () => {
  it('GET /version carries a boot id, so a restart is detectable', async () => {
    // The client waits on this rather than a version change, because a build without
    // APP_VERSION reports 'dev' before and after and would hang on a working update.
    const res = await request(app).get('/api/admin/version');
    expect(res.status).toBe(200);
    expect(typeof res.body.bootId).toBe('string');
    expect(res.body.bootId.length).toBeGreaterThan(0);
  });

  it('GET /update/status needs no auth, since the restart drops the session', async () => {
    const res = await request(app).get('/api/admin/update/status');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('phase');
    expect(res.body).toHaveProperty('bootId');
  });

  it('POST /update refuses with a reason instead of reporting success', async () => {
    // Nothing about this test environment is a Docker stack, so preflight must refuse.
    // The route previously answered 200 "Update started" regardless, which is what left
    // a client polling for a restart that was never going to happen.
    const res = await request(app)
      .post('/api/admin/update')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

    expect(res.status).toBe(409);
    expect(typeof res.body.error).toBe('string');
    expect(res.body.error.length).toBeGreaterThan(0);
    expect(res.body.message).toBeUndefined();
  });

  it('POST /update refuses a temporary admin', async () => {
    // Rejected at 401 by the middleware, which turns away a temporary token unless the
    // user has been elevated — the route's own isTemporary guard is the second line,
    // for an elevated temporary who gets past that.
    const tempToken = jwt.sign(
      { id: 2, username: 'temp', role: 'admin', isTemporary: true },
      'test-secret'
    );
    const res = await request(app)
      .post('/api/admin/update')
      .set('Authorization', `Bearer ${tempToken}`);
    expect(res.status).toBe(401);
  });

  it('POST /update refuses with no token at all', async () => {
    const res = await request(app).post('/api/admin/update');
    expect(res.status).toBe(401);
  });
});

// ─── check-update ─────────────────────────────────────────────────────────────

/**
 * The route where three of this branch's faults lived: an unanchored tag filter, a
 * comparator that returned NaN, and a "different" test that counted a downgrade as an
 * update. Each was fixed in the module and each is tested there — but the module was
 * always correct in isolation, and it was the route's use of it that shipped broken.
 */
describe('POST /api/admin/check-update', () => {
  /** Stand in for the Docker Hub tag listing. */
  const withTags = (names) => {
    const body = JSON.stringify({ results: names.map((name) => ({ name })) });
    return vi.spyOn(https, 'request').mockImplementation((options, cb) => {
      const handlers = {};
      const upstream = { on: (evt, fn) => { handlers[evt] = fn; return upstream; } };
      const req = {
        on: () => req,
        end: () => {
          cb(upstream);
          process.nextTick(() => { handlers.data?.(body); handlers.end?.(); });
        },
      };
      return req;
    });
  };

  const check = () => request(app)
    .post('/api/admin/check-update')
    .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

  const withChannel = async (tag, fn) => {
    const prev = process.env.IMAGE_TAG;
    const prevVersion = process.env.APP_VERSION;
    if (tag === undefined) delete process.env.IMAGE_TAG;
    else process.env.IMAGE_TAG = tag;
    try {
      return await fn();
    } finally {
      if (prev === undefined) delete process.env.IMAGE_TAG;
      else process.env.IMAGE_TAG = prev;
      if (prevVersion === undefined) delete process.env.APP_VERSION;
      else process.env.APP_VERSION = prevVersion;
    }
  };

  afterEach(() => vi.restoreAllMocks());

  it('offers a newer stable release', async () => {
    withTags(['1.8.0', '1.8.1', 'latest']);
    await withChannel(undefined, async () => {
      process.env.APP_VERSION = '1.8.0';
      const res = await check();
      expect(res.body.hasUpdate).toBe(true);
      expect(res.body.latest).toBe('1.8.1');
    });
  });

  it('does not offer a downgrade when the registry trails the running build', async () => {
    // The reported symptom: a 1.8.0 instance told "Update available: 1.8.0 → 1.7.4".
    withTags(['1.7.4', '1.7.3', 'latest']);
    await withChannel(undefined, async () => {
      process.env.APP_VERSION = '1.8.0';
      const res = await check();
      expect(res.body.hasUpdate).toBe(false);
      expect(res.body.message).toMatch(/up to date/i);
    });
  });

  it('a dev tag on the registry does not hide a stable release', async () => {
    // The fault that would have appeared on the first dev tag published, and would have
    // hurt stable users: the unanchored filter let 1.9.0-dev through, it parsed to NaN,
    // the comparator returned NaN, the sort order became undefined, and a prerelease
    // could surface as "latest" — which the version check then correctly refused,
    // reporting no update when there was one.
    withTags(['1.8.0', '1.9.0-dev.3', '1.8.1', 'latest']);
    await withChannel(undefined, async () => {
      process.env.APP_VERSION = '1.8.0';
      const res = await check();
      expect(res.body.hasUpdate).toBe(true);
      expect(res.body.latest).toBe('1.8.1');
    });
  });

  it('ignores dev builds on the stable channel', async () => {
    withTags(['1.8.1', '1.9.0-dev', 'latest']);
    await withChannel('latest', async () => {
      process.env.APP_VERSION = '1.8.1';
      const res = await check();
      expect(res.body.hasUpdate).toBe(false);
    });
  });

  it('offers dev builds when the deployment runs the dev images', async () => {
    // Same registry, same running version, different channel — and the channel comes
    // from the tag compose pulls, so what is offered cannot diverge from what installs.
    withTags(['1.8.1', '1.9.0-dev', 'latest']);
    await withChannel('dev', async () => {
      process.env.APP_VERSION = '1.8.1';
      const res = await check();
      expect(res.body.hasUpdate).toBe(true);
      expect(res.body.latest).toBe('1.9.0-dev');
    });
  });

  it('carries a dev deployment onto the release when it lands', async () => {
    withTags(['1.9.0', '1.9.0-dev.7', 'latest']);
    await withChannel('dev', async () => {
      process.env.APP_VERSION = '1.9.0-dev.7';
      const res = await check();
      expect(res.body.hasUpdate).toBe(true);
      expect(res.body.latest).toBe('1.9.0');
    });
  });

  it('offers nothing when the registry has no version tags at all', async () => {
    withTags(['latest', 'dev']);
    await withChannel(undefined, async () => {
      process.env.APP_VERSION = '1.8.1';
      const res = await check();
      expect(res.body.hasUpdate).toBe(false);
    });
  });
});
