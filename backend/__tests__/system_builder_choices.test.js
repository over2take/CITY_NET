/**
 * A system's choices (7a1a; approved mockup docs/mockups/builder-choices.html, 2026-10-27): the lists
 * a character picks from and the features each pick gives, as the definition checks see them, and
 * carried in a .citysys file beside the system, so a builder from before choices still installs it.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require_ = createRequire(import.meta.url);
const { checkDefinition } = require_('../systemBuilder/definition');
const { LIMITS, choicesOf } = require_('../systemBuilder/choices');
const citysys = require_('../systemBuilder/citysys');
const { OTHER, versionChanges } = require_('../systemBuilder/versionDiff');

const CLASSES = {
  id: 'classes', one: 'Class', many: 'Classes', picks: 1, levelled: true, again: true,
  options: [
    { id: 'soldier', label: 'Soldier', features: [
      { id: 'guard_stance', label: 'Guard Stance', at: 1, modifiers: [{ target: 'defense', amount: '1' }] },
      { id: 'rally', label: 'Rally', at: 1, text: 'Catch your breath.', uses: { count: '1', refill: 'short_rest' }, rolls: ['rally'] },
      { id: 'specialty', label: 'Specialty', at: 3, choice: 'specialties' },
    ] },
    { id: 'mage', label: 'Mage', requires: '@int >= 13', features: [
      { id: 'ward', label: 'Ward', at: 1, modifiers: [{ target: 'defense', amount: '@mage_level' }], uses: { count: '2', refill: 'long_rest' } },
      { id: 'focus', label: 'Focus', at: 2, changes: [{ roll: 'mind_save', change: 'advantage' }] },
    ] },
  ],
};
const SPECIALTIES = { id: 'specialties', one: 'Specialty', many: 'Specialties', options: [{ id: 'duelist', label: 'Duelist' }, { id: 'vanguard', label: 'Vanguard' }] };
const FEATS = { id: 'feats', one: 'Feat', many: 'Feats', picks: 'any', options: [{ id: 'tough', label: 'Tough', features: [{ id: 'tough_hp', label: 'Tough', modifiers: [{ target: 'max_hp', amount: '2 * @con' }] }] }] };

const HEARTH = {
  format: 1, name: 'Hearth',
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'int', label: 'Intellect' }, { id: 'con', label: 'Constitution' }] }],
  derived: [{ id: 'defense', formula: '10' }, { id: 'max_hp', formula: '10 + @con' }],
  rolls: [
    { id: 'rally', label: 'Rally', dice: [{ count: '1', sides: 10 }] },
    { id: 'mind_save', label: 'Mind save', dice: [{ count: '1', sides: 20 }], changes: [{ id: 'advantage', label: 'Advantage', extra: { dice: 1, keep: 'highest' } }] },
  ],
};
const withChoices = (choices) => ({ ...HEARTH, choices });
const problems = (choices, over = {}) => checkDefinition({ ...withChoices(choices), ...over }).problems.map((p) => `${p.where}: ${p.message}`);

describe('a system\'s choices', () => {
  it('a class list with levels and multiclassing, a nested list and an any-number list check clean', () => {
    expect(problems([CLASSES, SPECIALTIES, FEATS])).toEqual([]);
    expect(choicesOf(withChoices([CLASSES, 'junk', { id: 7 }])).map((c) => c.id)).toEqual(['classes']);
  });

  it('is a list of lists, each named one and many, with options', () => {
    expect(problems({})).toEqual(['choices: Must be a list of choices']);
    expect(problems(['x'])).toEqual(['list 1: Must be a list to pick from']);
    expect(problems([{ id: 'classes', options: [] }])).toEqual(['list classes, one: Required', 'list classes, many: Required']);
    expect(problems([{ ...SPECIALTIES, options: undefined }])).toEqual(['list specialties, options: Must be a list of options']);
    expect(problems([{ ...SPECIALTIES, colour: 'red' }])).toEqual(['list specialties, colour: Not part of a list']);
    expect(problems([SPECIALTIES, SPECIALTIES])).toEqual([
      'list specialties: Another list has this id already',
      'list specialties, option duelist: Another option or feature has this id already',
      'list specialties, option vanguard: Another option or feature has this id already',
    ]);
  });

  it('picks a whole number of them, or any, and says levelled and again as true or false', () => {
    for (const picks of [1, 3, LIMITS.picks, 'any']) expect(problems([{ ...SPECIALTIES, picks }])).toEqual([]);
    for (const picks of [0, 1.5, LIMITS.picks + 1, 'all', '2']) {
      expect(problems([{ ...SPECIALTIES, picks }])).toEqual([`list specialties, picks: A number from 1 to ${LIMITS.picks}, or any`]);
    }
    expect(problems([{ ...SPECIALTIES, levelled: 'yes', again: 1 }])).toEqual([
      'list specialties, levelled: Must say levelled: true or levelled: false',
      'list specialties, again: Must say again: true or again: false',
    ]);
  });

  it('options and features share one set of ids across the system, and an option\'s level name must be free', () => {
    const twice = { ...FEATS, options: [{ id: 'soldier', label: 'Soldier again' }] };
    expect(problems([CLASSES, SPECIALTIES, twice])).toEqual(['list feats, option soldier: Another option or feature has this id already']);
    const featureClash = { ...FEATS, options: [{ id: 'tough', label: 'Tough', features: [{ id: 'ward', label: 'Ward' }] }] };
    expect(problems([CLASSES, SPECIALTIES, featureClash])).toEqual(['list feats, option tough, feature ward: Another option or feature has this id already']);
    const taken = { ...HEARTH, derived: [...HEARTH.derived, { id: 'mage_level', formula: '1' }] };
    expect(problems([CLASSES, SPECIALTIES], taken)).toEqual(['list classes, option mage: Its level is read as @mage_level, which a stat or formula already has']);
    // Only a levelled list's options have a level to read.
    expect(problems([{ ...SPECIALTIES, options: [{ id: 'mage', label: 'Mage' }] }], taken)).toEqual([]);
  });

  it('an option is named, its requirement optional and a formula, its features a list', () => {
    const option = (o) => problems([{ ...SPECIALTIES, options: [{ id: 'duelist', label: 'Duelist', ...o }] }]);
    expect(option({})).toEqual([]);
    expect(option({ label: ' ' })).toEqual(['list specialties, option duelist, label: Cannot be blank']);
    expect(option({ requires: '@int >=' })).toHaveLength(1);
    expect(option({ requires: '' })).toEqual(['list specialties, option duelist, requires: Must be formula text']);
    expect(option({ description: 'x'.repeat(LIMITS.description + 1) })).toEqual([`list specialties, option duelist, description: Longer than ${LIMITS.description} characters`]);
    expect(option({ features: {} })).toEqual(['list specialties, option duelist, features: Must be a list of features']);
    expect(option({ cost: 3 })).toEqual(['list specialties, option duelist, cost: Not part of an option']);
  });

  it('a feature unlocks at a level only in a levelled list, from 1 to the highest', () => {
    const at = (n, levelled = true) => problems([{ ...SPECIALTIES, levelled, options: [{ id: 'duelist', label: 'Duelist', features: [{ id: 'riposte', label: 'Riposte', at: n }] }] }]);
    expect(at(1)).toEqual([]);
    expect(at(LIMITS.level)).toEqual([]);
    for (const n of [0, 2.5, LIMITS.level + 1, '3']) expect(at(n)).toEqual([`list specialties, option duelist, feature riposte, at: A level from 1 to ${LIMITS.level}`]);
    expect(at(1, false)).toEqual(['list specialties, option duelist, feature riposte, at: Only the features of a list with levels unlock at a level: a levelled list, one everyone has, or one a feature of those opens']);
  });

  const feature = (f) => problems([CLASSES, SPECIALTIES, { ...FEATS, options: [{ id: 'tough', label: 'Tough', features: [{ id: 'grit', label: 'Grit', ...f }] }] }]);
  const W = 'list feats, option tough, feature grit';

  it('a feature with nothing to do is words for the table; it does any of the rest, several at once', () => {
    expect(feature({ text: 'Never gives up.' })).toEqual([]);
    expect(feature({ modifiers: [{ target: 'con', amount: '2' }, { target: 'max_hp', amount: '@con' }], uses: { count: '1' }, rolls: ['rally'], changes: [{ roll: 'mind_save', change: 'advantage' }], choice: 'specialties' })).toEqual([]);
    expect(feature({ label: undefined })).toEqual([`${W}, label: Required`]);
    expect(feature({ power: 9 })).toEqual([`${W}, power: Not part of a feature`]);
  });

  it('modifies a stat, formula or health field by a formula', () => {
    expect(feature({ modifiers: [{ target: 'hp', amount: '5' }] })).toEqual([]);
    expect(feature({ modifiers: [{ target: 'luck', amount: '1' }] })).toEqual([`${W}, modifier 1, target: Not one of this system's stats, formulas or health fields`]);
    expect(feature({ modifiers: [{ target: 'con', amount: '' }] })).toEqual([`${W}, modifier 1, amount: Must be formula text`]);
    expect(feature({ modifiers: [{ target: 'con', amount: 'nope(1)' }] })).toHaveLength(1);
    expect(feature({ modifiers: [{ target: 'con', amount: '1', when: 'always' }] })).toEqual([`${W}, modifier 1, when: Not part of a modifier`]);
    expect(feature({ modifiers: 'con +1' })).toEqual([`${W}, modifiers: Must be a list of modifiers`]);
    expect(feature({ modifiers: Array.from({ length: LIMITS.modifiers + 1 }, () => ({ target: 'con', amount: '1' })) })).toEqual([`${W}, modifiers: At most ${LIMITS.modifiers}`]);
  });

  it('has uses, a formula many, refilled by one of the system\'s rests', () => {
    expect(feature({ uses: { count: '@con', refill: 'long_rest' } })).toEqual([]);
    expect(feature({ uses: { count: '1', refill: 'nap' } })).toEqual([`${W}, uses, refill: Not one of this system's rests`]);
    expect(feature({ uses: { refill: 'long_rest' } })).toEqual([`${W}, uses, count: Must be formula text`]);
    expect(feature({ uses: 2 })).toEqual([`${W}, uses: Must say how many, and what refills them`]);
    // A rest of the system's own refills them too.
    expect(problems([CLASSES, SPECIALTIES, { ...FEATS, options: [{ id: 'tough', label: 'Tough', features: [{ id: 'grit', label: 'Grit', uses: { count: '1', refill: 'vigil' } }] }] }],
      { rests: { vigil: { name: 'Vigil' } } })).toEqual([]);
  });

  it('gives the system\'s rolls, and a change one of them has', () => {
    expect(feature({ rolls: ['dodge'] })).toEqual([`${W}, rolls: dodge is not one of this system's rolls`]);
    expect(feature({ rolls: 'rally' })).toEqual([`${W}, rolls: Must be a list of rolls`]);
    expect(feature({ changes: [{ roll: 'rally', change: 'advantage' }] })).toEqual([`${W}, change 1, change: Not one of that roll's changes`]);
    expect(feature({ changes: [{ roll: 'dodge', change: 'advantage' }] })).toEqual([`${W}, change 1, roll: Not one of this system's rolls`]);
  });

  it('opens one of the system\'s other lists to pick from', () => {
    expect(feature({ choice: 'skills' })).toEqual([`${W}, choice: Not one of this system's lists`]);
    expect(feature({ choice: 'feats' })).toEqual([`${W}, choice: A list can't be picked from inside itself`]);
  });

  it('keeps to its limits, reporting what is past them once', () => {
    const many = Array.from({ length: LIMITS.lists + 1 }, (_, i) => ({ id: `list_${i}`, one: 'One', many: 'Many', options: [] }));
    expect(problems(many)).toEqual([`choices: At most ${LIMITS.lists} lists`]);
    const options = Array.from({ length: LIMITS.options + 1 }, (_, i) => ({ id: `o_${i}`, label: 'O' }));
    expect(problems([{ ...SPECIALTIES, options }])).toEqual([`list specialties, options: At most ${LIMITS.options} options`]);
    const features = Array.from({ length: LIMITS.features + 1 }, (_, i) => ({ id: `f_${i}`, label: 'F' }));
    expect(problems([{ ...SPECIALTIES, options: [{ id: 'duelist', label: 'Duelist', features }] }])).toEqual([`list specialties, option duelist, features: At most ${LIMITS.features} features`]);
  });
});

describe('choices in a .citysys file', () => {
  const file = (definition) => citysys.buildFile({ definition, version: 2, origin: 'sys_abcdefabcdefabcd' });

  it('travel beside the system, so a builder from before choices reads a system it knows', () => {
    const built = file(withChoices([CLASSES, SPECIALTIES]));
    expect(built.choices).toEqual([CLASSES, SPECIALTIES]);
    expect('choices' in built.definition).toBe(false);
    expect(checkDefinition(built.definition).problems).toEqual([]);
  });

  it('go back into the system when installed here, checked with the rest', () => {
    const read = citysys.readFile(JSON.stringify(file(withChoices([CLASSES, SPECIALTIES]))));
    expect(read.file.definition.choices).toEqual([CLASSES, SPECIALTIES]);
    expect(read.problems).toEqual([]);
    const broken = citysys.readFile(JSON.stringify(file(withChoices([CLASSES]))));
    expect(broken.problems.map((p) => p.where)).toEqual(['list classes, option soldier, feature specialty, choice']);
  });
});

describe('choices in PUBLISH\'s preview', () => {
  it('a change to them is said, in the line for what changes no character yet', () => {
    expect(OTHER).toContain('choices');
    const changes = versionChanges(withChoices([SPECIALTIES]), withChoices([{ ...SPECIALTIES, many: 'Paths' }]));
    expect(changes).toEqual([{ kind: 'other', change: 'changed', id: 'choices' }]);
  });
});

describe('a list\'s table to roll on (7a5b)', () => {
  const { tableOf, rollRangeOf, playersOf } = require_('../systemBuilder/choices');
  const BGS = {
    id: 'bgs', one: 'Background', many: 'Backgrounds', table: '2d6', players: 'roll', options: [
      { id: 'dock', label: 'Dockhand', roll: '2-6' }, { id: 'scribe', label: 'Scribe', roll: '7' }, { id: 'thief', label: 'Thief', roll: '8-12' },
    ],
  };

  it('reads dice up to four of 2 to 100 sides, a roll or range, and how players pick', () => {
    expect(tableOf(BGS)).toEqual({ count: 2, sides: 6, low: 2, high: 12 });
    expect(tableOf({ table: ' D20 ' })).toEqual({ count: 1, sides: 20, low: 1, high: 20 });
    expect(tableOf({ table: '4d100' })).toMatchObject({ low: 4, high: 400 });
    for (const bad of ['5d6', 'd1', 'd101', 'dF', '0d6', '2d', 6, undefined]) expect(tableOf({ table: bad }), String(bad)).toBeNull();
    expect([rollRangeOf('4'), rollRangeOf(' 4 - 5 '), rollRangeOf('5-4'), rollRangeOf('4-'), rollRangeOf(4)]).toEqual([[4, 4], [4, 5], null, null, null]);
    expect([playersOf(BGS), playersOf({ ...BGS, players: undefined }), playersOf({ ...BGS, players: 'nope' }), playersOf({ ...BGS, table: undefined })]).toEqual(['roll', 'either', 'either', 'hand']);
  });

  it('checks clean, and travels in the system file unchanged', () => {
    expect(problems([BGS])).toEqual([]);
    expect(problems([{ ...BGS, players: 'hand' }])).toEqual([]);
    const file = citysys.buildFile({ definition: withChoices([BGS]), version: 1, origin: 'sys_abcdefabcdefabcd' });
    const read = citysys.readFile(JSON.stringify(file));
    expect([read.file.definition.choices, read.problems]).toEqual([[BGS], []]);
  });

  it('says what is wrong: dice it can\'t roll, how players pick, a roll off the table, on two options, none at all', () => {
    expect(problems([{ ...BGS, table: '9d6' }])).toEqual(['list bgs, table: Dice like d6, 2d6, d20 or d100: up to 4 dice of 2 to 100 sides']);
    expect(problems([{ ...BGS, players: 'dice' }])).toEqual(['list bgs, players: hand (by hand), either (by hand or rolled) or roll (rolled only)']);
    const { table: _t, ...untabled } = BGS;
    expect(problems([{ ...untabled, options: untabled.options.map(({ roll: _r, ...o }) => o) }])).toEqual(['list bgs, players: Only a list with a table to roll on is rolled for']);
    expect(problems([{ ...untabled, players: 'hand', options: untabled.options.map(({ roll: _r, ...o }) => o) }])).toEqual([]);
    expect(problems([{ ...untabled, players: 'hand' }])).toEqual([
      'list bgs, option dock, roll: Only an option of a list with a table to roll on has a roll',
      'list bgs, option scribe, roll: Only an option of a list with a table to roll on has a roll',
      'list bgs, option thief, roll: Only an option of a list with a table to roll on has a roll',
    ]);
    // Off the table, or none: said, and the rolls they'd have had left on nothing.
    expect(problems([{ ...BGS, options: [{ id: 'dock', label: 'Dockhand', roll: '1-7' }, { id: 'scribe', label: 'Scribe', roll: '6-7' }, { id: 'thief', label: 'Thief' }] }])).toEqual([
      'list bgs, option dock, roll: A roll from 2 to 12, or a range like 2-3',
      'list bgs, option thief, roll: A roll from 2 to 12, or a range like 2-3',
      'list bgs, table: Nothing on 2, 3, 4, 5, 8, 9…',
    ]);
    expect(problems([{ ...BGS, options: [{ id: 'dock', label: 'Dockhand', roll: '2-7' }, { id: 'scribe', label: 'Scribe', roll: '7' }, { id: 'thief', label: 'Thief', roll: '8-11' }] }])).toEqual([
      'list bgs, option scribe, roll: 7 is both Dockhand and Scribe',
      'list bgs, table: Nothing on 12',
    ]);
    expect(problems([{ ...BGS, picked: 'everyone', players: undefined }])).toEqual(['list bgs, table: A list everyone has is never picked, so never rolled for']);
  });
});

describe('an INCREASE on a feature (7d6a)', () => {
  const ASI = (increase) => withChoices([{ ...CLASSES, options: [{ ...CLASSES.options[0], features: [...CLASSES.options[0].features, { id: 'asi', label: 'Ability Score Improvement', at: 4, increase }] }, CLASSES.options[1]] }, SPECIALTIES]);
  const said = (increase, over = {}) => checkDefinition({ ...ASI(increase), ...over }).problems.map((p) => `${p.where}: ${p.message}`);
  const AT = 'list classes, option soldier, feature asi, increase';

  it('D&D\'s, Pathfinder 2e\'s and 13th Age\'s all fit', () => {
    expect(said({ points: 2 })).toEqual([]);
    expect(said({ points: 2, most: 2, stats: 'abilities', cap: 20 })).toEqual([]);
    expect(said({ points: 4, most: 1 })).toEqual([]);
    expect(said({ points: 3, most: 1, cap: -5 })).toEqual([]);
    expect(said({ points: LIMITS.increase, most: 1, cap: LIMITS.cap })).toEqual([]);
    expect(said({ points: 1, cap: -LIMITS.cap })).toEqual([]);
  });

  it('says what is wrong', () => {
    expect(said('two')).toEqual([`${AT}: Must say how many points, and the most on one stat`]);
    expect(said([2])).toEqual([`${AT}: Must say how many points, and the most on one stat`]);
    expect(said({ points: 2, on: 'str' })).toEqual([`${AT}, on: Not part of an increase`]);
    for (const points of [undefined, 0, 11, 1.5, '2']) expect(said({ points }), String(points)).toEqual([`${AT}, points: From 1 to 10 points`]);
    for (const most of [0, 3, 1.5, '1']) expect(said({ points: 2, most }), String(most)).toEqual([`${AT}, most: From 1 to the points it gives`]);
    // With the points wrong, only the points are said.
    expect(said({ points: 0, most: 5 })).toEqual([`${AT}, points: From 1 to 10 points`]);
    expect(said({ points: 2, stats: 'skills' })).toEqual([`${AT}, stats: Not one of this system's groups of stats`]);
    expect(said({ points: 2, stats: 7 })).toEqual([`${AT}, stats: Not one of this system's groups of stats`]);
    for (const cap of [20.5, '20', 10000, -10000]) expect(said({ points: 2, cap }), String(cap)).toEqual([`${AT}, cap: A whole number from -9999 to 9999`]);
  });

  it('names only a group with a stat in it, and needs the system to have one', () => {
    const empty = { stats: [...HEARTH.stats, { id: 'skills', label: 'SKILLS', stats: [] }] };
    expect(said({ points: 2, stats: 'skills' }, empty)).toEqual([`${AT}, stats: Not one of this system's groups of stats`]);
    expect(said({ points: 2 }, { stats: [{ id: 'skills', label: 'SKILLS', stats: [] }], derived: [{ id: 'defense', formula: '10' }, { id: 'max_hp', formula: '10' }] }))
      .toContain(`${AT}: This system has no stats to raise: make them on STATS & RULES`);
  });

  it('travels in the system file, unchanged', () => {
    const def = ASI({ points: 4, most: 1, stats: 'abilities', cap: 20 });
    const read = citysys.readFile(JSON.stringify(citysys.buildFile({ definition: def, version: 2, origin: 'sys_abcdefabcdefabcd' })));
    expect(read.problems).toEqual([]);
    expect(read.file.definition.choices).toEqual(def.choices);
  });
});
