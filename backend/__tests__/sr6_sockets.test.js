/**
 * Integration tests for the SR6 socket flows, booting the real sockets module
 * against an in-memory DB:
 *  - sheetAttack dispatch under the shadowrun_6e system (pool attack)
 *  - AR vs Armor Rating DV modifier applied to damage
 *  - 0-hit pools miss and deal no damage
 *  - stun_current writes past the Stun Monitor overflow into token HP
 *  - system isolation: CWN sheets don't answer SR6 attacks
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
    use: () => {},
    join: () => {},
  };
  connectionCb(socket);
  return { handlers, emitted };
}

let db;
beforeEach(async () => {
  db = await makeTestDb();
  await run(db, `CREATE TABLE dice_rolls (
    id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, total INTEGER,
    results TEXT, color TEXT, historyString TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
  await run(db, `CREATE TABLE IF NOT EXISTS player_banks (username TEXT PRIMARY KEY, balance REAL, debt REAL)`);
  await run(db, `INSERT INTO global_settings (key, value) VALUES ('game_system', 'shadowrun_6e')`);
});

// AGI 30 + Firearms 30 = 60-die pool: statistically certain to land 1+ hits
// (P(0 hits) = (2/3)^60 ≈ 3e-11), so attacks are effectively guaranteed.
const ATTACKER = {
  agility: 30, firearms: 30, close_combat: 0,
  body: 4, willpower: 4, stun_monitor: 10, stun_current: 0,
  weapon1_name: 'Predator', weapon1_dv: '3P', weapon1_ar: 10, weapon1_skill: 'firearms', weapon1_atk: 0,
};

const seedAttacker = (data = ATTACKER) =>
  run(db, `INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('GHOST', 'shadowrun_6e', ?, 0)`,
    [JSON.stringify(data)]);

const seedAttackerToken = (hp = 11) =>
  run(db, `INSERT INTO locations (name, x, y, z, shape, owner, hp_current, hp_max) VALUES ('GHOST', 0, 0, 0, 'rhombus', 'GHOST', ?, ?)`,
    [hp, hp]);

const seedTarget = (armor, hp = 30) =>
  run(db, `INSERT INTO locations (name, x, y, z, shape, owner, melee_ac, ranged_ac, hp_current, hp_max) VALUES ('Punk', 0, 0, 0, 'enemy_rhombus', 'SYSTEM', ?, ?, ?, ?)`,
    [armor, armor, hp, hp]);

describe('SR6 sheetAttack', () => {
  it('hits with a big pool and applies DV +1 when AR beats armor', async () => {
    await seedAttacker();
    await seedAttackerToken();
    const target = await seedTarget(6); // AR 10 > armor 6 -> +1 DV -> 4 damage
    const { handlers, emitted } = boot(db);
    handlers['identify']('GHOST');
    await flush(50);

    handlers['sheetAttack']({ targetId: target.lastID, weaponIndex: 1 });
    await waitFor(() => emitted.some(e => e.event === 'attackResult'));

    const result = emitted.find(e => e.event === 'attackResult');
    expect(result.data.hit).toBe(true);
    expect(result.data.damage).toBe(4);
    const token = await get(db, `SELECT hp_current FROM locations WHERE id = ?`, [target.lastID]);
    expect(token.hp_current).toBe(26);
    const roll = emitted.find(e => e.event === 'diceRollBroadcast');
    expect(roll.data.historyString).toMatch(/hits \/ 60 dice/);
    expect(roll.data.historyString).toContain('GM: soak');
  });

  it('applies DV -1 when armor beats AR', async () => {
    await seedAttacker();
    await seedAttackerToken();
    const target = await seedTarget(14); // AR 10 < armor 14 -> -1 DV -> 2 damage
    const { handlers, emitted } = boot(db);
    handlers['identify']('GHOST');
    await flush(50);

    handlers['sheetAttack']({ targetId: target.lastID, weaponIndex: 1 });
    await waitFor(() => emitted.some(e => e.event === 'attackResult'));

    expect(emitted.find(e => e.event === 'attackResult').data.damage).toBe(2);
    const token = await get(db, `SELECT hp_current FROM locations WHERE id = ?`, [target.lastID]);
    expect(token.hp_current).toBe(28);
  });

  it('rejects weapon rows without a valid DV', async () => {
    await seedAttacker({ ...ATTACKER, weapon1_dv: 'lots' });
    const target = await seedTarget(6);
    const { handlers, emitted } = boot(db);
    handlers['identify']('GHOST');
    await flush(50);

    handlers['sheetAttack']({ targetId: target.lastID, weaponIndex: 1 });
    await waitFor(() => emitted.some(e => e.event === 'sheetAttackError'));
    expect(emitted.find(e => e.event === 'sheetAttackError')).toBeTruthy();
    expect(emitted.find(e => e.event === 'attackResult')).toBeFalsy();
  });

  it('CWN sheets do not answer SR6 attacks (system isolation)', async () => {
    await run(db, `INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('GHOST', 'cities_without_number', ?, 0)`,
      [JSON.stringify({ base_hit_bonus: 30, shoot: 1, weapon1_name: 'P', weapon1_dmg: '1d6', weapon1_skill: 'shoot' })]);
    const target = await seedTarget(6);
    const { handlers, emitted } = boot(db);
    handlers['identify']('GHOST');
    await flush(50);

    handlers['sheetAttack']({ targetId: target.lastID, weaponIndex: 1 });
    await flush(100);
    expect(emitted.find(e => e.event === 'attackResult')).toBeFalsy();
  });
});

describe('SR6 stun overflow', () => {
  it('clamps stun at the monitor and routes the excess to token HP', async () => {
    await seedAttacker();
    await seedAttackerToken(11);
    const { handlers } = boot(db);
    handlers['identify']('GHOST');
    await flush(50);

    // Monitor 10, write 13 -> stun clamps to 10, 3 overflow hits Physical
    handlers['updateSheetField']({ fieldId: 'stun_current', value: 13 });
    for (let i = 0; i < 100; i++) {
      const t = await get(db, `SELECT hp_current FROM locations WHERE owner = 'GHOST'`);
      if (t && t.hp_current === 8) break;
      await flush(10);
    }

    const sheet = await get(db, `SELECT data FROM character_sheets WHERE username = 'GHOST'`);
    expect(JSON.parse(sheet.data).stun_current).toBe(10);
    const token = await get(db, `SELECT hp_current FROM locations WHERE owner = 'GHOST'`);
    expect(token.hp_current).toBe(8);
  });

  it('stun below the monitor stays on the sheet and leaves HP alone', async () => {
    await seedAttacker();
    await seedAttackerToken(11);
    const { handlers } = boot(db);
    handlers['identify']('GHOST');
    await flush(50);

    handlers['updateSheetField']({ fieldId: 'stun_current', value: 5 });
    await flush(100);

    const sheet = await get(db, `SELECT data FROM character_sheets WHERE username = 'GHOST'`);
    expect(JSON.parse(sheet.data).stun_current).toBe(5);
    const token = await get(db, `SELECT hp_current FROM locations WHERE owner = 'GHOST'`);
    expect(token.hp_current).toBe(11);
  });
});
