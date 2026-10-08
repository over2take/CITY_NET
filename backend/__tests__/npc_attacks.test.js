/**
 * Attacking with an NPC (4b5b3b; asked for by the user 2026-10-07). The sheet attacks of CWN,
 * Shadowrun and Cyberpunk RED read the attacker's own sheet and token; given an NPC token they
 * use that NPC's sheet, wounds and position instead: the GM's for any NPC, a controller's for the
 * friendly NPC the GM gave them. The log names both ("Rex (Vex) attacks ...").
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
const resultOf = (c) => untilValue(() => c.emitted.find((e) => e.event === 'attackResult'), Boolean, { label: 'the attack result' }).then((e) => e.data);
const logs = (c) => c.emitted.filter((e) => e.event === 'diceRollBroadcast').map((e) => e.data.historyString);
const quiet = async (c) => { await drain(db); await drain(db); expect(c.emitted.filter((e) => e.event === 'attackResult')).toEqual([]); };

/** A token at (x, z), optionally with a linked NPC sheet for `system`. */
const token = async (name, shape, { x = 0, z = 0, controllers = null, owner = 'gm', ac = 1, hp = 20, sheet = null, system } = {}) => {
  const id = (await run(db, `INSERT INTO locations (name, x, y, z, shape, owner, controllers, hp_current, hp_max, melee_ac, ranged_ac)
    VALUES (?, ?, 0, ?, ?, ?, ?, ?, 20, ?, ?)`, [name, x, z, shape, owner, controllers, hp, ac, ac])).lastID;
  if (sheet) {
    const sid = (await run(db, `INSERT INTO character_sheets (username, system, data, is_npc, npc_label) VALUES ('gm', ?, ?, 1, ?)`,
      [system, JSON.stringify({ name, ...sheet }), name])).lastID;
    await run(db, 'INSERT INTO npc_sheet_links (location_id, sheet_id) VALUES (?, ?)', [id, sid]);
  }
  return id;
};
const VEX_ONLY = JSON.stringify({ all: false, users: ['vex'] });

beforeEach(async () => {
  db = await makeTestDb();
  await run(db, `CREATE TABLE IF NOT EXISTS dice_rolls (
    id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, total INTEGER, results TEXT, color TEXT, historyString TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)`);
});
const runSystem = (system) => run(db, `INSERT OR REPLACE INTO global_settings (key, value) VALUES ('game_system', ?)`, [system]);

