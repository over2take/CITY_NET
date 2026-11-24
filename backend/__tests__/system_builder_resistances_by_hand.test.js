/**
 * Resistances BY HAND (8b3c1; the user, 2026-11-23: "on the sheet and the health window", "the same for players"): rows kept
 * on the character's sheet, set from the token's HEALTH window or the sheet itself, the same list either way; checked against
 * the game's damage types; counted with what the features, items and conditions give. The GM's own, and (2026-11-24,
 * "player") a player's on their own character, each kept with who added it, a player changing only theirs.
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
const { resistancesOf } = require_('../systemBuilder/choices');
const { HAND_KEY, handProblem, handIn, handAfter } = require_('../systemBuilder/resistances');
const { elevatedUsers } = require_('../middleware/auth');

const sign = (payload) => jwt.sign(payload, 'test-secret');
const GM = sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false });
const EDITOR = sign({ username: 'ghost', isTemporary: true });
const VEX = sign({ username: 'vex', role: 'player' });
const ASH = sign({ username: 'ash', role: 'player' });

const STONE = 'sys_stonestonestones';
const STONE_DEF = {
  format: 1, name: 'Stonehold By Hand', core: { health: { model: 'pool' } },
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'grit', label: 'Grit' }] }],
  damage: { types: { sonic: { name: 'Sonic' } } },
  choices: [{ id: 'kin', one: 'Kin', many: 'Kin', options: [{ id: 'dwarf', label: 'Dwarf', features: [{ id: 'resilience', label: 'Dwarven Resilience', resistances: [{ kind: 'resist', type: 'poison' }] }] }] }],
};

describe('the rows, as the GM sets them', () => {
  it('checked as a feature\'s are, said in words; none at all is none', () => {
    expect(handProblem(STONE_DEF, [{ kind: 'immune', type: 'sonic' }, { kind: 'vulnerable', type: 'all' }])).toBeNull();
    expect(handProblem(STONE_DEF, [])).toBeNull();
    expect(handProblem(STONE_DEF, [{ kind: 'resist', type: 'lava' }])).toBe('resistance 1, type: Not one of this system\'s damage types, or all');
    expect(handProblem(STONE_DEF, 'fire')).toBe('resistance: Must be a list of resistances');
    expect(handProblem(STONE_DEF, undefined)).toBeNull();
  });

  it('counted beside a feature\'s, named the GM\'s and marked by hand: two for one type still don\'t stack', () => {
    const data = { _choices: { kin: [{ option: 'dwarf' }] }, [HAND_KEY]: [{ kind: 'vulnerable', type: 'poison' }, { kind: 'immune', type: 'sonic' }] };
    expect(resistancesOf(STONE_DEF, data)).toEqual({
      poison: { kind: null, from: [{ kind: 'resist', from: 'Dwarven Resilience' }, { kind: 'vulnerable', from: 'the GM, by hand', hand: true }] },
      sonic: { kind: 'immune', from: [{ kind: 'immune', from: 'the GM, by hand', hand: true }] },
    });
    // Ill-formed rows kept on a sheet count for nothing.
    expect(resistancesOf(STONE_DEF, { [HAND_KEY]: [{ kind: 'shrug', type: 'fire' }, 'x'] })).toEqual({});
  });
});

describe('who added what', () => {
  const gm = { kind: 'immune', type: 'sonic' };
  const vexFire = { kind: 'resist', type: 'fire', by: 'vex' };

  it('kept with who added it: a player\'s name, none for the GM\'s; the ill-formed passed over', () => {
    expect(handIn([gm, vexFire, { kind: 'resist', type: 'cold', by: '' }, { kind: 'x', type: 'y' }, null])).toEqual([gm, vexFire, { kind: 'resist', type: 'cold' }]);
    expect(handIn('x')).toEqual([]);
  });

  it('a row sent as it was keeps who added it; a new or changed one is the sender\'s', () => {
    expect(handAfter([gm, vexFire], [{ kind: 'immune', type: 'sonic' }, { kind: 'resist', type: 'fire' }, { kind: 'vulnerable', type: 'cold' }])).toEqual({ rows: [gm, vexFire, { kind: 'vulnerable', type: 'cold' }] });
    expect(handAfter([gm], [gm, { kind: 'resist', type: 'cold' }], 'vex')).toEqual({ rows: [gm, { kind: 'resist', type: 'cold', by: 'vex' }] });
    // The GM's changed by a player's hand: theirs now.
    expect(handAfter([vexFire], [{ kind: 'immune', type: 'fire' }])).toEqual({ rows: [{ kind: 'immune', type: 'fire' }] });
  });

  it('a player changes only their own: the GM\'s and another player\'s stay as they were', () => {
    const no = { error: 'You can only change the ones you added' };
    expect(handAfter([gm, vexFire], [gm], 'vex')).toEqual({ rows: [gm] });
    expect(handAfter([gm, vexFire], [vexFire], 'vex')).toEqual(no);
    expect(handAfter([gm], [{ kind: 'resist', type: 'sonic' }], 'vex')).toEqual(no);
    expect(handAfter([vexFire], [], 'ash')).toEqual(no);
    expect(handAfter([gm, vexFire], [])).toEqual({ rows: [] });
  });

  it('VULNERABLE is the GM\'s alone: a player neither adds one nor turns theirs into one; a GM\'s stays theirs to keep', () => {
    const no = { error: 'Only the GM adds vulnerabilities' };
    expect(handAfter([], [{ kind: 'vulnerable', type: 'cold' }], 'vex')).toEqual(no);
    expect(handAfter([vexFire], [{ kind: 'vulnerable', type: 'fire' }], 'vex')).toEqual(no);
    const gmCold = { kind: 'vulnerable', type: 'cold' };
    expect(handAfter([gmCold], [gmCold, { kind: 'immune', type: 'fire' }], 'vex')).toEqual({ rows: [gmCold, { kind: 'immune', type: 'fire', by: 'vex' }] });
    expect(handAfter([], [gmCold])).toEqual({ rows: [gmCold] });
  });
});

describe('the routes', () => {
  let db;
  let app;
  let ids;
  let told;
  const was = process.env.SECURE_MODE;

  beforeEach(async () => {
    process.env.SECURE_MODE = 'true';
    elevatedUsers.add('ghost');
    db = await makeTestDb();
    const text = JSON.stringify(STONE_DEF);
    await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', [STONE, 'Stonehold By Hand', text, text]);
    await new Promise((resolve) => runtime.load(db, resolve));
    await run(db, `INSERT INTO global_settings (key, value) VALUES ('game_system', ?)`, [STONE]);
    told = [];
    const io = { emit: (event, body) => told.push([event, body]) };
    app = express();
    app.use(express.json());
    app.use('/api/locations', locationsRouteFactory(db, io, { emitUpdate: () => told.push(['dataUpdated']), recordAction: () => {} }));
    app.use('/api/sheets', require_('../routes/sheets.js')(db, io));
    const add = async (name, shape, owner) => (await run(db, 'INSERT INTO locations (name, x, y, z, shape, owner) VALUES (?, 0, 0, 0, ?, ?)', [name, shape, owner])).lastID;
    const sheet = async (username, isNpc) => (await run(db, 'INSERT INTO character_sheets (username, system, data, is_npc) VALUES (?, ?, ?, ?)', [username, STONE, '{"name":"X"}', isNpc])).lastID;
    ids = { vex: await add('VEX', 'rhombus', 'vex'), ash: await add('ASH', 'rhombus', 'ash'), ghoul: await add('GHOUL', 'enemy_rhombus', 'gm'), ghoul2: await add('GHOUL', 'enemy_rhombus', 'gm'), bare: await add('RAT', 'enemy_rhombus', 'gm') };
    ids.dog = (await run(db, 'INSERT INTO locations (name, x, y, z, shape, owner, controllers) VALUES (?, 0, 0, 0, ?, ?, ?)', ['DOG', 'friendly_rhombus', 'gm', JSON.stringify({ all: false, users: ['vex'] })])).lastID;
    ids.dogSheet = await sheet('gm', 1);
    await run(db, 'INSERT INTO npc_sheet_links (location_id, sheet_id) VALUES (?, ?)', [ids.dog, ids.dogSheet]);
    ids.vexSheet = await sheet('vex', 0);
    ids.npc = await sheet('gm', 1);
    await run(db, 'INSERT INTO npc_sheet_links (location_id, sheet_id) VALUES (?, ?), (?, ?)', [ids.ghoul, ids.npc, ids.ghoul2, ids.npc]);
  });
  afterEach(() => {
    if (was === undefined) delete process.env.SECURE_MODE; else process.env.SECURE_MODE = was;
    elevatedUsers.delete('ghost');
  });

  const put = (id, resistances, token = GM) => request(app).put(`/api/locations/${id}/resistances`).set({ Authorization: `Bearer ${token}` }).send({ resistances });
  const dataOf = async (id) => JSON.parse((await get(db, 'SELECT data FROM character_sheets WHERE id = ?', [id])).data);

  it('from a player\'s HEALTH window onto their sheet, telling the map and their open sheets; none left, none kept', async () => {
    const res = await put(ids.vex, [{ kind: 'resist', type: 'fire' }]);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: ids.vex, resistances: [{ kind: 'resist', type: 'fire' }] });
    expect((await dataOf(ids.vexSheet))[HAND_KEY]).toEqual([{ kind: 'resist', type: 'fire' }]);
    expect(told).toEqual([['dataUpdated'], ['sheetUpdated', { username: 'vex' }]]);
    await put(ids.vex, []);
    expect(await dataOf(ids.vexSheet)).toEqual({ name: 'X' });
  });

  it('from an NPC\'s token onto the sheet it is linked to, so every token sharing that sheet shares them', async () => {
    expect((await put(ids.ghoul, [{ kind: 'vulnerable', type: 'sonic' }])).status).toBe(200);
    expect((await dataOf(ids.npc))[HAND_KEY]).toEqual([{ kind: 'vulnerable', type: 'sonic' }]);
    expect(told).toEqual([['dataUpdated']]);
    await put(ids.ghoul2, [{ kind: 'immune', type: 'all' }], EDITOR);
    expect((await dataOf(ids.npc))[HAND_KEY]).toEqual([{ kind: 'immune', type: 'all' }]);
  });

  it('a player on their own character, and an NPC the GM gave them; their rows theirs, the GM\'s left alone', async () => {
    await put(ids.vex, [{ kind: 'immune', type: 'sonic' }]);
    const mine = await put(ids.vex, [{ kind: 'immune', type: 'sonic' }, { kind: 'resist', type: 'fire' }], VEX);
    expect(mine.status).toBe(200);
    expect(mine.body.resistances).toEqual([{ kind: 'immune', type: 'sonic' }, { kind: 'resist', type: 'fire', by: 'vex' }]);
    expect(resistancesOf(STONE_DEF, await dataOf(ids.vexSheet)).fire).toEqual({ kind: 'resist', from: [{ kind: 'resist', from: 'vex, by hand', hand: true, by: 'vex' }] });
    expect(await put(ids.vex, [{ kind: 'resist', type: 'fire' }], VEX)).toMatchObject({ status: 403, body: { error: 'You can only change the ones you added' } });
    expect((await dataOf(ids.vexSheet))[HAND_KEY]).toEqual([{ kind: 'immune', type: 'sonic' }, { kind: 'resist', type: 'fire', by: 'vex' }]);
    // Their own taken off; then the GM takes one a player added.
    expect((await put(ids.vex, [{ kind: 'immune', type: 'sonic' }], VEX)).status).toBe(200);
    await put(ids.vex, [{ kind: 'immune', type: 'sonic' }, { kind: 'resist', type: 'cold' }], VEX);
    expect((await put(ids.vex, [{ kind: 'resist', type: 'cold' }])).body.resistances).toEqual([{ kind: 'resist', type: 'cold', by: 'vex' }]);
    expect(await put(ids.vex, [{ kind: 'immune', type: 'sonic' }, { kind: 'vulnerable', type: 'cold' }], VEX)).toMatchObject({ status: 403, body: { error: 'Only the GM adds vulnerabilities' } });
    // The dog the GM handed them.
    expect((await put(ids.dog, [{ kind: 'resist', type: 'poison' }], VEX)).status).toBe(200);
    expect((await dataOf(ids.dogSheet))[HAND_KEY]).toEqual([{ kind: 'resist', type: 'poison', by: 'vex' }]);
  });

  it('never on another\'s character or an NPC not theirs, nor by anyone unnamed; checked; a token with no sheet, or a built-in game, said so', async () => {
    const notYours = { status: 403, body: { error: 'You can only change your own character\'s resistances' } };
    expect(await put(ids.vex, [{ kind: 'resist', type: 'fire' }], ASH)).toMatchObject(notYours);
    expect(await put(ids.ghoul, [{ kind: 'resist', type: 'fire' }], VEX)).toMatchObject(notYours);
    expect(await put(ids.dog, [{ kind: 'resist', type: 'fire' }], ASH)).toMatchObject(notYours);
    expect((await request(app).put(`/api/locations/${ids.vex}/resistances`).send({ resistances: [] })).status).toBe(403);
    // Without Secure Mode a request with no name may change a player token's health; never their rows, which need a name.
    process.env.SECURE_MODE = 'false';
    expect(await request(app).put(`/api/locations/${ids.vex}/resistances`).send({ resistances: [{ kind: 'resist', type: 'fire' }] })).toMatchObject(notYours);
    process.env.SECURE_MODE = 'true';
    expect(await dataOf(ids.vexSheet)).toEqual({ name: 'X' });
    expect(await put(ids.vex, [{ kind: 'resist', type: 'lava' }])).toMatchObject({ status: 400, body: { error: 'resistance 1, type: Not one of this system\'s damage types, or all' } });
    expect(await put(ids.bare, [{ kind: 'resist', type: 'fire' }])).toMatchObject({ status: 409, body: { error: 'This token has no sheet to keep that on. Give it one first.' } });
    expect((await put(9999, [])).status).toBe(404);
    expect(await request(app).put(`/api/locations/${ids.vex}/resistances`).set({ Authorization: `Bearer ${GM}` }).send({})).toMatchObject({ status: 400, body: { error: 'resistance: Must be a list of resistances' } });
    expect(await dataOf(ids.vexSheet)).toEqual({ name: 'X' });
    await run(db, `UPDATE global_settings SET value = 'generic' WHERE key = 'game_system'`);
    expect(await put(ids.vex, [])).toMatchObject({ status: 400, body: { error: 'Resistances by hand are for a game made in the builder' } });
  });

  it('from the sheet itself, the GM\'s player and NPC routes: the same key, checked the same; none left, none kept', async () => {
    const player = (fields) => request(app).put('/api/sheets/user/vex').set({ Authorization: `Bearer ${GM}` }).send({ fields });
    expect((await player({ [HAND_KEY]: [{ kind: 'immune', type: 'poison' }] })).status).toBe(200);
    expect((await dataOf(ids.vexSheet))[HAND_KEY]).toEqual([{ kind: 'immune', type: 'poison' }]);
    expect(await player({ [HAND_KEY]: [{ kind: 'nope', type: 'poison' }] })).toMatchObject({ status: 400, body: { error: 'resistance 1, kind: RESIST, IMMUNE or VULNERABLE' } });
    expect((await dataOf(ids.vexSheet))[HAND_KEY]).toEqual([{ kind: 'immune', type: 'poison' }]);
    await player({ [HAND_KEY]: [] });
    expect(await dataOf(ids.vexSheet)).not.toHaveProperty(HAND_KEY);

    const npc = (fields) => request(app).put(`/api/sheets/npcs/${ids.npc}`).set({ Authorization: `Bearer ${GM}` }).send({ fields });
    expect(await npc({ [HAND_KEY]: [{ kind: 'resist', type: 'all', x: 1 }] })).toMatchObject({ status: 400, body: { error: 'resistance 1, x: Not part of a resistance' } });
    expect((await npc({ [HAND_KEY]: [{ kind: 'resist', type: 'all' }] })).status).toBe(200);
    expect((await dataOf(ids.npc))[HAND_KEY]).toEqual([{ kind: 'resist', type: 'all' }]);
    expect(await npc({ [HAND_KEY]: 'fire' })).toMatchObject({ status: 400, body: { error: 'resistance: Must be a list of resistances' } });
    await npc({ [HAND_KEY]: [] });
    expect(await dataOf(ids.npc)).not.toHaveProperty(HAND_KEY);
    // A row a player added keeps their name through the GM's whole list; another field changed leaves them as they were.
    await run(db, 'UPDATE character_sheets SET data = ? WHERE id = ?', [JSON.stringify({ name: 'X', [HAND_KEY]: [{ kind: 'resist', type: 'cold', by: 'vex' }] }), ids.vexSheet]);
    await player({ [HAND_KEY]: [{ kind: 'resist', type: 'cold' }, { kind: 'immune', type: 'fire' }] });
    expect((await dataOf(ids.vexSheet))[HAND_KEY]).toEqual([{ kind: 'resist', type: 'cold', by: 'vex' }, { kind: 'immune', type: 'fire' }]);
    await npc({ [HAND_KEY]: [{ kind: 'resist', type: 'fire' }] });
    await npc({ name: 'Ghoul' });
    expect((await dataOf(ids.npc))[HAND_KEY]).toEqual([{ kind: 'resist', type: 'fire' }]);
  });

  it('in a built-in game the sheet routes refuse them, and every other edit goes on as before', async () => {
    await run(db, `UPDATE global_settings SET value = 'generic' WHERE key = 'game_system'`);
    const rook = (await run(db, `INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('rook', 'generic', '{"name":"ROOK"}', 0)`)).lastID;
    const edit = (fields) => request(app).put('/api/sheets/user/rook').set({ Authorization: `Bearer ${GM}` }).send({ fields });
    expect((await edit({ name: 'Rook' })).status).toBe(200);
    expect((await dataOf(rook)).name).toBe('Rook');
    expect(await edit({ [HAND_KEY]: [] })).toMatchObject({ status: 400, body: { error: 'Resistances by hand are for a game made in the builder' } });
    expect(await dataOf(rook)).not.toHaveProperty(HAND_KEY);
  });

  it('a player never writes them: the key is the GM\'s, as every _ field', () => {
    const { playerMayEdit } = require_('../sheets/templates');
    expect(playerMayEdit(STONE, HAND_KEY)).toBe(false);
  });
});
