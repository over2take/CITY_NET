/**
 * CWN stim heal: PUT /api/locations/:id/health with action 'stim_heal'
 * heals AND adds +1 System Strain to the token's CWN sheet; a maxed-strain
 * character gets no stim benefit (409, no heal).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { makeTestDb, get, run } from './helpers/testDb.js';

process.env.JWT_SECRET = 'test-secret';

const locationsFactory = (await import('../routes/locations.js')).default;

let db, app, io;
beforeEach(async () => {
  db = await makeTestDb();
  await run(db, `INSERT INTO global_settings (key, value) VALUES ('game_system', 'cities_without_number')`);
  io = { emit: vi.fn() };
  app = express();
  app.use(express.json());
  app.use('/api/locations', locationsFactory(db, io, { emitUpdate: vi.fn(), recordAction: vi.fn() }));
});

const seed = async (strain, strainMax) => {
  await run(db,
    `INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('GHOST', 'cities_without_number', ?, 0)`,
    [JSON.stringify({ system_strain: strain, system_strain_max: strainMax })]);
  const loc = await run(db,
    `INSERT INTO locations (name, x, y, z, shape, owner, hp_current, hp_max) VALUES ('GHOST', 0, 0, 0, 'rhombus', 'GHOST', 5, 20)`);
  return loc.lastID;
};

describe('CWN stim heal', () => {
  it('heals and adds +1 strain', async () => {
    const id = await seed(2, 10);
    const res = await request(app).put(`/api/locations/${id}/health`).send({ action: 'stim_heal', amount: 8 });
    expect(res.status).toBe(200);
    expect(res.body.hp_current).toBe(13);
    const sheet = await get(db, `SELECT data FROM character_sheets WHERE username = 'GHOST'`);
    expect(JSON.parse(sheet.data).system_strain).toBe(3);
  });

  it('refuses at max strain - no heal, no strain change', async () => {
    const id = await seed(10, 10);
    const res = await request(app).put(`/api/locations/${id}/health`).send({ action: 'stim_heal', amount: 8 });
    expect(res.status).toBe(409);
    expect(res.body.error).toContain('STRAIN MAXED');
    const token = await get(db, `SELECT hp_current FROM locations WHERE id = ?`, [id]);
    expect(token.hp_current).toBe(5); // unhealed
    const sheet = await get(db, `SELECT data FROM character_sheets WHERE username = 'GHOST'`);
    expect(JSON.parse(sheet.data).system_strain).toBe(10);
  });

  it('falls back to a plain heal when the token has no CWN sheet', async () => {
    const loc = await run(db,
      `INSERT INTO locations (name, x, y, z, shape, owner, hp_current, hp_max) VALUES ('LONER', 0, 0, 0, 'rhombus', 'LONER', 5, 20)`);
    const res = await request(app).put(`/api/locations/${loc.lastID}/health`).send({ action: 'stim_heal', amount: 5 });
    expect(res.status).toBe(200);
    expect(res.body.hp_current).toBe(10);
  });

  it('is a plain heal while another system is active (isolation)', async () => {
    await run(db, `UPDATE global_settings SET value = 'cyberpunk_red' WHERE key = 'game_system'`);
    const id = await seed(2, 10);
    const res = await request(app).put(`/api/locations/${id}/health`).send({ action: 'stim_heal', amount: 8 });
    expect(res.status).toBe(200);
    expect(res.body.hp_current).toBe(13);
    const sheet = await get(db, `SELECT data FROM character_sheets WHERE username = 'GHOST'`);
    expect(JSON.parse(sheet.data).system_strain).toBe(2); // untouched
  });
});
