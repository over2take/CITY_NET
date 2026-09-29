import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import { makeTestDb, get, run } from './helpers/testDb.js';
import { drain } from './helpers/until.js';

/**
 * Who may use the GM's doors.
 *
 * Every token the server issues is signed with one secret: the GM's login (role 'admin'), a
 * player's login (role 'player'), and a granted editor's (isTemporary). A valid signature only
 * says the server issued it. The checks used to stop there, so a player's own login token got
 * past `authenticate` and every "not temporary" test: it deleted buildings, read GM notes,
 * approved accounts, and at socket sign-in it made the player a full socket admin (grant editor
 * rights, set anyone's bank balance, speak as anyone in chat).
 *
 * What must keep working, and is held here too: the GM's login, granted editors (grant, use,
 * revoke, surrender), players' own sheet and portrait, and chat.
 */

process.env.JWT_SECRET = 'test-secret';
process.env.DICE_ANIM_MS = '0';
const SECRET = 'test-secret';

const require_ = createRequire(import.meta.url);
// The same module instances the routes and sockets hold, so a grant made here is seen there.
const auth = require_('../middleware/auth');
const { authenticate, authenticatePlayer, optionalAuthenticate, elevatedUsers } = auth;
const socketsFactory = require_('../sockets/index.js');

/** Exactly what each login signs. */
const GM = jwt.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, SECRET); // routes/admin.js
const PLAYER = jwt.sign({ username: 'vex', role: 'player', tempPassword: false }, SECRET, { expiresIn: '7d' }); // routes/player.js
const RESET = jwt.sign({ username: 'vex', role: 'player_reset' }, SECRET, { expiresIn: '15m' }); // routes/player.js
const EDITOR = jwt.sign({ username: 'ghost', isTemporary: true }, SECRET, { expiresIn: '12h' }); // sockets grantElevatedAccess
const FORGED = jwt.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, 'not-the-secret');
const bearer = (t) => ({ Authorization: `Bearer ${t}` });

afterEach(() => { elevatedUsers.clear(); vi.restoreAllMocks(); });

describe('the checks themselves', () => {
  const app = express();
  app.get('/gm', authenticate, (req, res) => res.json({ user: req.user.username }));
  app.get('/player', authenticatePlayer, (req, res) => res.json({ user: req.user.username }));
  app.get('/public', optionalAuthenticate, (req, res) => res.json({ user: req.user ? req.user.username : null }));
  const hit = (url, token) => (token ? request(app).get(url).set(bearer(token)) : request(app).get(url));

  it('GM routes let in the GM', async () => {
    const res = await hit('/gm', GM);
    expect(res.status).toBe(200);
    expect(res.body.user).toBe('gm');
  });

  it('GM routes let in a granted editor while the grant stands, and not after', async () => {
    elevatedUsers.add('ghost');
    expect((await hit('/gm', EDITOR)).status).toBe(200);
    elevatedUsers.delete('ghost');
    expect((await hit('/gm', EDITOR)).status).toBe(401);
  });

  it('GM routes refuse a player, a reset token, a forged token and no token', async () => {
    expect((await hit('/gm', PLAYER)).status).toBe(403);
    expect((await hit('/gm', RESET)).status).toBe(403);
    expect((await hit('/gm', FORGED)).status).toBe(400);
    expect((await hit('/gm')).status).toBe(401);
  });

  it("a player's own routes let in the player, the GM and an editor, but not a reset token", async () => {
    elevatedUsers.add('ghost');
    expect((await hit('/player', PLAYER)).body.user).toBe('vex');
    expect((await hit('/player', GM)).status).toBe(200);
    expect((await hit('/player', EDITOR)).status).toBe(200);
    expect((await hit('/player', RESET)).status).toBe(403);
    expect((await hit('/player')).status).toBe(401);
  });

  it('public routes treat a player as anyone else, and only know the GM or an editor', async () => {
    elevatedUsers.add('ghost');
    expect((await hit('/public', PLAYER)).body.user).toBeNull();
    expect((await hit('/public', FORGED)).body.user).toBeNull();
    expect((await hit('/public')).body.user).toBeNull();
    expect((await hit('/public', GM)).body.user).toBe('gm');
    expect((await hit('/public', EDITOR)).body.user).toBe('ghost');
  });

  it('names what each token is', () => {
    const d = (t) => jwt.verify(t, SECRET);
    expect(auth.isMainAdmin(d(GM))).toBe(true);
    for (const t of [PLAYER, RESET, EDITOR]) expect(auth.isMainAdmin(d(t))).toBe(false);
    expect(auth.isPlayer(d(PLAYER))).toBe(true);
    expect(auth.isPlayer(d(RESET))).toBe(false);
    expect(auth.isMainAdmin(null)).toBe(false);
  });
});

