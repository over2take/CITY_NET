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

describe('sockets: sign-in, chat and editor rights', () => {
  let db;

  /**
   * One server on the real handlers, several connections to it, sharing the auth module's
   * grant list as server.js does. `sent` records every emit with where it went: 'all' for a
   * broadcast, the socket id for io.to(id), 'self' for a reply down one socket.
   */
  const server = () => {
    const sent = [];
    let connectionCb;
    const ioFake = {
      on: (event, cb) => { if (event === 'connection') connectionCb = cb; },
      emit: (event, data) => sent.push({ event, data, to: 'all' }),
      to: (id) => ({ emit: (event, data) => sent.push({ event, data, to: id }) }),
    };
    socketsFactory(ioFake, db, { elevatedUsers, emitUpdate: vi.fn(), recordAction: vi.fn() });
    const connect = async (identify) => {
      const handlers = {};
      const socket = {
        id: `auth-${Math.random().toString(36).slice(2)}`,
        on: (event, fn) => { handlers[event] = fn; },
        emit: (event, data) => sent.push({ event, data, to: 'self' }),
        broadcast: { emit: () => {} },
        use: () => {}, join: () => {}, disconnect: vi.fn(),
      };
      connectionCb(socket);
      handlers.identify(identify);
      await drain(db);
      return { id: socket.id, handlers };
    };
    return { sent, connect };
  };
  const events = (sent, name) => sent.filter((e) => e.event === name);

  beforeEach(async () => {
    db = await makeTestDb();
    await run(db, `CREATE TABLE IF NOT EXISTS player_banks (
      username TEXT PRIMARY KEY, balance REAL, debt REAL,
      first_pay_done INTEGER DEFAULT 0, high_roller_done INTEGER DEFAULT 0)`);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  describe('chat', () => {
    it('a player chats as themselves', async () => {
      const s = server();
      const vex = await s.connect('vex');
      vex.handlers.sendMessage({ sender: 'vex', text: 'on my way' });
      await drain(db);
      expect(events(s.sent, 'receiveMessage').at(-1).data).toMatchObject({ sender: 'vex', text: 'on my way' });
    });

    it('the GM can speak as someone else', async () => {
      const s = server();
      const gm = await s.connect({ userName: 'gm', isAdmin: true, token: GM });
      gm.handlers.sendMessage({ sender: 'FIXER', text: 'job is on' });
      await drain(db);
      expect(events(s.sent, 'receiveMessage').at(-1).data.sender).toBe('FIXER');
    });

    it('a player claiming to be the GM with their own login still chats as themselves', async () => {
      const s = server();
      const vex = await s.connect({ userName: 'vex', isAdmin: true, token: PLAYER });
      vex.handlers.sendMessage({ sender: 'FIXER', text: 'free money' });
      await drain(db);
      expect(events(s.sent, 'receiveMessage').at(-1).data.sender).toBe('vex');
    });
  });

  describe('temporary admin, granted by the GM', () => {
    it('reaches the player it is for, on every connection they have, and nobody else', async () => {
      const s = server();
      const gm = await s.connect({ userName: 'gm', isAdmin: true, token: GM });
      const ghostGame = await s.connect('ghost');
      const ghostSheetTab = await s.connect('ghost');
      const bystander = await s.connect('rook');

      gm.handlers.grantElevatedAccess({ adminToken: GM, targetUser: 'ghost' });
      // The socket module keeps its list of connections for the life of the process, so
      // earlier tests' connections are still in it: assert on this test's own.
      const grants = events(s.sent, 'accessGranted');
      const to = grants.map((g) => g.to);
      expect(to).toContain(ghostGame.id);
      expect(to).toContain(ghostSheetTab.id);
      expect(to).not.toContain(bystander.id);
      expect(to).not.toContain(gm.id);
      expect(to).not.toContain('all');
      expect(grants.every((g) => g.data.targetUser === 'ghost' && g.data.token)).toBe(true);
      expect(elevatedUsers.has('ghost')).toBe(true);
    });

    it('works as a key to the GM routes until it is revoked', async () => {
      const s = server();
      const gm = await s.connect({ userName: 'gm', isAdmin: true, token: GM });
      await s.connect('ghost');
      gm.handlers.grantElevatedAccess({ adminToken: GM, targetUser: 'ghost' });
      const token = events(s.sent, 'accessGranted').at(-1).data.token;

      const app = express();
      app.get('/gm', authenticate, (req, res) => res.json({ ok: true }));
      expect((await request(app).get('/gm').set(bearer(token))).status).toBe(200);

      gm.handlers.revokeElevatedAccess({ adminToken: GM, targetUser: 'ghost' });
      expect(elevatedUsers.has('ghost')).toBe(false);
      // Revoking still tells everyone: it carries no token, and the client only acts on its own.
      expect(events(s.sent, 'accessRevoked').at(-1)).toMatchObject({ to: 'all', data: { targetUser: 'ghost' } });
      expect((await request(app).get('/gm').set(bearer(token))).status).toBe(401);
    });

    it('can be given back by the editor', async () => {
      elevatedUsers.add('ghost');
      const s = server();
      const ghost = await s.connect('ghost');
      ghost.handlers.surrenderAccess({ token: EDITOR });
      expect(elevatedUsers.has('ghost')).toBe(false);
    });

    it('cannot be granted by a player with their own login, to themselves or anyone', async () => {
      const s = server();
      const vex = await s.connect({ userName: 'vex', isAdmin: true, token: PLAYER });
      vex.handlers.grantElevatedAccess({ adminToken: PLAYER, targetUser: 'vex' });
      expect(elevatedUsers.has('vex')).toBe(false);
      expect(events(s.sent, 'accessGranted')).toEqual([]);
    });
  });

  describe('editing requests (REQUEST EDIT on a building)', () => {
    it('the GM approves: the player becomes an editor, and only they get the token', async () => {
      const s = server();
      const gm = await s.connect({ userName: 'gm', isAdmin: true, token: GM });
      const vex = await s.connect('vex');
      const rook = await s.connect('rook');
      vex.handlers.requestEditing({ userId: 'vex', userName: 'vex', locationId: 1, locationName: 'BAR' });
      expect(events(s.sent, 'editingRequested')).toHaveLength(1);

      gm.handlers.approveEditing({ userId: 'vex', location: { id: 1 } });
      expect(elevatedUsers.has('vex')).toBe(true);
      const grants = events(s.sent, 'accessGranted');
      const to = grants.map((g) => g.to);
      expect(to).toContain(vex.id);
      expect(to).not.toContain(rook.id);
      expect(to).not.toContain(gm.id);
      expect(to).not.toContain('all');
      expect(grants.every((g) => g.data.targetUser === 'vex' && g.data.forEditing === true)).toBe(true);
      expect(events(s.sent, 'editingApproved')).toHaveLength(1);
    });

    it('a granted editor can still approve, as before', async () => {
      elevatedUsers.add('ghost');
      const s = server();
      const ghost = await s.connect('ghost');
      await s.connect('vex');
      ghost.handlers.approveEditing({ userId: 'vex' });
      expect(elevatedUsers.has('vex')).toBe(true);
    });

    it('a player cannot approve their own request', async () => {
      const s = server();
      const vex = await s.connect('vex');
      vex.handlers.approveEditing({ userId: 'vex' });
      expect(elevatedUsers.has('vex')).toBe(false);
      expect(events(s.sent, 'accessGranted')).toEqual([]);
    });

    it('the GM can deny a request and kick an editor; a player can do neither', async () => {
      elevatedUsers.add('ghost');
      const s = server();
      const gm = await s.connect({ userName: 'gm', isAdmin: true, token: GM });
      const vex = await s.connect('vex');

      vex.handlers.revokeEditing({ userId: 'ghost' });
      vex.handlers.denyEditing({ userId: 'ghost' });
      expect(elevatedUsers.has('ghost')).toBe(true);
      expect(events(s.sent, 'editingRevoked')).toEqual([]);
      expect(events(s.sent, 'editingDenied')).toEqual([]);

      gm.handlers.denyEditing({ userId: 'vex' });
      gm.handlers.revokeEditing({ userId: 'ghost' });
      expect(events(s.sent, 'editingDenied')).toHaveLength(1);
      expect(elevatedUsers.has('ghost')).toBe(false);
    });
  });

  it("a player cannot set anyone's bank balance with their own login; the GM still can", async () => {
    await run(db, `INSERT INTO player_banks (username, balance, debt) VALUES ('rook', 100, 0)`);
    const s = server();
    const vex = await s.connect('vex');
    vex.handlers.adminUpdateBank({ token: PLAYER, username: 'rook', balance: 999999, debt: 0 });
    await drain(db);
    expect((await get(db, `SELECT balance FROM player_banks WHERE username = 'rook'`)).balance).toBe(100);

    const gm = await s.connect({ userName: 'gm', isAdmin: true, token: GM });
    gm.handlers.adminUpdateBank({ token: GM, username: 'rook', balance: 250, debt: 0 });
    await drain(db);
    expect((await get(db, `SELECT balance FROM player_banks WHERE username = 'rook'`)).balance).toBe(250);
  });
});
