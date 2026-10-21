import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { makeTestDb, run } from './helpers/testDb.js';

/**
 * The graph view's layout (5a1; approved mockup docs/mockups/builder-graph.html, 2026-10-17): the
 * `graph` section, only what the map adds to a system (positions, groups of formulas, folded
 * groups, notes), checked as strictly as the rest of an untrusted file, never made a problem by
 * anything done in FORMS, carried in a .citysys file and kept out of what players' browsers get.
 * And the FORMS / GRAPH choice, remembered on the server.
 */

process.env.JWT_SECRET = 'test-secret';
const require_ = createRequire(import.meta.url);
const { checkDefinition } = require_('../systemBuilder/definition');
const { LIMITS } = require_('../systemBuilder/graph');
const runtime = require_('../systemBuilder/runtime');
const citysys = require_('../systemBuilder/citysys');
const { randomSystem } = require_('./helpers/randomSystem');

const HEARTH = {
  format: 1,
  name: 'Hearth',
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'str', label: 'Strength', min: 3, max: 18 }, { id: 'lvl', label: 'Level', min: 1, max: 10 }] }],
  lookups: { attribute_mod: { bands: [{ upTo: 13, value: 0 }, { value: 1 }] } },
  derived: [
    { id: 'str_mod', label: 'STR MOD', formula: 'attribute_mod(@str)' },
    { id: 'melee', label: 'Melee attack', formula: '@str_mod + floor(@lvl / 2)' },
  ],
  house_rules: [{ id: 'magic', name: 'MAGIC' }],
  graph: {
    positions: { str: [48, 216], lvl: [48, 288], str_mod: [360, 216], melee: [672, 48], 'table:attribute_mod': [360, 48], 'rule:magic': [360, 360], 'note:n1': [984, 48] },
    groups: [{ id: 'mods', label: 'MODIFIERS', members: ['str_mod'] }],
    collapsed: ['mods', 'abilities'],
    notes: [{ id: 'n1', on: 'melee', text: 'Half level, rounded down: the 2nd printing changed this.' }],
  },
};
const graphProblems = (definition) => {
  const checked = checkDefinition(definition);
  if (checked.fatal) return [checked.fatal];
  return checked.problems.filter((p) => p.where.startsWith('graph')).map((p) => `${p.where}: ${p.message}`);
};
const withGraph = (graph) => ({ ...HEARTH, graph });
/** A .citysys file's text with the layout inside its definition, as files from 5a1 to 5a3 had it. */
const fileText = (definition) => JSON.stringify({ citysys: 1, manifest: { name: definition.name, origin: 'org_hearth' }, definition });

