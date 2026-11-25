/**
 * APPLY DAMAGE on a built-in game's GAME tab (8b5d; the user, 2026-11-25): AUTO, as the games always were, or OFF, a sheet
 * attack rolled and logged with what it would take and nothing on its target changed: hit points, CWN's soak and car, CP:R's
 * SP and shield. Its own setting, so a custom system's APPLY DAMAGE never reaches a built-in game.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeTestDb, get, run } from './helpers/testDb.js';
import { drain, until } from './helpers/until.js';

process.env.JWT_SECRET = 'test-secret';
process.env.DICE_ANIM_MS = '0';

const socketsFactory = (await import('../sockets/index.js')).default;

let db;
beforeEach(async () => {
  db = await makeTestDb();
  await run(db, `CREATE TABLE dice_rolls (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, total INTEGER,
    results TEXT, color TEXT, historyString TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  // Trauma multiplies CWN's damage on a die of its own; tested elsewhere.
  await run(db, `INSERT INTO global_settings (key, value) VALUES ('cwn_trauma', '0')`);
});

const setting = (key, value) => run(db, 'INSERT INTO global_settings (key, value) VALUES (?, ?)', [key, value]);
const playing = (system) => setting('game_system', system);
const OFF = () => setting('apply_damage_built_in', 'off');
const sheet = (username, system, data) => run(db, 'INSERT INTO character_sheets (username, system, data, is_npc) VALUES (?, ?, ?, 0)', [username, system, JSON.stringify(data)]);
const token = (owner, { hp = 30, ac = 1 } = {}) =>
  run(db, "INSERT INTO locations (name, x, y, z, shape, owner, melee_ac, ranged_ac, hp_current, hp_max, hp_temp) VALUES (?, 0, 0, 0, 'rhombus', ?, ?, ?, ?, ?, 3)", [owner, owner, ac, ac, hp, hp]);
const hpOf = (id) => get(db, 'SELECT hp_current, hp_temp FROM locations WHERE id = ?', [id]);
const sheetOf = async (username) => JSON.parse((await get(db, 'SELECT data FROM character_sheets WHERE username = ?', [username])).data);
const WOULD = / · NOT APPLIED: APPLY DAMAGE IS OFF · WOULD TAKE (\d+)$/;

/** GHOST attacks the token; what the server said and the log's lines. */
const attack = async (targetId) => {
  const emitted = [];
  const connects = [];
  socketsFactory({ on: (e, cb) => { if (e === 'connection') connects.push(cb); }, emit: (event, data) => emitted.push({ event, data }), to: () => ({ emit: () => {} }) },
    db, { elevatedUsers: new Set(), emitUpdate: vi.fn(), recordAction: vi.fn() });
  const handlers = {};
  const socket = { id: `apply-${Math.random()}`, on: (e, fn) => { handlers[e] = fn; }, emit: (event, data) => emitted.push({ event, data }), broadcast: { emit: () => {} }, use: () => {}, join: () => {} };
  for (const connect of connects) connect(socket);
  handlers.identify('GHOST');
  await drain(db);
  handlers.sheetAttack({ targetId, weaponIndex: 1 });
  const result = (await until(() => emitted.find((e) => e.event === 'attackResult'), { label: 'attackResult' })).data;
  await drain(db);
  return { result, rolls: emitted.filter((e) => e.event === 'diceRollBroadcast').map((e) => e.data) };
};

// BHB 30: every CWN to-hit beats AC 1 and none reaches AC 99; 1d6 + 1, so a hit is 2 to 7.
const CWN = { base_hit_bonus: 30, shoot: 1, dex_mod: 1, weapon1_name: 'Pistol', weapon1_dmg: '1d6', weapon1_skill: 'shoot', weapon1_shock: '2/99', weapon1_atk: 0 };

