/**
 * Currency icons on the server (3c2c2): uploading one, and setting a currency's icon in the running
 * system. Decided with the user: an icon is one of CURRENCY_ICON's five or a small uploaded PNG,
 * WebP or SVG (2026-10-01), chosen in the admin panel rather than only in the builder, so it goes
 * into the system's draft and published copies alike (2026-10-02). Main admin only, like the rest
 * of the builder. SVG is safe for the same reason as battle maps: /uploads is served sandboxed and
 * the windows draw it through <img> only.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { makeTestDb, get, run } from './helpers/testDb.js';

process.env.JWT_SECRET = 'test-secret';
const require_ = createRequire(import.meta.url);
const runtime = require_('../systemBuilder/runtime');
const { elevatedUsers } = require_('../middleware/auth');
const { LIMITS } = require_('../middleware/uploadConstraints');
const systemsRoute = require_('../routes/systems.js');

const GM = jwt.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, 'test-secret');
const EDITOR = jwt.sign({ username: 'ghost', isTemporary: true }, 'test-secret');
const PLAYER = jwt.sign({ username: 'vex', role: 'player' }, 'test-secret');
const bearer = (t) => ({ Authorization: `Bearer ${t}` });

const ICONS = path.join(path.dirname(fileURLToPath(import.meta.url)), '../uploads/currency_icons');
const HEARTH = 'sys_aaaaaaaaaaaaaaaa';

let db;
let app;
let emitted;
/** Icon files this run created, removed afterwards so the real uploads folder stays clean. */
const created = [];

beforeEach(async () => {
  elevatedUsers.add('ghost');
  db = await makeTestDb();
  emitted = [];
  app = express();
  app.use(express.json());
  app.use('/api/systems', systemsRoute(db, { emit: (event, data) => emitted.push({ event, data }) }));
});
afterEach(() => {
  elevatedUsers.delete('ghost');
  for (const f of created.splice(0)) { try { fs.unlinkSync(f); } catch { /* already gone */ } }
});

/** Bytes nobody else has, so a stored file is certainly this run's. */
const unique = (kind) => Buffer.from(`${kind} citynet-test ${crypto.randomBytes(16).toString('hex')}`);
const upload = async (body, name, token = GM) => {
  const res = await request(app).post('/api/systems/currency-icons').set(bearer(token)).attach('icon', body, name);
  if (res.status === 200) created.push(path.join(ICONS, path.basename(res.body.icon)));
  return res;
};

describe('uploading an icon', () => {
  it('stores a PNG, WebP or SVG under its content hash and answers with its address', async () => {
    for (const ext of ['png', 'webp', 'svg', 'PNG']) {
      const body = unique(ext);
      const res = await upload(body, `coin.${ext}`);
      const hash = crypto.createHash('sha256').update(body).digest('hex');
      expect(res.status, ext).toBe(200);
      expect(res.body, ext).toEqual({ icon: `/uploads/currency_icons/${hash}.${ext.toLowerCase()}` });
      expect(fs.readFileSync(path.join(ICONS, `${hash}.${ext.toLowerCase()}`)).equals(body), ext).toBe(true);
    }
  });

  it('keeps the same picture once, however often it is sent', async () => {
    const body = unique('png');
    const first = await upload(body, 'a.png');
    const again = await upload(body, 'b.png');
    expect(again.body.icon).toBe(first.body.icon);
  });

  it('refuses another kind of file, saying what would have worked', async () => {
    for (const name of ['coin.gif', 'coin.jpg', 'coin.html', 'coin']) {
      const res = await upload(unique('x'), name);
      expect(res.status, name).toBe(400);
      expect(res.body, name).toMatchObject({ reason: 'UNSUPPORTED_FORMAT', allowed: ['.png', '.webp', '.svg'], maxBytes: LIMITS.currency_icon });
    }
  });

  it('refuses one larger than a quarter of a megabyte, by name', async () => {
    expect(LIMITS.currency_icon).toBe(256 * 1024);
    const res = await upload(Buffer.alloc(LIMITS.currency_icon + 1, 1), 'huge.png');
    expect(res.status).toBe(413);
    expect(res.body).toMatchObject({ reason: 'FILE_TOO_LARGE', error: '"huge.png" is over the 0.25MB limit.' });
  });

  it('refuses a request with no file in it', async () => {
    const res = await request(app).post('/api/systems/currency-icons').set(bearer(GM));
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'No icon was sent' });
  });

  it('is the main admin\'s alone, and stores nothing for anybody else', async () => {
    const before = fs.existsSync(ICONS) ? fs.readdirSync(ICONS).length : 0;
    expect((await upload(unique('png'), 'a.png', EDITOR)).status).toBe(403);
    expect((await upload(unique('png'), 'a.png', PLAYER)).status).toBe(403);
    expect((await request(app).post('/api/systems/currency-icons').attach('icon', unique('png'), 'a.png')).status).toBe(401);
    expect(fs.existsSync(ICONS) ? fs.readdirSync(ICONS).length : 0).toBe(before);
  });
});

