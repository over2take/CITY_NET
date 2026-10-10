/**
 * TRY IT's rests (4f6a). Approved mockup builder-rests (2026-10-09): one of a draft's rests on a
 * made-up character through the game's own rules, previewed (the RESTS page's ON THE SAMPLE) or
 * rolled (TRY IT's CALL A REST), with the character as it stands after and the dice-log line the game
 * would write. The draft as it stands, nothing saved.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createRequire } from 'module';
import { makeTestDb } from './helpers/testDb.js';

process.env.JWT_SECRET = 'test-secret';
const require_ = createRequire(import.meta.url);
const { tryRest } = require_('../systemBuilder/tryRest');
const { elevatedUsers } = require_('../middleware/auth');
const systemsRoute = require_('../routes/systems.js');

const HEARTH = {
  format: 1, name: 'Hearth',
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'con_mod', label: 'Con mod' }] }],
  derived: [{ id: 'ward', label: 'Ward', formula: '@fatigue + 10' }],
  sheet: {
    sections: [
      { id: 'body', label: 'BODY', layout: 'grid', fields: [
        { id: 'hp', label: 'HP', type: 'number', source: 'token_hp', maxField: 'hp_max' },
        { id: 'hp_max', label: 'MAX', type: 'number', source: 'token_hp_max' },
        { id: 'fatigue', label: 'Fatigue', type: 'number' },
        { id: 'ward', label: 'Ward', type: 'number' },
      ] },
      { id: 'magic', label: 'MAGIC', layout: 'grid', fields: [
        { id: 'slots', label: 'Spell slots', type: 'number', maxField: 'slots_max' },
        { id: 'slots_max', label: 'Slots max', type: 'number' },
      ] },
    ],
  },
  rests: {
    short_rest: { refills: [{ what: 'health', how: 'by', amount: '1d8 + @con_mod' }] },
    long_rest: { counts_as: ['short_rest'], refills: [{ what: 'health', how: 'full' }, { what: 'fatigue', how: 'by', amount: '-1' }, { what: 'section:magic', how: 'max' }] },
    end_of_session: { refills: [{ what: 'slots', how: 'to', amount: '@ward - 10' }] },
    end_of_scene: { on: false },
  },
  conditions: { exhausted: { ends: 'rest', at: ['long_rest'] } },
};
const SAMPLE = { con_mod: 2, fatigue: 3, slots: 0, slots_max: 4 };
const TOKEN = { current: 9, max: 22 };
/** Every die shows `face` on a die of `sides`. */
const showing = (face, sides) => () => (face - 1) / sides + 1e-9;

