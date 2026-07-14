import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { PDFDocument } from 'pdf-lib';
import { makeTestDb, run } from './helpers/testDb.js';
import sheetsRouteFactory from '../routes/sheets.js';
import { extractPdfFields, getImporter } from '../sheets/importers.js';

process.env.JWT_SECRET = 'test-secret';

let db;
let app;

const makeApp = (database) => {
  const application = express();
  application.use(express.json());
  const io = { emit: () => {} };
  application.use('/api/sheets', sheetsRouteFactory(database, io));
  return application;
};

beforeEach(async () => {
  db = await makeTestDb();
  app = makeApp(db);
  await run(db, `INSERT INTO global_settings (key, value) VALUES ('game_system', 'cyberpunk_red')`);
});

// Build a small fillable PDF in-memory, like an official character sheet
const buildFormPdf = async (fields) => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([400, 800]);
  const form = doc.getForm();
  let y = 760;
  for (const [name, value] of Object.entries(fields)) {
    const tf = form.createTextField(name);
    tf.setText(String(value));
    tf.addToPage(page, { x: 20, y, width: 150, height: 16 });
    y -= 24;
  }
  return Buffer.from(await doc.save());
};

describe('extractPdfFields', () => {
  it('reads text form fields out of a fillable PDF', async () => {
    const pdf = await buildFormPdf({ Handle: 'V', REF: '7' });
    const fields = await extractPdfFields(pdf);
    expect(fields).toEqual({ Handle: 'V', REF: '7' });
  });

  it('returns null for a PDF without form fields', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    const fields = await extractPdfFields(Buffer.from(await doc.save()));
    expect(fields).toBeNull();
  });
});

describe('CP:R importer mapping', () => {
  const importer = getImporter('cyberpunk_red');

  it('maps stats, skills, armor and identity via aliases', () => {
    const { mapped, unmapped } = importer.mapFields({
      Handle: 'V', Role: 'Solo', INT: '6', REF: '7', 'SP (Head)': '11',
      Handgun: '5', 'Pilot Air Vehicle (x2)': '2', mystery_field: 'x',
    });
    expect(mapped.handle).toBe('V');
    expect(mapped.role).toBe('Solo');
    expect(mapped.int).toBe(6);
    expect(mapped.ref).toBe(7);
    expect(mapped.sp_head_max).toBe(11);
    expect(mapped.sp_head).toBe(11); // max seeds current
    expect(mapped.handgun).toBe(5);
    expect(mapped.pilot_air).toBe(2);
    expect(unmapped.mystery_field).toBe('x');
  });

  it('skips linked fields (HP, cash) and reports them', () => {
    const { mapped, skipped } = importer.mapFields({ hp: 30, cash: 500, ref: 7 });
    expect(mapped.hp).toBeUndefined();
    expect(mapped.cash).toBeUndefined();
    expect(skipped.hp).toBe(30);
    expect(mapped.ref).toBe(7);
  });

  it('LUCK/EMP single values seed both current and max', () => {
    const { mapped } = importer.mapFields({ LUCK: '6', EMP: '5', Humanity: '50' });
    expect(mapped.luck_max).toBe(6);
    expect(mapped.luck).toBe(6);
    expect(mapped.emp_max).toBe(5);
    expect(mapped.emp).toBe(5);
    expect(mapped.humanity).toBe(50);
    expect(mapped.humanity_max).toBe(50);
  });

  it('rejects non-numeric values for numeric fields', () => {
    const { mapped, unmapped } = importer.mapFields({ REF: 'seven' });
    expect(mapped.ref).toBeUndefined();
    expect(unmapped.REF).toBe('seven');
  });

  it('parses a plain stat block', () => {
    const raw = importer.parseText('HANDLE: Nyx  Role: Netrunner\nINT 8 REF 6 TECH 7\nHandgun: 3  Stealth 4');
    const { mapped } = importer.mapFields(raw);
    expect(mapped.handle).toBe('Nyx');
    expect(mapped.int).toBe(8);
    expect(mapped.tech).toBe(7);
    expect(mapped.handgun).toBe(3);
    expect(mapped.stealth).toBe(4);
  });
});

describe('POST /api/sheets/import/preview', () => {
  it('previews a fillable PDF', async () => {
    const pdf = await buildFormPdf({ Handle: 'V', REF: '7', Handgun: '5' });
    const res = await request(app)
      .post('/api/sheets/import/preview')
      .attach('pdf', pdf, { filename: 'sheet.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('pdf-form');
    expect(res.body.mapped.handle).toBe('V');
    expect(res.body.mapped.ref).toBe(7);
    expect(res.body.mapped.handgun).toBe(5);
  });

  it('previews pasted JSON', async () => {
    const res = await request(app)
      .post('/api/sheets/import/preview')
      .send({ json: JSON.stringify({ ref: 7, cool: 5 }) });
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('json');
    expect(res.body.mapped).toMatchObject({ ref: 7, cool: 5 });
  });

  it('previews pasted stat-block text', async () => {
    const res = await request(app)
      .post('/api/sheets/import/preview')
      .send({ text: 'REF 7 COOL 5 Handgun: 4' });
    expect(res.status).toBe(200);
    expect(res.body.source).toBe('text');
    expect(res.body.mapped).toMatchObject({ ref: 7, cool: 5, handgun: 4 });
  });

  it('422s for a flat PDF with a helpful message', async () => {
    const doc = await PDFDocument.create();
    doc.addPage();
    const res = await request(app)
      .post('/api/sheets/import/preview')
      .attach('pdf', Buffer.from(await doc.save()), { filename: 'flat.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/paste/i);
  });

  it('400s when the active system has no importer', async () => {
    await run(db, `UPDATE global_settings SET value = 'generic' WHERE key = 'game_system'`);
    const res = await request(app)
      .post('/api/sheets/import/preview')
      .send({ json: '{"x":1}' });
    expect(res.status).toBe(400);
  });
});
