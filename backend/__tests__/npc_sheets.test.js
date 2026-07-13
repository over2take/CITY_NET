import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { makeTestDb, get, all, run } from './helpers/testDb.js';
import sheetsRouteFactory from '../routes/sheets.js';

const ADMIN_TOKEN = jwt.sign(
  { id: 1, username: 'admin', role: 'admin', isTemporary: false },
  'test-secret'
);
const PLAYER_TOKEN = jwt.sign(
  { username: 'ghost', role: 'player' },
  'test-secret'
);

let db;
let app;
let emitted;

const makeApp = (database) => {
  const application = express();
  application.use(express.json());
  emitted = [];
  const io = { emit: (event, payload) => emitted.push({ event, payload }) };
  application.use('/api/sheets', sheetsRouteFactory(database, io));
  return application;
};

const setSystem = (database, system) =>
  run(database, `INSERT INTO global_settings (key, value) VALUES ('game_system', ?)`, [system]);

beforeEach(async () => {
  db = await makeTestDb();
  app = makeApp(db);
  await setSystem(db, 'cyberpunk_red');
});

// ─── GET /api/sheets/npcs ─────────────────────────────────────────────────────

describe('GET /api/sheets/npcs', () => {
  it('returns NPC list for admin', async () => {
    await run(db, `INSERT INTO character_sheets (username, system, data, is_npc, npc_label, folder) VALUES ('admin','cyberpunk_red','{}',1,'Gang Member','Gangs')`);
    const res = await request(app).get('/api/sheets/npcs').set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].npc_label).toBe('Gang Member');
    expect(res.body[0].folder).toBe('Gangs');
  });

  it('rejects player tokens', async () => {
    const res = await request(app).get('/api/sheets/npcs').set('Authorization', `Bearer ${PLAYER_TOKEN}`);
    expect(res.status).toBe(403);
  });

  it('only returns NPCs on the active system', async () => {
    await run(db, `INSERT INTO character_sheets (username, system, data, is_npc, npc_label) VALUES ('admin','cyberpunk_red','{}',1,'CPR NPC')`);
    await run(db, `INSERT INTO character_sheets (username, system, data, is_npc, npc_label) VALUES ('admin','generic','{}',1,'Generic NPC')`);
    const res = await request(app).get('/api/sheets/npcs').set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].npc_label).toBe('CPR NPC');
  });
});

// ─── POST /api/sheets/npcs ────────────────────────────────────────────────────

describe('POST /api/sheets/npcs', () => {
  it('creates an NPC sheet', async () => {
    const res = await request(app)
      .post('/api/sheets/npcs')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ npc_label: 'Fixer', folder: 'Contacts' });
    expect(res.status).toBe(200);
    expect(res.body.id).toBeGreaterThan(0);
    expect(res.body.npc_label).toBe('Fixer');
    expect(res.body.folder).toBe('Contacts');
    const row = await get(db, `SELECT * FROM character_sheets WHERE id = ?`, [res.body.id]);
    expect(row.is_npc).toBe(1);
    expect(row.system).toBe('cyberpunk_red');
  });

  it('requires npc_label', async () => {
    const res = await request(app)
      .post('/api/sheets/npcs')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({});
    expect(res.status).toBe(400);
  });
});

// ─── DELETE /api/sheets/npcs/:id ─────────────────────────────────────────────

describe('DELETE /api/sheets/npcs/:id', () => {
  it('deletes the NPC', async () => {
    const { lastID } = await run(db, `INSERT INTO character_sheets (username, system, data, is_npc, npc_label) VALUES ('admin','cyberpunk_red','{}',1,'Gang Member')`);
    const res = await request(app).delete(`/api/sheets/npcs/${lastID}`).set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
    const row = await get(db, `SELECT * FROM character_sheets WHERE id = ?`, [lastID]);
    expect(row).toBeUndefined();
  });

  it('404s for unknown id', async () => {
    const res = await request(app).delete('/api/sheets/npcs/9999').set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(404);
  });
});

// ─── POST /api/sheets/npcs/:id/link ──────────────────────────────────────────

