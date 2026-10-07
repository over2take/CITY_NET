/**
 * The builder's CHARACTER SHEET page (4b3): what a draft's sheet looks like as it stands, and the
 * starter sheet CUSTOMIZE copies. Decided with the user 2026-10-07 (mockup builder-sheet): a sheet
 * is automatic until the GM customizes it, and customizing starts from the starter sheet.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createRequire } from 'module';
import { makeTestDb } from './helpers/testDb.js';

process.env.JWT_SECRET = 'test-secret';
const require_ = createRequire(import.meta.url);
const { effectiveSheet, starterSheet, checkSheet } = require_('../systemBuilder/sheet');
const { elevatedUsers } = require_('../middleware/auth');
const systemsRoute = require_('../routes/systems.js');

const GM = jwt.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, 'test-secret');
const EDITOR = jwt.sign({ username: 'ghost', isTemporary: true }, 'test-secret');
const PLAYER = jwt.sign({ username: 'vex', role: 'player' }, 'test-secret');

const HEARTH = {
  format: 1,
  name: 'Hearth',
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'str', label: 'Strength', min: 3, max: 18 }] }],
  derived: [{ id: 'save', label: 'Save', formula: '16 - @str' }],
};
const OWN = { sections: [{ id: 'mine', label: 'MINE', layout: 'list', fields: [{ id: 'str', label: 'Might', type: 'number' }] }] };
const ids = (sheet) => sheet.sections.flatMap((s) => s.fields.map((f) => f.id));

describe('the starter sheet', () => {
  it('is the automatic sheet of a system without one', () => {
    expect(starterSheet(HEARTH)).toEqual(effectiveSheet(HEARTH));
    expect(ids(starterSheet(HEARTH))).toEqual(['name', 'concept', 'description', 'hp', 'hp_max', 'str', 'save', 'cash', 'notes']);
  });

  it('ignores a sheet the system already has', () => {
    expect(starterSheet({ ...HEARTH, sheet: OWN })).toEqual(starterSheet(HEARTH));
    expect(effectiveSheet({ ...HEARTH, sheet: OWN })).toEqual(OWN);
  });

  it('keeps fields linked to a part that is off, which the drawn sheet leaves out', () => {
    const noBank = { ...HEARTH, parts: { bank: { on: false } } };
    expect(ids(starterSheet(noBank))).toContain('cash');
    expect(ids(effectiveSheet(noBank))).not.toContain('cash');
  });

  it('passes the server\'s own check, so CUSTOMIZE never starts with problems', () => {
    const problems = [];
    checkSheet(starterSheet(HEARTH), new Set(['save']), problems);
    expect(problems).toEqual([]);
  });
});

describe('the route', () => {
  let app;
  beforeEach(async () => {
    elevatedUsers.add('ghost');
    const db = await makeTestDb();
    app = express();
    app.use(express.json());
    app.use('/api/systems', systemsRoute(db));
  });
  afterEach(() => elevatedUsers.delete('ghost'));
  const post = (definition, token = GM) => request(app).post('/api/systems/preview-sheet').set({ Authorization: `Bearer ${token}` }).send({ definition });

  it('answers the sheet as drawn and the starter, for a draft never saved', async () => {
    const res = await post({ ...HEARTH, sheet: OWN, parts: { bank: { on: false } } });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sheet: OWN, starter: starterSheet({ ...HEARTH, parts: { bank: { on: false } } }) });
  });

  it('refuses what isn\'t a definition at all', async () => {
    const res = await post('nope');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'A system definition must be an object' });
  });

  it('is the main admin\'s alone', async () => {
    expect((await post(HEARTH, EDITOR)).status).toBe(403);
    expect((await post(HEARTH, PLAYER)).status).toBe(403);
    expect((await request(app).post('/api/systems/preview-sheet').send({ definition: HEARTH })).status).toBe(401);
  });
});
