/**
 * The builder's formula box (formula box 1; approved mockup docs/mockups/formula-box.html,
 * 2026-10-29): a modifier's amount, a requirement or a feature's uses read as the game reads it,
 * worked out for the sample character with every level at 3, or its mistake said before PUBLISH:
 * one that doesn't read, a name the system hasn't got (with the nearest real one), and an amount
 * reading a formula.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createRequire } from 'module';
import { makeTestDb } from './helpers/testDb.js';

process.env.JWT_SECRET = 'test-secret';
const require_ = createRequire(import.meta.url);
const { previewFormula, previewFormulas, SAMPLE_LEVEL, MOST, nearest } = require_('../systemBuilder/formulaPreview');
const { elevatedUsers } = require_('../middleware/auth');
const systemsRoute = require_('../routes/systems.js');

const GM = jwt.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, 'test-secret');
const EDITOR = jwt.sign({ username: 'ghost', isTemporary: true }, 'test-secret');

const DEF = {
  format: 1,
  name: 'Hearth',
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'str', label: 'Strength' }, { id: 'con', label: 'Constitution' }] }],
  samples: { str: 16, con: 14 },
  lookups: { mod: { bands: [{ upTo: 9, value: -1 }, { upTo: 13, value: 0 }, { value: 2 }] } },
  derived: [{ id: 'con_mod', label: 'CON modifier', formula: 'mod(@con)' }],
  core: { health: { model: 'pool' } },
  choices: [
    { id: 'classes', one: 'Class', many: 'Classes', levelled: true, options: [{ id: 'fighter', label: 'Fighter', features: [] }] },
  ],
};

describe('a formula read for the box', () => {
  it('works out a level formula with every level at the sample level, saying each name it reads', () => {
    expect(SAMPLE_LEVEL).toBe(3);
    expect(previewFormula(DEF, '2 * @level', 'amount')).toEqual({ ok: true, value: 6, reads: [{ id: 'level', label: 'Level', value: 3 }] });
    expect(previewFormula(DEF, '@fighter_level + @classes_level', 'amount').value).toBe(6);
  });

  it('reads the sample\'s stats, its formulas worked out, tables and functions', () => {
    expect(previewFormula(DEF, '@str', 'amount')).toEqual({ ok: true, value: 16, reads: [{ id: 'str', label: 'Strength', value: 16 }] });
    expect(previewFormula(DEF, '@con_mod + 1', 'uses')).toEqual({ ok: true, value: 3, reads: [{ id: 'con_mod', label: 'CON modifier', value: 2 }] });
    expect(previewFormula(DEF, 'floor(@level / 2) + mod(@str)', 'amount').value).toBe(3);
    expect(previewFormula(DEF, '@str >= 13', 'requires').value).toBe(1);
    expect(previewFormula(DEF, '@con >= 15', 'requires').value).toBe(0);
  });

  it('says a name the system hasn\'t got, and the nearest real one when there is one', () => {
    expect(previewFormula(DEF, '2 * @lvl', 'amount')).toEqual({ ok: false, problem: "@lvl isn't one of this system's names", name: 'lvl', suggest: 'level' });
    expect(previewFormula(DEF, '@strenght', 'requires')).toEqual({ ok: false, problem: "@strenght isn't one of this system's names", name: 'strenght' });
    expect(nearest('fightr_level', ['fighter_level', 'level'])).toBe('fighter_level');
    // A tie goes to the first named.
    expect(nearest('lvel', ['level', 'lvl'])).toBe('level');
  });

  it('refuses an amount reading a formula, as PUBLISH does, but not a requirement or uses', () => {
    expect(previewFormula(DEF, '@con_mod', 'amount')).toEqual({ ok: false, problem: '@con_mod is a formula: an amount reads stats as typed and levels' });
    expect(previewFormula(DEF, '@con_mod', 'requires').ok).toBe(true);
    expect(previewFormula(DEF, '@con_mod', 'uses').ok).toBe(true);
  });

  it('lets an amount read a level even where a formula has the same id', () => {
    const both = { ...DEF, derived: [...DEF.derived, { id: 'classes_level', formula: '1' }] };
    expect(previewFormula(both, '@classes_level', 'amount')).toMatchObject({ ok: true, value: 3 });
  });

  it('says what doesn\'t read, and that an empty box is empty', () => {
    expect(previewFormula(DEF, '2 * (@level', 'amount')).toMatchObject({ ok: false });
    expect(previewFormula(DEF, '2 * (@level', 'amount').problem).not.toBe('Empty');
    expect(previewFormula(DEF, '  ', 'amount')).toEqual({ ok: false, problem: 'Empty' });
    expect(previewFormula(DEF, 'nope(1)', 'amount').ok).toBe(false);
  });

  it('has no levels without a levelled list', () => {
    const flat = { ...DEF, choices: [] };
    expect(previewFormula(flat, '@level', 'amount')).toMatchObject({ ok: false, problem: "@level isn't one of this system's names" });
  });

  it('reads at most MOST formulas a request, a kind it doesn\'t know as a requirement', () => {
    const many = Array.from({ length: MOST + 5 }, () => ({ text: '1', kind: 'amount' }));
    expect(previewFormulas(DEF, many)).toHaveLength(MOST);
    expect(previewFormulas(DEF, [{ text: '@con_mod', kind: 'nonsense' }])[0].ok).toBe(true);
    expect(previewFormulas(DEF, 'not a list')).toEqual([]);
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
  const post = (body, token = GM) => request(app).post('/api/systems/preview-formulas').set({ Authorization: `Bearer ${token}` }).send(body);

  it('reads each formula against the draft sent', async () => {
    const res = await post({ definition: DEF, formulas: [{ text: '2 * @level', kind: 'amount' }, { text: '@lvl', kind: 'amount' }] });
    expect(res.status).toBe(200);
    expect(res.body.sampleLevel).toBe(3);
    expect(res.body.results.map((r) => r.ok)).toEqual([true, false]);
    expect(res.body.results[0].value).toBe(6);
  });

  it('refuses a draft it can\'t read at all', async () => {
    expect((await post({ definition: 'nope', formulas: [] })).status).toBe(400);
  });

  it('is the main admin\'s alone', async () => {
    expect((await post({ definition: DEF, formulas: [] }, EDITOR)).status).toBe(403);
    expect((await request(app).post('/api/systems/preview-formulas').send({ definition: DEF })).status).toBe(401);
  });
});
