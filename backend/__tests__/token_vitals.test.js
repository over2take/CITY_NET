import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
import { makeTestDb, get, all, run } from './helpers/testDb.js';
import { drain } from './helpers/until.js';

/**
 * A token's health, defense and injuries, per game system.
 *
 * The map is shared by every system, but a character's state belongs to its game. The token's
 * own columns hold the running system's values - so combat, damage and the health monitor are
 * untouched - and switching systems swaps them with the others', in one transaction together
 * with the system setting itself.
 */

process.env.JWT_SECRET = 'test-secret';
const require_ = createRequire(import.meta.url);
const vitals = require_('../tokens/vitals');
const { migrateTokenVitals, MARKER } = require_('../startup/tokenVitals');

const CWN = 'cities_without_number';
const CPR = 'cyberpunk_red';
const quiet = { log: () => {}, warn: () => {} };
const GM = jwt.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, 'test-secret');

let db;
beforeEach(async () => {
  db = await makeTestDb();
  await run(db, `INSERT INTO global_settings (key, value) VALUES ('game_system', ?)`, [CWN]);
});
afterEach(() => { vitals.setReady(Promise.resolve()); vi.restoreAllMocks(); });

const addToken = async (shape, { owner = null, hp = null, max = null, temp = null, ac = null, rac = null, injuries = '{}' } = {}) => (await run(db,
  `INSERT INTO locations (name, x, y, z, shape, owner, hp_current, hp_max, hp_temp, melee_ac, ranged_ac, injuries)
   VALUES (?, 0, 0, 0, ?, ?, ?, ?, ?, ?, ?, ?)`,
  [shape.toUpperCase(), shape, owner, hp, max, temp, ac, rac, injuries])).lastID;
const tokenOf = (id) => get(db, 'SELECT hp_current, hp_max, hp_temp, melee_ac, ranged_ac, injuries FROM locations WHERE id = ?', [id]);
const running = async () => (await get(db, `SELECT value FROM global_settings WHERE key = 'game_system'`)).value;
const BLANK = { hp_current: null, hp_max: null, hp_temp: null, melee_ac: null, ranged_ac: null, injuries: '{}' };