describe('the graph section', () => {
  it('takes a map\'s layout', () => {
    expect(checkDefinition(HEARTH)).toEqual({ problems: [] });
  });

  it('is optional, and a system without it is the same system', () => {
    const { graph, ...without } = HEARTH;
    expect(checkDefinition(without)).toEqual({ problems: [] });
    expect(runtime.metaOf(without).recompute({ str: 16, lvl: 3 })).toEqual(['str_mod', 'melee']);
    const sheet = { str: 16, lvl: 3 };
    runtime.metaOf(HEARTH).recompute(sheet);
    expect(sheet).toEqual({ str: 16, lvl: 3, str_mod: 1, melee: 2 });
  });

  it('refuses what a layout cannot be', () => {
    expect(graphProblems(withGraph([]))).toEqual(['graph: Must be the map\'s layout']);
    expect(graphProblems(withGraph({ wires: [], positions: [] }))).toEqual([
      'graph wires: Not part of the map\'s layout',
      'graph positions: Must be a set of places',
    ]);
    expect(graphProblems(withGraph({ positions: { str: [1.5, 0], dex: [0], 'Not An Id': [0, 0], 'note:': [0, 0], 'roll:': [0, 0], 'roll:skill': [0, 0], melee: [0, LIMITS.reach + 1], lvl: ['1', 2] } }))).toEqual([
      `graph position str: Must be two whole numbers, each between -${LIMITS.reach} and ${LIMITS.reach}`,
      `graph position dex: Must be two whole numbers, each between -${LIMITS.reach} and ${LIMITS.reach}`,
      'graph position Not An Id: Not the name of a node',
      'graph position note:: Not the name of a node',
      'graph position roll:: Not the name of a node',
      `graph position melee: Must be two whole numbers, each between -${LIMITS.reach} and ${LIMITS.reach}`,
      `graph position lvl: Must be two whole numbers, each between -${LIMITS.reach} and ${LIMITS.reach}`,
    ]);
  });

  it('refuses groups that are not groups', () => {
    expect(graphProblems(withGraph({ groups: [
      { id: 'mods', label: 'MODS', members: ['str_mod'] },
      { id: 'mods', label: '', members: 'melee' },
      { id: 'Bad Id', label: 'x'.repeat(LIMITS.label + 1), members: ['str_mod', 7], colour: 'red' },
      'a group',
    ] }))).toEqual([
      'graph group mods: Defined twice',
      'graph group mods, label: Cannot be blank',
      'graph group mods, members: Must be a list of formulas',
      'graph group Bad Id, colour: Not part of a group',
      'graph group Bad Id: Ids use lowercase letters, digits and _, starting with a letter',
      `graph group Bad Id, label: Longer than ${LIMITS.label} characters`,
      'graph group Bad Id, members: str_mod is already in another group',
      'graph group Bad Id, members: Members are formula ids',
      'graph group 4: Must be a group',
    ]);
  });

  it('refuses notes that are not notes, and folded groups that are not ids', () => {
    expect(graphProblems(withGraph({ collapsed: 'mods' }))).toEqual(['graph collapsed: Must be a list of group ids']);
    expect(graphProblems(withGraph({ collapsed: ['mods', 3] }))).toEqual(['graph collapsed: Must be a list of group ids']);
    expect(graphProblems(withGraph({ notes: [
      { id: 'n1', text: 'fine' },
      { id: 'n1', on: 'note:n2', text: 7 },
      { id: 'n3', on: 'melee', text: 'x'.repeat(LIMITS.note + 1), color: 'red' },
    ] }))).toEqual([
      'graph note n1: Defined twice',
      'graph note n1, on: Pinned to a stat, formula, table or house rule',
      'graph note n1, text: Must be text',
      'graph note n3, color: Not part of a note',
      `graph note n3, text: Longer than ${LIMITS.note} characters`,
    ]);
  });

  it('holds its counts to the caps, so a file cannot fill the server with them', () => {
    const many = (n, make) => Array.from({ length: n }, (_, i) => make(i));
    expect(graphProblems(withGraph({ positions: Object.fromEntries(many(LIMITS.positions + 1, (i) => [`n${i}`, [0, 0]])) })))
      .toEqual([`graph positions: More than ${LIMITS.positions}`]);
    expect(graphProblems(withGraph({ groups: many(LIMITS.groups + 1, (i) => ({ id: `g${i}`, label: 'G', members: [] })) })))
      .toEqual([`graph groups: More than ${LIMITS.groups}`]);
    expect(graphProblems(withGraph({ notes: many(LIMITS.notes + 1, (i) => ({ id: `n${i}`, text: '' })) })))
      .toEqual([`graph notes: More than ${LIMITS.notes}`]);
    expect(graphProblems(withGraph({ groups: [{ id: 'g', label: 'G', members: many(LIMITS.members + 1, (i) => `f${i}`) }] })))
      .toEqual([`graph group g, members: More than ${LIMITS.members}`]);
  });

  it('takes names every object has only as ordinary names, refused where they are not ids', () => {
    const graph = JSON.parse('{"positions":{"__proto__":[0,0],"constructor":[0,0]},"notes":[{"id":"constructor","on":"__proto__","text":"x"}],"__proto__":{"polluted":1}}');
    expect(graphProblems(withGraph(graph))).toEqual([
      'graph __proto__: Not part of the map\'s layout',
      'graph position __proto__: Not the name of a node',
      'graph note constructor, on: Pinned to a stat, formula, table or house rule',
    ]);
    expect({}.polluted).toBeUndefined();
  });
});

