import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createRequire } from 'module';
import { makeTestDb, get, run } from './helpers/testDb.js';
import { untilValue, drain } from './helpers/until.js';

/**
 * A published custom system, running in the game.
 *
 * Its sheet is plain data drawn by the ordinary renderer; the server answers for it through the
 * same helpers the built-in systems use - which fields are public, linked, paired - and
 * recomputes its derived values on every save. The browser gets a render copy with no formulas.
 */

process.env.JWT_SECRET = 'test-secret';
process.env.DICE_ANIM_MS = '0';
const require_ = createRequire(import.meta.url);
const { checkSheet, effectiveSheet } = require_('../systemBuilder/sheet');
const { checkDefinition } = require_('../systemBuilder/definition');
const runtime = require_('../systemBuilder/runtime');
const templates = require_('../sheets/templates');
const socketsFactory = require_('../sockets/index.js');

const GM = jwt.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, 'test-secret');
const gm = { Authorization: `Bearer ${GM}` };

/** A small but real system: two abilities, a lookup, derived values, and a sheet that uses them. */
const VAULT = {
  format: 1,
  name: 'Vault Knights',
  words: { hp: { singular: 'WOUND', plural: 'WOUNDS' } },
  lookups: { mod: { bands: [{ upTo: 9, value: -1 }, { upTo: 13, value: 0 }, { value: 1 }] } },
  derived: [
    { id: 'might_mod', formula: 'mod(@might)' },
    { id: 'guard', formula: '10 + @might_mod + @armor' },
  ],
  sheet: {
    tabs: ['KNIGHT', 'NOTES'],
    header: { nameField: 'name', hpField: 'wounds', hpMaxField: 'wounds_max', chips: [{ field: 'guard', label: 'GUARD' }] },
    sections: [
      { id: 'who', label: 'WHO', layout: 'list', tab: 'KNIGHT', fields: [
        { id: 'name', label: 'Name', type: 'text', visibility: 'public' },
        { id: 'order', label: 'Order', type: 'select', options: [{ value: 'dawn', label: 'Dawn' }, { value: 'dusk', label: 'Dusk' }] },
      ] },
      { id: 'stats', label: 'STATS', layout: 'grid', tab: 'KNIGHT', columns: 4, fields: [
        { id: 'might', label: 'MIGHT', type: 'number' },
        { id: 'might_mod', label: 'MOD', type: 'number' },
        { id: 'armor', label: 'ARMOR', type: 'number', sensitivity: 'combat', source: 'token_ac' },
        { id: 'guard', label: 'GUARD', type: 'number', sensitivity: 'combat' },
        { id: 'wounds', label: 'WOUNDS', type: 'number', source: 'token_hp', maxField: 'wounds_max' },
        { id: 'wounds_max', label: 'MAX', type: 'number', source: 'token_hp_max' },
      ] },
      { id: 'purse', label: 'PURSE', layout: 'list', tab: 'KNIGHT', fields: [{ id: 'gold', label: 'Gold', type: 'number', source: 'bank_balance' }] },
      { id: 'notes', label: 'NOTES', layout: 'notes', tab: 'NOTES', fields: [{ id: 'notes', label: 'Notes', type: 'textarea' }] },
    ],
  },
};

const problemsOf = (sheet, derived = []) => {
  const problems = [];
  checkSheet(sheet, new Set(derived), problems);
  return problems.map((p) => `${p.where}: ${p.message}`);
};

