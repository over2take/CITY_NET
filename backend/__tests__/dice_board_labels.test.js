/**
 * What the tray's board says of the built-in systems' rolls (6c4d2): what each was for and, where
 * the server decided, what it came to, in the log's own words. An attack's to-hit and damage are
 * one group, so the board can show TO HIT 15 / DAMAGE 7; a defender's dodge is theirs.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeTestDb, run } from './helpers/testDb.js';
import { drain, until } from './helpers/until.js';

process.env.JWT_SECRET = 'test-secret';
process.env.DICE_ANIM_MS = '0';

const socketsFactory = (await import('../sockets/index.js')).default;

let db;
beforeEach(async () => {
  db = await makeTestDb();
  await run(db, `CREATE TABLE dice_rolls (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, total INTEGER,
    results TEXT, color TEXT, historyString TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)`);
});

const playing = (system) => run(db, `INSERT INTO global_settings (key, value) VALUES ('game_system', ?)`, [system]);
const sheet = (username, system, data) => run(db, `INSERT INTO character_sheets (username, system, data, is_npc) VALUES (?, ?, ?, 0)`, [username, system, JSON.stringify(data)]);
const token = (owner, { hp = 20, ac = null, shape = 'rhombus', name = owner } = {}) =>
  run(db, `INSERT INTO locations (name, x, y, z, shape, owner, melee_ac, ranged_ac, hp_current, hp_max) VALUES (?, 0, 0, 0, ?, ?, ?, ?, ?, ?)`, [name, shape, owner, ac, ac, hp, hp]);
const enemy = (ac, hp = 30) => token('SYSTEM', { hp, ac, shape: 'enemy_rhombus', name: 'Punk' });

/** A player at the table, as GHOST unless named. */
const join = async (who = 'GHOST') => {
  const emitted = [];
  // Every connection handler, as a server calls each: initiative registers one of its own.
  const connects = [];
  socketsFactory({ on: (e, cb) => { if (e === 'connection') connects.push(cb); }, emit: (event, data) => emitted.push({ event, data }), to: () => ({ emit: () => {} }) },
    db, { elevatedUsers: new Set(), emitUpdate: vi.fn(), recordAction: vi.fn() });
  const handlers = {};
  const socket = { id: `board-${who}-${Math.random()}`, on: (e, fn) => { handlers[e] = fn; }, emit: (event, data) => emitted.push({ event, data }), broadcast: { emit: () => {} }, use: () => {}, join: () => {} };
  for (const connect of connects) connect(socket);
  handlers.identify(who);
  await drain(db);
  const rolls = () => emitted.filter((e) => e.event === 'diceRollBroadcast').map((e) => e.data);
  const heard = (event) => until(() => emitted.find((e) => e.event === event), { label: event });
  return { handlers, rolls, heard };
};