describe('a rest tried', () => {
  it('previews a long rest on the sample: the character after, what wore off, and the game\'s line', () => {
    const r = tryRest(HEARTH, { rest: 'long_rest', sheet: SAMPLE, token: TOKEN, conditions: [{ id: 'exhausted' }, { id: 'prone' }] });
    expect(r.ok).toBe(true);
    expect(r.rest).toEqual({ id: 'long_rest', name: 'Long rest' });
    expect(r.changes).toEqual([
      { what: 'health', label: 'HP', from: 9, to: 22 },
      { what: 'fatigue', label: 'Fatigue', from: 3, to: 2 },
      { what: 'slots', label: 'Spell slots', from: 0, to: 4 },
    ]);
    // Formulas worked out again after: ward follows fatigue.
    expect(r.sheet).toEqual({ con_mod: 2, fatigue: 2, slots: 4, slots_max: 4, ward: 12 });
    expect(r.token).toEqual({ current: 22, max: 22, temp: 0 });
    expect(r.conditions).toEqual([{ id: 'prone' }]);
    expect(r.gone).toEqual(['Exhausted']);
    // Previewed: the short rest's die is never rolled.
    expect(r.rolls.every((x) => x.dice.length === 0)).toBe(true);
    expect(r.line).toBe('LONG REST · Sample: HP 9 → 22, Fatigue 3 → 2, Spell slots 0 → 4; Exhausted wore off');
  });

  it('leaves dice waiting in a preview, and rolls them when asked', () => {
    expect(tryRest(HEARTH, { rest: 'short_rest', sheet: SAMPLE, token: TOKEN }).changes)
      .toEqual([{ what: 'health', label: 'HP', from: 9, to: null, pending: ['1d8 + @con_mod'] }]);
    const rolled = tryRest(HEARTH, { rest: 'short_rest', sheet: SAMPLE, token: TOKEN, roll: true }, showing(5, 8));
    expect(rolled.changes).toEqual([{ what: 'health', label: 'HP', from: 9, to: 16 }]);
    expect(rolled.rolls).toEqual([{ amount: '1d8 + @con_mod', value: 7, dice: [{ count: 1, sides: 8, rolls: [5] }] }]);
    expect(rolled.line).toBe('SHORT REST · Sample: HP 9 → 16; rolled 1d8 + @con_mod = 7 (1d8: 5)');
  });

  it('reads the draft\'s formulas worked out from what was typed', () => {
    // Ward is fatigue + 10 = 13, never typed: slots become 3.
    expect(tryRest(HEARTH, { rest: 'end_of_session', sheet: SAMPLE, token: TOKEN }).sheet).toMatchObject({ slots: 3, ward: 13 });
  });

  it('still runs on a draft whose formulas don\'t work yet, the sheet as typed', () => {
    const broken = { ...HEARTH, derived: [{ id: 'ward', label: 'Ward', formula: '@fatigue +' }] };
    const r = tryRest(broken, { rest: 'long_rest', sheet: SAMPLE, token: TOKEN });
    expect(r.ok).toBe(true);
    expect(r.sheet).toEqual({ con_mod: 2, fatigue: 2, slots: 4, slots_max: 4 });
  });

  it('changes the sheet alone for a character with no token', () => {
    const r = tryRest(HEARTH, { rest: 'long_rest', sheet: SAMPLE });
    expect(r.token).toBeNull();
    expect(r.changes.map((c) => c.what)).toEqual(['fatigue', 'slots']);
    expect(tryRest(HEARTH, { rest: 'long_rest' }).sheet).toMatchObject({ fatigue: 0, ward: 10 });
  });

  it('holds a pretend token\'s numbers and temp as the game would', () => {
    expect(tryRest(HEARTH, { rest: 'long_rest', token: { current: '4', max: 'x', temp: -3 } }).token).toEqual({ current: 0, max: 0, temp: 0 });
    expect(tryRest(HEARTH, { rest: 'long_rest', token: { current: 4, max: 10, temp: 2 } }).token).toEqual({ current: 10, max: 10, temp: 2 });
  });

  it('refuses a rest the draft hasn\'t got or has turned off', () => {
    expect(tryRest(HEARTH, { rest: 'nap' })).toEqual({ ok: false, error: 'Not one of this system\'s rests' });
    expect(tryRest(HEARTH, { rest: 'end_of_scene' })).toEqual({ ok: false, error: 'Not one of this system\'s rests' });
    expect(tryRest(HEARTH)).toEqual({ ok: false, error: 'Not one of this system\'s rests' });
  });
});

describe('the route', () => {
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
  const post = (body, token = GM) => request(app).post('/api/systems/try-rest').set({ Authorization: `Bearer ${token}` }).send(body);

  it('tries the draft\'s rest as sent, rolling only when asked to in so many words', async () => {
    const preview = await post({ definition: HEARTH, rest: 'short_rest', sheet: SAMPLE, token: TOKEN, roll: 'yes' });
    expect(preview.status).toBe(200);
    expect(preview.body.changes).toEqual([{ what: 'health', label: 'HP', from: 9, to: null, pending: ['1d8 + @con_mod'] }]);
    const rolled = await post({ definition: HEARTH, rest: 'short_rest', sheet: SAMPLE, token: TOKEN, roll: true });
    expect(rolled.body.changes[0].to).toBeGreaterThanOrEqual(9 + 1 + 2);
    expect(rolled.body.changes[0].to).toBeLessThanOrEqual(9 + 8 + 2);
    expect(rolled.body.rolls[0].dice[0].rolls).toHaveLength(1);
  });

  it('refuses a rest the draft hasn\'t got, what isn\'t a definition, and is the main admin\'s alone', async () => {
    expect(await post({ definition: HEARTH, rest: 'nap' })).toMatchObject({ status: 400, body: { error: 'Not one of this system\'s rests' } });
    expect(await post({ definition: 'nope', rest: 'long_rest' })).toMatchObject({ status: 400, body: { error: 'A system definition must be an object' } });
    expect((await post({ definition: HEARTH, rest: 'long_rest' }, EDITOR)).status).toBe(403);
    expect((await post({ definition: HEARTH, rest: 'long_rest' }, PLAYER)).status).toBe(403);
    expect((await request(app).post('/api/systems/try-rest').send({ definition: HEARTH })).status).toBe(401);
  });
});
