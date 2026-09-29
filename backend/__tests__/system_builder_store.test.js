import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createRequire } from 'module';
import { makeTestDb, get, run } from './helpers/testDb.js';

/**
 * Custom game systems: the definition format, its checks, and storage.
 *
 * A definition is typed into the builder or installed from someone else's file, so it is
 * checked on the server. A draft may hold problems - a system half-built is normal - but
 * cannot be published until it has none, so a game never runs a broken system. Only the main
 * admin reaches any of it.
 */

process.env.JWT_SECRET = 'test-secret';
const require_ = createRequire(import.meta.url);
const def = require_('../systemBuilder/definition');
const store = require_('../systemBuilder/store');
const { CITIES_WITHOUT_NUMBER } = require_('../systemBuilder/definitions');
const { elevatedUsers } = require_('../middleware/auth');
const systemsRoute = require_('../routes/systems.js');

const GM = jwt.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, 'test-secret');
const EDITOR = jwt.sign({ username: 'ghost', isTemporary: true }, 'test-secret');
const PLAYER = jwt.sign({ username: 'vex', role: 'player' }, 'test-secret');
const bearer = (t) => ({ Authorization: `Bearer ${t}` });

const messages = (checked) => checked.problems.map((p) => `${p.where}: ${p.message}`);

describe('the definition format', () => {
  it('a name is enough to be valid', () => {
    expect(def.checkDefinition({ format: 1, name: 'Vault Knights' })).toEqual({ problems: [] });
    expect(def.checkDefinition(def.blankDefinition('  Vault Knights  '))).toEqual({ problems: [] });
  });

  it('carries a whole built-in system as data without a problem', () => {
    const cwn = { format: 1, name: 'CWN, as data', ...CITIES_WITHOUT_NUMBER };
    expect(def.checkDefinition(cwn)).toEqual({ problems: [] });
  });

  it('refuses, as fatal, what cannot be stored at all', () => {
    for (const bad of [null, 'text', 42, [], [{ name: 'x' }]]) {
      expect(def.checkDefinition(bad).fatal, JSON.stringify(bad)).toBeTruthy();
    }
    const huge = { format: 1, name: 'Big', description: 'x'.repeat(def.LIMITS.bytes) };
    expect(def.checkDefinition(huge).fatal).toMatch(/Larger than/);
  });

  it('reads files and bodies as text, refusing what is not JSON or too large', () => {
    expect(def.parseDefinition('{"format":1,"name":"A"}')).toEqual({ ok: true, definition: { format: 1, name: 'A' } });
    expect(def.parseDefinition('{nope').fatal).toBe('Not valid JSON');
    expect(def.parseDefinition('x'.repeat(def.LIMITS.bytes + 1)).fatal).toMatch(/Larger than/);
    expect(def.parseDefinition(null).fatal).toBe('Not text');
  });

  it('reports every problem at once, each with where it is', () => {
    const checked = def.checkDefinition({
      format: 2,
      name: '   ',
      description: 'd'.repeat(def.LIMITS.description + 1),
      skills: [],
      words: { hp: { singular: 'WOUNDS', feminine: 'X' }, mana: { singular: 'MANA' }, xp: 'GLORY', money: { short: '' } },
      parts: { vehicles: { on: false }, cyberware: { on: 'no' }, dragons: { on: true }, bank: { on: true, colour: 'red' } },
      derived: [{ id: 'a', formula: '@a + 1' }],
    });
    expect(messages(checked)).toEqual([
      'skills: Not a section this version knows',
      'format: This version reads format 1',
      'name: Cannot be blank',
      `description: Longer than ${def.LIMITS.description} characters`,
      'words hp, feminine: Only singular, plural and short',
      'words mana: Not a term the app uses',
      'words xp: Must give singular, plural or short',
      'words money, short: Cannot be blank',
      'parts cyberware: Must say on: true or on: false',
      'parts dragons: Not a part of the app',
      'parts bank, colour: Only "on" is set here',
      'derived a: Depends on itself: a → a',
    ]);
  });

  it('a missing name, or one that is not text, is a problem', () => {
    expect(messages(def.checkDefinition({ format: 1 }))).toEqual(['name: Required']);
    expect(messages(def.checkDefinition({ name: 7 }))).toEqual(['name: Must be text']);
  });

  it("names things in the system's own words, or the app's when it has none", () => {
    const d = { words: { hp: { singular: 'WOUND', plural: 'WOUNDS' }, money: { short: 'GP' } } };
    expect(def.wordFor(d, 'hp')).toBe('WOUND');
    expect(def.wordFor(d, 'hp', 'plural')).toBe('WOUNDS');
    expect(def.wordFor(d, 'money', 'short')).toBe('GP');
    expect(def.wordFor(d, 'money')).toBe('CREDIT');
    expect(def.wordFor(d, 'class', 'short')).toBe('CLASS');
    expect(def.wordFor(null, 'level', 'short')).toBe('LVL');
  });

  it('has every part on unless the system turns it off', () => {
    const d = { parts: { vehicles: { on: false }, bank: { on: true } } };
    expect(def.partOn(d, 'vehicles')).toBe(false);
    expect(def.partOn(d, 'bank')).toBe(true);
    expect(def.partOn(d, 'shops')).toBe(true);
    expect(def.partOn(undefined, 'cyberware')).toBe(true);
  });
});