describe('an attack', () => {
  // BHB 30: any CWN to-hit beats AC 1 and none reaches AC 99.
  const CWN = { base_hit_bonus: 30, shoot: 1, dex_mod: 1, heal: 0, int_mod: 0, weapon1_name: 'Pistol', weapon1_dmg: '1d6', weapon1_skill: 'shoot', weapon1_trauma: 'd2/x2', weapon1_shock: '2/99', weapon1_atk: 0 };

  it('CWN: TO HIT and its HIT, then DAMAGE, one group', async () => {
    await playing('cities_without_number');
    await sheet('GHOST', 'cities_without_number', CWN);
    await token('GHOST');
    const target = await enemy(1);
    const t = await join();
    t.handlers.sheetAttack({ targetId: target.lastID, weaponIndex: 1 });
    await t.heard('attackResult');
    const [toHit, damage] = t.rolls();
    expect(toHit.board).toEqual({ label: 'TO HIT', outcome: 'HIT' });
    expect(damage.board).toEqual({ label: 'DAMAGE' });
    expect(damage.group).toBe(toHit.group);
  });

  it('CWN: a MISS, its SHOCK, and a hit that drops the target DOWN', async () => {
    await playing('cities_without_number');
    await sheet('GHOST', 'cities_without_number', CWN);
    await token('GHOST');
    const far = await enemy(99);
    const t = await join();
    t.handlers.sheetAttack({ targetId: far.lastID, weaponIndex: 1 });
    await t.heard('attackResult');
    expect(t.rolls().map((r) => r.board)).toEqual([{ label: 'TO HIT', outcome: 'MISS' }, { label: 'SHOCK' }]);

    const frail = await enemy(1, 1);
    const u = await join();
    u.handlers.sheetAttack({ targetId: frail.lastID, weaponIndex: 1 });
    await u.heard('attackResult');
    expect(u.rolls()[1].board).toEqual({ label: 'DAMAGE', outcome: 'DOWN' });
  });

  it('CWN: ARMOR HELD when soak takes it all', async () => {
    await playing('cities_without_number');
    await sheet('GHOST', 'cities_without_number', CWN);
    await token('GHOST');
    await sheet('VICTIM', 'cities_without_number', { soak_current: 50 });
    const victim = await token('VICTIM', { ac: 1 });
    const t = await join();
    t.handlers.sheetAttack({ targetId: victim.lastID, weaponIndex: 1 });
    await t.heard('attackResult');
    expect(t.rolls()[1].board).toEqual({ label: 'DAMAGE', outcome: 'ARMOR HELD' });
  });

  it('CP:R: TO HIT and its HIT, DAMAGE as the log ends it; a MISS alone', async () => {
    await playing('cyberpunk_red');
    await sheet('GHOST', 'cyberpunk_red', { ref: 30, handgun: 30, weapon1_name: 'Gun', weapon1_dmg: '3d6', weapon1_skill: 'handgun' });
    await token('GHOST');
    const near = await enemy(10, 99);
    const t = await join();
    t.handlers.sheetAttack({ targetId: near.lastID, weaponIndex: 1 });
    await t.heard('attackResult');
    const [toHit, damage] = t.rolls();
    expect(toHit.board).toEqual({ label: 'TO HIT', outcome: 'HIT' });
    // Two sixes make a critical injury, as the log says.
    expect(damage.board).toEqual(damage.historyString.includes('CRITICAL INJURY') ? { label: 'DAMAGE', outcome: 'CRITICAL INJURY' } : { label: 'DAMAGE' });
    expect(damage.group).toBe(toHit.group);

    const far = await enemy(999);
    const u = await join();
    u.handlers.sheetAttack({ targetId: far.lastID, weaponIndex: 1 });
    await u.heard('attackResult');
    expect(u.rolls().map((r) => r.board)).toEqual([{ label: 'TO HIT', outcome: 'MISS' }]);
  });

  it('SR6: the defender\'s DODGE is theirs, then the TO HIT and its HIT', async () => {
    await playing('shadowrun_6e');
    await sheet('GHOST', 'shadowrun_6e', { agility: 30, firearms: 30, weapon1_name: 'Predator', weapon1_dv: '3P', weapon1_ar: 10, weapon1_skill: 'firearms', weapon1_atk: 0 });
    await token('GHOST');
    await sheet('VICTIM', 'shadowrun_6e', { reaction: 1, intuition: 1 });
    const victim = await token('VICTIM', { ac: 1 });
    const t = await join();
    t.handlers.sheetAttack({ targetId: victim.lastID, weaponIndex: 1 });
    await t.heard('attackResult');
    const [dodge, toHit] = t.rolls();
    expect([dodge.account, dodge.board]).toEqual(['VICTIM', { label: 'DODGE' }]);
    expect([toHit.account, toHit.board]).toEqual(['GHOST', { label: 'TO HIT', outcome: 'HIT' }]);
  });

  it('picked on the map and rolled from the dice menu: its TO HIT; any other roll says nothing', async () => {
    await playing('generic');
    const target = await enemy(11);
    const t = await join();
    t.handlers.requestDiceRoll({ userName: 'GHOST', diceCounts: { 20: 1 }, modifiers: [], color: '#0f0' });
    await until(() => t.rolls().length === 1, { label: 'a plain roll' });
    expect(t.rolls()[0]).not.toHaveProperty('board');
    t.handlers.initiateAttack({ targetId: target.lastID, attackType: 'ranged' });
    await t.heard('attackPending');
    t.handlers.requestDiceRoll({ userName: 'GHOST', diceCounts: { 20: 1 }, modifiers: [], color: '#0f0' });
    await t.heard('attackResult');
    const roll = t.rolls()[1];
    expect(roll.board).toEqual({ label: 'TO HIT', outcome: roll.total >= 11 ? 'HIT' : 'MISS' });
  });
});

