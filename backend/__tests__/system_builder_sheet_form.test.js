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
const { sheetFields, customImporter, jsonTemplate, xpLines, xpFrom, INVENTORY_ROWS } = require_('../systemBuilder/sheetImport');
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

describe('picks on the form (7c6)', () => {
  const PICKS = { ...HEARTH, ...{
    format: 1, name: 'Picks',
    stats: [{ id: 'traits', label: 'TRAITS', stats: [{ id: 'wits', label: 'Wits', min: 1, max: 20 }] }],
    choices: [
      { id: 'classes', one: 'Class', many: 'Classes', levelled: true, options: [
        { id: 'soldier', label: 'Soldier' }, { id: 'mage', label: 'Mage', requires: '@wits >= 13' },
      ] },
      { id: 'feats', one: 'Feat', many: 'Feats', picks: 2, options: [
        { id: 'tough', label: 'Tough' }, { id: 'quick', label: 'Quick' }, { id: 'keen', label: 'Keen' },
      ] },
      { id: 'skills', one: 'Skill', many: 'Skills', again: true, levelled: true, options: [
        { id: 'cook', label: 'Cook' }, { id: 'rank2', label: 'Rank 2' }, { id: 'sail', label: 'Sail' },
      ] },
      { id: 'specs', one: 'Specialty', many: 'Specialties', picked: 'features', options: [{ id: 'duelist', label: 'Duelist' }] },
      { id: 'commons', one: 'Common', many: 'Commons', picked: 'everyone', options: [{ id: 'breath', label: 'Breath' }] },
      { id: 'empty', one: 'Nothing', many: 'Nothings', options: [] },
    ],
  }, stats: HEARTH.stats, name: 'Hearth Fire' };

  it('has a dropdown for a list picked once, a level box, and a box for names', async () => {
    const form = await formOf(await buildCustomTemplate(PICKS));
    expect(form.getField('pick_classes')).toBeInstanceOf(PDFDropdown);
    expect(form.getDropdown('pick_classes').getOptions()).toEqual(['Soldier', 'Mage']);
    expect(form.getField('pick_classes_level')).toBeInstanceOf(PDFTextField);
    expect(form.getField('pick_feats')).toBeInstanceOf(PDFTextField);
    const names = form.getFields().map((f) => f.getName());
    expect(names).toContain('pick_skills');
    for (const not of ['pick_specs', 'pick_commons', 'pick_empty']) expect(names).not.toContain(not);
    // After the sheet's own.
    expect(names.indexOf('pick_classes')).toBeGreaterThan(names.indexOf('inventory_12_qty'));
  });

  it('comes back through the importer, picks and all, filled in', async () => {
    const doc = await PDFDocument.load(await buildCustomTemplate(PICKS));
    const form = doc.getForm();
    form.getTextField('name').setText('Vex Marrow');
    form.getDropdown('pick_classes').select('Mage');
    form.getTextField('pick_classes_level').setText('3');
    form.getTextField('pick_feats').setText('Tough, Keen');
    form.getTextField('pick_skills').setText('Cook 2, Sail');
    const raw = await extractPdfFields(Buffer.from(await doc.save()));
    const { mapped, picks, picksSaid, picksNotFound } = customImporter(PICKS).mapFields(raw);
    expect(mapped.name).toBe('Vex Marrow');
    expect(picks).toEqual({
      classes: [{ option: 'mage', level: 3 }],
      feats: [{ option: 'tough' }, { option: 'keen' }],
      skills: [{ option: 'cook', level: 2 }, { option: 'sail', level: 1 }],
    });
    expect(picksSaid.map((p) => p.option)).toEqual(['Mage', 'Tough', 'Keen', 'Cook', 'Sail']);
    expect(picksNotFound).toBeUndefined();
  });

  it('left blank, a form names no picks', async () => {
    const raw = await extractPdfFields(await buildCustomTemplate(PICKS));
    const read = customImporter(PICKS).mapFields(raw);
    expect(read.picks).toBeUndefined();
    expect(read.picksNotFound).toBeUndefined();
    expect(Object.keys(read.unmapped)).toEqual([]);
  });

  it('prints how to write the names under their box', () => {
    expect(hintOf({ type: 'text', hint: 'Names, commas between: A, B' })).toBe('Names, commas between: A, B');
  });
});

