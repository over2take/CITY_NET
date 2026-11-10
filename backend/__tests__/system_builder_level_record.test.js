import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'module';
import { makeTestDb, run } from './helpers/testDb.js';
import { drain, until } from './helpers/until.js';

/**
 * What each level gained, put right, the server's half (7d7b1; approved mockup docs/mockups/level-record.html,
 * 2026-11-09): the GM clears a past level's kept roll for the player to roll again, to the tray and kept; sets the die's
 * part of any level, or back to the average (level 1: the full die); clears an increase for the player to spend again,
 * checked as at FINISH. Each level says how it was kept, and the sheet is told which increases are open.
 */

const require_ = createRequire(import.meta.url);
const { PICKS_KEY, INCREASES_KEY, workedOf, effectiveData } = require_('../systemBuilder/choices');
const { HEALTH_LEVELS_KEY, XP_KEY } = require_('../systemBuilder/levels');
const { healthByLevel } = require_('../systemBuilder/healthLevels');
const { levelAction, healthRollLine } = require_('../systemBuilder/levelUp');
const runtime = require_('../systemBuilder/runtime');
const socketsFactory = require_('../sockets/index.js');

const KEPT = {
  format: 1, name: 'Kept', core: { advancement: ['levels'] },
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }, { id: 'wits', label: 'Wits' }] }],
  choices: [
    { id: 'classes', one: 'Class', many: 'Classes', levelled: true, again: true, options: [
      { id: 'soldier', label: 'Soldier', die: 10, features: [{ id: 'asi', label: 'Ability Score Improvement', at: 2, increase: { points: 2, stats: 'abilities', cap: 20, instead: 'feats' } }] },
      { id: 'mage', label: 'Mage', die: 6 },
      { id: 'monk', label: 'Monk' },
    ] },
    { id: 'feats', one: 'Feat', many: 'Feats', picked: 'features', options: [{ id: 'tough', label: 'Tough' }] },
  ],
  levels: { top: 6, first: 100, ranges: [{ to: 6, x: 2 }], health: { how: 'level', gain: 'roll', adds: '2' } },
};
const holding = (...picks) => ({ [PICKS_KEY]: { classes: picks.map(([option, level]) => ({ option, level })) } });
// Soldier 2 (rolled 5) and Mage 1 (level 3, rolled 4 on its d6), Might 14 with 2 spent: 12 + 7 + 6 = 25.
const sheet = (more = {}) => ({
  [XP_KEY]: 0, might: 14, wits: 12, ...holding(['soldier', 2], ['mage', 1]),
  [HEALTH_LEVELS_KEY]: { 2: { die: 10, took: 5, rolled: true }, 3: { die: 6, took: 4, rolled: true } },
  [INCREASES_KEY]: { asi: { might: 2 } },
  ...more,
});
const act = (data, action, opts = {}) => levelAction(KEPT, data, action, opts);
const GM = { gm: true };

describe('each level says how it was kept', () => {
  it('rolled, set, cleared; level 1 the full die, or what the GM set', () => {
    const data = sheet({ [HEALTH_LEVELS_KEY]: { 1: { die: 10, took: 7, set: true }, 2: { die: 10, took: 9, set: true }, 3: { die: 6, cleared: true } } });
    expect(healthByLevel(KEPT, sheet()).levels).toEqual([
      { level: 1, took: 10, die: 10 }, { level: 2, took: 5, die: 10, rolled: true }, { level: 3, took: 4, die: 6, rolled: true },
    ]);
    expect(healthByLevel(KEPT, data).levels).toEqual([
      { level: 1, took: 7, die: 10, set: true }, { level: 2, took: 9, die: 10, set: true }, { level: 3, took: 3, die: 6, cleared: true },
    ]);
    // Cleared, a level counts as its own die's average: Mage's d6 is 3, not Soldier's 5.
    expect(healthByLevel(KEPT, data).max).toBe(9 + 11 + 5);
    // A level 1 kept without SET is still the full die.
    expect(healthByLevel(KEPT, sheet({ [HEALTH_LEVELS_KEY]: { 1: { die: 10, took: 2 } } })).levels[0]).toEqual({ level: 1, took: 10, die: 10 });
  });
});

