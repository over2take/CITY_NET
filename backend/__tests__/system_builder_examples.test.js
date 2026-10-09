/**
 * The built-in examples (4d1): Cities Without Number and Shadowrun 6E as whole definitions, to
 * read and to copy as the start of a GM's own system. Their formulas are the parity-tested ones,
 * word for word; the live games never run them.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createRequire } from 'module';
import { makeTestDb } from './helpers/testDb.js';

process.env.JWT_SECRET = 'test-secret';
const require_ = createRequire(import.meta.url);
const { EXAMPLES, exampleDefinition, exampleList } = require_('../systemBuilder/examples');
const { CITIES_WITHOUT_NUMBER, SHADOWRUN_6E, CYBERPUNK_RED } = require_('../systemBuilder/definitions');
const { checkDefinition } = require_('../systemBuilder/definition');
const { previewDerived } = require_('../systemBuilder/derived');
const { TEMPLATES, applyDerived } = require_('../sheets/templates');
const { elevatedUsers } = require_('../middleware/auth');
const systemsRoute = require_('../routes/systems.js');

/** Each example's proven formulas, and how its built-in game works a sheet out. */
const PROVEN = {
  cwn: [CITIES_WITHOUT_NUMBER, (sheet) => TEMPLATES.cities_without_number.recompute(sheet)],
  // Cyberpunk RED works EMP out when Humanity is written (definitions.js says how that differs).
  cpr: [CYBERPUNK_RED, (sheet) => applyDerived('cyberpunk_red', sheet, 'humanity')],
  sr6: [SHADOWRUN_6E, (sheet) => TEMPLATES.shadowrun_6e.recompute(sheet)],
};
const formulasOf = (derived) => derived.map(({ label, ...rest }) => rest);

describe('the examples', () => {
  it('are CWN, Cyberpunk RED and Shadowrun, each ready to publish as it stands', () => {
    expect(EXAMPLES.map((e) => e.id)).toEqual(['cwn', 'cpr', 'sr6']);
    for (const { definition } of EXAMPLES) {
      expect(checkDefinition(definition)).toEqual({ problems: [] });
    }
  });

  it('carry the parity-tested formulas word for word, with names players see', () => {
    for (const { id, definition } of EXAMPLES) {
      const [proven] = PROVEN[id];
      expect(formulasOf(definition.derived)).toEqual(proven.derived);
      expect(definition.lookups).toEqual(proven.lookups);
      for (const d of definition.derived) expect(typeof d.label).toBe('string');
    }
  });

  it('work their sample character out as the built-in game does', () => {
    for (const { id, definition } of EXAMPLES) {
      const [, workOut] = PROVEN[id];
      const sheet = { ...definition.samples };
      workOut(sheet);
      const { values, problems } = previewDerived({ lookups: definition.lookups, derived: definition.derived }, definition.samples);
      expect(problems).toEqual([]);
      for (const d of definition.derived) expect([d.id, values[d.id]]).toEqual([d.id, sheet[d.id]]);
    }
  });

  it('give Cyberpunk RED its own money and IP, and the built-in generator\'s four tiers', () => {
    const cpr = exampleDefinition('cpr');
    expect(cpr.words.money).toEqual({ singular: 'EURODOLLAR', plural: 'EURODOLLARS', short: 'eb' });
    expect(cpr.words.xp.short).toBe('IP');
    expect(cpr.core.advancement).toEqual(['spend']);
    expect(cpr.npc.tiers.map((t) => [t.id, t.hp, t.defense, t.values.ref])).toEqual([
      ['mook', 20, 10, 4], ['skilled', 30, 12, 5], ['pro', 35, 13, 6], ['elite', 45, 15, 8],
    ]);
    expect(Object.keys(cpr.npc.tiers[0].values)).toHaveLength(10);
  });

  it('give Shadowrun its two tracks and its own words, CWN one pool in meters', () => {
    expect(exampleDefinition('sr6').core.health).toMatchObject({ model: 'tracks', overflow: true });
    expect(exampleDefinition('sr6').words.xp.singular).toBe('KARMA');
    expect(exampleDefinition('cwn').core).toMatchObject({ health: { model: 'pool' }, distance: 'meters' });
  });

  it('hand out a copy, never the example itself', () => {
    const copy = exampleDefinition('cwn');
    copy.derived[0].formula = '1';
    copy.stats[0].stats.pop();
    expect(exampleDefinition('cwn').derived[0].formula).toBe('attribute_mod(@str)');
    expect(exampleDefinition('cwn').stats[0].stats).toHaveLength(6);
    expect(exampleDefinition('nope')).toBeNull();
    expect(exampleDefinition('constructor')).toBeNull();
  });

  it('are listed by name and description, without their definitions', () => {
    expect(exampleList()).toEqual([
      { id: 'cwn', name: 'Cities Without Number', description: expect.any(String) },
      { id: 'cpr', name: 'Cyberpunk RED', description: expect.any(String) },
      { id: 'sr6', name: 'Shadowrun 6E', description: expect.any(String) },
    ]);
  });
});