describe('nothing done in FORMS makes a problem on the map', () => {
  it('a position, group member, folded group or note pin naming what has gone is not a problem', () => {
    const gone = withGraph({
      positions: { deleted_formula: [0, 0], 'table:deleted_table': [0, 0], 'rule:deleted_rule': [0, 0] },
      groups: [{ id: 'mods', label: 'MODIFIERS', members: ['deleted_formula'] }],
      collapsed: ['deleted_group'],
      notes: [{ id: 'n1', on: 'deleted_formula', text: 'Still here.' }],
    });
    expect(checkDefinition(gone)).toEqual({ problems: [] });
  });

  it('emptying every section FORMS edits leaves the map\'s layout without problems, for any system', () => {
    let tried = 0;
    for (let seed = 1; seed <= 60; seed += 1) {
      const def = randomSystem(seed);
      if (!def.graph) continue;
      tried += 1;
      const { stats, samples, lookups, derived, house_rules: rules, sheet, npc, conditions, rests, core, ...rest } = def;
      expect(graphProblems(rest), `seed ${seed}`).toEqual([]);
    }
    expect(tried).toBeGreaterThan(20);
  });
});

describe('what players get', () => {
  it('the copy a browser draws sheets from never carries the layout or a note', () => {
    const render = JSON.stringify(runtime.renderOf('sys_hearth', HEARTH));
    expect(render).not.toContain('graph');
    expect(render).not.toContain('2nd printing');
    expect(render).not.toContain('MODIFIERS');
  });
});

