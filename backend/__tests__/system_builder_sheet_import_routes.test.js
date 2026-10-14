/**
 * IMPORT for a custom system, through the routes (4h2a; approved mockup
 * docs/mockups/sheet-import.html, 2026-10-13): the JSON template a player downloads, and the preview
 * reading it back (or a pasted stat block) with what was left and why. Only while the system has
 * SHEET IMPORT on; the built-in games' imports are as they were.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { createRequire } from 'module';
import { makeTestDb, run } from './helpers/testDb.js';

const require_ = createRequire(import.meta.url);
const runtime = require_('../systemBuilder/runtime');
const sheetsRouteFactory = require_('../routes/sheets.js');
const { getImporter } = require_('../sheets/importers.js');

const HEARTH = 'sys_aaaaaaaaaaaaaaaa';
const SHUT = 'sys_bbbbbbbbbbbbbbbb';
const DEF = {
  format: 1, name: 'Hearth Fire',
  stats: [{ id: 'attrs', label: 'ATTRIBUTES', stats: [{ id: 'might', label: 'Might', min: 3, max: 20 }] }],
  derived: [{ id: 'defense', label: 'Defense', formula: '10 + @might' }],
  sheet: { tabs: ['MAIN'], sections: [
    { id: 'who', label: 'IDENTITY', tab: 'MAIN', layout: 'list', fields: [
      { id: 'name', label: 'Name', type: 'text' },
      { id: 'calling', label: 'Calling', type: 'select', options: [{ value: 'knight', label: 'Knight' }] },
      { id: 'might', label: 'Might', type: 'number' },
      { id: 'defense', label: 'Defense', type: 'number' },
      { id: 'hp', label: 'HP', type: 'number', source: 'token_hp' },
    ] },
  ] },
};

let db;
let app;
const running = (system) => run(db, `INSERT OR REPLACE INTO global_settings (key, value) VALUES ('game_system', ?)`, [system]);

beforeEach(async () => {
  db = await makeTestDb();
  for (const [id, def] of [[HEARTH, DEF], [SHUT, { ...DEF, name: 'Shut', parts: { sheet_import: { on: false } } }]]) {
    const text = JSON.stringify(def);
    await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 3)', [id, def.name, text, text]);
  }
  await new Promise((resolve) => runtime.load(db, resolve));
  await running(HEARTH);
  app = express();
  app.use(express.json());
  app.use('/api/sheets', sheetsRouteFactory(db, { emit: () => {} }));
});

const preview = (body) => request(app).post('/api/sheets/import/preview').send(body);

describe('the JSON template', () => {
  it('is the running system\'s, to download, named for it', async () => {
    const res = await request(app).get('/api/sheets/import/template.json');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.headers['content-disposition']).toBe('attachment; filename="citynet-hearth-fire-import.json"');
    const template = JSON.parse(res.text);
    expect(template).toMatchObject({ system: 'Hearth Fire', version: 3, fields: { name: '', calling: '', might: null } });
    expect(Object.keys(template.fields)).toEqual(['name', 'calling', 'might']);
    expect(res.text).toContain('\n  "system"');
  });

  it('isn\'t offered with SHEET IMPORT off, or for a built-in game', async () => {
    await running(SHUT);
    expect((await request(app).get('/api/sheets/import/template.json')).status).toBe(400);
    await running('cities_without_number');
    expect((await request(app).get('/api/sheets/import/template.json')).body).toEqual({ error: 'No JSON template for cities_without_number' });
  });

  it('falls back to a plain file name for a name with nothing to spell it', async () => {
    const odd = { ...DEF, name: '!!!' };
    await run(db, 'UPDATE custom_systems SET name = ?, published = ? WHERE id = ?', ['!!!', JSON.stringify(odd), HEARTH]);
    await new Promise((resolve) => runtime.refresh(db, HEARTH, resolve));
    expect((await request(app).get('/api/sheets/import/template.json')).headers['content-disposition']).toBe('attachment; filename="citynet-system-import.json"');
  });
});

describe('the preview', () => {
  it('reads the filled-in template back, saying what it left and why', async () => {
    const template = JSON.parse((await request(app).get('/api/sheets/import/template.json')).text);
    template.fields.name = 'Vex';
    template.fields.might = 14;
    template.fields.calling = 'Paladin';
    template.fields.defense = 18;
    template.fields.hp = 12;
    template.fields.colour = 'Teal';
    const res = await preview({ json: JSON.stringify(template) });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      system: HEARTH, source: 'json',
      mapped: { name: 'Vex', might: 14 },
      unmapped: { colour: 'Teal' },
      skipped: { hp: 12 },
      workedOut: { defense: 18 },
      gmOnly: {},
      notAChoice: { calling: 'Paladin' },
    });
  });

  it('reads a pasted stat block', async () => {
    expect((await preview({ text: 'Name: Vex\nMight 14  Calling Knight' })).body).toMatchObject({
      source: 'text', mapped: { name: 'Vex', might: 14, calling: 'knight' },
    });
  });

  it('isn\'t there with SHEET IMPORT off', async () => {
    await running(SHUT);
    expect((await preview({ text: 'Might 14' })).body).toEqual({ error: `No importer for ${SHUT} yet` });
    expect(getImporter(SHUT)).toBeNull();
    expect(getImporter('sys_cccccccccccccccc')).toBeNull();
  });

  it('leaves the built-in games\' importers as they were', async () => {
    await running('cyberpunk_red');
    const res = await preview({ text: 'REF 7' });
    expect(res.body).toMatchObject({ system: 'cyberpunk_red', mapped: { ref: 7 } });
    expect(res.body).not.toHaveProperty('workedOut');
  });
});
