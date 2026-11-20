/**
 * The initiative tracker, through its real socket handlers (sockets/initiative.js). This file used to copy the handlers'
 * logic into itself and test the copy, so a change to the tracker could never fail it (8i1, the user, 2026-11-19: "would this
 * be a good time for us to start writing tests for the initiative tracker, and multi initiatives"). Now every case presses
 * what the tracker's window sends and reads what the tracker stored and said.
 *
 * Covered here: START (a new combat, and a scene JOINed to one), rolls (sorted, re-rolled, joining late at the bottom, ties,
 * what goes to the dice log), group style (sides, the NPC side's roll, PCs winning ties), NEXT (D&D style, Cyberpunk RED
 * keeping its order, Shadowrun's passes, group style), REMOVE, END on one scene, and the combats list. Reordering, END
 * COMBAT and each scene's own ROUND are in initiative.reorder.endcombat.test.js; the rounds countdown in
 * condition_rounds.test.js; a condition's EACH TURN in condition_turn_effects.test.js.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { makeTestDb, get, run } from './helpers/testDb.js';
import { until, drain } from './helpers/until.js';

const mod = await import('../sockets/initiative.js');
const registerInitiativeHandlers = mod.registerInitiativeHandlers || mod.default.registerInitiativeHandlers;
const { sortSides, calcPcSideScore } = mod.sortSides ? mod : mod.default;

let db;
let emitted;
let handlers;

const all = (sql, args = []) => new Promise((ok, no) => db.all(sql, args, (e, rows) => (e ? no(e) : ok(rows))));
const scene = (key = 'city:0') => get(db, 'SELECT * FROM initiative_scene WHERE scene_key = ?', [key]);
const combat = (id) => get(db, 'SELECT * FROM initiative_combat WHERE id = ?', [id]);
const order = async (key = 'city:0') => JSON.parse((await scene(key)).combatants).map((c) => c.name);
const sides = async (key = 'city:0') => JSON.parse((await scene(key)).sides);
const lastState = (key = 'city:0') => [...emitted].reverse().find((e) => e.event === 'initiative:state' && e.data.sceneKey === key)?.data;

beforeEach(async () => {
  db = await makeTestDb();
  await run(db, `CREATE TABLE initiative_combat (id INTEGER PRIMARY KEY AUTOINCREMENT, turn_counter INTEGER DEFAULT 1, pass_counter INTEGER DEFAULT 1,
    system TEXT DEFAULT 'generic', mode TEXT DEFAULT 'individual', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  await run(db, `CREATE TABLE initiative_scene (scene_key TEXT PRIMARY KEY, combat_id INTEGER NOT NULL, combatants TEXT NOT NULL DEFAULT '[]',
    sides TEXT NOT NULL DEFAULT '[]', turn_index INTEGER DEFAULT 0, turn_counter INTEGER DEFAULT 1, pass_counter INTEGER DEFAULT 1, begun INTEGER DEFAULT 0,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  await run(db, `CREATE TABLE dice_rolls (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, total INTEGER, results TEXT, color TEXT, historyString TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)`);
  await run(db, `CREATE TABLE battle_maps (id INTEGER PRIMARY KEY AUTOINCREMENT, location_id INTEGER, designation TEXT, order_index INTEGER, image_url TEXT)`);
  await run(db, "INSERT INTO global_settings (key, value) VALUES ('game_system', 'generic')");
  emitted = [];
  let connect;
  registerInitiativeHandlers({ on: (e, cb) => { if (e === 'connection') connect = cb; }, emit: (event, data) => emitted.push({ event, data }), to: () => ({ emit: () => {} }) }, db);
  handlers = {};
  connect({ id: 'gm', on: (e, fn) => { handlers[e] = fn; }, emit: (event, data) => emitted.push({ event, data, direct: true }), use: () => {}, join: () => {} });
});

/** START on a scene, waited for: its combat's id. */
const start = async (key = 'city:0', more = {}) => {
  handlers['initiative:start']({ sceneKey: key, ...more });
  await until(async () => !!(await scene(key)), { label: `${key} started` });
  return (await scene(key)).combat_id;
};
/** What the tracker last told everyone of a scene: its state as broadcast (not a JOIN's reply to one screen). */
const told = (key) => [...emitted].reverse().find((e) => e.event === 'initiative:state' && e.data.sceneKey === key && !e.direct)?.data;
/** A roll, waited for until the tracker has told everyone the order with it. */
const roll = async (combatant, { key = 'city:0', appendToEnd } = {}) => {
  handlers['initiative:roll']({ sceneKey: key, combatant, appendToEnd });
  await until(async () => (told(key)?.combatants || []).some((c) => c.id === combatant.id && c.score === combatant.score), { label: `${combatant.name} rolled` });
};
/**
 * NEXT, waited for until the tracker tells everyone the scene moved on. Its writes come one after another (the turn, then a
 * wrapped round's count), and it tells everyone after the last, so waiting on the first write alone raced (TEST_SLOW_DB).
 */