describe('the sheet format', () => {
  it('accepts a real sheet', () => {
    expect(checkDefinition(VAULT)).toEqual({ problems: [] });
  });

  it('gives a system with no sheet a starter one that passes its own checks and shows its derived values', () => {
    const bare = { format: 1, name: 'Bare', derived: [{ id: 'speed', formula: '6' }] };
    const sheet = effectiveSheet(bare);
    expect(checkDefinition({ ...bare, sheet })).toEqual({ problems: [] });
    const derived = sheet.sections.find((s) => s.id === 'derived');
    expect(derived.fields.map((f) => f.id)).toEqual(['speed']);
    expect(effectiveSheet(VAULT)).toBe(VAULT.sheet);
  });

  it('reports every mistake, with where it is', () => {
    expect(problemsOf({
      tabs: ['A'],
      header: { nameField: 'nope', chips: [{ field: 'x' }] },
      sections: [
        { id: 'one', label: 'ONE', layout: 'cards', tab: 'B', columns: 9, fields: [
          { id: 'a', label: 'A', type: 'dice' },
          { id: 'a', label: 'Again', type: 'text' },
          { id: 'b', label: 'B', type: 'text', options: [{ value: 'x', label: 'X' }] },
          { id: 'c', label: 'C', type: 'select' },
          { id: 'd', label: 'D', type: 'number', sensitivity: 'combat', visibility: 'public', maxField: 'zz' },
          { id: 'e', label: 'E', type: 'number', source: 'token_mana' },
          { id: 'f', label: 'F', type: 'number', source: 'token_hp' },
          { id: 'g', label: 'G', type: 'number', onClick: 'x' },
        ] },
        { id: 'one', label: '', layout: 'list', fields: [] },
      ],
    }, ['f'])).toEqual([
      'sheet section one, layout: One of list, grid, notes, inventory',
      'sheet section one, tab: Not one of the sheet\'s tabs',
      'sheet section one, columns: A whole number from 1 to 8',
      'sheet field a, type: One of number, text, textarea, select',
      'sheet field a: Defined twice',
      'sheet field b, options: Only a select field has options',
      'sheet field c, options: A select field needs options',
      'sheet field d: A combat value is never public',
      'sheet field e, source: One of token_hp, token_hp_max, token_ac, bank_balance',
      'sheet field f: Cannot be both a derived value and a linked one',
      'sheet field g, onClick: Not part of a field',
      'sheet section one: Defined twice',
      'sheet section one, label: Cannot be blank',
      'sheet field d, maxField: Not a field on this sheet',
      'sheet header nameField: Not a field on this sheet',
      'sheet header chip 1: Must name a field on this sheet',
    ]);
  });

  it('refuses a sheet that is not a layout', () => {
    expect(problemsOf('columns')).toEqual(['sheet: Must be a layout']);
    expect(problemsOf({ sections: 'x' })).toEqual(['sheet sections: Must be a list of sections']);
  });
});

