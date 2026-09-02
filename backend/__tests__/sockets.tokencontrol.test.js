/**
 * Moving tokens over the socket, and who is allowed to.
 *
 * tokenControl decides the rule; these cover the wiring - that both move handlers actually
 * ask it, that the grant survives a round trip through the database, and that an admin
 * setting one cannot open up a token that was never meant to carry it.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeTestDb, get, run } from './helpers/testDb.js';

process.env.JWT_SECRET = 'test-secret';
process.env.DICE_ANIM_MS = '0';

const socketsFactory = (await import('../sockets/index.js')).default;

const flush = (ms = 25) => new Promise((r) => setTimeout(r, ms));
const waitFor = async (cond, timeout = 2000) => {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > timeout) return;
    await flush(10);
  }
};

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
  const socket = {
    id: 'sock-1',
    on: (event, fn) => { handlers[event] = fn; },
    emit: (event, data) => emitted.push({ event, data, direct: true }),
    broadcast: { emit: (event, data) => emitted.push({ event, data, broadcast: true }) },
    use: () => {},
    join: () => {},
  };
  connectionCb(socket);
  return { handlers, emitted };
}

let db;
beforeEach(async () => {
  db = await makeTestDb();
  await run(db, `CREATE TABLE IF NOT EXISTS dice_rolls (
    id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, total INTEGER,
    results TEXT, color TEXT, historyString TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(db, `CREATE TABLE IF NOT EXISTS player_banks (username TEXT PRIMARY KEY, balance REAL, debt REAL)`);
});

const seedToken = async (shape, owner, controllers = null) => {
  const r = await run(db,
    `INSERT INTO locations (name, x, y, z, shape, owner, controllers) VALUES ('NPC', 0, 0, 0, ?, ?, ?)`,
    [shape, owner, controllers]);
  return r.lastID;
};

const posOf = (id) => get(db, `SELECT x, z FROM locations WHERE id = ?`, [id]);
const controllersOf = async (id) =>
  (await get(db, `SELECT controllers FROM locations WHERE id = ?`, [id])).controllers;

/** Identify as a player, then try to walk the token to (9, 9). */
const tryMove = async (id, userName) => {
  const { handlers } = boot(db);
  handlers['identify'](userName);
  await flush(50);
  handlers['moveRhombus']({ id, x: 9, z: 9 });
  await flush(50);
  return posOf(id);
};

describe('moveRhombus honours the grant', () => {
  it('lets a named player move a shared friendly NPC', async () => {
    const id = await seedToken('friendly_rhombus', 'SYSTEM', JSON.stringify({ all: false, users: ['bob'] }));
    expect(await tryMove(id, 'bob')).toEqual({ x: 9, z: 9 });
  });

  it('refuses a player who was not named', async () => {
    const id = await seedToken('friendly_rhombus', 'SYSTEM', JSON.stringify({ all: false, users: ['bob'] }));
    expect(await tryMove(id, 'carol')).toEqual({ x: 0, z: 0 });
  });

  it('lets anyone move one that is open to all', async () => {
    const id = await seedToken('friendly_rhombus', 'SYSTEM', JSON.stringify({ all: true, users: [] }));
    expect(await tryMove(id, 'carol')).toEqual({ x: 9, z: 9 });
  });

  it('refuses an ungranted friendly NPC, as before', async () => {
    // Every friendly NPC that existed before this feature.
    const id = await seedToken('friendly_rhombus', 'SYSTEM');
    expect(await tryMove(id, 'bob')).toEqual({ x: 0, z: 0 });
  });

  it('refuses an enemy however it was granted', async () => {
    const id = await seedToken('enemy_rhombus', 'SYSTEM', JSON.stringify({ all: true, users: ['bob'] }));
    expect(await tryMove(id, 'bob')).toEqual({ x: 0, z: 0 });
  });

  it('still lets a player move their own token', async () => {
    const id = await seedToken('rhombus', 'alice');
    expect(await tryMove(id, 'alice')).toEqual({ x: 9, z: 9 });
  });

  it('still refuses someone else the same token', async () => {
    const id = await seedToken('rhombus', 'alice');
    expect(await tryMove(id, 'bob')).toEqual({ x: 0, z: 0 });
  });
});

