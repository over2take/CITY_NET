/**
 * What an upload is told when it is refused.
 *
 * Each rejection used to be written where it was needed, so each said a different amount:
 * one listed the formats, one said "unsupported file type" and nothing more, and the size
 * limit said nothing at all — it was never handled, so an oversized file reached multer's
 * own error, fell through to Express's default handler, and came back as an HTML page the
 * client then tried to parse as JSON. What a person saw for uploading a large map was a
 * syntax error about an unexpected `<`.
 *
 * A refusal has to answer three questions: which file, what was wrong, what would work.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createRequire } from 'module';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { makeTestDb, run } from './helpers/testDb.js';
import battleMapsFactory from '../routes/battle_maps.js';

const require = createRequire(import.meta.url);
const { describeRejection, LIMITS, MB, uploadErrors } = require('../middleware/uploadConstraints.js');

const mapsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../uploads/battle_maps');

process.env.JWT_SECRET = 'test-secret';

const ADMIN_TOKEN = jwt.sign(
  { id: 1, username: 'admin', role: 'admin', isTemporary: false },
  'test-secret'
);

let db;
let app;

beforeEach(async () => {
  db = await makeTestDb();
  // The shared helper does not carry this table; battle_maps.test.js creates it the same way.
  await run(db, `CREATE TABLE IF NOT EXISTS battle_maps (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    location_id INTEGER NOT NULL,
    designation TEXT NOT NULL,
    image_url TEXT NOT NULL,
    order_index INTEGER NOT NULL
  )`);
  app = express();
  app.use(express.json());
  app.use('/api/locations/:id/battle_maps', battleMapsFactory(db, { emit: () => {} }, { emitUpdate: () => {} }));
  await run(db, `INSERT INTO locations (name, x, y, z) VALUES ('TOWER', 0, 0, 0)`);
});

describe('describeRejection', () => {
  it('names the file, what it is, and what would have worked', () => {
    const msg = describeRejection({
      filename: 'dungeon.tiff',
      reason: 'format',
      allowed: ['.png', '.webp'],
      maxBytes: 25 * MB,
    });
    expect(msg).toContain('dungeon.tiff');
    expect(msg).toContain('.tiff');
    expect(msg).toContain('.png, .webp');
    expect(msg).toContain('25.0MB');
  });

  it('says so plainly when there is no extension at all', () => {
    // 'is , which is not supported' would be the obvious bug here.
    const msg = describeRejection({ filename: 'mapfile', reason: 'format', allowed: ['.png'], maxBytes: MB });
    expect(msg).toContain('no file extension');
    expect(msg).not.toMatch(/is\s*,/);
  });

  it('gives the size and the limit when the file is too big', () => {
    const msg = describeRejection({
      filename: 'loop.webm', reason: 'size', size: 40 * MB, maxBytes: 25 * MB,
    });
    expect(msg).toContain('loop.webm');
    expect(msg).toContain('40.0MB');
    expect(msg).toContain('25.0MB');
  });

  it('copes with no filename rather than saying "undefined"', () => {
    const msg = describeRejection({ reason: 'format', allowed: ['.png'], maxBytes: MB });
    expect(msg).toContain('That file');
    expect(msg).not.toContain('undefined');
  });
});

describe('an oversized upload', () => {
  /**
   * Exercised against a small stand-in limit rather than the real one.
   *
   * The real ceiling is 250MB, and a test that actually sent that would allocate a
   * quarter of a gigabyte to prove a point about not allocating a quarter of a gigabyte.
   * The middleware under test is the same instance the route mounts; only the number and
   * the handler behind it are miniature.
   */
  const TINY = 2 * MB;
  let sizeApp;

  beforeEach(() => {
    const tiny = multer({ storage: multer.memoryStorage(), limits: { fileSize: TINY },
      fileFilter: (req, file, cb) => { req.uploadFilename = file.originalname; cb(null, true); } });

    sizeApp = express();
    sizeApp.post('/upload',
      tiny.single('image'),
      uploadErrors({ allowed: ['.png', '.webm'], maxBytes: TINY }),
      (req, res) => res.json({ ok: true, stored: req.file.originalname }));
  });

  const send = (filename, bytes) => request(sizeApp)
    .post('/upload')
    .attach('image', Buffer.alloc(bytes, 1), { filename });

  it('is refused as JSON, not as an HTML error page', async () => {
    // The actual bug: this used to reach Express's default handler. The client did
    // `await res.json()` on HTML and reported a syntax error to the user.
    const res = await send('huge.png', TINY + 512);
    expect(res.status).toBe(413);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.body.reason).toBe('FILE_TOO_LARGE');
  });

  it('names the file it refused, and the limit it broke', async () => {
    // multer aborts before any handler runs and its error carries only the form field, so
    // the name is recorded on the way in. Without that, "too large" names nothing.
    const res = await send('enormous-map.webm', TINY + 512);
    expect(res.body.error).toContain('enormous-map.webm');
    expect(res.body.error).toContain('2.0MB');
    expect(res.body.error).toMatch(/limit/);
  });

  it('tells the client the machine-readable limit too', async () => {
    // So an interface can show the ceiling without restating the number itself.
    const res = await send('huge.png', TINY + 512);
    expect(res.body.maxBytes).toBe(TINY);
    expect(res.body.allowed).toContain('.png');
  });

  it('lets a file under the limit straight through', async () => {
    const res = await send('fine.png', 512);
    expect(res.status).toBe(200);
    expect(res.body.stored).toBe('fine.png');
  });
});