describe('switching systems', () => {
  it("puts each token's values away and brings the new system's back, and back again", async () => {
    const ghost = await addToken('rhombus', { owner: 'GHOST', hp: 7, max: 12, temp: 2, ac: 14, rac: 13, injuries: '{"head":true}' });
    const cwnValues = await tokenOf(ghost);

    expect(await vitals.switchSystem(db, CPR)).toMatchObject({ from: CWN, to: CPR, switched: true });
    expect(await running()).toBe(CPR);
    expect(await tokenOf(ghost)).toEqual(BLANK);

    // Play in Cyberpunk RED changes that game's values only.
    await run(db, 'UPDATE locations SET hp_current = 30, hp_max = 40 WHERE id = ?', [ghost]);

    await vitals.switchSystem(db, CWN);
    expect(await tokenOf(ghost)).toEqual(cwnValues);
    await vitals.switchSystem(db, CPR);
    expect(await tokenOf(ghost)).toMatchObject({ hp_current: 30, hp_max: 40 });
  });

  it('carries enemy and friendly tokens the same way', async () => {
    const enemy = await addToken('enemy_rhombus', { hp: 5, max: 9, ac: 12 });
    const friend = await addToken('friendly_rhombus', { hp: 3, max: 3 });
    await vitals.switchSystem(db, CPR);
    expect(await tokenOf(enemy)).toEqual(BLANK);
    expect(await tokenOf(friend)).toEqual(BLANK);
    await vitals.switchSystem(db, CWN);
    expect(await tokenOf(enemy)).toMatchObject({ hp_current: 5, hp_max: 9, melee_ac: 12 });
    expect(await tokenOf(friend)).toMatchObject({ hp_current: 3, hp_max: 3 });
  });

  it('leaves buildings alone', async () => {
    const building = (await run(db, `INSERT INTO locations (name, x, y, z, shape, hp_current, melee_ac) VALUES ('BUNKER', 0, 0, 0, 'box', 50, 18)`)).lastID;
    await vitals.switchSystem(db, CPR);
    expect(await get(db, 'SELECT hp_current, melee_ac FROM locations WHERE id = ?', [building])).toEqual({ hp_current: 50, melee_ac: 18 });
    expect(await all(db, 'SELECT * FROM token_vitals WHERE location_id = ?', [building])).toEqual([]);
  });

  it('switching to the system already running changes nothing', async () => {
    const ghost = await addToken('rhombus', { owner: 'GHOST', hp: 7, max: 12 });
    expect(await vitals.switchSystem(db, CWN)).toMatchObject({ switched: false, tokens: 0 });
    expect(await tokenOf(ghost)).toMatchObject({ hp_current: 7, hp_max: 12 });
    expect(await all(db, 'SELECT * FROM token_vitals')).toEqual([]);
  });

  it('happens entirely or not at all', async () => {
    const ghost = await addToken('rhombus', { owner: 'GHOST', hp: 7, max: 12 });
    await run(db, `CREATE TRIGGER refuse BEFORE UPDATE ON locations BEGIN SELECT RAISE(ABORT, 'refused'); END`);
    await expect(vitals.switchSystem(db, CPR)).rejects.toThrow('refused');
    expect(await running()).toBe(CWN);
    expect(await tokenOf(ghost)).toMatchObject({ hp_current: 7, hp_max: 12 });
    expect(await all(db, 'SELECT * FROM token_vitals')).toEqual([]);
    await run(db, 'DROP TRIGGER refuse');
    expect((await vitals.switchSystem(db, CPR)).switched).toBe(true);
  });

  it('waits for the one-time start to finish', async () => {
    let finish;
    vitals.setReady(new Promise((resolve) => { finish = resolve; }));
    let done = false;
    const pending = vitals.switchSystem(db, CPR).then(() => { done = true; });
    await drain(db);
    expect(done).toBe(false);
    expect(await running()).toBe(CWN);
    finish();
    await pending;
    expect(await running()).toBe(CPR);
  });
});

describe('the one-time start', () => {
  const sheet = (username, system, isNpc = 0) => run(db,
    `INSERT INTO character_sheets (username, system, data, is_npc) VALUES (?, ?, '{}', ?)`, [username, system, isNpc]);
  const savedFor = async (id) => (await all(db, 'SELECT system FROM token_vitals WHERE location_id = ? ORDER BY system', [id])).map((r) => r.system);

  it("saves a player's token under every system they have a sheet in, and the running one", async () => {
    await sheet('GHOST', CPR);
    await sheet('GHOST', 'shadowrun_6e');
    const ghost = await addToken('rhombus', { owner: 'GHOST', hp: 7, max: 12, ac: 14 });
    await migrateTokenVitals(db, { log: quiet });
    expect(await savedFor(ghost)).toEqual([CWN, CPR, 'shadowrun_6e'].sort());
    expect(await get(db, 'SELECT hp_current, hp_max, melee_ac FROM token_vitals WHERE location_id = ? AND system = ?', [ghost, CPR]))
      .toEqual({ hp_current: 7, hp_max: 12, melee_ac: 14 });
  });

  it('saves an enemy or friendly token under every system in use, NPC sheets included', async () => {
    await sheet('GHOST', CPR);
    await sheet('gm', 'shadowrun_6e', 1);
    const enemy = await addToken('enemy_rhombus', { hp: 5 });
    await migrateTokenVitals(db, { log: quiet });
    expect(await savedFor(enemy)).toEqual([CWN, CPR, 'shadowrun_6e'].sort());
  });

  it('so that switching afterwards shows exactly what it showed before', async () => {
    await sheet('GHOST', CPR);
    const ghost = await addToken('rhombus', { owner: 'GHOST', hp: 7, max: 12, injuries: '{"arm":true}' });
    const before = await tokenOf(ghost);
    await migrateTokenVitals(db, { log: quiet });
    await vitals.switchSystem(db, CPR);
    expect(await tokenOf(ghost)).toEqual(before);
  });

  it('changes no token, and runs once', async () => {
    const ghost = await addToken('rhombus', { owner: 'GHOST', hp: 7 });
    const before = await tokenOf(ghost);
    expect((await migrateTokenVitals(db, { log: quiet })).ran).toBe(true);
    expect(await tokenOf(ghost)).toEqual(before);
    expect(await get(db, 'SELECT value FROM global_settings WHERE key = ?', [MARKER])).toBeTruthy();
    expect(await migrateTokenVitals(db, { log: quiet })).toEqual({ ran: false });
  });
});