describe('XP on the form (7d2c)', () => {
  const MARKS = { ...HEARTH, core: { advancement: ['levels'] }, levels: { top: 5 }, words: { xp: { singular: 'MARK', plural: 'MARKS', short: 'MK' } },
    choices: [{ id: 'classes', one: 'Class', many: 'Classes', levelled: true, options: [{ id: 'soldier', label: 'Soldier' }] }] };

  it('a box under the game\'s word, after the sheet\'s own and before the picks, only where they earn it', async () => {
    const names = (await formOf(await buildCustomTemplate(MARKS))).getFields().map((f) => f.getName());
    expect(names.indexOf('_xp')).toBe(names.indexOf('inventory_12_qty') + 1);
    expect(names.indexOf('pick_classes')).toBe(names.indexOf('_xp') + 1);
    expect(xpLines(MARKS)).toEqual([expect.objectContaining({ id: '_xp', label: 'MK', type: 'number', min: 0, section: 'LEVELS' })]);
    for (const none of [HEARTH, { ...MARKS, core: { advancement: ['milestone'] } }, { ...MARKS, parts: { xp: { on: false } } }]) {
      expect(xpLines(none)).toEqual([]);
      expect((await formOf(await buildCustomTemplate(none))).getFields().map((f) => f.getName())).not.toContain('_xp');
    }
    expect(xpLines({ ...MARKS, words: {} })[0].label).toBe('XP');
  });

  it('says what goes in it, and the JSON template asks for it too', () => {
    expect(hintOf(xpLines(MARKS)[0])).toBe('What they have so far. Left empty, it stays as it is');
    const template = jsonTemplate(MARKS);
    const keys = Object.keys(template.fields);
    expect(template.fields._xp).toBeNull();
    expect(template.help._xp).toBe('MK. What they have so far. Left empty, it stays as it is');
    expect(keys.indexOf('_xp')).toBe(keys.indexOf('pick_classes') - 1);
    expect(keys.indexOf('_xp')).toBeGreaterThan(keys.indexOf('grit'));
    expect(jsonTemplate(HEARTH).fields._xp).toBeUndefined();
  });

  it('comes back through the importer, filled in, and left blank brings nothing', async () => {
    const doc = await PDFDocument.load(await buildCustomTemplate(MARKS));
    doc.getForm().getTextField('_xp').setText('6,500');
    expect(customImporter(MARKS).mapFields(await extractPdfFields(Buffer.from(await doc.save()))).mapped._xp).toBe(6500);
    const blank = customImporter(MARKS).mapFields(await extractPdfFields(await buildCustomTemplate(MARKS)));
    expect(blank.mapped._xp).toBeUndefined();
    expect(blank.unmapped).toEqual({});
  });

  it('read by its word, its other forms, XP or its id; what isn\'t a whole amount is said, not taken', () => {
    const read = (raw) => customImporter(MARKS).mapFields(raw);
    for (const key of ['MK', 'Marks', 'mark', 'XP', '_xp']) expect(read({ [key]: 250 }).mapped._xp, key).toBe(250);
    for (const bad of [-1, 1.5, 'lots', true, 1e13]) {
      const r = read({ MK: bad });
      expect(r.mapped._xp, String(bad)).toBeUndefined();
      expect(r.unmapped, String(bad)).toEqual({ MK: bad });
    }
    expect(read({ MK: ' 1 200 ' }).mapped._xp).toBe(1200);
    expect(customImporter(MARKS).parseText('Might 12\nMK 300').MK ?? customImporter(MARKS).parseText('Might 12\nMK 300')._xp).toBe('300');
    // Where nothing earns it, XP is just a name the sheet doesn't have.
    expect(customImporter(HEARTH).mapFields({ XP: 5 }).unmapped).toEqual({ XP: 5 });
  });

  it('a stat of the sheet\'s own called XP stays the stat', () => {
    const own = { ...MARKS, stats: [{ id: 'a', label: 'A', stats: [{ id: 'xp', label: 'XP' }] }],
      sheet: { sections: [{ id: 's', label: 'S', layout: 'grid', fields: [{ id: 'xp', label: 'XP', type: 'number' }] }] } };
    expect(customImporter(own).mapFields({ XP: 7 }).mapped).toEqual({ xp: 7 });
  });

  it('a whole amount, in range', () => {
    expect([0, 12, '7', '6,500', 1e12].map(xpFrom)).toEqual([0, 12, 7, 6500, 1e12]);
    expect([-1, 2.5, '', ' ', 'x', null, undefined, {}, [5], true, 1e12 + 1].map(xpFrom)).toEqual(Array(11).fill(null));
  });
});