describe('saves, checks and the rest of the table\'s rolls (6c4d3)', () => {
  it('a CWN save meets or beats the sheet\'s own number: SUCCESS or FAILURE, on the board and in the log', async () => {
    await playing('cities_without_number');
    await sheet('GHOST', 'cities_without_number', { save_physical: 1, save_mental: 99 });
    const t = await join();
    t.handlers.requestSheetRoll({ fieldId: 'save_physical' });
    await until(() => t.rolls().length === 1, { label: 'the physical save' });
    t.handlers.requestSheetRoll({ fieldId: 'save_mental' });
    await until(() => t.rolls().length === 2, { label: 'the mental save' });
    const [easy, hard] = t.rolls();
    expect(easy.board).toEqual({ label: 'PHYSICAL SAVE', outcome: 'SUCCESS' });
    expect(easy.historyString).toMatch(/^GHOST rolled Physical Save \[.+ = \d+\] — vs 1: SUCCESS$/);
    expect(hard.board).toEqual({ label: 'MENTAL SAVE', outcome: 'FAILURE' });
    expect(hard.historyString).toMatch(/ — vs 99: FAILURE$/);
  });

  it('a check the GM judges, and a save with no number on the sheet, by name alone', async () => {
    await playing('cities_without_number');
    await sheet('GHOST', 'cities_without_number', { shoot: 1, dex_mod: 1 });
    const t = await join();
    t.handlers.requestSheetRoll({ fieldId: 'shoot' });
    await until(() => t.rolls().length === 1, { label: 'the check' });
    t.handlers.requestSheetRoll({ fieldId: 'save_luck' });
    await until(() => t.rolls().length === 2, { label: 'the save' });
    const [check, save] = t.rolls();
    expect(check.board).toEqual({ label: 'SHOOT' });
    expect(save.board).toEqual({ label: 'LUCK SAVE' });
    expect(save.historyString).not.toMatch(/ vs /);
  });

  it('an ability roll by the name its window gave it, kept short', async () => {
    await playing('cyberpunk_red');
    await sheet('GHOST', 'cyberpunk_red', { ref: 6 });
    const t = await join();
    t.handlers.rollAbility({ formula: '1d10 + @ref', label: 'Reflexes check' });
    await until(() => t.rolls().length === 1, { label: 'the ability' });
    t.handlers.rollAbility({ formula: '1d10', label: 'x'.repeat(80) });
    await until(() => t.rolls().length === 2, { label: 'the long one' });
    expect(t.rolls()[0].board).toEqual({ label: 'REFLEXES CHECK' });
    expect(t.rolls()[1].board.label).toBe('X'.repeat(40));
  });

  it('SR6 drain: NO DRAIN, or the stun it did', async () => {
    await playing('shadowrun_6e');
    await sheet('GHOST', 'shadowrun_6e', { willpower: 30, logic: 30, stun_monitor: 200, stun_current: 0 });
    const t = await join();
    t.handlers.resistDrain({ drainValue: 1, attr: 'logic' });
    await until(() => t.rolls().length === 1, { label: 'the light drain' });
    t.handlers.resistDrain({ drainValue: 99, attr: 'logic' });
    await until(() => t.rolls().length === 2, { label: 'the heavy drain' });
    const [light, heavy] = t.rolls();
    // Sixty dice: a hit or more is all but certain.
    expect(light.board).toEqual({ label: 'DRAIN', outcome: 'NO DRAIN' });
    expect(heavy.board).toEqual({ label: 'DRAIN', outcome: `${99 - heavy.total} STUN` });
  });

  it('initiative, in the game\'s own word for it, a combatant\'s and the NPC side\'s', async () => {
    await playing('generic');
    await run(db, `CREATE TABLE initiative_combat (id INTEGER PRIMARY KEY AUTOINCREMENT, turn_counter INTEGER DEFAULT 1, pass_counter INTEGER DEFAULT 1,
      system TEXT DEFAULT 'generic', mode TEXT DEFAULT 'individual', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    await run(db, `CREATE TABLE initiative_scene (scene_key TEXT PRIMARY KEY, combat_id INTEGER NOT NULL, combatants TEXT NOT NULL DEFAULT '[]',
      sides TEXT NOT NULL DEFAULT '[]', turn_index INTEGER DEFAULT 0, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    const t = await join();
    t.handlers['initiative:start']({ sceneKey: 'city:0', system: 'generic', mode: 'side' });
    await until(async () => (await new Promise((r) => db.get('SELECT 1 AS n FROM initiative_scene', (e, row) => r(row)))), { label: 'the combat' });
    t.handlers['initiative:roll']({ sceneKey: 'city:0', combatant: { id: 'ghost', name: 'GHOST', score: 14 } });
    await until(() => t.rolls().length === 1, { label: 'the combatant' });
    t.handlers['initiative:roll_side']({ sceneKey: 'city:0', score: 5 });
    await until(() => t.rolls().length === 2, { label: 'the NPC side' });
    expect(t.rolls().map((r) => r.board)).toEqual([{ label: 'INITIATIVE' }, { label: 'INITIATIVE' }]);
  });
});

describe('the rolls around dying, and spells', () => {
  it('a DEATH SAVE: STABLE or DEAD, as the log says', async () => {
    await playing('cyberpunk_red');
    await sheet('GHOST', 'cyberpunk_red', { body: 6 });
    await token('GHOST', { hp: 0 });
    const t = await join();
    t.handlers.requestDeathSave();
    await t.heard('deathSaveResult');
    const [save] = t.rolls();
    expect(save.board).toEqual({ label: 'DEATH SAVE', outcome: save.historyString.includes('STABILIZED') ? 'STABLE' : 'DEAD' });
  });

  it('STABILIZE: STABLE, FAILED, or DEAD on the last round', async () => {
    await playing('cities_without_number');
    await sheet('DOWNED', 'cities_without_number', { rounds_since_downed: 2 });
    await token('DOWNED', { hp: 0 });
    for (const [heal, rounds, outcome] of [[20, 0, 'STABLE'], [-20, 2, 'FAILED'], [-20, 5, 'DEAD']]) {
      await run(db, `DELETE FROM character_sheets WHERE username = 'GHOST'`);
      await sheet('GHOST', 'cities_without_number', { heal, int_mod: 0 });
      await run(db, `UPDATE character_sheets SET data = ? WHERE username = 'DOWNED'`, [JSON.stringify({ rounds_since_downed: rounds })]);
      await run(db, `UPDATE locations SET hp_current = 0 WHERE owner = 'DOWNED'`);
      const t = await join();
      t.handlers.requestStabilize({ targetUsername: 'DOWNED' });
      await t.heard('stabilizeResult');
      expect(t.rolls()[0].board, outcome).toEqual({ label: 'STABILIZE', outcome });
    }
  });

  it('a spell by its name, OVERCAST when it is', async () => {
    await playing('cities_without_number');
    await run(db, `INSERT INTO global_settings (key, value) VALUES ('cwn_deluxe', '1')`);
    await sheet('GHOST', 'cities_without_number', {
      mage_effort: 1, mage_effort_max: 3,
      spell1_name: 'Flickerflash', spell1_dmg: '2d6', spell1_cost: 1,
      spell2_name: 'The Unseen Hand', spell2_dmg: '', spell2_cost: 2,
    });
    const t = await join();
    t.handlers.castSpell({ index: 1 });
    await until(() => t.rolls().length === 1, { label: 'the first spell' });
    expect(t.rolls()[0].board).toEqual({ label: 'FLICKERFLASH' });
    t.handlers.castSpell({ index: 2 });
    await until(() => t.rolls().length === 2, { label: 'the second spell' });
    expect(t.rolls()[1].board).toEqual({ label: 'THE UNSEEN HAND', outcome: 'OVERCAST' });
  });
});
