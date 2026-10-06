/**
 * Renaming a system (4a1a). Decided with the user: the new name shows everywhere at once, in the
 * draft and the running copy alike, without a republish (2026-10-03), and a name another system
 * already has is refused with an error, so the GM can pick another straight away (2026-10-06).
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
const EMBER = 'sys_bbbbbbbbbbbbbbbb';
const GONE = 'sys_cccccccccccccccc';
const DRAFTING = 'sys_dddddddddddddddd';

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
  const add = (id, name, draft, published) => run(db,
    'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, ?)',
    [id, name, JSON.stringify(draft), published ? JSON.stringify(published) : null, published ? 3 : 0]);
  await add(HEARTH, 'Hearth', DRAFT, PUBLISHED);
  await add(EMBER, 'Ember', { format: 1, name: 'Ember' }, { format: 1, name: 'Ember' });
  await add(GONE, 'Ashes', { format: 1, name: 'Ashes' }, { format: 1, name: 'Ashes' });
  await add(DRAFTING, 'Kindling', { format: 1, name: 'Kindling' }, null);
  await run(db, 'UPDATE custom_systems SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?', [GONE]);
  await new Promise((resolve) => runtime.load(db, resolve));
});
afterEach(() => elevatedUsers.delete('ghost'));

const rename = (name, id = HEARTH, token = GM) =>
  request(app).put(`/api/systems/${id}/name`).set(bearer(token)).send(name === undefined ? {} : { name });
const stored = async (id = HEARTH) => {
  const row = await get(db, 'SELECT name, draft, published, version FROM custom_systems WHERE id = ?', [id]);
  return { name: row.name, draft: JSON.parse(row.draft), published: JSON.parse(row.published), version: row.version };
};
const UNCHANGED = { name: 'Hearth', draft: DRAFT, published: PUBLISHED, version: 3 };

describe('renaming a system', () => {
  it('renames the draft and the running copy alike, trimmed, with no new version, and tells every browser', async () => {
    const res = await rename('  Hearthfire ');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ name: 'Hearthfire' });
    // The draft's own unpublished work is still there, and still unpublished.
    expect(await stored()).toEqual({
      name: 'Hearthfire', draft: { ...DRAFT, name: 'Hearthfire' }, published: { ...PUBLISHED, name: 'Hearthfire' }, version: 3,
    });
    expect(runtime.render(HEARTH).name).toBe('Hearthfire');
    expect(runtime.list().find((s) => s.id === HEARTH).name).toBe('Hearthfire');
    expect(emitted).toEqual([{ event: 'customSystemChanged', data: { id: HEARTH } }]);
  });

  it('renames one not yet published, which stays unpublished', async () => {
    expect((await rename('Tinder', DRAFTING)).status).toBe(200);
    const row = await get(db, 'SELECT name, draft, published FROM custom_systems WHERE id = ?', [DRAFTING]);
    expect(row).toEqual({ name: 'Tinder', draft: JSON.stringify({ format: 1, name: 'Tinder' }), published: null });
  });

  it('refuses a name another system has, whatever its capitals or spaces, changing nothing', async () => {
    for (const name of ['Ember', 'ember', ' EMBER ', 'Kindling']) {
      const res = await rename(name);
      expect(res.status, name).toBe(409);
      expect(res.body.error, name).toBe(`Another system is already called ${name.trim() === 'Kindling' ? 'Kindling' : 'Ember'}.`);
    }
    expect(await stored()).toEqual(UNCHANGED);
    expect(emitted).toEqual([]);
  });

  it('takes a deleted system\'s name, and its own with new capitals', async () => {
    expect((await rename('Ashes')).status).toBe(200);
    expect((await rename('ASHES')).status).toBe(200);
    expect((await stored()).name).toBe('ASHES');
  });

  it('refuses a blank, missing or too long name', async () => {
    for (const name of ['', '   ', undefined, 42, null]) {
      const res = await rename(name);
      expect(res.status, String(name)).toBe(400);
      expect(res.body.error, String(name)).toBe('A system needs a name');
    }
    const res = await rename('A'.repeat(81));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('A name is at most 80 characters');
    expect((await rename(` ${'A'.repeat(80)} `)).status).toBe(200);
    expect((await stored()).name).toBe('A'.repeat(80));
  });

  it('refuses a system that isn\'t there, a deleted one, and a built-in one', async () => {
    for (const id of ['sys_eeeeeeeeeeeeeeee', GONE, 'cities_without_number']) {
      expect((await rename('Hearthfire', id)).status, id).toBe(404);
    }
    expect((await get(db, 'SELECT name FROM custom_systems WHERE id = ?', [GONE])).name).toBe('Ashes');
    expect(emitted).toEqual([]);
  });

  it('is the main admin\'s alone', async () => {
    expect((await rename('Hearthfire', HEARTH, EDITOR)).status).toBe(403);
    expect((await rename('Hearthfire', HEARTH, PLAYER)).status).toBe(403);
    expect((await request(app).put(`/api/systems/${HEARTH}/name`).send({ name: 'Hearthfire' })).status).toBe(401);
    expect(await stored()).toEqual(UNCHANGED);
  });
});
