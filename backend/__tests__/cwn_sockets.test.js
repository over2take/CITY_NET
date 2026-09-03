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

  it('broadcasts the damage roll WITH its dice so the tray can render them', async () => {
    await seedAttacker();
    await seedAttackerToken();
    const target = await seedTarget(1);
    const { handlers, emitted } = boot(db);
    handlers['identify']('GHOST');
    await flush(50);

    handlers['sheetAttack']({ targetId: target.lastID, weaponIndex: 1 });
    await waitFor(() => emitted.some(e => e.event === 'attackResult'));

    const dmgRoll = emitted.filter(e => e.event === 'diceRollBroadcast')
      .find(r => r.data.historyString.includes('damage vs'));
    expect(dmgRoll).toBeTruthy();
    expect(dmgRoll.data.results['6']).toHaveLength(1); // the weapon's 1d6
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

  it('shows the attack-engine default (10) when the token AC was never set', async () => {
    await run(db, `INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('GHOST', 'cities_without_number', '{}', 0)`);
    await run(db, `INSERT INTO locations (name, x, y, z, shape, owner, hp_current, hp_max) VALUES ('GHOST', 0, 0, 0, 'rhombus', 'GHOST', 20, 20)`);
    const { handlers, emitted } = boot(db);
    handlers['identify']('GHOST');
    await flush(50);

    handlers['requestMySheet']();
    await waitFor(() => emitted.some(e => e.event === 'sheetData'));
    const sheet = emitted.find(e => e.event === 'sheetData');
    expect(sheet.data.data.ac).toBe(10);
  });

  const seedAcSheet = async () => {
    await run(db, `INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('GHOST', 'cities_without_number', '{}', 0)`);
    await run(db, `INSERT INTO locations (name, x, y, z, shape, owner, melee_ac, ranged_ac, hp_current, hp_max) VALUES ('GHOST', 0, 0, 0, 'rhombus', 'GHOST', 10, 10, 20, 20)`);
  };

  it('routes a melee AC edit to that column alone, not to the sheet JSON', async () => {
    // The two ACs are separate numbers in CWN, so the melee field is not a way to
    // set both. It used to be, which meant a character could not have the 13/14 the
    // book gives a War Harness.
    await seedAcSheet();
    const { handlers, emitted } = boot(db);
    handlers['identify']('GHOST');
    await flush(50);

    handlers['updateSheetField']({ fieldId: 'ac', value: 16 });
    await waitFor(() => emitted.some(e => e.event === 'sheetUpdated'));

    const token = await get(db, `SELECT melee_ac, ranged_ac FROM locations WHERE owner = 'GHOST'`);
    expect(token.melee_ac).toBe(16);
    expect(token.ranged_ac).toBe(10); // untouched
    const sheet = await get(db, `SELECT data FROM character_sheets WHERE username = 'GHOST'`);
    expect(JSON.parse(sheet.data).ac).toBeUndefined(); // never stored on the sheet
  });

  it('routes a ranged AC edit to the other column alone', async () => {
    await seedAcSheet();
    const { handlers, emitted } = boot(db);
    handlers['identify']('GHOST');
    await flush(50);

    handlers['updateSheetField']({ fieldId: 'ac_ranged', value: 13 });
    await waitFor(() => emitted.some(e => e.event === 'sheetUpdated'));

    const token = await get(db, `SELECT melee_ac, ranged_ac FROM locations WHERE owner = 'GHOST'`);
    expect(token.ranged_ac).toBe(13);
    expect(token.melee_ac).toBe(10);
    const sheet = await get(db, `SELECT data FROM character_sheets WHERE username = 'GHOST'`);
    expect(JSON.parse(sheet.data).ac_ranged).toBeUndefined();
  });

  it('reads both ACs back off the token', async () => {
    await seedAcSheet();
    await run(db, `UPDATE locations SET melee_ac = 14, ranged_ac = 13 WHERE owner = 'GHOST'`);
    const { handlers, emitted } = boot(db);
    handlers['identify']('GHOST');
    await flush(50);

    handlers['requestMySheet']();
    await waitFor(() => emitted.some(e => e.event === 'sheetData'));
    const sheet = emitted.find(e => e.event === 'sheetData');
    expect(sheet.data.data.ac).toBe(14);
    expect(sheet.data.data.ac_ranged).toBe(13);
  });

  it('armor fields drive the token AC automatically', async () => {
    await run(db, `INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('GHOST', 'cities_without_number', ?, 0)`,
      [JSON.stringify({ dex: 14, dex_mod: 1 })]);
    await run(db, `INSERT INTO locations (name, x, y, z, shape, owner, melee_ac, ranged_ac, hp_current, hp_max) VALUES ('GHOST', 0, 0, 0, 'rhombus', 'GHOST', 10, 10, 20, 20)`);
    const { handlers, emitted } = boot(db);
    handlers['identify']('GHOST');
    await flush(50);

    handlers['updateSheetField']({ fieldId: 'armor_ac', value: 14 });
    await waitFor(() => emitted.some(e => e.event === 'sheetUpdated'));
    await flush(50);

    const token = await get(db, `SELECT melee_ac, ranged_ac FROM locations WHERE owner = 'GHOST'`);
    expect(token.melee_ac).toBe(15); // 14 base + 1 dex mod
    expect(token.ranged_ac).toBe(15); // no melee AC set, so the two are the same
  });

  it('drives the two token columns apart when the armor defends differently', async () => {
    // The point of the split, end to end. A War Harness is 13 ranged and 14 melee; with
    // a +1 Dex the token must end up 14 and 15, not one number twice. This is the path
    // that was producing the wrong number - the resolver already picked the right column,
    // but both columns held the same value so there was nothing to pick between.
    await run(db, `INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('GHOST', 'cities_without_number', ?, 0)`,
      [JSON.stringify({ dex: 14, dex_mod: 1, armor_ac: 13, armor_ac_melee: 14 })]);
    await run(db, `INSERT INTO locations (name, x, y, z, shape, owner, melee_ac, ranged_ac, hp_current, hp_max) VALUES ('GHOST', 0, 0, 0, 'rhombus', 'GHOST', 10, 10, 20, 20)`);
    const { handlers, emitted } = boot(db);
    handlers['identify']('GHOST');
    await flush(50);

    handlers['updateSheetField']({ fieldId: 'armor_name', value: 'War Harness' });
    await waitFor(() => emitted.some(e => e.event === 'sheetUpdated'));
    await flush(50);

    const token = await get(db, `SELECT melee_ac, ranged_ac FROM locations WHERE owner = 'GHOST'`);
    expect(token.ranged_ac).toBe(14); // 13 + 1
    expect(token.melee_ac).toBe(15);  // 14 + 1
  });

  it('sends a ranged attack at the ranged AC and a melee attack at the melee one', async () => {
    // The two columns only matter because the attack picks between them. Same target,
    // two weapons, and the AC each one reports is the column its attack type targets.
    await seedAttacker({
      ...ATTACKER, stab: 1,
      weapon2_name: 'Knife', weapon2_dmg: '1d4', weapon2_skill: 'stab',
      weapon2_trauma: 'd6/x3', weapon2_shock: '1/99', weapon2_atk: 0,
    });
    await seedAttackerToken();
    const target = await run(db,
      `INSERT INTO locations (name, x, y, z, shape, owner, melee_ac, ranged_ac, hp_current, hp_max)
       VALUES ('Punk', 0, 0, 0, 'enemy_rhombus', 'SYSTEM', 3, 1, 30, 30)`);
    const { handlers, emitted } = boot(db);
    handlers['identify']('GHOST');
    await flush(50);

    handlers['sheetAttack']({ targetId: target.lastID, weaponIndex: 1 }); // Shoot
    await waitFor(() => emitted.some(e => e.event === 'attackResult'));
    expect(emitted.find(e => e.event === 'attackResult').data.ac).toBe(1);

    const melee = emitted.length;
    handlers['sheetAttack']({ targetId: target.lastID, weaponIndex: 2 }); // Stab
    await waitFor(() => emitted.slice(melee).some(e => e.event === 'attackResult'));
    expect(emitted.slice(melee).find(e => e.event === 'attackResult').data.ac).toBe(3);
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

describe('CWN Deluxe castSpell', () => {
  const MAGE = {
    mage_effort: 3, mage_effort_max: 3,
    spell1_name: 'Flickerflash', spell1_effect: 'Blinding burst', spell1_dmg: '2d6', spell1_cost: 1,
    spell2_name: 'The Unseen Hand', spell2_effect: 'Telekinesis', spell2_dmg: '', spell2_cost: 2,
  };
  const seedMage = (data = MAGE) =>
    run(db, `INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('GHOST', 'cities_without_number', ?, 0)`,
      [JSON.stringify(data)]);

  it('rolls damage, spends effort, and broadcasts the effect', async () => {
    await run(db, `INSERT INTO global_settings (key, value) VALUES ('cwn_deluxe', '1')`);
    await seedMage();
    const { handlers, emitted } = boot(db);
    handlers['identify']('GHOST');
    await flush(50);

    handlers['castSpell']({ index: 1 });
    await waitFor(() => emitted.some(e => e.event === 'spellCast'));

    const roll = emitted.find(e => e.event === 'diceRollBroadcast');
    expect(roll.data.historyString).toContain('casts Flickerflash (1 EFFORT)');
    expect(roll.data.historyString).toContain('Blinding burst');
    expect(roll.data.historyString).toContain('damage');
    expect(roll.data.historyString).not.toContain('OVERCAST');
    const sheet = await get(db, `SELECT data FROM character_sheets WHERE username = 'GHOST'`);
    expect(JSON.parse(sheet.data).mage_effort).toBe(2);
  });

  it('casts a utility spell without dice', async () => {
    await run(db, `INSERT INTO global_settings (key, value) VALUES ('cwn_deluxe', '1')`);
    await seedMage();
    const { handlers, emitted } = boot(db);
    handlers['identify']('GHOST');
    await flush(50);

    handlers['castSpell']({ index: 2 });
    await waitFor(() => emitted.some(e => e.event === 'spellCast'));
    const roll = emitted.find(e => e.event === 'diceRollBroadcast');
    expect(roll.data.historyString).toContain('The Unseen Hand (2 EFFORT)');
    expect(roll.data.historyString).not.toContain('damage');
  });

  it('flags an OVERCAST when effort is insufficient and floors the pool at 0', async () => {
    await run(db, `INSERT INTO global_settings (key, value) VALUES ('cwn_deluxe', '1')`);
    await seedMage({ ...MAGE, mage_effort: 0 });
    const { handlers, emitted } = boot(db);
    handlers['identify']('GHOST');
    await flush(50);

    handlers['castSpell']({ index: 1 });
    await waitFor(() => emitted.some(e => e.event === 'spellCast'));
    const roll = emitted.find(e => e.event === 'diceRollBroadcast');
    expect(roll.data.historyString).toContain('OVERCAST');
    const sheet = await get(db, `SELECT data FROM character_sheets WHERE username = 'GHOST'`);
    expect(JSON.parse(sheet.data).mage_effort).toBe(0);
  });

  it('refuses while the Deluxe house rule is off', async () => {
    await seedMage();
    const { handlers, emitted } = boot(db);
    handlers['identify']('GHOST');
    await flush(50);

    handlers['castSpell']({ index: 1 });
    await flush(200);
    expect(emitted.some(e => e.event === 'spellCast')).toBe(false);
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

describe('CWN Damage Soak through the socket', () => {
  // The resolver is tested on its own in cwn_attack.test.js. What matters here is the
  // wiring: that the pool is read off the defender's sheet, spent before hit points, and
  // written back so the next shot meets what this one left.
  const seedSoakTarget = async (soak, ac = 1, hp = 30) => {
    const target = await run(db,
      `INSERT INTO locations (name, x, y, z, shape, owner, melee_ac, ranged_ac, hp_current, hp_max)
       VALUES ('Punk', 0, 0, 0, 'enemy_rhombus', 'SYSTEM', ?, ?, ?, ?)`, [ac, ac, hp, hp]);
    const sheet = await run(db,
      `INSERT INTO character_sheets (username, system, is_npc, data) VALUES ('punk', 'cities_without_number', 1, ?)`,
      [JSON.stringify({ name: 'Punk', soak_current: soak, armor_soak: soak })]);
    await run(db, `INSERT INTO npc_sheet_links (location_id, sheet_id) VALUES (?, ?)`,
      [target.lastID, sheet.lastID]);
    return { targetId: target.lastID, sheetId: sheet.lastID };
  };

  const attack = async (targetId) => {
    const { handlers, emitted } = boot(db);
    handlers['identify']('GHOST');
    await flush(50);
    handlers['sheetAttack']({ targetId, weaponIndex: 1 });
    await waitFor(() => emitted.some(e => e.event === 'attackResult'));
    return emitted.find(e => e.event === 'attackResult').data;
  };

  const soakOf = async (sheetId) =>
    JSON.parse((await get(db, `SELECT data FROM character_sheets WHERE id = ?`, [sheetId])).data).soak_current;

  it('spends soak before hit points, and reports both', async () => {
    await seedAttacker();
    await seedAttackerToken();
    // A pool far larger than any one hit, so the armour certainly holds.
    const { targetId, sheetId } = await seedSoakTarget(50);
    const res = await attack(targetId);

    expect(res.hit).toBe(true);
    expect(res.soakAbsorbed).toBe(res.damage);
    expect(res.through).toBe(0);

    const token = await get(db, `SELECT hp_current FROM locations WHERE id = ?`, [targetId]);
    expect(token.hp_current).toBe(30);
    expect(await soakOf(sheetId)).toBe(50 - res.damage);
  });

  it('lets the overflow through to hit points', async () => {
    await seedAttacker();
    await seedAttackerToken();
    const { targetId, sheetId } = await seedSoakTarget(1);
    const res = await attack(targetId);

    expect(res.soakAbsorbed).toBe(1);
    expect(res.through).toBe(res.damage - 1);
    const token = await get(db, `SELECT hp_current FROM locations WHERE id = ?`, [targetId]);
    expect(token.hp_current).toBe(30 - (res.damage - 1));
    expect(await soakOf(sheetId)).toBe(0);
  });

  it('says so in the roll history', async () => {
    await seedAttacker();
    await seedAttackerToken();
    const { targetId } = await seedSoakTarget(50);
    const { handlers, emitted } = boot(db);
    handlers['identify']('GHOST');
    await flush(50);
    handlers['sheetAttack']({ targetId, weaponIndex: 1 });
    await waitFor(() => emitted.some(e => e.event === 'attackResult'));

    const line = emitted.filter(e => e.event === 'diceRollBroadcast')
      .map(e => e.data.historyString).find(h => h.includes('SOAK'));
    expect(line).toMatch(/SOAK \d+ absorbed/);
    expect(line).toMatch(/ARMOR HELD/);
  });

  it('takes a second hit out of what the first one left', async () => {
    // The reason the pool is written back rather than recomputed from the armour.
    await seedAttacker();
    await seedAttackerToken();
    const { targetId, sheetId } = await seedSoakTarget(50);
    const first = await attack(targetId);
    const afterFirst = await soakOf(sheetId);
    const second = await attack(targetId);

    expect(afterFirst).toBe(50 - first.damage);
    expect(await soakOf(sheetId)).toBe(50 - first.damage - second.soakAbsorbed);
  });

  it('behaves exactly as before for a target with no soak', async () => {
    // The regression that matters: every existing CWN character has no soak field yet.
    await seedAttacker();
    await seedAttackerToken();
    const { targetId, sheetId } = await seedSoakTarget(0);
    const res = await attack(targetId);

    expect(res.soakAbsorbed).toBe(0);
    expect(res.through).toBe(res.damage);
    const token = await get(db, `SELECT hp_current FROM locations WHERE id = ?`, [targetId]);
    expect(token.hp_current).toBe(30 - res.damage);
    expect(await soakOf(sheetId)).toBe(0);
  });
});

describe('CWN weapon attribute through the socket', () => {
  /**
   * A Mortar is the case the old code could not express: the book gives it Wis, and the
   * app derived the attribute from the attack skill, which for a Shoot weapon is Dex.
   * Resolved end to end here rather than only in the pure function, since the sheet is
   * where the field actually lives.
   */
  // Wis 0 against Dex +5, and a 1d2 so the dice cannot bridge the gap: damage of 1-2 can
  // only have come from Wis, and 6-7 only from Dex. The attribute is the whole difference.
  const MORTAR = {
    base_hit_bonus: 20, shoot: 0, dex_mod: 5, wis_mod: 0, str_mod: 0,
    weapon1_name: 'Mortar', weapon1_dmg: '1d2', weapon1_skill: 'shoot',
    weapon1_attr: 'wis', weapon1_trauma: '', weapon1_shock: '', weapon1_atk: 0,
  };

  const fire = async (sheet, ac) => {
    await run(db, `INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('GHOST', 'cities_without_number', ?, 0)`,
      [JSON.stringify(sheet)]);
    await seedAttackerToken();
    const target = await seedTarget(ac);
    const { handlers, emitted } = boot(db);
    handlers['identify']('GHOST');
    await flush(50);
    handlers['sheetAttack']({ targetId: target.lastID, weaponIndex: 1 });
    await waitFor(() => emitted.some(e => e.event === 'attackResult'));
    return emitted.find(e => e.event === 'attackResult').data;
  };

  it('rolls the weapon attribute, not the one its skill implies', async () => {
    const res = await fire(MORTAR, 1);
    expect(res.hit).toBe(true);
    expect(res.damage).toBeGreaterThanOrEqual(1);
    expect(res.damage).toBeLessThanOrEqual(2); // Wis 0. On the skill's Dex it would be 6-7.
  });

  it('leaves a weapon that names no attribute on the skill default', async () => {
    // The regression that matters: every weapon on every sheet written before the column.
    const res = await fire({ ...MORTAR, weapon1_attr: '' }, 1);
    expect(res.damage).toBeGreaterThanOrEqual(6); // 1d2 + dex 5
    expect(res.damage).toBeLessThanOrEqual(7);
  });

  it('rolls no attribute at all for a weapon that has none', async () => {
    const res = await fire({ ...MORTAR, weapon1_attr: 'none' }, 1);
    expect(res.damage).toBeGreaterThanOrEqual(1);
    expect(res.damage).toBeLessThanOrEqual(2);
  });

  it('takes the better of a pair off the sheet it is read against', async () => {
    const knife = {
      ...MORTAR, weapon1_name: 'Knife', weapon1_skill: 'stab', weapon1_attr: 'str_dex',
      str_mod: 0, dex_mod: 5, stab: 0,
    };
    const res = await fire(knife, 1);
    // Stab alone would mean Str 0. The pair reaches for the Dex instead.
    expect(res.damage).toBeGreaterThanOrEqual(6);
    expect(res.damage).toBeLessThanOrEqual(7);
  });
});

describe('CWN gear mods through the socket', () => {
  /**
   * The mods have to reach a real attack, not just the resolver. Same weapon, same
   * target, with and without the mod fitted - and stripping it takes the bonus back,
   * which is the whole reason they are overlaid rather than written into the row.
   */
  const GUN = {
    base_hit_bonus: 20, shoot: 0, dex_mod: 0,
    // No trauma die: a traumatic hit multiplies the damage by three, which would swamp
    // the two-point window these tests read the mod out of.
    weapon1_name: 'Heavy Pistol', weapon1_dmg: '1d2', weapon1_skill: 'shoot',
    weapon1_trauma: '', weapon1_shock: '', weapon1_atk: 0,
  };

  const fire = async (sheet) => {
    await run(db, `INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('GHOST', 'cities_without_number', ?, 0)`,
      [JSON.stringify(sheet)]);
    await seedAttackerToken();
    const target = await seedTarget(1);
    const { handlers, emitted } = boot(db);
    handlers['identify']('GHOST');
    await flush(50);
    handlers['sheetAttack']({ targetId: target.lastID, weaponIndex: 1 });
    await waitFor(() => emitted.some(e => e.event === 'attackResult'));
    return emitted.find(e => e.event === 'attackResult').data;
  };

  it('adds a fitted damage mod to the damage that lands', async () => {
    // 1d2 is 1-2 bare, and 3-4 with Integral Toxins' +2. The ranges cannot overlap.
    const res = await fire({ ...GUN, weapon1_mods: JSON.stringify(['integral_toxins']) });
    expect(res.damage).toBeGreaterThanOrEqual(3);
    expect(res.damage).toBeLessThanOrEqual(4);
  });

  it('gives back exactly what it was when the mod comes off', async () => {
    const res = await fire({ ...GUN, weapon1_mods: JSON.stringify([]) });
    expect(res.damage).toBeGreaterThanOrEqual(1);
    expect(res.damage).toBeLessThanOrEqual(2);
  });

  it('leaves a sheet with no mods field at all alone', async () => {
    // Every CWN weapon on every sheet written before this existed.
    const res = await fire(GUN);
    expect(res.damage).toBeGreaterThanOrEqual(1);
    expect(res.damage).toBeLessThanOrEqual(2);
  });

  it('drives the token AC through an armor mod', async () => {
    await run(db, `INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('GHOST', 'cities_without_number', ?, 0)`,
      [JSON.stringify({ dex: 10, armor_ac: 13, armor_ac_melee: 14 })]);
    await run(db, `INSERT INTO locations (name, x, y, z, shape, owner, melee_ac, ranged_ac, hp_current, hp_max) VALUES ('GHOST', 0, 0, 0, 'rhombus', 'GHOST', 10, 10, 20, 20)`);
    const { handlers, emitted } = boot(db);
    handlers['identify']('GHOST');
    await flush(50);

    handlers['updateSheetField']({ fieldId: 'armor_mods', value: JSON.stringify(['customized_armor']) });
    await waitFor(() => emitted.some(e => e.event === 'sheetUpdated'));
    await flush(50);

    const token = await get(db, `SELECT melee_ac, ranged_ac FROM locations WHERE owner = 'GHOST'`);
    expect(token.ranged_ac).toBe(14); // 13 + 1
    expect(token.melee_ac).toBe(15);  // 14 + 1
  });

  it('recomputes the soak pool when a mod is fitted', async () => {
    await run(db, `INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('GHOST', 'cities_without_number', ?, 0)`,
      [JSON.stringify({ con: 10, armor_soak: 8 })]);
    await run(db, `INSERT INTO locations (name, x, y, z, shape, owner, hp_current, hp_max) VALUES ('GHOST', 0, 0, 0, 'rhombus', 'GHOST', 20, 20)`);
    const { handlers, emitted } = boot(db);
    handlers['identify']('GHOST');
    await flush(50);

    handlers['updateSheetField']({ fieldId: 'armor_mods', value: JSON.stringify(['absorption_pads']) });
    await waitFor(() => emitted.some(e => e.event === 'sheetUpdated'));
    await flush(50);

    const sheet = await get(db, `SELECT data FROM character_sheets WHERE username = 'GHOST'`);
    expect(JSON.parse(sheet.data).armor_soak_total).toBe(13);
  });
});

describe('attacking with cyberware', () => {
  /**
   * The wiring. Body weaponry is resolved from installed chrome rather than a weapon row,
   * so sheetAttack names it separately - and the whole point is that the implant's own
   * dice reach the roll, not the attacker's weapon rows.
   */
  const withBlades = (name, over = {}) => ({
    base_hit_bonus: 30, stab: 0, punch: 0, str_mod: 0, dex_mod: 0,
    // A weapon row that is obviously not the one we asked for, so a mix-up is visible in
    // the damage rather than silent.
    weapon1_name: 'Pistol', weapon1_dmg: '1d2', weapon1_skill: 'shoot', weapon1_trauma: '', weapon1_atk: 0,
    cyberware: [{ name, type: 'limb', side: null, placed: true, equipped: true, hl: 1, mods: [] }],
    ...over,
  });

  const fire = async (sheet, payload) => {
    // Trauma off. A cyber weapon's trauma die is intrinsic and cannot be blanked on the
    // sheet the way a weapon row's can, and a traumatic hit multiplies the damage by
    // three - which would put a 2d6 blade at up to 36 and make any range assertion here
    // a coin toss rather than a check.
    await run(db, `INSERT OR REPLACE INTO global_settings (key, value) VALUES ('cwn_trauma', '0')`);
    await run(db, `INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('GHOST', 'cities_without_number', ?, 0)`,
      [JSON.stringify(sheet)]);
    await seedAttackerToken();
    const target = await seedTarget(1);
    const { handlers, emitted } = boot(db);
    handlers['identify']('GHOST');
    await flush(50);
    handlers['sheetAttack']({ targetId: target.lastID, ...payload });
    await waitFor(() => emitted.some(e => e.event === 'attackResult' || e.event === 'sheetAttackError'));
    return emitted;
  };

  it('rolls the implant dice, not a weapon row', async () => {
    // Body Blades II is 2d6, so 2-12. The pistol row is 1d2. The ranges cannot overlap.
    const emitted = await fire(withBlades('Body Blades II'), { cyberIndex: 1 });
    const res = emitted.find(e => e.event === 'attackResult').data;
    expect(res.hit).toBe(true);
    expect(res.damage).toBeGreaterThanOrEqual(2);
    expect(res.damage).toBeLessThanOrEqual(12);
  });

  it('names the implant in the result', async () => {
    const emitted = await fire(withBlades('Body Blades I'), { cyberIndex: 1 });
    const roll = emitted.filter(e => e.event === 'diceRollBroadcast')
      .find(r => String(r.data.historyString).includes('Body Blades I'));
    expect(roll).toBeTruthy();
  });

  it('still fires an ordinary weapon row when no cyber weapon is named', async () => {
    // The regression that matters: every attack anyone was already making.
    const emitted = await fire(withBlades('Body Blades II'), { weaponIndex: 1 });
    const res = emitted.find(e => e.event === 'attackResult').data;
    expect(res.damage).toBeGreaterThanOrEqual(1);
    expect(res.damage).toBeLessThanOrEqual(2); // the 1d2 pistol
  });

  it('refuses an implant the character has not installed', async () => {
    const sheet = withBlades('Body Blades I');
    sheet.cyberware[0].placed = false;
    const emitted = await fire(sheet, { cyberIndex: 1 });
    const err = emitted.find(e => e.event === 'sheetAttackError');
    expect(err.data.message).toMatch(/NO_SUCH_CYBER_WEAPON/);
  });

  it('refuses an index that names nothing', async () => {
    const emitted = await fire(withBlades('Body Blades I'), { cyberIndex: 9 });
    expect(emitted.find(e => e.event === 'sheetAttackError')).toBeTruthy();
  });
});

describe('cyberware mods reach a real attack', () => {
  /**
   * The gap these close. The mod table was covered by unit tests against the pure
   * functions, which pass whether or not anything calls them - and two of the five turned
   * out to be calling nothing at all. These drive the whole path instead.
   *
   * Asserted against the TARGET'S HIT POINTS rather than the number in the result, because
   * the number that matters is the one that actually comes off the target. A mod that
   * reached the report but not the subtraction would pass a weaker test.
   */
  const armed = (mods, over = {}) => ({
    base_hit_bonus: 30, stab: 0, punch: 0, str_mod: 0, dex_mod: 0,
    cyberware: [{
      name: 'Body Blades II', type: 'limb', side: null, placed: true, equipped: true,
      hl: 2, mods: [], cyberMods: mods,
    }],
    ...over,
  });

  const HP = 40;

  /** One strike, returning what was reported and what the target actually lost. */
  const strike = async (sheet) => {
    // Trauma off, so this measures the mod rather than a multiplier. Monoblade makes
    // traumatic hits MORE likely - it adds to that roll - so leaving the house rule on
    // would let a modded blade hit harder overall, which is the trade the book describes
    // and the opposite of what these are checking.
    await run(db, `INSERT OR REPLACE INTO global_settings (key, value) VALUES ('cwn_trauma', '0')`);
    await run(db, `INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('GHOST', 'cities_without_number', ?, 0)`,
      [JSON.stringify(sheet)]);
    await seedAttackerToken();
    const target = await seedTarget(1, HP);
    const { handlers, emitted } = boot(db);
    handlers['identify']('GHOST');
    await flush(50);
    handlers['sheetAttack']({ targetId: target.lastID, cyberIndex: 1 });
    await waitFor(() => emitted.some(e => e.event === 'attackResult'));
    const res = emitted.find(e => e.event === 'attackResult').data;
    const token = await get(db, `SELECT hp_current FROM locations WHERE id = ?`, [target.lastID]);
    return { res, lost: HP - token.hp_current };
  };

  it('subtracts full Body Blades damage with no mod fitted', async () => {
    // Body Blades II is 2d6: 2 to 12 off the target, and the report agrees with the loss.
    const { res, lost } = await strike(armed([]));
    expect(res.hit).toBe(true);
    expect(lost).toBeGreaterThanOrEqual(2);
    expect(lost).toBeLessThanOrEqual(12);
    expect(lost).toBe(res.damage);
  });

  it('takes Monoblade off the hit points, not just off the report', async () => {
    // 2d6 less 2 is 0 to 10. The ranges only separate at the top, which is where this
    // asserts - and against the target's own hit points.
    const { res, lost } = await strike(armed(['monoblade']));
    expect(lost).toBeLessThanOrEqual(10);
    expect(lost).toBe(res.damage);
  });

  it('does not apply Monoblade to an implant it does not fit', async () => {
    // The fits check, driven end to end rather than through the pure function. A
    // Cyberlimb is not a blade, so the mod is inert and the blade beside it is untouched.
    const sheet = armed([]);
    sheet.cyberware.unshift({
      name: 'Cyberlimb', type: 'limb', side: null, placed: true, equipped: true,
      hl: 1, mods: [], cyberMods: ['monoblade'],
    });
    const { lost } = await strike(sheet);
    expect(lost).toBeGreaterThanOrEqual(2); // full 2d6, nothing taken off
  });

  it('reaches the token AC through Hardened Weave', async () => {
    // Not an attack, but the same question: does the mod reach the number the game uses.
    await run(db, `INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('GHOST', 'cities_without_number', ?, 0)`,
      [JSON.stringify({
        dex: 10,
        cyberware: [{
          name: 'Dermal Armor I', type: 'skin', side: null, placed: true, equipped: true,
          hl: 1, conc: 'medical', mods: [{ kind: 'note', target: 'Base AC', value: 16 }],
          cyberMods: ['hardened_weave'],
        }],
      })]);
    await run(db, `INSERT INTO locations (name, x, y, z, shape, owner, melee_ac, ranged_ac, hp_current, hp_max) VALUES ('GHOST', 0, 0, 0, 'rhombus', 'GHOST', 10, 10, 20, 20)`);
    const { handlers, emitted } = boot(db);
    handlers['identify']('GHOST');
    await flush(50);

    handlers['updateSheetField']({ fieldId: 'armor_name', value: 'nothing' });
    await waitFor(() => emitted.some(e => e.event === 'sheetUpdated'));
    await flush(50);

    const token = await get(db, `SELECT melee_ac, ranged_ac FROM locations WHERE owner = 'GHOST'`);
    expect(token.ranged_ac).toBe(18); // 16 implant + 2 weave
    expect(token.melee_ac).toBe(18);
  });
});