describe('CWN', () => {
  beforeEach(async () => {
    await playing('cities_without_number');
    await sheet('GHOST', 'cities_without_number', CWN);
    await token('GHOST');
  });

  it('AUTO, as always: the hit taken; a custom system\'s APPLY DAMAGE OFF never reaches it', async () => {
    await setting('apply_damage', 'off');
    await sheet('VICTIM', 'cities_without_number', {});
    const victim = await token('VICTIM', { hp: 30 });
    const { result, rolls } = await attack(victim.lastID);
    expect(result.through).toBeGreaterThan(0);
    expect(result.notApplied).toBeUndefined();
    // Temp HP first, as ever.
    expect(await hpOf(victim.lastID)).toEqual({ hp_current: 30 - Math.max(0, result.through - 3), hp_temp: Math.max(0, 3 - result.through) });
    expect(rolls[1].historyString).not.toMatch(/NOT APPLIED/);
  });

  it('OFF: the hit said with what it would take after soak; the token and its soak as they were, nothing of DOWN', async () => {
    await OFF();
    await sheet('VICTIM', 'cities_without_number', { soak_current: 1, frail: 1 });
    const victim = await token('VICTIM', { hp: 1 });
    const { result, rolls } = await attack(victim.lastID);
    const line = rolls[1].historyString;
    expect(line).toMatch(/^Pistol damage vs VICTIM \[.* = (\d+)\] — SOAK 1 absorbed, (\d+) through · NOT APPLIED: APPLY DAMAGE IS OFF · WOULD TAKE \2$/);
    const rolled = Number(/= (\d+)\]/.exec(line)[1]);
    expect(Number(WOULD.exec(line)[1])).toBe(rolled - 1);
    expect(line).not.toMatch(/soak left|MORTALLY|FRAIL|ARMOR HELD/);
    expect(rolls[1].board).toEqual({ label: 'DAMAGE', outcome: 'NOT APPLIED' });
    expect(result).toMatchObject({ hit: true, damage: rolled, through: rolled - 1, notApplied: true });
    expect(result).not.toHaveProperty('targetHp');
    expect(await hpOf(victim.lastID)).toEqual({ hp_current: 1, hp_temp: 3 });
    expect(await sheetOf('VICTIM')).toEqual({ soak_current: 1, frail: 1 });
  });

  it('OFF: a MISS\'s SHOCK said, not taken', async () => {
    await OFF();
    const victim = await token('VICTIM', { hp: 30, ac: 99 });
    const { result, rolls } = await attack(victim.lastID);
    expect(rolls.map((r) => r.board)).toEqual([{ label: 'TO HIT', outcome: 'MISS' }, { label: 'SHOCK', outcome: 'NOT APPLIED' }]);
    expect(rolls[1].historyString).toBe('Pistol SHOCK vs VICTIM — 3 damage on the miss · NOT APPLIED: APPLY DAMAGE IS OFF · WOULD TAKE 3');
    expect(result).toMatchObject({ hit: false, shock: 3, through: 3, notApplied: true });
    expect(await hpOf(victim.lastID)).toEqual({ hp_current: 30, hp_temp: 3 });
  });

  it('OFF: a hit on a car said through its AR, the car as it was', async () => {
    await OFF();
    const car = { vehicle1_name: 'Kestrel', vehicle1_hp_max: 100, vehicle1_armor: 3, vehicle1_ac: 12, in_vehicle: 'own:1' };
    await sheet('VICTIM', 'cities_without_number', car);
    const victim = await token('VICTIM');
    const { result, rolls } = await attack(victim.lastID);
    const [, rolled, through] = /= (\d+)\] — Kestrel: \1 − AR 3 = (\d+) · NOT APPLIED: APPLY DAMAGE IS OFF · WOULD TAKE \2$/.exec(rolls[1].historyString).map(Number);
    expect(through).toBe(Math.max(0, rolled - 3));
    expect(rolls[1].historyString).not.toMatch(/DESTROYED|ARMOR HELD|\/100/);
    expect(result).toMatchObject({ through, notApplied: true });
    expect(result).not.toHaveProperty('vehicleHp');
    expect(await sheetOf('VICTIM')).toEqual(car);
    expect(await hpOf(victim.lastID)).toEqual({ hp_current: 30, hp_temp: 3 });
  });
});

describe('CP:R', () => {
  it('OFF: what gets through said, the token, its SP and its shield as they were', async () => {
    await playing('cyberpunk_red');
    await OFF();
    await sheet('GHOST', 'cyberpunk_red', { ref: 30, handgun: 30, weapon1_name: 'Gun', weapon1_dmg: '3d6', weapon1_skill: 'handgun' });
    await token('GHOST');
    await sheet('VICTIM', 'cyberpunk_red', { sp_body: 1, sp_shield: 2 });
    const victim = await token('VICTIM', { hp: 99, ac: 10 });
    const { result, rolls } = await attack(victim.lastID);
    const line = rolls[1].historyString;
    // 3d6 is 3 or more: the shield takes its 2, the SP 1 of the rest.
    expect(line).toMatch(/^Gun damage vs VICTIM \[.*\] — SHIELD absorbs 2 — SP BODY 1 soaks 1(, \d+ DAMAGE THROUGH| — NO PENETRATION)/);
    expect(line).not.toMatch(/SHIELD DOWN|left\)|ABLATES/);
    expect(Number(WOULD.exec(line)[1])).toBe(result.through);
    expect(result.through).toBe(result.damage - 3 + (result.criticalInjury ? 5 : 0));
    expect(result).toMatchObject({ notApplied: true, ablated: false });
    expect(rolls[1].board).toEqual({ label: 'DAMAGE', outcome: result.criticalInjury ? 'CRITICAL INJURY' : 'NOT APPLIED' });
    expect(await hpOf(victim.lastID)).toEqual({ hp_current: 99, hp_temp: 3 });
    expect(await sheetOf('VICTIM')).toEqual({ sp_body: 1, sp_shield: 2 });
  });
});

describe('SR6', () => {
  it('OFF: the HIT\'s DV said as it would be taken, the token as it was', async () => {
    await playing('shadowrun_6e');
    await OFF();
    await sheet('GHOST', 'shadowrun_6e', { agility: 30, firearms: 30, weapon1_name: 'Predator', weapon1_dv: '3P', weapon1_ar: 10, weapon1_skill: 'firearms', weapon1_atk: 0 });
    await token('GHOST');
    await sheet('VICTIM', 'shadowrun_6e', { reaction: 1, intuition: 1 });
    const victim = await token('VICTIM');
    const { result, rolls } = await attack(victim.lastID);
    const line = rolls.find((r) => r.account === 'GHOST').historyString;
    expect(line).toMatch(new RegExp(`— HIT · ${result.damage}P .*· GM: soak BOD\\+ARMOR · NOT APPLIED: APPLY DAMAGE IS OFF · WOULD TAKE ${result.damage}$`));
    expect(result).toMatchObject({ hit: true, notApplied: true });
    expect(result.damage).toBeGreaterThan(0);
    expect(result).not.toHaveProperty('targetHp');
    expect(await hpOf(victim.lastID)).toEqual({ hp_current: 30, hp_temp: 3 });
  });
});
