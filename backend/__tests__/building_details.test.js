/**
 * A building's photo and the GM's notes on it.
 *
 * The notes are the part worth defending hardest. They are written about the players, so
 * the one outcome that matters is a player reading them - through the notes route with a
 * player's or a granted editor's token, or by the notes turning up in the location list
 * every player downloads. Both are tried here and both must fail.
 *
 * Also that nothing here disturbs what a building already has: the ordinary save leaves
 * the photo alone, and a saved map or an undone delete brings every column back.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { makeTestDb, get, run } from './helpers/testDb.js';
import locationsRouteFactory from '../routes/locations.js';
import detailsRouteFactory from '../routes/buildingDetails.js';
import mapsRouteFactory from '../routes/maps.js';

process.env.JWT_SECRET = 'test-secret';

const require_ = createRequire(import.meta.url);
const { insertLocations } = require_('../buildings/locationRows');
const { elevatedUsers } = require_('../middleware/auth');

const ADMIN = jwt.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, 'test-secret');
/** A player the GM granted editing rights: passes `authenticate`, must not read notes. */
const EDITOR = jwt.sign({ username: 'ghost', isTemporary: true }, 'test-secret');
const auth = (t) => ({ Authorization: `Bearer ${t}` });

const PHOTOS = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../uploads/building_photos');

const makeApp = (db) => {
  const app = express();
  app.use(express.json());
  const helpers = { emitUpdate: () => {}, recordAction: () => {} };
  const io = { emit: () => {} };
  app.use('/api/locations/:id', detailsRouteFactory(db, io, helpers));
  app.use('/api/locations', locationsRouteFactory(db, io, helpers));
  app.use('/api/maps', mapsRouteFactory(db, io, helpers));
  return app;
};

let db;
let app;
let bar;
/** Photo files this run created, removed afterwards so the real uploads folder stays clean. */
const created = [];

beforeEach(async () => {
  // A granted editor only gets past sign-in while the GM's grant stands, so the tests
  // below reach the main-admin check rather than bouncing off an expired grant.
  elevatedUsers.add('ghost');
  db = await makeTestDb();
  app = makeApp(db);
  const r = await run(db, `INSERT INTO locations (name, description, npcs, x, y, z, shape) VALUES ('The Afterlife', 'A bar', 'Rogue', 0, 0, 0, 'box')`);
  bar = r.lastID;
});

afterEach(() => {
  elevatedUsers.delete('ghost');
  for (const f of created.splice(0)) { try { fs.unlinkSync(f); } catch { /* already gone */ } }
});

const writeNotes = (text, token = ADMIN) =>
  request(app).put(`/api/locations/${bar}/gm-notes`).set(auth(token)).send({ notes: text });

describe('GM notes', () => {
  it('are kept and read back by the GM', async () => {
    expect((await writeNotes('Rogue is skimming the take.')).status).toBe(200);
    const res = await request(app).get(`/api/locations/${bar}/gm-notes`).set(auth(ADMIN));
    expect(res.body).toMatchObject({ notes: 'Rogue is skimming the take.' });
  });

  it('cannot be read or written without signing in', async () => {
    await writeNotes('secret');
    expect((await request(app).get(`/api/locations/${bar}/gm-notes`)).status).toBe(401);
    expect((await request(app).put(`/api/locations/${bar}/gm-notes`).send({ notes: 'x' })).status).toBe(401);
  });

  it('cannot be read or written by a player the GM granted editing rights', async () => {
    // The temporary token passes the ordinary sign-in check, which is the trap.
    await writeNotes('secret');
    const read = await request(app).get(`/api/locations/${bar}/gm-notes`).set(auth(EDITOR));
    expect(read.status).toBe(403);
    expect(JSON.stringify(read.body)).not.toContain('secret');
    expect((await writeNotes('overwritten', EDITOR)).status).toBe(403);
    expect((await get(db, 'SELECT notes FROM location_gm_notes WHERE location_id = ?', [bar])).notes).toBe('secret');
  });

  it('never appear in the location list every player downloads', async () => {
    await writeNotes('The owner is a Militech plant.');
    for (const headers of [{}, auth(ADMIN)]) {
      const res = await request(app).get('/api/locations').set(headers);
      expect(res.status).toBe(200);
      expect(JSON.stringify(res.body)).not.toContain('Militech plant');
    }
  });

  it('are cleared by saving them blank, leaving no empty row behind', async () => {
    await writeNotes('something');
    await writeNotes('   ');
    expect(await get(db, 'SELECT * FROM location_gm_notes WHERE location_id = ?', [bar])).toBeUndefined();
  });

  it('refuse something that is not text, or too long', async () => {
    expect((await request(app).put(`/api/locations/${bar}/gm-notes`).set(auth(ADMIN)).send({ notes: 5 })).status).toBe(400);
    expect((await writeNotes('x'.repeat(20001))).status).toBe(413);
  });

  it('are refused for a building that does not exist', async () => {
    expect((await request(app).get('/api/locations/99999/gm-notes').set(auth(ADMIN))).status).toBe(404);
  });
});

