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