const next = async (key = 'city:0') => {
  const before = await scene(key);
  handlers['initiative:next']({ sceneKey: key });
  await until(async () => {
    const now = told(key);
    return !!now && (now.turnIndex !== before.turn_index || now.turnCounter !== before.turn_counter || now.passCounter !== before.pass_counter
      || JSON.stringify(now.combatants) !== before.combatants);
  }, { label: `${key} next` });
};
const pc = (name, score, more = {}) => ({ id: `player:${name.toLowerCase()}`, name, score, isNpc: false, ...more });
const npc = (name, score, more = {}) => ({ id: `npc:${name.toLowerCase()}`, name, score, isNpc: true, ...more });

describe('START', () => {
  it('a new combat at ROUND 1 with this scene in it, its system and mode kept; said to everyone', async () => {
    const id = await start('city:0', { system: 'cyberpunk_red' });
    expect(await combat(id)).toMatchObject({ system: 'cyberpunk_red', mode: 'individual' });
    expect(await scene()).toMatchObject({ combat_id: id, combatants: '[]', turn_index: 0, turn_counter: 1, pass_counter: 1, begun: 0 });
    await until(async () => !!told('city:0'), { label: 'state' });
    expect(emitted.find((e) => e.event === 'initiative:started').data).toEqual({ sceneKey: 'city:0', combatId: id });
    expect(lastState()).toMatchObject({ sceneKey: 'city:0', combatId: id, combatants: [], turnIndex: 0, turnCounter: 1, passCounter: 1, system: 'cyberpunk_red', mode: 'individual', begun: false });
  });

  it('a scene JOINed to a combat shares it, at its own ROUND 1; pressed again, nothing more', async () => {
    const id = await start('city:0');
    await run(db, "UPDATE initiative_scene SET turn_counter = 4 WHERE scene_key = 'city:0'");
    expect(await start('5:0', { combatId: id })).toBe(id);
    expect(await all('SELECT id FROM initiative_combat')).toHaveLength(1);
    expect((await scene('5:0')).turn_counter).toBe(1);
    // START again on a running scene, with or without a combat: no second combat, the scene as it was, told again.
    emitted.length = 0;
    handlers['initiative:start']({ sceneKey: '5:0' });
    handlers['initiative:start']({ sceneKey: 'city:0', combatId: 999 });
    await until(async () => emitted.filter((e) => e.event === 'initiative:state').length === 2, { label: 'told again' });
    await drain(db);
    expect(await all('SELECT id FROM initiative_combat')).toHaveLength(1);
    expect((await scene('city:0')).combat_id).toBe(id);
    expect(emitted.some((e) => e.event === 'initiative:started')).toBe(false);
  });

  it('group style starts with the PLAYERS side; no scene, nothing', async () => {
    await start('city:0', { system: 'cities_without_number', mode: 'side' });
    expect(await sides()).toEqual([{ id: 'pc', name: 'PLAYERS', score: 0, isPlayerSide: true }]);
    handlers['initiative:start']({});
    await drain(db);
    expect(await all('SELECT scene_key FROM initiative_scene')).toHaveLength(1);
  });

  it('nothing where the game being played has initiative turned off', async () => {
    const OFF = 'sys_offoffoffoffoffof';
    const def = JSON.stringify({ format: 1, name: 'Off', core: { health: { model: 'pool' } }, parts: { initiative: { on: false } } });
    await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', [OFF, 'Off', def, def]);
    await new Promise((resolve) => require('../systemBuilder/runtime').load(db, resolve));
    await run(db, "UPDATE global_settings SET value = ? WHERE key = 'game_system'", [OFF]);
    handlers['initiative:start']({ sceneKey: 'city:0' });
    await drain(db);
    expect(await scene()).toBeUndefined();
  });
});

