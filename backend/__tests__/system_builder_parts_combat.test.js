/**
 * A custom system with combat turned off (3b6b), on the server: no attack starts, so no dice
 * roll is ever read as one. Every built-in system, and a custom one that kept combat, starts
 * an attack as before.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'module';
import { makeTestDb, run } from './helpers/testDb.js';
import { drain } from './helpers/until.js';

process.env.JWT_SECRET = 'test-secret';

const require_ = createRequire(import.meta.url);
const runtime = require_('../systemBuilder/runtime');
const socketsFactory = (await import('../sockets/index.js')).default;

const NOCOMBAT = 'sys_aaaaaaaaaaaaaaaa';
const KEPT = 'sys_bbbbbbbbbbbbbbbb';
const BUILT_INS = ['cities_without_number', 'cyberpunk_red', 'shadowrun_6e', 'generic'];

let db;
let targetId;
beforeEach(async () => {
  db = await makeTestDb();
  const off = JSON.stringify({ format: 1, name: 'Hearth', parts: { combat: { on: false } } });
  const kept = JSON.stringify({ format: 1, name: 'Kept' });
  await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1), (?, ?, ?, ?, 1)',
    [NOCOMBAT, 'Hearth', off, off, KEPT, 'Kept', kept, kept]);
  await new Promise((resolve) => runtime.load(db, resolve));
  targetId = (await run(db, `INSERT INTO locations (name, x, y, z, shape, melee_ac, ranged_ac) VALUES ('Ghoul', 0, 0, 0, 'enemy_rhombus', 12, 14)`)).lastID;
});

let nextSocket = 0;
/** Whether the attacker is told an attack is under way, under `system`. */
const attackStarts = async (system) => {
  await run(db, `INSERT OR REPLACE INTO global_settings (key, value) VALUES ('game_system', ?)`, [system]);
  const sent = [];
  let connect;
  socketsFactory({ on: (e, cb) => { if (e === 'connection') connect = cb; }, emit: () => {}, to: () => ({ emit: () => {} }) },
    db, { elevatedUsers: new Set(), emitUpdate: vi.fn(), recordAction: vi.fn() });
  const handlers = {};
  connect({ id: `atk-sock-${(nextSocket += 1)}`, on: (e, fn) => { handlers[e] = fn; }, emit: (event, data) => sent.push({ event, data }),
    broadcast: { emit: () => {} }, use: () => {}, join: () => {} });
  handlers.identify('JADE');
  await drain(db);
  handlers.initiateAttack({ targetId, attackType: 'ranged' });
  await drain(db);
  return sent.find((e) => e.event === 'attackPending')?.data ?? null;
};

describe('starting an attack', () => {
  it('starts none while the game has combat off', async () => {
    expect(await attackStarts(NOCOMBAT)).toBeNull();
  });

  it('starts one as before under every built-in system and a custom one that kept combat', async () => {
    for (const system of [...BUILT_INS, KEPT]) {
      expect(await attackStarts(system), system).toMatchObject({ targetId, attackType: 'ranged', ac: 14 });
    }
  });
});
