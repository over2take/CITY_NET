/**
 * A condition's EACH TURN (8a9a; approved mockup docs/mockups/condition-turn-effects.html, 2026-11-19): up to three
 * things it does at the start or end of its turn or of the round, rolled by the table, DAMAGE and HEAL changing HP on
 * their own unless the GM chose otherwise, ROLL TO END taking it off, every one in the log; AT THE END OF ITS NEXT TURN;
 * BEGIN for round 1; the table's switch. The turn and round as agreed (D&D style, group style, Shadowrun, one NEXT).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'module';
import { makeTestDb, get, run } from './helpers/testDb.js';
import { until, drain } from './helpers/until.js';

const require_ = createRequire(import.meta.url);
const { checkDefinition } = require_('../systemBuilder/definition');
const { conditionsOf, onTurns } = require_('../systemBuilder/conditions');
const { checkTokenConditions, parseTokenConditions } = require_('../tokens/conditions');
const { poolAfter } = require_('../tokens/poolHealth');
const { momentsOfNext, momentsOfBegin, effectsAt, nextTurnStep, rollEffect, TURN_EFFECTS_SETTING, asksFor, rollAsk, sceneName, yourWords } = require_('../tokens/turnEffects');
const { registerTurnAskHandlers } = require_('../sockets/turnAsks');
const runtime = require_('../systemBuilder/runtime');
const mod = await import('../sockets/initiative.js');
const registerInitiativeHandlers = mod.registerInitiativeHandlers || mod.default.registerInitiativeHandlers;

const TURNS = {
  format: 1, name: 'Turns', core: { health: { model: 'pool' } },
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'con_mod', label: 'Con mod' }] }],
  conditions: {
    burning: { name: 'Burning', short: 'BURN', icon: 'flame', each_turn: [{ when: 'turn_start', does: 'damage', roll: '2' }] },
    regenerating: { name: 'Regenerating', each_turn: [{ when: 'round_start', does: 'heal', roll: '3' }] },
    acid: { name: 'Acid', each_turn: [{ when: 'turn_start', does: 'damage', roll: '4', changes_hp: false }] },
    cursed: { name: 'Cursed', each_turn: [{ when: 'turn_end', does: 'roll_to_end', roll: '@con_mod', ends_on: 3 }] },
    doomed: { name: 'Doomed', each_turn: [{ when: 'round_end', does: 'just_roll', roll: '1d6' }] },
    poisoned: { each_turn: [{ when: 'turn_end', does: 'roll_to_end', roll: 'd20', ends_on: 1, rolled_by: 'player' }] },
    stunned: { ends: 'next_turn' },
  },
};

describe('the checks', () => {
  const problems = (conditions) => checkDefinition({ ...TURNS, conditions }).problems;
  it('up to three, each when, what, a roll the system can read, and the rest only where they belong', () => {
    expect(checkDefinition(TURNS).problems).toEqual([]);
    const e = (more) => problems({ burning: { name: 'Burning', each_turn: [{ when: 'turn_start', does: 'damage', roll: '1d4', ...more }] } });
    expect(e({ when: 'dawn' })).toEqual([{ where: 'condition burning, each turn 1, when', message: 'The start or end of its turn, or of the round' }]);
    expect(e({ does: 'explode' })).toEqual([{ where: 'condition burning, each turn 1, does', message: 'DAMAGE, HEAL, ROLL TO END or JUST ROLL' }]);
    expect(e({ roll: ' ' })).toEqual([{ where: 'condition burning, each turn 1, roll', message: 'Dice to roll, like 1d4' }]);
    expect(e({ roll: '1d4 + @nope' })).toEqual([{ where: 'condition burning, each turn 1, roll', message: '@nope isn\'t one of this system\'s names' }]);
    expect(e({ roll: 'x'.repeat(201) })).toEqual([{ where: 'condition burning, each turn 1, roll', message: 'Longer than 200 characters' }]);
    expect(e({ ends_on: 3 })).toEqual([{ where: 'condition burning, each turn 1, ends_on', message: 'Only a ROLL TO END ends on a number' }]);
    expect(e({ does: 'roll_to_end' })).toEqual([{ where: 'condition burning, each turn 1, ends_on', message: 'The whole number it ends on or more, up to 9999' }]);
    expect(e({ does: 'roll_to_end', ends_on: 10000 })).toEqual([{ where: 'condition burning, each turn 1, ends_on', message: 'The whole number it ends on or more, up to 9999' }]);
    expect(e({ does: 'roll_to_end', ends_on: 13 })).toEqual([]);
    expect(e({ changes_hp: 'yes' })).toEqual([{ where: 'condition burning, each turn 1, changes_hp', message: 'Whether it changes HP on its own: true or false' }]);
    expect(e({ does: 'just_roll', changes_hp: false })).toEqual([{ where: 'condition burning, each turn 1, changes_hp', message: 'Only DAMAGE and HEAL change HP' }]);
    expect(e({ rolled_by: 'gm' })).toEqual([{ where: 'condition burning, each turn 1, rolled_by', message: 'The table, or the player (the GM for an NPC)' }]);
    expect(e({ color: 'red' })).toEqual([{ where: 'condition burning, each turn 1, color', message: 'Not part of what a condition does each turn' }]);
    expect(problems({ burning: { name: 'Burning', each_turn: 'burns' } })).toEqual([{ where: 'condition burning, each turn', message: 'Must be a list of what it does each turn' }]);
    expect(problems({ burning: { name: 'Burning', each_turn: ['x'] } })).toEqual([{ where: 'condition burning, each turn 1', message: 'Must say when, what it does and its roll' }]);
    const four = Array.from({ length: 4 }, () => ({ when: 'turn_start', does: 'damage', roll: '1' }));
    expect(problems({ burning: { name: 'Burning', each_turn: four } })).toEqual([{ where: 'condition burning, each turn', message: 'At most 3' }]);
    // A standard one may have it too, and AT THE END OF ITS NEXT TURN is a way to end.
    expect(problems({ prone: { ends: 'next_turn', each_turn: [{ when: 'turn_end', does: 'just_roll', roll: '1d6' }] } })).toEqual([]);
  });

  it('acting on turns (8a9c): an EACH TURN, or ending at the end of its next turn; neither, or none, nothing', () => {
    expect(onTurns(conditionsOf({ conditions: { burning: TURNS.conditions.burning } }))).toBe(true);
    expect(onTurns(conditionsOf({ conditions: { stunned: { ends: 'next_turn' } } }))).toBe(true);
    expect(onTurns(conditionsOf({ conditions: { stunned: { ends: 'rounds' }, dazed: { name: 'Dazed' } } }))).toBe(false);
    expect(onTurns([{ id: 'x', each_turn: [] }])).toBe(false);
    expect(onTurns([])).toBe(false);
  });

  it('as the game runs it: each whole, changing HP and rolled by the table unless said otherwise; broken ones left out', () => {
    const shown = Object.fromEntries(conditionsOf(TURNS).map((c) => [c.id, c]));
    expect(shown.burning.each_turn).toEqual([{ when: 'turn_start', does: 'damage', roll: '2', changes_hp: true, rolled_by: 'table' }]);
    expect(shown.acid.each_turn).toEqual([{ when: 'turn_start', does: 'damage', roll: '4', changes_hp: false, rolled_by: 'table' }]);
    expect(shown.cursed.each_turn).toEqual([{ when: 'turn_end', does: 'roll_to_end', roll: '@con_mod', ends_on: 3, rolled_by: 'table' }]);
    expect(shown.poisoned.each_turn[0].rolled_by).toBe('player');
    expect(shown.stunned.ends).toBe('next_turn');
    expect(shown.prone).not.toHaveProperty('each_turn');
    const broken = conditionsOf({ conditions: { burning: { name: 'B', each_turn: [{ when: 'x', does: 'damage', roll: '1' }, { when: 'turn_end', does: 'roll_to_end', roll: '1' }, { when: 'turn_end', does: 'heal', roll: ' 2 ' }] } } });
    expect(broken.find((c) => c.id === 'burning').each_turn).toEqual([{ when: 'turn_end', does: 'heal', roll: '2', changes_hp: true, rolled_by: 'table' }]);
  });
});

describe('the turn and the round (as agreed)', () => {
  const order = [{ id: 'player:vex' }, { id: 'player:kes' }, { id: 'npc:7' }];
  it('D&D style: a NEXT ends who was up and starts who is next; the last one\'s also the round\'s, around the countdown', () => {
    expect(momentsOfNext({ before: order, from: 0, to: 1, wrapped: false })).toEqual([
      { when: 'turn_end', ids: ['player:vex'] }, { when: 'turn_start', ids: ['player:kes'] }]);
    expect(momentsOfNext({ before: order, from: 2, to: 0, wrapped: true })).toEqual([
      { when: 'turn_end', ids: ['npc:7'] }, { when: 'round_end', ids: ['player:vex', 'player:kes', 'npc:7'] },
      { when: 'round_start', ids: ['player:vex', 'player:kes', 'npc:7'] }, { when: 'turn_start', ids: ['player:vex'] }]);
  });
  it('group style: its turn is its side\'s, for every member', () => {
    const fighters = [{ id: 'player:vex', sideId: 'pc' }, { id: 'npc:7', sideId: 'npc' }, { id: 'player:kes', sideId: 'pc' }];
    const sides = [{ id: 'pc' }, { id: 'npc' }];
    expect(momentsOfNext({ mode: 'side', before: fighters, sides, from: 0, to: 1, wrapped: false })).toEqual([
      { when: 'turn_end', ids: ['player:vex', 'player:kes'] }, { when: 'turn_start', ids: ['npc:7'] }]);
    expect(momentsOfNext({ mode: 'side', before: fighters, sides, from: 1, to: 0, wrapped: true }).map((m) => m.when))
      .toEqual(['turn_end', 'round_end', 'round_start', 'turn_start']);
    expect(momentsOfBegin({ mode: 'side', combatants: fighters, sides })).toEqual([
      { when: 'round_start', ids: ['player:vex', 'npc:7', 'player:kes'] }, { when: 'turn_start', ids: ['player:vex', 'player:kes'] }]);
  });
  it('Shadowrun: a pass\'s turns are turns, the round only when every pass is spent, then everyone rolls again for BEGIN', () => {
    const survivors = [{ id: 'player:vex' }];
    expect(momentsOfNext({ before: order, after: survivors, from: 2, to: 0, wrapped: true, roundEnds: false })).toEqual([
      { when: 'turn_end', ids: ['npc:7'] }, { when: 'turn_start', ids: ['player:vex'] }]);
    // Everyone rolls again: no one in the new order yet, its START OF ROUND waits on BEGIN.
    expect(momentsOfNext({ before: order, after: [], from: 2, to: 0, wrapped: true, roundEnds: true })).toEqual([
      { when: 'turn_end', ids: ['npc:7'] }, { when: 'round_end', ids: ['player:vex', 'player:kes', 'npc:7'] }]);
  });
  it('BEGIN: START OF ROUND, then the first one\'s START OF TURN; nothing for an empty order', () => {
    expect(momentsOfBegin({ combatants: order, index: 0 })).toEqual([
      { when: 'round_start', ids: ['player:vex', 'player:kes', 'npc:7'] }, { when: 'turn_start', ids: ['player:vex'] }]);
    expect(momentsOfBegin({ combatants: [] })).toEqual([]);
  });
});

describe('what fires, and how it ends', () => {
  const offered = conditionsOf(TURNS);
  it('the conditions on a token with something at that moment, in the token\'s order', () => {
    const fired = effectsAt('turn_start', [{ id: 'acid' }, { id: 'prone' }, { id: 'burning' }, { id: 'gone' }], offered);
    expect(fired.map((f) => [f.condition.id, f.effect.roll])).toEqual([['acid', '4'], ['burning', '2']]);
    expect(effectsAt('round_end', [{ id: 'burning' }], offered)).toEqual([]);
  });
  it('AT THE END OF ITS NEXT TURN: marked when its turn begins, off when that turn ends; put on mid-turn, the next one', () => {
    const start = nextTurnStep('turn_start', [{ id: 'stunned' }, { id: 'prone' }], offered);
    expect(start).toEqual({ list: [{ id: 'stunned', started: true }, { id: 'prone' }], ended: [], changed: true });
    expect(nextTurnStep('turn_start', start.list, offered).changed).toBe(false);
    // Put on during its own turn: not started, so this turn's end leaves it.
    expect(nextTurnStep('turn_end', [{ id: 'stunned' }], offered)).toEqual({ list: [{ id: 'stunned' }], ended: [], changed: false });
    expect(nextTurnStep('turn_end', start.list, offered)).toEqual({ list: [{ id: 'prone' }], ended: ['stunned'], changed: true });
    expect(nextTurnStep('round_end', start.list, offered).changed).toBe(false);
  });
  it('a token\'s condition kept through an edit keeps its turn begun; one put on starts fresh', () => {
    expect(parseTokenConditions('[{"id":"stunned","started":true},{"id":"prone","started":"yes"}]')).toEqual([{ id: 'stunned', started: true }, { id: 'prone' }]);
    expect(checkTokenConditions([{ id: 'stunned' }, { id: 'prone' }], offered, [], [{ id: 'stunned', started: true }]))
      .toEqual({ ok: true, value: [{ id: 'stunned', started: true }, { id: 'prone' }] });
    expect(checkTokenConditions([{ id: 'stunned' }], offered).value).toEqual([{ id: 'stunned' }]);
  });
});

describe('a roll and what it did, in words', () => {
  const offered = Object.fromEntries(conditionsOf(TURNS).map((c) => [c.id, c]));
  const names = { known: (n) => n === 'con_mod', refused: (n) => `@${n} isn't one of this system's names` };
  const roll = (id, more = {}) => rollEffect({ condition: offered[id], effect: offered[id].each_turn[0], values: { con_mod: 2 }, names, pool: { current: 10, max: 12, temp: 1 }, who: 'KES', rng: () => 0, ...more });
  it('DAMAGE onto the pool, TEMP first; HEAL up to MAX; said with the HP before and after', () => {
    expect(roll('burning')).toMatchObject({ value: 2, hp: { current: 9, max: 12, temp: 0 }, line: 'KES · BURNING, START OF ITS TURN · rolled by the table: 2 → 2 DAMAGE · HP 10 → 9' });
    expect(roll('regenerating')).toMatchObject({ hp: { current: 12 }, line: 'KES · REGENERATING, START OF ROUND · rolled by the table: 3 → 3 HEALED · HP 10 → 12' });
  });
  it('not changing HP: the GM\'s to apply, or a game whose health isn\'t one pool', () => {
    expect(roll('acid')).toEqual({ value: 4, dice: [], line: 'KES · ACID, START OF ITS TURN · rolled by the table: 4 → 4 DAMAGE · NOT APPLIED, the GM\'s to apply' });
    expect(roll('burning', { pool: null }).line).toBe('KES · BURNING, START OF ITS TURN · rolled by the table: 2 → 2 DAMAGE · NOT APPLIED, this game\'s health changes in HEALTH');
    expect(roll('burning', { pool: null })).not.toHaveProperty('hp');
    // Damage rolled below 0 does nothing to the pool.
    expect(roll('burning', { effect: { ...offered.burning.each_turn[0], roll: '-3' } })).toMatchObject({ hp: { current: 10, temp: 1 }, line: 'KES · BURNING, START OF ITS TURN · rolled by the table: -3 → -3 DAMAGE · HP 10 → 10' });
  });
  it('ROLL TO END against its number, reading the sheet; JUST ROLL to the log; the dice kept', () => {
    expect(roll('cursed', { values: { con_mod: 3 } })).toMatchObject({ value: 3, ends: true, line: 'KES · CURSED SAVE, END OF ITS TURN · rolled by the table: @con_mod → 3 vs 3 · CURSED OFF' });
    expect(roll('cursed')).toMatchObject({ ends: false, line: 'KES · CURSED SAVE, END OF ITS TURN · rolled by the table: @con_mod → 2 vs 3 · stays on' });
    const doomed = roll('doomed', { rng: () => 0.99 });
    expect(doomed).toEqual({ value: 6, dice: [{ count: 1, sides: 6, rolls: [6] }], line: 'KES · DOOMED, END OF ROUND · rolled by the table: 1d6 → 6' });
    expect(rollEffect({ condition: offered.doomed, effect: { ...offered.doomed.each_turn[0], roll: '@nope' }, values: {}, names, pool: null, who: 'KES', rng: () => 0 }))
      .toEqual({ error: '@nope isn\'t one of this system\'s names' });
  });
  it('one pool, as the HEALTH route changes it', () => {
    expect(poolAfter({ current: 5, max: 10, temp: 3 }, 'damage', 4)).toEqual({ current: 4, max: 10, temp: 0 });
    expect(poolAfter({ current: 5, max: 10, temp: 3 }, 'damage', 2)).toEqual({ current: 5, max: 10, temp: 1 });
    expect(poolAfter({ current: 2, max: 10, temp: 0 }, 'damage', 9)).toEqual({ current: 0, max: 10, temp: 0 });
    expect(poolAfter({ current: 8, max: 10, temp: 0 }, 'heal', 5)).toEqual({ current: 10, max: 10, temp: 0 });
    expect(poolAfter({ current: 14, max: 10, temp: null }, 'set_max', 0)).toEqual({ current: 10, max: 10, temp: 0 });
    expect(poolAfter({ current: null, max: null, temp: null }, 'damage', 0)).toEqual({ current: 0, max: 0, temp: 0 });
  });
});

describe('at the table', () => {
  const ID = 'sys_turnsturnsturnstu';
  let db;
  let emitted;
  let handlers;
  const line = (text) => text;
  const hp = async (id) => (await get(db, 'SELECT hp_current FROM locations WHERE id = ?', [id])).hp_current;
  const on = async (id) => parseTokenConditions((await get(db, 'SELECT conditions FROM locations WHERE id = ?', [id])).conditions).map((c) => c.id);
  const lines = () => new Promise((ok) => db.all('SELECT historyString FROM dice_rolls ORDER BY id', (e, rows) => ok((rows || []).map((r) => r.historyString))));
  const token = async (name, shape, owner, conditions, current = 10) => (await run(db,
    'INSERT INTO locations (name, x, y, z, shape, owner, hp_current, hp_max, hp_temp, conditions) VALUES (?, 0, 0, 0, ?, ?, ?, 12, 0, ?)',
    [name, shape, owner, current, JSON.stringify(conditions)])).lastID;
  const scene = async ({ combatants, turnIndex = 0, mode = 'individual', sides = [], begun = 1 }) => {
    const combat = (await run(db, 'INSERT INTO initiative_combat (system, mode) VALUES (?, ?)', [ID, mode])).lastID;
    await run(db, 'INSERT INTO initiative_scene (scene_key, combat_id, combatants, sides, turn_index, begun) VALUES (?, ?, ?, ?, ?, ?)',
      ['main', combat, JSON.stringify(combatants), JSON.stringify(sides), turnIndex, begun]);
  };

  beforeEach(async () => {
    db = await makeTestDb();
    await run(db, `CREATE TABLE IF NOT EXISTS initiative_combat (id INTEGER PRIMARY KEY AUTOINCREMENT, turn_counter INTEGER DEFAULT 1,
      pass_counter INTEGER DEFAULT 1, system TEXT DEFAULT 'generic', mode TEXT DEFAULT 'individual', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    await run(db, `CREATE TABLE IF NOT EXISTS initiative_scene (scene_key TEXT PRIMARY KEY, combat_id INTEGER NOT NULL, combatants TEXT NOT NULL DEFAULT '[]',
      sides TEXT NOT NULL DEFAULT '[]', turn_index INTEGER DEFAULT 0, turn_counter INTEGER DEFAULT 1, pass_counter INTEGER DEFAULT 1, begun INTEGER DEFAULT 0, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    await run(db, `CREATE TABLE IF NOT EXISTS dice_rolls (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, total INTEGER, results TEXT, color TEXT, historyString TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    const def = JSON.stringify(TURNS);
    await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', [ID, 'Turns', def, def]);
    await new Promise((resolve) => runtime.load(db, resolve));
    await run(db, "INSERT INTO global_settings (key, value) VALUES ('game_system', ?)", [ID]);
    await run(db, 'INSERT INTO character_sheets (username, system, data, is_npc) VALUES (\'kes\', ?, ?, 0)', [ID, JSON.stringify({ name: 'Kes', con_mod: 3 })]);
    emitted = [];
    let connect;
    registerInitiativeHandlers({ on: (e, cb) => { if (e === 'connection') connect = cb; }, emit: (event, data) => emitted.push({ event, data }), to: () => ({ emit: () => {} }) }, db, { emitUpdate: () => emitted.push({ event: 'update' }) });
    handlers = {};
    connect({ id: 'gm', on: (e, fn) => { handlers[e] = fn; }, emit: (event, data) => emitted.push({ event, data, direct: true }), use: () => {}, join: () => {} });
  });

  it('NEXT: who was up ends, who is next starts; BURNING burns, ACID rolls for the GM to apply, both said, the map told', async () => {
    const kes = await token('KES', 'rhombus', 'kes', [{ id: 'burning' }, { id: 'acid' }]);
    const ganger = await token('GANGER', 'enemy_rhombus', 'gm', [{ id: 'cursed' }]);
    await scene({ combatants: [{ id: `npc:${ganger}` }, { id: 'player:kes' }] });
    handlers['initiative:next']({ sceneKey: 'main' });
    await until(async () => (await lines()).length === 3 && (await hp(kes)) === 8, { label: 'three lines, and the HP' });
    expect(await lines()).toEqual([
      line('GANGER (NPC) · CURSED SAVE, END OF ITS TURN · rolled by the table: @con_mod → 0 vs 3 · stays on'),
      line('KES · BURNING, START OF ITS TURN · rolled by the table: 2 → 2 DAMAGE · HP 10 → 8'),
      line('KES · ACID, START OF ITS TURN · rolled by the table: 4 → 4 DAMAGE · NOT APPLIED, the GM\'s to apply'),
    ]);
    expect(await hp(kes)).toBe(8);
    expect(emitted.some((e) => e.event === 'update')).toBe(true);
    expect(emitted.some((e) => e.event === 'sheetUpdated' && e.data.username === 'kes')).toBe(true);
    expect(emitted.find((e) => e.event === 'diceRollBroadcast' && /BURNING/.test(e.data.historyString)).data).toMatchObject({ total: 2, board: { label: 'BURNING' } });
  });

  it('ROLL TO END reads the character\'s sheet and takes it off; one rolled by the player is asked of them (8a9a2)', async () => {
    const kes = await token('KES', 'rhombus', 'kes', [{ id: 'cursed' }, { id: 'poisoned' }]);
    await scene({ combatants: [{ id: 'player:kes' }, { id: 'player:vex' }] });
    handlers['initiative:next']({ sceneKey: 'main' });
    // The condition comes off, then the lines are written, then everyone is told the asks changed: waited for all three
    // (the last raced on a slow database, found by 8a9c2).
    await until(async () => !(await on(kes)).includes('cursed') && (await lines()).length === 2 && emitted.some((e) => e.event === 'turnAsksChanged'),
      { label: 'cursed off, said, and the asks told' });
    expect(await lines()).toEqual([
      'KES · CURSED SAVE, END OF ITS TURN · rolled by the table: @con_mod → 3 vs 3 · CURSED OFF',
      'KES · POISONED SAVE, END OF ITS TURN: asked on KES\'s sheet',
    ]);
    expect(await on(kes)).toEqual(['poisoned']);
    expect(emitted.some((e) => e.event === 'turnAsksChanged')).toBe(true);
  });

  it('the round wrapping: END OF ROUND, the countdown, START OF ROUND, then the first\'s turn', async () => {
    const kes = await token('KES', 'rhombus', 'kes', [{ id: 'regenerating' }, { id: 'doomed' }], 5);
    await scene({ combatants: [{ id: 'player:kes' }], turnIndex: 0 });
    handlers['initiative:next']({ sceneKey: 'main' });
    await until(async () => (await lines()).length === 2, { label: 'two lines' });
    const said = await lines();
    expect(said[0]).toMatch(/^KES · DOOMED, END OF ROUND · rolled by the table: 1d6 → [1-6]$/);
    expect(said[1]).toBe('KES · REGENERATING, START OF ROUND · rolled by the table: 3 → 3 HEALED · HP 5 → 8');
    expect(await hp(kes)).toBe(8);
  });

  it('BEGIN: START OF ROUND and the first one\'s turn, once; NEXT before it begins the round too', async () => {
    const kes = await token('KES', 'rhombus', 'kes', [{ id: 'burning' }, { id: 'regenerating' }], 5);
    await scene({ combatants: [{ id: 'player:kes' }, { id: 'player:vex' }], begun: 0 });
    // Not begun: the tracker is told, to offer BEGIN, and that this game's conditions act on turns (8a9c).
    handlers['initiative:join']({ sceneKey: 'main' });
    await until(async () => emitted.some((e) => e.event === 'initiative:state'), { label: 'joined' });
    expect(emitted.find((e) => e.event === 'initiative:state').data).toMatchObject({ begun: false, turnEffects: true });
    emitted.length = 0;
    handlers['initiative:begin']({ sceneKey: 'main' });
    await until(async () => (await lines()).length === 2, { label: 'begun' });
    expect(await lines()).toEqual([
      'KES · REGENERATING, START OF ROUND · rolled by the table: 3 → 3 HEALED · HP 5 → 8',
      'KES · BURNING, START OF ITS TURN · rolled by the table: 2 → 2 DAMAGE · HP 8 → 6',
    ]);
    expect((await get(db, "SELECT begun FROM initiative_scene WHERE scene_key = 'main'")).begun).toBe(1);
    expect(emitted.find((e) => e.event === 'initiative:state').data.begun).toBe(true);
    handlers['initiative:begin']({ sceneKey: 'main' });
    await drain(db);
    expect(await lines()).toHaveLength(2);
    expect(await hp(kes)).toBe(6);
  });

  it('AT THE END OF ITS NEXT TURN: put on before its turn, off when that turn ends, said; edited in between, still', async () => {
    const kes = await token('KES', 'rhombus', 'kes', [{ id: 'stunned' }, { id: 'prone' }]);
    await scene({ combatants: [{ id: 'player:vex' }, { id: 'player:kes' }] });
    handlers['initiative:next']({ sceneKey: 'main' });
    await until(async () => (await get(db, 'SELECT conditions FROM locations WHERE id = ?', [kes])).conditions.includes('started'), { label: 'its turn began' });
    expect(await on(kes)).toEqual(['stunned', 'prone']);
    handlers['initiative:next']({ sceneKey: 'main' });
    await until(async () => !(await on(kes)).includes('stunned') && (await lines()).length === 1, { label: 'ended, and said' });
    expect(await lines()).toEqual(['KES · STUNNED: ENDED (the end of its next turn)']);
    expect(await on(kes)).toEqual(['prone']);
  });

  it('group style: its side\'s turn starts for every member', async () => {
    const kes = await token('KES', 'rhombus', 'kes', [{ id: 'burning' }]);
    const ganger = await token('GANGER', 'enemy_rhombus', 'gm', [{ id: 'burning' }]);
    await scene({ mode: 'side', combatants: [{ id: `npc:${ganger}`, sideId: 'npc', score: 5 }, { id: 'player:kes', sideId: 'pc', score: 9 }],
      sides: [{ id: 'pc', name: 'PLAYERS', score: 9, isPlayerSide: true }, { id: 'npc', name: 'NPC', score: 5, isPlayerSide: false }] });
    handlers['initiative:next']({ sceneKey: 'main' });
    await until(async () => (await lines()).length === 1, { label: 'the NPC side' });
    expect(await lines()).toEqual(['GANGER (NPC) · BURNING, START OF ITS TURN · rolled by the table: 2 → 2 DAMAGE · HP 10 → 8']);
    expect(await hp(kes)).toBe(10);
    expect(await hp(ganger)).toBe(8);
  });

  it('the table\'s CONDITION TURN EFFECTS off: no rolls; the endings go on', async () => {
    await run(db, 'INSERT INTO global_settings (key, value) VALUES (?, \'0\')', [TURN_EFFECTS_SETTING]);
    // At the end of its turn CURSED would roll (3 vs 3, off); switched off, it stays, and STUNNED still ends.
    const kes = await token('KES', 'rhombus', 'kes', [{ id: 'cursed' }, { id: 'stunned', started: true }]);
    await scene({ combatants: [{ id: 'player:kes' }, { id: 'player:vex' }] });
    handlers['initiative:next']({ sceneKey: 'main' });
    await until(async () => !(await on(kes)).includes('stunned') && (await lines()).length === 1, { label: 'still ends, and said' });
    expect(await lines()).toEqual(['KES · STUNNED: ENDED (the end of its next turn)']);
    expect(await on(kes)).toEqual(['cursed']);
  });

  it('a game with no token health: the damage rolled and said, not applied', async () => {
    const NOHP = 'sys_nohpnohpnohpnohpn';
    const def = JSON.stringify({ ...TURNS, name: 'No HP', parts: { token_health: { on: false } } });
    await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', [NOHP, 'No HP', def, def]);
    await new Promise((resolve) => runtime.load(db, resolve));
    await run(db, "UPDATE global_settings SET value = ? WHERE key = 'game_system'", [NOHP]);
    const kes = await token('KES', 'rhombus', 'kes', [{ id: 'burning' }]);
    await scene({ combatants: [{ id: 'player:vex' }, { id: 'player:kes' }] });
    handlers['initiative:next']({ sceneKey: 'main' });
    await until(async () => (await lines()).length === 1, { label: 'said' });
    expect(await lines()).toEqual(['KES · BURNING, START OF ITS TURN · rolled by the table: 2 → 2 DAMAGE · NOT APPLIED, this game\'s health changes in HEALTH']);
    expect(await hp(kes)).toBe(10);
  });

  it('nothing for a game whose conditions do nothing on turns, or a token not on the map', async () => {
    await scene({ combatants: [{ id: 'player:nobody' }, { id: 'npc:999' }, { id: 'c:typed' }] });
    handlers['initiative:next']({ sceneKey: 'main' });
    handlers['initiative:next']({ sceneKey: 'main' });
    await drain(db);
    expect(await lines()).toEqual([]);
  });
});

describe('the system file', () => {
  const citysys = require_('../systemBuilder/citysys');
  it('carries each condition\'s EACH TURN and AT THE END OF ITS NEXT TURN out and back unchanged, with nothing to fix', () => {
    const text = JSON.stringify(citysys.buildFile({ definition: TURNS, version: 1, origin: 'org_turns' }));
    const read = citysys.readFile(text);
    expect(read.fatal).toBeFalsy();
    expect(read.problems).toEqual([]);
    expect(read.file.definition.conditions).toEqual(TURNS.conditions);
  });
});

describe('an ask in the words of the one asked (8a9c2)', () => {
  const labels = new Map([['con_mod', 'Con mod']]);
  it('when, what it rolls by the system\'s names, and what it does; a name it doesn\'t have left as typed', () => {
    expect(yourWords({ when: 'turn_end', does: 'roll_to_end', roll: 'd20 + @con_mod', ends_on: 13 }, labels)).toBe('End of your turn: d20 + Con mod, 13 or more ends it.');
    expect(yourWords({ when: 'turn_start', does: 'damage', roll: '1d4' }, labels)).toBe('Start of your turn: 1d4 damage.');
    expect(yourWords({ when: 'turn_start', does: 'damage', roll: '1d4', changes_hp: false }, labels)).toBe('Start of your turn: 1d4 damage, for the GM to apply.');
    expect(yourWords({ when: 'round_start', does: 'heal', roll: '2', changes_hp: true }, labels)).toBe('Start of the round: 2 healed.');
    expect(yourWords({ when: 'round_end', does: 'just_roll', roll: '@luck + @con_mod' }, labels)).toBe('End of the round: @luck + Con mod, to the log.');
  });
});

describe('a roll asked of the player, or the GM for an NPC (8a9a2)', () => {
  const ID = 'sys_asksasksasksasksa';
  const ASKS = { ...TURNS, name: 'Asks', conditions: { ...TURNS.conditions,
    poisoned: { each_turn: [{ when: 'turn_end', does: 'roll_to_end', roll: '@con_mod', ends_on: 3, rolled_by: 'player' }] },
    burning: { name: 'Burning', each_turn: [{ when: 'turn_start', does: 'damage', roll: '2', rolled_by: 'player' }] } } };
  let db;
  let emitted;
  let handlers;
  const io = { emit: (event, data) => emitted.push({ event, data }), on: () => {}, to: () => ({ emit: () => {} }) };
  const lines = () => new Promise((ok) => db.all('SELECT historyString FROM dice_rolls ORDER BY id', (e, rows) => ok((rows || []).map((r) => r.historyString))));
  const on = async (id) => parseTokenConditions((await get(db, 'SELECT conditions FROM locations WHERE id = ?', [id])).conditions).map((c) => c.id);
  const hp = async (id) => (await get(db, 'SELECT hp_current FROM locations WHERE id = ?', [id])).hp_current;
  const token = async (name, shape, owner, conditions) => (await run(db,
    'INSERT INTO locations (name, x, y, z, shape, owner, hp_current, hp_max, hp_temp, conditions) VALUES (?, 0, 0, 0, ?, ?, 10, 12, 0, ?)',
    [name, shape, owner, JSON.stringify(conditions)])).lastID;
  const scene = async (key, combatants, turnIndex = 0) => {
    const combat = (await run(db, "INSERT INTO initiative_combat (system, mode) VALUES (?, 'individual')", [ID])).lastID;
    await run(db, 'INSERT INTO initiative_scene (scene_key, combat_id, combatants, sides, turn_index, begun) VALUES (?, ?, ?, \'[]\', ?, 1)', [key, combat, JSON.stringify(combatants), turnIndex]);
  };
  const asks = (who) => asksFor(db, { runtime, system: ID, ...who });
  const fired = async (n) => until(async () => (await lines()).length === n, { label: `${n} lines` });

  beforeEach(async () => {
    db = await makeTestDb();
    await run(db, `CREATE TABLE IF NOT EXISTS initiative_combat (id INTEGER PRIMARY KEY AUTOINCREMENT, turn_counter INTEGER DEFAULT 1,
      pass_counter INTEGER DEFAULT 1, system TEXT DEFAULT 'generic', mode TEXT DEFAULT 'individual', created_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    await run(db, `CREATE TABLE IF NOT EXISTS initiative_scene (scene_key TEXT PRIMARY KEY, combat_id INTEGER NOT NULL, combatants TEXT NOT NULL DEFAULT '[]',
      sides TEXT NOT NULL DEFAULT '[]', turn_index INTEGER DEFAULT 0, turn_counter INTEGER DEFAULT 1, pass_counter INTEGER DEFAULT 1, begun INTEGER DEFAULT 0, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    await run(db, `CREATE TABLE IF NOT EXISTS dice_rolls (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, total INTEGER, results TEXT, color TEXT, historyString TEXT,
      timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)`);
    await run(db, 'CREATE TABLE IF NOT EXISTS battle_maps (id INTEGER PRIMARY KEY AUTOINCREMENT, location_id INTEGER, designation TEXT, order_index INTEGER, image_url TEXT)');
    const def = JSON.stringify(ASKS);
    await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', [ID, 'Asks', def, def]);
    await new Promise((resolve) => runtime.load(db, resolve));
    await run(db, "INSERT INTO global_settings (key, value) VALUES ('game_system', ?)", [ID]);
    await run(db, "INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('kes', ?, ?, 0)", [ID, JSON.stringify({ name: 'Kes', con_mod: 3 })]);
    emitted = [];
    let connect;
    registerInitiativeHandlers({ ...io, on: (e, cb) => { if (e === 'connection') connect = cb; } }, db, { emitUpdate: () => emitted.push({ event: 'update' }) });
    handlers = {};
    connect({ id: 'gm', on: (e, fn) => { handlers[e] = fn; }, emit: () => {}, use: () => {}, join: () => {} });
  });

  it('asked: one line saying so, the ask kept for that player alone, all of them for the GM', async () => {
    const kes = await token('KES', 'rhombus', 'kes', [{ id: 'poisoned' }]);
    const ganger = await token('GANGER', 'enemy_rhombus', 'gm', [{ id: 'poisoned' }]);
    await scene('main', [{ id: 'player:kes' }, { id: `npc:${ganger}` }, { id: 'player:vex' }]);
    handlers['initiative:next']({ sceneKey: 'main' });
    await fired(1);
    handlers['initiative:next']({ sceneKey: 'main' });
    await fired(2);
    expect(await lines()).toEqual(['KES · POISONED SAVE, END OF ITS TURN: asked on KES\'s sheet', 'GANGER (NPC) · POISONED SAVE, END OF ITS TURN: asked of the GM']);
    const kesAsks = await asks({ username: 'kes' });
    expect(kesAsks).toEqual([expect.objectContaining({ sceneKey: 'main', locationId: kes, player: 'kes', who: 'KES', moment: 'turn_end',
      condition: expect.objectContaining({ id: 'poisoned', name: 'Poisoned' }), named: 'POISONED SAVE', says: 'POISONED SAVE, END OF ITS TURN: @con_mod, 3 or more ends it',
      // On the sheet (8a9c2): in Kes's words, the system's name for @con_mod, and Kes's own.
      yours: 'End of your turn: Con mod, 3 or more ends it.', mine: true })]);
    expect(await asks({ username: 'vex' })).toEqual([]);
    expect((await asks({ gm: true })).map((a) => a.who)).toEqual(['KES', 'GANGER (NPC)']);
    // The GM's: none of them the GM's own, Kes's said as Kes's on Kes's sheet.
    expect((await asks({ gm: true, username: 'gm' })).map((a) => a.mine)).toEqual([false, false]);
    // Asked with no name: an NPC's (no player) is still nobody's own.
    expect((await asks({ gm: true })).map((a) => a.mine)).toEqual([false, false]);
    // Nothing rolled yet: both still on.
    expect(await on(kes)).toEqual(['poisoned']);
  });

  it('rolled by the player: as the table would, said "rolled by KES", the ask gone; twice, nothing more', async () => {
    const kes = await token('KES', 'rhombus', 'kes', [{ id: 'poisoned' }, { id: 'burning' }]);
    await scene('main', [{ id: 'player:vex' }, { id: 'player:kes' }]);
    handlers['initiative:next']({ sceneKey: 'main' });
    await fired(1);
    const [burn] = await asks({ username: 'kes' });
    expect(burn.condition.id).toBe('burning');
    expect(await rollAsk(db, { io, runtime, system: ID, id: burn.id, username: 'kes' }))
      .toEqual({ ok: true, line: 'KES · BURNING, START OF ITS TURN · rolled by KES: 2 → 2 DAMAGE · HP 10 → 8' });
    expect(await hp(kes)).toBe(8);
    expect((await lines())[1]).toBe('KES · BURNING, START OF ITS TURN · rolled by KES: 2 → 2 DAMAGE · HP 10 → 8');
    expect(await asks({ username: 'kes' })).toEqual([]);
    expect(await rollAsk(db, { io, runtime, system: ID, id: burn.id, username: 'kes' })).toEqual({ ok: false, error: 'That roll isn\'t waiting any more' });
    expect(await hp(kes)).toBe(8);
    expect(emitted.filter((e) => e.event === 'turnAsksChanged').length).toBeGreaterThanOrEqual(2);
  });

  it('two clicks at once roll it once', async () => {
    const kes = await token('KES', 'rhombus', 'kes', [{ id: 'burning' }]);
    await scene('main', [{ id: 'player:vex' }, { id: 'player:kes' }]);
    handlers['initiative:next']({ sceneKey: 'main' });
    await fired(1);
    const [burn] = await asks({ username: 'kes' });
    const both = await Promise.all([1, 2].map(() => rollAsk(db, { io, runtime, system: ID, id: burn.id, username: 'kes' })));
    expect(both.filter((r) => r.ok)).toHaveLength(1);
    expect(both.filter((r) => !r.ok)).toEqual([{ ok: false, error: 'That roll isn\'t waiting any more' }]);
    expect(await hp(kes)).toBe(8);
  });

  it('who may roll: the player their own, the GM any (said "rolled by the GM"), an NPC\'s the GM alone', async () => {
    const kes = await token('KES', 'rhombus', 'kes', [{ id: 'poisoned' }]);
    const ganger = await token('GANGER', 'enemy_rhombus', 'gm', [{ id: 'poisoned' }]);
    await scene('main', [{ id: 'player:kes' }, { id: `npc:${ganger}` }, { id: 'player:vex' }]);
    handlers['initiative:next']({ sceneKey: 'main' });
    await fired(1);
    handlers['initiative:next']({ sceneKey: 'main' });
    await fired(2);
    const [mine, npcs] = await asks({ gm: true });
    expect(await rollAsk(db, { io, runtime, system: ID, id: mine.id, username: 'vex' })).toEqual({ ok: false, error: 'Only KES or the GM rolls that' });
    expect(await rollAsk(db, { io, runtime, system: ID, id: npcs.id, username: 'kes' })).toEqual({ ok: false, error: 'The GM rolls for an NPC' });
    // The GM rolls Kes's for them: CON 3 makes 3, POISONED off.
    expect(await rollAsk(db, { io, runtime, system: ID, id: mine.id, username: 'gm', gm: true }))
      .toEqual({ ok: true, line: 'KES · POISONED SAVE, END OF ITS TURN · rolled by the GM: @con_mod → 3 vs 3 · POISONED OFF' });
    expect(await on(kes)).toEqual([]);
    // The NPC's: no sheet, 0, stays on.
    expect((await rollAsk(db, { io, runtime, system: ID, id: npcs.id, username: 'gm', gm: true })).line)
      .toBe('GANGER (NPC) · POISONED SAVE, END OF ITS TURN · rolled by the GM: @con_mod → 0 vs 3 · stays on');
    expect(await on(ganger)).toEqual(['poisoned']);
  });

  it('let go: when the condition comes off first, a newer turn\'s in its place, the fight ended, the switch off', async () => {
    const kes = await token('KES', 'rhombus', 'kes', [{ id: 'poisoned' }]);
    await scene('main', [{ id: 'player:kes' }]);
    handlers['initiative:next']({ sceneKey: 'main' });
    await fired(1);
    // Round again: one ask, the newer.
    handlers['initiative:next']({ sceneKey: 'main' });
    await fired(2);
    const waiting = await asks({ gm: true });
    expect(waiting).toHaveLength(1);
    // Taken off by hand: let go, and rolling it says why.
    await run(db, "UPDATE locations SET conditions = '[]' WHERE id = ?", [kes]);
    expect(await rollAsk(db, { io, runtime, system: ID, id: waiting[0].id, username: 'kes' })).toEqual({ ok: false, error: 'POISONED is no longer on KES' });
    await run(db, `UPDATE locations SET conditions = '[{"id":"poisoned"}]' WHERE id = ?`, [kes]);
    handlers['initiative:next']({ sceneKey: 'main' });
    await fired(3);
    expect(await asks({ gm: true })).toHaveLength(1);
    await run(db, "UPDATE locations SET conditions = '[]' WHERE id = ?", [kes]);
    expect(await asks({ gm: true })).toEqual([]);
    // The fight ended: its asks with it.
    await run(db, `UPDATE locations SET conditions = '[{"id":"poisoned"}]' WHERE id = ?`, [kes]);
    handlers['initiative:next']({ sceneKey: 'main' });
    await fired(4);
    expect(await asks({ gm: true })).toHaveLength(1);
    handlers['initiative:end']({ sceneKey: 'main' });
    await until(async () => (await asks({ gm: true })).length === 0, { label: 'let go with the fight' });
    // The table's switch off: nothing asked.
    await run(db, 'INSERT INTO global_settings (key, value) VALUES (?, \'0\')', [TURN_EFFECTS_SETTING]);
    await scene('main', [{ id: 'player:kes' }]);
    handlers['initiative:next']({ sceneKey: 'main' });
    await until(async () => (await get(db, "SELECT turn_counter FROM initiative_scene WHERE scene_key = 'main'")).turn_counter === 2, { label: 'round on' });
    await drain(db);
    expect(await asks({ gm: true })).toEqual([]);
  });

  it('over the socket: a player asks for theirs and rolls one, answered; the GM sees all', async () => {
    await token('KES', 'rhombus', 'kes', [{ id: 'poisoned' }]);
    const ganger = await token('GANGER', 'enemy_rhombus', 'gm', [{ id: 'poisoned' }]);
    await scene('main', [{ id: 'player:kes' }, { id: `npc:${ganger}` }, { id: 'player:vex' }]);
    handlers['initiative:next']({ sceneKey: 'main' });
    await fired(1);
    handlers['initiative:next']({ sceneKey: 'main' });
    await fired(2);
    const users = new Map([['s-kes', { userName: 'kes', isAdmin: false }], ['s-gm', { userName: 'gm', isAdmin: true }]]);
    const connectAs = (sid) => {
      const h = {}; const sent = [];
      registerTurnAskHandlers({ id: sid, on: (e, fn) => { h[e] = fn; }, emit: (e, d) => sent.push({ event: e, data: d }) },
        { io, db, userSockets: users, isAdminSocket: (s) => !!users.get(s.id)?.isAdmin, getGameSystem: (cb) => cb(null, ID) });
      return { h, sent };
    };
    const kes = connectAs('s-kes');
    kes.h.requestTurnAsks();
    await until(async () => kes.sent.some((e) => e.event === 'turnAsks'), { label: 'listed' });
    // Kes's own, never the NPC's.
    const listed = kes.sent.find((e) => e.event === 'turnAsks').data;
    expect(listed.map((a) => a.who)).toEqual(['KES']);
    const [ask] = listed;
    const gm = connectAs('s-gm');
    gm.h.requestTurnAsks();
    await until(async () => gm.sent.some((e) => e.event === 'turnAsks'), { label: 'GM listed' });
    expect(gm.sent.find((e) => e.event === 'turnAsks').data).toHaveLength(2);
    const answer = await new Promise((done) => kes.h.turnRoll({ id: ask.id }, done));
    expect(answer).toEqual({ ok: true, line: 'KES · POISONED SAVE, END OF ITS TURN · rolled by KES: @con_mod → 3 vs 3 · POISONED OFF' });
    expect(await new Promise((done) => kes.h.turnRoll({}, done))).toEqual({ ok: false, error: 'Which roll?' });
    const stranger = { h: {} };
    registerTurnAskHandlers({ id: 's-none', on: (e, fn) => { stranger.h[e] = fn; }, emit: () => {} }, { io, db, userSockets: users, isAdminSocket: () => false, getGameSystem: (cb) => cb(null, ID) });
    expect(await new Promise((done) => stranger.h.turnRoll({ id: 1 }, done))).toEqual({ ok: false, error: 'Sign in first' });
  });

  it('a token in two fights: the log says which scene, by name', async () => {
    const plaza = (await run(db, "INSERT INTO locations (name, x, y, z, shape) VALUES ('Neon Plaza', 0, 0, 0, 'box')")).lastID;
    await run(db, "INSERT INTO battle_maps (location_id, designation, order_index) VALUES (?, 'Ground', 0), (?, 'Roof', 1)", [plaza, plaza]);
    await token('KES', 'rhombus', 'kes', [{ id: 'cursed' }]);
    await scene('city:0', [{ id: 'player:kes' }, { id: 'player:vex' }]);
    await scene(`${plaza}:1`, [{ id: 'player:kes' }]);
    handlers['initiative:next']({ sceneKey: 'city:0' });
    await fired(1);
    expect(await lines()).toEqual(['KES · CURSED SAVE, END OF ITS TURN in CITY MAP · rolled by the table: @con_mod → 3 vs 3 · CURSED OFF']);
    expect(await sceneName(db, `${plaza}:1`)).toBe('NEON PLAZA — ROOF');
    expect(await sceneName(db, `building:${plaza}`)).toBe('NEON PLAZA');
    expect(await sceneName(db, `${plaza}:7`)).toBe('NEON PLAZA');
    expect(await sceneName(db, 'odd')).toBe('odd');
  });
});
