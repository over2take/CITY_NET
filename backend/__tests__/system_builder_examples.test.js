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
const { rollTier } = require_('../systemBuilder/tierRolls');
const { tryRest } = require_('../systemBuilder/tryRest');
const { restsOf } = require_('../systemBuilder/rests');
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
/** The built-in games among them; the genre starters have tests of their own below. */
const GAMES = EXAMPLES.filter((e) => e.kind === 'example');

describe('the examples', () => {
  it('are CWN, Cyberpunk RED and Shadowrun, each ready to publish as it stands', () => {
    expect(GAMES.map((e) => e.id)).toEqual(['cwn', 'cpr', 'sr6']);
    for (const { definition } of GAMES) {
      expect(checkDefinition(definition)).toEqual({ problems: [] });
    }
  });

  it('carry the parity-tested formulas word for word, with names players see', () => {
    for (const { id, definition } of GAMES) {
      const [proven] = PROVEN[id];
      expect(formulasOf(definition.derived)).toEqual(proven.derived);
      expect(definition.lookups).toEqual(proven.lookups);
      for (const d of definition.derived) expect(typeof d.label).toBe('string');
    }
  });

  it('work their sample character out as the built-in game does', () => {
    for (const { id, definition } of GAMES) {
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

describe('the genre starters (4d3)', () => {
  // Approved by the user 2026-10-09: fantasy on a d20, sci-fi on 2d6, a narrative one with nothing worked out.
  const STARTERS = EXAMPLES.filter((e) => e.kind === 'starter');
  const sampleValues = (id) => {
    const d = exampleDefinition(id);
    return previewDerived({ lookups: d.lookups, derived: d.derived }, d.samples);
  };

  it('are three, listed apart from the games, each ready to publish as it stands', () => {
    expect(STARTERS.map((e) => e.id)).toEqual(['fantasy', 'scifi', 'narrative']);
    expect(exampleList('starter').map((e) => e.name)).toEqual(['Sword & Spell', 'Starfarer', 'Story First']);
    for (const { definition } of STARTERS) expect(checkDefinition(definition)).toEqual({ problems: [] });
    for (const { definition } of STARTERS) expect(definition.description.length).toBeGreaterThan(40);
  });

  it('Sword & Spell: modifiers, proficiency by level, defense, in feet with gold pieces', () => {
    const { values, problems } = sampleValues('fantasy');
    expect(problems).toEqual([]);
    expect(values).toEqual({
      str_mod: 2, dex_mod: 2, con_mod: 1, int_mod: 1, wis_mod: 0, cha_mod: -1,
      proficiency: 2, defense: 12, initiative: 2, passive_perception: 10,
    });
    const d = exampleDefinition('fantasy');
    // Modifiers below 10 round down, and proficiency steps up every four levels.
    expect(previewDerived(d, { ...d.samples, str: 9, level: 5 }).values).toMatchObject({ str_mod: -1, proficiency: 3 });
    expect(previewDerived(d, { ...d.samples, str: 1, level: 17 }).values).toMatchObject({ str_mod: -5, proficiency: 6 });
    const proficiencyAt = (level) => previewDerived(d, { ...d.samples, level }).values.proficiency;
    expect([1, 4, 5, 8, 9, 12, 13, 16, 20].map(proficiencyAt)).toEqual([2, 2, 3, 3, 4, 4, 5, 5, 6]);
    // Defense and initiative follow DEX alone, perception WIS.
    expect(previewDerived(d, { ...d.samples, dex: 8, str: 18, wis: 16 }).values).toMatchObject({ defense: 9, initiative: -1, passive_perception: 13 });
    expect(d.core).toMatchObject({ health: { model: 'pool' }, advancement: ['levels'], distance: 'feet' });
    expect(d.words.money.short).toBe('gp');
    expect(d.parts).toEqual({ vehicles: { on: false }, cyberware: { on: false } });
  });

  it('Sword & Spell: NPC HP rolled for the level, more for each tier', () => {
    const tiers = exampleDefinition('fantasy').npc.tiers;
    expect(tiers.map((t) => t.id)).toEqual(['minion', 'soldier', 'champion', 'boss']);
    const lowest = (t) => rollTier(t, 4, new Map(), { hp: 9999, defense: 99 }, () => 0);
    const highest = (t) => rollTier(t, 4, new Map(), { hp: 9999, defense: 99 }, () => 0.999999);
    expect(tiers.map((t) => lowest(t).hp.value)).toEqual([4, 8, 12, 16]);
    expect(tiers.map((t) => highest(t).hp.value)).toEqual([24, 36, 48, 60]);
    expect(tiers.map((t) => lowest(t).defense.value)).toEqual([11, 14, 16, 18]);
  });

  it('Starfarer: every modifier read from one table, and a count of wounds instead of HP', () => {
    const d = exampleDefinition('scifi');
    const modFor = (x) => previewDerived(d, { ...d.samples, str: x }).values.str_mod;
    expect([2, 3, 5, 6, 8, 9, 11, 12, 14, 15].map(modFor)).toEqual([-2, -1, -1, 0, 0, 1, 1, 2, 2, 3]);
    expect(d.derived.every((x) => x.formula.startsWith('characteristic_mod(@'))).toBe(true);
    expect(d.core.health).toEqual({ model: 'wounds', count: 3, penalty: -1 });
    expect(d.npc.tiers.map((t) => [t.id, t.hp, t.values.end])).toEqual([['crew', 1, 6], ['veteran', 2, 8], ['elite', 3, 10]]);
  });

  it('Story First: approaches and harm, nothing worked out, credited to Fate Accelerated', () => {
    const d = exampleDefinition('narrative');
    expect(d.derived).toBeUndefined();
    expect(d.npc).toBeUndefined();
    expect(d.stats[0].stats.map((s) => [s.id, s.min, s.max])).toEqual(
      ['forceful', 'careful', 'clever', 'quick', 'flashy', 'sneaky'].map((id) => [id, 0, 3]),
    );
    expect(d.core.health.levels.map((l) => [l.label, l.slots])).toEqual([['LESSER', 2], ['MODERATE', 2], ['SEVERE', 1]]);
    expect(d.core).toMatchObject({ advancement: ['milestone'], distance: 'zones' });
    expect(d.license).toMatch(/Fate Accelerated.*Evil Hat Productions.*CC BY 3\.0/);
  });
});

/**
 * Rests (4f6b). The examples' rests do what the built-in games' own rest buttons do; the starters'
 * suit their genre. Each tried on its own sample character through TRY IT's rule (tryRest.js).
 */
describe('the examples\' and starters\' rests', () => {
  const tried = (id, rest, over = {}) => {
    const d = exampleDefinition(id);
    return tryRest(d, { rest, sheet: d.samples, ...over });
  };
  const restIds = (id) => restsOf(exampleDefinition(id)).map((r) => r.id);

  it('take a CWN character\'s System Strain down by 1 on a long rest, never below 0, as LONG_REST does', () => {
    expect(tried('cwn', 'long_rest').changes).toEqual([{ what: 'system_strain', label: 'System strain', from: 2, to: 1 }]);
    expect(tried('cwn', 'long_rest', { sheet: { ...exampleDefinition('cwn').samples, system_strain: 0 } }).changes).toEqual([]);
  });

  it('give a Cyberpunk RED character their LUCK back each session, as RESET_ALL_LUCK does', () => {
    expect(tried('cpr', 'end_of_session').changes).toEqual([{ what: 'luck_points', label: 'LUCK points', from: 2, to: 5 }]);
  });

  it('give a Shadowrun character their Edge back each session, as REPLENISH ALL EDGE does', () => {
    expect(tried('sr6', 'end_of_session').changes).toEqual([{ what: 'edge_points', label: 'Edge points', from: 1, to: 3 }]);
  });

  it('heal a die on a fantasy breather, and all of it and exhaustion with a night\'s sleep', () => {
    const token = { current: 3, max: 20 };
    expect(tried('fantasy', 'short_rest', { token }).changes).toEqual([{ what: 'health', label: 'HP', from: 3, to: null, pending: ['1d8 + @con_mod'] }]);
    const night = tried('fantasy', 'long_rest', { token, conditions: [{ id: 'exhausted' }] });
    expect(night.changes).toEqual([{ what: 'health', label: 'HP', from: 3, to: 20 }]);
    expect(night.gone).toEqual(['Exhausted']);
  });

  it('give a starfarer a wound back after a breather, and all of them after proper rest', () => {
    expect(tried('scifi', 'short_rest', { token: { current: 1, max: 3 } }).token.current).toBe(2);
    expect(tried('scifi', 'long_rest', { token: { current: 0, max: 3 } }).token.current).toBe(3);
  });

  it('clear a story\'s harm in downtime and its fear at the end of a scene, with no rests by the clock', () => {
    expect(restIds('narrative')).toEqual(['end_of_scene', 'end_of_session', 'downtime']);
    const down = tried('narrative', 'downtime', { sheet: { lesser_1: 'Bruised', severe_1: 'Broken arm' }, token: { current: 3, max: 5 }, conditions: [{ id: 'exhausted' }, { id: 'frightened' }] });
    expect(down.sheet).toMatchObject({ lesser_1: '', severe_1: '' });
    expect(down.token.current).toBe(5);
    expect(down.gone).toEqual(['Exhausted']);
    expect(tried('narrative', 'end_of_scene', { conditions: [{ id: 'exhausted' }, { id: 'frightened' }] }).gone).toEqual(['Frightened']);
  });

  it('keep every example and starter one that publishes, with the four standard rests otherwise on', () => {
    for (const { id, definition } of EXAMPLES) expect(checkDefinition(definition), id).toEqual({ problems: [] });
    for (const id of ['cwn', 'cpr', 'sr6', 'fantasy', 'scifi']) expect(restIds(id), id).toEqual(['short_rest', 'long_rest', 'end_of_scene', 'end_of_session']);
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
    expect(one.body).toEqual({ id: 'sr6', kind: 'example', definition: exampleDefinition('sr6') });
    expect((await request(app).get('/api/systems/examples/narrative').set(as())).body.kind).toBe('starter');
    expect((await request(app).get('/api/systems/examples/nope').set(as())).status).toBe(404);
  });

  it('list the genre starters when asked for them, and copy one like an example', async () => {
    const list = await request(app).get('/api/systems/examples?kind=starter').set(as());
    expect(list.body).toEqual(exampleList('starter'));
    expect((await request(app).get('/api/systems/examples?kind=example').set(as())).body).toEqual(exampleList());
    expect(await request(app).get('/api/systems/examples?kind=secret').set(as())).toMatchObject({ status: 400, body: { error: 'Examples or starters only' } });
    const made = await make({ name: 'Tavern Tales', example: 'fantasy' });
    expect(made.body.problems).toEqual([]);
    const got = await request(app).get(`/api/systems/${made.body.id}`).set(as());
    expect(got.body.draft).toEqual({ ...exampleDefinition('fantasy'), name: 'Tavern Tales' });
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