describe('setting a currency\'s icon', () => {
  const PUBLISHED = { format: 1, name: 'Hearth', currencies: [{ id: 'gold', name: 'Gold' }, { id: 'favor', name: 'Favor' }] };
  const DRAFT = { ...PUBLISHED, description: 'Work in progress', currencies: [...PUBLISHED.currencies, { id: 'scrip', name: 'Scrip' }] };
  const UPLOADED = `/uploads/currency_icons/${'c'.repeat(64)}.svg`;

  beforeEach(async () => {
    await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 3)',
      [HEARTH, 'Hearth', JSON.stringify(DRAFT), JSON.stringify(PUBLISHED)]);
    await new Promise((resolve) => runtime.load(db, resolve));
  });
  const set = (currency, body, token = GM, id = HEARTH) =>
    request(app).put(`/api/systems/${id}/currencies/${currency}/icon`).set(bearer(token)).send(body);
  const stored = async () => {
    const row = await get(db, 'SELECT draft, published, version FROM custom_systems WHERE id = ?', [HEARTH]);
    return { draft: JSON.parse(row.draft), published: JSON.parse(row.published), version: row.version };
  };

  it('puts it in the draft and the running copy alike, changing nothing else, and the game shows it at once', async () => {
    const res = await set('gold', { icon: UPLOADED });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ icon: UPLOADED });
    const after = await stored();
    expect(after.published).toEqual({ ...PUBLISHED, currencies: [{ id: 'gold', name: 'Gold', icon: UPLOADED }, PUBLISHED.currencies[1]] });
    // The draft's own unpublished work is still there, and still unpublished.
    expect(after.draft).toEqual({ ...DRAFT, currencies: [{ id: 'gold', name: 'Gold', icon: UPLOADED }, ...DRAFT.currencies.slice(1)] });
    expect(after.version).toBe(3);
    expect(runtime.render(HEARTH).currencies[0].icon).toBe(UPLOADED);
    expect(emitted).toEqual([{ event: 'customSystemChanged', data: { id: HEARTH } }]);
  });

  it('takes one of the five the app has always offered, and clears with null', async () => {
    expect((await set('favor', { icon: '🪙' })).status).toBe(200);
    expect((await stored()).published.currencies[1]).toEqual({ id: 'favor', name: 'Favor', icon: '🪙' });
    expect((await set('favor', { icon: null })).body).toEqual({ icon: null });
    const after = await stored();
    expect(after.published.currencies[1]).toEqual({ id: 'favor', name: 'Favor' });
    expect(after.draft.currencies[1]).toEqual({ id: 'favor', name: 'Favor' });
    expect(runtime.render(HEARTH).currencies[1]).not.toHaveProperty('icon');
  });

  it('sets one only the draft has yet, leaving the running copy as it is', async () => {
    expect((await set('scrip', { icon: '$' })).status).toBe(200);
    const after = await stored();
    expect(after.draft.currencies[2]).toEqual({ id: 'scrip', name: 'Scrip', icon: '$' });
    expect(after.published).toEqual(PUBLISHED);
  });

  it('refuses an icon that is neither, a currency neither copy has, and a system that isn\'t there', async () => {
    for (const icon of ['¥', '/uploads/battle_maps/x.png', 'https://example.com/coin.png', 42, undefined]) {
      const res = await set('gold', icon === undefined ? {} : { icon });
      expect(res.status, String(icon)).toBe(400);
      expect(res.body.error, String(icon)).toBe('An icon is one of credits $ £ € 🪙 or an uploaded icon');
    }
    expect((await set('honor', { icon: '$' })).status).toBe(404);
    expect((await set('honor', { icon: '$' })).body).toEqual({ error: 'No such currency' });
    expect((await set('gold', { icon: '$' }, GM, 'sys_bbbbbbbbbbbbbbbb')).status).toBe(404);
    expect((await set('gold', { icon: '$' }, GM, 'cities_without_number')).status).toBe(404);
    expect(await stored()).toEqual({ draft: DRAFT, published: PUBLISHED, version: 3 });
    expect(emitted).toEqual([]);
  });

  it('is the main admin\'s alone', async () => {
    expect((await set('gold', { icon: '$' }, EDITOR)).status).toBe(403);
    expect((await set('gold', { icon: '$' }, PLAYER)).status).toBe(403);
    expect((await request(app).put(`/api/systems/${HEARTH}/currencies/gold/icon`).send({ icon: '$' })).status).toBe(401);
    expect(await stored()).toEqual({ draft: DRAFT, published: PUBLISHED, version: 3 });
  });

  it('leaves a deleted system alone', async () => {
    await run(db, 'UPDATE custom_systems SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?', [HEARTH]);
    expect((await set('gold', { icon: '$' })).status).toBe(404);
  });
});