describe('POST /api/sheets/npcs/:id/link', () => {
  it('links an NPC sheet to a location and emits npcLinkChanged', async () => {
    await run(db, `INSERT INTO locations (id, name, x, y, z, width, height, depth, shape) VALUES (42, 'hostile', 0, 0, 0, 1, 1, 1, 'enemy_rhombus')`);
    const { lastID } = await run(db, `INSERT INTO character_sheets (username, system, data, is_npc, npc_label) VALUES ('admin','cyberpunk_red','{}',1,'Goon')`);
    const res = await request(app)
      .post(`/api/sheets/npcs/${lastID}/link`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ location_id: 42 });
    expect(res.status).toBe(200);
    const link = await get(db, `SELECT * FROM npc_sheet_links WHERE location_id = 42`);
    expect(link.sheet_id).toBe(lastID);
    const evt = emitted.find(e => e.event === 'npcLinkChanged');
    expect(evt?.payload).toEqual({ location_id: 42, sheet_id: lastID });
  });

  it('re-attaches when already linked (upsert)', async () => {
    await run(db, `INSERT INTO locations (id, name, x, y, z, width, height, depth, shape) VALUES (43, 'hostile', 0, 0, 0, 1, 1, 1, 'enemy_rhombus')`);
    const { lastID: id1 } = await run(db, `INSERT INTO character_sheets (username, system, data, is_npc, npc_label) VALUES ('admin','cyberpunk_red','{}',1,'NPC1')`);
    const { lastID: id2 } = await run(db, `INSERT INTO character_sheets (username, system, data, is_npc, npc_label) VALUES ('admin','cyberpunk_red','{}',1,'NPC2')`);
    await request(app).post(`/api/sheets/npcs/${id1}/link`).set('Authorization', `Bearer ${ADMIN_TOKEN}`).send({ location_id: 43 });
    const res = await request(app).post(`/api/sheets/npcs/${id2}/link`).set('Authorization', `Bearer ${ADMIN_TOKEN}`).send({ location_id: 43 });
    expect(res.status).toBe(200);
    const link = await get(db, `SELECT sheet_id FROM npc_sheet_links WHERE location_id = 43`);
    expect(link.sheet_id).toBe(id2);
  });
});

// ─── DELETE /api/sheets/npcs/:id/link/:location_id ───────────────────────────

describe('ATTACH stamps melee DV from the sheet', () => {
  it('sets the token melee_ac to 6 + DEX + Evasion on link', async () => {
    const npc = await run(db,
      `INSERT INTO character_sheets (username, system, data, is_npc, npc_label) VALUES ('admin', 'cyberpunk_red', '{"dex":6,"evasion":4}', 1, 'Guy')`);
    await run(db,
      `INSERT INTO locations (id, name, x, y, z, shape, melee_ac) VALUES (77, 'Guy', 0, 0, 0, 'enemy_rhombus', 10)`);
    const res = await request(app)
      .post(`/api/sheets/npcs/${npc.lastID}/link`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ location_id: 77 });
    expect(res.status).toBe(200);
    const loc = await get(db, `SELECT melee_ac FROM locations WHERE id = 77`);
    expect(loc.melee_ac).toBe(16);
  });

  it('take-10 setting raises the stamped melee DV base to 10', async () => {
    await run(db, `INSERT INTO global_settings (key, value) VALUES ('melee_dv_take10', '1')`);
    const npc = await run(db,
      `INSERT INTO character_sheets (username, system, data, is_npc, npc_label) VALUES ('admin', 'cyberpunk_red', '{"dex":6,"evasion":4}', 1, 'Guy')`);
    await run(db,
      `INSERT INTO locations (id, name, x, y, z, shape, melee_ac) VALUES (78, 'Guy', 0, 0, 0, 'enemy_rhombus', 10)`);
    await request(app)
      .post(`/api/sheets/npcs/${npc.lastID}/link`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ location_id: 78 });
    const loc = await get(db, `SELECT melee_ac FROM locations WHERE id = 78`);
    expect(loc.melee_ac).toBe(20);
  });
});

