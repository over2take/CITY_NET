/**
 * MAX set by hand (8s4a; the user, 2026-11-24: "update their max health on level up or unexpected condition", and "a test for
 * changing max and healing up to the new max, also taking damage and making sure max stays the expected value"). Through
 * the token's health route, as the sheet's strip and the HEALTH window send it: in a game where MAX is the number typed,
 * it is that number; where a formula works it out, what was typed is kept as an ADJUST over the formula, and stays.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createRequire } from 'module';
import { makeTestDb, get, run } from './helpers/testDb.js';
import locationsRouteFactory from '../routes/locations.js';

process.env.JWT_SECRET = 'test-secret';
const require_ = createRequire(import.meta.url);
const runtime = require_('../systemBuilder/runtime');
const { PICKS_KEY } = require_('../systemBuilder/choices');
const { ADJUST_KEY, adjustOf, withMaxSet, syncTokenMax } = require_('../systemBuilder/tokenMax');

const sign = (payload) => jwt.sign(payload, 'test-secret');
const GM = sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false });
const KES = sign({ username: 'kes', role: 'player' });

const ID = 'sys_maxsetmaxsetmaxs';
const KEEP = {
  format: 1, name: 'Max Set Keep', core: { health: { model: 'pool' } },
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'con', label: 'Constitution' }] }],
  derived: [{ id: 'con_mod', label: 'CON mod', formula: 'floor(@con / 2)' }],
  choices: [{ id: 'classes', one: 'Class', many: 'Classes', levelled: true, options: [{ id: 'fighter', label: 'Fighter' }] }],
  levels: { health: { how: 'formula', formula: '10 + @con_mod * @level' } },
};
const AS_IS = { ...KEEP, name: 'Max Set As Is', levels: { health: { how: 'as_is' } } };
const sheet = (con, level = 3) => ({ con, [PICKS_KEY]: { classes: [{ option: 'fighter', level }] } });

describe('the ADJUST', () => {
  it('what was typed less the formula, none where it lands on it; nothing where MAX is the number typed', () => {
    expect(withMaxSet(KEEP, sheet(10), 30)[ADJUST_KEY]).toBe(5);
    expect(withMaxSet(KEEP, sheet(10), 21)[ADJUST_KEY]).toBe(-4);
    expect(withMaxSet(KEEP, { ...sheet(10), [ADJUST_KEY]: 5 }, 25)).not.toHaveProperty(ADJUST_KEY);
    expect(withMaxSet(KEEP, sheet(10), 30.4)[ADJUST_KEY]).toBe(5);
    expect(withMaxSet(AS_IS, sheet(10), 30)).toBeNull();
    expect(adjustOf({ [ADJUST_KEY]: 3 })).toBe(3);
    for (const bad of [{ [ADJUST_KEY]: 'x' }, { [ADJUST_KEY]: 1.5 }, {}, null]) expect(adjustOf(bad)).toBe(0);
  });
});

describe('at the table', () => {
  let db;
  let app;
  const was = process.env.SECURE_MODE;
  const install = async (definition) => {
    const text = JSON.stringify(definition);
    await run(db, `INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)
      ON CONFLICT(id) DO UPDATE SET draft = excluded.draft, published = excluded.published`, [ID, definition.name, text, text]);
    await new Promise((resolve) => runtime.load(db, resolve));
  };
  const health = (body, token = KES, id = 1) => request(app).put(`/api/locations/${id}/health`).set({ Authorization: `Bearer ${token}` }).send(body);
  const tokenOf = () => get(db, 'SELECT hp_current, hp_max FROM locations WHERE id = 1');
  const dataOf = async () => JSON.parse((await get(db, `SELECT data FROM character_sheets WHERE username = 'kes'`)).data);
  const sync = () => new Promise((resolve) => syncTokenMax(db, ID, 'kes', resolve));
  const setSheet = (data) => run(db, `UPDATE character_sheets SET data = ? WHERE username = 'kes'`, [JSON.stringify(data)]);

  beforeEach(async () => {
    process.env.SECURE_MODE = 'true';
    db = await makeTestDb();
    await install(KEEP);
    await run(db, `INSERT INTO global_settings (key, value) VALUES ('game_system', ?)`, [ID]);
    await run(db, `INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('kes', ?, ?, 0)`, [ID, JSON.stringify(sheet(10))]);
    await run(db, `INSERT INTO locations (id, name, x, y, z, shape, owner, hp_current, hp_max, hp_temp) VALUES (1, 'Kes', 0, 0, 0, 'rhombus', 'kes', 25, 25, 0)`);
    await run(db, `INSERT INTO locations (id, name, x, y, z, shape, owner, hp_current, hp_max, hp_temp) VALUES (2, 'Ghoul', 0, 0, 0, 'enemy_rhombus', 'gm', 12, 12, 0)`);
    app = express();
    app.use(express.json());
    app.use('/api/locations', locationsRouteFactory(db, { emit: () => {} }, { emitUpdate: () => {}, recordAction: () => {} }));
  });
  afterEach(() => { if (was === undefined) delete process.env.SECURE_MODE; else process.env.SECURE_MODE = was; });

  it('MAX the number typed: changed, healed up to it and no further, hurt, and MAX stays', async () => {
    await install(AS_IS);
    expect((await health({ action: 'set_max', amount: 30, hp_max: 30 })).status).toBe(200);
    expect(await tokenOf()).toEqual({ hp_current: 25, hp_max: 30 });
    await health({ action: 'heal', amount: 15 });
    expect(await tokenOf()).toEqual({ hp_current: 30, hp_max: 30 });
    await health({ action: 'damage', amount: 8 });
    expect(await tokenOf()).toEqual({ hp_current: 22, hp_max: 30 });
    // Lower than the current: the current comes down to it.
    await health({ action: 'set_max', amount: 18, hp_max: 18 });
    expect(await tokenOf()).toEqual({ hp_current: 18, hp_max: 18 });
    expect(await dataOf()).not.toHaveProperty(ADJUST_KEY);
  });

  it('MAX worked out by a formula: kept as an ADJUST; healed up to it, hurt, and MAX stays through the next change to the sheet', async () => {
    expect((await health({ action: 'set_max', amount: 30, hp_max: 30 })).status).toBe(200);
    expect((await dataOf())[ADJUST_KEY]).toBe(5);
    expect(await tokenOf()).toEqual({ hp_current: 25, hp_max: 30 });
    await health({ action: 'heal', amount: 15 });
    expect(await tokenOf()).toEqual({ hp_current: 30, hp_max: 30 });
    await health({ action: 'damage', amount: 8 });
    expect(await tokenOf()).toEqual({ hp_current: 22, hp_max: 30 });
    // The sheet worked out again: the formula and the ADJUST, where it was set.
    await sync();
    expect(await tokenOf()).toEqual({ hp_current: 22, hp_max: 30 });
    // A level up: the formula moves (10 + 5 * 4 = 30), the ADJUST still on top, the current moving with it.
    await setSheet({ ...(await dataOf()), ...sheet(10, 4) });
    await sync();
    expect(await tokenOf()).toEqual({ hp_current: 27, hp_max: 35 });
    // Set back to what the formula says: no ADJUST kept.
    await health({ action: 'set_max', amount: 30, hp_max: 30 });
    expect(await dataOf()).not.toHaveProperty(ADJUST_KEY);
    expect(await tokenOf()).toEqual({ hp_current: 27, hp_max: 30 });
    await sync();
    expect(await tokenOf()).toEqual({ hp_current: 27, hp_max: 30 });
  });

  it('lower than the formula: an ADJUST below it, the current held under the new MAX; the GM sets it the same', async () => {
    await health({ action: 'set_max', amount: 20, hp_max: 20 }, GM);
    expect((await dataOf())[ADJUST_KEY]).toBe(-5);
    expect(await tokenOf()).toEqual({ hp_current: 20, hp_max: 20 });
    await sync();
    expect(await tokenOf()).toEqual({ hp_current: 20, hp_max: 20 });
  });

  it('an NPC\'s token, another player, or a game where it won\'t work out: MAX as before, no ADJUST', async () => {
    expect((await health({ action: 'set_max', amount: 15, hp_max: 15 }, GM, 2)).status).toBe(200);
    expect(await get(db, 'SELECT hp_current, hp_max FROM locations WHERE id = 2')).toEqual({ hp_current: 12, hp_max: 15 });
    // Not a player's token, though a player's name is on it (a summon): MAX as before, their sheet untouched.
    await run(db, "INSERT INTO locations (id, name, x, y, z, shape, owner, hp_current, hp_max, hp_temp) VALUES (3, 'Wisp', 0, 0, 0, 'friendly_rhombus', 'kes', 5, 5, 0)");
    await health({ action: 'set_max', amount: 9, hp_max: 9 }, GM, 3);
    expect(await get(db, 'SELECT hp_current, hp_max FROM locations WHERE id = 3')).toEqual({ hp_current: 5, hp_max: 9 });
    expect(await dataOf()).not.toHaveProperty(ADJUST_KEY);
    expect((await health({ action: 'set_max', amount: 99, hp_max: 99 }, sign({ username: 'ash', role: 'player' }))).status).toBe(403);
    expect(await tokenOf()).toEqual({ hp_current: 25, hp_max: 25 });
    await install({ ...KEEP, derived: [{ id: 'con_mod', label: 'CON mod', formula: '@loop' }, { id: 'loop', label: 'L', formula: '@con_mod' }] });
    await health({ action: 'set_max', amount: 40, hp_max: 40 });
    expect(await dataOf()).not.toHaveProperty(ADJUST_KEY);
    expect(await tokenOf()).toEqual({ hp_current: 25, hp_max: 40 });
  });
});
