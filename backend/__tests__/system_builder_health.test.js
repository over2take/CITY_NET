import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createRequire } from 'module';
import { makeTestDb, get, run } from './helpers/testDb.js';

/**
 * A custom system's health model in play: what DAMAGE and HEAL do under each model, and the
 * HIT_POINTS route using them for a custom system while the built-in systems (and a custom
 * one-pool system) go through the route exactly as before.
 */

process.env.JWT_SECRET = 'test-secret';
const require_ = createRequire(import.meta.url);
const { applyHealthAction } = require_('../systemBuilder/health');
const runtime = require_('../systemBuilder/runtime');

const token = (current, max, temp = 0) => ({ current, max, temp });
const damage = (amount, extra = {}) => ({ kind: 'damage', amount, ...extra });
const heal = (amount, extra = {}) => ({ kind: 'heal', amount, ...extra });

const TRACKS = { model: 'tracks', tracks: [{ id: 'physical', label: 'PHYSICAL' }, { id: 'stun', label: 'STUN' }], overflow: true };
const TYPED = { model: 'typed', types: [{ id: 'superficial', label: 'S' }, { id: 'aggravated', label: 'A' }] };
const TYPED3 = { model: 'typed', types: [{ id: 'light', label: 'L' }, { id: 'heavy', label: 'H' }, { id: 'lethal', label: 'X' }] };
const HARM = { model: 'harm', levels: [{ id: 'lesser', label: 'L', slots: 2 }, { id: 'moderate', label: 'M', slots: 2 }, { id: 'severe', label: 'S', slots: 1 }] };
const WOUNDS = { model: 'wounds', count: 3, penalty: -1 };
const LOCATIONS = { model: 'locations', locations: [{ id: 'head', label: 'HEAD' }, { id: 'body', label: 'BODY' }] };

describe('one pool', () => {
  it('takes damage through temp HP first, and heals up to the max', () => {
    expect(applyHealthAction({ model: 'pool' }, token(10, 20, 3), {}, damage(5))).toMatchObject({ ok: true, token: token(8, 20, 0), out: false });
    expect(applyHealthAction({ model: 'pool' }, token(10, 20, 8), {}, damage(5)).token).toEqual(token(10, 20, 3));
    expect(applyHealthAction({ model: 'pool' }, token(2, 20), {}, damage(9))).toMatchObject({ token: token(0, 20, 0), out: true });
    expect(applyHealthAction({ model: 'pool' }, token(18, 20), {}, heal(9)).token.current).toBe(20);
  });
});

describe('two tracks', () => {
  it('damages the first track, the token, unless told otherwise', () => {
    expect(applyHealthAction(TRACKS, token(10, 10), {}, damage(4))).toMatchObject({ token: token(6, 10), sheetPatch: {} });
    expect(applyHealthAction(TRACKS, token(10, 10), {}, damage(4, { track: 'physical' })).token.current).toBe(6);
  });

  it('fills the second track on the sheet, and spills what is past its maximum into the first', () => {
    const sheet = { stun: 7, stun_max: 9 };
    expect(applyHealthAction(TRACKS, token(10, 10), sheet, damage(1, { track: 'stun' })))
      .toMatchObject({ token: token(10, 10), sheetPatch: { stun: 8 } });
    expect(applyHealthAction(TRACKS, token(10, 10, 1), sheet, damage(5, { track: 'stun' })))
      .toMatchObject({ token: token(8, 10, 0), sheetPatch: { stun: 9 }, overflow: 3 });
  });

  it('stops at the maximum without overflow, counts up with no maximum, and heals the track it is told', () => {
    const noSpill = { ...TRACKS, overflow: false };
    expect(applyHealthAction(noSpill, token(10, 10), { stun: 7, stun_max: 9 }, damage(5, { track: 'stun' })))
      .toMatchObject({ token: token(10, 10), sheetPatch: { stun: 9 } });
    expect(applyHealthAction(TRACKS, token(10, 10), {}, damage(12, { track: 'stun' })))
      .toMatchObject({ token: token(10, 10), sheetPatch: { stun: 12 } });
    expect(applyHealthAction(TRACKS, token(10, 10), { stun: 3 }, heal(5, { track: 'stun' })).sheetPatch).toEqual({ stun: 0 });
    expect(applyHealthAction(TRACKS, token(4, 10), { stun: 3 }, heal(5)).token.current).toBe(9);
  });

  it('refuses a track the system does not have', () => {
    expect(applyHealthAction(TRACKS, token(10, 10), {}, damage(1, { track: 'mana' }))).toEqual({ ok: false, error: 'Not one of this system\'s tracks' });
  });
});