/** Every router, mounted where server.js mounts it. */
const MOUNTS = [
  ['/api/locations', '../routes/locations.js', 'full'],
  ['/api/locations/:id/battle_maps', '../routes/battle_maps.js', 'full'],
  ['/api/locations/:id', '../routes/buildingDetails.js', 'full'],
  ['/api/battle_maps', '../routes/battle_maps.js', 'full'],
  ['/api/maps', '../routes/maps.js', 'full'],
  ['/api/roads', '../routes/roads.js', 'full'],
  ['/api/overpasses', '../routes/overpasses.js', 'full'],
  ['/api/signs', '../routes/signs.js', 'full'],
  ['/api/custom_dice', '../routes/custom_dice.js', 'full'],
  ['/api/fonts', '../routes/fonts.js', 'io'],
  ['/api/player', '../routes/player.js', 'io'],
  ['/api', '../routes/admin.js', 'full'],
  ['/api/music', '../routes/music.js', 'io'],
  ['/api/sheets', '../routes/sheets.js', 'io'],
];

const helpers = { emitUpdate: () => {}, recordAction: () => {} };
const io = { emit: () => {}, to: () => ({ emit: () => {} }) };

const mountAll = (db) => {
  const app = express();
  app.use(express.json());
  const routes = [];
  for (const [prefix, file, kind] of MOUNTS) {
    const factory = require_(file);
    const router = kind === 'full' ? factory(db, io, helpers) : factory(db, io);
    app.use(prefix, router);
    for (const layer of router.stack) {
      if (!layer.route) continue;
      const handles = layer.route.stack.map((s) => s.handle);
      if (!handles.includes(authenticate)) continue;
      for (const method of Object.keys(layer.route.methods)) {
        routes.push({ method, url: `${prefix}${layer.route.path}`.replace(/:\w+/g, '1') });
      }
    }
  }
  return { app, routes };
};

