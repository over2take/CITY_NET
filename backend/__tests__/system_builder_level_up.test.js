/**
 * Going up a level (7d2b; approved mockup docs/mockups/level-up.html, 2026-11-07). A player goes up when it's
 * available: enough XP, or a level the GM gave. The GM gives one with LEVEL_UP and takes one back with
 * LEVEL_DOWN. XP is never spent by any of it, and a player can't reach a level any other way.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'module';
import jwt from 'jsonwebtoken';
import { makeTestDb, get, run } from './helpers/testDb.js';
import { drain, until } from './helpers/until.js';

process.env.JWT_SECRET = 'test-secret';

const require_ = createRequire(import.meta.url);
const { OWED_KEY, LEVELING_KEY, characterLevel, levelTargets, levelAction, lockedByLevels } = require_('../systemBuilder/levelUp');
const { pickAction } = require_('../systemBuilder/picking');
const { PICKS_KEY } = require_('../systemBuilder/choices');
const { XP_KEY } = require_('../systemBuilder/levels');
const xp = require_('../sheets/awardXp');
const runtime = require_('../systemBuilder/runtime');
const socketsFactory = (await import('../sockets/index.js')).default;

const LEVELS = { top: 4, first: 100, ranges: [{ to: 4, x: 2 }] }; // 100, 300, 700
const CLASSES = { id: 'classes', one: 'Class', many: 'Classes', levelled: true, again: true, options: [{ id: 'soldier', label: 'Soldier' }, { id: 'mage', label: 'Mage' }] };
const WITH_LIST = { format: 1, name: 'L', core: { advancement: ['levels'] }, levels: LEVELS, choices: [CLASSES] };
const NO_LIST = { format: 1, name: 'N', core: { advancement: ['levels'] }, levels: LEVELS };
const WITH_STAT = { ...NO_LIST, stats: [{ id: 'a', label: 'A', stats: [{ id: 'level', label: 'Level' }] }] };
const BOTH = { ...WITH_LIST, stats: WITH_STAT.stats };
const MILESTONE = { ...NO_LIST, core: { advancement: ['milestone'] } };
const OFF = { ...NO_LIST, core: { advancement: ['spend'] } };

const holding = (...picks) => ({ [PICKS_KEY]: { classes: picks.map(([option, level]) => ({ option, level })) } });
const levelIn = (data, option) => data[PICKS_KEY].classes.find((p) => p.option === option).level;
const GM = { gm: true };

describe('a player going up', () => {
  it('needs the XP for the next level: one short says not yet', () => {
    const data = { ...holding(['soldier', 1]), [XP_KEY]: 99 };
    expect(levelAction(WITH_LIST, data, { kind: 'up' })).toEqual({ ok: false, error: "Not yet: there isn't enough for the next level" });
    expect(levelAction(WITH_LIST, {}, { kind: 'up' }).error).toMatch(/^Not yet/);
  });

  it('goes up on it, and spends none: what is past the level carries over', () => {
    const done = levelAction(WITH_LIST, { ...holding(['soldier', 1]), [XP_KEY]: 130 }, { kind: 'up' });
    expect(done.ok).toBe(true);
    expect(done.level).toBe(2);
    expect(done.owed).toBe(0);
    expect(levelIn(done.data, 'soldier')).toBe(2);
    expect(done.data[XP_KEY]).toBe(130);
  });

  it('reads the table at their own level, across all their classes', () => {
    const two = { ...holding(['soldier', 1], ['mage', 1]), [XP_KEY]: 299 };
    expect(characterLevel(WITH_LIST, two)).toBe(2);
    expect(levelAction(WITH_LIST, two, { kind: 'up', option: 'mage' }).error).toMatch(/^Not yet/);
    const done = levelAction(WITH_LIST, { ...two, [XP_KEY]: 300 }, { kind: 'up', option: 'mage' });
    expect(levelIn(done.data, 'mage')).toBe(2);
    expect(levelIn(done.data, 'soldier')).toBe(1);
    expect(done.level).toBe(3);
  });

  it('says which goes up when they hold several, the one they hold', () => {
    const two = { ...holding(['soldier', 1], ['mage', 1]), [XP_KEY]: 9000 };
    expect(levelAction(WITH_LIST, two, { kind: 'up' }).error).toBe('Say which one goes up');
    expect(levelAction(WITH_LIST, { ...holding(['soldier', 1]), [XP_KEY]: 9000 }, { kind: 'up', option: 'mage' }).error).toBe("This character doesn't hold that");
    expect(levelAction(WITH_LIST, two, { kind: 'up', option: 'mage', list: 'other' }).error).toBe("This character doesn't hold that");
    expect(levelAction(WITH_LIST, two, { kind: 'up', option: 'mage', list: 'classes' }).ok).toBe(true);
  });

  it('with a class list and none picked, asks for one first', () => {
    expect(levelAction(WITH_LIST, { [XP_KEY]: 9000 }, { kind: 'up' })).toEqual({ ok: false, error: 'Pick a Class first' });
    const unnamed = { ...WITH_LIST, choices: [{ ...CLASSES, one: undefined }] };
    expect(levelAction(unnamed, { [XP_KEY]: 9000 }, { kind: 'up' }).error).toBe('Pick a classes first');
  });

  it('stops at the highest level', () => {
    const top = { ...holding(['soldier', 4]), [XP_KEY]: 9000 };
    expect(levelAction(WITH_LIST, top, { kind: 'up' })).toEqual({ ok: false, error: 'Already the highest level' });
    expect(levelAction(WITH_LIST, top, { kind: 'up' }, GM).error).toBe('Already the highest level');
    expect(levelAction(WITH_LIST, { ...holding(['soldier', 3]), [XP_KEY]: 9000 }, { kind: 'up' }).level).toBe(4);
  });

  it('with no class list, the level itself goes up, stat or not', () => {
    for (const def of [NO_LIST, WITH_STAT]) {
      const done = levelAction(def, { level: 1, [XP_KEY]: 100 }, { kind: 'up' });
      expect(done.data.level).toBe(2);
      expect(done.level).toBe(2);
    }
    expect(levelAction(NO_LIST, { [XP_KEY]: 100 }, { kind: 'up' }).data.level).toBe(2);
    expect(levelAction(NO_LIST, { level: 2, [XP_KEY]: 299 }, { kind: 'up' }).error).toMatch(/^Not yet/);
  });

  it('with a class list and a level stat, the two go up together, and the stat is the level', () => {
    const data = { level: 1, ...holding(['soldier', 1]), [XP_KEY]: 100 };
    const done = levelAction(BOTH, data, { kind: 'up' });
    expect(done.data.level).toBe(2);
    expect(levelIn(done.data, 'soldier')).toBe(2);
    expect(characterLevel(BOTH, { level: 3, ...holding(['soldier', 1]) })).toBe(3);
    const back = levelAction(BOTH, done.data, { kind: 'down' }, GM);
    expect(back.data.level).toBe(1);
    expect(levelIn(back.data, 'soldier')).toBe(1);
  });

  it('ignores a pick that does not count, and one made under a feature', () => {
    const list = { ...CLASSES, options: [{ id: 'soldier', label: 'Soldier', features: [{ id: 'f', label: 'F', choice: 'perks' }] }] };
    const perks = { id: 'perks', one: 'Perk', many: 'Perks', levelled: true, picked: 'features', options: [{ id: 'keen', label: 'Keen' }] };
    const def = { ...WITH_LIST, choices: [list, perks] };
    const data = { [PICKS_KEY]: { classes: [{ option: 'soldier', level: 1 }], perks: [{ option: 'keen', level: 1, from: 'f' }] } };
    expect(levelTargets(def, data).map((p) => p.option.id)).toEqual(['soldier']);
    // A list switched to THROUGH FEATURES keeps its own picks, and they stop counting.
    const switched = { ...WITH_LIST, choices: [{ ...CLASSES, picked: 'features' }] };
    const kept = holding(['soldier', 3]);
    expect(levelTargets(switched, kept)).toEqual([]);
    expect(characterLevel(switched, kept)).toBe(1);
  });

  it('refuses where levels are typed in, and a broken ask', () => {
    expect(levelAction(OFF, { [XP_KEY]: 9000 }, { kind: 'up' })).toEqual({ ok: false, error: 'Levels here are typed in' });
    expect(levelAction(null, {}, { kind: 'up' }).error).toBe('Levels here are typed in');
    expect(levelAction(WITH_STAT, { [XP_KEY]: 100 }, null, GM)).toEqual({ ok: false, error: 'Nothing to do' });
    expect(levelAction(WITH_STAT, { [XP_KEY]: 100 }, { kind: 'sell' }, GM)).toEqual({ ok: false, error: 'Nothing to do' });
    expect(levelAction(WITH_STAT, null, { kind: 'up' }).error).toMatch(/^Not yet/);
  });
});

describe('LEVEL_UP.EXE\'s place (7d3a)', () => {
  it('keeps which class, and nothing else changes', () => {
    const data = { ...holding(['soldier', 1], ['mage', 1]), [XP_KEY]: 9000 };
    const done = levelAction(WITH_LIST, data, { kind: 'place', list: 'classes', option: 'mage' });
    expect(done.data[LEVELING_KEY]).toEqual({ list: 'classes', option: 'mage' });
    expect(done.data[PICKS_KEY]).toEqual(data[PICKS_KEY]);
    expect(done.level).toBe(2);
    expect(LEVELING_KEY).toBe('_leveling');
  });

  it('for the level itself, an empty place; one class needs no naming', () => {
    expect(levelAction(NO_LIST, { [XP_KEY]: 100 }, { kind: 'place' }).data[LEVELING_KEY]).toEqual({});
    expect(levelAction(WITH_LIST, { ...holding(['soldier', 1]), [XP_KEY]: 100 }, { kind: 'place' }).data[LEVELING_KEY]).toEqual({ list: 'classes', option: 'soldier' });
  });

  it('only once it is available, never at the top, and only what they hold', () => {
    const two = holding(['soldier', 1], ['mage', 1]);
    expect(levelAction(WITH_LIST, two, { kind: 'place', option: 'mage' }).error).toMatch(/^Not yet/);
    expect(levelAction(WITH_LIST, { ...two, [OWED_KEY]: 1 }, { kind: 'place', option: 'mage' }).ok).toBe(true);
    expect(levelAction(WITH_LIST, two, { kind: 'place', option: 'mage' }, GM).ok).toBe(true);
    expect(levelAction(WITH_LIST, { ...holding(['soldier', 4]), [XP_KEY]: 9000 }, { kind: 'place' }, GM).error).toBe('Already the highest level');
    expect(levelAction(WITH_LIST, { ...two, [XP_KEY]: 9000 }, { kind: 'place' }).error).toBe('Say which one goes up');
    expect(levelAction(WITH_LIST, { ...two, [XP_KEY]: 9000 }, { kind: 'place', option: 'rogue' }).error).toBe("This character doesn't hold that");
  });

  it('goes once they go up, or a level is taken back or not taken', () => {
    const placed = { ...holding(['soldier', 2]), [XP_KEY]: 9000, [LEVELING_KEY]: { list: 'classes', option: 'soldier' } };
    expect(LEVELING_KEY in levelAction(WITH_LIST, placed, { kind: 'up' }).data).toBe(false);
    expect(LEVELING_KEY in levelAction(WITH_LIST, placed, { kind: 'down' }, GM).data).toBe(false);
    expect(LEVELING_KEY in levelAction(WITH_LIST, { ...placed, [OWED_KEY]: 1 }, { kind: 'down' }, GM).data).toBe(false);
    expect(levelAction(WITH_LIST, placed, { kind: 'give' }, GM).data[LEVELING_KEY]).toEqual({ list: 'classes', option: 'soldier' });
  });
});

describe('a class not held yet, and the picks a level opens (7d3b)', () => {
  const RICH = { ...WITH_LIST, stats: [{ id: 'a', label: 'A', stats: [{ id: 'wits', label: 'Wits' }] }], choices: [
    { ...CLASSES, options: [
      { id: 'soldier', label: 'Soldier', features: [{ id: 'path', label: 'Path', at: 2, choice: 'paths' }] },
      { id: 'mage', label: 'Mage', requires: '@wits >= 13', features: [{ id: 'school', label: 'School', choice: 'schools' }] },
    ] },
    { id: 'paths', one: 'Path', many: 'Paths', picked: 'features', options: [{ id: 'duelist', label: 'Duelist' }, { id: 'vanguard', label: 'Vanguard', requires: '@wits >= 15' }] },
    { id: 'schools', one: 'School', many: 'Schools', picked: 'features', options: [{ id: 'fire', label: 'Fire' }] },
    { id: 'subs', one: 'Sub', many: 'Subs', levelled: true, picked: 'features', options: [{ id: 'x', label: 'X' }] },
  ] };
  const ready = (more = {}) => ({ wits: 14, ...holding(['soldier', 1]), [XP_KEY]: 9000, ...more });

  it('a class they don\'t hold comes in at level 1, as they\'d pick it', () => {
    const done = levelAction(RICH, ready(), { kind: 'up', list: 'classes', option: 'mage' });
    expect(done.data[PICKS_KEY].classes).toEqual([{ option: 'soldier', level: 1 }, { option: 'mage', level: 1 }]);
    expect(done.level).toBe(2);
  });

  it('one they don\'t meet is refused, said; the GM takes it up anyway', () => {
    expect(levelAction(RICH, ready({ wits: 9 }), { kind: 'up', list: 'classes', option: 'mage' }).error).toMatch(/^Mage needs/);
    expect(levelAction(RICH, ready({ wits: 9 }), { kind: 'up', list: 'classes', option: 'mage' }, GM).ok).toBe(true);
  });

  it('only from a list of their own picking, once they hold a class, and one that is there', () => {
    expect(levelAction(RICH, ready(), { kind: 'up', list: 'subs', option: 'x' }).error).toBe("This character doesn't hold that");
    expect(levelAction(RICH, ready(), { kind: 'up', list: 'classes', option: 'rogue' }).error).toBe("This character doesn't hold that");
    expect(levelAction(RICH, { wits: 14, [XP_KEY]: 9000 }, { kind: 'up', list: 'classes', option: 'mage' }).error).toBe('Pick a Class first');
    const one = { ...RICH, choices: [{ ...RICH.choices[0], again: false, picks: 1 }, ...RICH.choices.slice(1)] };
    expect(levelAction(one, ready(), { kind: 'up', list: 'classes', option: 'mage' }).error).toBe('No more Classes can be picked');
  });

  it('a level stat beside the list goes up with a new class too', () => {
    const both = { ...RICH, stats: [{ id: 'a', label: 'A', stats: [{ id: 'wits', label: 'Wits' }, { id: 'level', label: 'Level' }] }] };
    expect(levelAction(both, ready({ level: 1 }), { kind: 'up', list: 'classes', option: 'mage' }).data.level).toBe(2);
  });

  it('the picks the new level opens are made once it is, under what opens them', () => {
    const done = levelAction(RICH, ready(), { kind: 'up', picks: [{ list: 'paths', option: 'duelist', from: 'path' }] });
    expect(done.data[PICKS_KEY].paths).toEqual([{ option: 'duelist', from: 'path' }]);
    expect(levelIn(done.data, 'soldier')).toBe(2);
    const fresh = levelAction(RICH, ready(), { kind: 'up', list: 'classes', option: 'mage', picks: [{ list: 'schools', option: 'fire', from: 'school' }] });
    expect(fresh.data[PICKS_KEY].schools).toEqual([{ option: 'fire', from: 'school' }]);
  });

  it('one that can\'t be made changes nothing, said', () => {
    const data = ready();
    const unmet = levelAction(RICH, data, { kind: 'up', picks: [{ list: 'paths', option: 'vanguard', from: 'path' }] });
    expect(unmet).toEqual({ ok: false, error: expect.stringMatching(/^Vanguard needs/) });
    const two = levelAction(RICH, data, { kind: 'up', picks: [{ list: 'paths', option: 'duelist', from: 'path' }, { list: 'paths', option: 'vanguard', from: 'path' }] });
    expect(two.ok).toBe(false);
    expect(levelAction(RICH, data, { kind: 'up', picks: [{ list: 'schools', option: 'fire', from: 'school' }] }).error).toBe('Nothing unlocked there opens the Schools');
    expect(levelIn(data, 'soldier')).toBe(1);
  });

  it('what isn\'t a pick is left out; at most twenty', () => {
    const done = levelAction(RICH, ready(), { kind: 'up', picks: [null, 'duelist', { list: 'paths' }, { option: 'vanguard', from: 'path' }, { list: 'paths', option: 'duelist', from: 'path' }] });
    expect(done.data[PICKS_KEY].paths).toEqual([{ option: 'duelist', from: 'path' }]);
    expect(levelAction(RICH, ready(), { kind: 'up', picks: 'duelist' }).ok).toBe(true);
    const many = Array.from({ length: 25 }, (_, i) => ({ list: 'paths', option: `p${i}` }));
    expect(levelAction(RICH, ready(), { kind: 'place', picks: many }).data[LEVELING_KEY].picks).toHaveLength(20);
  });

  it('kept with the place, read as far as they read, gone once they go up', () => {
    const placed = levelAction(RICH, ready(), { kind: 'place', list: 'classes', option: 'mage', picks: [{ list: 'schools', option: 'fire', from: 'school', extra: 1 }, { list: 'x' }] });
    expect(placed.data[LEVELING_KEY]).toEqual({ list: 'classes', option: 'mage', picks: [{ list: 'schools', option: 'fire', from: 'school' }] });
    expect(levelAction(RICH, ready(), { kind: 'place', picks: [{ list: 'paths', option: 'duelist' }] }).data[LEVELING_KEY]).toEqual({ list: 'classes', option: 'soldier', picks: [{ list: 'paths', option: 'duelist' }] });
    expect(LEVELING_KEY in levelAction(RICH, placed.data, { kind: 'up', list: 'classes', option: 'mage', picks: [{ list: 'schools', option: 'fire', from: 'school' }] }).data).toBe(false);
  });
});

describe('a level the GM gives', () => {
  it('only the GM gives one or takes one back', () => {
    expect(levelAction(MILESTONE, {}, { kind: 'give' })).toEqual({ ok: false, error: "That is the GM's to do" });
    expect(levelAction(MILESTONE, { level: 3 }, { kind: 'down' })).toEqual({ ok: false, error: "That is the GM's to do" });
  });

  it('is kept for the player to take: the level does not move yet', () => {
    const done = levelAction(MILESTONE, { level: 1 }, { kind: 'give' }, GM);
    expect(done.data[OWED_KEY]).toBe(1);
    expect(done.data.level).toBe(1);
    expect(done).toMatchObject({ level: 1, owed: 1 });
    expect(levelAction(MILESTONE, done.data, { kind: 'give' }, GM).owed).toBe(2);
  });

  it('never past the highest, counting those already given', () => {
    expect(levelAction(MILESTONE, { level: 3, [OWED_KEY]: 1 }, { kind: 'give' }, GM)).toEqual({ ok: false, error: 'Already the highest level' });
    expect(levelAction(MILESTONE, { level: 3 }, { kind: 'give' }, GM).owed).toBe(1);
  });

  it('XP on a sheet means nothing where the system keeps none', () => {
    expect(levelAction(MILESTONE, { level: 1, [XP_KEY]: 9000 }, { kind: 'up' }).error).toMatch(/^Not yet/);
    expect(levelAction({ ...NO_LIST, parts: { xp: { on: false } } }, { level: 1, [XP_KEY]: 9000 }, { kind: 'up' }).error).toBe('Levels here are typed in');
  });

  it('the player takes it, with no XP, and the count goes away', () => {
    const done = levelAction(MILESTONE, { level: 1, [OWED_KEY]: 1 }, { kind: 'up' });
    expect(done.data.level).toBe(2);
    expect(OWED_KEY in done.data).toBe(false);
    expect(levelAction(MILESTONE, { level: 1, [OWED_KEY]: 2 }, { kind: 'up' }).owed).toBe(1);
    expect(levelAction(MILESTONE, { level: 1 }, { kind: 'up' }).error).toMatch(/^Not yet/);
  });

  it('XP that covers the level leaves a given one to take as well', () => {
    expect(levelAction(NO_LIST, { level: 1, [XP_KEY]: 100, [OWED_KEY]: 1 }, { kind: 'up' }).owed).toBe(1);
    expect(levelAction(NO_LIST, { level: 1, [XP_KEY]: 99, [OWED_KEY]: 1 }, { kind: 'up' }).owed).toBe(0);
  });

  it('the GM going up for them needs neither, and spends neither', () => {
    expect(levelAction(MILESTONE, { level: 1 }, { kind: 'up' }, GM).data.level).toBe(2);
    expect(levelAction(NO_LIST, { level: 1, [XP_KEY]: 5 }, { kind: 'up' }, GM).data[XP_KEY]).toBe(5);
  });
});

describe('LEVEL_DOWN', () => {
  it('takes back one given and not used, before any level', () => {
    const done = levelAction(MILESTONE, { level: 3, [OWED_KEY]: 1 }, { kind: 'down' }, GM);
    expect(done.data.level).toBe(3);
    expect(done.owed).toBe(0);
    expect(OWED_KEY in done.data).toBe(false);
  });

  it('otherwise a level: the stat, or the last class with one to give', () => {
    expect(levelAction(MILESTONE, { level: 3 }, { kind: 'down' }, GM).data.level).toBe(2);
    const two = holding(['soldier', 3], ['mage', 2]);
    expect(levelIn(levelAction(WITH_LIST, two, { kind: 'down' }, GM).data, 'mage')).toBe(1);
    const later = holding(['soldier', 3], ['mage', 1]);
    const done = levelAction(WITH_LIST, later, { kind: 'down' }, GM);
    expect(levelIn(done.data, 'soldier')).toBe(2);
    expect(levelIn(done.data, 'mage')).toBe(1);
  });

  it('or the one named', () => {
    expect(levelIn(levelAction(WITH_LIST, holding(['soldier', 3], ['mage', 2]), { kind: 'down', option: 'soldier' }, GM).data, 'soldier')).toBe(2);
  });

  it('keeps XP, and stops at level 1', () => {
    expect(levelAction(MILESTONE, { level: 3, [XP_KEY]: 40 }, { kind: 'down' }, GM).data[XP_KEY]).toBe(40);
    expect(levelAction(MILESTONE, { level: 1 }, { kind: 'down' }, GM)).toEqual({ ok: false, error: 'Already level 1' });
    expect(levelAction(WITH_LIST, holding(['soldier', 1]), { kind: 'down' }, GM).error).toBe('Already level 1');
    expect(levelAction(WITH_LIST, holding(['soldier', 1]), { kind: 'down', option: 'soldier' }, GM).error).toBe('Already level 1');
    expect(levelAction(WITH_LIST, {}, { kind: 'down' }, GM).error).toBe('Already level 1');
  });
});

describe('no other way up', () => {
  it("a player's + on a class is refused where they advance, the GM's isn't, and elsewhere it is as it was", () => {
    const data = holding(['soldier', 1]);
    const raise = { kind: 'level', list: 'classes', option: 'soldier', level: 2 };
    expect(pickAction(WITH_LIST, data, raise)).toEqual({ ok: false, error: 'Levels go up with LEVEL UP' });
    expect(pickAction({ ...WITH_LIST, core: { advancement: ['milestone'] } }, data, raise).error).toBe('Levels go up with LEVEL UP');
    expect(pickAction(WITH_LIST, data, raise, GM).ok).toBe(true);
    expect(pickAction({ ...WITH_LIST, core: { advancement: ['spend'] } }, data, raise).ok).toBe(true);
  });

  it('a stat called level is shut once the character is made', () => {
    expect([...lockedByLevels(WITH_STAT, {})]).toEqual(['level']);
    expect([...lockedByLevels(WITH_STAT, null)]).toEqual(['level']);
    expect(lockedByLevels(OFF, {}).size).toBe(0);
    expect(lockedByLevels(null, {}).size).toBe(0);
    const making = { ...WITH_STAT, creation: { on: true, steps: ['who'] } };
    expect(lockedByLevels(making, { _creating: { at: 'who' } }).size).toBe(0);
    expect([...lockedByLevels(making, { _creating: { done: true } })]).toEqual(['level']);
  });
});

describe('the GM\'s buttons', () => {
  let db;
  const SYSTEM = 'sys_leveluplevelupleve';
  const sheet = (username, data) => run(db, 'INSERT INTO character_sheets (username, system, data, is_npc) VALUES (?, ?, ?, 0)', [username, SYSTEM, JSON.stringify(data)]);
  const read = async (username) => JSON.parse((await get(db, 'SELECT data FROM character_sheets WHERE username = ?', [username])).data);
  const adjust = (usernames, delta, definition = MILESTONE, applyDerived) => new Promise((resolve) => {
    xp.adjustLevel(db, { system: SYSTEM, definition, applyDerived, usernames, delta }, (reason, results) => resolve({ reason, results }));
  });
  beforeEach(async () => { db = await makeTestDb(); });

  it('LEVEL_UP gives one to each, and says how many to take', async () => {
    await sheet('wren', { level: 2 });
    await sheet('rook', { level: 1, [OWED_KEY]: 1 });
    const { results } = await adjust(['wren', 'rook'], 1);
    expect(results.sort((a, b) => a.username.localeCompare(b.username))).toEqual([
      { username: 'rook', ok: true, level: 1, owed: 2 },
      { username: 'wren', ok: true, level: 2, owed: 1 },
    ]);
    expect((await read('wren'))[OWED_KEY]).toBe(1);
  });

  it('LEVEL_DOWN takes one, works the sheet out again, and says why not for one it can\'t', async () => {
    await sheet('wren', { level: 3 });
    await sheet('rook', { level: 1 });
    const applied = vi.fn();
    const { results } = await adjust(['wren', 'rook', 'ghost'], -1, MILESTONE, applied);
    const by = Object.fromEntries(results.map((r) => [r.username, r]));
    expect(by.wren).toEqual({ username: 'wren', ok: true, level: 2, owed: 0 });
    expect(by.rook).toEqual({ username: 'rook', ok: false, reason: 'Already level 1' });
    expect(by.ghost.ok).toBe(false);
    expect((await read('wren')).level).toBe(2);
    expect((await read('rook')).level).toBe(1);
    expect(applied).toHaveBeenCalledTimes(1);
    expect(applied).toHaveBeenCalledWith(SYSTEM, expect.objectContaining({ level: 2 }));
  });

  it('still refuses a system where levels are typed in', async () => {
    await sheet('wren', { level: 3 });
    expect((await adjust(['wren'], 1, OFF)).reason).toBe('This system does not track levels.');
    expect((await adjust(['wren'], 1, null)).reason).toBe('This system does not track levels.');
    expect((await adjust([], 1)).reason).toBe('Nobody selected.');
    expect((await adjust(['wren'], 0)).reason).toBe('Level change must be a whole number.');
  });
});

describe('through the socket', () => {
  let db;
  const GM_TOKEN = jwt.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, 'test-secret');
  const ID = 'sys_levelsocketlevels';
  const DEF = { ...BOTH, name: 'Sockets', stats: WITH_STAT.stats, core: { advancement: ['levels', 'milestone'] } };

  const table = async () => {
    const shared = [];
    let connection;
    const io = { on: (e, cb) => { if (e === 'connection') connection = cb; }, emit: (event, data) => shared.push({ event, data }), to: () => ({ emit: () => {} }) };
    socketsFactory(io, db, { elevatedUsers: new Set(), emitUpdate: vi.fn(), recordAction: vi.fn() });
    const join = async (who, identity) => {
      const heard = [];
      const handlers = {};
      connection({ id: `s-${who}`, on: (e, fn) => { handlers[e] = fn; }, emit: (event, d) => heard.push({ event, data: d }), broadcast: { emit: () => {} }, use: () => {}, join: () => {}, disconnect: () => {} });
      handlers.identify(identity);
      await drain(db);
      return { handlers, heard, refused: () => heard.filter((e) => e.event === 'choicesRefused').map((e) => e.data.error) };
    };
    return { shared, gm: await join('gm', { userName: 'gm', isAdmin: true, token: GM_TOKEN }), kes: await join('kes', 'kes') };
  };
  const stored = async () => JSON.parse((await get(db, 'SELECT data FROM character_sheets WHERE username = ?', ['kes'])).data);
  const write = (data) => run(db, 'UPDATE character_sheets SET data = ? WHERE username = ?', [JSON.stringify(data), 'kes']);

  beforeEach(async () => {
    db = await makeTestDb();
    const def = JSON.stringify(DEF);
    await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', [ID, 'Sockets', def, def]);
    await new Promise((resolve) => runtime.load(db, resolve));
    await run(db, `INSERT INTO global_settings (key, value) VALUES ('game_system', ?)`, [ID]);
    await run(db, `INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('kes', ?, ?, 0)`, [ID, JSON.stringify({ name: 'Kestrel', level: 1, ...holding(['soldier', 1]) })]);
  });

  it('a player goes up on their XP, the sheet is worked out again, and every screen is told', async () => {
    const { kes, shared } = await table();
    await write({ name: 'Kestrel', level: 1, ...holding(['soldier', 1]), [XP_KEY]: 100 });
    kes.handlers.levelAction({ kind: 'up' });
    await until(async () => (await stored()).level === 2, { label: 'level 2' });
    const data = await stored();
    expect(levelIn(data, 'soldier')).toBe(2);
    expect(data._worked.levels.soldier_level).toBe(2);
    await until(() => shared.some((e) => e.event === 'sheetUpdated' && e.data.username === 'kes'), { label: 'told' });
  });

  it('is refused, in words, when it is not available, and nothing moves', async () => {
    const { kes, shared } = await table();
    kes.handlers.levelAction({ kind: 'up' });
    await until(() => kes.refused().length > 0, { label: 'refused' });
    expect(kes.refused()).toEqual(["Not yet: there isn't enough for the next level"]);
    expect((await stored()).level).toBe(1);
    expect(shared.some((e) => e.event === 'sheetUpdated')).toBe(false);
  });

  it('a player can\'t give themselves a level, or name someone else\'s sheet', async () => {
    const { kes } = await table();
    kes.handlers.levelAction({ kind: 'give' });
    await until(() => kes.refused().length > 0, { label: 'refused' });
    expect(kes.refused()).toEqual(["That is the GM's to do"]);
    await run(db, `INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('rook', ?, ?, 0)`, [ID, JSON.stringify({ level: 1, [XP_KEY]: 9000, ...holding(['soldier', 1]) })]);
    kes.handlers.levelAction({ kind: 'up', username: 'rook' });
    await until(() => kes.refused().length > 1, { label: 'refused again' });
    expect(JSON.parse((await get(db, 'SELECT data FROM character_sheets WHERE username = ?', ['rook'])).data).level).toBe(1);
  });

  it('nothing happens without an ask', async () => {
    const { kes, shared } = await table();
    kes.handlers.levelAction(null);
    kes.handlers.levelAction('up');
    await drain(db);
    expect(kes.refused()).toEqual([]);
    expect(shared.some((e) => e.event === 'sheetUpdated')).toBe(false);
  });

  it('the GM\'s LEVEL_UP over the socket is a level to take, the player takes it, LEVEL_DOWN takes one back', async () => {
    const { gm, kes } = await table();
    gm.handlers.adminAdjustLevel({ token: GM_TOKEN, usernames: ['kes'], delta: 1 });
    await until(async () => (await stored())[OWED_KEY] === 1, { label: 'given' });
    expect((await stored()).level).toBe(1);
    kes.handlers.levelAction({ kind: 'up' });
    await until(async () => (await stored()).level === 2, { label: 'taken' });
    expect(OWED_KEY in await stored()).toBe(false);
    gm.handlers.adminAdjustLevel({ token: GM_TOKEN, usernames: ['kes'], delta: -1 });
    await until(async () => (await stored()).level === 1, { label: 'taken back' });
    expect(levelIn(await stored(), 'soldier')).toBe(1);
    await until(() => gm.heard.some((e) => e.event === 'xpAwardResult' && e.data.levelChange === -1), { label: 'told the GM' });
  });

  it('READY only peeks at a sheet: the GM, with none, isn\'t given one, as a plain ask still does', async () => {
    const { gm } = await table();
    const gmSheets = async () => (await get(db, 'SELECT COUNT(*) AS n FROM character_sheets WHERE username = ?', ['gm'])).n;
    gm.handlers.requestMySheet({ peek: true });
    await drain(db);
    await new Promise((r) => setTimeout(r, 100));
    expect(await gmSheets()).toBe(0);
    expect(gm.heard.some((e) => e.event === 'sheetData')).toBe(false);
    gm.handlers.requestMySheet({ peek: false });
    await until(async () => (await gmSheets()) === 1, { label: 'made' });
  });

  it('and a peek still reads a sheet that is there', async () => {
    const { kes } = await table();
    kes.handlers.requestMySheet({ peek: true });
    await until(() => kes.heard.some((e) => e.event === 'sheetData' && e.data.username === 'kes'), { label: 'read' });
  });

  it('a player\'s place in LEVEL_UP.EXE is kept on their sheet, and every screen is told', async () => {
    const { kes, shared } = await table();
    await write({ name: 'Kestrel', level: 1, ...holding(['soldier', 1]), [XP_KEY]: 100 });
    kes.handlers.levelAction({ kind: 'place', list: 'classes', option: 'soldier' });
    await until(async () => !!(await stored())[LEVELING_KEY], { label: 'kept' });
    expect((await stored())[LEVELING_KEY]).toEqual({ list: 'classes', option: 'soldier' });
    expect((await stored()).level).toBe(1);
    await until(() => shared.some((e) => e.event === 'sheetUpdated' && e.data.username === 'kes'), { label: 'told' });
  });

  it('the GM goes up for a player they name', async () => {
    const { gm } = await table();
    gm.handlers.levelAction({ kind: 'up', username: 'kes' });
    await until(async () => (await stored()).level === 2, { label: 'level 2' });
  });

  it('a player can\'t type a stat called level, in one field or several, and their other fields still save', async () => {
    const { kes } = await table();
    kes.handlers.updateSheetField({ fieldId: 'level', value: 9 });
    await drain(db);
    expect((await stored()).level).toBe(1);
    kes.handlers.importSheetFields({ fields: { level: 9, name: 'Kes' } });
    await until(async () => (await stored()).name === 'Kes', { label: 'the rest saved' });
    expect((await stored()).level).toBe(1);
  });

  it('an uploaded sheet still sets it, an upload being king, and brings its XP (7d2c), never a level given', async () => {
    const { kes } = await table();
    await write({ level: 1, [XP_KEY]: 40, [OWED_KEY]: 1 });
    kes.handlers.importSheetFields({ fields: { level: 4, [XP_KEY]: 9000, [OWED_KEY]: 9 }, replace: true });
    await until(async () => (await stored()).level === 4, { label: 'uploaded' });
    expect((await stored())[XP_KEY]).toBe(9000);
    expect((await stored())[OWED_KEY]).toBe(1);
  });

  it('an upload with no XP keeps theirs; an edit, or an amount that isn\'t one, never sets it', async () => {
    const { kes } = await table();
    await write({ level: 1, [XP_KEY]: 40 });
    kes.handlers.importSheetFields({ fields: { name: 'A' }, replace: true });
    await until(async () => (await stored()).name === 'A', { label: 'a' });
    expect((await stored())[XP_KEY]).toBe(40);
    kes.handlers.importSheetFields({ fields: { name: 'B', [XP_KEY]: 500 } });
    await until(async () => (await stored()).name === 'B', { label: 'b' });
    expect((await stored())[XP_KEY]).toBe(40);
    kes.handlers.importSheetFields({ fields: { name: 'W', [XP_KEY]: '1,250' }, replace: true });
    await until(async () => (await stored()).name === 'W', { label: 'written' });
    expect((await stored())[XP_KEY]).toBe(1250);
    await write({ name: 'W', level: 1, [XP_KEY]: 40 });
    for (const [name, bad] of [['C', -5], ['D', 2.5], ['E', 'lots'], ['F', ''], ['G', '  ']]) {
      kes.handlers.importSheetFields({ fields: { name, [XP_KEY]: bad }, replace: true });
      await until(async () => (await stored()).name === name, { label: name });
      expect((await stored())[XP_KEY], String(bad)).toBe(40);
    }
  });

  it('where characters earn no XP, an upload can\'t give them any', async () => {
    const def = JSON.stringify({ ...DEF, core: { advancement: ['milestone'] } });
    await run(db, 'UPDATE custom_systems SET draft = ?, published = ? WHERE id = ?', [def, def, ID]);
    await new Promise((resolve) => runtime.load(db, resolve));
    const { kes } = await table();
    kes.handlers.importSheetFields({ fields: { name: 'M', [XP_KEY]: 300 }, replace: true });
    await until(async () => (await stored()).name === 'M', { label: 'uploaded' });
    expect(XP_KEY in await stored()).toBe(false);
  });

  it('the GM can type one on their own sheet', async () => {
    const { gm } = await table();
    await run(db, `INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('gm', ?, ?, 0)`, [ID, JSON.stringify({ level: 1 })]);
    gm.handlers.updateSheetField({ fieldId: 'level', value: 3 });
    await until(async () => JSON.parse((await get(db, 'SELECT data FROM character_sheets WHERE username = ?', ['gm'])).data).level === 3, { label: 'typed' });
  });
});
