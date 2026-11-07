/**
 * A system's NEW CHARACTER flow, the server's side (7c1; approved mockup new-character, 2026-11-03):
 * off unless a GM turns it on; steps read from what the system has, in the GM's order; only the
 * switch, the order and what's off stored, so a list made later joins by itself and a deleted one
 * leaves; and it travels in the system file.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require_ = createRequire(import.meta.url);
const { creationOf, stepIdsOf, LIMITS, stepsAsked, creationShown, creatingNow, creationAction, withUpload, CREATING_KEY, lockedWhileCreating, placedFrom, stepWayProblems, parseStatRoll, statRollRange, statRollLine, parseMoneyRoll, moneyRollProblems, moneyOf, wholeOf } = require_('../systemBuilder/creation');
const { pickAction } = require_('../systemBuilder/picking');
const { PICKS_KEY, choicesShown } = require_('../systemBuilder/choices');
const { playerMayEdit } = require_('../sheets/templates');
const { checkDefinition } = require_('../systemBuilder/definition');
const citysys = require_('../systemBuilder/citysys');
const { OTHER } = require_('../systemBuilder/versionDiff');

const HEARTH = {
  format: 1, name: 'Hearth',
  stats: [{ id: 'traits', label: 'TRAITS', stats: [{ id: 'grit', label: 'Grit' }] }],
  choices: [
    { id: 'classes', one: 'Class', many: 'Classes', levelled: true, options: [{ id: 'soldier', label: 'Soldier', features: [{ id: 'spec', label: 'Spec', choice: 'specs' }] }] },
    { id: 'backgrounds', one: 'Background', many: 'Backgrounds', options: [{ id: 'dockhand', label: 'Dockhand' }] },
    { id: 'specs', one: 'Spec', many: 'Specs', picked: 'features', options: [{ id: 'duelist', label: 'Duelist' }] },
    { id: 'feats', one: 'Feat', many: 'Feats', picked: 'both', options: [{ id: 'tough', label: 'Tough' }] },
    { id: 'commons', one: 'Common', many: 'Commons', picked: 'everyone', options: [{ id: 'breath', label: 'Breath' }] },
  ],
};
const problems = (creation, def = HEARTH) => checkDefinition({ ...def, creation }).problems.map((p) => `${p.where}: ${p.message}`);
const ids = (def) => creationOf(def).steps.map((s) => s.id);

describe('the steps a system has', () => {
  const ALL = ['who', 'stats', 'list:classes', 'list:backgrounds', 'list:feats', 'kits', 'money'];

  it('who they are, the stats, each list picked on its own or both ways, kits and money', () => {
    expect(stepIdsOf(HEARTH)).toEqual(ALL);
  });

  it('no stats, no step for them: nor a group with none; a list only under features or everyone\'s has none', () => {
    expect(stepIdsOf({ format: 1, name: 'B' })).toEqual(['who', 'kits', 'money']);
    expect(stepIdsOf({ format: 1, name: 'B', stats: [{ id: 'g', label: 'G', stats: [] }] })).toEqual(['who', 'kits', 'money']);
  });

  it('no money with the bank part off', () => {
    expect(stepIdsOf({ ...HEARTH, parts: { bank: { on: false } } })).not.toContain('money');
  });

  it('off unless turned on, in the order they come; nothing says nothing', () => {
    expect(creationOf(HEARTH)).toEqual({ on: false, steps: ALL.map((id) => ({ id, off: false })) });
    expect(creationOf({ ...HEARTH, creation: { on: true } }).on).toBe(true);
    expect(creationOf({ ...HEARTH, creation: 'on' }).on).toBe(false);
    expect(creationOf({ ...HEARTH, creation: { on: 'yes' } }).on).toBe(false);
    expect(creationOf(undefined).steps.map((s) => s.id)).toContain('who');
  });

  it('in the GM\'s order, what they switched off said, WHO THEY ARE never off', () => {
    const c = creationOf({ ...HEARTH, creation: { on: true, order: ['money', 'who', 'stats', 'list:classes', 'list:backgrounds', 'list:feats', 'kits'], off: ['kits', 'who'] } });
    expect(c.steps.map((s) => s.id)).toEqual(['money', 'who', 'stats', 'list:classes', 'list:backgrounds', 'list:feats', 'kits']);
    expect(c.steps.filter((s) => s.off).map((s) => s.id)).toEqual(['kits']);
  });

  it('an order naming what has gone is no problem, and a step twice counts once', () => {
    const creation = { order: ['list:gone', 'kits', 'kits', 'who'] };
    expect(ids({ ...HEARTH, creation })).not.toContain('list:gone');
    expect(ids({ ...HEARTH, creation }).filter((x) => x === 'kits')).toHaveLength(1);
    expect(problems(creation)).toEqual([]);
  });

  it('a list made later joins the lists, before kits and money; anything else goes on the end', () => {
    const creation = { order: ['who', 'stats', 'kits', 'money'] };
    expect(ids({ ...HEARTH, creation })).toEqual(['who', 'stats', 'list:classes', 'list:backgrounds', 'list:feats', 'kits', 'money']);
    expect(ids({ ...HEARTH, creation: { order: ['who', 'list:classes'] } })).toEqual(['who', 'list:classes', 'stats', 'list:backgrounds', 'list:feats', 'kits', 'money']);
  });
});

describe('the stats, one way for all or group by group (7c3a)', () => {
  const GROUPS = { ...HEARTH, stats: [
    { id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }] },
    { id: 'skills', label: 'SKILLS', stats: [{ id: 'climb', label: 'Climb' }] },
    { id: 'stress', label: 'STRESS', stats: [{ id: 'worry', label: 'Worry' }] },
    { id: 'empty', label: 'EMPTY', stats: [] },
  ] };
  const LISTS = ['list:classes', 'list:backgrounds', 'list:feats'];
  const by = (creation) => ({ ...GROUPS, creation: { statsBy: 'group', ...creation } });
  const shownGroups = (def) => creationShown(def).stats.map((g) => g.id);

  it('one step for all to start; group by group, a step for each group with stats in it', () => {
    expect(stepIdsOf(GROUPS)).toEqual(['who', 'stats', ...LISTS, 'kits', 'money']);
    expect(stepIdsOf(by())).toEqual(['who', 'stats:abilities', 'stats:skills', 'stats:stress', ...LISTS, 'kits', 'money']);
    expect(stepIdsOf({ format: 1, name: 'B', creation: { statsBy: 'group' } })).toEqual(['who', 'kits', 'money']);
  });

  it('changing between them keeps the stats where the GM put them', () => {
    const moved = { order: ['who', 'list:classes', 'stats', 'list:backgrounds', 'list:feats', 'kits', 'money'] };
    expect(ids(by(moved))).toEqual(['who', 'list:classes', 'stats:abilities', 'stats:skills', 'stats:stress', 'list:backgrounds', 'list:feats', 'kits', 'money']);
    const back = { ...GROUPS, creation: { order: ['who', 'list:classes', 'stats:skills', 'stats:abilities', 'stats:stress', 'list:feats'] } };
    expect(ids(back)).toEqual(['who', 'list:classes', 'stats', 'list:feats', 'list:backgrounds', 'kits', 'money']);
  });

  it('groups keep the order the GM gave them; a group made later joins the other groups', () => {
    const order = ['stats:skills', 'who', 'stats:abilities', 'list:classes'];
    expect(ids(by({ order })).slice(0, 5)).toEqual(['stats:skills', 'who', 'stats:abilities', 'stats:stress', 'list:classes']);
  });

  it('group by group, a group off is a step off, and its stats aren\'t asked', () => {
    const def = by({ on: true, off: ['stats:stress'] });
    expect(creationOf(def).steps.filter((s) => s.off).map((s) => s.id)).toEqual(['stats:stress']);
    expect(stepsAsked(def)).toEqual(['who', 'stats:abilities', 'stats:skills', ...LISTS]);
    expect(shownGroups(def)).toEqual(['abilities', 'skills']);
  });

  it('one way for all, a group left out is said the same way: the one step stays, without its stats', () => {
    const def = { ...GROUPS, creation: { on: true, off: ['stats:stress'] } };
    expect(creationOf(def).steps.filter((s) => s.off)).toEqual([]);
    expect(stepsAsked(def)).toEqual(['who', 'stats', ...LISTS]);
    expect(shownGroups(def)).toEqual(['abilities', 'skills']);
  });

  it('every group left out, THE STATS has nothing to ask: on the page still, not at the table', () => {
    const def = { ...GROUPS, creation: { on: true, off: ['stats:abilities', 'stats:skills', 'stats:stress'] } };
    expect(ids(def)).toContain('stats');
    expect(stepsAsked(def)).toEqual(['who', ...LISTS]);
  });

  it('a character can stand on a group\'s step, not on one left out or gone, nor on THE STATS with steps per group', () => {
    const def = by({ on: true, off: ['stats:stress'] });
    const fresh = { [CREATING_KEY]: {} };
    expect(creationAction(def, fresh, { kind: 'at', step: 'stats:skills' }).data[CREATING_KEY]).toEqual({ at: 'stats:skills' });
    for (const step of ['stats:stress', 'stats:gone', 'stats']) expect(creationAction(def, fresh, { kind: 'at', step }).ok, step).toBe(false);
  });

  it('the checks take it, and say what is wrong', () => {
    expect(problems({ statsBy: 'group', order: ['who', 'stats:abilities'], off: ['stats:abilities'] }, GROUPS)).toEqual([]);
    expect(problems({ statsBy: 'all' }, GROUPS)).toEqual(['creation, statsBy: Must say group, or nothing for one way for all']);
    expect(problems({ order: ['stats:Bad Name'] }, GROUPS)).toEqual(['creation, order: Steps are who, stats, kits, money, stats: and a group\'s id, or list: and a list\'s id']);
  });

  it('the system file carries it, unchanged', () => {
    const creation = { on: true, statsBy: 'group', order: ['who', 'stats:skills', 'stats:abilities'], off: ['stats:stress'] };
    const file = citysys.buildFile({ definition: { ...GROUPS, creation }, version: 1, origin: 'sys_abcdefabcdefabcd' });
    const read = citysys.readFile(JSON.stringify(file));
    expect([read.file.definition.creation, read.problems]).toEqual([creation, []]);
  });
});

describe('a fixed array (7c3b)', () => {
  const ARRAY = { way: 'array', numbers: [15, 14, 13] };
  const STATS = [
    { id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }, { id: 'wits', label: 'Wits' }] },
    { id: 'skills', label: 'SKILLS', stats: [{ id: 'climb', label: 'Climb' }] },
  ];
  const DEF = { format: 1, name: 'A', stats: STATS, creation: { on: true, ways: { stats: ARRAY } } };
  const BY_GROUP = { ...DEF, creation: { on: true, statsBy: 'group', ways: { 'stats:abilities': { way: 'array', numbers: [15, 14] } } } };
  const at = { [CREATING_KEY]: { at: 'stats' } };
  const place = (data, stat, value, def = DEF, step = 'stats') => creationAction(def, data, { kind: 'place', step, stat, value });
  const issues = (creation, stats = STATS, more = {}) => checkDefinition({ format: 1, name: 'A', stats, creation, ...more }).problems.map((p) => `${p.where}: ${p.message}`);

  it('tells the browser the way of a step asked, and nothing of one typed in', () => {
    expect(creationShown(DEF).ways).toEqual({ stats: ARRAY });
    expect(creationShown({ ...DEF, creation: { on: true } }).ways).toBeUndefined();
    expect(creationShown(BY_GROUP).ways).toEqual({ 'stats:abilities': { way: 'array', numbers: [15, 14] } });
    // Kept for the other way of asking, not told.
    expect(creationShown({ ...DEF, creation: { on: true, statsBy: 'group', ways: { stats: ARRAY } } }).ways).toBeUndefined();
    expect(creationShown({ ...DEF, creation: { on: true, statsBy: 'group', off: ['stats:skills'], ways: { 'stats:skills': { way: 'array', numbers: [1] } } } }).ways).toBeUndefined();
  });

  it('what a stat holds counts once, and only what the pool has', () => {
    const stats = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    expect(placedFrom([15, 14, 14], stats, { a: 14, b: 14, c: 99 })).toEqual({ placed: { a: 14, b: 14 }, left: [15] });
    expect(placedFrom([15], stats, { a: 15, b: 15 })).toEqual({ placed: { a: 15 }, left: [] });
    expect(placedFrom([15], stats, { a: '15' })).toEqual({ placed: {}, left: [15] });
  });

  it('places a number on a stat, and the same number can\'t go twice', () => {
    const one = place(at, 'might', 15);
    expect(one.ok).toBe(true);
    expect(one.data.might).toBe(15);
    expect(place(one.data, 'wits', 15)).toEqual({ ok: false, error: 'That number is already placed' });
    expect(place(one.data, 'wits', 99)).toEqual({ ok: false, error: 'That number is already placed' });
    expect(place(one.data, 'wits', '14')).toEqual({ ok: false, error: 'That number is already placed' });
  });

  it('a number repeated in the array can go twice', () => {
    const twice = { ...DEF, creation: { on: true, ways: { stats: { way: 'array', numbers: [10, 10, 8] } } } };
    const one = place(at, 'might', 10, twice);
    expect(place(one.data, 'wits', 10, twice).data.wits).toBe(10);
  });

  it('a stat holding a number takes another, its old one going back', () => {
    const one = place(at, 'might', 15).data;
    const swapped = place(one, 'might', 14);
    expect(swapped.data.might).toBe(14);
    expect(place(swapped.data, 'wits', 15).data.wits).toBe(15);
    expect(place(one, 'might', 15).data.might).toBe(15);
  });

  it('takes a number back, leaving the stat empty', () => {
    const one = place(at, 'might', 15).data;
    const back = place(one, 'might', null);
    expect(back.ok).toBe(true);
    expect('might' in back.data).toBe(false);
    expect(back.data[CREATING_KEY]).toEqual({ at: 'stats' });
  });

  it('refuses what isn\'t this step\'s to place', () => {
    expect(place(at, 'nope', 15).error).toBe('Not one of this step\'s stats');
    expect(place(at, 'might', 15, DEF, 'stats:abilities').error).toBe('Not one of this game\'s steps');
    expect(place(at, 'might', 15, { ...DEF, creation: { on: true } }).error).toBe('These stats aren\'t placed');
    expect(place({}, 'might', 15).error).toBe('This character isn\'t being made');
    expect(place(at, 'climb', 15, BY_GROUP, 'stats:abilities').error).toBe('Not one of this step\'s stats');
    expect(place(at, 'might', 15, BY_GROUP, 'stats:abilities').ok).toBe(true);
    const out = { ...DEF, creation: { on: true, off: ['stats:skills'], ways: { stats: ARRAY } } };
    expect(place(at, 'climb', 15, out).error).toBe('Not one of this step\'s stats');
    const secret = { ...DEF, sheet: { sections: [{ id: 's', label: 'S', layout: 'grid', fields: [{ id: 'wits', label: 'Wits', type: 'number', edit: 'gm' }] }] } };
    expect(place(at, 'wits', 15, secret).error).toBe('Not one of this step\'s stats');
  });

  it('FINISH needs every stat holding a number; typed in stays as it was', () => {
    const none = creationAction(DEF, at, { kind: 'finish' });
    expect(none).toEqual({ ok: false, error: 'Every stat needs its number first' });
    const stale = { ...at, might: 99, wits: 14, climb: 13 };
    expect(creationAction(DEF, stale, { kind: 'finish' }).ok).toBe(false);
    expect(creationAction(DEF, { ...at, might: 15, wits: 14, climb: 13 }, { kind: 'finish' }).ok).toBe(true);
    expect(creationAction({ ...DEF, creation: { on: true } }, at, { kind: 'finish' }).ok).toBe(true);
    expect(creationAction(BY_GROUP, at, { kind: 'finish' }).ok).toBe(false);
    expect(creationAction(BY_GROUP, { ...at, might: 14, wits: 15 }, { kind: 'finish' }).ok).toBe(true);
  });

  it('a stat set this way is locked while it is being made, and only then', () => {
    expect([...lockedWhileCreating(DEF, at)]).toEqual(['might', 'wits', 'climb']);
    expect([...lockedWhileCreating(BY_GROUP, at)]).toEqual(['might', 'wits']);
    expect(lockedWhileCreating(DEF, {}).size).toBe(0);
    expect(lockedWhileCreating(DEF, { [CREATING_KEY]: { done: true } }).size).toBe(0);
    expect(lockedWhileCreating({ ...DEF, creation: { on: true } }, at).size).toBe(0);
    expect(lockedWhileCreating({ ...DEF, creation: { ...DEF.creation, on: false } }, at).size).toBe(0);
    expect(lockedWhileCreating(null, at).size).toBe(0);
    expect([...lockedWhileCreating({ ...DEF, creation: { ...DEF.creation, off: ['stats:skills'] } }, at)]).toEqual(['might', 'wits']);
  });

  it('the checks take it, and say what is wrong', () => {
    expect(issues({ ways: { stats: ARRAY } })).toEqual([]);
    expect(issues({ ways: { stats: { way: 'typed' } } })).toEqual([]);
    expect(issues({ ways: 'array' })).toEqual(['creation, ways: Must say how each step\'s stats are set']);
    expect(issues({ ways: { who: ARRAY } })).toEqual(['creation, ways, who: Only the stats have a way to be set']);
    expect(issues({ ways: { stats: 'array' } })).toEqual(['creation, ways, stats: Must be typed, array, roll or buy']);
    expect(issues({ ways: { stats: { way: 'dice' } } })).toEqual(['creation, ways, stats: Must be typed, array, roll or buy']);
    expect(issues({ ways: { stats: { way: 'typed', numbers: [1] } } })).toEqual(['creation, ways, stats, numbers: Not part of this way']);
    expect(issues({ ways: { stats: { way: 'array', numbers: 'three' } } })).toEqual(['creation, ways, stats, numbers: Must be a list of numbers']);
    expect(issues({ ways: { stats: { way: 'array', numbers: [1, 2, 3.5] } } })).toContain('creation, ways, stats, numbers: Must be whole numbers');
    expect(issues({ ways: { stats: { way: 'array', numbers: Array(LIMITS.numbers + 1).fill(1) } } })).toEqual([`creation, ways, stats, numbers: At most ${LIMITS.numbers} numbers`]);
  });

  it('says when too few numbers, or one that doesn\'t fit a stat, could leave a player stuck', () => {
    expect(issues({ ways: { stats: { way: 'array', numbers: [15] } } })).toEqual(['creation, ways, stats: 1 number for 3 stats: each stat needs one']);
    expect(issues({ ways: { stats: { way: 'array', numbers: [] } } })).toEqual(['creation, ways, stats: 0 numbers for 3 stats: each stat needs one']);
    const one = [{ id: 'g', label: 'G', stats: [{ id: 'a', label: 'Aim', min: 3, max: 18 }] }];
    expect(issues({ ways: { stats: { way: 'array', numbers: [19, 2, 18, 3] } } }, one)).toEqual([
      'creation, ways, stats: 19 is above Aim\'s highest, 18',
      'creation, ways, stats: 2 is below Aim\'s lowest, 3',
    ]);
    expect(issues({ ways: { stats: { way: 'array', numbers: [9, 9, 9, 9] } } })).toEqual([]);
  });

  it('only the way of a step the game has: one left for the other way of asking is no problem', () => {
    expect(issues({ statsBy: 'group', ways: { stats: { way: 'array', numbers: [] } } })).toEqual([]);
    expect(issues({ ways: { 'stats:skills': { way: 'array', numbers: [] } } })).toEqual([]);
    expect(issues({ statsBy: 'group', ways: { 'stats:skills': { way: 'array', numbers: [] } } })).toEqual(['creation, ways, stats:skills: 0 numbers for 1 stat: each stat needs one']);
    expect(stepWayProblems(DEF, 'stats')).toEqual([]);
    expect(issues({ off: ['stats:skills'], ways: { stats: { way: 'array', numbers: [15, 14] } } })).toEqual([]);
  });

  it('the system file carries it, unchanged', () => {
    const creation = { on: true, ways: { stats: ARRAY } };
    const file = citysys.buildFile({ definition: { ...DEF, creation }, version: 1, origin: 'sys_abcdefabcdefabcd' });
    const read = citysys.readFile(JSON.stringify(file));
    expect([read.file.definition.creation, read.problems]).toEqual([creation, []]);
  });
});

describe('rolled (7c3c)', () => {
  const STATS = [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }, { id: 'wits', label: 'Wits' }] }];
  const def = (placed = 'arrange', each = '4d6 drop lowest', step = 'stats', more = {}) => ({ format: 1, name: 'R', stats: STATS, creation: { on: true, ways: { [step]: { way: 'roll', each, placed } }, ...more } });
  const at = { [CREATING_KEY]: { at: 'stats' } };
  /** Dice that land on these faces, of a d6, in turn. */
  const dice = (...faces) => { let i = 0; return () => (faces[i++ % faces.length] - 0.5) / 6; };
  // Might: 6 5 3 1 = 14 dropping the 1. Wits: 2 2 4 1 = 8 dropping the 1.
  const FACES = [6, 5, 3, 1, 2, 2, 4, 1];
  const roll = (data, d = def(), rng = dice(...FACES), step = 'stats') => creationAction(d, data, { kind: 'roll', step }, { rng });

  it('reads what a GM writes, and nothing else', () => {
    expect(parseStatRoll('3d6')).toEqual({ count: 3, sides: 6, drop: 0, which: null, add: 0 });
    expect(parseStatRoll('4d6 drop lowest')).toEqual({ count: 4, sides: 6, drop: 1, which: 'lowest', add: 0 });
    expect(parseStatRoll(' 5D6  DROP HIGHEST 2 ')).toEqual({ count: 5, sides: 6, drop: 2, which: 'highest', add: 0 });
    expect(parseStatRoll('2d6 + 6')).toEqual({ count: 2, sides: 6, drop: 0, which: null, add: 6 });
    expect(parseStatRoll('2d6-1')).toEqual({ count: 2, sides: 6, drop: 0, which: null, add: -1 });
    expect(parseStatRoll('d20')).toEqual({ count: 1, sides: 20, drop: 0, which: null, add: 0 });
    expect(parseStatRoll('4d6 drop lowest + 1')).toEqual({ count: 4, sides: 6, drop: 1, which: 'lowest', add: 1 });
    for (const bad of ['', 'four', '4d', '0d6', '21d6', '4d1', '4d101', '4d6 drop', '4d6 drop lowest 4', '4d6 drop lowest 0', '1d6 drop lowest', '2d6 + 1001', '2d6 * 10', 7, null]) {
      expect(parseStatRoll(bad), String(bad)).toBeNull();
    }
    expect(parseStatRoll('20d100 + 1000')).not.toBeNull();
  });

  it('knows the lowest and highest a roll comes to', () => {
    expect(statRollRange(parseStatRoll('4d6 drop lowest'))).toEqual({ lo: 3, hi: 18 });
    expect(statRollRange(parseStatRoll('2d6 + 6'))).toEqual({ lo: 8, hi: 18 });
    expect(statRollRange(parseStatRoll('5d6 drop highest 2 - 1'))).toEqual({ lo: 2, hi: 17 });
  });

  it('arranged: every stat gets a roll, dropping as it says, kept and waiting to be placed', () => {
    const done = roll(at);
    expect(done.data[CREATING_KEY].rolled).toEqual({ stats: [14, 8] });
    expect([done.data.might, done.data.wits]).toEqual([undefined, undefined]);
    expect(done.data[CREATING_KEY].at).toBe('stats');
  });

  it('drops the highest when it says so, and adds what it says', () => {
    expect(roll(at, def('order', '4d6 drop highest')).data.might).toBe(1 + 3 + 5);
    expect(roll(at, def('order', '2d6 + 6'), dice(6, 5, 3, 1)).data.might).toBe(17);
    expect(roll(at, def('order', '3d6'), dice(6, 5, 3)).data.might).toBe(14);
    expect(roll(at, def('order', '4d6 drop lowest 2')).data.might).toBe(11);
  });

  it('in order: each goes straight on its stat', () => {
    const done = roll(at, def('order'));
    expect([done.data.might, done.data.wits]).toEqual([14, 8]);
    expect(done.data[CREATING_KEY].rolled).toEqual({ stats: [14, 8] });
  });

  it('says it for the log: what was thrown, what each came to, and whose in order', () => {
    const { rolled } = roll(at, def('order'));
    expect(rolled).toMatchObject({ label: 'THE STATS', each: '4d6 drop lowest', sides: 6, rolls: FACES, totals: [14, 8], total: 22, named: ['Might', 'Wits'] });
    expect(statRollLine('Wren', rolled)).toBe('Wren rolled THE STATS (4d6 drop lowest): Might 14, Wits 8');
    expect(statRollLine('Wren', roll(at).rolled)).toBe('Wren rolled THE STATS (4d6 drop lowest): 14, 8');
    const group = roll(at, def('arrange', '4d6 drop lowest', 'stats:abilities', { statsBy: 'group' }), dice(...FACES), 'stats:abilities');
    expect(group.rolled.label).toBe('ABILITIES');
  });

  it('once rolled it stays rolled', () => {
    const once = roll(at).data;
    expect(roll(once)).toEqual({ ok: false, error: 'Rolled, and kept: your GM can clear it for another go' });
    expect(creationAction(def(), once, { kind: 'at', step: 'stats' }).data[CREATING_KEY].rolled).toEqual({ stats: [14, 8] });
  });

  it('each step rolls for itself', () => {
    const two = [...STATS, { id: 'skills', label: 'SKILLS', stats: [{ id: 'climb', label: 'Climb' }] }];
    const d = { format: 1, name: 'R', stats: two, creation: { on: true, statsBy: 'group', ways: { 'stats:abilities': { way: 'roll', each: '3d6', placed: 'order' }, 'stats:skills': { way: 'roll', each: '1d6', placed: 'order' } } } };
    const first = creationAction(d, at, { kind: 'roll', step: 'stats:abilities' }, { rng: dice(1, 1, 1) }).data;
    const second = creationAction(d, first, { kind: 'roll', step: 'stats:skills' }, { rng: dice(4) }).data;
    expect(second[CREATING_KEY].rolled).toEqual({ 'stats:abilities': [3, 3], 'stats:skills': [4] });
    expect(second.climb).toBe(4);
  });

  it('refuses what isn\'t this step\'s to roll', () => {
    expect(roll(at, { ...def(), creation: { on: true } }).error).toBe('These stats aren\'t rolled');
    expect(roll(at, def(), dice(1), 'kits').error).toBe('Not one of this game\'s steps');
    expect(roll({}).error).toBe('This character isn\'t being made');
    expect(roll(at, def('arrange', 'nonsense')).error).toBe('This game\'s roll doesn\'t read');
  });

  it('rolls with the secure dice unless handed others', () => {
    // Twenty dice of a hundred sides all landing on 1 isn't going to happen on real dice.
    const done = creationAction(def('order', '20d100'), at, { kind: 'roll', step: 'stats' });
    expect(done.data.might).toBeGreaterThan(20);
    expect(done.data.might).toBeLessThanOrEqual(2000);
  });

  it('arranged, placed from what came up; before rolling nothing can be; in order nothing is', () => {
    const place = (data, stat, value, d = def()) => creationAction(d, data, { kind: 'place', step: 'stats', stat, value });
    expect(place(at, 'might', 14).error).toBe('Roll them first');
    const once = roll(at).data;
    expect(place(once, 'might', 99).error).toBe('That number is already placed');
    const placed = place(once, 'might', 14).data;
    expect(placed.might).toBe(14);
    expect(place(placed, 'wits', 14).error).toBe('That number is already placed');
    expect('might' in place(placed, 'might', null).data).toBe(false);
    expect(place(roll(at, def('order')).data, 'might', 8, def('order')).error).toBe('These stats aren\'t placed');
  });

  it('FINISH needs it rolled, and placed', () => {
    const finish = (data, d = def()) => creationAction(d, data, { kind: 'finish' });
    expect(finish(at).error).toBe('Every stat needs its number first');
    const once = roll(at).data;
    expect(finish(once).error).toBe('Every stat needs its number first');
    expect(finish({ ...once, might: 14, wits: 8 }).data).toEqual({ might: 14, wits: 8, [CREATING_KEY]: { done: true, given: { items: [], pay: [] } } });
    expect(finish(roll(at, def('order')).data, def('order')).ok).toBe(true);
  });

  it('is locked on the sheet while being made, as any way but typing', () => {
    expect([...lockedWhileCreating(def(), at)]).toEqual(['might', 'wits']);
  });

  it('tells the browser the way', () => {
    expect(creationShown(def('order')).ways).toEqual({ stats: { way: 'roll', each: '4d6 drop lowest', placed: 'order' } });
  });

  it('the checks take it, and say what is wrong', () => {
    const issues = (way, stats = STATS) => checkDefinition({ format: 1, name: 'R', stats, creation: { ways: { stats: way } } }).problems.map((p) => `${p.where}: ${p.message}`);
    expect(issues({ way: 'roll', each: '4d6 drop lowest', placed: 'order' })).toEqual([]);
    expect(issues({ way: 'roll', each: '4d6 drop lowest', placed: 'arrange' })).toEqual([]);
    expect(issues({ way: 'roll', placed: 'order' })).toEqual(['creation, ways, stats, each: Must say what each is rolled with']);
    expect(issues({ way: 'roll', each: '3d6', placed: 'sideways' })).toEqual(['creation, ways, stats, placed: Must be order or arrange']);
    expect(issues({ way: 'roll', each: '3d6' })).toEqual(['creation, ways, stats, placed: Must be order or arrange']);
    expect(issues({ way: 'roll', each: '3d6', placed: 'order', numbers: [1] })).toEqual(['creation, ways, stats, numbers: Not part of this way']);
    expect(issues({ way: 'roll', each: 'lots', placed: 'order' })).toEqual(['creation, ways, stats: Reads like 3d6, 4d6 drop lowest or 2d6 + 6, up to 20 dice of up to 100 sides']);
    expect(issues({ way: 'dice' })).toEqual(['creation, ways, stats: Must be typed, array, roll or buy']);
  });

  it('says when it could come to what a stat can\'t hold', () => {
    const ranged = [{ id: 'g', label: 'G', stats: [{ id: 'a', label: 'Aim', min: 3, max: 18 }, { id: 'b', label: 'Bow', min: 5, max: 12 }] }];
    expect(stepWayProblems({ format: 1, name: 'R', stats: ranged, creation: { ways: { stats: { way: 'roll', each: '3d6', placed: 'order' } } } }, 'stats')).toEqual([
      '3d6 can roll 3, below Bow\'s lowest, 5',
      '3d6 can roll 18, above Bow\'s highest, 12',
    ]);
  });

  it('the system file carries it, unchanged', () => {
    const d = def();
    const read = citysys.readFile(JSON.stringify(citysys.buildFile({ definition: d, version: 1, origin: 'sys_abcdefabcdefabcd' })));
    expect([read.file.definition.creation, read.problems]).toEqual([d.creation, []]);
  });
});