describe('CLEAR THE ROLL on a past level, and the player rolling it again', () => {
  it('the GM clears a kept roll; it counts as the average until rolled', () => {
    expect(act(sheet(), { kind: 'clearLevel', level: 2 }).error).toBe('That is the GM\'s to do');
    const cleared = act(sheet(), { kind: 'clearLevel', level: 2 }, GM);
    expect(cleared.ok).toBe(true);
    expect(cleared.data[HEALTH_LEVELS_KEY][2]).toEqual({ die: 10, cleared: true });
    expect(healthByLevel(KEPT, cleared.data).max).toBe(12 + 7 + 6);
  });

  it('only a kept roll, never level 1, and only a level they have', () => {
    expect(act(sheet(), { kind: 'clearLevel', level: 1 }, GM).error).toBe('Nothing rolled there to clear');
    expect(act(sheet({ [HEALTH_LEVELS_KEY]: { 2: { die: 10, took: 5 } } }), { kind: 'clearLevel', level: 2 }, GM).error).toBe('Nothing rolled there to clear');
    for (const level of [0, 4, 2.5, 'two', undefined]) expect(act(sheet(), { kind: 'clearLevel', level }, GM).error, String(level)).toBe('No such level');
    expect(levelAction({ ...KEPT, levels: { ...KEPT.levels, health: { how: 'formula', formula: '10' } } }, sheet(), { kind: 'clearLevel', level: 2 }, GM).error)
      .toBe('Health isn\'t kept per level in this game');
  });

  it('the player rolls it again: kept as rolled, thrown for the tray, the level named', () => {
    const cleared = act(sheet(), { kind: 'clearLevel', level: 3 }, GM).data;
    const rolled = act(cleared, { kind: 'rollLevel', level: 3 }, { rng: () => 0.99 });
    expect(rolled.ok).toBe(true);
    expect(rolled.data[HEALTH_LEVELS_KEY][3]).toEqual({ die: 6, took: 6, rolled: true });
    expect(rolled.rolled).toEqual({ sides: 6, rolls: [6], total: 6, level: 3 });
    expect(healthRollLine('Wren', rolled.rolled)).toBe('Wren rolled Health for level 3 (d6) [6]');
    // Rolled once, it's kept: no second go without the GM.
    expect(act(rolled.data, { kind: 'rollLevel', level: 3 }).error).toBe('Nothing to roll there: your GM clears a roll first');
    expect(act(sheet(), { kind: 'rollLevel', level: 2 }).error).toBe('Nothing to roll there: your GM clears a roll first');
  });

  it('a level with no die has nothing to roll', () => {
    const data = { ...holding(['monk', 2]), [HEALTH_LEVELS_KEY]: { 2: { cleared: true } } };
    expect(act(data, { kind: 'rollLevel', level: 2 }).error).toBe('Nothing to roll: no die at that level');
  });
});

describe('SET TO, by the GM', () => {
  it('the die\'s part, what each level adds still on top', () => {
    const set = act(sheet(), { kind: 'setLevel', level: 2, took: 8 }, GM);
    expect(set.data[HEALTH_LEVELS_KEY][2]).toEqual({ die: 10, took: 8, set: true });
    expect(healthByLevel(KEPT, set.data).max).toBe(12 + 10 + 6);
    expect(act(sheet(), { kind: 'setLevel', level: 2, took: 8 }).error).toBe('That is the GM\'s to do');
  });

  it('level 1 too, its die the first class\'s', () => {
    const set = act(sheet(), { kind: 'setLevel', level: 1, took: 7 }, GM);
    expect(set.data[HEALTH_LEVELS_KEY][1]).toEqual({ die: 10, took: 7, set: true });
    expect(healthByLevel(KEPT, set.data).levels[0]).toEqual({ level: 1, took: 7, die: 10, set: true });
  });

  it('a whole number from 1 to that level\'s die', () => {
    for (const took of [0, 7, 2.5, '3']) expect(act(sheet(), { kind: 'setLevel', level: 3, took }, GM).error, String(took)).toBe('A whole number from 1 to 6');
    expect(act(sheet(), { kind: 'setLevel', level: 3, took: 6 }, GM).ok).toBe(true);
    const data = { ...holding(['monk', 2]), [HEALTH_LEVELS_KEY]: {} };
    expect(act(data, { kind: 'setLevel', level: 2, took: 3 }, GM).error).toBe('Nothing to set: no die at that level');
  });

  it('none: back to the average, kept with its die; level 1 back to the full die', () => {
    const set = act(sheet(), { kind: 'setLevel', level: 3, took: 1 }, GM).data;
    const back = act(set, { kind: 'setLevel', level: 3, took: null }, GM).data;
    expect(back[HEALTH_LEVELS_KEY][3]).toEqual({ die: 6 });
    expect(healthByLevel(KEPT, back).levels[2]).toEqual({ level: 3, took: 3, die: 6 });
    const one = act(act(sheet(), { kind: 'setLevel', level: 1, took: 2 }, GM).data, { kind: 'setLevel', level: 1 }, GM).data;
    expect(one[HEALTH_LEVELS_KEY]).not.toHaveProperty('1');
    expect(healthByLevel(KEPT, one).levels[0].took).toBe(10);
  });
});