describe('through the server', () => {
  const GM = jwt.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, 'test-secret');
  const gm = { Authorization: `Bearer ${GM}` };
  let app;
  beforeEach(async () => {
    const db = await makeTestDb();
    await run(db, `INSERT INTO global_settings (key, value) VALUES ('game_system', 'cities_without_number')`);
    app = express();
    app.use(express.json({ limit: '2mb' }));
    app.use('/api/systems', require_('../routes/systems.js')(db));
    await new Promise((resolve) => runtime.load(db, resolve));
  });

  it('a file exported before the map existed installs as it was, and publishes', async () => {
    // e2e/fixtures/emberline.citysys: exported 2026-10-16 by a 2.0.0 dev build, no graph section.
    const text = fs.readFileSync(path.join(__dirname, '..', '..', 'e2e', 'fixtures', 'emberline.citysys'), 'utf8');
    const file = JSON.parse(text);
    expect(file.definition.graph).toBeUndefined();
    expect(citysys.readFile(text).problems).toEqual([]);
    const installed = (await request(app).post('/api/systems/install').set(gm).send({ file: text, mode: 'new' })).body;
    const draft = (await request(app).get(`/api/systems/${installed.id}`).set(gm)).body.draft;
    expect(draft).toEqual(file.definition);
    expect((await request(app).post(`/api/systems/${installed.id}/publish`).set(gm)).status).toBe(200);
  });

  it('a .citysys file carries the layout beside the system, so a builder from before the map reads it as it always did', async () => {
    const id = (await request(app).post('/api/systems').set(gm).send({ definition: HEARTH })).body.id;
    expect((await request(app).post(`/api/systems/${id}/publish`).set(gm)).status).toBe(200);
    const file = JSON.parse((await request(app).get(`/api/systems/${id}/export`).set(gm)).text);
    expect(Object.keys(file)).toEqual(['citysys', 'manifest', 'definition', 'graph']);
    expect(file.graph).toEqual(HEARTH.graph);
    // An older builder reads only "manifest" and "definition": nothing in the definition is new to it.
    const BEFORE_THE_MAP = ['format', 'name', 'description', 'author', 'license', 'words', 'parts', 'buildings', 'currencies', 'bank', 'stats', 'samples', 'lookups', 'derived', 'sheet', 'npc', 'core', 'conditions', 'rests', 'house_rules'];
    expect(Object.keys(file.definition).filter((k) => !BEFORE_THE_MAP.includes(k))).toEqual([]);
    const { graph, ...rest } = HEARTH;
    expect(file.definition).toEqual(rest);
  });

  it('a system with no layout writes no layout to its file', async () => {
    const { graph, ...plain } = HEARTH;
    const id = (await request(app).post('/api/systems').set(gm).send({ definition: plain })).body.id;
    await request(app).post(`/api/systems/${id}/publish`).set(gm);
    expect(Object.keys(JSON.parse((await request(app).get(`/api/systems/${id}/export`).set(gm)).text))).toEqual(['citysys', 'manifest', 'definition']);
  });

  it('reads a layout inside the definition too, and keeps the definition\'s own when a file has both', () => {
    const inside = fileText({ ...HEARTH });
    expect(citysys.readFile(inside).file.definition.graph).toEqual(HEARTH.graph);
    const both = JSON.stringify({ ...JSON.parse(inside), graph: { notes: [{ id: 'other', text: 'Beside.' }] } });
    expect(citysys.readFile(both).file.definition.graph).toEqual(HEARTH.graph);
  });

  it('checks a layout beside the system as strictly as one inside it', () => {
    const beside = (graph) => {
      const { graph: _g, ...definition } = HEARTH;
      return JSON.stringify({ citysys: 1, manifest: { name: 'Hearth', origin: 'org_hearth' }, definition, graph });
    };
    expect(citysys.readFile(beside([])).problems.map((p) => `${p.where}: ${p.message}`)).toEqual(['graph: Must be the map\'s layout']);
    expect(citysys.readFile(beside({ positions: { 'Not An Id': [0, 0] } })).problems.map((p) => `${p.where}: ${p.message}`))
      .toEqual(['graph position Not An Id: Not the name of a node']);
    expect(citysys.readFile(beside(JSON.parse('{"__proto__":{"polluted":1}}'))).problems.map((p) => p.where)).toEqual(['graph __proto__']);
    expect({}.polluted).toBeUndefined();
  });

  it('a .citysys file carries the layout and its notes, and installs it unchanged', async () => {
    const id = (await request(app).post('/api/systems').set(gm).send({ definition: HEARTH })).body.id;
    expect((await request(app).post(`/api/systems/${id}/publish`).set(gm)).status).toBe(200);
    const text = (await request(app).get(`/api/systems/${id}/export`).set(gm)).text;
    expect(JSON.parse(text).graph).toEqual(HEARTH.graph);
    const copy = text.replace(`"origin": "${id}"`, '"origin": "org_elsewhere"');
    const installed = (await request(app).post('/api/systems/install').set(gm).send({ file: copy, mode: 'new' })).body;
    const draft = (await request(app).get(`/api/systems/${installed.id}`).set(gm)).body;
    expect(draft.draft.graph).toEqual(HEARTH.graph);
    expect(citysys.readFile(copy).problems).toEqual([]);
  });

  it('remembers FORMS or GRAPH for STATS & RULES, FORMS until GRAPH is picked', async () => {
    expect((await request(app).get('/api/systems/view').set(gm)).body).toEqual({ views: { rules: 'forms' } });
    expect((await request(app).put('/api/systems/view').set(gm).send({ page: 'rules', view: 'graph' })).body).toEqual({ page: 'rules', view: 'graph' });
    expect((await request(app).get('/api/systems/view').set(gm)).body).toEqual({ views: { rules: 'graph' } });
    await request(app).put('/api/systems/view').set(gm).send({ page: 'rules', view: 'forms' });
    expect((await request(app).get('/api/systems/view').set(gm)).body).toEqual({ views: { rules: 'forms' } });
  });

  it('refuses a page with no map, or a view that is neither', async () => {
    expect((await request(app).put('/api/systems/view').set(gm).send({ page: 'words', view: 'graph' })).body).toEqual({ error: 'That page has no map' });
    expect((await request(app).put('/api/systems/view').set(gm).send({ page: 'rules', view: 'nodes' })).body).toEqual({ error: 'The view is forms or graph' });
  });

  it('is the main admin\'s alone', async () => {
    const player = { Authorization: `Bearer ${jwt.sign({ id: 5, username: 'GHOST', role: 'player' }, 'test-secret')}` };
    expect((await request(app).get('/api/systems/view').set(player)).status).toBe(403);
    expect((await request(app).put('/api/systems/view').set(player).send({ page: 'rules', view: 'graph' })).status).toBe(403);
  });
});