describe('a point buy (7c3d)', () => {
  const STATS = [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }, { id: 'wits', label: 'Wits' }] }];
  const FLAT = { way: 'buy', points: 4, lowest: 8, highest: 12 };
  const COSTED = { ...FLAT, points: 5, costs: { 8: 0, 9: 1, 10: 2, 11: 4, 12: 6 } };
  const def = (way = COSTED, more = {}) => ({ format: 1, name: 'B', stats: STATS, creation: { on: true, ways: { stats: way }, ...more } });
  const at = { [CREATING_KEY]: { at: 'stats' } };
  const buy = (data, stat, value, d = def()) => creationAction(d, data, { kind: 'buy', step: 'stats', stat, value });
  const issues = (way, stats = STATS, more = {}) => checkDefinition({ format: 1, name: 'B', stats, creation: { ways: { stats: way } }, ...more }).problems.map((p) => `${p.where}: ${p.message}`);

  it('every stat starts at the lowest on arriving, and a number it can\'t hold goes back to it', () => {
    const on = creationAction(def(), { [CREATING_KEY]: {} }, { kind: 'at', step: 'stats' }).data;
    expect([on.might, on.wits]).toEqual([8, 8]);
    expect(on[CREATING_KEY]).toEqual({ at: 'stats' });
    const stale = creationAction(def(), { might: 99, wits: 10, [CREATING_KEY]: {} }, { kind: 'at', step: 'stats' }).data;
    expect([stale.might, stale.wits]).toEqual([8, 10]);
    const below = creationAction(def(), { might: 3, [CREATING_KEY]: {} }, { kind: 'at', step: 'stats' }).data;
    expect(below.might).toBe(8);
    const typed = { ...def(), creation: { on: true } };
    expect(creationAction(typed, { [CREATING_KEY]: {} }, { kind: 'at', step: 'stats' }).data.might).toBeUndefined();
  });

  it('arriving elsewhere leaves them alone', () => {
    const d = { ...def(), choices: [{ id: 'classes', one: 'Class', many: 'Classes', options: [{ id: 'a', label: 'A' }] }] };
    expect(creationAction(d, { [CREATING_KEY]: {} }, { kind: 'at', step: 'list:classes' }).data.might).toBeUndefined();
  });

  it('buys up and down by the table, filling in the others', () => {
    const up = buy(at, 'might', 11);
    expect(up.ok).toBe(true);
    expect([up.data.might, up.data.wits]).toEqual([11, 8]);
    expect(buy(up.data, 'might', 10).data.might).toBe(10);
  });

  it('holds to the points: the table\'s cost, or 1 for 1 with none', () => {
    const spent = buy(at, 'might', 11).data;
    expect(buy(spent, 'wits', 9).ok).toBe(true);
    expect(buy(spent, 'wits', 10)).toEqual({ ok: false, error: 'Not enough points left' });
    expect(buy(at, 'might', 12).ok).toBe(false);
    const flat = def(FLAT);
    const three = buy(at, 'might', 11, flat).data;
    expect(buy(three, 'wits', 9, flat).ok).toBe(true);
    expect(buy(three, 'wits', 10, flat).error).toBe('Not enough points left');
    expect(buy(at, 'might', 12, flat).ok).toBe(true);
  });

  it('going down always may, even over the points after the GM changes them', () => {
    const over = { might: 12, wits: 12, [CREATING_KEY]: { at: 'stats' } };
    expect(buy(over, 'might', 11).ok).toBe(true);
    expect(buy(over, 'might', 11).data.might).toBe(11);
  });

  it('only to a whole number in the range, on this step\'s stats, in this way', () => {
    expect(buy(at, 'might', 13).error).toBe('From 8 to 12');
    expect(buy(at, 'might', 7).error).toBe('From 8 to 12');
    expect(buy(at, 'might', 9.5).error).toBe('From 8 to 12');
    expect(buy(at, 'might', '9').error).toBe('From 8 to 12');
    expect(buy(at, 'nope', 9).error).toBe('Not one of this step\'s stats');
    expect(buy(at, 'might', 9, { ...def(), creation: { on: true } }).error).toBe('These stats aren\'t bought');
    expect(creationAction(def(), at, { kind: 'buy', step: 'kits', stat: 'might', value: 9 }).error).toBe('Not one of this game\'s steps');
    expect(buy({}, 'might', 9).error).toBe('This character isn\'t being made');
  });

  it('isn\'t placed or rolled', () => {
    expect(creationAction(def(), at, { kind: 'place', step: 'stats', stat: 'might', value: 9 }).error).toBe('These stats aren\'t placed');
    expect(creationAction(def(), at, { kind: 'roll', step: 'stats' }).error).toBe('These stats aren\'t rolled');
  });

  it('FINISH takes points left over, fills in any not bought, and refuses too many', () => {
    const done = creationAction(def(), at, { kind: 'finish' });
    expect(done.data).toEqual({ might: 8, wits: 8, [CREATING_KEY]: { done: true, given: { items: [], pay: [] } } });
    const over = { might: 12, wits: 12, [CREATING_KEY]: { at: 'stats' } };
    expect(creationAction(def(), over, { kind: 'finish' })).toEqual({ ok: false, error: 'More points spent than there are' });
    expect(creationAction(def(), { might: 11, wits: 9, ...at }, { kind: 'finish' }).ok).toBe(true);
  });

  it('is locked on the sheet while being made, as any way but typing', () => {
    expect([...lockedWhileCreating(def(), at)]).toEqual(['might', 'wits']);
  });

  it('tells the browser the way', () => {
    expect(creationShown(def()).ways).toEqual({ stats: COSTED });
  });

  it('the checks take it, and say what is wrong', () => {
    expect(issues(FLAT)).toEqual([]);
    expect(issues(COSTED)).toEqual([]);
    expect(issues({ ...FLAT, points: 'lots' })).toEqual(['creation, ways, stats, points: Must be a whole number']);
    expect(issues({ ...FLAT, lowest: 1.5 })).toEqual(['creation, ways, stats, lowest: Must be a whole number']);
    expect(issues({ ...FLAT, highest: null })).toEqual(['creation, ways, stats, highest: Must be a whole number']);
    expect(issues({ ...FLAT, points: -1 })).toContain('creation, ways, stats, points: From 0 to 100000');
    expect(issues({ ...FLAT, points: 100001 })).toEqual(['creation, ways, stats, points: From 0 to 100000']);
    expect(issues({ ...FLAT, costs: 'high' })).toEqual(['creation, ways, stats, costs: Must say what each number costs']);
    expect(issues({ ...FLAT, numbers: [1] })).toEqual(['creation, ways, stats, numbers: Not part of this way']);
  });

  it('says what would leave a player stuck', () => {
    const problems = (way, stats = STATS) => stepWayProblems({ format: 1, name: 'B', stats, creation: { ways: { stats: way } } }, 'stats');
    expect(problems(FLAT)).toEqual([]);
    expect(problems({ ...FLAT, lowest: 13 })).toEqual(['The lowest is above the highest']);
    expect(problems({ ...FLAT, highest: FLAT.lowest + LIMITS.buyRange })).toEqual([`At most ${LIMITS.buyRange} numbers`]);
    expect(problems({ ...FLAT, highest: FLAT.lowest + LIMITS.buyRange - 1 })).toEqual([]);
    expect(problems({ ...COSTED, costs: { 8: 0, 9: 1, 10: -2, 12: 6 } })).toEqual(['10, 11 needs a cost, of 0 or more']);
    expect(problems({ ...FLAT, points: 3, costs: { 8: 2, 9: 3, 10: 4, 11: 5, 12: 6 } })).toEqual(['Every stat at its lowest costs 4, more than the 3 points']);
    const ranged = [{ id: 'g', label: 'G', stats: [{ id: 'a', label: 'Aim', min: 9, max: 11 }] }];
    expect(problems(FLAT, ranged)).toEqual(['8 is below Aim\'s lowest, 9', '12 is above Aim\'s highest, 11']);
  });

  it('the system file carries it, unchanged', () => {
    const d = def();
    const read = citysys.readFile(JSON.stringify(citysys.buildFile({ definition: d, version: 1, origin: 'sys_abcdefabcdefabcd' })));
    expect([read.file.definition.creation, read.problems]).toEqual([d.creation, []]);
  });
});

