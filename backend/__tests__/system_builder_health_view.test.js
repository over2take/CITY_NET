import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createRequire } from 'module';
import { makeTestDb, get, run } from './helpers/testDb.js';
import { untilValue, drain } from './helpers/until.js';

/**
 * What the HEALTH folder is sent under a custom health model: the full detail to whoever may
 * change the token's health (the GM, a granted editor, the owner) and a description, never a
 * number or a note, to everyone else. Plus the details the window reports after an action.
 */

process.env.JWT_SECRET = 'test-secret';
process.env.DICE_ANIM_MS = '0';
const require_ = createRequire(import.meta.url);
const { healthView } = require_('../systemBuilder/healthView');
const { applyHealthAction } = require_('../systemBuilder/health');
const runtime = require_('../systemBuilder/runtime');
const socketsFactory = require_('../sockets/index.js');

const TRACKS = { model: 'tracks', tracks: [{ id: 'physical', label: 'PHYSICAL' }, { id: 'stun', label: 'STUN' }], overflow: true };
const TYPED = { model: 'typed', types: [{ id: 'superficial', label: 'SUPERFICIAL' }, { id: 'aggravated', label: 'AGGRAVATED' }] };
const HARM = { model: 'harm', levels: [
  { id: 'lesser', label: 'LESSER', slots: 2, penalty: 'Reduced effect' },
  { id: 'moderate', label: 'MODERATE', slots: 2, penalty: '-1d' },
  { id: 'severe', label: 'SEVERE', slots: 1, penalty: 'Need help' },
] };
const WOUNDS = { model: 'wounds', count: 3, penalty: -1 };
const LOCATIONS = { model: 'locations', locations: [{ id: 'head', label: 'HEAD' }, { id: 'body', label: 'BODY' }] };
const token = (current, max) => ({ current, max, temp: 0 });
const both = (health, t, sheet) => [healthView(health, t, sheet, { full: true }), healthView(health, t, sheet)];

describe('the view', () => {
  it('is nothing for a built-in system, which draws its own health', () => {
    expect(healthView(null, token(5, 10), {})).toEqual({ model: null });
    expect(healthView({ model: 'tracks', tracks: [] }, token(5, 10), {})).toEqual({ model: null });
  });

  it('one pool: its own word for health', () => {
    expect(healthView({ model: 'pool', label: 'VIGOR' }, token(5, 10), {})).toEqual({ model: 'pool', full: false, label: 'VIGOR' });
    expect(healthView({ model: 'pool' }, token(5, 10), {}).label).toBe('HP');
  });

  it('two tracks: the second track\'s numbers in full, only its fill to others', () => {
    const [full, others] = both(TRACKS, token(8, 10), { stun: 6, stun_max: 9 });
    expect(full).toEqual({
      model: 'tracks', full: true, overflow: true,
      tracks: [{ id: 'physical', label: 'PHYSICAL' }, { id: 'stun', label: 'STUN' }],
      second: { id: 'stun', label: 'STUN', current: 6, max: 9 },
    });
    expect(others.second).toEqual({ label: 'STUN', fill: 6 / 9, full: false });
    expect(healthView(TRACKS, token(8, 10), { stun: 9, stun_max: 9 }).second).toMatchObject({ fill: 1, full: true });
    expect(healthView(TRACKS, token(8, 10), { stun: 4 }).second).toMatchObject({ fill: 0, full: false });
  });

  it('damage types: each type\'s marks in full, light against heavy as shares to others', () => {
    const [full, others] = both(TYPED, token(3, 8), { superficial: 3, aggravated: 2 });
    expect(full).toMatchObject({ boxes: 8, types: [{ id: 'superficial', label: 'SUPERFICIAL', marks: 3 }, { id: 'aggravated', label: 'AGGRAVATED', marks: 2 }] });
    expect(others).toEqual({ model: 'typed', full: false, light: 3 / 8, heavy: 2 / 8 });
  });

  it('harm levels: the notes in full, the worst level\'s name to others, and out only when full and down', () => {
    const sheet = { lesser_1: 'Bruised ribs', moderate_1: 'Twisted knee' };
    const [full, others] = both(HARM, token(3, 5), sheet);
    expect(full.levels).toEqual([
      { id: 'lesser', label: 'LESSER', penalty: 'Reduced effect', slots: ['Bruised ribs', ''] },
      { id: 'moderate', label: 'MODERATE', penalty: '-1d', slots: ['Twisted knee', ''] },
      { id: 'severe', label: 'SEVERE', penalty: 'Need help', slots: [''] },
    ]);
    expect(full).toMatchObject({ worst: 1, out: false });
    expect(others).toEqual({ model: 'harm', full: false, levelCount: 3, worst: 1, worstLabel: 'MODERATE', out: false });
    expect(JSON.stringify(others)).not.toContain('Twisted');
    const all = { lesser_1: 'a', lesser_2: 'b', moderate_1: 'c', moderate_2: 'd', severe_1: 'e' };
    expect(healthView(HARM, token(0, 5), all)).toMatchObject({ worstLabel: 'SEVERE', out: true });
    expect(healthView(HARM, token(1, 5), all).out).toBe(false);
    expect(healthView(HARM, token(5, 5), {})).toMatchObject({ worst: -1, worstLabel: null });
  });

  it('wound count: the penalty in full, a word to others', () => {
    const [full, others] = both(WOUNDS, token(1, 3), {});
    expect(full).toEqual({ model: 'wounds', full: true, penalty: -2 });
    expect(others).toEqual({ model: 'wounds', full: false, state: 'wounded' });
    expect(healthView(WOUNDS, token(3, 3), {}).state).toBe('unhurt');
    expect(healthView(WOUNDS, token(0, 3), {}).state).toBe('incapacitated');
    // No size on the token yet: the setup's count.
    expect(healthView(WOUNDS, token(2, 0), {}, { full: true }).penalty).toBe(-1);
  });

  it('hit locations: the notes in full, only which are hurt to others', () => {
    const [full, others] = both(LOCATIONS, token(9, 15), { body: 'Graze' });
    expect(full.locations).toEqual([{ id: 'head', label: 'HEAD', note: '' }, { id: 'body', label: 'BODY', note: 'Graze' }]);
    expect(others.locations).toEqual([{ id: 'head', label: 'HEAD', hit: false }, { id: 'body', label: 'BODY', hit: true }]);
  });

  it('none: only which model it is', () => {
    expect(healthView({ model: 'none' }, token(0, 0), {})).toEqual({ model: 'none', full: false });
  });
});

