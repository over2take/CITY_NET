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
import { makeTestDb, run } from './helpers/testDb.js';
import battleMapsFactory from '../routes/battle_maps.js';

const require = createRequire(import.meta.url);
const { describeRejection, LIMITS, MB } = require('../middleware/uploadConstraints.js');

process.env.JWT_SECRET = 'test-secret';

const ADMIN_TOKEN = jwt.sign(
  { id: 1, username: 'admin', role: 'admin', isTemporary: false },
  'test-secret'
);

let db;
let app;

beforeEach(async () => {
  db = await makeTestDb();
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
  const oversized = () => Buffer.alloc(LIMITS.battle_map + 1024, 1);

  it('is refused as JSON, not as an HTML error page', async () => {
    // The actual bug: this used to reach Express's default handler. The client did
    // `await res.json()` on HTML and reported a syntax error to the user.
    const res = await request(app)
      .post('/api/locations/1/battle_maps')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .field('designation', 'GROUND')
      .attach('image', oversized(), { filename: 'huge.png' });

    expect(res.status).toBe(413);
    expect(res.headers['content-type']).toMatch(/json/);
    expect(res.body.reason).toBe('FILE_TOO_LARGE');
  });

  it('names the file it refused, and the limit it broke', async () => {
    // multer aborts before any handler runs and its error carries only the form field, so
    // the name is recorded on the way in. Without that, "too large" names nothing.
    const res = await request(app)
      .post('/api/locations/1/battle_maps')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .field('designation', 'GROUND')
      .attach('image', oversized(), { filename: 'enormous-map.webm' });

    expect(res.body.error).toContain('enormous-map.webm');
    expect(res.body.error).toContain('25.0MB');
  });

  it('tells the client the machine-readable limit too', async () => {
    // So an interface can show the ceiling without restating the number itself.
    const res = await request(app)
      .post('/api/locations/1/battle_maps')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .field('designation', 'GROUND')
      .attach('image', oversized(), { filename: 'huge.png' });

    expect(res.body.maxBytes).toBe(LIMITS.battle_map);
    expect(res.body.allowed).toContain('.png');
  });

  it('writes nothing when it refuses', async () => {
    await request(app)
      .post('/api/locations/1/battle_maps')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .field('designation', 'GROUND')
      .attach('image', oversized(), { filename: 'huge.png' });

    const rows = await new Promise((resolve) => db.all('SELECT * FROM battle_maps', (_e, r) => resolve(r || [])));
    expect(rows).toHaveLength(0);
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
