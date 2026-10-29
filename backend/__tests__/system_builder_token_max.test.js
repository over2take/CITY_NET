/**
 * A feature's modifier on the token's maximum (7a5a3; decision 10 of the approved mockup
 * docs/mockups/nested-choices.html): Tough's `2 * @level` moves the token's real maximum while the pick
 * counts, the current with it, and back when it doesn't. Worked out against what the sheet says it has
 * added, so a second save adds nothing, and a new token starts clean. Through the socket and the GM's
 * sheet route, on the game running only.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createRequire } from 'module';
import { makeTestDb, get, run } from './helpers/testDb.js';
import { drain, until } from './helpers/until.js';

process.env.JWT_SECRET = 'test-secret';

const require_ = createRequire(import.meta.url);
const { PICKS_KEY, overlayOf, effectiveData, tokenMaxFieldOf } = require_('../systemBuilder/choices');
const { TOKEN_MAX_KEY, bonusOf, addedTo, moveFor, syncTokenMax, syncAllTokenMax } = require_('../systemBuilder/tokenMax');
const { checkDefinition } = require_('../systemBuilder/definition');
const runtime = require_('../systemBuilder/runtime');
const socketsFactory = require_('../sockets/index.js');

const KEEP = {
  format: 1, name: 'Keep',
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'con', label: 'Constitution' }] }],
  choices: [
    { id: 'classes', one: 'Class', many: 'Classes', levelled: true, options: [{ id: 'fighter', label: 'Fighter' }] },
    { id: 'feats', one: 'Feat', many: 'Feats', picks: 'any', options: [
      { id: 'tough', label: 'Tough', features: [{ id: 'tough_hp', label: 'Tough', modifiers: [{ target: 'hp_max', amount: '2 * @level' }] }] },
      { id: 'hardy', label: 'Hardy', features: [{ id: 'hardy_hp', label: 'Hardy', modifiers: [{ target: 'hp_max', amount: '@con' }] }] },
    ] },
  ],
};
const sheetWith = (feats, level = 3, extra = {}) => ({
  con: 2, ...extra,
  [PICKS_KEY]: { classes: [{ option: 'fighter', level }], feats: feats.map((option) => ({ option })) },
});

describe('what the picks add to the token\'s maximum', () => {
  it('the system checks clean, and its token maximum is HP MAX; WOUNDS under a wound count', () => {
    expect(checkDefinition(KEEP).problems).toEqual([]);
    expect(tokenMaxFieldOf(KEEP)).toBe('hp_max');
    expect(tokenMaxFieldOf({ ...KEEP, core: { health: { model: 'wounds', count: 3 } } })).toBe('wounds_max');
    expect(tokenMaxFieldOf({ ...KEEP, core: { health: { model: 'harm', levels: [{ id: 'lesser', label: 'LESSER' }] } } })).toBeNull();
  });

  it('every modifier on it, summed, as the sheet reads now', () => {
    expect(bonusOf(KEEP, sheetWith(['tough']))).toBe(6);
    expect(bonusOf(KEEP, sheetWith(['tough'], 4))).toBe(8);
    expect(bonusOf(KEEP, sheetWith(['tough', 'hardy']))).toBe(8);
    expect(bonusOf(KEEP, sheetWith([]))).toBe(0);
    expect(bonusOf(KEEP, {})).toBe(0);
  });

  it('is never added to the sheet a second time: the token holds it, the sheet still names it', () => {
    const data = { ...sheetWith(['tough']), hp_max: 26 };
    const overlay = overlayOf(KEEP, data);
    expect(overlay.sheet).not.toHaveProperty('hp_max');
    expect(overlay.from.hp_max).toEqual([{ feature: 'Tough', amount: 6 }]);
    expect(effectiveData(KEEP, data).hp_max).toBe(26);
  });

  it('moves by what changed since the sheet last said, against that token only', () => {
    const first = moveFor(KEEP, sheetWith(['tough']), 7);
    expect(first).toEqual({ by: 6, data: { ...sheetWith(['tough']), [TOKEN_MAX_KEY]: { token: 7, amount: 6 } } });
    expect(moveFor(KEEP, first.data, 7)).toBeNull();
    expect(moveFor(KEEP, { ...first.data, [PICKS_KEY]: sheetWith(['tough'], 4)[PICKS_KEY] }, 7).by).toBe(2);
    expect(moveFor(KEEP, { ...first.data, [PICKS_KEY]: sheetWith([])[PICKS_KEY] }, 7)).toMatchObject({ by: -6, data: { [TOKEN_MAX_KEY]: { token: 7, amount: 0 } } });
    // A new token: nothing added to it yet.
    expect(moveFor(KEEP, first.data, 8).by).toBe(6);
    expect(addedTo(first.data, 8)).toBe(0);
    expect(addedTo({ [TOKEN_MAX_KEY]: { token: 7, amount: 'six' } }, 7)).toBe(0);
    expect(moveFor(KEEP, {}, 7)).toBeNull();
  });
});

describe('at the table', () => {
  const GM = jwt.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, 'test-secret');
  const ID = 'sys_toughtoughtough';
  let db;
  let emitUpdate;

  const install = async (definition) => {
    const def = JSON.stringify(definition);
    await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1) ON CONFLICT(id) DO UPDATE SET draft = excluded.draft, published = excluded.published', [ID, definition.name, def, def]);
    await new Promise((resolve) => runtime.load(db, resolve));
  };
  const join = async (who, identity) => {
    let connection;
    const shared = [];
    socketsFactory({ on: (e, cb) => { if (e === 'connection') connection = cb; }, emit: (event, data) => shared.push({ event, data }), to: () => ({ emit: () => {} }) },
      db, { elevatedUsers: new Set(), emitUpdate, recordAction: vi.fn() });
    const handlers = {};
    connection({ id: `tm-${who}`, on: (e, fn) => { handlers[e] = fn; }, emit: () => {}, broadcast: { emit: () => {} }, use: () => {}, join: () => {}, disconnect: () => {} });
    handlers.identify(identity);
    await drain(db);
    return { handlers, shared };
  };
  const tokenOf = (owner = 'kes') => get(db, `SELECT hp_current, hp_max FROM locations WHERE owner = ? AND shape = 'rhombus' ORDER BY id LIMIT 1`, [owner]);
  const sheetOf = async () => JSON.parse((await get(db, 'SELECT data FROM character_sheets WHERE username = ?', ['kes'])).data);
  const healthIs = (current, max, label) => until(async () => {
    const t = await tokenOf();
    return t.hp_current === current && t.hp_max === max;
  }, { label });

  beforeEach(async () => {
    db = await makeTestDb();
    emitUpdate = vi.fn();
    await install(KEEP);
    await run(db, `INSERT INTO global_settings (key, value) VALUES ('game_system', ?)`, [ID]);
    await run(db, `INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('kes', ?, ?, 0)`,
      [ID, JSON.stringify({ con: 2, [PICKS_KEY]: { classes: [{ option: 'fighter', level: 3 }] } })]);
    await run(db, `INSERT INTO locations (name, x, y, z, shape, owner, hp_current, hp_max) VALUES ('Kes', 0, 0, 0, 'rhombus', 'kes', 20, 20)`);
  });

  it('a pick moves the maximum and the current; a level moves them again; taken away, back', async () => {
    const gm = await join('gm', { userName: 'gm', isAdmin: true, token: GM });
    gm.handlers.choicesAction({ kind: 'pick', list: 'feats', option: 'tough', username: 'kes' });
    await healthIs(26, 26, 'Tough at level 3');
    expect(gm.shared.filter((e) => e.event === 'dataUpdated')).toEqual([{ event: 'dataUpdated', data: { isRhombusOnly: true } }]);
    gm.handlers.choicesAction({ kind: 'level', list: 'classes', option: 'fighter', level: 4, username: 'kes' });
    await healthIs(28, 28, 'level 4');
    await run(db, `UPDATE locations SET hp_current = 5 WHERE owner = 'kes'`);
    gm.handlers.choicesAction({ kind: 'drop', list: 'feats', option: 'tough', username: 'kes' });
    await healthIs(0, 20, 'dropped: the current moves down too, never below 0');
    expect((await sheetOf())[TOKEN_MAX_KEY]).toEqual({ token: expect.any(Number), amount: 0 });
  });

  it('the current moves with it and stays under the new maximum', async () => {
    await run(db, `UPDATE locations SET hp_current = 15 WHERE owner = 'kes'`);
    const gm = await join('gm', { userName: 'gm', isAdmin: true, token: GM });
    gm.handlers.choicesAction({ kind: 'pick', list: 'feats', option: 'tough', username: 'kes' });
    await healthIs(21, 26, 'hurt, then Tough');
    gm.handlers.choicesAction({ kind: 'drop', list: 'feats', option: 'tough', username: 'kes' });
    await healthIs(15, 20, 'back where it was');
    // A token somehow over its maximum is brought under the new one.
    await run(db, `UPDATE locations SET hp_current = 25 WHERE owner = 'kes'`);
    gm.handlers.choicesAction({ kind: 'pick', list: 'feats', option: 'tough', username: 'kes' });
    await healthIs(26, 26, 'over, then Tough');
  });

  it('a stat a modifier reads, changed by the player or the GM, moves it; another save adds nothing', async () => {
    const gm = await join('gm', { userName: 'gm', isAdmin: true, token: GM });
    gm.handlers.choicesAction({ kind: 'pick', list: 'feats', option: 'hardy', username: 'kes' });
    await healthIs(22, 22, 'Hardy at CON 2');
    const kes = await join('kes', 'kes');
    kes.handlers.updateSheetField({ fieldId: 'con', value: 5 });
    await healthIs(25, 25, 'CON 5');
    expect(emitUpdate).toHaveBeenCalledWith({ isRhombusOnly: true });
    kes.handlers.updateSheetField({ fieldId: 'name', value: 'Kestrel' });
    await until(async () => (await sheetOf()).name === 'Kestrel', { label: 'the name saved' });
    await drain(db);
    expect(await tokenOf()).toEqual({ hp_current: 25, hp_max: 25 });

    const app = express();
    app.use(express.json());
    const emitted = [];
    app.use('/api/sheets', require_('../routes/sheets.js')(db, { emit: (event, data) => emitted.push({ event, data }) }));
    expect((await request(app).put('/api/sheets/user/kes').set('Authorization', `Bearer ${GM}`).send({ fields: { con: 1 } })).status).toBe(200);
    expect(await tokenOf()).toEqual({ hp_current: 21, hp_max: 21 });
    expect(emitted.map((e) => e.event)).toEqual(['dataUpdated', 'sheetUpdated']);
  });

  it('an import that changes what a modifier reads moves it too', async () => {
    await run(db, 'UPDATE character_sheets SET data = ? WHERE username = ?', [JSON.stringify(sheetWith(['hardy'])), 'kes']);
    await new Promise((resolve) => syncTokenMax(db, ID, 'kes', resolve));
    expect(await tokenOf()).toEqual({ hp_current: 22, hp_max: 22 });
    const kes = await join('kes', 'kes');
    kes.handlers.importSheetFields({ fields: { con: 4 } });
    await healthIs(24, 24, 'imported CON 4');
  });

  it('a new token starts with nothing added: the bonus goes on it', async () => {
    await run(db, 'UPDATE character_sheets SET data = ? WHERE username = ?', [JSON.stringify(sheetWith(['tough'])), 'kes']);
    expect(await new Promise((resolve) => syncTokenMax(db, ID, 'kes', resolve))).toBe(true);
    expect(await tokenOf()).toEqual({ hp_current: 26, hp_max: 26 });
    await run(db, `DELETE FROM locations WHERE owner = 'kes'`);
    await run(db, `INSERT INTO locations (name, x, y, z, shape, owner, hp_current, hp_max) VALUES ('Kes', 0, 0, 0, 'rhombus', 'kes', 20, 20)`);
    expect(await new Promise((resolve) => syncTokenMax(db, ID, 'kes', resolve))).toBe(true);
    expect(await tokenOf()).toEqual({ hp_current: 26, hp_max: 26 });
    expect(await new Promise((resolve) => syncTokenMax(db, ID, 'kes', resolve))).toBe(false);
  });

  it('nothing moves with no token, with token health off, or in a system not running', async () => {
    await run(db, 'UPDATE character_sheets SET data = ? WHERE username = ?', [JSON.stringify(sheetWith(['tough'])), 'kes']);
    await run(db, `DELETE FROM locations WHERE owner = 'kes'`);
    expect(await new Promise((resolve) => syncTokenMax(db, ID, 'kes', resolve))).toBe(false);
    expect((await sheetOf())[TOKEN_MAX_KEY]).toBeUndefined();
    await run(db, `INSERT INTO locations (name, x, y, z, shape, owner, hp_current, hp_max) VALUES ('Kes', 0, 0, 0, 'rhombus', 'kes', 20, 20)`);
    await install({ ...KEEP, parts: { token_health: { on: false } } });
    expect(await new Promise((resolve) => syncTokenMax(db, ID, 'kes', resolve))).toBe(false);
    expect(await new Promise((resolve) => syncTokenMax(db, 'cities_without_number', 'kes', resolve))).toBe(false);
    await install(KEEP);
    await run(db, `UPDATE global_settings SET value = 'cities_without_number' WHERE key = 'game_system'`);
    expect(await new Promise((resolve) => syncAllTokenMax(db, ID, resolve))).toBe(false);
    expect(await tokenOf()).toEqual({ hp_current: 20, hp_max: 20 });
  });

  it('a new version published moves every player\'s at once, in the game running', async () => {
    const app = express();
    app.use(express.json());
    const emitted = [];
    app.use('/api/systems', require_('../routes/systems.js')(db, { emit: (event, data) => emitted.push({ event, data }) }));
    const gm = (r) => r.set('Authorization', `Bearer ${GM}`);
    const { id } = (await gm(request(app).post('/api/systems')).send({ definition: { ...KEEP, name: 'Keep Two' } })).body;
    expect((await gm(request(app).post(`/api/systems/${id}/publish`))).status).toBe(200);
    await run(db, `UPDATE global_settings SET value = ? WHERE key = 'game_system'`, [id]);
    await run(db, `INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('kes', ?, ?, 0)`, [id, JSON.stringify(sheetWith(['tough']))]);
    await new Promise((resolve) => syncTokenMax(db, id, 'kes', resolve));
    expect(await tokenOf()).toEqual({ hp_current: 26, hp_max: 26 });
    emitted.length = 0;
    const tougher = JSON.parse(JSON.stringify({ ...KEEP, name: 'Keep Two' }));
    tougher.choices[1].options[0].features[0].modifiers[0].amount = '3 * @level';
    expect((await gm(request(app).put(`/api/systems/${id}/draft`)).send({ definition: tougher })).status).toBe(200);
    expect((await gm(request(app).post(`/api/systems/${id}/publish`))).status).toBe(200);
    expect(await tokenOf()).toEqual({ hp_current: 29, hp_max: 29 });
    expect(emitted.map((e) => e.event)).toEqual(['dataUpdated', 'customSystemChanged']);
  });
});
