/**
 * Integration tests for the CWN socket flows, booting the real sockets module
 * against an in-memory DB:
 *  - sheetAttack dispatch by active system (CWN vs CP:R isolation)
 *  - trauma gated by the cwn_trauma house rule
 *  - shock damage on a miss
 *  - Frail instant death tagging
 *  - requestStabilize (success -> 1 HP + Frail, failure -> round clock, death)
 *  - system-switch round-trip: neither system's sheets or rolls leak
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeTestDb, get, run } from './helpers/testDb.js';

process.env.JWT_SECRET = 'test-secret';
process.env.DICE_ANIM_MS = '0'; // skip the 5s dice-animation delay on outcome writes

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
  await run(db, `INSERT INTO global_settings (key, value) VALUES ('game_system', 'cities_without_number')`);
});

// BHB 30 makes any to-hit >= 31: guaranteed hit vs low AC, and still a
// guaranteed miss vs AC 99 (max 20+30 = 50).
const ATTACKER = {
  base_hit_bonus: 30, shoot: 1, dex_mod: 1, heal: 0, int_mod: 0,
  weapon1_name: 'Pistol', weapon1_dmg: '1d6', weapon1_skill: 'shoot',
  weapon1_trauma: 'd2/x2', weapon1_shock: '2/99', weapon1_atk: 0,
};

const seedAttacker = (data = ATTACKER) =>
  run(db, `INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('GHOST', 'cities_without_number', ?, 0)`,
    [JSON.stringify(data)]);

const seedAttackerToken = () =>
  run(db, `INSERT INTO locations (name, x, y, z, shape, owner, hp_current, hp_max) VALUES ('GHOST', 0, 0, 0, 'rhombus', 'GHOST', 20, 20)`);

const seedTarget = (ac, hp = 30) =>
  run(db, `INSERT INTO locations (name, x, y, z, shape, owner, melee_ac, ranged_ac, hp_current, hp_max) VALUES ('Punk', 0, 0, 0, 'enemy_rhombus', 'SYSTEM', ?, ?, ?, ?)`,
    [ac, ac, hp, hp]);

describe('CWN sheetAttack', () => {
  it('resolves a guaranteed hit vs AC and applies damage to the token', async () => {
    await seedAttacker();
    await seedAttackerToken();
    const target = await seedTarget(1);
    const { handlers, emitted } = boot(db);
    handlers['identify']('GHOST');
    await flush(50);

    handlers['sheetAttack']({ targetId: target.lastID, weaponIndex: 1 });
    await waitFor(() => emitted.some(e => e.event === 'attackResult'));

    const result = emitted.find(e => e.event === 'attackResult');
    expect(result.data.hit).toBe(true);
    expect(result.data.ac).toBe(1);
    const token = await get(db, `SELECT hp_current FROM locations WHERE id = ?`, [target.lastID]);
    expect(token.hp_current).toBeLessThan(30);
    expect(token.hp_current).toBe(30 - result.data.damage);
  });

  it('rolls the trauma die when cwn_trauma is on (default)', async () => {
    await seedAttacker();
    await seedAttackerToken();
    const target = await seedTarget(1);
    const { handlers, emitted } = boot(db);
    handlers['identify']('GHOST');
    await flush(50);

    handlers['sheetAttack']({ targetId: target.lastID, weaponIndex: 1 });
    await waitFor(() => emitted.some(e => e.event === 'attackResult'));

    const rolls = emitted.filter(e => e.event === 'diceRollBroadcast');
    expect(rolls.some(r => /trauma/i.test(r.data.historyString))).toBe(true);
  });

  it('skips trauma entirely when cwn_trauma is off', async () => {
    await run(db, `INSERT INTO global_settings (key, value) VALUES ('cwn_trauma', '0')`);
    await seedAttacker();
    await seedAttackerToken();
    const target = await seedTarget(1);
    const { handlers, emitted } = boot(db);
    handlers['identify']('GHOST');
    await flush(50);

    handlers['sheetAttack']({ targetId: target.lastID, weaponIndex: 1 });
    await waitFor(() => emitted.some(e => e.event === 'attackResult'));

    const rolls = emitted.filter(e => e.event === 'diceRollBroadcast');
    expect(rolls.some(r => /trauma/i.test(r.data.historyString))).toBe(false);
    const result = emitted.find(e => e.event === 'attackResult');
    expect(result.data.traumatic).toBe(false);
  });

  it('deals shock damage on a guaranteed miss when the shock AC covers the target', async () => {
    await seedAttacker();
    await seedAttackerToken();
    const target = await seedTarget(99); // unhittable, but shock AC is 99
    const { handlers, emitted } = boot(db);
    handlers['identify']('GHOST');
    await flush(50);

    handlers['sheetAttack']({ targetId: target.lastID, weaponIndex: 1 });
    await waitFor(() => emitted.some(e => e.event === 'attackResult'));

    const result = emitted.find(e => e.event === 'attackResult');
    expect(result.data.hit).toBe(false);
    expect(result.data.shock).toBe(3); // 2 + dex_mod 1
    const token = await get(db, `SELECT hp_current FROM locations WHERE id = ?`, [target.lastID]);
    expect(token.hp_current).toBe(27);
  });

  it('misses cleanly when shock does not cover the target AC', async () => {
    await seedAttacker({ ...ATTACKER, weapon1_shock: '2/13' });
    await seedAttackerToken();
    const target = await seedTarget(99);
    const { handlers, emitted } = boot(db);
    handlers['identify']('GHOST');
    await flush(50);

    handlers['sheetAttack']({ targetId: target.lastID, weaponIndex: 1 });
    await waitFor(() => emitted.some(e => e.event === 'attackResult'));

    const result = emitted.find(e => e.event === 'attackResult');
    expect(result.data.hit).toBe(false);
    expect(result.data.shock).toBeUndefined();
    const token = await get(db, `SELECT hp_current FROM locations WHERE id = ?`, [target.lastID]);
    expect(token.hp_current).toBe(30);
  });

  it('tags a Frail defender death when damage downs them', async () => {
    await seedAttacker({ ...ATTACKER, weapon1_trauma: '' });
    await seedAttackerToken();
    // Frail player defender at 1 HP
    await run(db, `INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('VICTIM', 'cities_without_number', ?, 0)`,
      [JSON.stringify({ frail: 1 })]);
    const target = await run(db,
      `INSERT INTO locations (name, x, y, z, shape, owner, melee_ac, ranged_ac, hp_current, hp_max) VALUES ('VICTIM', 0, 0, 0, 'rhombus', 'VICTIM', 1, 1, 1, 20)`);
    const { handlers, emitted } = boot(db);
    handlers['identify']('GHOST');
    await flush(50);

    handlers['sheetAttack']({ targetId: target.lastID, weaponIndex: 1 });
    await waitFor(() => emitted.some(e => e.event === 'attackResult'));

    const result = emitted.find(e => e.event === 'attackResult');
    expect(result.data.targetDown).toBe(true);
    expect(result.data.frailDeath).toBe(true);
    const rolls = emitted.filter(e => e.event === 'diceRollBroadcast');
    expect(rolls.some(r => r.data.historyString.includes('FRAIL: INSTANT DEATH'))).toBe(true);
  });

  it('does not fire the CWN flow while CP:R is the active system', async () => {
    await run(db, `UPDATE global_settings SET value = 'cyberpunk_red' WHERE key = 'game_system'`);
    await seedAttacker(); // CWN sheet exists, but the active system is CP:R
    await seedAttackerToken();
    const target = await seedTarget(1);
    const { handlers, emitted } = boot(db);
    handlers['identify']('GHOST');
    await flush(50);

    handlers['sheetAttack']({ targetId: target.lastID, weaponIndex: 1 });
    await flush(200);
    // No CP:R sheet for GHOST -> the CP:R flow bails; the CWN sheet must not be used
    expect(emitted.some(e => e.event === 'attackResult')).toBe(false);
  });
});

describe('CWN requestStabilize', () => {
  const seedDowned = async (data = {}) => {
    await run(db, `INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('DOWNED', 'cities_without_number', ?, 0)`,
      [JSON.stringify(data)]);
    await run(db, `INSERT INTO locations (name, x, y, z, shape, owner, hp_current, hp_max) VALUES ('DOWNED', 0, 0, 0, 'rhombus', 'DOWNED', 0, 20)`);
  };

  it('success: restores 1 HP, sets Frail, resets the round clock', async () => {
    await seedAttacker({ heal: 20, int_mod: 2 }); // 2d6+22 always beats DC 8
    await seedDowned({ rounds_since_downed: 0 });
    const { handlers, emitted } = boot(db);
    handlers['identify']('GHOST');
    await flush(50);

    handlers['requestStabilize']({ targetUsername: 'DOWNED' });
    await waitFor(() => emitted.some(e => e.event === 'stabilizeResult'));

    const result = emitted.find(e => e.event === 'stabilizeResult');
    expect(result.data.success).toBe(true);
    expect(result.data.roller).toBe('GHOST');
    await waitFor(async () => true); await flush(50);
    const token = await get(db, `SELECT hp_current FROM locations WHERE owner = 'DOWNED'`);
    expect(token.hp_current).toBe(1);
    const sheet = await get(db, `SELECT data FROM character_sheets WHERE username = 'DOWNED'`);
    const data = JSON.parse(sheet.data);
    expect(data.frail).toBe(1);
    expect(data.rounds_since_downed).toBe(0);
  });

  it('failure: burns a round on the target sheet', async () => {
    await seedAttacker({ heal: -20, int_mod: 0 }); // 2d6-20 never reaches DC 8
    await seedDowned({ rounds_since_downed: 2 });
    const { handlers, emitted } = boot(db);
    handlers['identify']('GHOST');
    await flush(50);

    handlers['requestStabilize']({ targetUsername: 'DOWNED' });
    await waitFor(() => emitted.some(e => e.event === 'stabilizeResult'));

    const result = emitted.find(e => e.event === 'stabilizeResult');
    expect(result.data.success).toBe(false);
    expect(result.data.dc).toBe(10); // 8 + 2 rounds
    await flush(50);
    const sheet = await get(db, `SELECT data FROM character_sheets WHERE username = 'DOWNED'`);
    expect(JSON.parse(sheet.data).rounds_since_downed).toBe(3);
    const token = await get(db, `SELECT hp_current FROM locations WHERE owner = 'DOWNED'`);
    expect(token.hp_current).toBe(0);
  });

  it('declares death on the sixth failed round', async () => {
    await seedAttacker({ heal: -20, int_mod: 0 });
    await seedDowned({ rounds_since_downed: 5 });
    const { handlers, emitted } = boot(db);
    handlers['identify']('GHOST');
    await flush(50);

    handlers['requestStabilize']({ targetUsername: 'DOWNED' });
    await waitFor(() => emitted.some(e => e.event === 'stabilizeResult'));
    await flush(50);

    const rolls = emitted.filter(e => e.event === 'diceRollBroadcast');
    expect(rolls.some(r => r.data.historyString.includes('DEAD'))).toBe(true);
  });

  it('refuses when the target is above 0 HP or already Frail', async () => {
    await seedAttacker({ heal: 20 });
    await run(db, `INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('UPPY', 'cities_without_number', '{}', 0)`);
    await run(db, `INSERT INTO locations (name, x, y, z, shape, owner, hp_current, hp_max) VALUES ('UPPY', 0, 0, 0, 'rhombus', 'UPPY', 5, 20)`);
    await run(db, `INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('GONE', 'cities_without_number', '{"frail":1}', 0)`);
    await run(db, `INSERT INTO locations (name, x, y, z, shape, owner, hp_current, hp_max) VALUES ('GONE', 0, 0, 0, 'rhombus', 'GONE', 0, 20)`);
    const { handlers, emitted } = boot(db);
    handlers['identify']('GHOST');
    await flush(50);

    handlers['requestStabilize']({ targetUsername: 'UPPY' });
    handlers['requestStabilize']({ targetUsername: 'GONE' });
    await flush(200);
    expect(emitted.some(e => e.event === 'stabilizeResult')).toBe(false);
  });

  it('refuses while a CP:R game is active (system isolation)', async () => {
    await run(db, `UPDATE global_settings SET value = 'cyberpunk_red' WHERE key = 'game_system'`);
    await seedAttacker({ heal: 20 });
    await seedDowned();
    const { handlers, emitted } = boot(db);
    handlers['identify']('GHOST');
    await flush(50);

    handlers['requestStabilize']({ targetUsername: 'DOWNED' });
    await flush(200);
    expect(emitted.some(e => e.event === 'stabilizeResult')).toBe(false);
  });
});

describe('CWN token_ac linked field', () => {
  it('overlays the token AC onto the sheet at read time', async () => {
    await run(db, `INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('GHOST', 'cities_without_number', '{"ac": 55}', 0)`);
    await run(db, `INSERT INTO locations (name, x, y, z, shape, owner, melee_ac, ranged_ac, hp_current, hp_max) VALUES ('GHOST', 0, 0, 0, 'rhombus', 'GHOST', 14, 14, 20, 20)`);
    const { handlers, emitted } = boot(db);
    handlers['identify']('GHOST');
    await flush(50);

    handlers['requestMySheet']();
    await waitFor(() => emitted.some(e => e.event === 'sheetData'));
    const sheet = emitted.find(e => e.event === 'sheetData');
    // Token wins over any stale value in the sheet JSON
    expect(sheet.data.data.ac).toBe(14);
  });

  it('routes a sheet AC edit to the token instead of the sheet JSON', async () => {
    await run(db, `INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('GHOST', 'cities_without_number', '{}', 0)`);
    await run(db, `INSERT INTO locations (name, x, y, z, shape, owner, melee_ac, ranged_ac, hp_current, hp_max) VALUES ('GHOST', 0, 0, 0, 'rhombus', 'GHOST', 10, 10, 20, 20)`);
    const { handlers, emitted } = boot(db);
    handlers['identify']('GHOST');
    await flush(50);

    handlers['updateSheetField']({ fieldId: 'ac', value: 16 });
    await waitFor(() => emitted.some(e => e.event === 'sheetUpdated'));

    const token = await get(db, `SELECT melee_ac, ranged_ac FROM locations WHERE owner = 'GHOST'`);
    expect(token.melee_ac).toBe(16);
    expect(token.ranged_ac).toBe(16);
    const sheet = await get(db, `SELECT data FROM character_sheets WHERE username = 'GHOST'`);
    expect(JSON.parse(sheet.data).ac).toBeUndefined(); // never stored on the sheet
  });

  it('rejects garbage AC writes', async () => {
    await run(db, `INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('GHOST', 'cities_without_number', '{}', 0)`);
    await run(db, `INSERT INTO locations (name, x, y, z, shape, owner, melee_ac, ranged_ac, hp_current, hp_max) VALUES ('GHOST', 0, 0, 0, 'rhombus', 'GHOST', 10, 10, 20, 20)`);
    const { handlers } = boot(db);
    handlers['identify']('GHOST');
    await flush(50);

    handlers['updateSheetField']({ fieldId: 'ac', value: 'lol' });
    handlers['updateSheetField']({ fieldId: 'ac', value: -5 });
    await flush(150);
    const token = await get(db, `SELECT melee_ac FROM locations WHERE owner = 'GHOST'`);
    expect(token.melee_ac).toBe(10);
  });
});

describe('system-switch round-trip isolation', () => {
  it('keeps both systems sheets and roll maps separate across a switch', async () => {
    // One player, one sheet per system, different values
    await run(db, `INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('GHOST', 'cities_without_number', ?, 0)`,
      [JSON.stringify({ shoot: 3, dex_mod: 1 })]);
    await run(db, `INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('GHOST', 'cyberpunk_red', ?, 0)`,
      [JSON.stringify({ ref: 7, handgun: 5 })]);
    await run(db, `INSERT INTO locations (name, x, y, z, shape, owner, hp_current, hp_max) VALUES ('GHOST', 0, 0, 0, 'rhombus', 'GHOST', 20, 20)`);
    const { handlers, emitted } = boot(db);
    handlers['identify']('GHOST');
    await flush(50);

    // CWN active: 'shoot' rolls 2d6, 'handgun' (CP:R-only) does not roll
    handlers['requestSheetRoll']({ fieldId: 'shoot' });
    await waitFor(() => emitted.some(e => e.event === 'diceRollBroadcast'));
    handlers['requestSheetRoll']({ fieldId: 'handgun' });
    await flush(150);
    let rolls = emitted.filter(e => e.event === 'diceRollBroadcast');
    expect(rolls).toHaveLength(1);
    expect(rolls[0].data.results['6']).toHaveLength(2); // 2d6, nothing explodes

    // Switch to CP:R: 'handgun' rolls (exploding d10), 'shoot' does not
    await run(db, `UPDATE global_settings SET value = 'cyberpunk_red' WHERE key = 'game_system'`);
    handlers['requestSheetRoll']({ fieldId: 'handgun' });
    await waitFor(() => emitted.filter(e => e.event === 'diceRollBroadcast').length >= 2);
    handlers['requestSheetRoll']({ fieldId: 'shoot' });
    await flush(150);
    rolls = emitted.filter(e => e.event === 'diceRollBroadcast');
    expect(rolls).toHaveLength(2);
    expect(Object.keys(rolls[1].data.results)).toContain('10');

    // Switch back: both sheets untouched
    await run(db, `UPDATE global_settings SET value = 'cities_without_number' WHERE key = 'game_system'`);
    const cwn = await get(db, `SELECT data FROM character_sheets WHERE username = 'GHOST' AND system = 'cities_without_number'`);
    const cpr = await get(db, `SELECT data FROM character_sheets WHERE username = 'GHOST' AND system = 'cyberpunk_red'`);
    expect(JSON.parse(cwn.data).shoot).toBe(3);
    expect(JSON.parse(cpr.data).handgun).toBe(5);
  });

  it('cwn_trauma has no effect on CP:R attacks', async () => {
    await run(db, `UPDATE global_settings SET value = 'cyberpunk_red' WHERE key = 'game_system'`);
    await run(db, `INSERT INTO global_settings (key, value) VALUES ('cwn_trauma', '1')`);
    await run(db, `INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('GHOST', 'cyberpunk_red', ?, 0)`,
      [JSON.stringify({ ref: 20, handgun: 20, weapon1_name: 'Gun', weapon1_dmg: '3d6', weapon1_skill: 'handgun' })]);
    await run(db, `INSERT INTO locations (name, x, y, z, shape, owner, hp_current, hp_max) VALUES ('GHOST', 0, 0, 0, 'rhombus', 'GHOST', 20, 20)`);
    const target = await run(db,
      `INSERT INTO locations (name, x, y, z, shape, owner, melee_ac, ranged_ac, hp_current, hp_max) VALUES ('Punk', 0, 0, 0, 'enemy_rhombus', 'SYSTEM', 1, 1, 30, 30)`);
    const { handlers, emitted } = boot(db);
    handlers['identify']('GHOST');
    await flush(50);

    handlers['sheetAttack']({ targetId: target.lastID, weaponIndex: 1 });
    await waitFor(() => emitted.some(e => e.event === 'attackResult'));

    const rolls = emitted.filter(e => e.event === 'diceRollBroadcast');
    expect(rolls.some(r => /trauma/i.test(r.data.historyString))).toBe(false);
    const result = emitted.find(e => e.event === 'attackResult');
    expect(result.data.traumatic).toBeUndefined();
  });
});