describe('DELETE /api/sheets/npcs/:id/link/:location_id', () => {
  it('unlinks NPC from location and emits npcLinkChanged', async () => {
    await run(db, `INSERT INTO locations (id, name, x, y, z, width, height, depth, shape) VALUES (44, 'hostile', 0, 0, 0, 1, 1, 1, 'enemy_rhombus')`);
    const { lastID } = await run(db, `INSERT INTO character_sheets (username, system, data, is_npc, npc_label) VALUES ('admin','cyberpunk_red','{}',1,'Goon')`);
    await run(db, `INSERT INTO npc_sheet_links (location_id, sheet_id) VALUES (44, ?)`, [lastID]);
    const res = await request(app)
      .delete(`/api/sheets/npcs/${lastID}/link/44`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
    const link = await get(db, `SELECT * FROM npc_sheet_links WHERE location_id = 44`);
    expect(link).toBeUndefined();
    const evt = emitted.find(e => e.event === 'npcLinkChanged');
    expect(evt?.payload).toEqual({ location_id: 44, sheet_id: null });
  });
});

// ─── POST /api/sheets/reset-luck ─────────────────────────────────────────────

describe('POST /api/sheets/reset-luck', () => {
  it('resets luck to luck_max for all player sheets', async () => {
    await run(db, `INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('ghost','cyberpunk_red','{"luck":2,"luck_max":5}',0)`);
    await run(db, `INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('pyro','cyberpunk_red','{"luck":0,"luck_max":3}',0)`);
    const res = await request(app).post('/api/sheets/reset-luck').set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.reset).toBe(2);
    const ghost = await get(db, `SELECT data FROM character_sheets WHERE username = 'ghost'`);
    expect(JSON.parse(ghost.data).luck).toBe(5);
    const pyro = await get(db, `SELECT data FROM character_sheets WHERE username = 'pyro'`);
    expect(JSON.parse(pyro.data).luck).toBe(3);
  });

  it('skips sheets with no luck_max defined', async () => {
    await run(db, `INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('nobody','cyberpunk_red','{"luck":1}',0)`);
    const res = await request(app).post('/api/sheets/reset-luck').set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.reset).toBe(0);
  });

  it('skips NPC sheets', async () => {
    await run(db, `INSERT INTO character_sheets (username, system, data, is_npc, npc_label) VALUES ('admin','cyberpunk_red','{"luck":1,"luck_max":6}',1,'Boss')`);
    const res = await request(app).post('/api/sheets/reset-luck').set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.reset).toBe(0);
  });

  it('returns reason when system has no luckField', async () => {
    await run(db, `UPDATE global_settings SET value = 'generic' WHERE key = 'game_system'`);
    const res = await request(app).post('/api/sheets/reset-luck').set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.reset).toBe(0);
    expect(res.body.reason).toBeTruthy();
  });

  it('rejects non-admin requests', async () => {
    const res = await request(app).post('/api/sheets/reset-luck').set('Authorization', `Bearer ${PLAYER_TOKEN}`);
    expect(res.status).toBe(403);
  });

  it('emits sheetUpdated for each reset sheet', async () => {
    await run(db, `INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('ghost','cyberpunk_red','{"luck":1,"luck_max":4}',0)`);
    emitted = [];
    await request(app).post('/api/sheets/reset-luck').set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    const updates = emitted.filter(e => e.event === 'sheetUpdated');
    expect(updates).toHaveLength(1);
    expect(updates[0].payload).toEqual({ username: 'ghost' });
  });
});

// ─── NPC sheet HP linking ─────────────────────────────────────────────────────

describe('GET /api/sheets/npcs/:id token HP overlay', () => {
  it('overlays the linked token HP onto the sheet data', async () => {
    const npc = await run(db,
      `INSERT INTO character_sheets (username, system, data, is_npc, npc_label) VALUES ('admin', 'cyberpunk_red', '{"sp_body":6}', 1, 'Guy')`);
    const loc = await run(db,
      `INSERT INTO locations (name, x, y, z, shape, owner, hp_current, hp_max) VALUES ('Guy', 0, 0, 0, 'enemy_rhombus', 'SYSTEM', 21, 35)`);
    await run(db, `INSERT INTO npc_sheet_links (location_id, sheet_id) VALUES (?, ?)`, [loc.lastID, npc.lastID]);

    const res = await request(app)
      .get(`/api/sheets/npcs/${npc.lastID}`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.data.hp).toBe(21);
    expect(res.body.data.hp_max).toBe(35);
    expect(res.body.data.sp_body).toBe(6);
  });

  it('leaves stored data alone when the sheet is not linked to a token', async () => {
    const npc = await run(db,
      `INSERT INTO character_sheets (username, system, data, is_npc, npc_label) VALUES ('admin', 'cyberpunk_red', '{"hp":9}', 1, 'Loner')`);
    const res = await request(app)
      .get(`/api/sheets/npcs/${npc.lastID}`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.data.hp).toBe(9);
  });

  it('PUT refuses to store linked HP fields in the sheet JSON', async () => {
    const npc = await run(db,
      `INSERT INTO character_sheets (username, system, data, is_npc, npc_label) VALUES ('admin', 'cyberpunk_red', '{}', 1, 'Guy')`);
    const res = await request(app)
      .put(`/api/sheets/npcs/${npc.lastID}`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`)
      .send({ fields: { hp: 99, hp_max: 99, sp_body: 4 } });
    expect(res.status).toBe(200);
    const row = await get(db, `SELECT data FROM character_sheets WHERE id = ?`, [npc.lastID]);
    const data = JSON.parse(row.data);
    expect(data.hp).toBeUndefined();
    expect(data.hp_max).toBeUndefined();
    expect(data.sp_body).toBe(4);
  });
});