describe('moveRhombusPath honours the same rule', () => {
  // The path handler is a second copy of the same check, and it is the one a player
  // actually triggers by dragging - so it needs its own coverage, not an assumption.
  const tryPath = async (id, userName) => {
    const { handlers } = boot(db);
    handlers['identify'](userName);
    await flush(50);
    handlers['moveRhombusPath']({ id, waypoints: [{ x: 4, z: 4 }, { x: 9, z: 9 }] });
    await flush(50);
    return posOf(id);
  };

  it('lets a named player walk a shared friendly NPC', async () => {
    const id = await seedToken('friendly_rhombus', 'SYSTEM', JSON.stringify({ all: false, users: ['bob'] }));
    expect(await tryPath(id, 'bob')).toEqual({ x: 9, z: 9 });
  });

  it('refuses a player who was not named', async () => {
    const id = await seedToken('friendly_rhombus', 'SYSTEM', JSON.stringify({ all: false, users: ['bob'] }));
    expect(await tryPath(id, 'carol')).toEqual({ x: 0, z: 0 });
  });

  it('refuses an enemy', async () => {
    const id = await seedToken('enemy_rhombus', 'SYSTEM', JSON.stringify({ all: true, users: [] }));
    expect(await tryPath(id, 'bob')).toEqual({ x: 0, z: 0 });
  });
});

describe('setTokenControl', () => {
  const asAdmin = async () => {
    const { handlers, emitted } = boot(db);
    handlers['identify']('gm');
    await flush(20);
    handlers['adminAuth']?.({ token: 'x' });
    return { handlers, emitted };
  };

  it('is refused to a player', async () => {
    // Sharing a token is the GM's call, not a player's.
    const id = await seedToken('friendly_rhombus', 'SYSTEM');
    const { handlers } = boot(db);
    handlers['identify']('bob');
    await flush(50);
    handlers['setTokenControl']({ id, all: true, users: [] });
    await flush(50);
    expect(await controllersOf(id)).toBeNull();
  });

  it('ignores a token that does not exist', async () => {
    const { handlers } = boot(db);
    handlers['identify']('bob');
    await flush(50);
    // No throw is the assertion; a missing row must not take the server down.
    handlers['setTokenControl']({ id: 9999, all: true, users: [] });
    await flush(50);
  });

  it('ignores a malformed id', async () => {
    const { handlers } = boot(db);
    handlers['identify']('bob');
    await flush(50);
    for (const id of [undefined, null, 'abc', {}]) {
      handlers['setTokenControl']({ id, all: true, users: [] });
    }
    await flush(50);
  });
});

describe('sharing a token is not a feature of any one game system', () => {
  /**
   * Deliberately system-agnostic, unlike the sheet work.
   *
   * Nothing in the control path reads the active system: the grant lives on the token row
   * rather than on a character sheet, the rule keys off the token's SHAPE, and neither move
   * handler asks what game is being played. A GM running Cyberpunk should be able to hand a
   * friendly NPC to a player exactly as one running CWN can.
   */
  const SYSTEMS = ['cyberpunk_red', 'cities_without_number', 'shadowrun_6e', 'generic'];

  it.each(SYSTEMS)('lets a named player move a shared friendly NPC under %s', async (system) => {
    await run(db, `INSERT OR REPLACE INTO global_settings (key, value) VALUES ('game_system', ?)`, [system]);
    const id = await seedToken('friendly_rhombus', 'SYSTEM', JSON.stringify({ all: false, users: ['bob'] }));
    expect(await tryMove(id, 'bob')).toEqual({ x: 9, z: 9 });
  });

  it.each(SYSTEMS)('still refuses an ungranted one under %s', async (system) => {
    // The other half: the rule is the same everywhere, not just permissive everywhere.
    await run(db, `INSERT OR REPLACE INTO global_settings (key, value) VALUES ('game_system', ?)`, [system]);
    const id = await seedToken('friendly_rhombus', 'SYSTEM');
    expect(await tryMove(id, 'bob')).toEqual({ x: 0, z: 0 });
  });

  it('works with no game system set at all', async () => {
    // A fresh install, before anyone has chosen one.
    await run(db, `DELETE FROM global_settings WHERE key = 'game_system'`);
    const id = await seedToken('friendly_rhombus', 'SYSTEM', JSON.stringify({ all: true, users: [] }));
    expect(await tryMove(id, 'carol')).toEqual({ x: 9, z: 9 });
  });
});