describe('rolls', () => {
  beforeEach(() => start());

  it('highest first, each roll said in the dice log with its breakdown', async () => {
    await roll(pc('Vex', 12, { breakdown: '1d20 (9) + 3 = 12', diceResults: { 20: [9] } }));
    await roll(npc('Ganger', 18));
    await roll(pc('Kes', 7));
    expect(await order()).toEqual(['Ganger', 'Vex', 'Kes']);
    const logged = await all('SELECT username, total, results, historyString FROM dice_rolls ORDER BY id');
    expect(logged[0]).toEqual({ username: 'Vex', total: 12, results: '{"20":[9]}', historyString: 'Vex INITIATIVE: 1d20 (9) + 3 = 12' });
    expect(logged[1]).toMatchObject({ username: 'Ganger', total: 18, historyString: 'Ganger rolled INITIATIVE [18]' });
    expect(lastState().combatants.map((c) => c.name)).toEqual(['Ganger', 'Vex', 'Kes']);
  });

  it('a re-roll takes the old one\'s place, its breakdown with it', async () => {
    await roll(pc('Vex', 12, { breakdown: 'first' }));
    await roll(npc('Ganger', 10));
    await roll(pc('Vex', 5, { breakdown: 'second' }));
    expect(await order()).toEqual(['Ganger', 'Vex']);
    expect(JSON.parse((await scene()).combatants).find((c) => c.name === 'Vex').breakdown).toBe('second');
  });

  it('joining late goes to the bottom, whatever the score', async () => {
    await roll(pc('Vex', 12));
    await roll(npc('Ganger', 10));
    await roll(pc('Kes', 30), { appendToEnd: true });
    expect(await order()).toEqual(['Vex', 'Ganger', 'Kes']);
  });

  it('ties: in the order rolled; in Cities Without Number a PC before an NPC', async () => {
    await roll(npc('Ganger', 10));
    await roll(pc('Vex', 10));
    expect(await order()).toEqual(['Ganger', 'Vex']);
    await start('7:0', { system: 'cities_without_number' });
    await roll(npc('Ganger', 10), { key: '7:0' });
    await roll(pc('Vex', 10), { key: '7:0' });
    await roll(npc('Drone', 11), { key: '7:0' });
    expect(await order('7:0')).toEqual(['Drone', 'Vex', 'Ganger']);
  });

  it('nothing into a scene with no initiative running, or with no one to roll', async () => {
    handlers['initiative:roll']({ sceneKey: '9:9', combatant: pc('Vex', 5) });
    handlers['initiative:roll']({ sceneKey: 'city:0' });
    await drain(db);
    expect(await scene('9:9')).toBeUndefined();
    expect(await order()).toEqual([]);
  });
});

