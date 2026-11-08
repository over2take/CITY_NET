/**
 * MAX HEALTH: PER LEVEL (7d5a; approved mockup docs/mockups/level-up.html, 2026-11-07): the die on each class (its
 * HIT DIE) or one for all; AVERAGE (FIXED); EACH LEVEL ADDS read as the sheet is now. Level 1 the full die, each
 * level after it what it gained, kept as it went up; never less than 1 in a level. The token follows it.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { createRequire } from 'module';
import { makeTestDb, get, run } from './helpers/testDb.js';
import { drain, until } from './helpers/until.js';

process.env.JWT_SECRET = 'test-secret';

const require_ = createRequire(import.meta.url);
const { PICKS_KEY } = require_('../systemBuilder/choices');
const { healthOf, levelDie, averageOf, levelsShown, GAINS, HEALTH_LEVELS_KEY } = require_('../systemBuilder/levels');
const { healthByLevel, healthBase, keptOf } = require_('../systemBuilder/healthLevels');
const { levelAction } = require_('../systemBuilder/levelUp');
const { XP_KEY } = require_('../systemBuilder/levels');
const { checkDefinition } = require_('../systemBuilder/definition');
const citysys = require_('../systemBuilder/citysys');
const runtime = require_('../systemBuilder/runtime');
const socketsFactory = require_('../sockets/index.js');

const perLevel = (more = {}) => ({ health: { how: 'level', adds: '@con_mod', ...more }, top: 10 });
const HALE = {
  format: 1, name: 'Hale',
  core: { advancement: ['levels'] },
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'con', label: 'Constitution' }] }],
  derived: [{ id: 'con_mod', label: 'CON mod', formula: 'floor((@con - 10) / 2)' }],
  choices: [
    // A list without levels, ahead of the classes: what it holds is never level 1's die.
    { id: 'feats', one: 'Feat', many: 'Feats', picks: 'any', options: [{ id: 'tough', label: 'Tough' }] },
    { id: 'classes', one: 'Class', many: 'Classes', levelled: true, again: true, options: [
      { id: 'fighter', label: 'Fighter', die: 10 }, { id: 'wizard', label: 'Wizard', die: 6 }, { id: 'monk', label: 'Monk' },
    ] },
  ],
  levels: perLevel(),
};
const holding = (picks, more = {}) => ({ con: 14, [PICKS_KEY]: { classes: picks.map(([option, level]) => ({ option, level })) }, ...more });
const problems = (health) => checkDefinition({ ...HALE, levels: { health } }).problems.map((p) => `${p.where}: ${p.message}`);

describe('the setting', () => {
  it('reads as it was set, with what it falls back to', () => {
    const beat = { way: 'pool', count: 6, die: 10, gain: 6 };
    expect(healthOf(HALE)).toEqual({ how: 'level', dieOn: 'class', gain: 'average', adds: '@con_mod', beat });
    expect(healthOf({ levels: { health: { how: 'level', die_on: 'all', die: 8, adds: '  ' } } })).toEqual({ how: 'level', dieOn: 'all', die: 8, gain: 'average', beat });
    expect(healthOf({ levels: { health: { how: 'level', die_on: 'some', die: 1, gain: 'cards' } } })).toEqual({ how: 'level', dieOn: 'class', gain: 'average', beat });
    expect(healthOf({ levels: { health: { how: 'level', gain: 'choose' } } }).gain).toBe('choose');
    expect(GAINS).toEqual(['average', 'roll', 'choose', 'reroll', 'beat']);
  });

  it('checks clean, ON EACH CLASS or ONE FOR ALL with its die', () => {
    expect(problems(HALE.levels.health)).toEqual([]);
    expect(problems({ how: 'level', die_on: 'all', die: 12 })).toEqual([]);
    expect(problems({ how: 'level', gain: 'average' })).toEqual([]);
  });

  it('says what is wrong', () => {
    expect(problems({ how: 'level', die_on: 'each' })).toEqual(['levels, health, die_on: ON EACH CLASS or ONE FOR ALL']);
    expect(problems({ how: 'level', die_on: 'all' })).toEqual(['levels, health, die: Pick the die every level rolls']);
    expect(problems({ how: 'level', die_on: 'all', die: 1 })).toEqual(['levels, health, die: A die of 2 to 100 sides']);
    expect(problems({ how: 'level', die: 101 })).toEqual(['levels, health, die: A die of 2 to 100 sides']);
    expect(problems({ how: 'level', die: 'd8' })).toEqual(['levels, health, die: A die of 2 to 100 sides']);
    expect(problems({ how: 'level', gain: 'cards' })).toEqual(['levels, health, gain: AVERAGE (FIXED), ROLL, THE PLAYER CHOOSES, REROLL ALL, KEEP HIGHER or ROLL TO BEAT']);
    expect(problems({ how: 'level', gain: 'beat' })).toEqual([]);
    expect(problems({ how: 'level', gain: 'reroll' })).toEqual([]);
    expect(problems({ how: 'level', gain: 'roll' })).toEqual([]);
    expect(problems({ how: 'level', adds: '@con +' })[0]).toMatch(/^levels, health, adds: /);
    expect(problems({ how: 'level', adds: 3 })).toEqual(['levels, health, adds: Must be a formula']);
    expect(problems({ how: 'level', adds: '' })).toEqual([]);
    // Kept while another way is chosen, it isn't read.
    expect(problems({ how: 'as_is', adds: '@con +' })).toEqual([]);
    // ONE FOR ALL's die is wanted only while health is per level.
    expect(problems({ how: 'as_is', die_on: 'all' })).toEqual([]);
  });

  it('a level\'s die: its class\'s HIT DIE, or the one for all; the average, half rounded up', () => {
    const [fighter, , monk] = HALE.choices[1].options;
    expect(levelDie(HALE, fighter)).toBe(10);
    expect(levelDie(HALE, monk)).toBeNull();
    expect(levelDie(HALE, null)).toBeNull();
    const all = { ...HALE, levels: perLevel({ die_on: 'all', die: 8 }) };
    expect(levelDie(all, fighter)).toBe(8);
    expect(levelDie(all, null)).toBe(8);
    expect([averageOf(10), averageOf(7), averageOf(null)]).toEqual([5, 4, 0]);
  });

  it('the browser is told how a level gains it and each class\'s die', () => {
    expect(levelsShown(HALE).health).toEqual({ gain: 'average', dieOn: 'class', dice: { fighter: 10, wizard: 6 } });
    expect(levelsShown({ ...HALE, levels: perLevel({ die_on: 'all', die: 8 }) }).health).toEqual({ gain: 'average', dieOn: 'all', die: 8, dice: { fighter: 8, wizard: 8, monk: 8 } });
    expect(levelsShown({ ...HALE, levels: {} }).health).toBeUndefined();
  });

  it('travels in the system file, unchanged', () => {
    const read = citysys.readFile(JSON.stringify(citysys.buildFile({ definition: HALE, version: 1, origin: 'sys_abcdefabcdefabcd' })));
    expect(read.problems).toEqual([]);
    expect(read.file.definition.levels).toEqual(HALE.levels);
  });
});

describe('what it comes to', () => {
  it('level 1 the first class\'s full die, and what each level adds', () => {
    expect(healthByLevel(HALE, holding([['fighter', 1]]))).toEqual({ max: 12, adds: 2, levels: [{ level: 1, took: 10, die: 10 }] });
    const feat = holding([['fighter', 1]]);
    feat[PICKS_KEY].feats = [{ option: 'tough' }];
    expect(healthByLevel(HALE, feat).max).toBe(12);
    // What each level adds is whole, rounded down.
    expect(healthByLevel({ ...HALE, levels: perLevel({ adds: '@con / 4' }) }, holding([['fighter', 1]])).max).toBe(13);
  });

  it('each later level what it kept, or the average where it kept nothing, every one with what each level adds', () => {
    const data = holding([['fighter', 2], ['wizard', 1]], { [HEALTH_LEVELS_KEY]: { 2: { die: 10, took: 5 }, 3: { die: 6, took: 3 } } });
    expect(healthByLevel(HALE, data)).toEqual({ max: 12 + 7 + 5, adds: 2, levels: [{ level: 1, took: 10, die: 10 }, { level: 2, took: 5, die: 10 }, { level: 3, took: 3, die: 6 }] });
    expect(healthByLevel(HALE, holding([['fighter', 3]])).max).toBe(12 + 7 + 7);
  });

  it('a stat changing recounts every level; never less than 1 in one', () => {
    expect(healthByLevel(HALE, holding([['fighter', 3]], { con: 18 })).max).toBe(14 + 9 + 9);
    expect(healthByLevel(HALE, holding([['wizard', 3]], { con: 1 })).max).toBe(1 + 1 + 1);
    expect(healthByLevel(HALE, holding([['wizard', 3]], { con: 1 })).adds).toBe(-5);
  });

  it('a class with no HIT DIE, or none held, has only what each level adds', () => {
    expect(healthByLevel(HALE, holding([['monk', 2]])).max).toBe(2 + 2);
    expect(healthByLevel(HALE, { con: 14 }).max).toBe(2);
  });

  it('ONE FOR ALL, and with no EACH LEVEL ADDS', () => {
    const all = { ...HALE, levels: perLevel({ die_on: 'all', die: 8 }) };
    expect(healthByLevel(all, holding([['monk', 2]])).max).toBe(10 + 6);
    expect(healthByLevel({ ...HALE, levels: { health: { how: 'level' } } }, holding([['fighter', 2]])).max).toBe(10 + 5);
  });

  it('what isn\'t kept as a level\'s gain is passed over', () => {
    expect(keptOf({ [HEALTH_LEVELS_KEY]: { 2: { took: 4 }, 3: { took: -1 }, 4: { took: 2.5 }, 5: 'x', 6: { die: 8 } } })).toEqual({ 2: 4 });
    expect(keptOf({ [HEALTH_LEVELS_KEY]: [] })).toEqual({});
    expect(keptOf(null)).toEqual({});
  });

  it('nothing where health isn\'t per level; the base is the formula\'s or per level\'s', () => {
    expect(healthByLevel({ ...HALE, levels: {} }, holding([['fighter', 1]]))).toBeNull();
    expect(healthBase({ ...HALE, levels: {} }, holding([['fighter', 1]]))).toBeNull();
    expect(healthBase(HALE, holding([['fighter', 1]]))).toBe(12);
    expect(healthBase({ ...HALE, levels: { health: { how: 'formula', formula: '30' } } }, {})).toBe(30);
  });
});

describe('kept as they go up', () => {
  const up = (data, action = { kind: 'up' }) => levelAction(HALE, { [XP_KEY]: 9e9, ...data }, action);

  it('the class going up gains its average, under the level reached', () => {
    const done = up(holding([['fighter', 1]]));
    expect(done.data[HEALTH_LEVELS_KEY]).toEqual({ 2: { die: 10, took: 5 } });
    const next = up(done.data, { kind: 'up', list: 'classes', option: 'wizard' });
    expect(next.data[HEALTH_LEVELS_KEY]).toEqual({ 2: { die: 10, took: 5 }, 3: { die: 6, took: 3 } });
  });

  it('a class with no HIT DIE keeps nothing gained from a die', () => {
    expect(up(holding([['monk', 1]])).data[HEALTH_LEVELS_KEY]).toEqual({ 2: { die: null, took: 0 } });
  });

  it('the level itself goes up by the first class\'s die, or the one for all', () => {
    const all = { ...HALE, choices: [], levels: perLevel({ die_on: 'all', die: 8 }) };
    expect(levelAction(all, { [XP_KEY]: 9e9, level: 1 }, { kind: 'up' }).data[HEALTH_LEVELS_KEY]).toEqual({ 2: { die: 8, took: 4 } });
    const stat = { ...HALE, choices: [], levels: perLevel() };
    expect(levelAction(stat, { [XP_KEY]: 9e9, level: 1 }, { kind: 'up' }).data[HEALTH_LEVELS_KEY]).toEqual({ 2: { die: null, took: 0 } });
  });

  it('nothing kept where health isn\'t per level', () => {
    expect(HEALTH_LEVELS_KEY in levelAction({ ...HALE, levels: {} }, { [XP_KEY]: 9e9, ...holding([['fighter', 1]]) }, { kind: 'up' }).data).toBe(false);
  });

  it('LEVEL_DOWN takes off what the level it leaves gained, and only that', () => {
    const data = holding([['fighter', 3]], { [HEALTH_LEVELS_KEY]: { 2: { die: 10, took: 5 }, 3: { die: 10, took: 5 } } });
    expect(levelAction(HALE, data, { kind: 'down' }, { gm: true }).data[HEALTH_LEVELS_KEY]).toEqual({ 2: { die: 10, took: 5 } });
    expect(levelAction(HALE, holding([['fighter', 3]]), { kind: 'down' }, { gm: true }).data[HEALTH_LEVELS_KEY]).toBeUndefined();
    const given = { ...data, _levels_owed: 1 };
    expect(levelAction(HALE, given, { kind: 'down' }, { gm: true }).data[HEALTH_LEVELS_KEY]).toEqual(data[HEALTH_LEVELS_KEY]);
  });
});

describe('at the table', () => {
  const ID = 'sys_halehalehalehaleha';
  const GM = jwt.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, 'test-secret');
  let db;
  let emitUpdate;
  const join = async (who, identity) => {
    let connection;
    socketsFactory({ on: (e, cb) => { if (e === 'connection') connection = cb; }, emit: () => {}, to: () => ({ emit: () => {} }) },
      db, { elevatedUsers: new Set(), emitUpdate, recordAction: vi.fn() });
    const handlers = {};
    connection({ id: `hl-${who}`, on: (e, fn) => { handlers[e] = fn; }, emit: () => {}, broadcast: { emit: () => {} }, use: () => {}, join: () => {}, disconnect: () => {} });
    handlers.identify(identity);
    await drain(db);
    return { handlers };
  };
  const tokenOf = () => get(db, `SELECT hp_current, hp_max FROM locations WHERE owner = 'kes' AND shape = 'rhombus' ORDER BY id LIMIT 1`);
  const sheetOf = async () => JSON.parse((await get(db, 'SELECT data FROM character_sheets WHERE username = ?', ['kes'])).data);
  const healthIs = (current, max, label) => until(async () => { const t = await tokenOf(); return t.hp_current === current && t.hp_max === max; }, { label });

  beforeEach(async () => {
    db = await makeTestDb();
    emitUpdate = vi.fn();
    const def = JSON.stringify(HALE);
    await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', [ID, 'Hale', def, def]);
    await new Promise((resolve) => runtime.load(db, resolve));
    await run(db, `INSERT INTO global_settings (key, value) VALUES ('game_system', ?)`, [ID]);
    await run(db, `INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('kes', ?, ?, 0)`, [ID, JSON.stringify(holding([['fighter', 1]], { [XP_KEY]: 9000 }))]);
    await run(db, `INSERT INTO locations (name, x, y, z, shape, owner, hp_current, hp_max) VALUES ('Kes', 0, 0, 0, 'rhombus', 'kes', 12, 12)`);
  });

  it('a level up adds its gain to the token, the sheet saying what it comes to; a stat recounts every level', async () => {
    const kes = await join('kes', 'kes');
    kes.handlers.levelAction({ kind: 'up' });
    await healthIs(19, 19, 'level 2: 12 + 5 + 2');
    const sheet = await sheetOf();
    expect(sheet[HEALTH_LEVELS_KEY]).toEqual({ 2: { die: 10, took: 5 } });
    expect(sheet._health).toEqual({ max: 19, adds: 2, levels: [{ level: 1, took: 10, die: 10 }, { level: 2, took: 5, die: 10 }] });
    kes.handlers.updateSheetField({ fieldId: 'con', value: 18 });
    await healthIs(23, 23, 'CON 18: 14 + 9');
  });

  it('LEVEL_DOWN takes that level\'s gain back off the token', async () => {
    const kes = await join('kes', 'kes');
    kes.handlers.levelAction({ kind: 'up' });
    await healthIs(19, 19, 'up');
    const gm = await join('gm', { userName: 'gm', isAdmin: true, token: GM });
    gm.handlers.adminAdjustLevel({ token: GM, usernames: ['kes'], delta: -1 });
    await healthIs(12, 12, 'down again');
    expect((await sheetOf())[HEALTH_LEVELS_KEY]).toEqual({});
  });
});

describe('ROLL TO BEAT (7d5d)', () => {
  const { LEVELING_KEY, healthRollLine } = require_('../systemBuilder/levelUp');
  const { rollToBeat } = require_('../systemBuilder/healthLevels');
  const beat = (more = {}) => ({ ...HALE, levels: perLevel({ gain: 'beat', ...more }) });
  const POOL = beat();
  const BY_LEVEL = beat({ beat_way: 'level' });
  // Each roll a d10's, or [roll, die] for another die.
  const seq = (...rolls) => { let i = 0; return () => { const r = rolls[i++]; const [roll, die] = Array.isArray(r) ? r : [r, 10]; return (roll - 1) / die + 0.01; }; };
  // Fighter 2 with CON 14 (+2): 19 now.
  const two = { [XP_KEY]: 9e9, ...holding([['fighter', 2]]), [HEALTH_LEVELS_KEY]: { 2: { die: 10, took: 5 } } };

  it('the settings, and what they start at: 6d10 to beat, d6 gained', () => {
    expect(healthOf(POOL).beat).toEqual({ way: 'pool', count: 6, die: 10, gain: 6 });
    expect(healthOf(beat({ beat_way: 'level', pool_count: 3, pool_die: 8, gain_die: 4 })).beat).toEqual({ way: 'level', count: 3, die: 8, gain: 4 });
    expect(healthOf(beat({ beat_way: 'some', pool_count: 0, pool_die: 1, gain_die: 'd6' })).beat).toEqual({ way: 'pool', count: 6, die: 10, gain: 6 });
    expect(healthOf(beat({ pool_count: 21 })).beat.count).toBe(6);
    // Dice past 100 sides, or not whole, go back to what they start at.
    expect(healthOf(beat({ pool_die: 101, gain_die: 101 })).beat).toMatchObject({ die: 10, gain: 6 });
    expect(healthOf(beat({ pool_die: 7.5, gain_die: 4.5 })).beat).toMatchObject({ die: 10, gain: 6 });
    expect(levelsShown(POOL).health.beat).toEqual({ way: 'pool', count: 6, die: 10, gain: 6 });
    expect(levelsShown(HALE).health.beat).toBeUndefined();
  });

  it('travels in the system file, unchanged', () => {
    const def = beat({ beat_way: 'level', pool_count: 4, pool_die: 8, gain_die: 4 });
    const read = citysys.readFile(JSON.stringify(citysys.buildFile({ definition: def, version: 1, origin: 'sys_abcdefabcdefabcd' })));
    expect(read.problems).toEqual([]);
    expect(read.file.definition.levels).toEqual(def.levels);
  });

  it('checks what it is given', () => {
    expect(problems({ how: 'level', gain: 'beat', beat_way: 'pool', pool_count: 20, pool_die: 10, gain_die: 6 })).toEqual([]);
    expect(problems({ how: 'level', gain: 'beat', beat_way: 'cards' })).toEqual(['levels, health, beat_way: A POOL or A DIE PER LEVEL']);
    expect(problems({ how: 'level', gain: 'beat', pool_count: 0 })).toEqual(['levels, health, pool_count: From 1 to 20 dice']);
    expect(problems({ how: 'level', gain: 'beat', pool_count: 21 })).toEqual(['levels, health, pool_count: From 1 to 20 dice']);
    expect(problems({ how: 'level', gain: 'beat', pool_count: 2.5 })).toEqual(['levels, health, pool_count: From 1 to 20 dice']);
    expect(problems({ how: 'level', gain: 'beat', pool_die: 1, gain_die: 101 })).toEqual(['levels, health, pool_die: A die of 2 to 100 sides', 'levels, health, gain_die: A die of 2 to 100 sides']);
  });

  it('a pool beaten: the gain die\'s roll; not beaten, or only equalled: nothing', () => {
    expect(rollToBeat(POOL, two, 10, seq(9, 9, 9, 9, 9, 9, [4, 6]))).toEqual({
      total: 54, rolls: Array(6).fill({ die: 10, roll: 9 }), over: 19, beaten: true, gained: 4, gainRoll: { die: 6, roll: 4 },
    });
    expect(rollToBeat(POOL, two, 10, seq(1, 1, 1, 1, 1, 1))).toMatchObject({ total: 6, beaten: false, gained: 0, gainRoll: null });
    expect(rollToBeat(POOL, two, 10, seq(4, 3, 3, 3, 3, 3))).toMatchObject({ total: 19, beaten: false, gained: 0 });
  });

  it('a die per level: every level\'s die and the new one, with what each adds; beaten, the new die again and what it adds', () => {
    expect(rollToBeat(BY_LEVEL, two, 10, seq(9, 9, 9, 3))).toEqual({
      total: 27 + 6, rolls: [{ die: 10, roll: 9 }, { die: 10, roll: 9 }, { die: 10, roll: 9 }], over: 19, beaten: true, gained: 3 + 2, gainRoll: { die: 10, roll: 3 },
    });
    expect(rollToBeat(BY_LEVEL, two, 10, seq(1, 1, 1))).toMatchObject({ beaten: false, gained: 0 });
    // A class with no die: only what each level adds, at least 1 when beaten.
    const weak = { ...HALE, stats: HALE.stats, levels: perLevel({ gain: 'beat', beat_way: 'level', adds: '-9' }) };
    expect(rollToBeat(weak, { ...holding([['monk', 1]]) }, null, () => 0.99)).toMatchObject({ rolls: [], total: -18, over: 1, beaten: false, gained: 0 });
  });

  it('a die per level beaten, the new die low and what each level adds below nothing: still at least 1', () => {
    // A d10 Fighter, -3 a level: 7. Both dice 10, less 6, is 14: beaten; the new die again is 1, less 3: 1 all the same.
    const harsh = { ...HALE, levels: perLevel({ gain: 'beat', beat_way: 'level', adds: '-3' }) };
    expect(rollToBeat(harsh, holding([['fighter', 1]]), 10, seq(10, 10, 1))).toMatchObject({ total: 14, over: 7, beaten: true, gained: 1 });
  });

  it('a die per level beaten with nothing to roll still gains at least 1', () => {
    const tiny = { ...HALE, levels: perLevel({ gain: 'beat', beat_way: 'level', adds: '50' }) };
    expect(rollToBeat(tiny, { ...holding([['monk', 1]]) }, null, () => 0.5)).toMatchObject({ beaten: true, gained: 50, gainRoll: null });
  });

  it('rolled in the window: kept, its dice for the tray, and the line', () => {
    const done = levelAction(POOL, two, { kind: 'healthRoll', list: 'classes', option: 'fighter' }, { rng: seq(9, 9, 9, 9, 9, 9, [4, 6]) });
    expect(done.data[LEVELING_KEY].health).toEqual({ roll: 54, die: 10, gained: 4, over: 19, beat: true });
    expect(done.rolled).toEqual({ results: { 10: [9, 9, 9, 9, 9, 9] }, total: 54, over: 19, gained: 4, dice: 6, beat: true, gainDie: 6 });
    expect(healthRollLine('Wren', done.rolled)).toBe('Wren rolled Health to beat 19, 6 dice [54]: beaten, +4 (d6)');
    expect(healthRollLine('Wren', { results: { 10: [1] }, total: 6, over: 19, gained: 0, dice: 1, beat: true })).toBe('Wren rolled Health to beat 19, 1 die [6]: not beaten, nothing gained');
  });

  it('a pool is rolled even for a class with no HIT DIE', () => {
    const monk = { [XP_KEY]: 9e9, ...holding([['monk', 1]]) };
    expect(levelAction(POOL, monk, { kind: 'healthRoll', list: 'classes', option: 'monk' }, { rng: seq(1, 1, 1, 1, 1, 1) }).ok).toBe(true);
    expect(levelAction(POOL, monk, { kind: 'up', list: 'classes', option: 'monk' }).error).toBe('Roll for health first');
    expect(levelAction(BY_LEVEL, monk, { kind: 'healthRoll', list: 'classes', option: 'monk' }).error).toBe('Nothing to roll: Monk has no HIT DIE');
  });

  it('FINISH keeps what it gained, nothing included, as that level\'s; the GM without a roll gains nothing', () => {
    const rolled = levelAction(POOL, two, { kind: 'healthRoll', list: 'classes', option: 'fighter' }, { rng: seq(1, 1, 1, 1, 1, 1) }).data;
    const up = levelAction(POOL, rolled, { kind: 'up', list: 'classes', option: 'fighter' }).data;
    expect(up[HEALTH_LEVELS_KEY][3]).toEqual({ die: 10, took: 6, rolled: true, gained: 0 });
    expect(healthByLevel(POOL, up).max).toBe(19);
    expect(levelAction(POOL, two, { kind: 'up', list: 'classes', option: 'fighter' }, { gm: true }).data[HEALTH_LEVELS_KEY][3]).toEqual({ die: 10, took: 0, gained: 0 });
    expect(levelAction(POOL, two, { kind: 'up', list: 'classes', option: 'fighter' }).error).toBe('Roll for health first');
  });

  it('through the socket: the pool thrown, and what it gained', async () => {
    const db = await makeTestDb();
    await run(db, 'CREATE TABLE IF NOT EXISTS dice_rolls (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, total INTEGER, results TEXT, color TEXT, historyString TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)');
    const ID = 'sys_beatbeatbeatbeat';
    const def = JSON.stringify({ ...POOL, name: 'Beating' });
    await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', [ID, 'Beating', def, def]);
    await new Promise((resolve) => runtime.load(db, resolve));
    await run(db, `INSERT INTO global_settings (key, value) VALUES ('game_system', ?)`, [ID]);
    await run(db, `INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('wen', ?, ?, 0)`, [ID, JSON.stringify({ name: 'Wren', ...two })]);
    let connection;
    const shared = [];
    socketsFactory({ on: (e, cb) => { if (e === 'connection') connection = cb; }, emit: (event, data) => shared.push({ event, data }), to: () => ({ emit: () => {} }) },
      db, { elevatedUsers: new Set(), emitUpdate: vi.fn(), recordAction: vi.fn() });
    const handlers = {};
    connection({ id: 'beat-wen', on: (e, fn) => { handlers[e] = fn; }, emit: () => {}, broadcast: { emit: () => {} }, use: () => {}, join: () => {}, disconnect: () => {} });
    handlers.identify('wen');
    await drain(db);
    handlers.levelAction({ kind: 'healthRoll', list: 'classes', option: 'fighter' });
    await until(() => shared.some((e) => e.event === 'diceRollBroadcast'), { label: 'thrown' });
    const thrown = shared.find((e) => e.event === 'diceRollBroadcast').data;
    expect(thrown.results[10]).toHaveLength(6);
    expect(thrown.historyString).toMatch(/^Wren rolled Health to beat 19, 6 dice \[\d+\]: (beaten, \+[1-6] \(d6\)|not beaten, nothing gained)$/);
  });
});

describe('REROLL ALL, KEEP HIGHER (7d5c)', () => {
  const { LEVELING_KEY, healthRollLine } = require_('../systemBuilder/levelUp');
  const { rerollAll } = require_('../systemBuilder/healthLevels');
  const REROLL = { ...HALE, levels: perLevel({ gain: 'reroll' }) };
  const at = (n) => () => (n - 1) / 10 + 0.01; // every d10 lands on n
  // Fighter 2 with CON 14 (+2): 12 + 7 = 19 now.
  const two = { [XP_KEY]: 9e9, ...holding([['fighter', 2]]), [HEALTH_LEVELS_KEY]: { 2: { die: 10, took: 5 } } };

  it('every level\'s die and the new one, each with what each level adds: over 19, the new maximum', () => {
    expect(rerollAll(REROLL, two, 10, at(9))).toEqual({ total: 27 + 6, rolls: [{ die: 10, roll: 9 }, { die: 10, roll: 9 }, { die: 10, roll: 9 }], over: 19, gained: 33 - 19 });
  });

  it('not over: +1', () => {
    expect(rerollAll(REROLL, two, 10, at(1))).toMatchObject({ total: 3 + 6, over: 19, gained: 1 });
    // Equal isn't over: 5 + 4 + 4 and 6 come to 19.
    const seq = (...rolls) => { let i = 0; return () => (rolls[i++] - 1) / 10 + 0.01; };
    expect(rerollAll(REROLL, two, 10, seq(5, 4, 4))).toMatchObject({ total: 19, over: 19, gained: 1 });
    expect(rerollAll(REROLL, two, 10, seq(5, 5, 4))).toMatchObject({ total: 20, over: 19, gained: 1 });
  });

  it('each level its own die, a class\'s taken up later its own; a level with none rolls nothing', () => {
    const mixed = { ...two, ...holding([['fighter', 2], ['wizard', 1]]), [HEALTH_LEVELS_KEY]: { 2: { die: 10, took: 5 }, 3: { die: 6, took: 3 } } };
    expect(rerollAll(REROLL, mixed, 6, () => 0.99).rolls.map((r) => r.die)).toEqual([10, 10, 6, 6]);
    const monk = { [XP_KEY]: 9e9, ...holding([['monk', 1]]) };
    expect(rerollAll(REROLL, monk, null, () => 0.99)).toMatchObject({ rolls: [], total: 4 });
  });

  it('rolled in the window: kept with the place, its dice for the tray, and the line saying how it went', () => {
    const done = levelAction(REROLL, two, { kind: 'healthRoll', list: 'classes', option: 'fighter' }, { rng: at(9) });
    expect(done.data[LEVELING_KEY].health).toEqual({ roll: 33, die: 10, gained: 14, over: 19 });
    expect(done.rolled).toEqual({ results: { 10: [9, 9, 9] }, total: 33, over: 19, gained: 14, dice: 3 });
    expect(healthRollLine('Wren', done.rolled)).toBe('Wren rerolled Health, 3 dice [33]: over 19, the new maximum');
    expect(healthRollLine('Wren', { results: { 10: [1] }, total: 9, over: 19, gained: 1, dice: 1 })).toBe('Wren rerolled Health, 1 die [9]: not over 19, +1');
  });

  it('FINISH keeps what it added as that level\'s, not recounted when a stat changes', () => {
    const rolled = levelAction(REROLL, two, { kind: 'healthRoll', list: 'classes', option: 'fighter' }, { rng: at(9) }).data;
    const up = levelAction(REROLL, rolled, { kind: 'up', list: 'classes', option: 'fighter' }).data;
    expect(up[HEALTH_LEVELS_KEY][3]).toEqual({ die: 10, took: 33, rolled: true, gained: 14 });
    expect(healthByLevel(REROLL, up).max).toBe(33);
    // CON 18 (+4): levels 1 and 2 recount, level 3 keeps its 14.
    expect(healthByLevel(REROLL, { ...up, con: 18 }).max).toBe(14 + 9 + 14);
    expect(healthByLevel(REROLL, up).levels[2]).toEqual({ level: 3, took: 33, die: 10, gained: 14 });
  });

  it('a kept gain that isn\'t a whole amount from 0 is passed over', () => {
    // A gain of 0 is kept (an unbeaten roll to beat, 7d5d); one that isn't whole is passed over.
    const data = { ...holding([['fighter', 3]]), [HEALTH_LEVELS_KEY]: { 2: { die: 10, took: 5, gained: 0 }, 3: { die: 10, took: 5, gained: 2.5 } } };
    expect(healthByLevel(REROLL, data).max).toBe(12 + 0 + 7);
    const below = { ...holding([['fighter', 2]]), [HEALTH_LEVELS_KEY]: { 2: { die: 10, took: 5, gained: -3 } } };
    expect(healthByLevel(REROLL, below).max).toBe(12 + 7);
  });

  it('won\'t finish without the roll; the GM goes on the average', () => {
    expect(levelAction(REROLL, two, { kind: 'up', list: 'classes', option: 'fighter' }).error).toBe('Roll for health first');
    expect(levelAction(REROLL, two, { kind: 'up', list: 'classes', option: 'fighter' }, { gm: true }).data[HEALTH_LEVELS_KEY][3]).toEqual({ die: 10, took: 5 });
  });

  it('through the socket: several dice thrown at once', async () => {
    const db = await makeTestDb();
    await run(db, 'CREATE TABLE IF NOT EXISTS dice_rolls (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, total INTEGER, results TEXT, color TEXT, historyString TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)');
    const ID = 'sys_rerollrerollreroll';
    const def = JSON.stringify({ ...REROLL, name: 'Rerolling' });
    await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', [ID, 'Rerolling', def, def]);
    await new Promise((resolve) => runtime.load(db, resolve));
    await run(db, `INSERT INTO global_settings (key, value) VALUES ('game_system', ?)`, [ID]);
    await run(db, `INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('kes', ?, ?, 0)`, [ID, JSON.stringify({ name: 'Kestrel', ...two })]);
    let connection;
    const shared = [];
    socketsFactory({ on: (e, cb) => { if (e === 'connection') connection = cb; }, emit: (event, data) => shared.push({ event, data }), to: () => ({ emit: () => {} }) },
      db, { elevatedUsers: new Set(), emitUpdate: vi.fn(), recordAction: vi.fn() });
    const handlers = {};
    connection({ id: 'reroll-kes', on: (e, fn) => { handlers[e] = fn; }, emit: () => {}, broadcast: { emit: () => {} }, use: () => {}, join: () => {}, disconnect: () => {} });
    handlers.identify('kes');
    await drain(db);
    handlers.levelAction({ kind: 'healthRoll', list: 'classes', option: 'fighter' });
    await until(() => shared.some((e) => e.event === 'diceRollBroadcast'), { label: 'thrown' });
    const thrown = shared.find((e) => e.event === 'diceRollBroadcast').data;
    expect(thrown.results[10]).toHaveLength(3);
    expect(thrown.historyString).toMatch(/^Kestrel rerolled Health, 3 dice \[\d+\]: (over 19, the new maximum|not over 19, \+1)$/);
  });
});

describe('ROLL and THE PLAYER CHOOSES (7d5b)', () => {
  const { LEVELING_KEY, healthRollLine } = require_('../systemBuilder/levelUp');
  const { ROLLED_KEPT } = require_('../systemBuilder/creation');
  const gained = (gain) => ({ ...HALE, levels: perLevel({ gain }) });
  const ROLL = gained('roll');
  const CHOOSE = gained('choose');
  const fixed = (n) => () => (n - 1) / 10 + 0.01; // a d10 lands on n
  const ready = (more = {}) => ({ [XP_KEY]: 9e9, ...holding([['fighter', 1], ['wizard', 1]]), ...more });
  const act = (def, data, action, opts = {}) => levelAction(def, data, action, opts);

  it('a roll of the class\'s die, kept with the place for that class, given back for the tray', () => {
    const done = act(ROLL, ready(), { kind: 'healthRoll', list: 'classes', option: 'fighter' }, { rng: fixed(7) });
    expect(done.data[LEVELING_KEY]).toEqual({ list: 'classes', option: 'fighter', health: { roll: 7, die: 10 } });
    expect(done.rolled).toEqual({ sides: 10, rolls: [7], total: 7 });
    expect(healthRollLine('Wren', done.rolled)).toBe('Wren rolled Health (d10) [7]');
  });

  it('kept: no second roll, no average, no other class for a player; the GM may', () => {
    const rolled = act(ROLL, ready(), { kind: 'healthRoll', list: 'classes', option: 'fighter' }, { rng: fixed(2) }).data;
    expect(act(ROLL, rolled, { kind: 'healthRoll', list: 'classes', option: 'fighter' }).error).toBe(ROLLED_KEPT);
    expect(act(CHOOSE, rolled, { kind: 'healthAverage', list: 'classes', option: 'fighter' }).error).toBe(ROLLED_KEPT);
    expect(act(ROLL, rolled, { kind: 'place', list: 'classes', option: 'wizard' }).error).toBe('Rolled for health, and kept: your GM can clear it to change class');
    expect(act(ROLL, rolled, { kind: 'healthRoll', list: 'classes', option: 'wizard' }).error).toBe('Rolled for health, and kept: your GM can clear it to change class');
    expect(act(ROLL, rolled, { kind: 'healthRoll', list: 'classes', option: 'fighter' }, { gm: true, rng: fixed(9) }).data[LEVELING_KEY].health.roll).toBe(9);
    expect(act(ROLL, rolled, { kind: 'place', list: 'classes', option: 'wizard' }, { gm: true }).ok).toBe(true);
  });

  it('the average taken is no roll: another class can still be chosen', () => {
    const took = act(CHOOSE, ready(), { kind: 'healthAverage', list: 'classes', option: 'fighter' }).data;
    expect(act(CHOOSE, took, { kind: 'place', list: 'classes', option: 'wizard' }).data[LEVELING_KEY]).toEqual({ list: 'classes', option: 'wizard' });
  });

  it('a class with no HIT DIE has nothing to roll: ROLL finishes on what each level adds', () => {
    const monk = ready({ ...holding([['monk', 1]]) });
    expect(act(ROLL, monk, { kind: 'up', list: 'classes', option: 'monk' }).data[HEALTH_LEVELS_KEY]).toEqual({ 2: { die: null, took: 0 } });
  });

  it('the same class placed again keeps the roll, and its picks', () => {
    const rolled = act(ROLL, ready(), { kind: 'healthRoll', list: 'classes', option: 'fighter' }, { rng: fixed(2) }).data;
    const placed = act(ROLL, rolled, { kind: 'place', list: 'classes', option: 'fighter', picks: [{ list: 'x', option: 'y' }] }).data;
    expect(placed[LEVELING_KEY]).toEqual({ list: 'classes', option: 'fighter', picks: [{ list: 'x', option: 'y' }], health: { roll: 2, die: 10 } });
    expect(act(ROLL, placed, { kind: 'healthRoll', list: 'classes', option: 'fighter' }, { gm: true, rng: fixed(5) }).data[LEVELING_KEY].picks).toEqual([{ list: 'x', option: 'y' }]);
  });

  it('FINISH takes the roll as the level\'s, and won\'t go without one; the GM goes on the average', () => {
    expect(act(ROLL, ready(), { kind: 'up', list: 'classes', option: 'fighter' }).error).toBe('Roll for health first');
    const rolled = act(ROLL, ready(), { kind: 'healthRoll', list: 'classes', option: 'fighter' }, { rng: fixed(9) }).data;
    const up = act(ROLL, rolled, { kind: 'up', list: 'classes', option: 'fighter' });
    expect(up.data[HEALTH_LEVELS_KEY]).toEqual({ 3: { die: 10, took: 9, rolled: true } });
    expect(LEVELING_KEY in up.data).toBe(false);
    expect(act(ROLL, ready(), { kind: 'up', list: 'classes', option: 'fighter' }, { gm: true }).data[HEALTH_LEVELS_KEY]).toEqual({ 3: { die: 10, took: 5 } });
    // A roll for another class is none for this one.
    expect(act(ROLL, rolled, { kind: 'up', list: 'classes', option: 'wizard' }, { gm: true }).data[HEALTH_LEVELS_KEY]).toEqual({ 3: { die: 6, took: 3 } });
  });

  it('THE PLAYER CHOOSES: the average taken, then FINISH; or a roll; neither yet, not yet', () => {
    expect(act(CHOOSE, ready(), { kind: 'up', list: 'classes', option: 'fighter' }).error).toBe('Take the average or roll for health first');
    const took = act(CHOOSE, ready(), { kind: 'healthAverage', list: 'classes', option: 'fighter' }).data;
    expect(took[LEVELING_KEY].health).toEqual({ average: true });
    expect(act(CHOOSE, took, { kind: 'up', list: 'classes', option: 'fighter' }).data[HEALTH_LEVELS_KEY]).toEqual({ 3: { die: 10, took: 5 } });
    // Taking the average isn't a roll: they can still roll, and that is kept.
    const then = act(CHOOSE, took, { kind: 'healthRoll', list: 'classes', option: 'fighter' }, { rng: fixed(1) });
    expect(then.data[LEVELING_KEY].health).toEqual({ roll: 1, die: 10 });
  });

  it('only where health is rolled or chosen, a die there is, and the level is ready', () => {
    expect(act(HALE, ready(), { kind: 'healthRoll', list: 'classes', option: 'fighter' }).error).toBe("Health isn't rolled in this game");
    expect(act(ROLL, ready(), { kind: 'healthAverage', list: 'classes', option: 'fighter' }).error).toBe("Health here isn't the player's to choose");
    expect(act({ ...HALE, levels: { health: { how: 'formula', formula: '3' } } }, ready(), { kind: 'healthRoll', list: 'classes', option: 'fighter' }).error).toBe("Health isn't rolled in this game");
    expect(act(ROLL, ready({ ...holding([['monk', 1]]) }), { kind: 'healthRoll', list: 'classes', option: 'monk' }).error).toBe('Nothing to roll: Monk has no HIT DIE');
    const stat = { ...ROLL, choices: [], levels: perLevel({ gain: 'roll' }) };
    expect(act(stat, { [XP_KEY]: 9e9, level: 1 }, { kind: 'healthRoll' }).error).toBe('Nothing to roll: there is no die for every level');
    expect(act(ROLL, { ...ready(), [XP_KEY]: 0 }, { kind: 'healthRoll', list: 'classes', option: 'fighter' }).error).toMatch(/^Not yet/);
    expect(act(ROLL, ready({ ...holding([['fighter', 10]]) }), { kind: 'healthRoll', list: 'classes', option: 'fighter' }).error).toBe('Already the highest level');
    expect(act(ROLL, ready(), { kind: 'healthRoll', list: 'classes', option: 'rogue' }).error).toBe("This character doesn't hold that");
    expect(act(ROLL, { ...ready(), [XP_KEY]: 0 }, { kind: 'healthRoll', list: 'classes', option: 'fighter' }, { gm: true, rng: fixed(3) }).ok).toBe(true);
  });

  it('the level itself rolls the die for all', () => {
    const stat = { ...ROLL, choices: [], levels: perLevel({ gain: 'roll', die_on: 'all', die: 8 }) };
    const rolled = act(stat, { [XP_KEY]: 9e9, level: 1 }, { kind: 'healthRoll' }, { rng: () => 0.99 });
    expect(rolled.data[LEVELING_KEY]).toEqual({ health: { roll: 8, die: 8 } });
    expect(act(stat, rolled.data, { kind: 'up' }).data[HEALTH_LEVELS_KEY]).toEqual({ 2: { die: 8, took: 8, rolled: true } });
  });

  it('CLEAR THE ROLL: the GM\'s, taking the roll off and leaving the place', () => {
    const rolled = act(ROLL, ready(), { kind: 'healthRoll', list: 'classes', option: 'fighter' }, { rng: fixed(2) }).data;
    expect(act(ROLL, rolled, { kind: 'clearHealth' }).error).toBe("That is the GM's to do");
    const cleared = act(ROLL, rolled, { kind: 'clearHealth' }, { gm: true }).data;
    expect(cleared[LEVELING_KEY]).toEqual({ list: 'classes', option: 'fighter' });
    expect(act(ROLL, cleared, { kind: 'clearHealth' }, { gm: true }).error).toBe('Nothing rolled there to clear');
    const took = act(CHOOSE, ready(), { kind: 'healthAverage', list: 'classes', option: 'fighter' }).data;
    expect(act(CHOOSE, took, { kind: 'clearHealth' }, { gm: true }).error).toBe('Nothing rolled there to clear');
    expect(act(ROLL, ready(), { kind: 'clearHealth' }, { gm: true }).error).toBe('Nothing rolled there to clear');
    expect(act(ROLL, cleared, { kind: 'healthRoll', list: 'classes', option: 'fighter' }, { rng: fixed(10) }).data[LEVELING_KEY].health.roll).toBe(10);
  });

  it('through the socket: thrown in the tray and the log, under the character\'s name', async () => {
    const db = await makeTestDb();
    await run(db, 'CREATE TABLE IF NOT EXISTS dice_rolls (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, total INTEGER, results TEXT, color TEXT, historyString TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)');
    const ID = 'sys_rollrollrollrollro';
    const def = JSON.stringify({ ...ROLL, name: 'Rolling' });
    await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', [ID, 'Rolling', def, def]);
    await new Promise((resolve) => runtime.load(db, resolve));
    await run(db, `INSERT INTO global_settings (key, value) VALUES ('game_system', ?)`, [ID]);
    await run(db, `INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('kes', ?, ?, 0)`, [ID, JSON.stringify({ name: 'Kestrel', ...ready() })]);
    let connection;
    const shared = [];
    socketsFactory({ on: (e, cb) => { if (e === 'connection') connection = cb; }, emit: (event, data) => shared.push({ event, data }), to: () => ({ emit: () => {} }) },
      db, { elevatedUsers: new Set(), emitUpdate: vi.fn(), recordAction: vi.fn() });
    const handlers = {};
    connection({ id: 'roll-kes', on: (e, fn) => { handlers[e] = fn; }, emit: () => {}, broadcast: { emit: () => {} }, use: () => {}, join: () => {}, disconnect: () => {} });
    handlers.identify('kes');
    await drain(db);
    handlers.levelAction({ kind: 'healthRoll', list: 'classes', option: 'fighter' });
    await until(() => shared.some((e) => e.event === 'diceRollBroadcast'), { label: 'thrown' });
    const thrown = shared.find((e) => e.event === 'diceRollBroadcast').data;
    expect(thrown.historyString).toMatch(/^Kestrel rolled Health \(d10\) \[(10|[1-9])\]$/);
    expect(thrown.board).toEqual({ label: 'HEALTH' });
    await until(async () => (await get(db, 'SELECT historyString FROM dice_rolls')) !== undefined, { label: 'logged' });
    expect((await get(db, 'SELECT historyString FROM dice_rolls')).historyString).toBe(thrown.historyString);
    const kept = JSON.parse((await get(db, "SELECT data FROM character_sheets WHERE username = 'kes'")).data)[LEVELING_KEY].health;
    expect(kept.roll).toBe(thrown.total);
  });
});
