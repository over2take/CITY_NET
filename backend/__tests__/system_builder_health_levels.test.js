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
    expect(healthOf(HALE)).toEqual({ how: 'level', dieOn: 'class', gain: 'average', adds: '@con_mod' });
    expect(healthOf({ levels: { health: { how: 'level', die_on: 'all', die: 8, adds: '  ' } } })).toEqual({ how: 'level', dieOn: 'all', die: 8, gain: 'average' });
    expect(healthOf({ levels: { health: { how: 'level', die_on: 'some', die: 1, gain: 'roll' } } })).toEqual({ how: 'level', dieOn: 'class', gain: 'average' });
    expect(GAINS).toEqual(['average']);
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
    expect(problems({ how: 'level', gain: 'roll' })).toEqual(['levels, health, gain: AVERAGE (FIXED)']);
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
    expect(healthByLevel(HALE, holding([['fighter', 1]]))).toEqual({ max: 12, adds: 2, levels: [{ level: 1, took: 10 }] });
    const feat = holding([['fighter', 1]]);
    feat[PICKS_KEY].feats = [{ option: 'tough' }];
    expect(healthByLevel(HALE, feat).max).toBe(12);
    // What each level adds is whole, rounded down.
    expect(healthByLevel({ ...HALE, levels: perLevel({ adds: '@con / 4' }) }, holding([['fighter', 1]])).max).toBe(13);
  });

  it('each later level what it kept, or the average where it kept nothing, every one with what each level adds', () => {
    const data = holding([['fighter', 2], ['wizard', 1]], { [HEALTH_LEVELS_KEY]: { 2: { die: 10, took: 5 }, 3: { die: 6, took: 3 } } });
    expect(healthByLevel(HALE, data)).toEqual({ max: 12 + 7 + 5, adds: 2, levels: [{ level: 1, took: 10 }, { level: 2, took: 5 }, { level: 3, took: 3 }] });
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
    expect(sheet._health).toEqual({ max: 19, adds: 2, levels: [{ level: 1, took: 10 }, { level: 2, took: 5 }] });
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
