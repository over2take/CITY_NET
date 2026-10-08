/**
 * Rolling from an NPC's sheet (4b5b3; asked for by the user 2026-10-07). Before this nobody could:
 * the sheet rolls and ability rolls read the roller's own character sheet. Now, given an NPC
 * token, the GM rolls from any NPC's sheet and a player from the friendly NPC the GM gave them,
 * the log naming the NPC ("Vex rolled Shoot for Rex"). Anyone else's request is ignored.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { makeTestDb, get, run } from './helpers/testDb.js';
import { drain, untilValue } from './helpers/until.js';

process.env.JWT_SECRET = 'test-secret';
process.env.DICE_ANIM_MS = '0';

const socketsFactory = (await import('../sockets/index.js')).default;
const GM = jwt.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, 'test-secret');

let db;
let rex;
let ghoul;

/** One connection as `who` (the GM when `admin`), with everything it and the room were sent. */
const connect = async (who, { admin = false } = {}) => {
  const emitted = [];
  let connection;
  const io = {
    on: (event, cb) => { if (event === 'connection') connection = cb; },
    emit: (event, data) => emitted.push({ event, data }),
    to: () => ({ emit: (event, data) => emitted.push({ event, data }) }),
  };
  socketsFactory(io, db, { elevatedUsers: new Set(), emitUpdate: vi.fn(), recordAction: vi.fn() });
  const handlers = {};
  connection({ id: `sock-${who}-${Math.random()}`, on: (e, fn) => { handlers[e] = fn; }, emit: (e, d) => emitted.push({ event: e, data: d, direct: true }),
    broadcast: { emit: () => {} }, use: () => {}, join: () => {}, disconnect: () => {} });
  handlers.identify(admin ? { userName: who, isAdmin: true, token: GM } : who);
  await drain(db);
  return { handlers, emitted };
};
const rolled = (c) => c.emitted.filter((e) => e.event === 'diceRollBroadcast');
const firstRoll = (c) => untilValue(() => rolled(c)[0], Boolean, { label: 'a roll' });

/** An NPC token with a CWN sheet: shoot 2, dex_mod 1, luck 2. */
const npc = async (name, shape, controllers) => {
  const loc = (await run(db, `INSERT INTO locations (name, x, y, z, shape, owner, controllers, hp_current, hp_max)
    VALUES (?, 0, 0, 0, ?, 'gm', ?, 8, 8)`, [name, shape, controllers])).lastID;
  const sheet = (await run(db, `INSERT INTO character_sheets (username, system, data, is_npc, npc_label) VALUES ('gm', 'cities_without_number', ?, 1, ?)`,
    [JSON.stringify({ name, shoot: 2, dex_mod: 1 }), name])).lastID;
  await run(db, 'INSERT INTO npc_sheet_links (location_id, sheet_id) VALUES (?, ?)', [loc, sheet]);
  return loc;
};

beforeEach(async () => {
  db = await makeTestDb();
  await run(db, `CREATE TABLE IF NOT EXISTS dice_rolls (
    id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, total INTEGER, results TEXT, color TEXT, historyString TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  await run(db, `INSERT INTO global_settings (key, value) VALUES ('game_system', 'cities_without_number')`);
  // Vex's own character, so a roll from her own sheet would be told apart from Rex's.
  await run(db, `INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('vex', 'cities_without_number', ?, 0)`,
    [JSON.stringify({ name: 'Vex', shoot: 0, dex_mod: 0 })]);
  rex = await npc('Rex', 'friendly_rhombus', JSON.stringify({ all: false, users: ['vex'] }));
  ghoul = await npc('Ghoul', 'enemy_rhombus', JSON.stringify({ all: true, users: ['vex'] }));
});

describe('a sheet roll for an NPC', () => {
  it('rolls from the sheet of the friendly NPC the GM gave the player, naming it', async () => {
    const vex = await connect('vex');
    vex.handlers.requestSheetRoll({ fieldId: 'shoot', location_id: rex });
    const roll = await firstRoll(vex);
    // 2d6 + shoot 2 + dex 1: Rex's numbers, not Vex's own. The roller is named as their own sheet names them.
    expect(roll.data.historyString).toMatch(/^Vex rolled .+ for Rex \[.+= \d+\]/);
    expect(roll.data.total).toBe(roll.data.results['6'].reduce((a, b) => a + b, 0) + 3);
    expect((await get(db, 'SELECT historyString FROM dice_rolls')).historyString).toContain('for Rex');
  });

  it('rolls from the player\'s own sheet without a token, as before', async () => {
    const vex = await connect('vex');
    vex.handlers.requestSheetRoll({ fieldId: 'shoot' });
    const roll = await firstRoll(vex);
    expect(roll.data.historyString).not.toContain(' for ');
    expect(roll.data.total).toBe(roll.data.results['6'].reduce((a, b) => a + b, 0));
  });

  it('lets the GM roll for any NPC, an enemy included', async () => {
    const gm = await connect('gm', { admin: true });
    gm.handlers.requestSheetRoll({ fieldId: 'shoot', location_id: ghoul });
    expect((await firstRoll(gm)).data.historyString).toContain('for Ghoul');
  });

  it('ignores a player rolling for an NPC that isn\'t theirs, or for an enemy', async () => {
    const ash = await connect('ash');
    ash.handlers.requestSheetRoll({ fieldId: 'shoot', location_id: rex });
    const vex = await connect('vex');
    vex.handlers.requestSheetRoll({ fieldId: 'shoot', location_id: ghoul });
    vex.handlers.requestSheetRoll({ fieldId: 'shoot', location_id: 'not a token' });
    vex.handlers.requestSheetRoll({ fieldId: 'shoot', location_id: 9999 });
    await drain(db);
    await drain(db);
    expect([rolled(ash), rolled(vex)]).toEqual([[], []]);
  });

  it('ignores an NPC with no sheet for the running system', async () => {
    const gm = await connect('gm', { admin: true });
    await run(db, `UPDATE global_settings SET value = 'cyberpunk_red' WHERE key = 'game_system'`);
    gm.handlers.requestSheetRoll({ fieldId: 'handgun', location_id: rex });
    await drain(db);
    await drain(db);
    expect(rolled(gm)).toEqual([]);
  });
});

describe('an ability roll for an NPC', () => {
  it('reads the NPC\'s numbers for its controller, naming it', async () => {
    const vex = await connect('vex');
    vex.handlers.rollAbility({ formula: '1d6 + @shoot', label: 'Bite', location_id: rex });
    const roll = await firstRoll(vex);
    expect(roll.data.historyString).toMatch(/^Vex rolled Bite for Rex \[/);
    expect(roll.data.total).toBe(roll.data.results['6'][0] + 2);
  });

  it('is ignored for another player, and the GM may roll it for an enemy', async () => {
    const ash = await connect('ash');
    ash.handlers.rollAbility({ formula: '1d6', label: 'Bite', location_id: rex });
    await drain(db);
    await drain(db);
    expect(rolled(ash)).toEqual([]);
    const gm = await connect('gm', { admin: true });
    gm.handlers.rollAbility({ formula: '1d6 + @shoot', label: 'Claw', location_id: ghoul });
    expect((await firstRoll(gm)).data.historyString).toMatch(/rolled Claw for Ghoul/);
  });
});