describe('a building photo', () => {
  // A real one-pixel PNG, so nothing downstream is handed a file that is not an image.
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const upload = (name = 'front.png', token = ADMIN, body = PNG) =>
    request(app).post(`/api/locations/${bar}/photo`).set(auth(token)).attach('photo', body, name);

  it('is stored and set on the building', async () => {
    const res = await upload();
    expect(res.status).toBe(200);
    expect(res.body.photo_url).toMatch(/^\/uploads\/building_photos\/[0-9a-f]{64}\.png$/);
    const file = path.join(PHOTOS, path.basename(res.body.photo_url));
    created.push(file);
    expect(fs.existsSync(file)).toBe(true);
    expect((await get(db, 'SELECT photo_url FROM locations WHERE id = ?', [bar])).photo_url).toBe(res.body.photo_url);
  });

  it('refuses a file that is not a picture', async () => {
    // /uploads is public and served by extension, so this is the one that matters.
    const res = await upload('front.html', ADMIN, Buffer.from('<script>alert(1)</script>'));
    expect(res.status).toBe(400);
    expect((await get(db, 'SELECT photo_url FROM locations WHERE id = ?', [bar])).photo_url).toBeNull();
  });

  it('is the main admin\'s to set, not a granted editor\'s', async () => {
    expect((await upload('front.png', EDITOR)).status).toBe(403);
  });

  it('comes off the building on remove, leaving the file for saved maps that use it', async () => {
    const { body } = await upload();
    const file = path.join(PHOTOS, path.basename(body.photo_url));
    created.push(file);
    const res = await request(app).delete(`/api/locations/${bar}/photo`).set(auth(ADMIN));
    expect(res.status).toBe(200);
    expect((await get(db, 'SELECT photo_url FROM locations WHERE id = ?', [bar])).photo_url).toBeNull();
    expect(fs.existsSync(file)).toBe(true);
  });

  it('survives the ordinary building save, which does not know about it', async () => {
    const { body } = await upload();
    created.push(path.join(PHOTOS, path.basename(body.photo_url)));
    const res = await request(app).put(`/api/locations/${bar}`).set(auth(ADMIN))
      .send({ name: 'The Afterlife', description: 'Renamed nothing', x: 0, y: 0, z: 0, width: 1, height: 1, depth: 1 });
    expect(res.status).toBe(200);
    expect((await get(db, 'SELECT photo_url FROM locations WHERE id = ?', [bar])).photo_url).toBe(body.photo_url);
  });
});

describe('what a building already has', () => {
  it('is untouched by the new column: existing fields read back exactly', async () => {
    const row = await get(db, 'SELECT name, description, npcs, photo_url FROM locations WHERE id = ?', [bar]);
    expect(row).toEqual({ name: 'The Afterlife', description: 'A bar', npcs: 'Rogue', photo_url: null });
  });

  it('comes back whole when a deleted building is restored', async () => {
    // The undo path used a hand-kept list of columns that predated building types,
    // buy-back rates and photos, and dropped all three.
    await run(db, `UPDATE locations SET building_type = 'gun_shop', buyback_pct = 30, photo_url = '/uploads/building_photos/a.png', melee_ac = 14 WHERE id = ?`, [bar]);
    const before = await get(db, 'SELECT * FROM locations WHERE id = ?', [bar]);
    await run(db, 'DELETE FROM locations WHERE id = ?', [bar]);

    await new Promise((res, rej) => insertLocations(db, [before], {}, (e) => (e ? rej(e) : res())));
    expect(await get(db, 'SELECT * FROM locations WHERE id = ?', [bar])).toEqual(before);
  });
});

describe('saved maps', () => {
  const save = (name) => request(app).post('/api/maps/save').set(auth(ADMIN)).send({ name });
  const load = (name) => request(app).post(`/api/maps/load/${name}`).set(auth(ADMIN));
  const notesOf = async (id) => (await get(db, 'SELECT notes FROM location_gm_notes WHERE location_id = ?', [id]))?.notes;

  beforeEach(async () => {
    await run(db, `UPDATE locations SET building_type = 'gun_shop', buyback_pct = 30, photo_url = '/uploads/building_photos/a.png' WHERE id = ?`, [bar]);
    await writeNotes('Vic owes the Tyger Claws.');
  });

  it('bring a building back with every column, photo and type included', async () => {
    // Loading used to drop the type and buy-back rate of every shop on the map.
    expect((await save('night-city')).status).toBe(200);
    await run(db, `UPDATE locations SET building_type = NULL, buyback_pct = NULL, photo_url = NULL WHERE id = ?`, [bar]);
    expect((await load('night-city')).status).toBe(200);
    expect(await get(db, 'SELECT building_type, buyback_pct, photo_url FROM locations WHERE id = ?', [bar]))
      .toEqual({ building_type: 'gun_shop', buyback_pct: 30, photo_url: '/uploads/building_photos/a.png' });
  });

  it('carry the GM notes and put them back with the buildings', async () => {
    await save('night-city');
    await writeNotes('changed after saving');
    await load('night-city');
    expect(await notesOf(bar)).toBe('Vic owes the Tyger Claws.');
  });

  it('do not leave one map\'s notes on another map\'s building with the same id', async () => {
    // A map saved before notes traveled has none; loading it must not keep ours.
    await run(db,
      `INSERT INTO saved_maps (name, locations_data) VALUES ('old-map', ?)`,
      [JSON.stringify([{ id: bar, name: 'Somewhere Else', x: 0, y: 0, z: 0, shape: 'box' }])]);
    await load('old-map');
    expect((await get(db, 'SELECT name FROM locations WHERE id = ?', [bar])).name).toBe('Somewhere Else');
    expect(await notesOf(bar)).toBeUndefined();
  });

  it('never list the notes in the public map list', async () => {
    await save('night-city');
    const res = await request(app).get('/api/maps');
    expect(JSON.stringify(res.body)).not.toContain('Tyger Claws');
  });

  it('clear the notes when the map is cleared, before the ids come round again', async () => {
    await request(app).post('/api/maps/clear').set(auth(ADMIN));
    expect(await notesOf(bar)).toBeUndefined();
  });
});
