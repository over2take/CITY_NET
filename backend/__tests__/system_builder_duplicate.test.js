/**
 * Duplicating a system (4a1a). Decided with the user: the copy is made from the draft, unpublished
 * changes included (2026-10-02), and named "<name> copy", "copy 02"... (2026-10-03). It is made
 * here: its own origin, no file behind it, and unpublished until its GM publishes it.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createRequire } from 'module';
import { makeTestDb, get, run } from './helpers/testDb.js';

process.env.JWT_SECRET = 'test-secret';
const require_ = createRequire(import.meta.url);
const runtime = require_('../systemBuilder/runtime');
const { elevatedUsers } = require_('../middleware/auth');
const systemsRoute = require_('../routes/systems.js');

const GM = jwt.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, 'test-secret');
const EDITOR = jwt.sign({ username: 'ghost', isTemporary: true }, 'test-secret');
const PLAYER = jwt.sign({ username: 'vex', role: 'player' }, 'test-secret');
const bearer = (t) => ({ Authorization: `Bearer ${t}` });

const HEARTH = 'sys_aaaaaaaaaaaaaaaa';
const GONE = 'sys_cccccccccccccccc';

const PUBLISHED = { format: 1, name: 'Hearth', currencies: [{ id: 'gold', name: 'Gold' }] };
const DRAFT = { ...PUBLISHED, description: 'Work in progress' };

let db;
let app;
let emitted;

beforeEach(async () => {
  elevatedUsers.add('ghost');
  db = await makeTestDb();
  emitted = [];
  app = express();
  app.use(express.json());
  app.use('/api/systems', systemsRoute(db, { emit: (event, data) => emitted.push({ event, data }) }));
  await run(db, `INSERT INTO custom_systems (id, name, draft, published, version, origin, source_hash)
    VALUES (?, 'Hearth', ?, ?, 3, 'org_hearth', 'abc')`, [HEARTH, JSON.stringify(DRAFT), JSON.stringify(PUBLISHED)]);
  await run(db, `INSERT INTO custom_systems (id, name, draft, version, deleted_at)
    VALUES (?, 'Ashes', ?, 0, CURRENT_TIMESTAMP)`, [GONE, JSON.stringify({ format: 1, name: 'Ashes' })]);
  await new Promise((resolve) => runtime.load(db, resolve));
});
afterEach(() => elevatedUsers.delete('ghost'));

const duplicate = (id = HEARTH, token = GM) => request(app).post(`/api/systems/${id}/duplicate`).set(bearer(token));
const count = async () => (await get(db, 'SELECT COUNT(*) AS n FROM custom_systems')).n;

describe('publishing a system', () => {
  it('tells every browser, so a sheet drawn from the old version is fetched again', async () => {
    const res = await request(app).post(`/api/systems/${HEARTH}/publish`).set(bearer(GM));
    expect(res.body).toEqual({ version: 4 });
    expect(JSON.parse((await get(db, 'SELECT published FROM custom_systems WHERE id = ?', [HEARTH])).published)).toEqual(DRAFT);
    expect(emitted).toEqual([{ event: 'customSystemChanged', data: { id: HEARTH } }]);
  });

  it('tells nobody when it is refused', async () => {
    await run(db, 'UPDATE custom_systems SET draft = ? WHERE id = ?', [JSON.stringify({ ...DRAFT, derived: [{ id: 'a', formula: '@a' }] }), HEARTH]);
    expect((await request(app).post(`/api/systems/${HEARTH}/publish`).set(bearer(GM))).status).toBe(409);
    expect(emitted).toEqual([]);
  });
});

describe('duplicating a system', () => {
  it('makes a new, unpublished system from the draft, named as a copy, made here', async () => {
    const res = await duplicate();
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: expect.stringMatching(/^sys_[0-9a-f]{16}$/), name: 'Hearth copy' });
    const row = await get(db, 'SELECT * FROM custom_systems WHERE id = ?', [res.body.id]);
    expect(JSON.parse(row.draft)).toEqual({ ...DRAFT, name: 'Hearth copy' });
    expect(row).toMatchObject({ name: 'Hearth copy', published: null, version: 0, origin: res.body.id, source_hash: null, deleted_at: null });
    // Not runnable until published, and the original is untouched.
    expect(runtime.render(res.body.id)).toBeFalsy();
    expect(await get(db, 'SELECT name, draft, published, version FROM custom_systems WHERE id = ?', [HEARTH]))
      .toEqual({ name: 'Hearth', draft: JSON.stringify(DRAFT), published: JSON.stringify(PUBLISHED), version: 3 });
    expect(emitted).toEqual([]);
  });

  it('is listed as made here, even from an installed system', async () => {
    const { id } = (await duplicate()).body;
    const listed = (await request(app).get('/api/systems').set(bearer(GM))).body;
    expect(Object.fromEntries(listed.map((s) => [s.id, s.installed]))).toEqual({ [HEARTH]: true, [id]: false });
  });

  it('counts on for each further copy, and a copy of a copy', async () => {
    const first = (await duplicate()).body;
    expect((await duplicate()).body.name).toBe('Hearth copy 02');
    expect((await duplicate(first.id)).body.name).toBe('Hearth copy 03');
  });

  it('copies one never published', async () => {
    const { id } = (await duplicate()).body;
    expect((await duplicate(id)).body.name).toBe('Hearth copy 02');
  });

  it('keeps the system\'s last name when its draft\'s is blank', async () => {
    await run(db, 'UPDATE custom_systems SET draft = ? WHERE id = ?', [JSON.stringify({ ...DRAFT, name: '  ' }), HEARTH]);
    const res = await duplicate();
    expect(res.body.name).toBe('Hearth copy');
    expect(JSON.parse((await get(db, 'SELECT draft FROM custom_systems WHERE id = ?', [res.body.id])).draft).name).toBe('Hearth copy');
  });

  it('ignores a deleted system\'s name', async () => {
    await run(db, 'UPDATE custom_systems SET name = ?, deleted_at = CURRENT_TIMESTAMP WHERE id = ?', ['Hearth copy', GONE]);
    expect((await duplicate()).body.name).toBe('Hearth copy');
  });

  it('refuses a system that isn\'t there, a deleted one, and a built-in one', async () => {
    const before = await count();
    for (const id of ['sys_eeeeeeeeeeeeeeee', GONE, 'cities_without_number']) {
      expect((await duplicate(id)).status, id).toBe(404);
    }
    expect(await count()).toBe(before);
  });

  it('is the main admin\'s alone', async () => {
    const before = await count();
    expect((await duplicate(HEARTH, EDITOR)).status).toBe(403);
    expect((await duplicate(HEARTH, PLAYER)).status).toBe(403);
    expect((await request(app).post(`/api/systems/${HEARTH}/duplicate`)).status).toBe(401);
    expect(await count()).toBe(before);
  });
});