describe('damage types on one track', () => {
  it('marks boxes of the type named, the lightest when none is, and the token shows the boxes left', () => {
    expect(applyHealthAction(TYPED, token(5, 5), {}, damage(2))).toMatchObject({ token: token(3, 5), sheetPatch: { superficial: 2, aggravated: 0 }, out: false });
    expect(applyHealthAction(TYPED, token(3, 5), { superficial: 2 }, damage(1, { type: 'aggravated' })).sheetPatch)
      .toEqual({ superficial: 2, aggravated: 1 });
  });

  it('turns a lighter box heavier once the track is full, and is out when every box is the heaviest', () => {
    const full = { superficial: 3, aggravated: 2 };
    expect(applyHealthAction(TYPED, token(0, 5), full, damage(2))).toMatchObject({
      token: token(0, 5), sheetPatch: { superficial: 1, aggravated: 4 }, out: false,
    });
    expect(applyHealthAction(TYPED, token(0, 5), full, damage(9))).toMatchObject({ sheetPatch: { superficial: 0, aggravated: 5 }, out: true });
    // Three types: a full track moves the lightest box one step, not straight to the heaviest.
    expect(applyHealthAction(TYPED3, token(0, 3), { light: 1, heavy: 1, lethal: 1 }, damage(1)).sheetPatch)
      .toEqual({ light: 0, heavy: 2, lethal: 1 });
  });

  it('heals the lightest marks first, or the type named', () => {
    const marks = { superficial: 2, aggravated: 2 };
    expect(applyHealthAction(TYPED, token(1, 5), marks, heal(3))).toMatchObject({ token: token(4, 5), sheetPatch: { superficial: 0, aggravated: 1 } });
    expect(applyHealthAction(TYPED, token(1, 5), marks, heal(1, { type: 'aggravated' })).sheetPatch).toEqual({ superficial: 2, aggravated: 1 });
  });

  it('needs the track to have a size, and knows its own types', () => {
    expect(applyHealthAction(TYPED, token(0, 0), {}, damage(1))).toEqual({ ok: false, error: 'Set the size of the track first' });
    expect(applyHealthAction(TYPED, token(5, 5), {}, damage(1, { type: 'fire' }))).toEqual({ ok: false, error: 'Not one of this system\'s damage types' });
  });
});