describe('kits (7c4a)', () => {
  const KIT = { id: 'traveler', name: 'TRAVELER', items: [{ name: 'Rope', qty: 1 }, { name: 'Rations', qty: 3 }], who: 'pick' };
  const STATS = [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'wits', label: 'Wits' }] }];
  const issues = (kits, more = {}) => checkDefinition({ format: 1, name: 'K', stats: STATS, creation: { kits }, ...more }).problems.map((p) => `${p.where}: ${p.message}`);
  const one = (patch) => issues([{ ...KIT, ...patch }]);

  it('take what the page writes, each way of going', () => {
    expect(issues([KIT])).toEqual([]);
    expect(issues([])).toEqual([]);
    expect(one({ who: 'all' })).toEqual([]);
    expect(one({ who: 'gm' })).toEqual([]);
    expect(one({ who: 'needs', requires: '@wits >= 12' })).toEqual([]);
  });

  it('say what is wrong with the list', () => {
    expect(issues('kits')).toEqual(['creation, kits: Must be a list of kits']);
    expect(issues([3])).toEqual(['creation, kit 1: Must be a kit']);
    expect(issues(Array.from({ length: LIMITS.kits + 1 }, (_, i) => ({ ...KIT, id: `k${i}` })))).toEqual([`creation, kits: At most ${LIMITS.kits} kits`]);
    expect(issues([KIT, KIT])).toEqual(['creation, kit TRAVELER: Another kit has this id already']);
    // A list far too long is said once, not kit by kit.
    expect(issues(Array(LIMITS.kits + 10).fill(KIT))).toHaveLength(LIMITS.kits);
  });

  it('say what is wrong with a kit', () => {
    expect(one({ extra: 1 })).toEqual(['creation, kit TRAVELER, extra: Not part of a kit']);
    expect(one({ id: 'Bad Id' })).toEqual(['creation, kit TRAVELER: Ids use lowercase letters, digits and _, starting with a letter']);
    expect(one({ id: 3 })).toEqual(['creation, kit TRAVELER: Ids use lowercase letters, digits and _, starting with a letter']);
    expect(one({ name: '  ' })).toEqual(['creation, kit 1: Needs a name']);
    expect(one({ name: 7 })).toEqual(['creation, kit 1: Needs a name']);
    expect(one({ name: 'x'.repeat(LIMITS.kitName + 1) })[0]).toContain(`Longer than ${LIMITS.kitName} characters`);
    expect(one({ name: 'x'.repeat(LIMITS.kitName) })).toEqual([]);
    expect(one({ who: 'nobody' })).toEqual(['creation, kit TRAVELER, who: Must be all, pick, needs or gm']);
  });

  it('a requirement goes with ONLY IF, and reads', () => {
    expect(one({ who: 'needs' })).toEqual(['creation, kit TRAVELER, requires: ONLY IF needs a requirement']);
    expect(one({ who: 'needs', requires: '  ' })).toEqual(['creation, kit TRAVELER, requires: ONLY IF needs a requirement']);
    expect(one({ who: 'pick', requires: '@wits' })).toEqual(['creation, kit TRAVELER, requires: Only a kit going ONLY IF has a requirement']);
    expect(one({ who: 'needs', requires: '@wits >=' })[0]).toMatch(/^creation, kit TRAVELER, requires: /);
    expect(issues([{ ...KIT, who: 'needs', requires: 'bonus(@wits) > 1' }], { lookups: { bonus: [[0, 1]] } }).filter((p) => p.startsWith('creation'))).toEqual([]);
    expect(one({ who: 'needs', requires: 'bonus(@wits) > 1' }).length).toBeGreaterThan(0);
  });

  it('has() in a requirement names something real, as a list\'s does', () => {
    expect(one({ who: 'needs', requires: 'has(nope)' }).some((p) => p.includes('has(nope): no option or feature is called that'))).toBe(true);
  });

  it('say what is wrong with its items', () => {
    expect(one({ items: 'Rope' })).toEqual(['creation, kit TRAVELER, items: Must be a list of items']);
    expect(one({ items: [] })).toEqual(['creation, kit TRAVELER, items: Has nothing in it']);
    expect(one({ items: Array(LIMITS.kitItems + 1).fill({ name: 'Rope', qty: 1 }) })).toEqual([`creation, kit TRAVELER, items: At most ${LIMITS.kitItems} items`]);
    expect(one({ items: ['Rope'] })).toEqual(['creation, kit TRAVELER, items: Each must be an item']);
    expect(one({ items: Array(LIMITS.kitItems + 10).fill('Rope') })).toHaveLength(LIMITS.kitItems + 1);
    expect(one({ items: [{ name: 'Rope', qty: 1, price: 3 }] })).toEqual(['creation, kit TRAVELER, items, price: Not part of an item']);
    expect(one({ items: [{ name: ' ', qty: 1 }] })).toEqual(['creation, kit TRAVELER, items: Each item needs a name']);
    expect(one({ items: [{ name: 'x'.repeat(LIMITS.itemName + 1), qty: 1 }] })[0]).toContain(`longer than ${LIMITS.itemName} characters`);
    expect(one({ items: [{ name: 'x'.repeat(LIMITS.itemName), qty: 1 }] })).toEqual([]);
    for (const qty of [0, 100, 1.5, '3']) expect(one({ items: [{ name: 'Rope', qty }] }), String(qty)).toEqual([`creation, kit TRAVELER, items: Rope: from 1 to ${LIMITS.itemQty} of it`]);
    expect(one({ items: [{ name: 'Rope', qty: 99 }] })).toEqual([]);
  });

  it('the system file carries them, unchanged', () => {
    const creation = { on: true, kits: [KIT, { ...KIT, id: 'mage_kit', who: 'needs', requires: '@wits >= 12' }] };
    const read = citysys.readFile(JSON.stringify(citysys.buildFile({ definition: { format: 1, name: 'K', stats: STATS, creation }, version: 1, origin: 'sys_abcdefabcdefabcd' })));
    expect([read.file.definition.creation, read.problems]).toEqual([creation, []]);
  });

  it('a sheet designed with no inventory is told: there is nowhere for them to land', () => {
    const sheet = (layout) => ({ sheet: { sections: [{ id: 's', label: 'S', layout, fields: [] }] } });
    const hides = 'creation, kits: Kits land in the inventory, and this sheet has none: add one on CHARACTER SHEET';
    expect(issues([KIT], sheet('notes')).filter((p) => p.startsWith('creation'))).toEqual([hides]);
    expect(issues([KIT], sheet('inventory')).filter((p) => p.startsWith('creation'))).toEqual([]);
    expect(issues([], sheet('notes')).filter((p) => p.startsWith('creation'))).toEqual([]);
    expect(issues([KIT])).toEqual([]);
  });
});

