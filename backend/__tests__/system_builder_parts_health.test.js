/**
 * A custom system with token health turned off (3b6d1), on the server and in the sheets. Its
 * tokens take no health action, its health model is 'none', and its sheets (character and NPC)
 * lose the fields linked to the token's HP, and the header bar that showed one. A field linked
 * to the token's AC leaves the same way with combat, and cash with the bank. GENERATE_SHEET
 * writes a tier's HP only with token health on and its defense only with combat on. Nothing
 * is deleted, and the built-in systems are untouched.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createRequire } from 'module';
import { makeTestDb, get, run } from './helpers/testDb.js';
import { drain, untilValue } from './helpers/until.js';
import locationsRouteFactory from '../routes/locations.js';

process.env.JWT_SECRET = 'test-secret';
const GM = jwt.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, 'test-secret');

const require_ = createRequire(import.meta.url);
const runtime = require_('../systemBuilder/runtime');
const { effectiveSheet, fieldsOf } = require_('../systemBuilder/sheet');
const socketsFactory = require_('../sockets/index.js');

const NOHEALTH = 'sys_aaaaaaaaaaaaaaaa';
const HEALTHY = 'sys_bbbbbbbbbbbbbbbb';
const NOCOMBAT = 'sys_cccccccccccccccc';
const BUILT_INS = ['cities_without_number', 'cyberpunk_red', 'shadowrun_6e', 'generic'];

const SHEET = {
  tabs: ['MAIN'],
  header: { nameField: 'name', hpField: 'hp', hpMaxField: 'hp_max', subtitleFields: ['calling'] },
  sections: [
    { id: 'who', label: 'WHO', layout: 'list', tab: 'MAIN', fields: [
      { id: 'name', label: 'Name', type: 'text' }, { id: 'calling', label: 'Calling', type: 'text' },
    ] },
    { id: 'body', label: 'BODY', layout: 'grid', tab: 'MAIN', fields: [
      { id: 'hp', label: 'HP', type: 'number', source: 'token_hp', maxField: 'hp_max' },
      { id: 'hp_max', label: 'MAX', type: 'number', source: 'token_hp_max' },
    ] },
    { id: 'guard', label: 'GUARD', layout: 'grid', tab: 'MAIN', fields: [
      { id: 'ac', label: 'AC', type: 'number', source: 'token_ac' }, { id: 'grit', label: 'Grit', type: 'number' },
    ] },
  ],
};
const NPC_SHEET = { header: { nameField: 'name', hpField: 'hp' }, sections: [{ id: 'block', label: 'BLOCK', layout: 'grid', fields: [
  { id: 'name', label: 'Name', type: 'text' }, { id: 'hp', label: 'HP', type: 'number', source: 'token_hp' }, { id: 'menace', label: 'Menace', type: 'number' },
] }] };
const TIERS = [{ id: 'champion', label: 'CHAMPION', hp: 30, defense: 17, values: { menace: 4 } }];

const def = (parts, extra = {}) => ({ format: 1, name: 'Hearth', parts, sheet: SHEET, npc: { sheet: NPC_SHEET, tiers: TIERS }, ...extra });

describe('the sheets', () => {
  const ids = (definition) => fieldsOf(effectiveSheet(definition)).map((f) => f.id);

  it('lose the token\'s HP and the bar showing it with token health off, and keep the rest of the header', () => {
    const sheet = effectiveSheet(def({ token_health: { on: false } }));
    expect(fieldsOf(sheet).map((f) => f.id)).toEqual(['name', 'calling', 'ac', 'grit']);
    expect(sheet.sections.map((s) => s.id)).toEqual(['who', 'guard']);
    expect(sheet.header).toEqual({ nameField: 'name', subtitleFields: ['calling'] });
  });

  it('lose the token\'s AC with combat off, keeping the HP bar', () => {
    const sheet = effectiveSheet(def({ combat: { on: false } }));
    expect(fieldsOf(sheet).map((f) => f.id)).toEqual(['name', 'calling', 'hp', 'hp_max', 'grit']);
    expect(sheet.header).toEqual(SHEET.header);
  });

  it('are the design itself, untouched, when every part is on', () => {
    const definition = def({});
    expect(effectiveSheet(definition)).toBe(SHEET);
    effectiveSheet(def({ token_health: { on: false }, combat: { on: false } }));
    expect(SHEET.sections[1].fields.map((f) => f.id)).toEqual(['hp', 'hp_max']);
  });

  it('start with no health section when token health is off, whatever the model', () => {
    const starter = (parts, health) => effectiveSheet({ format: 1, name: 'A', parts, ...(health ? { core: { health } } : {}) });
    expect(starter({}).sections.map((s) => s.id)).toContain('health');
    const harm = { model: 'harm', levels: [{ id: 'lesser', label: 'LESSER', slots: 2 }] };
    expect(starter({}, harm).sections.map((s) => s.id)).toContain('harm');
    for (const health of [undefined, harm]) {
      const sheet = starter({ token_health: { on: false } }, health);
      expect(sheet.sections.map((s) => s.id)).not.toContain('health');
      expect(sheet.sections.map((s) => s.id)).not.toContain('harm');
      expect(sheet.header.hpField).toBeUndefined();
    }
    // Everything else stays: a cash field goes only with the bank.
    expect(ids({ format: 1, name: 'A', parts: { token_health: { on: false } } })).toContain('cash');
  });
});

let db;
beforeEach(async () => {
  db = await makeTestDb();
  const rows = [
    [NOHEALTH, def({ token_health: { on: false } }, { core: { health: { model: 'harm', levels: [{ id: 'lesser', label: 'LESSER' }] } } })],
    [HEALTHY, def({}, { core: { health: { model: 'harm', levels: [{ id: 'lesser', label: 'LESSER' }] } } })],
    [NOCOMBAT, def({ combat: { on: false } })],
  ];
  for (const [id, d] of rows) {
    const text = JSON.stringify(d);
    await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', [id, id, text, text]);
  }
  await new Promise((resolve) => runtime.load(db, resolve));
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const setSystem = (system) => run(db, `INSERT OR REPLACE INTO global_settings (key, value) VALUES ('game_system', ?)`, [system]);

describe('the running game', () => {
  it('has no health model while token health is off, and the system\'s own where it is on', () => {
    expect(runtime.health(NOHEALTH)).toEqual({ model: 'none' });
    expect(runtime.health(HEALTHY)).toMatchObject({ model: 'harm' });
    for (const system of BUILT_INS) expect(runtime.health(system), system).toBeNull();
  });

  it('sends the browser NPC layouts and rules without the parts turned off', () => {
    expect(runtime.render(NOHEALTH).npc.sheet.sections[0].fields.map((f) => f.id)).toEqual(['name', 'menace']);
    expect(runtime.render(NOHEALTH).sheet.header.hpField).toBeUndefined();
    expect(runtime.meta(NOHEALTH).linkedFields).toEqual({ ac: 'token_ac' });
    expect(runtime.meta(NOCOMBAT).linkedFields).toEqual({ hp: 'token_hp', hp_max: 'token_hp_max' });
    expect(runtime.render(HEALTHY).npc.sheet).toEqual(NPC_SHEET);
  });
});

describe('the health route', () => {
  const app = () => {
    const a = express();
    a.use(express.json());
    a.use('/api/locations', locationsRouteFactory(db, { emit: () => {} }, { emitUpdate: () => {}, recordAction: () => {} }));
    return a;
  };
  const hit = async (system) => {
    await setSystem(system);
    const { lastID } = await run(db, `INSERT INTO locations (name, x, y, z, shape, hp_current, hp_max) VALUES ('Ghoul', 0, 0, 0, 'enemy_rhombus', 10, 10)`);
    const res = await request(app()).put(`/api/locations/${lastID}/health`).set('Authorization', `Bearer ${GM}`).send({ hp_current: 4, hp_max: 10 });
    const after = (await get(db, 'SELECT hp_current FROM locations WHERE id = ?', [lastID])).hp_current;
    return { status: res.status, after };
  };

  it('refuses every action while the game has token health off', async () => {
    expect(await hit(NOHEALTH)).toEqual({ status: 409, after: 10 });
  });

  it('changes HP as before under the built-ins and a custom system that kept it', async () => {
    for (const system of [...BUILT_INS, NOCOMBAT]) expect(await hit(system), system).toEqual({ status: 200, after: 4 });
  });
});

describe('GENERATE_SHEET from a tier', () => {
  let nextId = 60;
  const generate = async (system) => {
    await setSystem(system);
    const locationId = (nextId += 1);
    await run(db, `INSERT INTO locations (id, name, x, y, z, shape, hp_current, hp_max, melee_ac, ranged_ac) VALUES (?, 'Bandit', 0, 0, 0, 'enemy_rhombus', 3, 3, 8, 8)`, [locationId]);
    let connect;
    socketsFactory({ on: (e, cb) => { if (e === 'connection') connect = cb; }, emit: () => {}, to: () => ({ emit: () => {} }) },
      db, { elevatedUsers: new Set(), emitUpdate: vi.fn(), recordAction: vi.fn() });
    const handlers = {};
    const sent = [];
    connect({ id: `hp-${locationId}`, on: (e, fn) => { handlers[e] = fn; }, emit: (e, d) => sent.push({ e, d }),
      broadcast: { emit: () => {} }, use: () => {}, join: () => {}, disconnect: () => {} });
    handlers.identify({ userName: 'gm', isAdmin: true, token: GM });
    await drain(db);
    handlers.generateNpcSheet({ location_id: locationId, tier: 'champion' });
    await untilValue(() => sent.find((s) => s.e === 'npcSheetGenerated'), Boolean, { label: 'the NPC sheet' });
    await drain(db);
    return get(db, 'SELECT hp_current, hp_max, melee_ac, ranged_ac FROM locations WHERE id = ?', [locationId]);
  };

  it('writes the tier\'s HP only with token health on, and its defense only with combat on', async () => {
    expect(await generate(HEALTHY)).toEqual({ hp_current: 30, hp_max: 30, melee_ac: 17, ranged_ac: 17 });
    expect(await generate(NOHEALTH)).toEqual({ hp_current: 3, hp_max: 3, melee_ac: 17, ranged_ac: 17 });
    expect(await generate(NOCOMBAT)).toEqual({ hp_current: 30, hp_max: 30, melee_ac: 8, ranged_ac: 8 });
  });
});