describe('the routes', () => {
  const GM = jwt.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, 'test-secret');
  const EDITOR = jwt.sign({ username: 'ghost', isTemporary: true }, 'test-secret');
  const PLAYER = jwt.sign({ username: 'vex', role: 'player' }, 'test-secret');
  let app;
  beforeEach(async () => {
    elevatedUsers.add('ghost');
    const db = await makeTestDb();
    app = express();
    app.use(express.json());
    app.use('/api/systems', systemsRoute(db));
  });
  afterEach(() => elevatedUsers.delete('ghost'));
  const as = (token = GM) => ({ Authorization: `Bearer ${token}` });
  const make = (body, token = GM) => request(app).post('/api/systems').set(as(token)).send(body);

  it('list the examples and open one whole', async () => {
    const list = await request(app).get('/api/systems/examples').set(as());
    expect(list.status).toBe(200);
    expect(list.body).toEqual(exampleList());
    const one = await request(app).get('/api/systems/examples/sr6').set(as());
    expect(one.body).toEqual({ id: 'sr6', definition: exampleDefinition('sr6') });
    expect((await request(app).get('/api/systems/examples/nope').set(as())).status).toBe(404);
  });

  it('copy an example into a new draft under the name given, the GM\'s own', async () => {
    const made = await make({ name: '  Neon Nights  ', example: 'cwn' });
    expect(made.status).toBe(200);
    expect(made.body.problems).toEqual([]);
    const got = await request(app).get(`/api/systems/${made.body.id}`).set(as());
    expect(got.body).toMatchObject({ name: 'Neon Nights', version: 0, published: null });
    expect(got.body.draft).toEqual({ ...exampleDefinition('cwn'), name: 'Neon Nights' });
  });

  it('refuse an unknown example, no name, or a name already taken', async () => {
    expect(await make({ name: 'X', example: 'dnd' })).toMatchObject({ status: 404, body: { error: 'No such example' } });
    expect(await make({ name: '  ', example: 'cwn' })).toMatchObject({ status: 400, body: { error: 'A system needs a name' } });
    expect((await make({ example: 'cwn' })).status).toBe(400);
    expect((await make({ name: 'Runners', example: 'sr6' })).status).toBe(200);
    expect((await make({ name: 'runners', example: 'cwn' })).status).toBe(409);
  });

  it('still make a blank system from a name', async () => {
    const made = await make({ name: 'Plain' });
    const got = await request(app).get(`/api/systems/${made.body.id}`).set(as());
    expect(got.body.draft.derived).toBeUndefined();
  });

  it('are the main admin\'s alone', async () => {
    for (const token of [EDITOR, PLAYER]) {
      expect((await request(app).get('/api/systems/examples').set(as(token))).status).toBe(403);
      expect((await request(app).get('/api/systems/examples/cwn').set(as(token))).status).toBe(403);
      expect((await make({ name: 'X', example: 'cwn' }, token)).status).toBe(403);
    }
    expect((await request(app).get('/api/systems/examples')).status).toBe(401);
  });
});