describe('group style (sides)', () => {
  beforeEach(() => start('city:0', { system: 'cities_without_number', mode: 'side' }));

  it('a PC slots into PLAYERS, whose score is the best PC roll; a friendly NPC sides with them', async () => {
    await roll(pc('Vex', 6));
    await roll(pc('Kes', 9));
    await roll(npc('Medic', 20, { isFriendly: true }));
    const fighters = JSON.parse((await scene()).combatants);
    expect(fighters.map((c) => [c.name, c.sideId])).toEqual([['Medic', 'pc'], ['Kes', 'pc'], ['Vex', 'pc']]);
    // The best PC's roll, not the friendly NPC's.
    expect((await sides()).find((s) => s.id === 'pc').score).toBe(9);
  });

  it('the first enemy makes the NPC side with its own 1d8, once; the GM\'s side roll sets it, said in the log', async () => {
    await roll(npc('Ganger', 4));
    await roll(npc('Drone', 6));
    const npcSides = (await sides()).filter((s) => s.id === 'npc');
    expect(npcSides).toHaveLength(1);
    expect(npcSides[0]).toMatchObject({ name: 'NPC', isPlayerSide: false });
    // A d8: 1 to 8, over many scenes' first enemies.
    const scores = [npcSides[0].score];
    for (let i = 0; i < 30; i++) {
      await start(`side${i}:0`, { system: 'cities_without_number', mode: 'side' });
      await roll(npc('Ganger', 4), { key: `side${i}:0` });
      scores.push((await sides(`side${i}:0`)).find((s) => s.id === 'npc').score);
    }
    expect(Math.min(...scores)).toBeGreaterThanOrEqual(1);
    expect(Math.max(...scores)).toBeLessThanOrEqual(8);
    handlers['initiative:roll_side']({ sceneKey: 'city:0', score: 7, breakdown: '1d8 (7)' });
    await until(async () => (await sides()).find((s) => s.id === 'npc').score === 7, { label: 'side rolled' });
    await until(async () => (await all('SELECT historyString FROM dice_rolls')).some((r) => r.historyString === 'NPC SIDE INITIATIVE: 1d8 (7)'), { label: 'said' });
  });

  it('NEXT goes side by side, the higher first and PLAYERS on a tie, and the round comes round', async () => {
    await roll(pc('Vex', 5));
    handlers['initiative:roll_side']({ sceneKey: 'city:0', score: 5 });
    await until(async () => (told('city:0')?.sides || []).some((s) => s.id === 'npc'), { label: 'NPC side told' });
    await next();
    expect((await scene()).turn_index).toBe(1);
    await next();
    expect(await scene()).toMatchObject({ turn_index: 0, turn_counter: 2 });
    expect(told('city:0').sides.map((s) => s.id)).toEqual(['pc', 'npc']);
  });

  it('the sides in turn order: the higher first, PLAYERS on a tie; PLAYERS\' score the best PC roll, never an NPC\'s', () => {
    const p = { id: 'pc', score: 5, isPlayerSide: true };
    const n = { id: 'npc', score: 5, isPlayerSide: false };
    expect(sortSides([n, p]).map((s) => s.id)).toEqual(['pc', 'npc']);
    expect(sortSides([p, { ...n, score: 6 }]).map((s) => s.id)).toEqual(['npc', 'pc']);
    expect(calcPcSideScore([{ isNpc: false, score: 4 }, { isNpc: true, isFriendly: true, score: 19 }, { isNpc: false, score: 9 }])).toBe(9);
    expect(calcPcSideScore([{ isNpc: true, score: 3 }])).toBe(0);
  });

  it('REMOVE leaves whose side\'s turn it is', async () => {
    await roll(pc('Vex', 5));
    await roll(pc('Kes', 3));
    await run(db, "UPDATE initiative_scene SET turn_index = 1 WHERE scene_key = 'city:0'");
    handlers['initiative:remove']({ sceneKey: 'city:0', combatantId: 'player:vex' });
    await until(async () => (await order()).length === 1, { label: 'removed' });
    expect((await scene()).turn_index).toBe(1);
  });
});

describe('NEXT', () => {
  it('D&D style: down the order, then round to the top, ROUND +1 and the order kept (Cyberpunk RED rolls once)', async () => {
    await start('city:0', { system: 'cyberpunk_red' });
    for (const c of [pc('Vex', 18), npc('Ganger', 12), pc('Kes', 6)]) await roll(c);
    await next();
    await next();
    expect(await scene()).toMatchObject({ turn_index: 2, turn_counter: 1 });
    await next();
    expect(await scene()).toMatchObject({ turn_index: 0, turn_counter: 2 });
    expect(await order()).toEqual(['Vex', 'Ganger', 'Kes']);
    expect(lastState()).toMatchObject({ turnIndex: 0, turnCounter: 2 });
  });

  it('Shadowrun: every pass takes 10 off, those at 0 or less drop out, PASS +1; every pass spent, everyone rolls again', async () => {
    await start('city:0', { system: 'shadowrun_6e' });
    // Kes at exactly 10 comes to 0 after a pass, and drops out with those below it.
    for (const c of [pc('Vex', 25), npc('Ganger', 14), pc('Kes', 10)]) await roll(c);
    for (let i = 0; i < 3; i++) await next();
    expect(JSON.parse((await scene()).combatants).map((c) => [c.name, c.score])).toEqual([['Vex', 15], ['Ganger', 4]]);
    expect(await scene()).toMatchObject({ turn_index: 0, pass_counter: 2 });
    await next();
    await next();
    expect(JSON.parse((await scene()).combatants).map((c) => [c.name, c.score])).toEqual([['Vex', 5]]);
    expect((await scene()).pass_counter).toBe(3);
    await next();
    // Every pass spent: the order empties for everyone to roll again, the new round said, and it waits on BEGIN.
    expect(await order()).toEqual([]);
    expect(await scene()).toMatchObject({ pass_counter: 4, begun: 0 });
    await until(async () => emitted.some((e) => e.event === 'initiative:state' && e.data.newRound === true), { label: 'new round said' });
  });

  it('mid-pass, Shadowrun takes nothing off', async () => {
    await start('city:0', { system: 'shadowrun_6e' });
    for (const c of [pc('Vex', 25), npc('Ganger', 14)]) await roll(c);
    await next();
    expect(JSON.parse((await scene()).combatants).map((c) => c.score)).toEqual([25, 14]);
    expect((await scene()).pass_counter).toBe(1);
  });

  it('nothing on an empty order or a scene with none running', async () => {
    await start();
    handlers['initiative:next']({ sceneKey: 'city:0' });
    handlers['initiative:next']({ sceneKey: 'nowhere' });
    handlers['initiative:next']({});
    await drain(db);
    expect(await scene()).toMatchObject({ turn_index: 0, turn_counter: 1 });
  });
});