describe('an increase put right', () => {
  it('the GM clears it; the sheet says it\'s open; the player spends it again, checked as at FINISH', () => {
    expect(act(sheet(), { kind: 'clearIncrease', feature: 'asi' }).error).toBe('That is the GM\'s to do');
    const cleared = act(sheet(), { kind: 'clearIncrease', feature: 'asi' }, GM).data;
    expect(cleared).not.toHaveProperty(INCREASES_KEY);
    expect(effectiveData(KEPT, cleared).might).toBe(14);
    expect(workedOf(KEPT, cleared).increasesOpen).toEqual(['asi']);
    const spend = (spread) => act(cleared, { kind: 'spendIncrease', feature: 'asi', spread });
    expect(spend({ wits: 3 }).error).toBe('Ability Score Improvement: at most 2 on one stat');
    expect(spend({ wits: 1 }).error).toBe('Ability Score Improvement: spend all 2 points');
    expect(spend({ lore: 2 }).error).toBe('Ability Score Improvement doesn\'t raise lore');
    expect(spend({ might: 1.5 }).error).toBe('Spend Ability Score Improvement\'s points first');
    expect(spend(undefined).error).toBe('Spend Ability Score Improvement\'s points first');
    const again = spend({ might: 1, wits: 1 });
    expect(again.data[INCREASES_KEY]).toEqual({ asi: { might: 1, wits: 1 } });
    expect(workedOf(KEPT, again.data)).not.toHaveProperty('increasesOpen');
    expect(act(again.data, { kind: 'spendIncrease', feature: 'asi', spread: { might: 2 } }).error).toBe('Already spent: your GM can clear it');
  });

  it('clearing keeps the others', () => {
    const data = act(sheet({ [INCREASES_KEY]: { asi: { might: 2 }, other: { wits: 1 } } }), { kind: 'clearIncrease', feature: 'asi' }, GM).data;
    expect(data[INCREASES_KEY]).toEqual({ other: { wits: 1 } });
  });

  it('what can\'t be cleared or spent', () => {
    expect(act(sheet(), { kind: 'clearIncrease', feature: 'nothing' }, GM).error).toBe('Nothing spent there to clear');
    expect(act(sheet(), { kind: 'clearIncrease' }, GM).error).toBe('Nothing spent there to clear');
    // Soldier 1: not unlocked.
    expect(act({ ...holding(['soldier', 1]) }, { kind: 'spendIncrease', feature: 'asi', spread: { might: 2 } }).error).toBe('No increase unlocked there');
    expect(act(sheet(), { kind: 'spendIncrease', feature: 'mage', spread: { might: 2 } }).error).toBe('No increase unlocked there');
    // A Feat taken in its place.
    const feat = { ...sheet(), [INCREASES_KEY]: {}, [PICKS_KEY]: { ...holding(['soldier', 2])[PICKS_KEY], feats: [{ option: 'tough', from: 'asi' }] } };
    expect(act(feat, { kind: 'spendIncrease', feature: 'asi', spread: { might: 2 } }).error).toBe('Taken as a pick in place of the points');
    expect(workedOf(KEPT, feat)).not.toHaveProperty('increasesOpen');
  });
});

describe('through the socket', () => {
  it('a level rolled again is thrown in the tray, named', async () => {
    const db = await makeTestDb();
    await run(db, 'CREATE TABLE IF NOT EXISTS dice_rolls (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT, total INTEGER, results TEXT, color TEXT, historyString TEXT, timestamp DATETIME DEFAULT CURRENT_TIMESTAMP)');
    const ID = 'sys_recordrecordrecord';
    const def = JSON.stringify(KEPT);
    await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', [ID, 'Kept', def, def]);
    await new Promise((resolve) => runtime.load(db, resolve));
    await run(db, 'INSERT INTO global_settings (key, value) VALUES (\'game_system\', ?)', [ID]);
    const data = sheet({ name: 'Wren', [HEALTH_LEVELS_KEY]: { 2: { die: 10, cleared: true }, 3: { die: 6, took: 4, rolled: true } } });
    await run(db, 'INSERT INTO character_sheets (username, system, data, is_npc) VALUES (\'wre\', ?, ?, 0)', [ID, JSON.stringify(data)]);
    let connection;
    const shared = [];
    socketsFactory({ on: (e, cb) => { if (e === 'connection') connection = cb; }, emit: (event, payload) => shared.push({ event, data: payload }), to: () => ({ emit: () => {} }) },
      db, { elevatedUsers: new Set(), emitUpdate: vi.fn(), recordAction: vi.fn() });
    const handlers = {};
    connection({ id: 'record-wre', on: (e, fn) => { handlers[e] = fn; }, emit: () => {}, broadcast: { emit: () => {} }, use: () => {}, join: () => {}, disconnect: () => {} });
    handlers.identify('wre');
    await drain(db);
    handlers.levelAction({ kind: 'rollLevel', level: 2 });
    await until(() => shared.some((e) => e.event === 'diceRollBroadcast'), { label: 'thrown' });
    const thrown = shared.find((e) => e.event === 'diceRollBroadcast').data;
    expect(thrown.results[10]).toHaveLength(1);
    expect(thrown.historyString).toMatch(/^Wren rolled Health for level 2 \(d10\) \[\d+\]$/);
  });
});