describe('what an action reports', () => {
  it('how many boxes turned heavier, and which level harm landed on', () => {
    expect(applyHealthAction(TYPED, token(0, 5), { superficial: 3, aggravated: 2 }, { kind: 'damage', amount: 2 })).toMatchObject({ turned: 2 });
    expect(applyHealthAction(TYPED, token(5, 5), {}, { kind: 'damage', amount: 2 }).turned).toBeUndefined();
    const sheet = { lesser_1: 'a', lesser_2: 'b' };
    expect(applyHealthAction(HARM, token(3, 5), sheet, { kind: 'damage', level: 'lesser', note: 'Cut' })).toMatchObject({ placed: 'moderate', sheetPatch: { moderate_1: 'Cut' } });
    expect(applyHealthAction(HARM, token(5, 5), {}, { kind: 'damage', note: 'Cut' }).placed).toBe('lesser');
    const all = { ...sheet, moderate_1: 'c', moderate_2: 'd', severe_1: 'e' };
    expect(applyHealthAction(HARM, token(0, 5), all, { kind: 'damage', note: 'x' }).placed).toBeUndefined();
  });

  it('sets the second track\'s maximum, bringing its current down to it, and refuses any other', () => {
    expect(applyHealthAction(TRACKS, token(8, 10), { stun: 7 }, { kind: 'set_max', track: 'stun', amount: 12 }).sheetPatch).toEqual({ stun_max: 12 });
    expect(applyHealthAction(TRACKS, token(8, 10), { stun: 7 }, { kind: 'set_max', track: 'stun', amount: 5 }).sheetPatch).toEqual({ stun_max: 5, stun: 5 });
    expect(applyHealthAction(TRACKS, token(8, 10), {}, { kind: 'set_max', track: 'physical', amount: 5 })).toEqual({ ok: false, error: 'The first track\'s maximum is set on the token' });
    expect(applyHealthAction(WOUNDS, token(2, 3), {}, { kind: 'set_max', amount: 5 })).toEqual({ ok: false, error: 'This maximum is set on the token' });
  });
});