describe('the systems routes', () => {
  let db;
  let app;
  beforeEach(async () => {
    db = await makeTestDb();
    app = express();
    app.use(express.json({ limit: '2mb' }));
    app.use('/api/systems', systemsRoute(db));
  });
  afterEach(() => elevatedUsers.clear());

  const create = (body) => request(app).post('/api/systems').set(bearer(GM)).send(body);
  const list = async () => (await request(app).get('/api/systems').set(bearer(GM))).body;

  describe('who may use them', () => {
    it('only the main admin: not a granted editor, not a player, not anyone', async () => {
      elevatedUsers.add('ghost');
      for (const [who, headers, status] of [
        ['editor', bearer(EDITOR), 403], ['player', bearer(PLAYER), 403], ['nobody', {}, 401],
      ]) {
        const res = await request(app).get('/api/systems').set(headers);
        expect(res.status, who).toBe(status);
      }
      expect((await request(app).get('/api/systems').set(bearer(GM))).status).toBe(200);
    });
  });

  it('creates a system from a name, with a stable id of its own', async () => {
    const res = await create({ name: 'Vault Knights' });
    expect(res.status).toBe(200);
    expect(res.body.id).toMatch(/^sys_[0-9a-f]{16}$/);
    expect(res.body.problems).toEqual([]);
    const [only] = await list();
    expect(only).toMatchObject({ id: res.body.id, name: 'Vault Knights', version: 0, published: false, unpublishedChanges: true });
  });

  it('never collides with a built-in system id', () => {
    for (const builtin of ['cities_without_number', 'cyberpunk_red', 'shadowrun_6e', 'generic']) {
      expect(store.isCustomId(builtin)).toBe(false);
    }
  });

  it('creates from a whole definition (an import), problems and all', async () => {
    const res = await create({ definition: { format: 1, name: 'Imported', words: { mana: { singular: 'MANA' } } } });
    expect(res.status).toBe(200);
    expect(res.body.problems).toEqual([{ where: 'words mana', message: 'Not a term the app uses' }]);
  });

  it('refuses to create what cannot be stored, or has no name', async () => {
    expect((await create({ definition: ['not', 'a', 'system'] })).status).toBe(400);
    expect((await create({ name: '   ' })).status).toBe(400);
    expect((await create({})).status).toBe(400);
    expect(await list()).toEqual([]);
  });

  it('saves a draft with problems, and will not publish it until they are fixed', async () => {
    const { id } = (await create({ name: 'Draft' })).body;
    const broken = { format: 1, name: 'Draft', derived: [{ id: 'hp', formula: '@hp + 1' }] };
    const saved = await request(app).put(`/api/systems/${id}/draft`).set(bearer(GM)).send({ definition: broken });
    expect(saved.status).toBe(200);
    expect(saved.body.problems).toEqual([{ where: 'derived hp', message: 'Depends on itself: hp → hp' }]);

    const refused = await request(app).post(`/api/systems/${id}/publish`).set(bearer(GM));
    expect(refused.status).toBe(409);
    expect(refused.body.problems).toHaveLength(1);
    expect((await get(db, 'SELECT published, version FROM custom_systems WHERE id = ?', [id]))).toEqual({ published: null, version: 0 });

    const fixed = { format: 1, name: 'Draft', derived: [{ id: 'hp', formula: '@con + 10' }] };
    await request(app).put(`/api/systems/${id}/draft`).set(bearer(GM)).send({ definition: fixed });
    const published = await request(app).post(`/api/systems/${id}/publish`).set(bearer(GM));
    expect(published.status).toBe(200);
    expect(published.body).toEqual({ version: 1 });
  });

  it('keeps the published copy as it was while the draft moves on', async () => {
    const { id } = (await create({ name: 'Live' })).body;
    await request(app).post(`/api/systems/${id}/publish`).set(bearer(GM));
    expect((await list())[0]).toMatchObject({ published: true, unpublishedChanges: false, version: 1 });

    await request(app).put(`/api/systems/${id}/draft`).set(bearer(GM))
      .send({ definition: { format: 1, name: 'Live, renamed', parts: { vehicles: { on: false } } } });
    const sys = (await request(app).get(`/api/systems/${id}`).set(bearer(GM))).body;
    expect(sys.name).toBe('Live, renamed');
    expect(sys.draft.parts).toEqual({ vehicles: { on: false } });
    expect(sys.published).toEqual({ format: 1, name: 'Live' });
    expect((await list())[0]).toMatchObject({ unpublishedChanges: true, version: 1 });

    await request(app).post(`/api/systems/${id}/publish`).set(bearer(GM));
    const after = (await request(app).get(`/api/systems/${id}`).set(bearer(GM))).body;
    expect(after.published.name).toBe('Live, renamed');
    expect(after.version).toBe(2);
  });

  it('refuses a draft that cannot be stored, leaving the old one', async () => {
    const { id } = (await create({ name: 'Keep' })).body;
    const res = await request(app).put(`/api/systems/${id}/draft`).set(bearer(GM)).send({ definition: 'gibberish' });
    expect(res.status).toBe(400);
    expect((await request(app).get(`/api/systems/${id}`).set(bearer(GM))).body.draft).toEqual({ format: 1, name: 'Keep' });
  });

  it('answers 404 for a system that is not there, or an id that is not one', async () => {
    for (const id of ['sys_0000000000000000', 'cities_without_number', '1; DROP TABLE custom_systems']) {
      const res = await request(app).get(`/api/systems/${encodeURIComponent(id)}`).set(bearer(GM));
      expect(res.status, id).toBe(404);
    }
  });

  it('will not delete the system the game is running; deletes any other', async () => {
    const { id } = (await create({ name: 'Running' })).body;
    await run(db, `INSERT INTO global_settings (key, value) VALUES ('game_system', ?)`, [id]);
    expect((await request(app).delete(`/api/systems/${id}`).set(bearer(GM))).status).toBe(409);

    await run(db, `UPDATE global_settings SET value = 'cities_without_number' WHERE key = 'game_system'`);
    expect((await request(app).delete(`/api/systems/${id}`).set(bearer(GM))).status).toBe(200);
    expect((await request(app).get(`/api/systems/${id}`).set(bearer(GM))).status).toBe(404);
  });

  it('lists the most recently changed first', async () => {
    const a = (await create({ name: 'A' })).body.id;
    const b = (await create({ name: 'B' })).body.id;
    await run(db, `UPDATE custom_systems SET updated_at = '2020-01-01' WHERE id = ?`, [b]);
    expect((await list()).map((s) => s.id)).toEqual([a, b]);
  });
});