describe('every GM route, walked with a player token', () => {
  it('refuses a player everywhere the GM check stands', async () => {
    const db = await makeTestDb();
    await run(db, `INSERT INTO locations (name, x, y, z) VALUES ('CITY HALL', 0, 0, 0)`);
    const { app, routes } = mountAll(db);
    // The walk proves nothing if it found nothing to walk.
    expect(routes.length).toBeGreaterThan(60);

    const let_in = [];
    for (const { method, url } of routes) {
      const res = await request(app)[method](url).set(bearer(PLAYER)).send({});
      if (res.status !== 403) let_in.push(`${method.toUpperCase()} ${url} -> ${res.status}`);
    }
    expect(let_in).toEqual([]);
    // And nothing was changed on the way.
    expect((await get(db, 'SELECT COUNT(*) AS n FROM locations')).n).toBe(1);
  });

  it('still lets the GM through the same routes', async () => {
    const db = await makeTestDb();
    const { app } = mountAll(db);
    const res = await request(app).get('/api/player/admin/players').set(bearer(GM));
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});

describe("a player's own routes", () => {
  const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000' +
    '1f15c4890000000d4944415478da6364f8ffbf1e000501020149a2b8f90000000049454e44ae426082', 'hex');
  let db;
  let app;
  const written = [];

  beforeEach(async () => {
    db = await makeTestDb();
    await run(db, `INSERT INTO global_settings (key, value) VALUES ('game_system', 'generic')`);
    await run(db, `INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('vex', 'generic', '{"name":"VEX"}', 0)`);
    await run(db, `INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('rook', 'generic', '{"name":"ROOK"}', 0)`);
    app = express();
    app.use(express.json());
    app.use('/api/sheets', require_('../routes/sheets.js')(db, io));
  });

  afterEach(() => {
    for (const f of written.splice(0)) { try { fs.unlinkSync(f); } catch { /* already gone */ } }
  });

  it('loads their own sheet', async () => {
    const res = await request(app).get('/api/sheets/own').set(bearer(PLAYER));
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('VEX');
  });

  it("uploads their portrait to their own sheet, and cannot aim it at someone else's", async () => {
    const res = await request(app).post('/api/sheets/portrait?username=rook').set(bearer(PLAYER))
      .attach('portrait', PNG, 'me.png');
    expect(res.status).toBe(200);
    written.push(path.join(path.dirname(require_.resolve('../routes/sheets.js')), '..', res.body.portrait_url));
    expect((await get(db, `SELECT portrait_url FROM character_sheets WHERE username = 'vex'`)).portrait_url).toBe(res.body.portrait_url);
    expect((await get(db, `SELECT portrait_url FROM character_sheets WHERE username = 'rook'`)).portrait_url).toBeNull();
  });

  it('are not a way into the GM sheet routes', async () => {
    expect((await request(app).get('/api/sheets/user/rook').set(bearer(PLAYER))).status).toBe(403);
  });
});

describe('sockets: sign-in, chat and granting editor rights', () => {
  let db;

  /** One socket on the real handlers, sharing the auth module's grant list as server.js does. */
  const boot = () => {
    const emitted = [];
    let connectionCb;
    const ioFake = {
      on: (event, cb) => { if (event === 'connection') connectionCb = cb; },
      emit: (event, data) => emitted.push({ event, data }),
      to: () => ({ emit: (event, data) => emitted.push({ event, data }) }),
    };
    socketsFactory(ioFake, db, { elevatedUsers, emitUpdate: vi.fn(), recordAction: vi.fn() });
    const handlers = {};
    const socket = {
      id: `auth-${Math.random().toString(36).slice(2)}`,
      on: (event, fn) => { handlers[event] = fn; },
      emit: (event, data) => emitted.push({ event, data, direct: true }),
      broadcast: { emit: () => {} },
      use: () => {}, join: () => {}, disconnect: vi.fn(),
    };
    connectionCb(socket);
    return { handlers, emitted };
  };
  const signIn = async (payload) => {
    const s = boot();
    s.handlers.identify(payload);
    await drain(db);
    return s;
  };
  const events = (emitted, name) => emitted.filter((e) => e.event === name);

  beforeEach(async () => {
    db = await makeTestDb();
    await run(db, `CREATE TABLE IF NOT EXISTS player_banks (
      username TEXT PRIMARY KEY, balance REAL, debt REAL,
      first_pay_done INTEGER DEFAULT 0, high_roller_done INTEGER DEFAULT 0)`);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  it('a player chats as themselves', async () => {
    const { handlers, emitted } = await signIn('vex');
    handlers.sendMessage({ sender: 'vex', text: 'on my way' });
    await drain(db);
    expect(events(emitted, 'receiveMessage').at(-1).data).toMatchObject({ sender: 'vex', text: 'on my way' });
  });

  it('the GM can speak as someone else in chat', async () => {
    const { handlers, emitted } = await signIn({ userName: 'gm', isAdmin: true, token: GM });
    handlers.sendMessage({ sender: 'FIXER', text: 'job is on' });
    await drain(db);
    expect(events(emitted, 'receiveMessage').at(-1).data.sender).toBe('FIXER');
  });

  it("a player who claims to be the GM with their own login is not the GM: chat keeps their name", async () => {
    const { handlers, emitted } = await signIn({ userName: 'vex', isAdmin: true, token: PLAYER });
    handlers.sendMessage({ sender: 'FIXER', text: 'free money' });
    await drain(db);
    expect(events(emitted, 'receiveMessage').at(-1).data.sender).toBe('vex');
  });

  it('the GM grants editor rights; the editor then passes the GM check; revoking ends it', async () => {
    const { handlers, emitted } = await signIn({ userName: 'gm', isAdmin: true, token: GM });
    handlers.grantElevatedAccess({ adminToken: GM, targetUser: 'ghost' });
    const granted = events(emitted, 'accessGranted').at(-1);
    expect(granted.data.targetUser).toBe('ghost');
    expect(elevatedUsers.has('ghost')).toBe(true);

    const app = express();
    app.get('/gm', authenticate, (req, res) => res.json({ ok: true }));
    expect((await request(app).get('/gm').set(bearer(granted.data.token))).status).toBe(200);

    handlers.revokeElevatedAccess({ adminToken: GM, targetUser: 'ghost' });
    expect(elevatedUsers.has('ghost')).toBe(false);
    expect((await request(app).get('/gm').set(bearer(granted.data.token))).status).toBe(401);
  });

  it('an editor can give their rights back', async () => {
    elevatedUsers.add('ghost');
    const { handlers } = await signIn('ghost');
    handlers.surrenderAccess({ token: EDITOR });
    expect(elevatedUsers.has('ghost')).toBe(false);
  });

  it('a player cannot grant editor rights with their own login, to themselves or anyone', async () => {
    const { handlers, emitted } = await signIn({ userName: 'vex', isAdmin: true, token: PLAYER });
    handlers.grantElevatedAccess({ adminToken: PLAYER, targetUser: 'vex' });
    expect(elevatedUsers.has('vex')).toBe(false);
    expect(events(emitted, 'accessGranted')).toEqual([]);
  });

  it("a player cannot set anyone's bank balance with their own login; the GM still can", async () => {
    await run(db, `INSERT INTO player_banks (username, balance, debt) VALUES ('rook', 100, 0)`);
    const player = await signIn('vex');
    player.handlers.adminUpdateBank({ token: PLAYER, username: 'rook', balance: 999999, debt: 0 });
    await drain(db);
    expect((await get(db, `SELECT balance FROM player_banks WHERE username = 'rook'`)).balance).toBe(100);

    const gm = await signIn({ userName: 'gm', isAdmin: true, token: GM });
    gm.handlers.adminUpdateBank({ token: GM, username: 'rook', balance: 250, debt: 0 });
    await drain(db);
    expect((await get(db, `SELECT balance FROM player_banks WHERE username = 'rook'`)).balance).toBe(250);
  });
});