describe('in the running game', () => {
  const GM = jwt.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, 'test-secret');
  let db;
  let app;
  let elevatedUsers;

  const running = async (health) => {
    const definition = { format: 1, name: `Test ${Math.random()}`, core: { health } };
    const { id } = (await request(app).post('/api/systems').set('Authorization', `Bearer ${GM}`).send({ definition })).body;
    await request(app).post(`/api/systems/${id}/publish`).set('Authorization', `Bearer ${GM}`);
    await run(db, `UPDATE global_settings SET value = ? WHERE key = 'game_system'`, [id]);
    return id;
  };

  /** A socket for `userName` (the GM when `admin`), with what it was sent. */
  const connectAs = async (userName, { admin = false } = {}) => {
    let connect;
    socketsFactory({ on: (e, cb) => { if (e === 'connection') connect = cb; }, emit: () => {}, to: () => ({ emit: () => {} }) },
      db, { elevatedUsers, emitUpdate: vi.fn(), recordAction: vi.fn() });
    const handlers = {};
    const sent = [];
    connect({ id: `hv-${Math.random()}`, on: (e, fn) => { handlers[e] = fn; }, emit: (e, d) => sent.push({ e, d }),
      broadcast: { emit: () => {} }, use: () => {}, join: () => {}, disconnect: () => {} });
    handlers.identify(admin ? { userName, isAdmin: true, token: GM } : userName);
    await drain(db);
    return { handlers, sent };
  };
  const viewFor = async (who, locationId) => {
    who.handlers.requestHealthView({ location_id: locationId });
    const found = await untilValue(() => who.sent.find((s) => s.e === 'healthView' && s.d.location_id === locationId), Boolean, { label: 'the health view' });
    who.sent.length = 0;
    return found.d;
  };

  beforeEach(async () => {
    db = await makeTestDb();
    await run(db, `INSERT INTO global_settings (key, value) VALUES ('game_system', 'cities_without_number')`);
    elevatedUsers = new Set();
    vi.spyOn(console, 'log').mockImplementation(() => {});
    app = express();
    app.use(express.json());
    app.use('/api/systems', require_('../routes/systems.js')(db));
    app.use('/api/locations', require_('../routes/locations.js')(db, { emit: () => {} }, { emitUpdate: vi.fn(), recordAction: vi.fn() }));
    await new Promise((resolve) => runtime.load(db, resolve));
  });

  const playerToken = async (owner, system, data) => {
    await run(db, 'INSERT INTO character_sheets (username, system, data, is_npc) VALUES (?, ?, ?, 0)', [owner, system, JSON.stringify(data)]);
    return (await run(db, `INSERT INTO locations (name, x, y, z, shape, owner, hp_current, hp_max) VALUES (?, 0, 0, 0, 'rhombus', ?, 8, 10)`, [owner, owner])).lastID;
  };

  it('sends a player\'s own token in full, and another player only the description', async () => {
    const system = await running(HARM);
    const id = await playerToken('GHOST', system, { moderate_1: 'Twisted knee' });
    const owner = await connectAs('GHOST');
    const other = await connectAs('ROOK');
    expect(await viewFor(owner, id)).toMatchObject({ location_id: id, model: 'harm', full: true, worst: 1 });
    const seen = await viewFor(other, id);
    expect(seen).toMatchObject({ model: 'harm', full: false, worstLabel: 'MODERATE' });
    expect(JSON.stringify(seen)).not.toContain('Twisted');
  });

  it('sends the GM and a granted editor everything, an NPC included', async () => {
    const system = await running(TRACKS);
    const id = await playerToken('GHOST', system, { stun: 3, stun_max: 9 });
    const npc = await run(db, `INSERT INTO locations (name, x, y, z, shape, owner, hp_current, hp_max) VALUES ('Ghoul', 0, 0, 0, 'enemy_rhombus', 'gm', 4, 4)`);
    const sheet = await run(db, `INSERT INTO character_sheets (username, system, data, is_npc, npc_label) VALUES ('gm', ?, '{"stun":2,"stun_max":5}', 1, 'Ghoul')`, [system]);
    await run(db, 'INSERT INTO npc_sheet_links (location_id, sheet_id) VALUES (?, ?)', [npc.lastID, sheet.lastID]);

    const gm = await connectAs('gm', { admin: true });
    expect((await viewFor(gm, id)).second).toEqual({ id: 'stun', label: 'STUN', current: 3, max: 9 });
    expect((await viewFor(gm, npc.lastID)).second).toEqual({ id: 'stun', label: 'STUN', current: 2, max: 5 });

    elevatedUsers.add('ROOK');
    const granted = await connectAs('ROOK');
    expect((await viewFor(granted, npc.lastID)).full).toBe(true);
    // Nobody else sees an NPC's numbers, even with the NPC's owner field naming the GM.
    const player = await connectAs('GHOST');
    expect((await viewFor(player, npc.lastID)).second).toEqual({ label: 'STUN', fill: 2 / 5, full: false });
  });

  it("does not give a player an NPC's numbers because the NPC's owner field names them", async () => {
    // An enemy made by a player while the GM had granted them editing carries their name.
    // Once the grant is gone, so is the full view.
    const system = await running(TRACKS);
    const npc = await run(db, `INSERT INTO locations (name, x, y, z, shape, owner, hp_current, hp_max) VALUES ('Drone', 0, 0, 0, 'enemy_rhombus', 'ROOK', 4, 4)`);
    const sheet = await run(db, `INSERT INTO character_sheets (username, system, data, is_npc, npc_label) VALUES ('ROOK', ?, '{"stun":1,"stun_max":4}', 1, 'Drone')`, [system]);
    await run(db, 'INSERT INTO npc_sheet_links (location_id, sheet_id) VALUES (?, ?)', [npc.lastID, sheet.lastID]);
    const rook = await connectAs('ROOK');
    expect(await viewFor(rook, npc.lastID)).toMatchObject({ full: false, second: { label: 'STUN', fill: 0.25, full: false } });
  });

  it('names a one-pool system\'s health in its own word for hit points', async () => {
    const definition = { format: 1, name: 'Hearth', words: { hp: { singular: 'WOUND', short: 'WND' } }, core: { health: { model: 'pool' } } };
    const { id: system } = (await request(app).post('/api/systems').set('Authorization', `Bearer ${GM}`).send({ definition })).body;
    await request(app).post(`/api/systems/${system}/publish`).set('Authorization', `Bearer ${GM}`);
    await run(db, `UPDATE global_settings SET value = ? WHERE key = 'game_system'`, [system]);
    const id = await playerToken('GHOST', system, {});
    expect(await viewFor(await connectAs('GHOST'), id)).toMatchObject({ model: 'pool', label: 'WND' });
  });

  it('says there is nothing to draw for a built-in system, and answers only the one who asked', async () => {
    const id = await playerToken('GHOST', 'cities_without_number', {});
    const asker = await connectAs('GHOST');
    const bystander = await connectAs('ROOK');
    expect(await viewFor(asker, id)).toEqual({ location_id: id, model: null });
    expect(bystander.sent.some((s) => s.e === 'healthView')).toBe(false);
    // Always an answer, so a window never waits on one: even for a token not on the map.
    expect(await viewFor(asker, 9999)).toEqual({ location_id: 9999, model: null });
  });

  it('sets a second track\'s maximum on the sheet, and any other maximum on the token as before', async () => {
    const system = await running(TRACKS);
    const id = await playerToken('GHOST', system, { stun: 7, stun_max: 9 });
    const res = await request(app).put(`/api/locations/${id}/health`).send({ action: 'set_max', track: 'stun', amount: 5 });
    expect(res.status).toBe(200);
    expect(JSON.parse((await get(db, 'SELECT data FROM character_sheets WHERE username = ?', ['GHOST'])).data)).toMatchObject({ stun: 5, stun_max: 5 });
    expect(await get(db, 'SELECT hp_max FROM locations WHERE id = ?', [id])).toEqual({ hp_max: 10 });

    await request(app).put(`/api/locations/${id}/health`).send({ action: 'set_max', track: 'physical', hp_max: 14 });
    expect(await get(db, 'SELECT hp_max FROM locations WHERE id = ?', [id])).toEqual({ hp_max: 14 });
  });

  it('passes the details on to the window', async () => {
    const system = await running(HARM);
    const id = await playerToken('GHOST', system, { lesser_1: 'a', lesser_2: 'b' });
    const res = await request(app).put(`/api/locations/${id}/health`).send({ action: 'damage', level: 'lesser', note: 'Cut' });
    expect(res.body).toMatchObject({ placed: 'moderate' });

    await running(TYPED);
    const full = await playerToken('ROOK', (await get(db, `SELECT value FROM global_settings WHERE key = 'game_system'`)).value, { superficial: 4, aggravated: 0 });
    await run(db, 'UPDATE locations SET hp_current = 0, hp_max = 4 WHERE id = ?', [full]);
    expect((await request(app).put(`/api/locations/${full}/health`).send({ action: 'damage', amount: 1 })).body).toMatchObject({ turned: 1 });
  });
});