describe('map clears and loads', () => {
  it("keep the players' saved values and drop every other token's", async () => {
    const ghost = await addToken('rhombus', { owner: 'GHOST', hp: 7 });
    const enemy = await addToken('enemy_rhombus', { hp: 5 });
    await vitals.switchSystem(db, CPR);
    await run(db, 'DELETE FROM locations WHERE id = ?', [enemy]);
    await new Promise((resolve) => vitals.pruneAfterMapChange(db, resolve));
    expect((await all(db, 'SELECT location_id FROM token_vitals')).map((r) => r.location_id)).toEqual([ghost]);
  });

  it('through the real clear route', async () => {
    const mapsRoute = require_('../routes/maps.js');
    const app = express();
    app.use(express.json());
    app.use('/api/maps', mapsRoute(db, { emit: () => {} }, { emitUpdate: () => {}, recordAction: () => {} }));
    await addToken('rhombus', { owner: 'GHOST', hp: 7 });
    const enemy = await addToken('enemy_rhombus', { hp: 5 });
    await vitals.switchSystem(db, CPR);
    expect(await all(db, 'SELECT * FROM token_vitals WHERE location_id = ?', [enemy])).toHaveLength(1);
    expect((await request(app).post('/api/maps/clear').set('Authorization', `Bearer ${GM}`)).status).toBe(200);
    await drain(db);
    expect(await all(db, 'SELECT * FROM token_vitals WHERE location_id = ?', [enemy])).toEqual([]);
  });
});

describe('the routes', () => {
  const makeApp = (emitted) => {
    const app = express();
    app.use(express.json());
    const io = { emit: (event, data) => emitted.push({ event, data }), to: () => ({ emit: () => {} }) };
    app.use('/api/sheets', require_('../routes/sheets.js')(db, io));
    app.use('/api', require_('../routes/admin.js')(db, io, { emitUpdate: () => {}, recordAction: () => {} }));
    return app;
  };

  it('the system picker switches tokens with the system and has every screen redraw', async () => {
    const emitted = [];
    const app = makeApp(emitted);
    const ghost = await addToken('rhombus', { owner: 'GHOST', hp: 7 });
    const res = await request(app).put('/api/sheets/system').set('Authorization', `Bearer ${GM}`).send({ system: CPR });
    expect(res.status).toBe(200);
    expect(await running()).toBe(CPR);
    expect((await tokenOf(ghost)).hp_current).toBeNull();
    expect(emitted.map((e) => e.event)).toEqual(expect.arrayContaining(['gameSystemChanged', 'dataUpdated']));
    expect(emitted.find((e) => e.event === 'dataUpdated').data).toEqual({ isRhombusOnly: true });
  });

  it('the generic settings route cannot change the system or the migration markers', async () => {
    const app = makeApp([]);
    for (const key of ['game_system', 'migration_bank_accounts', 'migration_token_vitals']) {
      const res = await request(app).post('/api/settings').set('Authorization', `Bearer ${GM}`).send({ key, value: 'x' });
      expect(res.status, key).toBe(400);
    }
    expect(await running()).toBe(CWN);
    // Everything else still goes through as before.
    expect((await request(app).post('/api/settings').set('Authorization', `Bearer ${GM}`).send({ key: 'buyback_pct', value: '50' })).status).toBe(200);
  });
});

