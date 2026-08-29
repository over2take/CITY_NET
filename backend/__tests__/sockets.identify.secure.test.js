/**
 * Secure Mode's gate on the `identify` handler in sockets/index.js.
 *
 * `isAdmin` arrives as a plain field in the client's payload, so it is a claim until a
 * token backs it. The Secure Mode check used to run before the claim was resolved and
 * skipped itself whenever the claim was present, so `{ isAdmin: true }` with no token at
 * all walked past the player-token requirement and connected as an ordinary player. No
 * admin rights were granted, which was never the hole; the hole was getting onto a server
 * that is supposed to admit nobody without an approved account.
 *
 * These drive the real module rather than a copy of the handler, so a regression in
 * sockets/index.js actually fails them.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { makeTestDb, run } from './helpers/testDb.js';

process.env.JWT_SECRET = 'test-secret';
const SECRET = 'test-secret';

const socketsFactory = (await import('../sockets/index.js')).default;

const flush = (ms = 25) => new Promise((r) => setTimeout(r, ms));

const ADMIN_TOKEN = jwt.sign({ username: 'admin', isTemporary: false }, SECRET);
const TEMP_ADMIN_TOKEN = jwt.sign({ username: 'helper', isTemporary: true }, SECRET);
const PLAYER_TOKEN = jwt.sign({ username: 'realplayer', role: 'player' }, SECRET);
const HELPER_PLAYER_TOKEN = jwt.sign({ username: 'helper', role: 'player' }, SECRET);

function boot(db) {
  const emitted = [];
  let connectionCb;
  const io = {
    on: (event, cb) => { if (event === 'connection') connectionCb = cb; },
    emit: (event, data) => emitted.push({ event, data }),
    to: () => ({ emit: (event, data) => emitted.push({ event, data }) }),
  };
  socketsFactory(io, db, { elevatedUsers: new Set(), emitUpdate: vi.fn(), recordAction: vi.fn() });

  const handlers = {};
  const disconnect = vi.fn();
  const socket = {
    id: `sock-${Math.random().toString(36).slice(2)}`,
    on: (event, fn) => { handlers[event] = fn; },
    emit: (event, data) => emitted.push({ event, data, direct: true }),
    use: () => {},
    join: () => {},
    disconnect,
  };
  connectionCb(socket);
  return { handlers, emitted, disconnect };
}

/** Run one identify payload and report how the server treated it. */
async function identify(db, payload) {
  const { handlers, emitted, disconnect } = boot(db);
  handlers.identify(payload);
  await flush();
  const authError = emitted.find((e) => e.event === 'authError');
  const roster = emitted.filter((e) => e.event === 'activeUsersUpdated').pop();
  const me = roster && roster.data.find((u) => u.userName === payload.userName);
  return {
    rejected: Boolean(authError) && disconnect.mock.calls.length > 0,
    reason: authError && authError.data.message,
    admitted: Boolean(me),
    isAdmin: me ? me.isAdmin : null,
  };
}

let db;
beforeEach(async () => {
  db = await makeTestDb();
  await run(db, `INSERT INTO global_settings (key, value) VALUES ('game_system', 'cyberpunk_red')`);
});
afterEach(() => { delete process.env.SECURE_MODE; });

describe('Secure Mode gate on identify', () => {
  beforeEach(() => { process.env.SECURE_MODE = 'true'; });

  it('turns away a connection with no player token', async () => {
    const r = await identify(db, { userName: 'nobody', isAdmin: false });
    expect(r.rejected).toBe(true);
    expect(r.reason).toMatch(/player token required/i);
    expect(r.admitted).toBe(false);
  });

  it('turns away a bare isAdmin claim carrying no token', async () => {
    // The regression. Claiming admin used to skip the check above entirely, landing the
    // caller in the room as a plain player without an approved account.
    const r = await identify(db, { userName: 'intruder', isAdmin: true });
    expect(r.rejected).toBe(true);
    expect(r.reason).toMatch(/player token required/i);
    expect(r.admitted).toBe(false);
  });

  it('turns away an isAdmin claim carrying a junk token', async () => {
    const r = await identify(db, { userName: 'intruder', isAdmin: true, token: 'not-a-jwt' });
    expect(r.rejected).toBe(true);
    expect(r.admitted).toBe(false);
  });

  it('turns away a player token issued to someone else', async () => {
    const r = await identify(db, { userName: 'impostor', isAdmin: false, playerToken: PLAYER_TOKEN });
    expect(r.rejected).toBe(true);
    expect(r.reason).toMatch(/invalid or expired/i);
    expect(r.admitted).toBe(false);
  });

  it('lets a real admin in, and does not ask them for a player token', async () => {
    const r = await identify(db, { userName: 'admin', isAdmin: true, token: ADMIN_TOKEN });
    expect(r.rejected).toBe(false);
    expect(r.admitted).toBe(true);
    expect(r.isAdmin).toBe(true);
  });

  it('lets an approved player in on their own token', async () => {
    const r = await identify(db, { userName: 'realplayer', isAdmin: false, playerToken: PLAYER_TOKEN });
    expect(r.rejected).toBe(false);
    expect(r.admitted).toBe(true);
    expect(r.isAdmin).toBe(false);
  });

  it('holds a temporary admin to the player-token requirement', async () => {
    // A temporary token resolves isAdmin to false, so the gate must then apply to them
    // like any other player rather than waving them through on the original claim.
    const r = await identify(db, { userName: 'helper', isAdmin: true, token: TEMP_ADMIN_TOKEN });
    expect(r.rejected).toBe(true);
    expect(r.admitted).toBe(false);
  });

  it('lets a granted temporary admin back in on their own player token', async () => {
    // The real shape of the temporary-admin flow: an approved player is handed elevated
    // access, and on the next reconnect the client sends the temporary token in `token`
    // with their player token still alongside it. That has to keep working, or granting
    // someone edit rights would lock them out the moment their connection blinked.
    const r = await identify(db, {
      userName: 'helper', isAdmin: true, token: TEMP_ADMIN_TOKEN, playerToken: HELPER_PLAYER_TOKEN,
    });
    expect(r.rejected).toBe(false);
    expect(r.admitted).toBe(true);
    expect(r.isAdmin).toBe(false); // elevation lives in elevatedUsers, not this flag
  });
});

describe('open play is unaffected', () => {
  beforeEach(() => { process.env.SECURE_MODE = 'false'; });

  it('admits a player with no token at all', async () => {
    const r = await identify(db, { userName: 'walkin', isAdmin: false });
    expect(r.rejected).toBe(false);
    expect(r.admitted).toBe(true);
    expect(r.isAdmin).toBe(false);
  });

  it('admits a bare isAdmin claim but grants it nothing', async () => {
    const r = await identify(db, { userName: 'chancer', isAdmin: true });
    expect(r.rejected).toBe(false);
    expect(r.admitted).toBe(true);
    expect(r.isAdmin).toBe(false);
  });

  it('still recognises a real admin', async () => {
    const r = await identify(db, { userName: 'admin', isAdmin: true, token: ADMIN_TOKEN });
    expect(r.admitted).toBe(true);
    expect(r.isAdmin).toBe(true);
  });
});
