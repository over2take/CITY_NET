/**
 * The builder's live values (4b2b): a draft's formulas worked out from its sample character while a
 * GM is still writing them. Decided with the user 2026-10-06 (mockup builder-stats-rules): every
 * formula shows its value as you type, a mistake shown under it without blanking the others.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createRequire } from 'module';
import { makeTestDb } from './helpers/testDb.js';

process.env.JWT_SECRET = 'test-secret';
const require_ = createRequire(import.meta.url);
const { previewDerived, compileSystem } = require_('../systemBuilder/derived');
const { elevatedUsers } = require_('../middleware/auth');
const systemsRoute = require_('../routes/systems.js');

const GM = jwt.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, 'test-secret');
const EDITOR = jwt.sign({ username: 'ghost', isTemporary: true }, 'test-secret');
const PLAYER = jwt.sign({ username: 'vex', role: 'player' }, 'test-secret');

const LOOKUPS = { mod: { bands: [{ upTo: 3, value: -2 }, { upTo: 7, value: -1 }, { upTo: 13, value: 0 }, { upTo: 17, value: 1 }, { value: 2 }] } };
const DERIVED = [
  { id: 'str_mod', formula: 'mod(@str)' },
  { id: 'con_mod', formula: 'mod(@con)' },
  { id: 'save_physical', label: 'Physical save', formula: '16 - (@level + max(@str_mod, @con_mod))' },
];
const SAMPLE = { str: 16, con: 12, level: 3 };

describe('working values out while writing', () => {
  it('gives every value when nothing is wrong, exactly as the engine does', () => {
    const r = previewDerived({ lookups: LOOKUPS, derived: DERIVED }, SAMPLE);
    expect(r).toEqual({ values: { str_mod: 1, con_mod: 0, save_physical: 12 }, problems: [] });
    expect(r.values).toEqual(compileSystem({ lookups: LOOKUPS, derived: DERIVED }).system.evaluate(SAMPLE));
  });

  it('leaves out an unfinished formula and what reads it, keeping the rest', () => {
    const derived = [...DERIVED.slice(0, 2), { id: 'dex_mod', formula: 'mod(@dex' }, { id: 'evasion', formula: '16 - @dex_mod' },
      { id: 'twice', formula: '@evasion * 2' }, { id: 'save_physical', formula: DERIVED[2].formula }];
    const r = previewDerived({ lookups: LOOKUPS, derived }, SAMPLE);
    expect(r.values).toEqual({ str_mod: 1, con_mod: 0, save_physical: 12 });
    expect(r.problems.map((p) => p.where)).toEqual(['derived dex_mod, formula']);
  });

  it('leaves out a loop, saying its path, and keeps the rest', () => {
    const derived = [{ id: 'a', formula: '@b + 1' }, { id: 'b', formula: '@a + 1' }, { id: 'c', formula: '@str * 2' }];
    const r = previewDerived({ derived }, SAMPLE);
    expect(r.values).toEqual({ c: 32 });
    expect(r.problems[0].message).toMatch(/^Depends on itself: /);
  });

  it('does not mistake a longer name for the broken one', () => {
    const derived = [{ id: 'mod', formula: 'oops(' }, { id: 'mod_total', formula: '@str + 1' }, { id: 'uses', formula: '@mod_total + 1' }];
    expect(previewDerived({ derived }, SAMPLE).values).toEqual({ mod_total: 17, uses: 18 });
  });

  it('a condition reading a broken value is left out too', () => {
    const derived = [{ id: 'bad', formula: '(' }, { id: 'hurt', kind: 'condition', when: '@bad > 1', then: '1', else: '0' }, { id: 'ok', formula: '2' }];
    expect(previewDerived({ derived }, SAMPLE).values).toEqual({ ok: 2 });
  });

  it('never takes a nameless broken entry for a formula called "value"', () => {
    const derived = [{ id: 'value', formula: '2' }, { formula: '1' }];
    const r = previewDerived({ derived }, SAMPLE);
    expect(r.problems.map((p) => p.where)).toEqual(['derived value 2']);
    // The nameless entry is dropped, since nothing can read it; "value" is fine and is kept.
    expect(r.values).toEqual({ value: 2 });
  });

  it('gives nothing it can\'t pin to one formula, but still the problems', () => {
    const r = previewDerived({ lookups: { mod: { bands: [] } }, derived: DERIVED }, SAMPLE);
    expect(r.values).toEqual({});
    expect(r.problems.length).toBeGreaterThan(0);
  });

  it('reads stats the sample doesn\'t have as 0, as the game does', () => {
    expect(previewDerived({ derived: [{ id: 'x', formula: '@missing + 5' }] }, {}).values).toEqual({ x: 5 });
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
  const post = (definition, token = GM) => request(app).post('/api/systems/preview-values').set({ Authorization: `Bearer ${token}` }).send({ definition });

  it('works out a draft from its own sample character', async () => {
    const res = await post({ format: 1, name: 'Hearth', samples: SAMPLE, lookups: LOOKUPS, derived: DERIVED });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ values: { str_mod: 1, con_mod: 0, save_physical: 12 }, problems: [] });
  });

  it('uses no sample when the draft has none, or one that isn\'t a set', async () => {
    expect((await post({ format: 1, name: 'H', derived: [{ id: 'x', formula: '@str + 1' }] })).body.values).toEqual({ x: 1 });
    expect((await post({ format: 1, name: 'H', samples: [5], derived: [{ id: 'x', formula: '@str + 1' }] })).body.values).toEqual({ x: 1 });
  });

  it('refuses what isn\'t a definition at all', async () => {
    const res = await post('nope');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'A system definition must be an object' });
  });

  it('is the main admin\'s alone', async () => {
    expect((await post({ format: 1, name: 'H' }, EDITOR)).status).toBe(403);
    expect((await post({ format: 1, name: 'H' }, PLAYER)).status).toBe(403);
    expect((await request(app).post('/api/systems/preview-values').send({ definition: {} })).status).toBe(401);
  });
});