describe('a published system, in the running game', () => {
  let db;
  let app;
  let id;
  const emitted = [];

  beforeEach(async () => {
    db = await makeTestDb();
    await run(db, `INSERT INTO global_settings (key, value) VALUES ('game_system', 'cities_without_number')`);
    emitted.length = 0;
    const io = { emit: (event, data) => emitted.push({ event, data }), to: () => ({ emit: () => {} }) };
    app = express();
    app.use(express.json({ limit: '2mb' }));
    app.use('/api/systems', require_('../routes/systems.js')(db));
    app.use('/api/sheets', require_('../routes/sheets.js')(db, io));
    id = (await request(app).post('/api/systems').set(gm).send({ definition: VAULT })).body.id;
    await new Promise((resolve) => runtime.load(db, resolve));
  });
  afterEach(() => vi.restoreAllMocks());

  const publish = () => request(app).post(`/api/systems/${id}/publish`).set(gm);

  it('is only known to the game once published', async () => {
    expect(templates.isValidSystem(id)).toBe(false);
    expect((await request(app).get(`/api/systems/render/${id}`)).status).toBe(404);
    expect((await request(app).put('/api/sheets/system').set(gm).send({ system: id })).status).toBe(400);

    await publish();
    expect(templates.isValidSystem(id)).toBe(true);
    expect((await request(app).get('/api/sheets/system')).body.systems).toContainEqual({ id, name: 'Vault Knights', custom: true });
  });

  it('answers the same questions the built-in systems do', async () => {
    await publish();
    expect(templates.getLinkedFields(id)).toEqual({ armor: 'token_ac', wounds: 'token_hp', wounds_max: 'token_hp_max', gold: 'bank_balance' });
    expect(templates.getMaxPairs(id)).toEqual({ wounds_max: 'wounds' });
    expect(templates.filterPublicData(id, { name: 'Sir Ash', might: 15, guard: 12, notes: 'secret' })).toEqual({ name: 'Sir Ash' });
    const data = { might: 15, armor: 3, guard: 99 };
    expect(templates.applyDerived(id, data)).toEqual(['might_mod', 'guard']);
    expect(data).toMatchObject({ might_mod: 1, guard: 14 });
  });

  it('leaves the built-in systems exactly as they were', async () => {
    const before = JSON.stringify(['cities_without_number', 'cyberpunk_red', 'shadowrun_6e', 'generic']
      .map((s) => [templates.getLinkedFields(s), templates.getMaxPairs(s)]));
    await publish();
    const after = JSON.stringify(['cities_without_number', 'cyberpunk_red', 'shadowrun_6e', 'generic']
      .map((s) => [templates.getLinkedFields(s), templates.getMaxPairs(s)]));
    expect(after).toBe(before);
  });

  it('gives the browser its layout and words, never its formulas', async () => {
    await publish();
    const res = await request(app).get(`/api/systems/render/${id}`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id, name: 'Vault Knights', derived: ['might_mod', 'guard'], words: VAULT.words });
    expect(res.body.sheet).toEqual(VAULT.sheet);
    const text = JSON.stringify(res.body);
    expect(text).not.toContain('@might');
    expect(text).not.toContain('bands');
  });

  it('can be switched to from the system picker', async () => {
    await publish();
    const res = await request(app).put('/api/sheets/system').set(gm).send({ system: id });
    expect(res.status).toBe(200);
    expect((await get(db, `SELECT value FROM global_settings WHERE key = 'game_system'`)).value).toBe(id);
  });

  it('goes away from the game when deleted', async () => {
    await publish();
    expect((await request(app).delete(`/api/systems/${id}`).set(gm)).status).toBe(200);
    expect(templates.isValidSystem(id)).toBe(false);
    expect((await request(app).get(`/api/systems/render/${id}`)).status).toBe(404);
  });

  it('runs the published copy, not the draft being worked on', async () => {
    await publish();
    const draft = { ...VAULT, derived: [{ id: 'might_mod', formula: '100' }, { id: 'guard', formula: '0' }] };
    await request(app).put(`/api/systems/${id}/draft`).set(gm).send({ definition: draft });
    const data = { might: 15, armor: 3 };
    templates.applyDerived(id, data);
    expect(data.might_mod).toBe(1);
  });

  it("recomputes a player's derived values when they edit their sheet", async () => {
    await publish();
    await request(app).put('/api/sheets/system').set(gm).send({ system: id });
    await run(db, `INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('GHOST', ?, '{"might":10}', 0)`, [id]);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    let connect;
    socketsFactory({ on: (e, cb) => { if (e === 'connection') connect = cb; }, emit: () => {}, to: () => ({ emit: () => {} }) },
      db, { elevatedUsers: new Set(), emitUpdate: vi.fn(), recordAction: vi.fn() });
    const handlers = {};
    connect({ id: `rt-${Math.random()}`, on: (e, fn) => { handlers[e] = fn; }, emit: () => {}, broadcast: { emit: () => {} }, use: () => {}, join: () => {}, disconnect: () => {} });
    handlers.identify('GHOST');
    await drain(db);
    // Armor lives on the token (a linked field), so it is never in the saved data: the save
    // works from what is stored, and a read lays the token's armor over it and recomputes.
    handlers.updateSheetField({ fieldId: 'might', value: 16 });
    const stored = await untilValue(
      async () => JSON.parse((await get(db, 'SELECT data FROM character_sheets WHERE username = ? AND system = ?', ['GHOST', id])).data),
      (d) => d.might === 16, { label: 'the saved sheet' });
    expect(stored).toMatchObject({ might: 16, might_mod: 1, guard: 11 });
  });
});
