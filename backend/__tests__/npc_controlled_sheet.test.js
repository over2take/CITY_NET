/**
 * A friendly NPC's sheet, read-only, for the player the GM gave it to (4b5b2; asked for by the
 * user 2026-10-07). Only that player, by their own login, or the GM and editors; never an enemy,
 * never another player; the token's HP and armor filled in as on the GM's window; nothing written.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createRequire } from 'module';
import { makeTestDb, run, get } from './helpers/testDb.js';

process.env.JWT_SECRET = 'test-secret';
const require_ = createRequire(import.meta.url);
const sheetsRoute = require_('../routes/sheets.js');
const { elevatedUsers } = require_('../middleware/auth');

const sign = (payload) => jwt.sign(payload, 'test-secret');
const GM = sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false });
const EDITOR = sign({ username: 'ghost', isTemporary: true });
const VEX = sign({ username: 'vex', role: 'player' });
const ASH = sign({ username: 'ash', role: 'player' });

let db;
let app;
let dog;
let ghoul;
let bare;

const npc = async (shape, controllers, data, system = 'cities_without_number') => {
  const loc = (await run(db, `INSERT INTO locations (name, x, y, z, shape, owner, controllers, hp_current, hp_max, melee_ac)
    VALUES ('NPC', 0, 0, 0, ?, 'gm', ?, 7, 12, 14)`, [shape, controllers])).lastID;
  if (data) {
    const sheet = (await run(db, `INSERT INTO character_sheets (username, system, data, is_npc, npc_label) VALUES ('gm', ?, ?, 1, 'Dog')`,
      [system, JSON.stringify(data)])).lastID;
    await run(db, 'INSERT INTO npc_sheet_links (location_id, sheet_id) VALUES (?, ?)', [loc, sheet]);
  }
  return loc;
};

beforeEach(async () => {
  db = await makeTestDb();
  await run(db, `INSERT OR REPLACE INTO global_settings (key, value) VALUES ('game_system', 'cities_without_number')`);
  app = express();
  app.use(express.json());
  app.use('/api/sheets', sheetsRoute(db, { emit: () => {}, to: () => ({ emit: () => {} }) }));
  dog = await npc('friendly_rhombus', JSON.stringify({ all: false, users: ['vex'] }), { name: 'Rex', str: 14, notes: 'Bites' });
  ghoul = await npc('enemy_rhombus', JSON.stringify({ all: true, users: ['vex'] }), { name: 'Ghoul', str: 16 });
  bare = await npc('friendly_rhombus', JSON.stringify({ all: true, users: [] }), null);
});
afterEach(() => elevatedUsers.delete('ghost'));

const read = (id, token) => request(app).get(`/api/sheets/npcs/controlled/${id}`).set(token ? { Authorization: `Bearer ${token}` } : {});

describe('reading a controlled NPC\'s sheet', () => {
  it('gives the player the GM named the sheet, with the token\'s HP and armor filled in', async () => {
    const res = await read(dog, VEX);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ system: 'cities_without_number', npc_label: 'Dog', is_npc: 1 });
    expect(res.body.data).toMatchObject({ name: 'Rex', str: 14, notes: 'Bites', hp: 7, hp_max: 12, ac: 14 });
  });

  it('refuses another player, and anyone signed out', async () => {
    expect(await read(dog, ASH)).toMatchObject({ status: 403, body: { error: 'Only the GM, or a player the GM gave this NPC to' } });
    expect((await read(dog)).status).toBe(401);
  });

  it('never gives a player an enemy\'s sheet, whatever its grant says', async () => {
    expect((await read(ghoul, VEX)).status).toBe(403);
  });

  it('gives it to the GM and a granted editor too', async () => {
    elevatedUsers.add('ghost');
    expect((await read(ghoul, GM)).status).toBe(200);
    expect((await read(dog, EDITOR)).body.data.name).toBe('Rex');
  });

  it('says when the token isn\'t there or has no sheet yet', async () => {
    expect((await read(9999, VEX)).status).toBe(404);
    expect(await read(bare, VEX)).toMatchObject({ status: 404, body: { error: 'This NPC has no sheet yet' } });
  });

  it('only reads the running system\'s sheet', async () => {
    await run(db, `UPDATE global_settings SET value = 'cyberpunk_red' WHERE key = 'game_system'`);
    expect((await read(dog, VEX)).status).toBe(404);
  });

  it('changes nothing', async () => {
    const before = await get(db, 'SELECT data FROM character_sheets WHERE npc_label = ? AND json_extract(data, \'$.name\') = ?', ['Dog', 'Rex']);
    await read(dog, VEX);
    expect(await get(db, 'SELECT data FROM character_sheets WHERE npc_label = ? AND json_extract(data, \'$.name\') = ?', ['Dog', 'Rex'])).toEqual(before);
  });
});