describe('the GM uploading picks to a player\'s sheet (7c6)', () => {
  const ID = 'sys_aaaaaaaaaaaaaaaa';
  const LISTED = { format: 1, name: 'Listed', stats: [{ id: 'attrs', label: 'ATTRIBUTES', stats: [{ id: 'might', label: 'Might' }] }], choices: [
    { id: 'classes', one: 'Class', many: 'Classes', levelled: true, options: [{ id: 'soldier', label: 'Soldier', features: [{ id: 'guard', label: 'Guard', modifiers: [{ target: 'might', amount: '1' }] }] }, { id: 'mage', label: 'Mage' }] },
  ] };
  let db;
  let app;
  const put = (body) => request(app).put('/api/sheets/user/vex').set('Authorization', `Bearer ${GM}`).send(body);
  const stored = async () => JSON.parse((await new Promise((resolve, reject) => db.get('SELECT data FROM character_sheets WHERE username = ?', ['vex'], (e, row) => (e ? reject(e) : resolve(row))))).data);

  beforeEach(async () => {
    db = await makeTestDb();
    const text = JSON.stringify(LISTED);
    await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 3)', [ID, LISTED.name, text, text]);
    await new Promise((resolve) => runtime.load(db, resolve));
    await run(db, `INSERT OR REPLACE INTO global_settings (key, value) VALUES ('game_system', ?)`, [ID]);
    await run(db, 'INSERT INTO character_sheets (username, system, data, is_npc) VALUES (?, ?, ?, 0)', ['vex', ID, JSON.stringify({ name: 'Vex', _choices: { classes: [{ option: 'mage', level: 1, locked: true, roll: 4 }] } })]);
    app = express();
    app.use(express.json());
    app.use('/api/sheets', sheetsRouteFactory(db, { emit: () => {} }));
  });

  it('writes them, replacing a locked pick, and works out what they do', async () => {
    const res = await put({ fields: { might: 5 }, upload: true, picks: { classes: [{ option: 'soldier', level: 2 }] } });
    expect(res.status).toBe(200);
    const data = await stored();
    expect(data.might).toBe(5);
    expect(data._choices.classes).toEqual([{ option: 'soldier', level: 2 }]);
    expect(data._worked.picks).toEqual([{ list: 'classes', option: 'soldier', level: 2 }]);
  });

  it('an edit with no picks leaves them as they were', async () => {
    await put({ fields: { might: 5 } });
    expect((await stored())._choices.classes).toEqual([{ option: 'mage', level: 1, locked: true, roll: 4 }]);
  });

  it('an upload naming no picks clears them; an edit naming picks doesn\'t touch them', async () => {
    await put({ fields: {}, picks: { classes: [{ option: 'soldier' }] } });
    expect((await stored())._choices.classes).toEqual([{ option: 'mage', level: 1, locked: true, roll: 4 }]);
    await put({ fields: {}, upload: true });
    expect((await stored())._choices.classes).toEqual([]);
  });

  it('an upload adds to the inventory, where an edit replaces it', async () => {
    const bag = (v) => run(db, 'UPDATE character_sheets SET data = ? WHERE username = ?', [JSON.stringify({ name: 'Vex', inventory: v }), 'vex']);
    const had = JSON.stringify([{ name: 'Rope', qty: 1, carry: 'stowed' }]);
    const came = JSON.stringify([{ name: 'Rope', qty: 2 }]);
    await bag(had);
    await put({ fields: { inventory: came }, upload: true });
    expect(JSON.parse((await stored()).inventory)).toEqual([{ name: 'Rope', qty: 3, carry: 'stowed' }]);
    await bag(had);
    await put({ fields: { inventory: came } });
    expect(JSON.parse((await stored()).inventory)).toEqual([{ name: 'Rope', qty: 2 }]);
  });

  it('checks what was sent', async () => {
    await put({ fields: {}, upload: true, picks: { classes: [{ option: 'wizard' }] } });
    expect((await stored())._choices.classes).toEqual([]);
  });
});
