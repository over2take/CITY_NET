import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createRequire } from 'module';
import { makeTestDb, run } from './helpers/testDb.js';

/**
 * A .citysys file is untrusted whoever sent it (citysys.js). These are files written to do harm,
 * not mistakes: names JavaScript gives every object (`__proto__`, `constructor`, `toString`) put
 * wherever a file has a key or a name, formulas calling them, nesting and sizes past the caps.
 *
 * The promise held here: checking a file never throws, nothing it says reaches Object.prototype,
 * and a system the checks pass (so a GM could publish it) runs without throwing. Saves work
 * derived values out inside database callbacks, where a throw stops the server.
 *
 * Found by these tests (2026-10-17): `constructor(1)` and `toString(1)` passed every check as
 * built-in functions and threw each time they were worked out; a `buildings` kind called
 * `constructor` made the check itself throw.
 */

process.env.JWT_SECRET = 'test-secret';
const require_ = createRequire(import.meta.url);
const citysys = require_('../systemBuilder/citysys');
const { checkDefinition } = require_('../systemBuilder/definition');
const { compileSystem } = require_('../systemBuilder/derived');
const runtime = require_('../systemBuilder/runtime');
const { exampleDefinition } = require_('../systemBuilder/examples');
const { randomSystem } = require_('./helpers/randomSystem');

const NAMES = ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf'];
const problemsOf = (definition) => checkDefinition(definition).problems.map((p) => `${p.where}: ${p.message}`);
const fileText = (definitionText) => `{"citysys":1,"manifest":{"name":"Hostile","origin":"org_hostile","version":1},"definition":${definitionText}}`;

/** Every place in a definition: each object key and each text value, by its path. */
function* placesIn(value, path = []) {
  if (Array.isArray(value)) { for (let i = 0; i < value.length; i += 1) yield* placesIn(value[i], [...path, i]); return; }
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) { yield { kind: 'key', path: [...path, key] }; yield* placesIn(value[key], [...path, key]); }
    return;
  }
  if (typeof value === 'string') yield { kind: 'text', path };
}

/**
 * The definition with one place changed, as file text. Keys are swapped in the text so that
 * "__proto__" arrives as JSON.parse gives it: an own key, not a prototype.
 */
const changed = (definition, place, to) => {
  const copy = JSON.parse(JSON.stringify(definition));
  let parent = copy;
  for (const step of place.path.slice(0, -1)) parent = parent[step];
  const last = place.path[place.path.length - 1];
  if (place.kind === 'text') { parent[last] = to; return JSON.stringify(copy); }
  const entries = Object.entries(parent);
  for (const key of Object.keys(parent)) delete parent[key];
  parent.__swap__ = 1;
  const inner = `{${entries.map(([k, v]) => `${JSON.stringify(k === last ? to : k)}:${JSON.stringify(v)}`).join(',')}}`;
  return JSON.stringify(copy).replace('{"__swap__":1}', inner);
};

describe('a file full of names every object has', () => {
  // The CWN example and two random systems between them reach every section a definition has.
  const bases = [
    ['the CWN example', exampleDefinition('cwn')],
    ['random system 1', randomSystem(1)],
    ['random system 2', randomSystem(2)],
  ];

  it.each(bases)('%s: checks never throw, and whatever passes them runs', (_, base) => {
    const failures = [];
    let passed = 0;
    for (const place of placesIn(base)) {
      if (place.path[0] === 'format') continue;
      const tos = place.kind === 'key' ? NAMES : [...NAMES, ...NAMES.map((n) => `${n}(1)`), ...NAMES.map((n) => `1 + ${n}(2, 3)`)];
      for (const to of tos) {
        const text = changed(base, place, to);
        const where = `${place.kind} ${place.path.join('.')} = ${to}`;
        let checked;
        try {
          checked = checkDefinition(JSON.parse(text));
          citysys.readFile(fileText(text));
        } catch (err) { failures.push(`${where}: the check threw ${err.message}`); continue; }
        if (checked.fatal || checked.problems.length) continue;
        passed += 1;
        try { runtime.metaOf(JSON.parse(text)).recompute({}); } catch (err) { failures.push(`${where}: running it threw ${err.message}`); }
      }
    }
    expect(failures).toEqual([]);
    expect(passed).toBeGreaterThan(0); // some changes are harmless (a description), and those run
    expect({}.polluted).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty('polluted');
  }, 60000);
});

