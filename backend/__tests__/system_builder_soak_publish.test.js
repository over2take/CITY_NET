/**
 * The random-system soak, part one (4k2; plan row 4k random-system-soak): each random system
 * (helpers/randomSystem.js) made, published and loaded through the real routes, the running game
 * then answering about it as the server's own rules say it should: its words, the parts it has,
 * the sheet the browser draws, its conditions, its house rules, its formulas worked out, its NPC
 * tiers rolled. Then every house rule switched on, the system shared and installed again, and a
 * second version previewed and published. The built-in games stay exactly as they were.
 *
 * A few seeds in CI; SOAK_SEEDS=200 runs more. Every failure names its seed, which rebuilds it.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createRequire } from 'module';
import { makeTestDb, run } from './helpers/testDb.js';

process.env.JWT_SECRET = 'test-secret';
const require_ = createRequire(import.meta.url);
const { randomSystem } = require_('./helpers/randomSystem');
const runtime = require_('../systemBuilder/runtime');
const { houseRulesOn, withHouseRules } = require_('../systemBuilder/houseRules');
const { effectiveSheet, fieldsOf } = require_('../systemBuilder/sheet');
const { conditionsOf } = require_('../systemBuilder/conditions');
const { PARTS, partOn } = require_('../systemBuilder/parts');
const { TERMS } = require_('../systemBuilder/terms');

const GM = { Authorization: `Bearer ${jwt.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, 'test-secret')}` };
const SEEDS = Array.from({ length: Number(process.env.SOAK_SEEDS) || 25 }, (_, i) => 1000 + i);
const BUILT_IN = ['cities_without_number', 'cyberpunk_red', 'shadowrun_6e', 'generic'];

let db;
let app;
/** What the built-in games answer before any random system exists, to hold them to after. */
let before;
const builtInAnswers = () => Object.fromEntries(BUILT_IN.map((s) => [s, {
  parts: PARTS.map((p) => runtime.partIn(s, p)),
  conditions: runtime.conditionsIn(s),
  meta: runtime.meta(s),
  render: runtime.render(s),
  rules: runtime.houseRulesIn(s),
}]));

beforeAll(async () => {
  db = await makeTestDb();
  await run(db, `INSERT INTO global_settings (key, value) VALUES ('game_system', 'cities_without_number')`);
  app = express();
  app.use(express.json({ limit: '2mb' }));
  app.use('/api/systems', require_('../routes/systems.js')(db, { emit: () => {} }));
  await new Promise((resolve) => runtime.load(db, resolve));
  before = builtInAnswers();
});

/** Where two definitions differ, path by path, so a failure says what changed. */
const differences = (a, b, path = '') => {
  if (JSON.stringify(a) === JSON.stringify(b)) return [];
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].flatMap((k) => differences(a[k], b[k], `${path}.${k}`));
  }
  return [`${path}: ${JSON.stringify(b)} -> ${JSON.stringify(a)}`];
};
/** What the running game should answer for `def`, by the server's own rules: its house rules as they start. */
const expected = (def, on = houseRulesOn(def)) => {
  const ran = withHouseRules(def, on);
  return {
    parts: Object.fromEntries(PARTS.map((p) => [p, partOn(ran, p)])),
    sections: effectiveSheet(ran).sections.map((s) => s.id),
    conditions: conditionsOf(ran).map((c) => c.id),
    derived: (ran.derived || []).map((d) => d.id),
  };
};

