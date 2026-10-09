/**
 * TRY IT's health (4c1). Approved mockup builder-try-it (2026-10-08): DAMAGE and HEAL (and a
 * model's own actions) on a pretend token, through the same rules the game runs, with the HEALTH
 * folder's views of the result; the draft as it stands, nothing saved.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createRequire } from 'module';
import { makeTestDb } from './helpers/testDb.js';

process.env.JWT_SECRET = 'test-secret';
const require_ = createRequire(import.meta.url);
const { tryHealth, healthOfDraft } = require_('../systemBuilder/tryHealth');
const { applyHealthAction } = require_('../systemBuilder/health');
const { healthView } = require_('../systemBuilder/healthView');
const { elevatedUsers } = require_('../middleware/auth');
const systemsRoute = require_('../routes/systems.js');

const H = { format: 1, name: 'Hearth' };
const TRACKS = { model: 'tracks', tracks: [{ id: 'physical', label: 'PHYSICAL' }, { id: 'stun', label: 'STUN' }], overflow: true };
const HARM = { model: 'harm', levels: [
  { id: 'lesser', label: 'LESSER', slots: 2, penalty: 'Reduced effect' },
  { id: 'moderate', label: 'MODERATE', slots: 2, penalty: '-1d' },
  { id: 'severe', label: 'SEVERE', slots: 1, penalty: 'Need help' },
] };
const withHealth = (health, extra = {}) => ({ ...H, core: { health }, ...extra });

describe('the model tried', () => {
  it('is the draft\'s own, one pool when it never answered, none with token health off', () => {
    expect(healthOfDraft(H)).toEqual({ model: 'pool' });
    expect(healthOfDraft(withHealth(TRACKS))).toEqual(TRACKS);
    expect(healthOfDraft(withHealth(TRACKS, { parts: { token_health: { on: false } } }))).toEqual({ model: 'none' });
    expect(healthOfDraft(null)).toEqual({ model: 'pool' });
  });
});

describe('an action tried', () => {
  it('runs the game\'s own rules: temp HP first, then the pool', () => {
    const r = tryHealth(H, { token: { current: 21, max: 21, temp: 5 }, action: { kind: 'damage', amount: 8 } });
    expect(r.token).toEqual({ current: 18, max: 21, temp: 0 });
    expect(r.result).toEqual(applyHealthAction({ model: 'pool' }, { current: 21, max: 21, temp: 5 }, {}, { kind: 'damage', amount: 8 }));
    expect(tryHealth(H, { token: r.token, action: { kind: 'heal', amount: 50 } }).token.current).toBe(21);
  });

  it('writes a model\'s sheet fields, and shows the owner the detail and others only the shape of it', () => {
    const def = withHealth(TRACKS);
    const r = tryHealth(def, { token: { current: 10, max: 10 }, sheet: { stun: 2, stun_max: 6 }, action: { kind: 'damage', amount: 3, track: 'stun' } });
    expect(r.result.ok).toBe(true);
    expect(r.sheet).toEqual({ stun: 5, stun_max: 6 });
    expect(r.full).toEqual(healthView(TRACKS, r.token, r.sheet, { full: true }));
    expect(r.others).toEqual(healthView(TRACKS, r.token, r.sheet, { full: false }));
    expect(r.full.second).toMatchObject({ current: 5, max: 6 });
    expect(r.others.second).not.toHaveProperty('current');
  });

  it('places harm as a note, the level shown to others by name', () => {
    const r = tryHealth(withHealth(HARM), { token: { current: 5, max: 5 }, action: { kind: 'damage', level: 'lesser', note: 'Cut' } });
    expect(r.sheet).toEqual({ lesser_1: 'Cut' });
    expect(r.others).toMatchObject({ model: 'harm', worstLabel: 'LESSER' });
  });

  it('passes on a refusal, changing nothing', () => {
    const r = tryHealth(H, { token: { current: 9, max: 10 }, sheet: { x: 1 }, action: { kind: 'damage', amount: 0 } });
    expect(r.result).toEqual({ ok: false, error: 'An amount above 0' });
    expect([r.token, r.sheet]).toEqual([{ current: 9, max: 10, temp: 0 }, { x: 1 }]);
    const none = tryHealth(withHealth(TRACKS, { parts: { token_health: { on: false } } }), { token: { current: 9, max: 10 }, action: { kind: 'damage', amount: 2 } });
    expect(none.result.ok).toBe(false);
    expect(none.model).toBe('none');
  });

  it('just draws the views when nothing is done, in the system\'s own word for HP', () => {
    const def = { ...H, words: { hp: { singular: 'VIGOR', short: 'VIG' } } };
    expect(tryHealth(def, { token: { current: 4, max: 9 } })).toMatchObject({ result: null, token: { current: 4, max: 9, temp: 0 }, full: { model: 'pool', label: 'VIG' } });
    expect(tryHealth(H, {})).toMatchObject({ token: { current: 0, max: 0, temp: 0 }, sheet: {} });
    const odd = tryHealth(H, { token: { current: 'x', max: 5, temp: -3 }, sheet: [1] });
    expect([odd.token, odd.sheet]).toEqual([{ current: 0, max: 5, temp: 0 }, {}]);
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
  const post = (body, token = GM) => request(app).post('/api/systems/try-health').set({ Authorization: `Bearer ${token}` }).send(body);

  it('tries an action on the draft as sent', async () => {
    const res = await post({ definition: withHealth(TRACKS), token: { current: 10, max: 10 }, sheet: { stun: 0, stun_max: 6 }, action: { kind: 'damage', amount: 2, track: 'stun' } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ model: 'tracks', sheet: { stun: 2 }, result: { ok: true } });
  });

  it('refuses what isn\'t a definition, and is the main admin\'s alone', async () => {
    expect(await post({ definition: 'nope' })).toMatchObject({ status: 400, body: { error: 'A system definition must be an object' } });
    expect((await post({ definition: H }, EDITOR)).status).toBe(403);
    expect((await post({ definition: H }, PLAYER)).status).toBe(403);
    expect((await request(app).post('/api/systems/try-health').send({ definition: H })).status).toBe(401);
  });
});
