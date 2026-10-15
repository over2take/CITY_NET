import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { vi } from 'vitest';
import { makeTestDb, get, all, run } from './helpers/testDb.js';
import adminRouteFactory from '../routes/admin.js';
import { makeRecordAction } from '../history.js';
import { until } from './helpers/until.js';
import { createRequire } from 'module';

// The same object the route holds. An ESM default import of a CJS module is not
// necessarily that object, so a spy on it would attach to a copy and never fire.
const updater = createRequire(import.meta.url)('../updater.js');

process.env.JWT_SECRET = 'test-secret';

const ADMIN_TOKEN = jwt.sign(
  { id: 1, username: 'testadmin', role: 'admin', isTemporary: false },
  'test-secret'
);

const makeApp = (db) => {
  const app = express();
  app.use(express.json());
  const io = { emit: () => {} };
  app.use('/api/admin', adminRouteFactory(db, io, { emitUpdate: () => {}, recordAction: makeRecordAction(db) }));
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
    const row = await until(() => get(db, `SELECT * FROM action_history WHERE type = 'water_create'`),
      { label: 'water_create recorded' });
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

  it('GET /update/status publishes no log to the open internet', async () => {
    // It used to answer with the last forty lines of update.log - compose output, host
    // paths, absolute directories - on a route with no auth, and nothing displayed them.
    const res = await request(app).get('/api/admin/update/status');
    expect(res.body).not.toHaveProperty('log');
  });

  it('POST /update refuses a second press while one is already running', async () => {
    // Two presses used to mean two `compose pull` runs and two privileged helper
    // containers against the same stack.
    vi.spyOn(updater, 'isRunning').mockReturnValue(true);
    const spawnIt = vi.spyOn(updater, 'runUpdate');

    const res = await request(app)
      .post('/api/admin/update')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already running/i);
    expect(spawnIt).not.toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('POST /update refuses when the run starts between the check and the spawn', async () => {
    // The route's check and runUpdate's own guard are not one atomic step. The guard
    // inside runUpdate is the one that actually holds, and the route has to honour it
    // rather than reporting a success that never started.
    vi.spyOn(updater, 'isRunning').mockReturnValue(false);
    vi.spyOn(updater, 'preflight').mockReturnValue({ ok: true, labels: { workingDir: '/x', configFile: '/x/y.yml' } });
    vi.spyOn(updater, 'runUpdate').mockReturnValue(null);

    const res = await request(app)
      .post('/api/admin/update')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);

    expect(res.status).toBe(409);
    expect(res.body.message).toBeUndefined();
    vi.restoreAllMocks();
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

// ─── release channel (LOOK FOR DEV BUILDS) ───────────────────────────────────

/** The wiring of the box's two routes; updateChannel.test.js covers what a switch does. */
describe('release channel routes', () => {
  const updateChannel = createRequire(import.meta.url)('../updateChannel.js');
  const READY = { ok: true, labels: { workingDir: '/opt/citynet', configFile: '/opt/citynet/docker-compose.yml', projectName: 'citynet' } };
  let was;
  beforeEach(() => { was = process.env.IMAGE_TAG; });
  afterEach(() => {
    vi.restoreAllMocks();
    if (was === undefined) delete process.env.IMAGE_TAG; else process.env.IMAGE_TAG = was;
  });
  const put = (body, token = ADMIN_TOKEN) => request(app).put('/api/admin/update/channel').set('Authorization', `Bearer ${token}`).send(body);

  it('GET says which channel this is, and that a stack without docker cannot switch, with the line to set by hand', async () => {
    process.env.IMAGE_TAG = 'dev';
    const res = await request(app).get('/api/admin/update/channel').set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ channel: 'dev', dev: true, canSwitch: false });
    expect(res.body.manual).toMatch(/IMAGE_TAG=dev/);
  });

  it('GET reads a stack that can switch as one that can', async () => {
    delete process.env.IMAGE_TAG;
    vi.spyOn(updater, 'preflight').mockReturnValue(READY);
    const res = await request(app).get('/api/admin/update/channel').set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.body).toEqual({ channel: 'latest', dev: false, canSwitch: true });
  });

  it('PUT switches through updateChannel and tells the copy by name only', async () => {
    vi.spyOn(updater, 'preflight').mockReturnValue(READY);
    const switched = vi.spyOn(updateChannel, 'switchChannel').mockResolvedValue({ channel: 'dev', backup: '/app/data/city.db.before-dev-builds-2026-10-14T21-05-09.bak' });
    const res = await put({ dev: true });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ channel: 'dev', dev: true, backup: 'city.db.before-dev-builds-2026-10-14T21-05-09.bak' });
    expect(switched).toHaveBeenCalledWith(expect.objectContaining({ tag: 'dev', labels: READY.labels }));
    await put({ dev: false });
    expect(switched).toHaveBeenLastCalledWith(expect.objectContaining({ tag: 'latest' }));
  });

  it('PUT answers a switch that failed as one that did not happen', async () => {
    vi.spyOn(updater, 'preflight').mockReturnValue(READY);
    vi.spyOn(updateChannel, 'switchChannel').mockRejectedValue(new Error('the channel helper exited with code 1'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await put({ dev: true });
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/Nothing was switched/);
  });

  it('PUT refuses where the app cannot switch, saying what to set by hand', async () => {
    const switched = vi.spyOn(updateChannel, 'switchChannel');
    const res = await put({ dev: true });
    expect(res.status).toBe(409);
    expect(res.body.manual).toMatch(/IMAGE_TAG=dev/);
    expect(switched).not.toHaveBeenCalled();
  });

  it('PUT refuses while an update is running, and anything but true or false', async () => {
    const switched = vi.spyOn(updateChannel, 'switchChannel');
    expect((await put({ dev: 'yes' })).status).toBe(400);
    expect((await put({})).status).toBe(400);
    vi.spyOn(updater, 'preflight').mockReturnValue(READY);
    vi.spyOn(updater, 'isRunning').mockReturnValue(true);
    expect((await put({ dev: true })).status).toBe(409);
    expect(switched).not.toHaveBeenCalled();
  });

  it('only the primary admin, signed in', async () => {
    const tempToken = jwt.sign({ id: 2, username: 'temp', role: 'admin', isTemporary: true }, 'test-secret');
    expect((await put({ dev: true }, tempToken)).status).toBe(401);
    expect((await request(app).get('/api/admin/update/channel').set('Authorization', `Bearer ${tempToken}`)).status).toBe(401);
    expect((await request(app).put('/api/admin/update/channel').send({ dev: true })).status).toBe(401);
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
  /**
   * Stand in for the Docker Hub tag listing.
   *
   * Stubs `fetch`, which is what the request goes through now that it belongs to
   * `net/outbound`. This used to stub the `https` module, and when the transport changed
   * underneath it the stub silently stopped applying — leaving these tests talking to the
   * real Docker Hub and passing because the real answer happened to agree with them.
   */
  const withTags = (names) => {
    const body = JSON.stringify({ results: names.map((name) => ({ name })) });
    return vi.spyOn(globalThis, 'fetch').mockImplementation(async () => ({
      status: 200,
      ok: true,
      text: async () => body,
    }));
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