/** The game's own answers about a running system, checked against what `def` should give. */
const holdsTo = async (seed, id, def, on) => {
  const want = expected(def, on);
  const res = await request(app).get(`/api/systems/render/${id}`);
  expect(res.status, `seed ${seed}`).toBe(200);
  const render = res.body;
  for (const [term, forms] of Object.entries(def.words || {})) {
    expect(render.words[term].singular, `seed ${seed} word ${term}`).toBe(forms.singular);
  }
  for (const term of Object.keys(TERMS).filter((t) => !(def.words || {})[t])) expect(render.words[term], `seed ${seed} word ${term}`).toBeUndefined();
  for (const p of PARTS) expect(runtime.partIn(id, p), `seed ${seed} part ${p}`).toBe(want.parts[p]);
  expect(render.sheet.sections.map((s) => s.id), `seed ${seed} sheet`).toEqual(want.sections);
  expect(runtime.conditionsIn(id).map((c) => c.id), `seed ${seed} conditions`).toEqual(want.conditions);
  expect(render.house_rules.map((r) => r.id), `seed ${seed} house rules`).toEqual((def.house_rules || []).map((r) => r.id));
  // Every formula worked out on the sample character, a number each.
  const data = { ...(def.samples || {}) };
  expect(() => runtime.meta(id).recompute(data), `seed ${seed} recompute`).not.toThrow();
  for (const d of want.derived) expect(Number.isFinite(data[d]), `seed ${seed} formula ${d} = ${data[d]}`).toBe(true);
  // Every tier rolled, low and high, its HP and defense in the token's range or the token's own.
  const tiers = runtime.tiers(id);
  if (!want.parts.npc_tiers || !(def.npc && def.npc.tiers && def.npc.tiers.length)) expect(tiers, `seed ${seed} tiers`).toBeNull();
  else {
    for (const t of def.npc.tiers) {
      for (const level of [1, 10]) {
        const made = tiers.build(t.id, level, () => 0.5);
        expect(made.tierId, `seed ${seed} tier ${t.id}`).toBe(t.id);
        if (made.hp !== null) expect(Number.isInteger(made.hp) && made.hp >= 0 && made.hp <= 9999, `seed ${seed} tier ${t.id} hp ${made.hp}`).toBe(true);
        if (made.dv.melee !== null) expect(made.dv.melee >= 0 && made.dv.melee <= 99, `seed ${seed} tier ${t.id} defense ${made.dv.melee}`).toBe(true);
      }
    }
  }
};

describe('every random system, made and played through the routes', () => {
  it.each(SEEDS)('seed %i: made, published, loaded, switched, shared and published again', async (seed) => {
    const def = randomSystem(seed);
    const made = await request(app).post('/api/systems').set(GM).send({ definition: def });
    expect(made.status, `seed ${seed}`).toBe(200);
    expect(made.body.problems, `seed ${seed}`).toEqual([]);
    const { id } = made.body;
    expect((await request(app).post(`/api/systems/${id}/publish`).set(GM)).body, `seed ${seed}`).toEqual({ version: 1 });
    await holdsTo(seed, id, def);

    // Every house rule on at the table: the game runs them.
    const rules = (def.house_rules || []).map((r) => r.id);
    if (rules.length) {
      const switched = await request(app).put(`/api/systems/${id}/house-rules`).set(GM).send({ rules: Object.fromEntries(rules.map((r) => [r, true])) });
      expect(switched.status, `seed ${seed}`).toBe(200);
      await holdsTo(seed, id, def, new Set(rules));
    }

    // Shared as a file and installed again beside it: the same system under a copy's name.
    const file = (await request(app).get(`/api/systems/${id}/export`).set(GM)).text;
    const installed = await request(app).post('/api/systems/install').set(GM).send({ file, mode: 'keep_both' });
    expect(installed.status, `seed ${seed}`).toBe(200);
    expect(installed.body, `seed ${seed}`).toMatchObject({ published: true, problems: [] });
    const copy = (await request(app).get(`/api/systems/${installed.body.id}`).set(GM)).body;
    expect(differences({ ...copy.published, name: def.name }, def), `seed ${seed}`).toEqual([]);
    await holdsTo(seed, installed.body.id, { ...def, name: copy.published.name });

    // A second version, another seed's under this one's name: previewed, then published.
    const next = { ...randomSystem(seed + 100000), name: def.name };
    expect((await request(app).put(`/api/systems/${id}/draft`).set(GM).send({ definition: next })).body.problems, `seed ${seed}`).toEqual([]);
    const preview = await request(app).get(`/api/systems/${id}/publish-preview`).set(GM);
    expect(preview.status, `seed ${seed}`).toBe(200);
    expect(preview.body, `seed ${seed}`).toMatchObject({ first: false, from: 1, to: 2, problems: 0 });
    expect(Array.isArray(preview.body.changes), `seed ${seed}`).toBe(true);
    expect((await request(app).post(`/api/systems/${id}/publish`).set(GM)).body, `seed ${seed}`).toEqual({ version: 2 });
    // The table's choices outlive the version; a rule the new one doesn't have is simply not there.
    const kept = new Set(rules.filter((r) => (next.house_rules || []).some((x) => x.id === r)));
    const on = new Set([...houseRulesOn(next)].filter((r) => !rules.includes(r)).concat([...kept]));
    await holdsTo(seed, id, next, on);
  });

  it('leaves the built-in games exactly as they were: every part on, no house rules, nothing loaded', () => {
    expect(builtInAnswers()).toEqual(before);
    for (const s of BUILT_IN) {
      expect(before[s].parts.every(Boolean), s).toBe(true);
      expect(before[s].rules, s).toEqual([]);
      expect([before[s].meta, before[s].render], s).toEqual([null, null]);
    }
  });
});