describe('formulas calling what is not a function', () => {
  it.each(['constructor(1)', '__proto__(1)', 'toString(@might)', 'hasOwnProperty(1)', 'valueOf(1) + 2'])('%s is a problem, not a crash later', (formula) => {
    const name = formula.match(/^[a-zA-Z_]+/)[0];
    expect(problemsOf({ format: 1, name: 'X', derived: [{ id: 'a', formula }] }))
      .toEqual([`derived a, formula: No function or table called "${name}" (at character 1)`]);
  });

  it('a table may still be called constructor, and is read as a table', () => {
    const def = { lookups: { constructor: { bands: [{ upTo: 10, value: 1 }, { value: 2 }] } }, derived: [{ id: 'a', formula: 'constructor(@might)' }] };
    const compiled = compileSystem(def);
    expect(compiled.ok).toBe(true);
    expect(compiled.system.evaluate({ might: 12 })).toEqual({ a: 2 });
  });
});

describe('the buildings section', () => {
  it('refuses a kind it does not have, whatever it is called', () => {
    const def = JSON.parse('{"format":1,"name":"X","buildings":{"constructor":{},"__proto__":{"a":1},"toString":{}}}');
    expect(problemsOf(def)).toEqual([
      'buildings constructor: Only "types" and "catalogues" are set here',
      'buildings __proto__: Only "types" and "catalogues" are set here',
      'buildings toString: Only "types" and "catalogues" are set here',
    ]);
  });
});

describe('a save never stops the server', () => {
  it('a system whose formulas cannot be worked out keeps the sheet as it was, and says why', () => {
    const meta = runtime.metaOf({ format: 1, name: 'Fragile', derived: [{ id: 'guard', formula: '10 + @might' }] });
    const sheet = { guard: 7 };
    Object.defineProperty(sheet, 'might', { enumerable: true, get() { throw new Error('a field that cannot be read'); } });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(meta.recompute(sheet)).toEqual([]);
    expect(sheet.guard).toBe(7);
    expect(log).toHaveBeenCalledWith('[systems] Fragile: derived values not worked out:', 'a field that cannot be read');
    log.mockRestore();
  });
});

describe('installing hostile files through the server', () => {
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
  const preview = (file) => request(app).post('/api/systems/install/preview').set(gm).send({ file });
  const install = (file) => request(app).post('/api/systems/install').set(gm).send({ file, mode: 'new' });
  const stillAnswers = async () => expect((await request(app).get('/api/systems').set(gm)).status).toBe(200);

  it('refuses nesting no sheet would have, without falling over', async () => {
    const deep = `${'['.repeat(200000)}${']'.repeat(200000)}`;
    for (const at of ['"description":', '"junk":', '"sheet":{"sections":']) {
      const close = at.includes('{') ? '}' : '';
      const res = await preview(fileText(`{"format":1,"name":"Deep",${at}${deep}${close}}`));
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.status).toBeLessThan(500);
    }
    await stillAnswers();
  });

  it('refuses a file past the size cap before reading it', async () => {
    const res = await preview(fileText(JSON.stringify({ format: 1, name: 'Big', description: 'x'.repeat(citysys.MAX_BYTES) })));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.status).toBeLessThan(500);
    expect(JSON.stringify(res.body)).toContain('Larger than');
  });

  it('takes a file of prototype names as a draft to fix, and nothing leaks', async () => {
    const definition = '{"format":1,"name":"Proto","__proto__":{"polluted":1},'
      + '"words":{"__proto__":{"singular":"X"},"constructor":{"singular":"Y"}},'
      + '"parts":{"__proto__":{"on":false}},"buildings":{"__proto__":{}},'
      + '"lookups":{"__proto__":{"bands":[{"value":1}]}},'
      + '"derived":[{"id":"a","formula":"constructor(1) + toString(2)"}]}';
    expect((await preview(fileText(definition))).status).toBe(200);
    const res = await install(fileText(definition));
    expect(res.status).toBe(200);
    expect({}.polluted).toBeUndefined();
    const listed = (await request(app).get('/api/systems').set(gm)).body;
    expect(JSON.stringify(listed)).toContain('Proto');
    // A draft with problems is never something a game can run.
    const id = res.body.id;
    expect((await request(app).post(`/api/systems/${id}/publish`).set(gm)).status).toBeGreaterThanOrEqual(400);
    await stillAnswers();
  });

  it('keeps markup in names as plain text: nothing is run, nothing is stripped', async () => {
    const name = '<img src=x onerror=alert(1)>';
    const res = await preview(fileText(JSON.stringify({ format: 1, name, description: '<script>alert(1)</script>' })));
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).toContain(JSON.stringify(name).slice(1, -1));
  });
});