describe('REMOVE', () => {
  beforeEach(async () => {
    await start();
    for (const c of [pc('Vex', 20), npc('Ganger', 15), pc('Kes', 10), npc('Drone', 5)]) await roll(c);
  });
  const remove = async (id, left) => {
    handlers['initiative:remove']({ sceneKey: 'city:0', combatantId: id });
    await until(async () => (await order()).length === left, { label: `${id} removed` });
  };

  it('one before the turn: the turn stays on whoever had it', async () => {
    await run(db, "UPDATE initiative_scene SET turn_index = 2 WHERE scene_key = 'city:0'");
    await remove('player:vex', 3);
    const now = await scene();
    expect(JSON.parse(now.combatants)[now.turn_index].name).toBe('Kes');
  });

  it('the one whose turn it is: the next one up; the last of the order: back to the top', async () => {
    await run(db, "UPDATE initiative_scene SET turn_index = 1 WHERE scene_key = 'city:0'");
    await remove('npc:ganger', 3);
    let now = await scene();
    expect(JSON.parse(now.combatants)[now.turn_index].name).toBe('Kes');
    await run(db, "UPDATE initiative_scene SET turn_index = 2 WHERE scene_key = 'city:0'");
    await remove('npc:drone', 2);
    now = await scene();
    expect(now.turn_index).toBe(0);
  });

  it('everyone gone: turn 0', async () => {
    for (const [id, left] of [['player:vex', 3], ['npc:ganger', 2], ['player:kes', 1], ['npc:drone', 0]]) await remove(id, left);
    expect((await scene()).turn_index).toBe(0);
  });
});

describe('END on one scene (multi initiative)', () => {
  it('ends that scene; its combat goes on while another scene is in it, and goes with the last', async () => {
    const id = await start('city:0');
    await start('5:0', { combatId: id });
    handlers['initiative:end']({ sceneKey: 'city:0' });
    // Told once it is gone: waited for, then the rest read.
    await until(async () => emitted.some((e) => e.event === 'initiative:ended' && e.data.sceneKey === 'city:0'), { label: 'city ended, said' });
    expect(await scene('city:0')).toBeUndefined();
    await drain(db);
    expect(await combat(id)).toBeTruthy();
    expect(await scene('5:0')).toBeTruthy();
    handlers['initiative:end']({ sceneKey: '5:0' });
    await until(async () => !(await combat(id)), { label: 'combat gone' });
    expect(await all('SELECT scene_key FROM initiative_scene')).toEqual([]);
  });
});