describe('kits at the table (7c4b)', () => {
  const ALL = { id: 'essentials', name: 'ESSENTIALS', items: [{ name: 'Knife', qty: 1 }], who: 'all' };
  const PICK = { id: 'traveler', name: 'TRAVELER', items: [{ name: 'Rope', qty: 1 }, { name: 'Rations', qty: 3 }], who: 'pick' };
  const NEEDS = { id: 'potions', name: 'POTION MAKER', items: [{ name: 'Mortar', qty: 1 }], who: 'needs', requires: '@wits >= 12' };
  const GM = { id: 'rook', name: 'ROOK\'S KIT', items: [{ name: 'Letter', qty: 1 }], who: 'gm' };
  const STATS = [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'wits', label: 'Wits' }] }];
  const def = (kits = [ALL, PICK, NEEDS, GM], more = {}) => ({ format: 1, name: 'K', stats: STATS, creation: { on: true, kits, ...more } });
  const at = { [CREATING_KEY]: { at: 'kits' } };
  const pick = (data, kit, d = def()) => creationAction(d, data, { kind: 'kit', kit });
  const finish = (data, d = def()) => creationAction(d, data, { kind: 'finish' });

  it('asked with a kit for players to get; not with only the GM\'s, none, or the step off', () => {
    expect(stepsAsked(def())).toContain('kits');
    expect(stepsAsked(def([ALL]))).toContain('kits');
    expect(stepsAsked(def([GM]))).not.toContain('kits');
    expect(stepsAsked(def([]))).not.toContain('kits');
    expect(stepsAsked(def([PICK], { off: ['kits'] }))).not.toContain('kits');
  });

  it('tells the browser what a player may see: never a kit the GM gives, nor a formula', () => {
    const { kits } = creationShown(def());
    expect(kits).toEqual([
      { id: 'essentials', name: 'ESSENTIALS', items: ALL.items, who: 'all' },
      { id: 'traveler', name: 'TRAVELER', items: PICK.items, who: 'pick' },
      { id: 'potions', name: 'POTION MAKER', items: NEEDS.items, who: 'needs', needs: 'WITS >= 12' },
    ]);
    expect(JSON.stringify(kits)).not.toContain('ROOK');
    expect(JSON.stringify(kits)).not.toContain('@wits');
    expect(creationShown(def([GM])).kits).toBeUndefined();
  });

  it('the requirement is worked out with the sheet, and only says what isn\'t met', () => {
    const { workedOf } = require_('../systemBuilder/choices');
    expect(workedOf(def(), { wits: 3 }).kitsUnmet).toEqual(['potions']);
    expect(workedOf(def(), { wits: 12 }).kitsUnmet).toEqual([]);
    expect('kitsUnmet' in workedOf(def([PICK]), {})).toBe(false);
    expect('kitsUnmet' in workedOf({ format: 1, name: 'K' }, {})).toBe(false);
  });

  it('one is picked and kept with their place; another takes its place, and null puts it back', () => {
    const one = pick(at, 'traveler').data;
    expect(one[CREATING_KEY]).toEqual({ at: 'kits', kit: 'traveler' });
    expect(pick({ ...one, wits: 12 }, 'potions').data[CREATING_KEY]).toEqual({ at: 'kits', kit: 'potions' });
    expect(pick(one, null).data[CREATING_KEY]).toEqual({ at: 'kits' });
    expect(creationAction(def(), one, { kind: 'at', step: 'stats' }).data[CREATING_KEY].kit).toBe('traveler');
  });

  it('refuses what isn\'t theirs to pick', () => {
    expect(pick(at, 'rook').error).toBe('Not a kit to pick from');
    expect(pick(at, 'essentials').error).toBe('Not a kit to pick from');
    expect(pick(at, 'nope').error).toBe('Not a kit to pick from');
    expect(pick(at, undefined).error).toBe('Not a kit to pick from');
    expect(pick({ ...at, wits: 3 }, 'potions').error).toBe('POTION MAKER needs WITS >= 12');
    expect(pick({}, 'traveler').error).toBe('This character isn\'t being made');
    expect(pick(at, 'traveler', def([PICK], { off: ['kits'] })).error).toBe('Not one of this game\'s steps');
  });

  it('FINISH needs a pick while one can be made; not with none in reach, nor nothing to pick', () => {
    expect(finish(at).error).toBe('Pick a kit first');
    expect(finish({ ...at, wits: 3 }, def([ALL, NEEDS])).ok).toBe(true);
    expect(finish(at, def([ALL])).ok).toBe(true);
    expect(finish({ ...at, wits: 12 }, def([ALL, NEEDS])).error).toBe('Pick a kit first');
    expect(finish(at, def([PICK], { off: ['kits'] })).ok).toBe(true);
  });

  it('FINISH refuses a kit they have since stopped meeting', () => {
    const kept = { wits: 3, [CREATING_KEY]: { at: 'kits', kit: 'potions' } };
    expect(finish(kept).error).toBe('POTION MAKER needs WITS >= 12');
    expect(finish({ ...kept, wits: 12 }).ok).toBe(true);
  });

  it('FINISH says what to give: every kit everyone gets, then the one picked, and none other', () => {
    const done = finish(pick(at, 'traveler').data);
    expect(done.items).toEqual([{ name: 'Knife', qty: 1 }, { name: 'Rope', qty: 1 }, { name: 'Rations', qty: 3 }]);
    expect(done.data[CREATING_KEY]).toEqual({ done: true, given: { items: done.items, pay: [] } });
    expect(finish(at, def([ALL])).items).toEqual([{ name: 'Knife', qty: 1 }]);
    expect(finish(at, def([GM])).items).toEqual([]);
    expect(finish(at, def([ALL], { off: ['kits'] })).items).toEqual([]);
  });
});