describe('harm levels', () => {
  it('writes the note in the first free slot of the level, the lowest when none is named', () => {
    expect(applyHealthAction(HARM, token(0, 0), {}, damage(0, { note: 'Bruised' }))).toMatchObject({
      token: token(4, 5), sheetPatch: { lesser_1: 'Bruised' }, out: false,
    });
    expect(applyHealthAction(HARM, token(4, 5), { lesser_1: 'Bruised' }, damage(0, { level: 'moderate', note: 'Cut' })).sheetPatch)
      .toEqual({ moderate_1: 'Cut' });
    expect(applyHealthAction(HARM, token(5, 5), {}, damage(0)).sheetPatch).toEqual({ lesser_1: 'Harm' });
  });

  it('moves harm up a level when its level is full, and is out past the top', () => {
    const sheet = { lesser_1: 'a', lesser_2: 'b', moderate_1: 'c', moderate_2: 'd' };
    expect(applyHealthAction(HARM, token(1, 5), sheet, damage(0, { note: 'Shot' }))).toMatchObject({
      token: token(0, 5), sheetPatch: { severe_1: 'Shot' }, out: false,
    });
    expect(applyHealthAction(HARM, token(0, 5), { ...sheet, severe_1: 'e' }, damage(0, { level: 'moderate', note: 'Again' })))
      .toMatchObject({ token: token(0, 5), sheetPatch: {}, out: true });
  });

  it('heals the last harm at a level, or the slot named', () => {
    const sheet = { lesser_1: 'a', lesser_2: 'b' };
    expect(applyHealthAction(HARM, token(3, 5), sheet, heal(0, { level: 'lesser' }))).toMatchObject({ token: token(4, 5), sheetPatch: { lesser_2: '' } });
    expect(applyHealthAction(HARM, token(3, 5), sheet, heal(0, { level: 'lesser', slot: 1 })).sheetPatch).toEqual({ lesser_1: '' });
    expect(applyHealthAction(HARM, token(5, 5), {}, heal(0, { level: 'moderate' }))).toEqual({ ok: false, error: 'Nothing to heal at that level' });
    expect(applyHealthAction(HARM, token(5, 5), {}, damage(0, { level: 'mortal' }))).toEqual({ ok: false, error: 'Not one of this system\'s harm levels' });
  });
});

describe('wound count', () => {
  it('takes wounds off what is left, and says the penalty for the wounds taken', () => {
    expect(applyHealthAction(WOUNDS, token(3, 3), {}, damage(2))).toMatchObject({ token: token(1, 3), penalty: -2, out: false });
    expect(applyHealthAction(WOUNDS, token(1, 3), {}, damage(5))).toMatchObject({ token: token(0, 3), penalty: -3, out: true });
    expect(applyHealthAction(WOUNDS, token(1, 3), {}, heal(9))).toMatchObject({ token: token(3, 3), penalty: -0 });
  });

  it('takes its size from the setup when the token has none yet', () => {
    expect(applyHealthAction(WOUNDS, token(0, 0), {}, heal(3)).token).toEqual(token(3, 3));
  });
});

describe('hit locations', () => {
  it('damages the pool, and notes the hit on the location\'s line, adding to what is there', () => {
    expect(applyHealthAction(LOCATIONS, token(10, 10), {}, damage(3, { location: 'head', note: 'Graze' })))
      .toMatchObject({ token: token(7, 10), sheetPatch: { head: 'Graze' } });
    expect(applyHealthAction(LOCATIONS, token(7, 10), { head: 'Graze' }, damage(1, { location: 'head' })).sheetPatch).toEqual({ head: 'Graze; Hit' });
    expect(applyHealthAction(LOCATIONS, token(7, 10), {}, damage(1)).sheetPatch).toEqual({});
  });

  it('clears the location it heals, and knows its own locations', () => {
    expect(applyHealthAction(LOCATIONS, token(7, 10), { head: 'Graze' }, heal(2, { location: 'head' })))
      .toMatchObject({ token: token(9, 10), sheetPatch: { head: '' } });
    expect(applyHealthAction(LOCATIONS, token(7, 10), {}, damage(1, { location: 'tail' }))).toEqual({ ok: false, error: 'Not one of this system\'s hit locations' });
  });
});

describe('any model', () => {
  it('refuses what it cannot do', () => {
    expect(applyHealthAction({ model: 'none' }, token(0, 0), {}, damage(1))).toEqual({ ok: false, error: 'This system tracks harm as conditions, not health' });
    expect(applyHealthAction(TRACKS, token(5, 5), {}, damage(0))).toEqual({ ok: false, error: 'An amount above 0' });
    expect(applyHealthAction(TRACKS, token(5, 5), {}, { kind: 'set', amount: 1 })).toEqual({ ok: false, error: 'Damage or heal' });
    expect(applyHealthAction(null, token(5, 5), {}, damage(1))).toEqual({ ok: false, error: 'This system has no health model' });
    expect(applyHealthAction({ model: 'tracks', tracks: [] }, token(5, 5), {}, damage(1))).toEqual({ ok: false, error: 'This system\'s tracks are not set up' });
  });
});