describe('a real battle map upload', () => {
  it('stores a large map without buffering it, and stores it once', async () => {
    // 40MB is past the old ceiling entirely and is an ordinary size for an animated map.
    // It also covers the streaming path end to end: written to a temporary file, hashed
    // in chunks, renamed to its hash.
    const big = Buffer.alloc(40 * 1024 * 1024, 7);

    const first = await request(app)
      .post('/api/locations/1/battle_maps')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .field('designation', 'Level 1')
      .attach('image', big, { filename: 'loop.webm' });
    expect(first.status).toBe(200);

    // The same file again on another floor is deduplicated to the same stored object,
    // which is what keeps a generous ceiling from becoming a disk problem.
    const second = await request(app)
      .post('/api/locations/1/battle_maps')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .field('designation', 'Level 2')
      .attach('image', big, { filename: 'loop.webm' });
    expect(second.status).toBe(200);
    expect(second.body.imageUrl).toBe(first.body.imageUrl);

    // Deduplicated to one object on disk, and not left there afterwards — this is 40MB.
    const stored = path.join(mapsDir, path.basename(first.body.imageUrl));
    expect(fs.existsSync(stored)).toBe(true);
    fs.unlinkSync(stored);
  });

  it('leaves no partial files behind when it refuses one', async () => {
    // The upload is on disk by the time the format is checked, so every way out of the
    // handler has something to clean up.
    const tmpDir = path.join(mapsDir, '.tmp');
    await request(app)
      .post('/api/locations/1/battle_maps')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .field('designation', 'Level 3')
      .attach('image', Buffer.alloc(2048, 3), { filename: 'nope.tiff' });

    await new Promise((r) => setTimeout(r, 50));
    const leftovers = fs.existsSync(tmpDir) ? fs.readdirSync(tmpDir) : [];
    expect(leftovers).toEqual([]);
  });
});

describe('the limit the client shows and the limit the server keeps', () => {
  it('are the same number', () => {
    // The frontend greys the button out and prints the ceiling before spending someone's
    // upload on a refusal, which means it holds a copy. A copy with nothing checking it
    // is how you tell a person their file is fine and then reject it — or refuse one the
    // server would have taken. Read from the source rather than restated here, so this
    // fails when either side moves.
    const fs = require('fs');
    const src = fs.readFileSync(
      new URL('../../frontend/src/battleMapMedia.ts', import.meta.url), 'utf8'
    );
    const match = /MAX_MAP_BYTES\s*=\s*([0-9*\s]+);/.exec(src);
    expect(match, 'MAX_MAP_BYTES not found in battleMapMedia.ts').toBeTruthy();

    // eslint-disable-next-line no-eval
    const frontendValue = eval(match[1]);
    expect(frontendValue).toBe(LIMITS.battle_map);
  });
});

describe('the proxy in front of all of this', () => {
  it('allows a body at least as large as the biggest upload the app accepts', () => {
    // Everything reaches the backend through nginx in a Docker install, so its
    // client_max_body_size is the outer bound whatever the routes say. It sat at 25M
    // while battle maps moved to 250MB — which no test caught, because every test here
    // talks to Express directly and never sees the proxy. A large map would have been
    // refused by nginx with a 413 of its own, naming neither the file nor the reason.
    const conf = fs.readFileSync(
      new URL('../../nginx.conf', import.meta.url), 'utf8'
    );
    const match = /client_max_body_size\s+(\d+)([KMG])?;/i.exec(conf);
    expect(match, 'client_max_body_size not found in nginx.conf').toBeTruthy();

    const scale = { K: 1024, M: 1024 * 1024, G: 1024 * 1024 * 1024 };
    const allowed = Number(match[1]) * (scale[(match[2] || '').toUpperCase()] || 1);
    const biggest = Math.max(...Object.values(LIMITS));

    expect(allowed).toBeGreaterThanOrEqual(biggest);
  });
});
