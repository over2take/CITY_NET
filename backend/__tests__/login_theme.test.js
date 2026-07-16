/**
 * Login-screen theme persistence: an optional `theme` on player login is
 * validated, saved to the account, and returned inside the JWT so the app
 * applies it on login.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import bcrypt from 'bcrypt';
import jwt from 'jsonwebtoken';
import { makeTestDb, get, run } from './helpers/testDb.js';

process.env.JWT_SECRET = 'test-secret';
process.env.SECURE_MODE = 'true';

const playerFactory = (await import('../routes/player.js')).default;

let db, app;
beforeEach(async () => {
  db = await makeTestDb();
  const hash = await bcrypt.hash('hunter2', 4);
  await run(db,
    `INSERT INTO player_accounts (username, password_hash, status) VALUES ('GHOST', ?, 'approved')`,
    [hash]);
  app = express();
  app.use(express.json());
  app.use('/api/player', playerFactory(db, { emit: vi.fn() }));
});

describe('player login theme', () => {
  it('saves a valid theme to the account and returns it in the JWT', async () => {
    const res = await request(app).post('/api/player/login')
      .send({ username: 'GHOST', password: 'hunter2', theme: 'ocean' });
    expect(res.status).toBe(200);
    const payload = jwt.verify(res.body.playerToken, 'test-secret');
    expect(payload.theme).toBe('ocean');
    const row = await get(db, `SELECT theme FROM player_accounts WHERE username = 'GHOST'`);
    expect(row.theme).toBe('ocean');
  });

  it('uses the stored theme when none is sent', async () => {
    await run(db, `UPDATE player_accounts SET theme = 'crimson' WHERE username = 'GHOST'`);
    const res = await request(app).post('/api/player/login')
      .send({ username: 'GHOST', password: 'hunter2' });
    expect(res.status).toBe(200);
    const payload = jwt.verify(res.body.playerToken, 'test-secret');
    expect(payload.theme).toBe('crimson');
  });

  it('ignores an unknown theme (no save, no JWT claim)', async () => {
    const res = await request(app).post('/api/player/login')
      .send({ username: 'GHOST', password: 'hunter2', theme: 'hotdog-stand' });
    expect(res.status).toBe(200);
    const payload = jwt.verify(res.body.playerToken, 'test-secret');
    expect(payload.theme).toBeUndefined();
    const row = await get(db, `SELECT theme FROM player_accounts WHERE username = 'GHOST'`);
    expect(row.theme).toBeNull();
  });
});
