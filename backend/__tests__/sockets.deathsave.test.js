/**
 * Integration tests for the requestDeathSave and sheetAttack socket handlers,
 * booting the real sockets module against an in-memory DB.
 *
 * Regression focus: the death save must be rollable repeatedly (one per
 * combat round) with the penalty escalating each attempt.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { makeTestDb, get, run } from './helpers/testDb.js';

process.env.JWT_SECRET = 'test-secret';
process.env.DICE_ANIM_MS = '0'; // skip the 5s dice-animation delay on outcome writes

const socketsFactory = (await import('../sockets/index.js')).default;

const flush = (ms = 25) => new Promise((r) => setTimeout(r, ms));

// Poll until cond() is true (async socket handlers under parallel test load
// can take longer than a fixed tick).
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
  await run(db, `INSERT INTO global_settings (key, value) VALUES ('game_system', 'cyberpunk_red')`);
});

const setupDyingPlayer = async (penalty) => {
  const data = { body: 6, ...(penalty !== undefined ? { death_save_penalty: penalty } : {}) };
  await run(db,
    `INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('GHOST', 'cyberpunk_red', ?, 0)`,
    [JSON.stringify(data)]);
  await run(db,
    `INSERT INTO locations (name, x, y, z, shape, owner, hp_current, hp_max) VALUES ('GHOST', 0, 0, 0, 'rhombus', 'GHOST', 0, 20)`);
};

describe('requestDeathSave', () => {
  it('rolls, escalates the penalty, and can be rolled again', async () => {
    await setupDyingPlayer();
    const { handlers, emitted } = boot(db);
    handlers['identify']('GHOST');
    await flush(50);

    handlers['requestDeathSave']();
    await waitFor(() => emitted.some(e => e.event === 'deathSaveResult'));
    const first = emitted.filter(e => e.event === 'deathSaveResult');
    expect(first).toHaveLength(1);
    expect(first[0].data.penalty).toBe(0);

    let sheet = await get(db, `SELECT data FROM character_sheets WHERE username = 'GHOST'`);
    expect(JSON.parse(sheet.data).death_save_penalty).toBe(1);

    // Second round: must roll again with the escalated penalty
    handlers['requestDeathSave']();
    await waitFor(() => emitted.filter(e => e.event === 'deathSaveResult').length >= 2);
    const both = emitted.filter(e => e.event === 'deathSaveResult');
    expect(both).toHaveLength(2);
    expect(both[1].data.penalty).toBe(1);

    sheet = await get(db, `SELECT data FROM character_sheets WHERE username = 'GHOST'`);
    expect(JSON.parse(sheet.data).death_save_penalty).toBe(2);
  });

  it('broadcasts a dice roll for each save', async () => {
    await setupDyingPlayer();
    const { handlers, emitted } = boot(db);
    handlers['identify']('GHOST');
    await flush(50);

    handlers['requestDeathSave']();
    handlers['requestDeathSave']();
    await waitFor(() => emitted.filter(e => e.event === 'diceRollBroadcast').length >= 2);
    const rolls = emitted.filter(e => e.event === 'diceRollBroadcast');
    expect(rolls).toHaveLength(2);
    expect(rolls[0].data.historyString).toContain('DEATH SAVE');
  });

  it('refuses when HP is above 0', async () => {
    await run(db,
      `INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('GHOST', 'cyberpunk_red', '{"body":6}', 0)`);
    await run(db,
      `INSERT INTO locations (name, x, y, z, shape, owner, hp_current, hp_max) VALUES ('GHOST', 0, 0, 0, 'rhombus', 'GHOST', 5, 20)`);
    const { handlers, emitted } = boot(db);
    handlers['identify']('GHOST');
    await flush(50);

    handlers['requestDeathSave']();
    await flush(150);
    expect(emitted.filter(e => e.event === 'deathSaveResult')).toHaveLength(0);
  });
});

describe('sheetAttack vs NPC token', () => {
  it('uses the linked NPC sheet SP even when the enemy token has an owner', async () => {
    // Attacker with a valid weapon
    await run(db,
      `INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('GHOST', 'cyberpunk_red', ?, 0)`,
      [JSON.stringify({ ref: 8, handgun: 6, weapon1_name: 'Gun', weapon1_dmg: '3d6', weapon1_skill: 'handgun' })]);
    await run(db,
      `INSERT INTO locations (name, x, y, z, shape, owner, hp_current, hp_max) VALUES ('GHOST', 0, 0, 0, 'rhombus', 'GHOST', 20, 20)`);
    // Enemy token with owner set (the generator stamps one) + linked NPC sheet with SP 6
    const loc = await run(db,
      `INSERT INTO locations (name, x, y, z, shape, owner, melee_ac, ranged_ac, hp_current, hp_max) VALUES ('Guy', 0, 0, 0, 'enemy_rhombus', 'SYSTEM', 10, 10, 15, 15)`);
    const npc = await run(db,
      `INSERT INTO character_sheets (username, system, data, is_npc, npc_label) VALUES ('admin', 'cyberpunk_red', ?, 1, 'Guy')`,
      [JSON.stringify({ sp_body: 6, sp_body_max: 6 })]);
    await run(db, `INSERT INTO npc_sheet_links (location_id, sheet_id) VALUES (?, ?)`, [loc.lastID, npc.lastID]);

    const { handlers, emitted } = boot(db);
    handlers['identify']('GHOST');
    await flush(50);
    handlers['sheetAttack']({ targetId: loc.lastID, weaponIndex: 1 });
    await waitFor(() => emitted.some(e => e.event === 'attackResult'));

    const result = emitted.find(e => e.event === 'attackResult');
    expect(result).toBeTruthy();
    if (result.data.hit) {
      // SP 6 must have soaked - never 0
      expect(result.data.sp).toBe(6);
      // Ablation only when damage got through
      const sheet = await get(db, `SELECT data FROM character_sheets WHERE id = ?`, [npc.lastID]);
      const sp = JSON.parse(sheet.data).sp_body;
      expect(sp).toBe(result.data.through > 0 ? 5 : 6);
    }
  });
});

describe('importSheetFields', () => {
  it('bulk-applies fields, refuses linked ones, and recomputes derived EMP', async () => {
    await run(db,
      `INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('GHOST', 'cyberpunk_red', '{}', 0)`);
    const { handlers, emitted } = boot(db);
    handlers['identify']('GHOST');
    await flush(50);

    handlers['importSheetFields']({ fields: { ref: 7, handgun: 5, humanity: 42, hp: 99 } });
    await waitFor(() => emitted.some(e => e.event === 'sheetImportApplied'));

    const row = await get(db, `SELECT data FROM character_sheets WHERE username = 'GHOST'`);
    const data = JSON.parse(row.data);
    expect(data.ref).toBe(7);
    expect(data.handgun).toBe(5);
    expect(data.humanity).toBe(42);
    expect(data.emp).toBe(4);        // derived from humanity
    expect(data.hp).toBeUndefined(); // linked - refused
    expect(emitted.some(e => e.event === 'sheetUpdated')).toBe(true);
  });
});

describe('generateNpcSheet with tier', () => {
  it('seeds the sheet from the tier package and tunes the token HP/DV', async () => {
    await run(db,
      `INSERT INTO locations (name, x, y, z, shape, owner, hp_current, hp_max) VALUES ('Guy', 0, 0, 0, 'enemy_rhombus', 'SYSTEM', 5, 5)`);
    const loc = await get(db, `SELECT id FROM locations WHERE name = 'Guy'`);
    const { handlers, emitted } = boot(db);
    handlers['identify']({ userName: 'admin', isAdmin: true, token: jwt.sign({ username: 'admin', isTemporary: false }, 'test-secret') });
    await flush(50);

    handlers['generateNpcSheet']({ location_id: loc.id, tier: 'elite' });
    await waitFor(() => emitted.some(e => e.event === 'npcSheetGenerated'));

    const evt = emitted.find(e => e.event === 'npcSheetGenerated');
    expect(evt.data.tier).toBe('elite');
    const sheet = await get(db, `SELECT data FROM character_sheets WHERE id = ?`, [evt.data.sheet_id]);
    const data = JSON.parse(sheet.data);
    expect(data.ref).toBe(8);
    expect(data.weapon1_dmg).toBe('5d6');
    const token = await get(db, `SELECT hp_current, hp_max, melee_ac, ranged_ac FROM locations WHERE id = ?`, [loc.id]);
    expect(token.hp_max).toBe(45);
    expect(token.melee_ac).toBe(20); // 6 + DEX 8 + Evasion 6 from the sheet
    expect(token.ranged_ac).toBe(15);
  });
});

describe('requestSheetRoll with LUCK', () => {
  it('adds the declared LUCK, caps it at current, and decrements the pool', async () => {
    await run(db,
      `INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('GHOST', 'cyberpunk_red', '{"ref":7,"luck":2,"luck_max":5}', 0)`);
    await run(db,
      `INSERT INTO locations (name, x, y, z, shape, owner, hp_current, hp_max) VALUES ('GHOST', 0, 0, 0, 'rhombus', 'GHOST', 20, 20)`);
    const { handlers, emitted } = boot(db);
    handlers['identify']('GHOST');
    await flush(50);

    // Declares 5 but only has 2 - server caps at 2
    handlers['requestSheetRoll']({ fieldId: 'ref', luck: 5 });
    await waitFor(() => emitted.some(e => e.event === 'diceRollBroadcast'));

    const roll = emitted.find(e => e.event === 'diceRollBroadcast');
    expect(roll.data.historyString).toContain('(LUCK +2)');
    const sheet = await get(db, `SELECT data FROM character_sheets WHERE username = 'GHOST'`);
    expect(JSON.parse(sheet.data).luck).toBe(0);
  });

  it('rolls without LUCK leave the pool alone', async () => {
    await run(db,
      `INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('GHOST', 'cyberpunk_red', '{"ref":7,"luck":3}', 0)`);
    await run(db,
      `INSERT INTO locations (name, x, y, z, shape, owner, hp_current, hp_max) VALUES ('GHOST', 0, 0, 0, 'rhombus', 'GHOST', 20, 20)`);
    const { handlers, emitted } = boot(db);
    handlers['identify']('GHOST');
    await flush(50);

    handlers['requestSheetRoll']({ fieldId: 'ref' });
    await waitFor(() => emitted.some(e => e.event === 'diceRollBroadcast'));
    const sheet = await get(db, `SELECT data FROM character_sheets WHERE username = 'GHOST'`);
    expect(JSON.parse(sheet.data).luck).toBe(3);
  });

  it('tags wounded rolls in the history', async () => {
    await run(db,
      `INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('GHOST', 'cyberpunk_red', '{"ref":7,"seriously_wounded":10}', 0)`);
    await run(db,
      `INSERT INTO locations (name, x, y, z, shape, owner, hp_current, hp_max) VALUES ('GHOST', 0, 0, 0, 'rhombus', 'GHOST', 8, 20)`);
    const { handlers, emitted } = boot(db);
    handlers['identify']('GHOST');
    await flush(50);

    handlers['requestSheetRoll']({ fieldId: 'ref' });
    await waitFor(() => emitted.some(e => e.event === 'diceRollBroadcast'));
    const roll = emitted.find(e => e.event === 'diceRollBroadcast');
    expect(roll.data.historyString).toContain('(WOUNDED -2)');
  });
});

describe('LUCK fumble shield', () => {
  it('luckNegate burns 1 extra LUCK and tags the roll (house rule on)', async () => {
    await run(db, `INSERT INTO global_settings (key, value) VALUES ('luck_negates_fumble', '1')`);
    await run(db,
      `INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('GHOST', 'cyberpunk_red', '{"ref":7,"luck":3}', 0)`);
    await run(db,
      `INSERT INTO locations (name, x, y, z, shape, owner, hp_current, hp_max) VALUES ('GHOST', 0, 0, 0, 'rhombus', 'GHOST', 20, 20)`);
    const { handlers, emitted } = boot(db);
    handlers['identify']('GHOST');
    await flush(50);

    handlers['requestSheetRoll']({ fieldId: 'ref', luck: 1, luckNegate: true });
    await waitFor(() => emitted.some(e => e.event === 'diceRollBroadcast'));

    const roll = emitted.find(e => e.event === 'diceRollBroadcast');
    expect(roll.data.historyString).toContain('(LUCK +1)');
    expect(roll.data.historyString).toContain('(LUCK: FUMBLE SHIELD)');
    const sheet = await get(db, `SELECT data FROM character_sheets WHERE username = 'GHOST'`);
    expect(JSON.parse(sheet.data).luck).toBe(1); // 3 - (1 bonus + 1 shield)
  });
});


describe('LUCK fumble shield gated off', () => {
  it('luckNegate is ignored while the house rule is off: no burn, no tag', async () => {
    await run(db,
      `INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('GHOST', 'cyberpunk_red', '{"ref":7,"luck":3}', 0)`);
    await run(db,
      `INSERT INTO locations (name, x, y, z, shape, owner, hp_current, hp_max) VALUES ('GHOST', 0, 0, 0, 'rhombus', 'GHOST', 20, 20)`);
    const { handlers, emitted } = boot(db);
    handlers['identify']('GHOST');
    await flush(50);

    handlers['requestSheetRoll']({ fieldId: 'ref', luckNegate: true });
    await waitFor(() => emitted.some(e => e.event === 'diceRollBroadcast'));

    const roll = emitted.find(e => e.event === 'diceRollBroadcast');
    expect(roll.data.historyString).not.toContain('FUMBLE SHIELD');
    const sheet = await get(db, `SELECT data FROM character_sheets WHERE username = 'GHOST'`);
    expect(JSON.parse(sheet.data).luck).toBe(3); // nothing spent
  });
});