describe('the combats list', () => {
  it('each combat with its scenes by name (the city map, a building, a floor) and each scene\'s own count', async () => {
    const plaza = (await run(db, "INSERT INTO locations (name, x, y, z, shape) VALUES ('Neon Plaza', 0, 0, 0, 'box')")).lastID;
    await run(db, "INSERT INTO battle_maps (location_id, designation, order_index) VALUES (?, 'Ground floor', 0), (?, 'Roof', 1)", [plaza, plaza]);
    // A whole building's tracker (FOLLOWS BUILDING), named by itself.
    const arcade = (await run(db, "INSERT INTO locations (name, x, y, z, shape) VALUES ('Arcade', 0, 0, 0, 'box')")).lastID;
    await run(db, "INSERT INTO battle_maps (location_id, designation, order_index) VALUES (?, 'Floor', 0)", [arcade]);
    const id = await start('city:0');
    await start(`${plaza}:1`, { combatId: id });
    await start(`building:${arcade}`);
    await run(db, "UPDATE initiative_scene SET turn_counter = 3 WHERE scene_key = 'city:0'");
    handlers['initiative:list_combats']();
    await until(async () => emitted.some((e) => e.event === 'initiative:combats'), { label: 'listed' });
    const listed = emitted.find((e) => e.event === 'initiative:combats').data;
    expect(listed).toHaveLength(2);
    expect(listed[0]).toEqual({
      id, scene_keys: ['city:0', `${plaza}:1`], scene_counters: { 'city:0': 3, [`${plaza}:1`]: 1 },
      scene_labels: { 'city:0': 'CITY MAP', [`${plaza}:1`]: 'NEON PLAZA — ROOF' },
    });
    expect(listed[1].scene_labels).toEqual({ [`building:${arcade}`]: 'ARCADE' });
  });

  it('none running: an empty list', async () => {
    handlers['initiative:list_combats']();
    await until(async () => emitted.some((e) => e.event === 'initiative:combats'), { label: 'listed' });
    expect(emitted.find((e) => e.event === 'initiative:combats').data).toEqual([]);
  });
});

describe('JOIN, as a screen opening the tracker', () => {
  it('sends that screen the scene as it stands, and nothing for a scene with none running', async () => {
    await start();
    await roll(pc('Vex', 9));
    const direct = () => emitted.filter((e) => e.direct);
    handlers['initiative:join']({ sceneKey: 'city:0' });
    await until(async () => direct().some((e) => e.event === 'initiative:state'), { label: 'sent' });
    expect(direct().find((e) => e.event === 'initiative:state').data).toMatchObject({ sceneKey: 'city:0', combatants: [expect.objectContaining({ name: 'Vex' })] });
    emitted.length = 0;
    handlers['initiative:join']({ sceneKey: 'nowhere' });
    await drain(db);
    expect(direct()).toEqual([]);
  });
});

describe('rolls landing together (found by 8i2 on CI)', () => {
  it('ROLL ENEMIES with many enemies at once: every roll in the order, none lost', async () => {
    await start();
    const many = Array.from({ length: 12 }, (_, i) => npc(`Ganger${i}`, 20 - i));
    for (const c of many) handlers['initiative:roll']({ sceneKey: 'city:0', combatant: c });
    await until(async () => (await order()).length === 12, { label: 'all twelve in', timeout: 5000 });
    expect(await order()).toEqual(many.map((c) => c.name));
  });

  // Each change lets the next go when it's done (sceneQueue.js), on every way out; one that didn't would hold the scene 5 s.
  it('a roll into no fight holds nothing up: START and a roll straight after go in at once', async () => {
    handlers['initiative:roll']({ sceneKey: 'city:0', combatant: pc('Early', 3) });
    await drain(db);
    await start();
    handlers['initiative:roll']({ sceneKey: 'city:0', combatant: pc('Vex', 9) });
    await until(async () => (told('city:0')?.combatants || []).some((c) => c.name === 'Vex'), { label: 'Vex in', timeout: 2500 });
    expect(await order()).toEqual(['Vex']);
  });

  it('the NPC side\'s roll holds nothing up: a roll straight after goes in at once', async () => {
    await start('city:0', { system: 'cities_without_number', mode: 'side' });
    handlers['initiative:roll_side']({ sceneKey: 'city:0', score: 6 });
    handlers['initiative:roll']({ sceneKey: 'city:0', combatant: pc('Vex', 9) });
    await until(async () => (told('city:0')?.combatants || []).some((c) => c.name === 'Vex'), { label: 'Vex in', timeout: 2500 });
    expect((await sides()).find((s) => s.id === 'npc').score).toBe(6);
  });

  it('a drag in the order holds nothing up, and a roll straight after keeps it', async () => {
    await start();
    await roll(npc('Ganger', 18));
    await roll(pc('Vex', 12));
    handlers['initiative:reorder']({ sceneKey: 'city:0', fromIndex: 0, toIndex: 1 });
    handlers['initiative:roll']({ sceneKey: 'city:0', combatant: pc('Kes', 1) });
    await until(async () => (told('city:0')?.combatants || []).some((c) => c.name === 'Kes'), { label: 'Kes in', timeout: 2500 });
    expect(await order()).toEqual(['Vex', 'Ganger', 'Kes']);
  });
});