describe('starting money (7c4d)', () => {
  const GOLD = { id: 'gold', name: 'Gold', short: 'gp', denominations: [{ id: 'gp', name: 'Gold', short: 'gp', value: 100 }, { id: 'cp', name: 'Copper', short: 'cp', value: 1 }] };
  const DOLLARS = { id: 'dollars', name: 'Dollars', symbol: '$', decimals: 2 };
  const HONOR = { id: 'honor', name: 'Honor' };
  const three = { format: 1, name: 'M', currencies: [GOLD, DOLLARS, HONOR] };
  const def = (money, more = {}) => ({ ...three, creation: { on: true, money }, ...more });
  const single = (money) => ({ format: 1, name: 'M', creation: { on: true, money } });
  const at = { [CREATING_KEY]: { at: 'money' } };
  const dice = (...faces) => { let i = 0; return () => (faces[i++ % faces.length] - 0.5) / 6; };
  const roll = (data, d, id, rng = dice(3, 4, 5)) => creationAction(d, data, { kind: 'moneyRoll', id }, { rng });
  const type = (data, d, id, amount) => creationAction(d, data, { kind: 'moneyTyped', id, amount });
  const finish = (data, d) => creationAction(d, data, { kind: 'finish' });
  const issues = (money, more = {}) => checkDefinition({ ...three, creation: { money }, ...more }).problems.map((p) => `${p.where}: ${p.message}`);

  it('reads a roll, with a multiple after it if it likes', () => {
    expect(parseMoneyRoll('3d6 * 10')).toEqual({ roll: parseStatRoll('3d6'), times: 10 });
    expect(parseMoneyRoll('4d6 drop lowest*2')).toEqual({ roll: parseStatRoll('4d6 drop lowest'), times: 2 });
    expect(parseMoneyRoll('2d6 + 3')).toEqual({ roll: parseStatRoll('2d6 + 3'), times: 1 });
    for (const bad of ['', 'lots', '3d6 * x', '3d6 * 0', '3d6 * 1001', '* 10', 5]) expect(parseMoneyRoll(bad), String(bad)).toBeNull();
    expect(parseMoneyRoll('3d6 * 1000')).not.toBeNull();
  });

  it('a whole piece: the biggest coin, a dollar, or as it comes', () => {
    expect([wholeOf(GOLD), wholeOf(DOLLARS), wholeOf(HONOR)]).toEqual([100, 100, 1]);
  });

  it('asked with something set and the bank on, in order, passing over a currency gone', () => {
    expect(stepsAsked(def({ gold: { how: 'typed' } }))).toContain('money');
    expect(stepsAsked(def({}))).not.toContain('money');
    expect(stepsAsked(three)).not.toContain('money');
    expect(stepsAsked(def({ gold: { how: 'typed' } }, { parts: { bank: { on: false } } }))).not.toContain('money');
    expect(stepsAsked(def({ gone: { how: 'typed' } }))).not.toContain('money');
    expect(moneyOf(def({ honor: { how: 'typed' }, gold: { how: 'typed' }, gone: { how: 'typed' } })).map((e) => e.id)).toEqual(['gold', 'honor']);
    expect(moneyOf(def({ gold: { how: 'nope' } }))).toEqual([]);
    // With the bank off, nowhere to pay it, so nothing said of it either.
    const noBank = def({ gold: { how: 'typed' } }, { parts: { bank: { on: false } } });
    expect(moneyOf(noBank)).toEqual([]);
    expect(creationShown(noBank).money).toBeUndefined();
    expect(moneyOf(def({ gold: 'typed' }))).toEqual([]);
  });

  it('with no currencies of its own, the app\'s money is called main', () => {
    expect(moneyOf(single({ main: { how: 'typed' } })).map((e) => e.id)).toEqual(['main']);
    expect(moneyOf(def({ main: { how: 'typed' } }))).toEqual([]);
  });

  it('tells the browser each amount in words, and nothing of one unsaid', () => {
    expect(creationShown(def({ gold: { how: 'roll', each: '3d6 * 10' }, dollars: { how: 'number', amount: 500 }, honor: { how: 'typed' } })).money).toEqual([
      { id: 'gold', name: 'Gold', how: 'roll', each: '3d6 * 10' },
      { id: 'dollars', name: 'Dollars', how: 'number', amount: 500 },
      { id: 'honor', name: 'Honor', how: 'typed' },
    ]);
    expect(creationShown(def({})).money).toBeUndefined();
  });

  it('a roll is whole pieces, kept, and said for the log', () => {
    const d = def({ gold: { how: 'roll', each: '3d6 * 10' }, dollars: { how: 'roll', each: '3d6' }, honor: { how: 'roll', each: '3d6' } });
    const done = roll(at, d, 'gold');
    expect(done.data[CREATING_KEY].money).toEqual({ gold: 120 * 100 });
    expect(done.data[CREATING_KEY].at).toBe('money');
    expect(done.rolled).toMatchObject({ label: 'GOLD', each: '3d6 * 10', sides: 6, rolls: [3, 4, 5], totals: [120], total: 120, named: null });
    expect(statRollLine('Wren', done.rolled)).toBe('Wren rolled GOLD (3d6 * 10): 120');
    expect(roll(done.data, d, 'gold')).toEqual({ ok: false, error: 'Rolled, and kept: your GM can clear it for another go' });
    const both = roll(done.data, d, 'dollars').data;
    expect(both[CREATING_KEY].money).toEqual({ gold: 12000, dollars: 1200 });
    expect(roll(both, d, 'honor').data[CREATING_KEY].money.honor).toBe(12);
  });

  it('a roll that came to below nothing is nothing', () => {
    const d = def({ honor: { how: 'roll', each: '1d6 - 9' } });
    expect(roll(at, d, 'honor', dice(1)).data[CREATING_KEY].money.honor).toBe(0);
  });

  it('typed: changes as they like, 0 allowed, cleared with null', () => {
    const d = def({ gold: { how: 'typed' } });
    const one = type(at, d, 'gold', 500).data;
    expect(one[CREATING_KEY].money).toEqual({ gold: 500 });
    expect(type(one, d, 'gold', 750).data[CREATING_KEY].money).toEqual({ gold: 750 });
    expect(type(one, d, 'gold', 0).data[CREATING_KEY].money).toEqual({ gold: 0 });
    expect(type(one, d, 'gold', null).data[CREATING_KEY].money).toEqual({});
    for (const bad of [-1, 1.5, '5', undefined, LIMITS.moneyMost + 1]) expect(type(at, d, 'gold', bad).error, String(bad)).toBe('A whole amount, 0 or more');
    expect(type(at, d, 'gold', LIMITS.moneyMost).ok).toBe(true);
  });

  it('only each currency\'s own way, and only one this game asks', () => {
    const d = def({ gold: { how: 'typed' }, honor: { how: 'roll', each: '3d6' }, dollars: { how: 'number', amount: 5 } });
    expect(roll(at, d, 'gold').error).toBe('Gold isn\'t rolled');
    expect(type(at, d, 'honor', 5).error).toBe('Honor isn\'t typed in');
    expect(type(at, d, 'dollars', 5).error).toBe('Dollars isn\'t typed in');
    expect(roll(at, d, 'nope').error).toBe('Not one of this game\'s amounts');
    expect(type(at, def({ gold: { how: 'typed' } }, { parts: { bank: { on: false } } }), 'gold', 5).error).toBe('Not one of this game\'s amounts');
    expect(type({}, d, 'gold', 5).error).toBe('This character isn\'t being made');
    const stepOff = { ...three, creation: { on: true, off: ['money'], money: { gold: { how: 'typed' } } } };
    expect(type(at, stepOff, 'gold', 5).error).toBe('Not one of this game\'s amounts');
    expect(roll(at, def({ honor: { how: 'roll', each: 'nonsense' } }), 'honor').error).toBe('This game\'s roll doesn\'t read');
  });

  it('FINISH needs a roll rolled and an amount said', () => {
    const d = def({ gold: { how: 'roll', each: '3d6' }, honor: { how: 'typed' } });
    expect(finish(at, d).error).toBe('Roll for Gold first');
    const rolled = roll(at, d, 'gold').data;
    expect(finish(rolled, d).error).toBe('Say how much Honor first');
    expect(finish(type(rolled, d, 'honor', 7).data, d).ok).toBe(true);
    expect(finish(at, def({ gold: { how: 'number', amount: 5 } })).ok).toBe(true);
  });

  it('FINISH says what to pay: nothing of 0, the number as it is, the app\'s money with no currency', () => {
    const d = def({ gold: { how: 'roll', each: '3d6' }, dollars: { how: 'number', amount: 500 }, honor: { how: 'typed' } });
    const ready = type(roll(at, d, 'gold').data, d, 'honor', 0).data;
    expect(finish(ready, d).pay).toEqual([{ id: 'gold', amount: 1200 }, { id: 'dollars', amount: 500 }]);
    expect(finish(ready, d).data[CREATING_KEY]).toEqual({ done: true, given: { items: [], pay: [{ id: 'gold', amount: 1200 }, { id: 'dollars', amount: 500 }] } });
    expect(finish(at, single({ main: { how: 'number', amount: 100 } })).pay).toEqual([{ id: null, amount: 100 }]);
  });

  it('with the step off, none asked and none paid', () => {
    expect(finish(at, def({ dollars: { how: 'number', amount: 500 } }, { creation: { on: true, money: { dollars: { how: 'number', amount: 500 } }, off: ['money'] } })).pay).toEqual([]);
  });

  it('the checks take it, and say what is wrong', () => {
    expect(issues({ gold: { how: 'roll', each: '3d6 * 10' }, dollars: { how: 'number', amount: 500 }, honor: { how: 'typed' } })).toEqual([]);
    expect(issues('lots')).toEqual(['creation, money: Must say what each currency starts at']);
    expect(issues({ gold: 'lots' })).toEqual(['creation, money, gold: Must be number, roll or typed']);
    expect(issues({ gold: { how: 'nope' } })).toEqual(['creation, money, gold: Must be number, roll or typed']);
    expect(issues({ gold: { how: 'typed', amount: 5 } })).toEqual(['creation, money, gold, amount: Not part of this way']);
    for (const amount of [-1, 1.5, '5', undefined, LIMITS.moneyMost + 1]) expect(issues({ gold: { how: 'number', amount } }), String(amount)).toEqual(['creation, money, gold, amount: A whole amount, 0 or more']);
    expect(issues({ gold: { how: 'roll', each: 'lots' } })).toEqual(['creation, money, gold, each: Reads like 3d6, 4d6 drop lowest or 2d6 + 6, up to 20 dice of up to 100 sides, with * 10 after it if you like']);
    expect(issues({ gold: { how: 'roll', each: '1d6 - 9 * 2' } })).toEqual(['creation, money, gold, each: 1d6 - 9 * 2 can roll -16, below nothing']);
    expect(issues({ gone: { how: 'typed' } })).toEqual([]);
  });

  it('says of a roll as the page does', () => {
    expect(moneyRollProblems('3d6 * 10')).toEqual([]);
    expect(moneyRollProblems('1d6 - 1')).toEqual([]);
  });

  it('the system file carries it, unchanged', () => {
    const d = def({ gold: { how: 'roll', each: '3d6 * 10' }, honor: { how: 'typed' } });
    const read = citysys.readFile(JSON.stringify(citysys.buildFile({ definition: d, version: 1, origin: 'sys_abcdefabcdefabcd' })));
    expect([read.file.definition.creation, read.problems]).toEqual([d.creation, []]);
  });
});

