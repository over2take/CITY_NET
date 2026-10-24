/**
 * A person's own settings, on their account (6c4b3a): the dice tray's ROLL or LANDED to begin
 * with, so it follows them to any computer. Players and the GM each have their own; anyone signed
 * in reads and changes only theirs; only known settings, each one of its choices, are kept.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import jwt from 'jsonwebtoken';
import { createRequire } from 'module';
import { fileURLToPath } from 'url';
import { makeTestDb, all } from './helpers/testDb.js';

process.env.JWT_SECRET = 'test-secret';
const require_ = createRequire(import.meta.url);
const express = require_('express');
const request = require_('supertest');
const meRoute = require_('../routes/me.js');
const { elevatedUsers } = require_('../middleware/auth');
const { SETTINGS, accountOf, problemWith } = require_('../accounts/settings');

const BACKEND = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const sign = (payload) => `Bearer ${jwt.sign(payload, 'test-secret')}`;
const GM = sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false });
const KES = sign({ username: 'kes', role: 'player' });
const ROOK = sign({ username: 'rook', role: 'player' });

let db;
let app;
beforeEach(async () => {
  db = await makeTestDb();
  app = express();
  app.use(express.json());
  app.use('/api/me', meRoute(db));
  elevatedUsers.clear();
});

describe('your settings', () => {
  it('start as each setting starts: the dice tray rolls, and its bell is on', async () => {
    const res = await request(app).get('/api/me/settings').set('Authorization', KES);
    expect([res.status, res.body]).toEqual([200, { trayMotion: 'roll', trayNotify: 'on' }]);
    expect(SETTINGS.trayMotion).toEqual({ choices: ['roll', 'landed'], start: 'roll' });
    expect(SETTINGS.trayNotify).toEqual({ choices: ['on', 'off'], start: 'on' });
  });

  it('keep the tray\'s bell apart from its motion (6c4g)', async () => {
    const put = await request(app).put('/api/me/settings').set('Authorization', KES).send({ trayNotify: 'off' });
    expect([put.status, put.body]).toEqual([200, { trayMotion: 'roll', trayNotify: 'off' }]);
    await request(app).put('/api/me/settings').set('Authorization', KES).send({ trayMotion: 'landed' });
    expect((await request(app).get('/api/me/settings').set('Authorization', KES)).body).toEqual({ trayMotion: 'landed', trayNotify: 'off' });
    const res = await request(app).put('/api/me/settings').set('Authorization', KES).send({ trayNotify: 'quiet' });
    expect([res.status, res.body.error]).toEqual([400, 'trayNotify is one of on, off']);
  });

  it('are kept on your account, and read back as you left them', async () => {
    const put = await request(app).put('/api/me/settings').set('Authorization', KES).send({ trayMotion: 'landed' });
    expect([put.status, put.body]).toEqual([200, { trayMotion: 'landed', trayNotify: 'on' }]);
    expect((await request(app).get('/api/me/settings').set('Authorization', KES)).body).toEqual({ trayMotion: 'landed', trayNotify: 'on' });
    await request(app).put('/api/me/settings').set('Authorization', KES).send({ trayMotion: 'roll' });
    expect((await request(app).get('/api/me/settings').set('Authorization', KES)).body).toEqual({ trayMotion: 'roll', trayNotify: 'on' });
    expect(await all(db, 'SELECT kind, username, key, value FROM account_settings')).toEqual([{ kind: 'player', username: 'kes', key: 'trayMotion', value: 'roll' }]);
  });

  it('are your own: another player and the GM each keep theirs', async () => {
    await request(app).put('/api/me/settings').set('Authorization', KES).send({ trayMotion: 'landed' });
    expect((await request(app).get('/api/me/settings').set('Authorization', ROOK)).body).toEqual({ trayMotion: 'roll', trayNotify: 'on' });
    expect((await request(app).get('/api/me/settings').set('Authorization', GM)).body).toEqual({ trayMotion: 'roll', trayNotify: 'on' });
    await request(app).put('/api/me/settings').set('Authorization', GM).send({ trayMotion: 'landed' });
    expect((await all(db, 'SELECT kind, username FROM account_settings ORDER BY kind')).map((r) => `${r.kind}:${r.username}`)).toEqual(['gm:gm', 'player:kes']);
  });

  it('keep a GM and a player of the same name apart', async () => {
    const playerGm = sign({ username: 'gm', role: 'player' });
    await request(app).put('/api/me/settings').set('Authorization', playerGm).send({ trayMotion: 'landed' });
    expect((await request(app).get('/api/me/settings').set('Authorization', GM)).body).toEqual({ trayMotion: 'roll', trayNotify: 'on' });
  });

  it('are a granted editor\'s own player settings', async () => {
    elevatedUsers.add('kes');
    const editor = sign({ username: 'kes', isTemporary: true });
    await request(app).put('/api/me/settings').set('Authorization', editor).send({ trayMotion: 'landed' });
    expect((await request(app).get('/api/me/settings').set('Authorization', KES)).body).toEqual({ trayMotion: 'landed', trayNotify: 'on' });
  });

  it('take only a setting there is, as one of its choices, saving nothing otherwise', async () => {
    for (const [body, said] of [
      [{ trayMotion: 'spin' }, 'trayMotion is one of roll, landed'],
      [{ theme: 'crimson' }, 'No setting called theme'],
      [{ trayMotion: 'landed', theme: 'crimson' }, 'No setting called theme'],
      [{}, 'Send the settings to change, as { name: choice }'],
      [['landed'], 'Send the settings to change, as { name: choice }'],
      [{ __proto__: null, constructor: 'x' }, 'No setting called constructor'],
    ]) {
      const res = await request(app).put('/api/me/settings').set('Authorization', KES).send(body);
      expect([res.status, res.body.error], JSON.stringify(body)).toEqual([400, said]);
    }
    expect(await all(db, 'SELECT * FROM account_settings')).toEqual([]);
  });

  it('need you signed in: no token, a bad one, a password reset or a revoked editor gets none', async () => {
    expect((await request(app).get('/api/me/settings')).status).toBe(401);
    expect((await request(app).get('/api/me/settings').set('Authorization', 'Bearer nonsense')).status).toBe(400);
    expect((await request(app).put('/api/me/settings').set('Authorization', sign({ username: 'kes', role: 'player_reset' })).send({ trayMotion: 'landed' })).status).toBe(403);
    expect((await request(app).get('/api/me/settings').set('Authorization', sign({ username: 'kes', isTemporary: true }))).status).toBe(401);
    expect(await all(db, 'SELECT * FROM account_settings')).toEqual([]);
  });

  it('ignore a saved choice the setting no longer has, starting it again', async () => {
    await new Promise((resolve) => db.run("INSERT INTO account_settings VALUES ('player', 'kes', 'trayMotion', 'wobble')", resolve));
    await new Promise((resolve) => db.run("INSERT INTO account_settings VALUES ('player', 'kes', 'oldThing', 'x')", resolve));
    expect((await request(app).get('/api/me/settings').set('Authorization', KES)).body).toEqual({ trayMotion: 'roll', trayNotify: 'on' });
  });
});

describe('whose settings a token is', () => {
  it('the GM\'s own login, a player, or a granted editor as the player; nothing else', () => {
    expect(accountOf({ id: 1, username: 'gm', role: 'admin', isTemporary: false })).toEqual({ kind: 'gm', username: 'gm' });
    expect(accountOf({ username: 'kes', role: 'player' })).toEqual({ kind: 'player', username: 'kes' });
    expect(accountOf({ username: 'kes', isTemporary: true })).toEqual({ kind: 'player', username: 'kes' });
    for (const u of [null, {}, { role: 'player' }, { username: '', role: 'player' }, { username: 'kes', role: 'player_reset' }]) expect(accountOf(u), JSON.stringify(u)).toBeNull();
    expect(problemWith({ trayMotion: 'landed' })).toBeNull();
  });

  it('is served at /api/me, behind sign-in', () => {
    expect(fs.readFileSync(path.join(BACKEND, 'server.js'), 'utf8')).toMatch(/app\.use\('\/api\/me', require\('\.\/routes\/me'\)\(db\)\);/);
  });
});
