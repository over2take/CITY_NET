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

  it('defenders with a sheet auto-dodge: a huge REA+INT pool forces a miss', async () => {
    await seedAttacker();
    await seedAttackerToken();
    const target = await seedTarget(6);
    // Linked NPC sheet with a 200-die dodge pool: net hits < 0 -> guaranteed miss
    const npc = await run(db, `INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('SYSTEM', 'shadowrun_6e', ?, 1)`,
      [JSON.stringify({ reaction: 100, intuition: 100 })]);
    await run(db, `INSERT INTO npc_sheet_links (location_id, sheet_id) VALUES (?, ?)`, [target.lastID, npc.lastID]);
    const { handlers, emitted } = boot(db);
    handlers['identify']('GHOST');
    await flush(50);

    handlers['sheetAttack']({ targetId: target.lastID, weaponIndex: 1 });
    await waitFor(() => emitted.some(e => e.event === 'attackResult'));

    const result = emitted.find(e => e.event === 'attackResult');
    expect(result.data.hit).toBe(false);
    const dodge = emitted.filter(e => e.event === 'diceRollBroadcast')
      .find(r => r.data.historyString.includes('dodges'));
    expect(dodge).toBeTruthy();
    expect(dodge.data.historyString).toMatch(/\/ 200 dice/);
    const token = await get(db, `SELECT hp_current FROM locations WHERE id = ?`, [target.lastID]);
    expect(token.hp_current).toBe(30); // untouched
  });

  it('net hits add to the DV when the defense pool is tiny', async () => {
    await seedAttacker();
    await seedAttackerToken();
    const target = await seedTarget(6, 60);
    // 2-die dodge pool vs 60-die attack: expect a hit with damage > base 4
    const npc = await run(db, `INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('SYSTEM', 'shadowrun_6e', ?, 1)`,
      [JSON.stringify({ reaction: 1, intuition: 1 })]);
    await run(db, `INSERT INTO npc_sheet_links (location_id, sheet_id) VALUES (?, ?)`, [target.lastID, npc.lastID]);
    const { handlers, emitted } = boot(db);
    handlers['identify']('GHOST');
    await flush(50);

    handlers['sheetAttack']({ targetId: target.lastID, weaponIndex: 1 });
    await waitFor(() => emitted.some(e => e.event === 'attackResult'));

    const result = emitted.find(e => e.event === 'attackResult');
    expect(result.data.hit).toBe(true);
    // DV 3 + 1 (AR) + net hits: with ~20 hits vs <=2 dodge hits this far exceeds base
    expect(result.data.damage).toBeGreaterThan(4);
    const attack = emitted.filter(e => e.event === 'diceRollBroadcast')
      .find(r => r.data.historyString.includes('vs dodge'));
    expect(attack.data.historyString).toMatch(/net \d+/);
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

describe('SR6 resistDrain', () => {
  // WIL 30 + LOG 30 = 60-die pool: statistically certain to get many hits,
  // so net drain = max(0, DV - hits) will be 0 for reasonable DV values.
  const MAGE = { willpower: 30, logic: 30, stun_monitor: 10, stun_current: 0 };

  const seedMage = (data = MAGE) =>
    run(db, `INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('MYSTIC', 'shadowrun_6e', ?, 0)`,
      [JSON.stringify(data)]);

  const seedMageToken = (hp = 10) =>
    run(db, `INSERT INTO locations (name, x, y, z, shape, owner, hp_current, hp_max) VALUES ('MYSTIC', 0, 0, 0, 'rhombus', 'MYSTIC', ?, ?)`,
      [hp, hp]);

  it('resists all drain with a large pool and broadcasts a yellow roll', async () => {
    await seedMage();
    const { handlers, emitted } = boot(db);
    handlers['identify']('MYSTIC');
    await flush(50);

    handlers['resistDrain']({ drainValue: 4, attr: 'logic', label: 'Fireball Drain' });
    await waitFor(() => emitted.some(e => e.event === 'diceRollBroadcast'));

    const roll = emitted.find(e => e.event === 'diceRollBroadcast');
    expect(roll.data.color).toBe('#ffcc00');
    expect(roll.data.historyString).toContain('resists Fireball Drain');
    expect(roll.data.historyString).toContain('no drain');
    const sheet = await get(db, `SELECT data FROM character_sheets WHERE username = 'MYSTIC'`);
    expect(JSON.parse(sheet.data).stun_current).toBe(0);
  });

  it('applies net drain to stun_current when resist pool is small', async () => {
    // WIL 1 + LOG 1 = 2-die pool vs DV 6: almost certain to take 4+ Stun
    await seedMage({ willpower: 1, logic: 1, stun_monitor: 10, stun_current: 0 });
    const { handlers, emitted } = boot(db);
    handlers['identify']('MYSTIC');
    await flush(50);

    handlers['resistDrain']({ drainValue: 6, attr: 'logic', label: 'Ball Lightning Drain' });
    await waitFor(() => emitted.some(e => e.event === 'sheetUpdated'));

    const sheet = await get(db, `SELECT data FROM character_sheets WHERE username = 'MYSTIC'`);
    const stun = JSON.parse(sheet.data).stun_current;
    expect(stun).toBeGreaterThan(0);
    expect(stun).toBeLessThanOrEqual(10);
  });

  it('overflows excess drain into Physical HP when stun track fills', async () => {
    // Stun track already at 8/10, DV 6 with a 2-die pool: near-certain overflow
    await seedMage({ willpower: 1, logic: 1, stun_monitor: 10, stun_current: 8 });
    await seedMageToken(10);
    const { handlers, emitted } = boot(db);
    handlers['identify']('MYSTIC');
    await flush(50);

    handlers['resistDrain']({ drainValue: 6, attr: 'logic', label: 'Drain' });
    await waitFor(() => emitted.some(e => e.event === 'dataUpdated'));

    const sheet = await get(db, `SELECT data FROM character_sheets WHERE username = 'MYSTIC'`);
    expect(JSON.parse(sheet.data).stun_current).toBe(10); // clamped at monitor
    const token = await get(db, `SELECT hp_current FROM locations WHERE owner = 'MYSTIC'`);
    expect(token.hp_current).toBeLessThan(10); // overflow hit Physical
  });

  it('ignores resistDrain with missing or invalid payload', async () => {
    await seedMage();
    const { handlers, emitted } = boot(db);
    handlers['identify']('MYSTIC');
    await flush(50);

    handlers['resistDrain']({ drainValue: 0, attr: 'logic', label: 'x' });  // DV=0 ignored
    handlers['resistDrain']({ drainValue: 4, attr: '', label: 'x' });        // no attr
    handlers['resistDrain'](null);                                            // null payload
    await flush(100);

    expect(emitted.find(e => e.event === 'diceRollBroadcast')).toBeFalsy();
  });
});
