/**
 * A system's NEW CHARACTER flow, the server's side (7c1; approved mockup new-character, 2026-11-03):
 * off unless a GM turns it on; steps read from what the system has, in the GM's order; only the
 * switch, the order and what's off stored, so a list made later joins by itself and a deleted one
 * leaves; and it travels in the system file.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require_ = createRequire(import.meta.url);
const { creationOf, stepIdsOf, LIMITS, stepsAsked, creationShown, creatingNow, creationAction, withUpload, CREATING_KEY, lockedWhileCreating, placedFrom, stepWayProblems, parseStatRoll, statRollRange, statRollLine } = require_('../systemBuilder/creation');
const { pickAction } = require_('../systemBuilder/picking');
const { PICKS_KEY } = require_('../systemBuilder/choices');
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
    expect(roll(once)).toEqual({ ok: false, error: 'Rolled, and kept: rolling again is the GM\'s' });
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
    expect(finish({ ...once, might: 14, wits: 8 }).data).toEqual({ might: 14, wits: 8, [CREATING_KEY]: { done: true } });
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
    expect(done.data).toEqual({ might: 8, wits: 8, [CREATING_KEY]: { done: true } });
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

  it('MONEY still waits', () => {
    expect(stepsAsked(def())).not.toContain('money');
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
    expect(done.data[CREATING_KEY]).toEqual({ done: true });
    expect(finish(at, def([ALL])).items).toEqual([{ name: 'Knife', qty: 1 }]);
    expect(finish(at, def([GM])).items).toEqual([]);
    expect(finish(at, def([ALL], { off: ['kits'] })).items).toEqual([]);
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
    expect(done).toEqual({ [CREATING_KEY]: { done: true } });
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