describe('Cities Without Number', () => {
  const BITER = { base_hit_bonus: 30, stab: 1, str_mod: 1, weapon1_name: 'Bite', weapon1_dmg: '1d4', weapon1_skill: 'stab', weapon1_atk: 0 };

  beforeEach(() => runSystem('cities_without_number'));

  it('lets a controller attack with the friendly NPC, from where it stands, naming both', async () => {
    const rex = await token('Rex', 'friendly_rhombus', { x: 3, z: 4, controllers: VEX_ONLY, sheet: BITER, system: 'cities_without_number' });
    const ghoul = await token('Ghoul', 'enemy_rhombus', { x: 9, z: 9 });
    const vex = await connect('vex');
    vex.handlers.sheetAttack({ targetId: ghoul, weaponIndex: 1, location_id: rex });
    const result = await resultOf(vex);
    expect(result).toMatchObject({ hit: true, targetId: ghoul, attackerPos: { x: 3, z: 4 }, weaponName: 'Bite' });
    expect(logs(vex)[0]).toMatch(/^Rex \(vex\) attacks Ghoul with Bite \[/);
    expect((await get(db, 'SELECT hp_current FROM locations WHERE id = ?', [ghoul])).hp_current).toBeLessThan(20);
  });

  it('lets the GM attack with an enemy NPC', async () => {
    const ghoul = await token('Ghoul', 'enemy_rhombus', { x: 1, z: 2, sheet: BITER, system: 'cities_without_number' });
    const vexToken = await token('Vex', 'rhombus', { owner: 'vex' });
    const gm = await connect('gm', { admin: true });
    gm.handlers.sheetAttack({ targetId: vexToken, weaponIndex: 1, location_id: ghoul });
    expect(await resultOf(gm)).toMatchObject({ hit: true, attackerPos: { x: 1, z: 2 } });
    expect(logs(gm)[0]).toMatch(/^Ghoul \(/);
  });

  it('ignores a player attacking with an NPC that isn\'t theirs, or with an enemy', async () => {
    const rex = await token('Rex', 'friendly_rhombus', { controllers: VEX_ONLY, sheet: BITER, system: 'cities_without_number' });
    const ghoul = await token('Ghoul', 'enemy_rhombus', { controllers: JSON.stringify({ all: true, users: [] }), sheet: BITER, system: 'cities_without_number' });
    const target = await token('Target', 'enemy_rhombus');
    const ash = await connect('ash');
    ash.handlers.sheetAttack({ targetId: target, weaponIndex: 1, location_id: rex });
    await quiet(ash);
    const vex = await connect('vex');
    vex.handlers.sheetAttack({ targetId: target, weaponIndex: 1, location_id: ghoul });
    await quiet(vex);
  });
});

describe('Cyberpunk RED', () => {
  beforeEach(() => runSystem('cyberpunk_red'));

  it('rolls with the NPC\'s numbers and wounds, and spends the NPC\'s LUCK', async () => {
    const rex = await token('Rex', 'friendly_rhombus', {
      x: 5, z: 6, hp: 3, controllers: VEX_ONLY, system: 'cyberpunk_red',
      sheet: { ref: 8, handgun: 6, luck: 3, seriously_wounded: 10, weapon1_name: 'Gun', weapon1_dmg: '3d6', weapon1_skill: 'handgun' },
    });
    const target = await token('Target', 'enemy_rhombus', { ac: 2 });
    const vex = await connect('vex');
    vex.handlers.sheetAttack({ targetId: target, weaponIndex: 1, location_id: rex, luck: 2 });
    expect(await resultOf(vex)).toMatchObject({ attackerPos: { x: 5, z: 6 }, weaponName: 'Gun' });
    // Rex's own token is at 3 of 20, under his seriously-wounded line.
    expect(logs(vex)[0]).toMatch(/^Rex \(vex\) attacks Target with Gun \(LUCK \+2\) \(WOUNDED -2\)/);
    const luck = async () => JSON.parse((await get(db, `SELECT data FROM character_sheets WHERE npc_label = 'Rex'`)).data).luck;
    await untilValue(luck, (v) => v === 1, { label: 'LUCK spent' });
  });
});

describe('Shadowrun', () => {
  beforeEach(() => runSystem('shadowrun_6e'));

  it('rolls the NPC\'s pool and names it', async () => {
    const rex = await token('Rex', 'friendly_rhombus', {
      x: 7, z: 8, controllers: VEX_ONLY, system: 'shadowrun_6e',
      sheet: { agility: 30, firearms: 30, weapon1_name: 'Predator', weapon1_dv: '3P', weapon1_ar: 10, weapon1_skill: 'firearms', weapon1_atk: 0 },
    });
    const target = await token('Target', 'enemy_rhombus', { ac: 0 });
    const vex = await connect('vex');
    vex.handlers.sheetAttack({ targetId: target, weaponIndex: 1, location_id: rex });
    expect(await resultOf(vex)).toMatchObject({ hit: true, attackerPos: { x: 7, z: 8 }, weaponName: 'Predator' });
    expect(logs(vex)[0]).toMatch(/^Rex \(vex\) attacks Target with Predator/);
  });
});

describe('a player\'s own attack', () => {
  it('is unchanged: their sheet, their token, their name', async () => {
    await runSystem('cities_without_number');
    await run(db, `INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('vex', 'cities_without_number', ?, 0)`,
      [JSON.stringify({ base_hit_bonus: 30, stab: 1, weapon1_name: 'Knife', weapon1_dmg: '1d4', weapon1_skill: 'stab' })]);
    await token('vex', 'rhombus', { owner: 'vex', x: 2, z: 2 });
    const target = await token('Target', 'enemy_rhombus');
    const vex = await connect('vex');
    vex.handlers.sheetAttack({ targetId: target, weaponIndex: 1 });
    expect(await resultOf(vex)).toMatchObject({ weaponName: 'Knife', attackerPos: { x: 2, z: 2 } });
    expect(logs(vex)[0]).toMatch(/^vex attacks Target with Knife/);
  });
});
