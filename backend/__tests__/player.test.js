import { describe, it, expect, beforeEach, beforeAll, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcrypt';
import { makeTestDb, get, all, run } from './helpers/testDb.js';

// Must be set before the route module is loaded — it captures SECURE_MODE at import time
process.env.JWT_SECRET = 'test-secret';
process.env.SECURE_MODE = 'true';

let playerRouteFactory;
beforeAll(async () => {
  vi.resetModules();
  playerRouteFactory = (await import('../routes/player.js')).default;
});

const ADMIN_TOKEN = jwt.sign(
  { id: 1, username: 'testadmin', role: 'admin', isTemporary: false },
  'test-secret'
);

const makeApp = (db) => {
  const app = express();
  app.use(express.json());
  const io = { emit: () => {} };
  app.use('/api/player', playerRouteFactory(db, io));
  return app;
};

const seedPlayer = async (db, username = 'netrunner', password = 'pass123', status = 'approved') => {
  const password_hash = await bcrypt.hash(password, 1);
  const security_answer_hash = await bcrypt.hash('my answer', 1);
  await run(db,
    `INSERT INTO player_accounts (username, password_hash, security_question, security_answer_hash, status) VALUES (?, ?, ?, ?, ?)`,
    [username, password_hash, 'What is your handle?', security_answer_hash, status]
  );
};

let db;
let app;

beforeEach(async () => {
  db = await makeTestDb();
  app = makeApp(db);
});

// ─── GET /api/player/secure-mode ─────────────────────────────────────────────

describe('GET /api/player/secure-mode', () => {
  it('returns enabled: true when SECURE_MODE=true', async () => {
    const res = await request(app).get('/api/player/secure-mode');
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
  });
});

// ─── POST /api/player/register ───────────────────────────────────────────────

describe('POST /api/player/register', () => {
  it('returns 400 when required fields are missing', async () => {
    const res = await request(app)
      .post('/api/player/register')
      .send({ username: 'ghost' });
    expect(res.status).toBe(400);
  });

  it('registers a new account with pending status', async () => {
    const res = await request(app)
      .post('/api/player/register')
      .send({ username: 'ghost', password: 'pw', security_question: 'Q?', security_answer: 'A' });
    expect(res.status).toBe(200);
    const row = await get(db, `SELECT status FROM player_accounts WHERE username = 'ghost'`);
    expect(row.status).toBe('pending');
  });

  it('returns 409 when username is already taken', async () => {
    await seedPlayer(db, 'ghost');
    const res = await request(app)
      .post('/api/player/register')
      .send({ username: 'ghost', password: 'pw', security_question: 'Q?', security_answer: 'A' });
    expect(res.status).toBe(409);
  });

  it('hashes the password before storing', async () => {
    await request(app)
      .post('/api/player/register')
      .send({ username: 'ghost', password: 'plaintext', security_question: 'Q?', security_answer: 'A' });
    const row = await get(db, `SELECT password_hash FROM player_accounts WHERE username = 'ghost'`);
    expect(row.password_hash).not.toBe('plaintext');
    expect(await bcrypt.compare('plaintext', row.password_hash)).toBe(true);
  });
});

// ─── POST /api/player/login ───────────────────────────────────────────────────

describe('POST /api/player/login', () => {
  it('returns 400 when credentials are missing', async () => {
    const res = await request(app).post('/api/player/login').send({});
    expect(res.status).toBe(400);
  });

  it('returns 401 for unknown username', async () => {
    const res = await request(app)
      .post('/api/player/login')
      .send({ username: 'nobody', password: 'pw' });
    expect(res.status).toBe(401);
  });

  it('returns 401 for wrong password', async () => {
    await seedPlayer(db);
    const res = await request(app)
      .post('/api/player/login')
      .send({ username: 'netrunner', password: 'wrong' });
    expect(res.status).toBe(401);
  });

  it('returns 403 when account is pending approval', async () => {
    await seedPlayer(db, 'netrunner', 'pass123', 'pending');
    const res = await request(app)
      .post('/api/player/login')
      .send({ username: 'netrunner', password: 'pass123' });
    expect(res.status).toBe(403);
  });

  it('returns a player JWT on valid credentials', async () => {
    await seedPlayer(db);
    const res = await request(app)
      .post('/api/player/login')
      .send({ username: 'netrunner', password: 'pass123' });
    expect(res.status).toBe(200);
    expect(res.body.playerToken).toBeTruthy();
    const decoded = jwt.verify(res.body.playerToken, 'test-secret');
    expect(decoded.username).toBe('netrunner');
    expect(decoded.role).toBe('player');
  });
});

// ─── GET /api/player/question ─────────────────────────────────────────────────

describe('GET /api/player/question', () => {
  it('returns 400 when username is missing', async () => {
    const res = await request(app).get('/api/player/question');
    expect(res.status).toBe(400);
  });

  it('returns 404 for unknown username', async () => {
    const res = await request(app).get('/api/player/question?username=ghost');
    expect(res.status).toBe(404);
  });

  it('returns the security question', async () => {
    await seedPlayer(db);
    const res = await request(app).get('/api/player/question?username=netrunner');
    expect(res.status).toBe(200);
    expect(res.body.question).toBe('What is your handle?');
  });
});

// ─── POST /api/player/forgot ──────────────────────────────────────────────────

describe('POST /api/player/forgot', () => {
  it('returns 400 when fields are missing', async () => {
    const res = await request(app).post('/api/player/forgot').send({ username: 'netrunner' });
    expect(res.status).toBe(400);
  });

  it('returns 401 for wrong security answer', async () => {
    await seedPlayer(db);
    const res = await request(app)
      .post('/api/player/forgot')
      .send({ username: 'netrunner', security_answer: 'wrong answer' });
    expect(res.status).toBe(401);
  });

  it('returns a requestId on correct security answer', async () => {
    await seedPlayer(db);
    const res = await request(app)
      .post('/api/player/forgot')
      .send({ username: 'netrunner', security_answer: 'my answer' });
    expect(res.status).toBe(200);
    expect(res.body.requestId).toBeTruthy();
  });
});

// ─── GET /api/player/reset-status/:requestId ─────────────────────────────────

describe('GET /api/player/reset-status/:requestId', () => {
  it('returns 404 for unknown requestId', async () => {
    const res = await request(app).get('/api/player/reset-status/doesnotexist');
    expect(res.status).toBe(404);
  });

  it('returns pending status after a forgot request', async () => {
    await seedPlayer(db);
    const forgot = await request(app)
      .post('/api/player/forgot')
      .send({ username: 'netrunner', security_answer: 'my answer' });
    const { requestId } = forgot.body;
    const res = await request(app).get(`/api/player/reset-status/${requestId}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('pending');
  });
});

// ─── Admin: approve / deny reset request ─────────────────────────────────────

describe('Admin reset-request approve/deny', () => {
  const getForgotId = async (app, db) => {
    await seedPlayer(db);
    const res = await request(app)
      .post('/api/player/forgot')
      .send({ username: 'netrunner', security_answer: 'my answer' });
    return res.body.requestId;
  };

  it('approve sets status to approved and provides a resetToken', async () => {
    const requestId = await getForgotId(app, db);
    await request(app)
      .post(`/api/player/admin/reset-request/${requestId}/approve`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    const status = await request(app).get(`/api/player/reset-status/${requestId}`);
    expect(status.body.status).toBe('approved');
    expect(status.body.resetToken).toBeTruthy();
  });

  it('deny removes the request so polling returns 404', async () => {
    const requestId = await getForgotId(app, db);
    await request(app)
      .post(`/api/player/admin/reset-request/${requestId}/deny`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    const status = await request(app).get(`/api/player/reset-status/${requestId}`);
    expect(status.status).toBe(404);
  });

  it('returns 409 if already resolved', async () => {
    const requestId = await getForgotId(app, db);
    await request(app)
      .post(`/api/player/admin/reset-request/${requestId}/approve`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    const res = await request(app)
      .post(`/api/player/admin/reset-request/${requestId}/approve`)
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(409);
  });
});

// ─── POST /api/player/reset-password ─────────────────────────────────────────

describe('POST /api/player/reset-password', () => {
  it('returns 400 when fields are missing', async () => {
    const res = await request(app).post('/api/player/reset-password').send({});
    expect(res.status).toBe(400);
  });

  it('returns 401 for an invalid token', async () => {
    const res = await request(app)
      .post('/api/player/reset-password')
      .send({ token: 'bad-token', newPassword: 'newpass' });
    expect(res.status).toBe(401);
  });

  it('updates the password using a player_reset token', async () => {
    await seedPlayer(db);
    const resetToken = jwt.sign({ username: 'netrunner', role: 'player_reset' }, 'test-secret', { expiresIn: '15m' });
    const res = await request(app)
      .post('/api/player/reset-password')
      .send({ token: resetToken, newPassword: 'newpass999' });
    expect(res.status).toBe(200);
    const row = await get(db, `SELECT password_hash FROM player_accounts WHERE username = 'netrunner'`);
    expect(await bcrypt.compare('newpass999', row.password_hash)).toBe(true);
  });
});

// ─── GET /api/player/players/status/:username ────────────────────────────────

describe('GET /api/player/players/status/:username', () => {
  it('returns 404 for unknown username', async () => {
    const res = await request(app).get('/api/player/players/status/ghost');
    expect(res.status).toBe(404);
  });

  it('returns the registration status', async () => {
    await seedPlayer(db, 'netrunner', 'pw', 'pending');
    const res = await request(app).get('/api/player/players/status/netrunner');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('pending');
  });
});

// ─── Admin: approve / deny registration ──────────────────────────────────────

describe('Admin registration approve/deny', () => {
  it('approve sets status to approved', async () => {
    await seedPlayer(db, 'ghost', 'pw', 'pending');
    const res = await request(app)
      .post('/api/player/admin/players/ghost/approve')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
    const row = await get(db, `SELECT status FROM player_accounts WHERE username = 'ghost'`);
    expect(row.status).toBe('approved');
  });

  it('approve returns 404 if account is not pending', async () => {
    await seedPlayer(db, 'ghost', 'pw', 'approved');
    const res = await request(app)
      .post('/api/player/admin/players/ghost/approve')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(404);
  });

  it('deny removes the account row', async () => {
    await seedPlayer(db, 'ghost', 'pw', 'pending');
    const res = await request(app)
      .delete('/api/player/admin/players/ghost/deny')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
    const row = await get(db, `SELECT * FROM player_accounts WHERE username = 'ghost'`);
    expect(row).toBeUndefined();
  });
});

// ─── Admin: reset player password ────────────────────────────────────────────

describe('Admin reset player password', () => {
  it('returns a temp password and marks temp_password=1', async () => {
    await seedPlayer(db);
    const res = await request(app)
      .post('/api/player/admin/players/netrunner/reset')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(200);
    expect(res.body.tempPassword).toBeTruthy();
    const row = await get(db, `SELECT temp_password FROM player_accounts WHERE username = 'netrunner'`);
    expect(row.temp_password).toBe(1);
  });

  it('returns 404 for unknown player', async () => {
    const res = await request(app)
      .post('/api/player/admin/players/nobody/reset')
      .set('Authorization', `Bearer ${ADMIN_TOKEN}`);
    expect(res.status).toBe(404);
  });
});