describe('what an option gives (7c4e)', () => {
  const opt = (gives, more = {}) => ({ format: 1, name: 'G', currencies: [{ id: 'gold', name: 'Gold' }], choices: [{ id: 'bgs', one: 'Background', many: 'Backgrounds', options: [{ id: 'noble', label: 'Noble', gives }] }], ...more });
  const issues = (gives, more) => checkDefinition(opt(gives, more)).problems.map((p) => `${p.where}: ${p.message}`);
  const at = 'list bgs, option noble, gives';

  it('the checks take it', () => {
    expect(issues({ items: [{ name: 'Rope', qty: 3 }], money: { gold: { how: 'roll', each: '3d6 * 10' } } })).toEqual([]);
    expect(issues({ money: { gold: { how: 'number', amount: 100 } } })).toEqual([]);
    expect(issues({})).toEqual([]);
    expect(issues({ items: [] })).toEqual([]);
    // A currency since deleted is passed over, with no way to fix it left on the page.
    expect(issues({ money: { gone: { how: 'number', amount: 1 } } })).toEqual([]);
  });

  it('and say what is wrong', () => {
    expect(issues('lots')).toEqual([`${at}: Must say what it gives`]);
    expect(issues({ kits: [] })).toEqual([`${at}, kits: Not part of what it gives`]);
    expect(issues({ items: 'Rope' })).toEqual([`${at}, items: Must be a list of items`]);
    expect(issues({ items: [{ name: 'Rope', qty: 0 }] })).toEqual([`${at}, items: Rope: from 1 to ${LIMITS.itemQty} of it`]);
    expect(issues({ money: 'lots' })).toEqual([`${at}, money: Must say what each currency gets`]);
    expect(issues({ money: { gold: { how: 'typed' } } })).toEqual([`${at}, money, gold: Must be number or roll`]);
    expect(issues({ money: { gold: 'lots' } })).toEqual([`${at}, money, gold: Must be number or roll`]);
    expect(issues({ money: { gold: { how: 'number', amount: -1 } } })).toEqual([`${at}, money, gold, amount: A whole amount, 0 or more`]);
    expect(issues({ money: { gold: { how: 'roll', each: 'lots' } } })[0]).toMatch(/^list bgs, option noble, gives, money, gold, each: Reads like 3d6/);
    expect(issues({ money: { gold: { how: 'number', amount: 1, each: '3d6' } } })).toEqual([`${at}, money, gold, each: Not part of this way`]);
  });

  it('an option giving nothing is no matter, nor one that isn\'t an option', () => {
    expect(checkDefinition({ format: 1, name: 'G', choices: [{ id: 'bgs', one: 'B', many: 'Bs', options: [{ id: 'a', label: 'A' }] }] }).problems).toEqual([]);
  });

  it('with a sheet designed without an inventory, says once that items need one; money doesn\'t', () => {
    const sheet = { sections: [{ id: 'who', label: 'WHO', layout: 'list', fields: [{ id: 'name', label: 'Name', type: 'text' }] }] };
    const twoOptions = { format: 1, name: 'G', sheet, choices: [{ id: 'bgs', one: 'B', many: 'Bs', options: [{ id: 'a', label: 'A', gives: { items: [{ name: 'Rope', qty: 1 }] } }, { id: 'b', label: 'B', gives: { items: [{ name: 'Oar', qty: 1 }] } }] }] };
    const said = checkDefinition(twoOptions).problems.map((p) => `${p.where}: ${p.message}`);
    expect(said).toEqual(['list bgs: An option gives items, which land in the inventory, and this sheet has none: add one on CHARACTER SHEET']);
    expect(issues({ money: { gold: { how: 'number', amount: 1 } } }, { sheet })).toEqual([]);
    expect(issues({ items: [] }, { sheet })).toEqual([]);
    expect(issues({ items: [{ name: 'Rope', qty: 1 }] }, { sheet: { sections: [{ id: 'gear', label: 'GEAR', layout: 'inventory', fields: [] }] } })).toEqual([]);
  });

  it('the system file carries it, unchanged', () => {
    const d = opt({ items: [{ name: 'Rope', qty: 3 }], money: { gold: { how: 'roll', each: '3d6 * 10' } } });
    const read = citysys.readFile(JSON.stringify(citysys.buildFile({ definition: d, version: 1, origin: 'sys_abcdefabcdefabcd' })));
    expect([read.file.definition.choices, read.problems]).toEqual([d.choices, []]);
  });
});

describe('what an option gives, at the table (7c4e)', () => {
  const GOLD = { id: 'gold', name: 'Gold', short: 'gp', denominations: [{ id: 'gp', name: 'Gold', short: 'gp', value: 100 }, { id: 'cp', name: 'Copper', short: 'cp', value: 1 }] };
  const HONOR = { id: 'honor', name: 'Honor' };
  const LISTS = [
    { id: 'bgs', one: 'Background', many: 'Backgrounds', options: [
      { id: 'noble', label: 'Noble', gives: { items: [{ name: 'Ring', qty: 1 }, { name: 'Rations', qty: 3 }], money: { gold: { how: 'roll', each: '3d6 * 10' }, honor: { how: 'number', amount: 5 } } }, features: [{ id: 'armed', label: 'Armed', choice: 'weapons' }] },
      { id: 'dockhand', label: 'Dockhand', gives: { items: [{ name: 'Crowbar', qty: 1 }], money: { gold: { how: 'number', amount: 250 } } } },
      { id: 'plain', label: 'Plain' },
    ] },
    { id: 'weapons', one: 'Weapon', many: 'Weapons', picked: 'features', options: [
      { id: 'sword', label: 'Sword', gives: { items: [{ name: 'Sword', qty: 1 }], money: { honor: { how: 'number', amount: 2 } } } },
      { id: 'axe', label: 'Axe', gives: { items: [{ name: 'Axe', qty: 1 }] } },
    ] },
    { id: 'commons', one: 'Common', many: 'Commons', picked: 'everyone', options: [{ id: 'breath', label: 'Breath', gives: { items: [{ name: 'Whistle', qty: 1 }], money: { honor: { how: 'roll', each: '1d6' } } } }] },
  ];
  const def = (creation = {}, more = {}) => ({ format: 1, name: 'G', currencies: [GOLD, HONOR], choices: LISTS.slice(0, 2), creation: { on: true, ...creation }, ...more });
  const dice = (...faces) => { let i = 0; return () => (faces[i++ % faces.length] - 0.5) / 6; };
  const holding = (...picks) => ({ [PICKS_KEY]: Object.fromEntries(Object.entries(picks.reduce((all, p) => {
    (all[p.list] ??= []).push(p.from ? { option: p.option, from: p.from } : { option: p.option });
    return all;
  }, {}))), [CREATING_KEY]: { at: 'list:bgs' } });
  const NOBLE = { list: 'bgs', option: 'noble' };
  const DOCK = { list: 'bgs', option: 'dockhand' };
  const SWORD = { list: 'weapons', option: 'sword', from: 'armed' };
  const roll = (data, d = def(), option = 'noble', id = 'gold', rng = dice(3, 4, 5)) => creationAction(d, data, { kind: 'giftRoll', option, id }, { rng });
  const finish = (data, d = def(), rng = dice(1)) => creationAction(d, data, { kind: 'finish' }, { rng });

  it('a roll is whole pieces, once, kept under the option, and said for the log', () => {
    const done = roll(holding(NOBLE));
    expect(done.data[CREATING_KEY].gifts).toEqual({ noble: { gold: 12000 } });
    expect(done.data[CREATING_KEY].at).toBe('list:bgs');
    expect(done.rolled).toMatchObject({ label: 'NOBLE · GOLD', each: '3d6 * 10', sides: 6, rolls: [3, 4, 5], totals: [120], total: 120, named: null });
    expect(statRollLine('Wren', done.rolled)).toBe('Wren rolled NOBLE · GOLD (3d6 * 10): 120');
    expect(roll(done.data)).toEqual({ ok: false, error: 'Rolled, and kept: your GM can clear it for another go' });
  });

  it('a second roll sits beside the first, of the same option or another', () => {
    const d = def({}, { choices: [{ id: 'bgs', one: 'B', many: 'Bs', picks: 2, options: [
      { id: 'a', label: 'A', gives: { money: { gold: { how: 'roll', each: '1d6' }, honor: { how: 'roll', each: '1d6' } } } },
      { id: 'b', label: 'B', gives: { money: { honor: { how: 'roll', each: '1d6' } } } },
    ] }] });
    const start = { [PICKS_KEY]: { bgs: [{ option: 'a' }, { option: 'b' }] }, [CREATING_KEY]: {} };
    const one = roll(start, d, 'a', 'gold', dice(2)).data;
    const two = roll(one, d, 'a', 'honor', dice(3)).data;
    const three = roll(two, d, 'b', 'honor', dice(4)).data;
    expect(three[CREATING_KEY].gifts).toEqual({ a: { gold: 200, honor: 3 }, b: { honor: 4 } });
  });

  it('only for what they hold now, and only money that is rolled', () => {
    expect(roll(holding(DOCK)).error).toBe('This character doesn\'t hold that');
    expect(roll(holding(NOBLE), def(), 'noble', 'honor').error).toBe('That isn\'t rolled');
    expect(roll(holding(NOBLE), def(), 'noble', 'tin').error).toBe('That isn\'t rolled');
    expect(roll({ [PICKS_KEY]: { bgs: [{ option: 'noble' }] } }).error).toBe('This character isn\'t being made');
    const noBank = def({}, { parts: { bank: { on: false } } });
    expect(roll(holding(NOBLE), noBank).error).toBe('That isn\'t rolled');
    const broken = def({}, { choices: [{ id: 'bgs', one: 'B', many: 'Bs', options: [{ id: 'noble', label: 'N', gives: { money: { gold: { how: 'roll', each: 'lots' } } } }] }] });
    expect(roll(holding(NOBLE), broken).error).toBe('This game\'s roll doesn\'t read');
  });

  it('a pick that no longer counts can\'t roll: one waiting under a pick taken away', () => {
    expect(roll({ [PICKS_KEY]: { weapons: [{ option: 'sword', from: 'armed' }] }, [CREATING_KEY]: {} }, def({}, { choices: [LISTS[0], { ...LISTS[1], options: [{ id: 'sword', label: 'Sword', gives: { money: { gold: { how: 'roll', each: '1d6' } } } }] }] }), 'sword').error).toBe('This character doesn\'t hold that');
  });

  it('kept through a swap: taken back and picked again, what it rolled still holds and can\'t be rolled again', () => {
    const rolled = roll(holding(NOBLE)).data;
    const back = pickAction(def(), rolled, { kind: 'drop', list: 'bgs', option: 'noble' }, { gm: false });
    const swapped = { ...rolled, [PICKS_KEY]: { bgs: [{ option: 'dockhand' }] } };
    expect(back.ok).toBe(true);
    expect(back.data[CREATING_KEY].gifts).toEqual({ noble: { gold: 12000 } });
    const returned = { ...swapped, [PICKS_KEY]: { bgs: [{ option: 'noble' }] } };
    expect(roll(returned).error).toBe('Rolled, and kept: your GM can clear it for another go');
    expect(finish(returned).pay).toContainEqual({ id: 'gold', amount: 12000 });
    // One let go of pays nothing, though its roll was kept.
    expect(finish(swapped).pay).toEqual([{ id: 'gold', amount: 250 }]);
  });

  it('FINISH gives what they hold then, nested picks included, each paid together by currency', () => {
    const rolled = roll(holding(NOBLE, SWORD)).data;
    const done = finish(rolled);
    expect(done.items).toEqual([{ name: 'Ring', qty: 1 }, { name: 'Rations', qty: 3 }, { name: 'Sword', qty: 1 }]);
    expect(done.pay).toEqual([{ id: 'gold', amount: 12000 }, { id: 'honor', amount: 7 }]);
    expect(done.rolls).toEqual([]);
    expect(done.data[CREATING_KEY]).toEqual({ done: true, given: { items: done.items, pay: done.pay } });
  });

  it('nothing from a pick waiting, nor from one giving nothing', () => {
    const waiting = { [PICKS_KEY]: { bgs: [{ option: 'plain' }], weapons: [{ option: 'sword', from: 'armed' }] }, [CREATING_KEY]: {} };
    expect(finish(waiting)).toMatchObject({ ok: true, items: [], pay: [], rolls: [] });
  });

  it('with KITS and MONEY off gifts still come, on top of nothing from them; with them on, on top of theirs', () => {
    const steps = { kits: [{ id: 'all', name: 'ALL', items: [{ name: 'Knife', qty: 1 }], who: 'all' }], money: { gold: { how: 'number', amount: 1000 } } };
    const on = finish(holding(DOCK), def(steps));
    expect(on.items).toEqual([{ name: 'Knife', qty: 1 }, { name: 'Crowbar', qty: 1 }]);
    expect(on.pay).toEqual([{ id: 'gold', amount: 1250 }]);
    const off = finish(holding(DOCK), def({ ...steps, off: ['kits', 'money'] }));
    expect(off.items).toEqual([{ name: 'Crowbar', qty: 1 }]);
    expect(off.pay).toEqual([{ id: 'gold', amount: 250 }]);
  });

  it('a roll never made is made at FINISH and logged: a list everyone has, or a step skipped', () => {
    const d = def({}, { choices: LISTS });
    const done = finish({ [CREATING_KEY]: {} }, d, dice(4));
    expect(done.items).toEqual([{ name: 'Whistle', qty: 1 }]);
    expect(done.pay).toEqual([{ id: 'honor', amount: 4 }]);
    expect(done.rolls.map((r) => statRollLine('Wren', r))).toEqual(['Wren rolled BREATH · HONOR (1d6): 4']);
  });

  it('a roll that doesn\'t read gives nothing and stops nothing; a roll of 0 pays nothing', () => {
    const broken = def({}, { choices: [{ id: 'bgs', one: 'B', many: 'Bs', options: [{ id: 'noble', label: 'N', gives: { money: { gold: { how: 'roll', each: 'lots' } } } }] }] });
    expect(finish(holding(NOBLE), broken)).toMatchObject({ ok: true, pay: [], rolls: [] });
    const zero = def({}, { choices: [{ id: 'bgs', one: 'B', many: 'Bs', options: [{ id: 'noble', label: 'N', gives: { money: { gold: { how: 'roll', each: '1d6 - 9' } } } }] }] });
    expect(finish(holding(NOBLE), zero).pay).toEqual([]);
  });

  it('only a number or a roll counts as money, said or paid', () => {
    const d = def({}, { choices: [{ id: 'bgs', one: 'B', many: 'Bs', options: [{ id: 'noble', label: 'N', gives: { money: { gold: { how: 'typed' } } } }] }] });
    expect('gives' in choicesShown(d)[0].options[0]).toBe(false);
    expect(finish(holding(NOBLE), d).pay).toEqual([]);
  });

  it('what is kept only counts as a whole amount: anything else is rolled, not paid', () => {
    const odd = { ...holding(NOBLE), [CREATING_KEY]: { gifts: { noble: { gold: 'lots' } } } };
    expect(roll(odd).data[CREATING_KEY].gifts.noble.gold).toBe(12000);
    expect(finish(odd, def(), dice(2)).pay[0]).toEqual({ id: 'gold', amount: 6000 });
  });

  it('the app\'s single money is paid with no currency; a currency since deleted is passed over', () => {
    const single = { format: 1, name: 'G', choices: [{ id: 'bgs', one: 'B', many: 'Bs', options: [{ id: 'noble', label: 'Noble', gives: { money: { main: { how: 'number', amount: 30 }, gold: { how: 'number', amount: 9 } } } }] }], creation: { on: true } };
    expect(finish(holding(NOBLE), single).pay).toEqual([{ id: null, amount: 30 }]);
    expect(choicesShown(single)[0].options[0].gives.money).toEqual([{ id: 'main', name: 'Money', how: 'number', amount: 30 }]);
  });

  it('with the bank off, the items still come and no money is paid or said', () => {
    const noBank = def({}, { parts: { bank: { on: false } } });
    const done = finish(holding(NOBLE), noBank);
    expect(done.items).toEqual([{ name: 'Ring', qty: 1 }, { name: 'Rations', qty: 3 }]);
    expect(done.pay).toEqual([]);
    expect(done.rolls).toEqual([]);
    expect(choicesShown(noBank)[0].options[0].gives).toEqual({ items: [{ name: 'Ring', qty: 1 }, { name: 'Rations', qty: 3 }] });
  });

  it('with the flow off, or an upload, nothing is given', () => {
    expect(finish(holding(NOBLE), def({ on: false })).ok).toBe(false);
    const uploaded = withUpload(def(), holding(NOBLE));
    expect(uploaded[CREATING_KEY]).toEqual({ done: true, uploaded: true });
    expect(finish(uploaded).ok).toBe(false);
  });

  it('the browser is told what each gives, in its order, and nothing of one giving nothing', () => {
    const [bgs] = choicesShown(def());
    expect(bgs.options[0].gives).toEqual({
      items: [{ name: 'Ring', qty: 1 }, { name: 'Rations', qty: 3 }],
      money: [{ id: 'gold', name: 'Gold', how: 'roll', each: '3d6 * 10' }, { id: 'honor', name: 'Honor', how: 'number', amount: 5 }],
    });
    expect('gives' in bgs.options[2]).toBe(false);
    const onlyMoney = { format: 1, name: 'G', currencies: [HONOR], choices: [{ id: 'bgs', one: 'B', many: 'Bs', options: [{ id: 'a', label: 'A', gives: { money: { honor: { how: 'number', amount: 1 } } } }, { id: 'b', label: 'B', gives: { items: [], money: {} } }] }] };
    expect(choicesShown(onlyMoney)[0].options[0].gives).toEqual({ money: [{ id: 'honor', name: 'Honor', how: 'number', amount: 1 }] });
    expect('gives' in choicesShown(onlyMoney)[0].options[1]).toBe(false);
  });
});

