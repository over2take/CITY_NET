/**
 * A custom system's blank PDF form (4h2b; approved mockup docs/mockups/sheet-import.html,
 * 2026-10-13): made from its own sheet, every box named by its field's id, a choice a dropdown, the
 * inventory as numbered lines; filled in and uploaded, every field comes back through the custom
 * importer. The running system's form for IMPORT, and a draft's for the builder.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { PDFDocument, PDFDropdown, PDFTextField } from 'pdf-lib';
import { createRequire } from 'module';
import { makeTestDb, run } from './helpers/testDb.js';

process.env.JWT_SECRET = 'test-secret';
const require_ = createRequire(import.meta.url);
const runtime = require_('../systemBuilder/runtime');
const { buildCustomTemplate, printable, hintOf, leftLine } = require_('../sheets/pdfTemplate');
const { extractPdfFields } = require_('../sheets/importers');
const { sheetFields, customImporter, INVENTORY_ROWS } = require_('../systemBuilder/sheetImport');
const sheetsRouteFactory = require_('../routes/sheets.js');
const systemsRoute = require_('../routes/systems.js');

const GM = jwt.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, 'test-secret');
const PLAYER = jwt.sign({ username: 'vex', role: 'player' }, 'test-secret');

const HEARTH = {
  format: 1, name: 'Hearth Fire',
  stats: [{ id: 'attrs', label: 'ATTRIBUTES', stats: [{ id: 'might', label: 'Might', min: 3, max: 20 }, { id: 'luck', label: 'Luck', min: 0 }, { id: 'grit', label: 'Grit', max: 5 }] }],
  derived: [{ id: 'defense', label: 'Defense', formula: '10 + @might' }],
  sheet: { tabs: ['MAIN', 'GEAR'], sections: [
    { id: 'who', label: 'IDENTITY', tab: 'MAIN', layout: 'list', fields: [
      { id: 'name', label: 'Name', type: 'text' },
      { id: 'calling', label: 'Calling', type: 'select', options: [{ value: 'knight', label: 'Knight' }, { value: 'hedge', label: 'Hedge mage' }] },
      { id: 'motto', label: 'Motto ★', type: 'text' },
      { id: 'background', label: 'Background', type: 'textarea' },
    ] },
    { id: 'attrs', label: 'ATTRIBUTES', tab: 'MAIN', layout: 'grid', fields: [
      { id: 'might', label: 'Might', type: 'number' }, { id: 'luck', label: 'Luck', type: 'number' }, { id: 'grit', label: 'Grit', type: 'number' },
      { id: 'defense', label: 'Defense', type: 'number' },
      { id: 'hp', label: 'HP', type: 'number', source: 'token_hp' },
    ] },
    { id: 'gear', label: 'GEAR', tab: 'GEAR', layout: 'inventory', fields: [] },
    { id: 'gm', label: 'GM', tab: 'GEAR', layout: 'notes', fields: [{ id: 'wound_notes', label: 'Wound notes', type: 'textarea', edit: 'gm' }] },
  ] },
};

const formOf = async (buffer) => (await PDFDocument.load(buffer)).getForm();

describe('the form', () => {
  it('has a box for every field a player fills in, by id, a dropdown for a choice, and the inventory\'s lines', async () => {
    const form = await formOf(await buildCustomTemplate(HEARTH));
    const names = form.getFields().map((f) => f.getName());
    const rows = Array.from({ length: INVENTORY_ROWS }, (_, i) => [`inventory_${i + 1}_name`, `inventory_${i + 1}_qty`]).flat();
    expect(names).toEqual(['name', 'calling', 'motto', 'background', 'might', 'luck', 'grit', ...rows]);
    expect(form.getField('calling')).toBeInstanceOf(PDFDropdown);
    expect(form.getDropdown('calling').getOptions()).toEqual(['Knight', 'Hedge mage']);
    expect(form.getField('name')).toBeInstanceOf(PDFTextField);
    expect(form.getTextField('background').isMultiline()).toBe(true);
    expect(form.getTextField('name').isMultiline()).toBe(false);
    for (const left of ['defense', 'hp', 'wound_notes', 'inventory']) expect(names, left).not.toContain(left);
    expect(INVENTORY_ROWS).toBe(12);
  });

  it('comes back through the importer, every field, filled in', async () => {
    const doc = await PDFDocument.load(await buildCustomTemplate(HEARTH));
    const form = doc.getForm();
    form.getTextField('name').setText('Vex Marrow');
    form.getDropdown('calling').select('Hedge mage');
    form.getTextField('motto').setText('Onward');
    form.getTextField('background').setText('Raised by wolves.\nLeft them.');
    form.getTextField('might').setText('14');
    form.getTextField('luck').setText('2');
    form.getTextField('grit').setText('5');
    form.getTextField('inventory_1_name').setText('Rope');
    form.getTextField('inventory_1_qty').setText('2');
    form.getTextField('inventory_3_name').setText('Lantern');
    form.getTextField('inventory_4_qty').setText('9');
    const raw = await extractPdfFields(Buffer.from(await doc.save()));
    const { mapped, unmapped } = customImporter(HEARTH).mapFields(raw);
    expect(unmapped).toEqual({});
    expect(mapped).toEqual({
      name: 'Vex Marrow', calling: 'hedge', motto: 'Onward', background: 'Raised by wolves.\nLeft them.',
      might: 14, luck: 2, grit: 5,
      inventory: JSON.stringify([{ name: 'Rope', qty: 2 }, { name: 'Lantern', qty: 1 }]),
    });
    // Every field the form asks for has been round-tripped above.
    expect(sheetFields(HEARTH).ask.map((f) => f.id).sort()).toEqual(['background', 'calling', 'grit', 'inventory', 'luck', 'might', 'motto', 'name']);
  });

  it('reads nothing back from a form left blank', async () => {
    const raw = await extractPdfFields(await buildCustomTemplate(HEARTH));
    expect(customImporter(HEARTH).mapFields(raw).mapped).toEqual({});
  });

  it('runs onto more pages as a sheet grows, and draws a sheet with no tabs, no inventory and nothing left', async () => {
    const many = { format: 1, name: 'Long', sheet: { sections: [{ id: 's', label: 'S', layout: 'list', fields: Array.from({ length: 80 }, (_, i) => ({ id: `f${i}`, label: `Field ${i}`, type: i % 7 === 0 ? 'textarea' : 'text' })) }] } };
    const doc = await PDFDocument.load(await buildCustomTemplate(many));
    expect(doc.getPageCount()).toBeGreaterThan(1);
    expect(doc.getForm().getFields()).toHaveLength(80);
    expect(doc.getTitle()).toBe('LONG character sheet');
    const named = await PDFDocument.load(await buildCustomTemplate(many, { name: 'Other', version: 4 }));
    expect(named.getTitle()).toBe('OTHER character sheet');
  });

  it('draws what a GM typed in any language, as far as the font can', () => {
    expect(printable('Motto ★ é → x')).toBe('Motto ? é ? x');
    expect(printable(null)).toBe('');
  });
});

describe('the words on it', () => {
  it('a choice\'s options and a stat\'s range under its box', () => {
    const [, calling, , , might, luck, grit] = sheetFields(HEARTH).ask;
    expect(hintOf(calling)).toBe('One of: Knight, Hedge mage');
    expect(hintOf(might)).toBe('3 to 20');
    expect(hintOf(luck)).toBe('At least 0');
    expect(hintOf(grit)).toBe('At most 5');
    expect(hintOf({ type: 'text' })).toBe('');
  });

  it('what is not on it, and why, at the foot', () => {
    expect(leftLine(sheetFields(HEARTH).left)).toBe('Not on this form: Defense (worked out by the game); HP (kept elsewhere in CITY_NET); Wound notes (filled in by the GM).');
    expect(leftLine([{ label: 'Gold', why: 'elsewhere' }, { label: 'HP', why: 'elsewhere' }])).toBe('Not on this form: Gold, HP (kept elsewhere in CITY_NET).');
    expect(leftLine([])).toBe('');
  });
});

describe('through the routes', () => {
  const ID = 'sys_aaaaaaaaaaaaaaaa';
  const SHUT = 'sys_bbbbbbbbbbbbbbbb';
  let db;
  let app;
  const running = (system) => run(db, `INSERT OR REPLACE INTO global_settings (key, value) VALUES ('game_system', ?)`, [system]);

  beforeEach(async () => {
    db = await makeTestDb();
    for (const [id, def] of [[ID, HEARTH], [SHUT, { ...HEARTH, name: 'Shut', parts: { sheet_import: { on: false } } }]]) {
      const text = JSON.stringify(def);
      await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 3)', [id, def.name, text, text]);
    }
    await new Promise((resolve) => runtime.load(db, resolve));
    await running(ID);
    app = express();
    app.use(express.json());
    app.use('/api/sheets', sheetsRouteFactory(db, { emit: () => {} }));
    app.use('/api/systems', systemsRoute(db, { emit: () => {} }));
  });

  const pdf = (req) => req.buffer(true).parse((res, cb) => { const chunks = []; res.on('data', (c) => chunks.push(c)); res.on('end', () => cb(null, Buffer.concat(chunks))); });

  it('IMPORT hands out the running system\'s form, named for it', async () => {
    const res = await pdf(request(app).get('/api/sheets/import/template.pdf'));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toBe('application/pdf');
    expect(res.headers['content-disposition']).toBe('attachment; filename="citynet-hearth-fire-import.pdf"');
    const doc = await PDFDocument.load(res.body);
    expect(doc.getForm().getFields().map((f) => f.getName())).toContain('calling');
    expect(doc.getTitle()).toBe('HEARTH FIRE character sheet');
  });

  it('not with SHEET IMPORT off; the built-in games\' forms as they were', async () => {
    await running(SHUT);
    expect((await request(app).get('/api/sheets/import/template.pdf')).body).toEqual({ error: `No import form for ${SHUT} yet` });
    await running('cities_without_number');
    const cwn = await pdf(request(app).get('/api/sheets/import/template.pdf'));
    expect(cwn.headers['content-disposition']).toBe('attachment; filename="citynet-cities_without_number-import.pdf"');
    expect((await PDFDocument.load(cwn.body)).getForm().getFields().map((f) => f.getName())).toContain('Strength');
    await running('generic');
    expect((await request(app).get('/api/sheets/import/template.pdf')).status).toBe(400);
  });

  it('the builder draws a draft\'s form for the main admin', async () => {
    const draft = { ...HEARTH, sheet: { sections: [{ id: 's', label: 'S', layout: 'list', fields: [{ id: 'oath', label: 'Oath', type: 'text' }] }] } };
    const res = await pdf(request(app).post('/api/systems/form.pdf').set('Authorization', `Bearer ${GM}`).send({ definition: draft }));
    expect(res.status).toBe(200);
    expect(res.headers['content-disposition']).toBe('attachment; filename="citynet-draft-form.pdf"');
    expect((await PDFDocument.load(res.body)).getForm().getFields().map((f) => f.getName())).toEqual(['oath']);
    expect((await request(app).post('/api/systems/form.pdf').set('Authorization', `Bearer ${PLAYER}`).send({ definition: draft })).status).toBe(403);
    expect((await request(app).post('/api/systems/form.pdf').set('Authorization', `Bearer ${GM}`).send({ definition: 'nope' })).status).toBe(400);
  });
});