describe('the HIT_POINTS route', () => {
  const GM = jwt.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, 'test-secret');
  let db;
  let app;
  let emitted;

  /** Publish a system with this health model and make it the running one. */
  const running = async (health) => {
    const definition = { format: 1, name: `Test ${Math.random()}`, core: { health } };
    const { id } = (await request(app).post('/api/systems').set('Authorization', `Bearer ${GM}`).send({ definition })).body;
    await request(app).post(`/api/systems/${id}/publish`).set('Authorization', `Bearer ${GM}`);
    await run(db, `UPDATE global_settings SET value = ? WHERE key = 'game_system'`, [id]);
    return id;
  };
  const tokenOf = (owner, current, max, temp = 0) => run(db,
    `INSERT INTO locations (name, x, y, z, shape, owner, hp_current, hp_max, hp_temp) VALUES (?, 0, 0, 0, 'rhombus', ?, ?, ?, ?)`,
    [owner, owner, current, max, temp]).then((r) => r.lastID);
  const sheetOf = (owner, system, data) => run(db,
    `INSERT INTO character_sheets (username, system, data, is_npc) VALUES (?, ?, ?, 0)`, [owner, system, JSON.stringify(data)]);
  const readSheet = async (owner, system) => JSON.parse((await get(db,
    'SELECT data FROM character_sheets WHERE username = ? AND system = ?', [owner, system])).data);
  const readToken = (id) => get(db, 'SELECT hp_current, hp_max, hp_temp FROM locations WHERE id = ?', [id]);
  const hit = (id, body) => request(app).put(`/api/locations/${id}/health`).send(body);

  beforeEach(async () => {
    db = await makeTestDb();
    await run(db, `INSERT INTO global_settings (key, value) VALUES ('game_system', 'cities_without_number')`);
    emitted = [];
    const io = { emit: (event, data) => emitted.push({ event, data }), to: () => ({ emit: () => {} }) };
    app = express();
    app.use(express.json());
    app.use('/api/systems', require_('../routes/systems.js')(db));
    app.use('/api/locations', require_('../routes/locations.js')(db, io, { emitUpdate: vi.fn(), recordAction: vi.fn() }));
    await new Promise((resolve) => runtime.load(db, resolve));
  });

  it('fills a second track on the sheet and spills the rest onto the token', async () => {
    const system = await running(TRACKS);
    const id = await tokenOf('GHOST', 10, 10, 1);
    await sheetOf('GHOST', system, { stun: 7, stun_max: 9 });
    const res = await hit(id, { action: 'damage', amount: 5, track: 'stun' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ hp_current: 8, hp_max: 10, hp_temp: 0, out: false, overflow: 3 });
    expect(await readToken(id)).toEqual({ hp_current: 8, hp_max: 10, hp_temp: 0 });
    expect(await readSheet('GHOST', system)).toMatchObject({ stun: 9, stun_max: 9 });
    expect(emitted).toContainEqual({ event: 'sheetUpdated', data: { username: 'GHOST' } });
  });

  it('marks damage types on the sheet of an NPC linked to the token', async () => {
    const system = await running(TYPED);
    const loc = await run(db, `INSERT INTO locations (name, x, y, z, shape, owner, hp_current, hp_max) VALUES ('Ghoul', 0, 0, 0, 'enemy_rhombus', 'gm', 4, 4)`);
    const sheet = await run(db, `INSERT INTO character_sheets (username, system, data, is_npc, npc_label) VALUES ('gm', ?, '{}', 1, 'Ghoul')`, [system]);
    await run(db, 'INSERT INTO npc_sheet_links (location_id, sheet_id) VALUES (?, ?)', [loc.lastID, sheet.lastID]);
    const res = await request(app).put(`/api/locations/${loc.lastID}/health`).set('Authorization', `Bearer ${GM}`)
      .send({ action: 'damage', amount: 3, type: 'aggravated' });
    expect(res.body).toMatchObject({ hp_current: 1, hp_max: 4 });
    expect(JSON.parse((await get(db, 'SELECT data FROM character_sheets WHERE id = ?', [sheet.lastID])).data))
      .toEqual({ superficial: 0, aggravated: 3 });
  });

  it('writes harm notes, and says the wound penalty', async () => {
    const harmSystem = await running(HARM);
    const id = await tokenOf('GHOST', 5, 5);
    await sheetOf('GHOST', harmSystem, {});
    expect((await hit(id, { action: 'damage', level: 'moderate', note: 'Broken arm' })).body).toMatchObject({ hp_current: 4, hp_max: 5 });
    expect(await readSheet('GHOST', harmSystem)).toEqual({ moderate_1: 'Broken arm' });

    await running(WOUNDS);
    const rook = await tokenOf('ROOK', 3, 3);
    expect((await hit(rook, { action: 'damage', amount: 2 })).body).toMatchObject({ hp_current: 1, hp_max: 3, penalty: -2 });
  });

  it('refuses what the model cannot do, and what needs a sheet the token does not have', async () => {
    await running({ model: 'none' });
    const id = await tokenOf('GHOST', 5, 5);
    const none = await hit(id, { action: 'damage', amount: 1 });
    expect(none.status).toBe(400);
    expect(none.body.error).toBe('This system tracks harm as conditions, not health');

    await running(TRACKS);
    const noSheet = await hit(id, { action: 'damage', amount: 1, track: 'stun' });
    expect(noSheet.status).toBe(409);
    expect(await readToken(id)).toEqual({ hp_current: 5, hp_max: 5, hp_temp: 0 });
    // The first track needs no sheet.
    expect((await hit(id, { action: 'damage', amount: 1 })).body).toMatchObject({ hp_current: 4 });
  });

  it('keeps a player\'s edit made while the damage lands', async () => {
    const system = await running(TYPED);
    const id = await tokenOf('GHOST', 5, 5);
    await sheetOf('GHOST', system, { notes: 'old' });
    const { mutateSheet } = require_('../sheets/mutate');
    const sheetId = (await get(db, 'SELECT id FROM character_sheets WHERE username = ?', ['GHOST'])).id;
    const edit = new Promise((resolve) => mutateSheet(db, sheetId, (d) => ({ ...d, notes: 'new' }), resolve));
    await Promise.all([edit, hit(id, { action: 'damage', amount: 2 })]);
    expect(await readSheet('GHOST', system)).toMatchObject({ notes: 'new', superficial: 2 });
  });

  it('leaves the built-in systems, and a custom one-pool system, on the route as before', async () => {
    const id = await tokenOf('GHOST', 10, 20, 3);
    // The pool model's route would refuse an amount of 0; the built-in route shrugs it off.
    expect((await hit(id, { action: 'damage', amount: 0 })).status).toBe(200);
    expect((await hit(id, { action: 'damage', amount: 5 })).body).toEqual({ id: String(id), hp_current: 8, hp_max: 20, hp_temp: 0 });
    expect((await hit(id, { action: 'heal', amount: 50 })).body).toEqual({ id: String(id), hp_current: 20, hp_max: 20, hp_temp: 0 });

    await running({ model: 'pool', label: 'VIGOR' });
    expect((await hit(id, { action: 'damage', amount: 0 })).status).toBe(200);
    expect((await hit(id, { action: 'damage', amount: 4 })).body).toEqual({ id: String(id), hp_current: 16, hp_max: 20, hp_temp: 0 });
  });
});