describe('the checks', () => {
  it('take what the page writes', () => {
    expect(problems({ on: true, order: ['who', 'stats', 'list:classes', 'kits', 'money'], off: ['money', 'list:classes'] })).toEqual([]);
    expect(problems({ on: false })).toEqual([]);
  });

  it('say what is wrong', () => {
    expect(problems('on')).toEqual(['creation: Must say how a new character is made']);
    expect(problems({ steps: [] })).toEqual(['creation, steps: Not part of the new character flow']);
    expect(problems({ on: 'yes' })).toEqual(['creation, on: Must say on: true or on: false']);
    expect(problems({ order: 'who' })).toEqual(['creation, order: Must be a list of steps']);
    expect(problems({ off: 'kits' })).toEqual(['creation, off: Must be a list of steps']);
    const steps = 'creation, order: Steps are who, stats, kits, money, stats: and a group\'s id, or list: and a list\'s id';
    for (const bad of [['nope'], [3], ['list:'], ['list:Bad Name']]) expect(problems({ order: bad }), JSON.stringify(bad)).toEqual([steps]);
    expect(problems({ off: ['who'] })).toEqual(['creation, off: WHO THEY ARE is always asked: a character needs a name']);
    expect(problems({ order: Array(LIMITS.steps + 1).fill('who') })).toEqual([`creation, order: At most ${LIMITS.steps} steps`]);
  });
});

describe('the system file', () => {
  it('carries it, unchanged, and the version preview names it', () => {
    const creation = { on: true, order: ['who', 'list:classes', 'stats', 'list:backgrounds', 'list:feats', 'kits', 'money'], off: ['money'] };
    const file = citysys.buildFile({ definition: { ...HEARTH, creation }, version: 1, origin: 'sys_abcdefabcdefabcd' });
    const read = citysys.readFile(JSON.stringify(file));
    expect([read.file.definition.creation, read.problems]).toEqual([creation, []]);
    expect(OTHER).toContain('creation');
  });
});

describe('walking through it (7c2)', () => {
  const ON = { ...HEARTH, creation: { on: true } };
  const fresh = { [CREATING_KEY]: {} };

  it('asks the steps that are on, in order; KITS and MONEY wait for 7c4', () => {
    expect(stepsAsked(ON)).toEqual(['who', 'stats', 'list:classes', 'list:backgrounds', 'list:feats']);
    expect(stepsAsked({ ...HEARTH, creation: { on: true, off: ['stats'], order: ['list:feats', 'who'] } }))
      .toEqual(['list:feats', 'who', 'list:classes', 'list:backgrounds']);
  });

  it('tells the browser the steps and stats while it is on, and nothing while it is off', () => {
    expect(creationShown(HEARTH)).toBeNull();
    expect(creationShown({ ...HEARTH, creation: { on: false } })).toBeNull();
    const withRange = { ...ON, stats: [{ id: 'a', label: 'A', stats: [{ id: 'x', label: 'X', min: 3, max: 18 }, { id: 'y' }] }, { id: 'none', label: 'N', stats: [] }] };
    expect(creationShown(withRange)).toEqual({
      steps: ['who', 'stats', 'list:classes', 'list:backgrounds', 'list:feats'],
      stats: [{ id: 'a', label: 'A', stats: [{ id: 'x', label: 'X', min: 3, max: 18 }, { id: 'y', label: 'y' }] }],
    });
  });

  it('opens once: a second open changes nothing, so a place is never lost', () => {
    expect(creationAction(ON, {}, { kind: 'open' })).toEqual({ ok: true, data: fresh });
    const going = { name: 'W', [CREATING_KEY]: { at: 'stats' } };
    expect(creationAction(ON, going, { kind: 'open' })).toEqual({ ok: true });
    expect(creationAction(ON, { [CREATING_KEY]: { done: true } }, { kind: 'open' })).toEqual({ ok: true });
  });

  it('keeps the step, keeping what else is on the sheet; only a step this game asks', () => {
    expect(creationAction(ON, { name: 'W', ...fresh }, { kind: 'at', step: 'stats' })).toEqual({ ok: true, data: { name: 'W', [CREATING_KEY]: { at: 'stats' } } });
    expect(creationAction(ON, fresh, { kind: 'at', step: 'kits' }).error).toBe('Not one of this game\'s steps');
    expect(creationAction(ON, fresh, { kind: 'at', step: 'list:nope' }).ok).toBe(false);
    expect(creationAction(ON, fresh, { kind: 'at' }).ok).toBe(false);
  });

  it('finishes, and nothing moves it after that', () => {
    const done = creationAction(ON, { [CREATING_KEY]: { at: 'stats' } }, { kind: 'finish' }).data;
    expect(done).toEqual({ [CREATING_KEY]: { done: true, given: { items: [], pay: [] } } });
    for (const action of [{ kind: 'at', step: 'stats' }, { kind: 'finish' }]) {
      expect(creationAction(ON, done, action)).toEqual({ ok: false, error: 'This character isn\'t being made' });
    }
  });

  it('a step or a finish needs it opened first', () => {
    expect(creationAction(ON, {}, { kind: 'finish' }).ok).toBe(false);
    expect(creationAction(ON, {}, { kind: 'at', step: 'stats' }).ok).toBe(false);
  });

  it('refuses it all with the flow off, and anything else it is asked', () => {
    expect(creationAction(HEARTH, {}, { kind: 'open' })).toEqual({ ok: false, error: 'This game has no guided new character' });
    expect(creationAction(ON, fresh, { kind: 'nope' })).toEqual({ ok: false, error: 'Nothing to do' });
    expect(creationAction(ON, fresh, null).ok).toBe(false);
  });

  it('under way only while it is opened, not finished, and on', () => {
    expect(creatingNow(ON, fresh)).toBe(true);
    expect(creatingNow(ON, {})).toBe(false);
    expect(creatingNow(ON, { [CREATING_KEY]: { done: true } })).toBe(false);
    expect(creatingNow(HEARTH, fresh)).toBe(false);
  });

  it('an upload is the end of it, opened or not; with the flow off nothing is written', () => {
    expect(withUpload(ON, { name: 'W' })).toEqual({ name: 'W', [CREATING_KEY]: { done: true, uploaded: true } });
    expect(withUpload(ON, { [CREATING_KEY]: { at: 'stats' } })).toEqual({ [CREATING_KEY]: { done: true, uploaded: true } });
    expect(withUpload(ON, { [CREATING_KEY]: { done: true } })).toEqual({ [CREATING_KEY]: { done: true } });
    expect(withUpload(HEARTH, { name: 'W' })).toEqual({ name: 'W' });
    expect(withUpload(null, { name: 'W' })).toEqual({ name: 'W' });
  });

  it('the place can\'t be written as a field', () => {
    expect(playerMayEdit('generic', CREATING_KEY)).toBe(false);
  });
});