describe('drags stand (the user, 2026-11-20: "when new users/npcs join the list stands")', () => {
  /** A drag, waited for until everyone is told the new order. */
  const drag = async (fromIndex, toIndex, names, more = {}) => {
    handlers['initiative:reorder']({ sceneKey: 'city:0', fromIndex, toIndex, ...more });
    await until(async () => JSON.stringify((told('city:0')?.combatants || []).map((c) => c.name)) === JSON.stringify(names), { label: 'dragged' });
  };

  it('a drag stands when later rolls come in around it, the roll it made still the one shown; a re-roll is a new place', async () => {
    await start();
    await roll(npc('Ganger', 18));
    await roll(pc('Vex', 12));
    await roll(pc('Kes', 7));
    await drag(2, 0, ['Kes', 'Ganger', 'Vex']);
    await roll(npc('Drone', 10));
    await roll(npc('Boss', 19));
    // Kes stands just over Ganger, where the drag put it: Drone's 10 falls under them all, Boss's 19 over them all.
    expect(await order()).toEqual(['Boss', 'Kes', 'Ganger', 'Vex', 'Drone']);
    expect(told('city:0').combatants.find((c) => c.name === 'Kes').score).toBe(7);
    // Kes rolls again: placed by the new roll, the drag gone with the old one.
    await roll(pc('Kes', 5));
    expect(await order()).toEqual(['Boss', 'Ganger', 'Vex', 'Drone', 'Kes']);
  });

  it('a late joiner stays at the bottom when a later roll is sorted in', async () => {
    await start();
    await roll(pc('Vex', 12));
    await roll(npc('Ganger', 10));
    await roll(pc('Kes', 30), { appendToEnd: true });
    await roll(npc('Drone', 11));
    expect(await order()).toEqual(['Vex', 'Drone', 'Ganger', 'Kes']);
  });

  it('group style: a drag within a side stands when its side gets another roll', async () => {
    await start('city:0', { system: 'cities_without_number', mode: 'side' });
    await roll(pc('Vex', 6));
    await roll(pc('Kes', 9));
    await drag(0, 1, ['Vex', 'Kes'], { sideId: 'pc' });
    await roll(pc('Ash', 7));
    expect(await order()).toEqual(['Ash', 'Vex', 'Kes']);
  });

  it('Shadowrun: a pass takes the place down with the roll, so a roll after it sorts against both', async () => {
    await start('city:0', { system: 'shadowrun_6e' });
    await roll(pc('Ace', 25));
    await roll(pc('Bly', 15));
    await drag(1, 0, ['Bly', 'Ace']);
    await next();
    await next();
    expect(told('city:0').combatants.map((c) => [c.name, c.score])).toEqual([['Bly', 5], ['Ace', 15]]);
    // Bly stands at 16 now, not the 26 it was dragged to: Cid's 20 goes over it.
    await roll(pc('Cid', 20));
    expect(await order()).toEqual(['Cid', 'Bly', 'Ace']);
  });
});

describe('a roll brings no place of its own', () => {
  it('a roll that comes with a place (an old copy of the order, a doctored screen) is placed by its roll, in either style', async () => {
    await start();
    await roll(npc('Ganger', 18));
    await roll(pc('Vex', 4, { place: 99 }));
    expect(await order()).toEqual(['Ganger', 'Vex']);
    expect(JSON.parse((await scene()).combatants).find((c) => c.name === 'Vex')).not.toHaveProperty('place');
    await start('7:0', { system: 'cities_without_number', mode: 'side' });
    await roll(pc('Kes', 9), { key: '7:0' });
    await roll(pc('Ash', 3, { place: 99 }), { key: '7:0' });
    expect(await order('7:0')).toEqual(['Kes', 'Ash']);
  });
});