describe('the real startup path', () => {
  it("saves an existing server's token health when db.js opens it", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'citynet-tokens-'));
    const file = path.join(dir, 'city.db');
    try {
      // The backend's own folder, however the checkout is named. Matching a folder name instead
      // passed on a Windows checkout under F:\MapSystem and cleared nothing on the CI runner,
      // whose path has no such name - so the second open got the first, closed connection.
      const backendDir = path.dirname(require_.resolve('../db.js'));
      const script = `
        const path = require('path');
        const backendDir = ${JSON.stringify(backendDir)};
        const ours = (k) => k.startsWith(backendDir + path.sep) && !k.includes(path.sep + 'node_modules' + path.sep);
        process.env.DB_PATH = ${JSON.stringify(file)};
        console.log = () => {}; console.warn = () => {};
        // First open: a 1.14.4-era database is made, with a token carrying health.
        const first = require(${JSON.stringify(require_.resolve('../db.js'))});
        // Its own startup work first (the one-time moves run after the tables exist), so
        // nothing of it is still running when this connection closes. That includes the admin
        // seed: it waits on a bcrypt hash, and on a slow runner its INSERT landed after close()
        // and killed the process with "Database is closed".
        const adminSeeded = () => new Promise((resolve, reject) => {
          const started = Date.now();
          const poll = () => first.get('SELECT COUNT(*) AS n FROM admin', (err, row) => {
            if (!err && row && row.n > 0) return resolve();
            if (Date.now() - started > 30000) return reject(new Error('admin was never seeded'));
            setTimeout(poll, 20);
          });
          poll();
        });
        require(${JSON.stringify(require_.resolve('../tokens/vitals.js'))}).whenReady().then(adminSeeded).then(() => {
        first.serialize(() => {
          first.run("DELETE FROM global_settings WHERE key = 'migration_token_vitals'");
          first.run("INSERT OR REPLACE INTO global_settings (key, value) VALUES ('game_system', '${CWN}')");
          first.run("INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('GHOST', '${CPR}', '{}', 0)");
          first.run("INSERT INTO locations (name, x, y, z, shape, owner, hp_current, hp_max, melee_ac) VALUES ('GHOST', 0, 0, 0, 'rhombus', 'GHOST', 7, 12, 14)");
          first.run("DELETE FROM token_vitals");
        });
        first.close(() => {
          // Second open, as after updating: the start runs, then a switch keeps the health.
          const cleared = Object.keys(require.cache).filter(ours);
          if (!cleared.some((k) => k.endsWith(path.sep + 'db.js'))) {
            process.stdout.write(JSON.stringify({ err: 'db.js was not cleared from the module cache' }), () => process.exit(0));
            return;
          }
          for (const k of cleared) delete require.cache[k];
          const db = require(${JSON.stringify(require_.resolve('../db.js'))});
          const vitals = require(${JSON.stringify(require_.resolve('../tokens/vitals.js'))});
          vitals.switchSystem(db, '${CPR}').then(() => {
            db.get("SELECT hp_current, hp_max, melee_ac FROM locations WHERE owner = 'GHOST'", (err, row) => {
              process.stdout.write(JSON.stringify({ err: err && err.message, row }), () => process.exit(0));
            });
          }, (e) => { process.stdout.write(JSON.stringify({ err: e.message }), () => process.exit(0)); });
        });
        });`;
      const out = JSON.parse(execFileSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 60000 }));
      expect(out).toEqual({ err: null, row: { hp_current: 7, hp_max: 12, melee_ac: 14 } });
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