describe('the GM\'s side (7c5)', () => {
  const ON = {
    ...HEARTH,
    sheet: { tabs: ['STATS'], header: { nameField: 'handle' }, sections: [{ id: 'who', label: 'WHO', layout: 'list', tab: 'STATS', fields: [
      { id: 'handle', label: 'Handle', type: 'text' }, { id: 'concept', label: 'Concept', type: 'text' }, { id: 'description', label: 'About', type: 'text', edit: 'gm' },
    ] }] },
    stats: [{ id: 'a', label: 'A', stats: [{ id: 'grit', label: 'Grit' }] }],
    creation: { on: true },
  };
  const as = (data, kind, gm = true, def = ON) => creationAction(def, data, { kind }, { gm });
  const played = {
    handle: 'Wren', concept: 'Thief', description: 'Kept by the GM', grit: 12, notes: 'Mine', inventory: '[]',
    [PICKS_KEY]: { classes: [{ option: 'x' }] }, _uses: { f: 1 }, _rolled: { classes: { option: 'x' } },
    [CREATING_KEY]: { at: 'stats', kit: 'k', rolled: { stats: [1] } },
  };

  it('only the GM may, whatever the sheet says', () => {
    for (const kind of ['skip', 'startOver']) {
      expect(as(played, kind, false)).toEqual({ ok: false, error: 'That is the GM\'s to do' });
      expect(creationAction(ON, played, { kind }).ok).toBe(false);
    }
  });

  it('neither with the flow off', () => {
    const off = { ...ON, creation: { on: false } };
    for (const kind of ['skip', 'startOver']) expect(as(played, kind, true, off).error).toBe('This game has no guided new character');
  });

  it('SKIP IT marks them done as they stand, handing nothing out', () => {
    const done = as(played, 'skip');
    expect(done.data[CREATING_KEY]).toEqual({ done: true, skipped: true });
    expect(done.data.handle).toBe('Wren');
    expect(done.items).toBeUndefined();
    expect(done.pay).toBeUndefined();
    expect(as({ name: 'Blank' }, 'skip').data[CREATING_KEY]).toEqual({ done: true, skipped: true });
    expect(creatingNow(ON, done.data)).toBe(false);
  });

  it('SKIP IT is refused once they are done', () => {
    for (const place of [{ done: true }, { done: true, uploaded: true }]) expect(as({ [CREATING_KEY]: place }, 'skip')).toEqual({ ok: false, error: 'This character is done already' });
  });

  it('START OVER clears what the flow wrote and nothing else, and asks again', () => {
    const { data } = as(played, 'startOver');
    expect(data).toEqual({ description: 'Kept by the GM', notes: 'Mine', inventory: '[]', [CREATING_KEY]: { restarted: true } });
  });

  it('START OVER leaves a stat the GM keeps, and one no step asks', () => {
    const def = { ...ON, stats: [{ id: 'a', label: 'A', stats: [{ id: 'grit', label: 'Grit' }] }, { id: 'b', label: 'B', stats: [{ id: 'wits', label: 'Wits' }] }], creation: { on: true, statsBy: 'group', off: ['stats:b'] } };
    expect(as({ grit: 1, wits: 2, [CREATING_KEY]: {} }, 'startOver', true, def).data).toEqual({ wits: 2, [CREATING_KEY]: { restarted: true } });
    const kept = { ...ON, sheet: { ...ON.sheet, sections: [{ ...ON.sheet.sections[0], fields: [...ON.sheet.sections[0].fields, { id: 'grit', label: 'Grit', type: 'number', edit: 'gm' }] }] } };
    expect(as({ grit: 1, [CREATING_KEY]: {} }, 'startOver', true, kept).data).toEqual({ grit: 1, [CREATING_KEY]: { restarted: true } });
  });

  it('START OVER says what FINISH gave, to take back', () => {
    const given = { items: [{ name: 'Rope', qty: 2 }], pay: [{ id: null, amount: 50 }] };
    const done = as({ [CREATING_KEY]: { done: true, given } }, 'startOver');
    expect(done.takeItems).toEqual(given.items);
    expect(done.takeMoney).toEqual(given.pay);
    expect(done.restarted).toBe(true);
  });

  it('START OVER takes nothing back when nothing was recorded, or twice', () => {
    for (const place of [{ done: true }, { done: true, uploaded: true }, { at: 'stats' }, { done: true, given: 'odd' }]) {
      const done = as({ [CREATING_KEY]: place }, 'startOver');
      expect([done.takeItems, done.takeMoney]).toEqual([[], []]);
    }
    const once = as({ [CREATING_KEY]: { done: true, given: { items: [{ name: 'Rope', qty: 1 }], pay: [] } } }, 'startOver');
    expect(as(once.data, 'startOver').takeItems).toEqual([]);
  });

  it('START OVER is refused for a character never in the flow', () => {
    expect(as({ handle: 'Old Hand' }, 'startOver')).toEqual({ ok: false, error: 'This character wasn\'t made with the flow' });
  });

  it('started over, they are still being made, and opening it starts from the top', () => {
    const { data } = as(played, 'startOver');
    expect(creatingNow(ON, data)).toBe(true);
    expect(creationAction(ON, data, { kind: 'open' }).data[CREATING_KEY]).toEqual({});
    // Already opened, it stays where it is.
    expect(creationAction(ON, { [CREATING_KEY]: { at: 'stats' } }, { kind: 'open' })).toEqual({ ok: true });
  });

  it('finishing again gives it all again, recorded afresh', () => {
    const { data } = as({ [CREATING_KEY]: { done: true, given: { items: [{ name: 'Rope', qty: 2 }], pay: [] } } }, 'startOver');
    const at = creationAction(ON, creationAction(ON, data, { kind: 'open' }).data, { kind: 'at', step: 'who' }).data;
    expect(creationAction(ON, at, { kind: 'finish' }).data[CREATING_KEY]).toEqual({ done: true, given: { items: [], pay: [] } });
  });
});

describe('taking a pick back while making the character (7c2)', () => {
  const ROLLED = { ...HEARTH, creation: { on: true }, choices: [
    { id: 'classes', one: 'Class', many: 'Classes', options: [{ id: 'soldier', label: 'Soldier' }] },
    { id: 'omens', one: 'Omen', many: 'Omens', table: 'd6', players: 'roll', options: [{ id: 'storm', label: 'Storm', roll: '1-6' }] },
  ] };
  const held = (place) => ({ [PICKS_KEY]: { classes: [{ option: 'soldier' }], omens: [{ option: 'storm' }] }, ...(place ? { [CREATING_KEY]: place } : {}) });
  const drop = (data, list, option) => pickAction(ROLLED, data, { kind: 'drop', list, option });

  it('a player may, on their own picks', () => {
    const done = drop(held({ at: 'list:classes' }), 'classes', 'soldier');
    expect(done.ok).toBe(true);
    expect(done.data[PICKS_KEY].classes).toEqual([]);
  });

  it('not on a list rolled only: that would be a second roll', () => {
    expect(drop(held({}), 'omens', 'storm')).toEqual({ ok: false, error: 'Only the GM takes a pick away' });
  });

  it('not before it is opened, nor once it is finished, nor with the flow off', () => {
    for (const data of [held(null), held({ done: true })]) expect(drop(data, 'classes', 'soldier').ok).toBe(false);
    const off = { ...ROLLED, creation: { on: false } };
    expect(pickAction(off, held({}), { kind: 'drop', list: 'classes', option: 'soldier' }).ok).toBe(false);
  });

  it('the GM still may, on any list, at any time', () => {
    expect(pickAction(ROLLED, held(null), { kind: 'drop', list: 'omens', option: 'storm' }, { gm: true }).ok).toBe(true);
  });
});

describe('filling it in for them, and clearing a roll (7c5)', () => {
  const ON = {
    format: 1, name: 'G',
    stats: [{ id: 'a', label: 'A', stats: [{ id: 'grit', label: 'Grit' }, { id: 'wits', label: 'Wits' }] }],
    choices: [{ id: 'jobs', one: 'Job', many: 'Jobs', options: [
      { id: 'dock', label: 'Dock', gives: { money: { main: { how: 'roll', each: '1d6' }, }, items: [{ name: 'Hook', qty: 1 }] } },
    ] }],
    creation: {
      on: true,
      ways: { stats: { way: 'roll', each: '3d6', placed: 'order' } },
      kits: [{ id: 'hard', name: 'HARD', who: 'needs', requires: '@grit >= 99', items: [{ name: 'Rope', qty: 1 }] }],
      money: { main: { how: 'roll', each: '2d6' } },
    },
  };
  const dice = (...faces) => { let i = 0; return () => (faces[i++ % faces.length] - 0.5) / 6; };
  const asGm = (data, action, def = ON, rng = dice(3)) => creationAction(def, data, action, { gm: true, rng });
  const at = (place = {}, more = {}) => ({ ...more, [CREATING_KEY]: { at: 'who', ...place } });

  describe('FILL IT IN', () => {
    it('FINISH asks nothing of what is filled in, where a player\'s would', () => {
      expect(creationAction(ON, at(), { kind: 'finish' }).ok).toBe(false);
      expect(asGm(at(), { kind: 'finish' }).ok).toBe(true);
    });

    it('nor of a point buy overspent, a kit left unpicked or one not met', () => {
      const buy = { ...ON, creation: { on: true, ways: { stats: { way: 'buy', points: 1, lowest: 8, highest: 15 } } } };
      expect(creationAction(buy, at({}, { grit: 15, wits: 15 }), { kind: 'finish' }).error).toBe('More points spent than there are');
      expect(asGm(at({}, { grit: 15, wits: 15 }), { kind: 'finish' }, buy).ok).toBe(true);
      const typed = { ...ON, creation: { on: true, kits: [{ id: 'k', name: 'K', who: 'pick', items: [{ name: 'Rope', qty: 1 }] }] } };
      expect(creationAction(typed, at(), { kind: 'finish' }).error).toBe('Pick a kit first');
      expect(asGm(at(), { kind: 'finish' }, typed).ok).toBe(true);
    });

    it('what the GM typed stands, even outside a point buy; only what was left empty is filled', () => {
      const buy = { ...ON, creation: { on: true, ways: { stats: { way: 'buy', points: 20, lowest: 8, highest: 15 } } } };
      const { data } = asGm(at({}, { grit: 99 }), { kind: 'finish' }, buy);
      expect([data.grit, data.wits]).toEqual([99, 8]);
      // A player's number the way can't hold doesn't stand.
      expect(creationAction(buy, at({}, { grit: 99 }), { kind: 'finish' }).data.grit).toBe(8);
    });

    it('going to a step leaves what the GM typed, where a player arriving has it filled', () => {
      const buy = { ...ON, creation: { on: true, ways: { stats: { way: 'buy', points: 20, lowest: 8, highest: 15 } } } };
      expect(asGm(at({}, { grit: 99 }), { kind: 'at', step: 'stats' }, buy).data.grit).toBe(99);
      expect(creationAction(buy, at({}, { grit: 99 }), { kind: 'at', step: 'stats' }).data.grit).toBe(8);
    });

    it('picks a kit not met, which a player can\'t', () => {
      const data = at({ at: 'kits' });
      expect(creationAction(ON, data, { kind: 'kit', kit: 'hard' }).error).toMatch(/^HARD needs/);
      expect(asGm(data, { kind: 'kit', kit: 'hard' }).data[CREATING_KEY].kit).toBe('hard');
    });

    it('money left unrolled is rolled at FINISH and logged; what was rolled stays', () => {
      const unrolled = asGm(at(), { kind: 'finish' }, ON, dice(2, 3));
      expect(unrolled.pay).toEqual([{ id: null, amount: 5 }]);
      expect(unrolled.rolls.map((r) => r.label)).toEqual(['MONEY']);
      const rolled = asGm(at({ money: { main: 40 } }), { kind: 'finish' });
      expect(rolled.pay).toEqual([{ id: null, amount: 40 }]);
      expect(rolled.rolls).toEqual([]);
    });

    it('a kept roll stays kept for the GM too: clearing it is the way', () => {
      const error = 'Rolled, and kept: your GM can clear it for another go';
      expect(asGm(at({ rolled: { stats: [1, 2] } }), { kind: 'roll', step: 'stats' }).error).toBe(error);
      expect(asGm(at({ money: { main: 4 } }), { kind: 'moneyRoll', id: 'main' }).error).toBe(error);
    });
  });

  describe('CLEAR THE ROLL', () => {
    const roll = at({ rolled: { stats: [11, 12], other: [1] } }, { grit: 11, wits: 12, name: 'Wren' });

    it('is the GM\'s alone', () => {
      expect(creationAction(ON, roll, { kind: 'clearRoll', step: 'stats' })).toEqual({ ok: false, error: 'That is the GM\'s to do' });
    });

    it('only while they are being made', () => {
      expect(asGm({ [CREATING_KEY]: { done: true } }, { kind: 'clearRoll', step: 'stats' })).toEqual({ ok: false, error: 'This character isn\'t being made' });
    });

    it('a stats step: the roll and the numbers it put on, and so ROLL works again', () => {
      const { data } = asGm(roll, { kind: 'clearRoll', step: 'stats' });
      expect(data).toEqual({ name: 'Wren', [CREATING_KEY]: { at: 'who', rolled: { other: [1] } } });
      expect(creationAction(ON, data, { kind: 'roll', step: 'stats' }, { rng: dice(4) }).ok).toBe(true);
    });

    it('a currency: that one only, and so its roll works again', () => {
      const d = { ...ON, currencies: [{ id: 'gold', name: 'Gold' }, { id: 'honor', name: 'Honor' }], creation: { on: true, money: { gold: { how: 'roll', each: '1d6' }, honor: { how: 'roll', each: '1d6' } } } };
      const { data } = asGm(at({ money: { gold: 3, honor: 4 } }), { kind: 'clearRoll', money: 'gold' }, d);
      expect(data[CREATING_KEY].money).toEqual({ honor: 4 });
      expect(creationAction(d, data, { kind: 'moneyRoll', id: 'gold' }, { rng: dice(2) }).ok).toBe(true);
    });

    it('not an amount a player typed', () => {
      const d = { ...ON, creation: { on: true, money: { main: { how: 'typed' } } } };
      expect(asGm(at({ money: { main: 3 } }), { kind: 'clearRoll', money: 'main' }, d)).toEqual({ ok: false, error: 'Nothing rolled there to clear' });
    });

    it('an option\'s money: that one only, and an emptied option goes', () => {
      const two = at({ gifts: { dock: { main: 2, gold: 9 }, noble: { main: 5 } } });
      expect(asGm(two, { kind: 'clearRoll', option: 'dock', id: 'main' }).data[CREATING_KEY].gifts).toEqual({ dock: { gold: 9 }, noble: { main: 5 } });
      expect(asGm(two, { kind: 'clearRoll', option: 'noble', id: 'main' }).data[CREATING_KEY].gifts).toEqual({ dock: { main: 2, gold: 9 } });
    });

    it('says when there is nothing there', () => {
      const none = { ok: false, error: 'Nothing rolled there to clear' };
      for (const action of [{ step: 'stats' }, { money: 'main' }, { money: 'nope' }, { option: 'dock', id: 'main' }, { option: 'noble', id: 'gold' }, {}]) {
        expect(asGm(at({ gifts: { noble: { main: 1 } } }), { kind: 'clearRoll', ...action }), JSON.stringify(action)).toEqual(none);
      }
    });
  });
});
