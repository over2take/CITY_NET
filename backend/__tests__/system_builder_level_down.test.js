import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';
import jwt from 'jsonwebtoken';
import { makeTestDb, run, get } from './helpers/testDb.js';
import { drain, until } from './helpers/until.js';

/**
 * LEVEL_DOWN from a class held at level 1 (7d7d; the user's call of 2026-11-08): the class goes, the picks under its
 * features waiting, its level's health and the increases it unlocked with it. A character's only class at level 1
 * stays. With none named, the last class with a level to give still goes down first, as before.
 */

process.env.JWT_SECRET = 'test-secret';
const require_ = createRequire(import.meta.url);
const { PICKS_KEY, INCREASES_KEY, workedOf } = require_('../systemBuilder/choices');
const { HEALTH_LEVELS_KEY } = require_('../systemBuilder/levels');
const { healthByLevel } = require_('../systemBuilder/healthLevels');
const { levelAction, characterLevel } = require_('../systemBuilder/levelUp');
const runtime = require_('../systemBuilder/runtime');
const socketsFactory = require_('../sockets/index.js');

const DOWN = {
  format: 1, name: 'Down', core: { advancement: ['levels'] },
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }] }],
  choices: [
    { id: 'classes', one: 'Class', many: 'Classes', levelled: true, again: true, options: [
      { id: 'soldier', label: 'Soldier', die: 10 },
      { id: 'mage', label: 'Mage', die: 6, features: [
        { id: 'school', label: 'School', at: 1, choice: 'schools' },
        { id: 'asi', label: 'Ability Score Improvement', at: 1, increase: { points: 1, stats: 'abilities' } },
      ] },
    ] },
    { id: 'schools', one: 'School', many: 'Schools', picked: 'features', options: [{ id: 'fire', label: 'Fire' }] },
  ],
  levels: { top: 6, first: 100, ranges: [{ to: 6, x: 2 }], health: { how: 'level', gain: 'roll' } },
};
const held = (...picks) => ({ classes: picks.map(([option, level]) => ({ option, level })) });
// Soldier 1, then Mage 1 (level 2, rolled 4 on its d6), its School and its increase spent.
const both = (more = {}) => ({
  might: 12, [PICKS_KEY]: { ...held(['soldier', 1], ['mage', 1]), schools: [{ option: 'fire', from: 'school' }] },
  [HEALTH_LEVELS_KEY]: { 2: { die: 6, took: 4, rolled: true } }, [INCREASES_KEY]: { asi: { might: 1 } }, ...more,
});
const down = (data, action = {}) => levelAction(DOWN, data, { kind: 'down', ...action }, { gm: true });

describe('LEVEL_DOWN from a class at level 1', () => {
  it('with none named and every class at level 1, the last picked goes; what it brought goes or waits', () => {
    const done = down(both());
    expect(done.ok).toBe(true);
    expect(done.level).toBe(1);
    expect(done.data[PICKS_KEY].classes).toEqual([{ option: 'soldier', level: 1 }]);
    // The School under its feature is kept, waiting; the level's health and the increase it unlocked go.
    expect(done.data[PICKS_KEY].schools).toEqual([{ option: 'fire', from: 'school' }]);
    expect(workedOf(DOWN, done.data).picks.find((p) => p.option === 'fire')).toMatchObject({ waiting: true });
    expect(done.data[HEALTH_LEVELS_KEY]).toEqual({});
    expect(done.data).not.toHaveProperty(INCREASES_KEY);
    expect(healthByLevel(DOWN, done.data).max).toBe(10);
  });

  it('named, the class at level 1 goes, the other staying', () => {
    const done = down(both(), { option: 'soldier' });
    expect(done.data[PICKS_KEY].classes).toEqual([{ option: 'mage', level: 1 }]);
    expect(characterLevel(DOWN, done.data)).toBe(1);
    // Level 1 is now the Mage's full die.
    expect(healthByLevel(DOWN, done.data).max).toBe(6);
    expect(done.data[PICKS_KEY].schools).toEqual([{ option: 'fire', from: 'school' }]);
  });

  it('back up, the waiting pick counts again', () => {
    const gone = down(both()).data;
    const back = levelAction(DOWN, { ...gone, _xp: 9e9 }, { kind: 'up', list: 'classes', option: 'mage' }, { gm: true });
    expect(back.ok).toBe(true);
    expect(workedOf(DOWN, back.data).picks.find((p) => p.option === 'fire')).not.toHaveProperty('waiting');
  });

  it('a class with a level to give still goes down first, as before', () => {
    const done = down(both({ [PICKS_KEY]: held(['soldier', 2], ['mage', 1]) }));
    expect(done.data[PICKS_KEY].classes).toEqual([{ option: 'soldier', level: 1 }, { option: 'mage', level: 1 }]);
  });

  it('their only class at level 1 stays, named or not', () => {
    const one = { [PICKS_KEY]: held(['soldier', 1]) };
    expect(down(one).error).toBe('Already level 1');
    expect(down(one, { option: 'soldier' }).error).toBe('Already level 1');
  });

  it('a level stat beside the classes comes down with it', () => {
    const withStat = { ...DOWN, stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }, { id: 'level', label: 'Level' }] }] };
    const done = levelAction(withStat, both({ level: 2 }), { kind: 'down' }, { gm: true });
    expect(done.data.level).toBe(1);
    expect(done.data[PICKS_KEY].classes).toEqual([{ option: 'soldier', level: 1 }]);
  });
});

describe('through the GM\'s LEVEL_DOWN', () => {
  it('the class at level 1 goes from a player\'s sheet, and the GM is told', async () => {
    const db = await makeTestDb();
    const ID = 'sys_downdowndowndown';
    const def = JSON.stringify(DOWN);
    await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', [ID, 'Down', def, def]);
    await new Promise((resolve) => runtime.load(db, resolve));
    await run(db, 'INSERT INTO global_settings (key, value) VALUES (\'game_system\', ?)', [ID]);
    await run(db, 'INSERT INTO character_sheets (username, system, data, is_npc) VALUES (\'kes\', ?, ?, 0)', [ID, JSON.stringify(both())]);
    let connection;
    socketsFactory({ on: (e, cb) => { if (e === 'connection') connection = cb; }, emit: () => {}, to: () => ({ emit: () => {} }) },
      db, { elevatedUsers: new Set(), emitUpdate: vi.fn(), recordAction: vi.fn() });
    const handlers = {};
    const heard = [];
    connection({ id: 'down-gm', on: (e, fn) => { handlers[e] = fn; }, emit: (event, data) => heard.push({ event, data }), broadcast: { emit: () => {} }, use: () => {}, join: () => {}, disconnect: () => {} });
    const token = jwt.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, 'test-secret');
    handlers.identify({ userName: 'gm', isAdmin: true, token });
    await drain(db);
    const stored = async () => JSON.parse((await get(db, 'SELECT data FROM character_sheets WHERE username = ?', ['kes'])).data);
    handlers.adminAdjustLevel({ token, usernames: ['kes'], delta: -1 });
    await until(async () => (await stored())[PICKS_KEY].classes.length === 1, { label: 'the Mage gone' });
    expect((await stored())[PICKS_KEY].classes).toEqual([{ option: 'soldier', level: 1 }]);
    await until(() => heard.some((e) => e.event === 'xpAwardResult' && e.data.levelChange === -1), { label: 'told the GM' });
  });
});
