import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

import {
  LIMITS, choiceLists, picksOf, withNewList, withList, withoutList, withNewOption, withOption, withoutOption, levelNames,
  featureList, levelOf, kindsOf, withNewFeature, withFeature, withoutFeature, modifierTargets, refillRests, rollChoices,
  tableOf, rollRangeOf, playersOf, tableDiceChoices, evenRolls, tableProblems, type ChoiceList, NEW_INCREASE, increaseGroups, increaseWords
} from '../choices';
import type { Definition } from '../systemsApi';

/**
 * The builder's CHOICES page as logic (7a2b1; approved mockup builder-choices, 2026-10-27): lists, their
 * options and (7a2b2) the options' features made, changed and removed, each result held to the server's own checks
 * (backend/systemBuilder/choices.js), so what the page writes is what the server takes.
 */

const req = createRequire(import.meta.url);
const backend = req('../../../../backend/systemBuilder/choices.js');
const { checkDefinition } = req('../../../../backend/systemBuilder/definition.js');

const HEARTH = {
  format: 1, name: 'Hearth',
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'int', label: 'Intellect' }] }],
  derived: [{ id: 'defense', formula: '10' }, { id: 'rogue_level', formula: '1' }],
  choices: [
    { id: 'classes', one: 'Class', many: 'Classes', levelled: true, again: true, options: [
      { id: 'soldier', label: 'Soldier', features: [{ id: 'guard', label: 'Guard', modifiers: [{ target: 'defense', amount: '1' }], choice: 'feats' }] },
    ] },
    { id: 'feats', one: 'Feat', many: 'Feats', picks: 'any', options: [{ id: 'tough', label: 'Tough' }] },
  ],
} as unknown as Definition;
const problems = (def: Definition) => checkDefinition(def).problems.map((p: { where: string; message: string }) => `${p.where}: ${p.message}`);

describe('held to the server', () => {
  it('the same limits', () => {
    expect(LIMITS).toEqual(backend.LIMITS);
  });

  it('every edit leaves a system the server takes as it is', () => {
    expect(problems(HEARTH)).toEqual([]);
    let def = HEARTH;
    const list = withNewList(def)!;
    def = withList(list.definition, list.id, { one: 'Background', many: 'Backgrounds', picks: 2, again: true });
    const option = withNewOption(def, list.id)!;
    def = withOption(option.definition, list.id, option.id, { label: 'Dockhand', description: 'Grew up on the wharf.', requires: '@int >= 10' });
    def = withList(def, 'classes', { picks: 'any', levelled: false, again: false });
    expect(problems(def)).toEqual([]);
    expect(problems(withoutOption(def, 'classes', 'soldier'))).toEqual([]);
    expect(problems(withoutList(def, 'feats'))).toEqual([]);
  });
});

describe('a list\'s table to roll on (7a5b)', () => {
  const BGS = { id: 'bgs', one: 'Background', many: 'Backgrounds', options: [{ id: 'dock', label: 'Dockhand' }, { id: 'scribe', label: 'Scribe' }, { id: 'thief', label: 'Thief' }] };
  const def = (c: object = BGS, core: object = { dice: ['d8', '4dF', '2d6', 'd10'] }) => ({ format: 1, name: 'Hearth', core, choices: [c] }) as unknown as Definition;
  const bgs = (d: Definition) => choiceLists(d)[0];

  it('reads dice, rolls and how players pick as the server does', () => {
    for (const table of ['d6', '2d6', ' D20 ', '4d100', '5d6', 'd1', 'd101', 'dF', '0d6', '2d', undefined]) {
      expect(tableOf({ table }), String(table)).toEqual(backend.tableOf({ table }));
    }
    for (const roll of ['4', ' 4 - 5 ', '5-4', '4-', '', 4]) expect(rollRangeOf(roll), String(roll)).toEqual(backend.rollRangeOf(roll));
    for (const c of [{ table: '2d6', players: 'roll' }, { table: '2d6' }, { table: '2d6', players: 'nope' }, { players: 'roll' }, { table: 'd6', players: 'hand' }]) {
      expect(playersOf({ ...BGS, ...c } as ChoiceList), JSON.stringify(c)).toBe(backend.playersOf(c));
    }
  });

  it('offers d6, 2d6, d20, d100 and the system\'s own that a table can roll, each once', () => {
    expect(tableDiceChoices(def())).toEqual(['d6', '2d6', 'd20', 'd100', 'd8', 'd10']);
    expect(tableDiceChoices(def(BGS, { dice: [' D12 ', '5d6'] }))).toEqual(['d6', '2d6', 'd20', 'd100', 'd12']);
    expect(tableDiceChoices(def(BGS, {}))).toEqual(['d6', '2d6', 'd20', 'd100']);
  });

  it('shares the rolls out evenly, in order, the first ones a roll more', () => {
    expect(evenRolls(BGS.options, 'd6')).toEqual({ dock: '1-2', scribe: '3-4', thief: '5-6' });
    expect(evenRolls(BGS.options, 'd20')).toEqual({ dock: '1-7', scribe: '8-14', thief: '15-20' });
    expect(evenRolls(BGS.options, '2d6')).toEqual({ dock: '2-5', scribe: '6-9', thief: '10-12' });
    expect(evenRolls([{ id: 'a' }, { id: 'b' }, { id: 'c' }], 'd2')).toEqual({ a: '1', b: '2', c: '' });
    expect([evenRolls([], 'd6'), evenRolls(BGS.options, 'dF')]).toEqual([{}, {}]);
  });

  it('says what is wrong with a table as the server does, each by its option', () => {
    const cases = [
      [{ id: 'dock', label: 'Dockhand', roll: '1-2' }, { id: 'scribe', label: 'Scribe', roll: '2-3' }, { id: 'thief', label: 'Thief', roll: '9' }],
      // A nameless option is named by its id.
      [{ id: 'dock', label: 'Dockhand', roll: '1-3' }, { id: 'scribe', label: '', roll: '3-6' }],
      [{ id: 'dock', label: 'Dockhand', roll: '1-6' }],
      [{ id: 'dock', label: 'Dockhand' }, { id: 'scribe', label: 'Scribe', roll: 'x' }],
      [{ id: 'dock', label: 'Dockhand', roll: '1' }],
    ];
    for (const options of cases) {
      const c = { ...BGS, table: 'd6', options };
      const server = problems(def(c)).filter((p) => /^list bgs, (table|option \w+, roll):/.test(p));
      const mine = tableProblems(c as ChoiceList).map((p) => (p.option ? `list bgs, option ${p.option}, roll: ${p.message}` : `list bgs, table: ${p.message}`));
      expect(mine, JSON.stringify(options)).toEqual(server);
    }
    expect(tableProblems(BGS as ChoiceList)).toEqual([]);
  });

  it('a table picked shares the rolls out; other dice share them again; NONE takes table, players and rolls away', () => {
    let d = withList(def(), 'bgs', { table: 'd6' });
    expect(bgs(d)).toMatchObject({ table: 'd6', options: [{ roll: '1-2' }, { roll: '3-4' }, { roll: '5-6' }] });
    expect(problems(d)).toEqual([]);
    d = withList(d, 'bgs', { players: 'roll' });
    expect(bgs(d).players).toBe('roll');
    d = withOption(d, 'bgs', 'dock', { roll: ' 1-3 ' });
    expect(bgs(d).options[0].roll).toBe('1-3');
    // The same dice again keeps the rolls typed; another table shares them out again.
    expect(bgs(withList(d, 'bgs', { table: 'd6' })).options[0].roll).toBe('1-3');
    expect(bgs(withList(d, 'bgs', { table: 'd20' })).options.map((o) => o.roll)).toEqual(['1-7', '8-14', '15-20']);
    // Dice it can't roll aren't taken.
    expect(bgs(withList(d, 'bgs', { table: 'dF' })).table).toBe('d6');
    // BY HAND OR ROLL is stored as nothing, as the server reads it.
    expect(bgs(withList(d, 'bgs', { players: 'either' }))).not.toHaveProperty('players');
    const gone = withList(d, 'bgs', { table: null });
    expect(bgs(gone)).toEqual(BGS);
    expect(problems(gone)).toEqual([]);
    expect(bgs(withList(d, 'bgs', { picked: 'everyone' }))).toEqual({ ...BGS, picked: 'everyone' });
    // Other changes leave the table and its rolls alone.
    expect(bgs(withList(d, 'bgs', { many: 'Origins' }))).toMatchObject({ table: 'd6', players: 'roll', options: [{ roll: '1-3' }, { roll: '3-4' }, { roll: '5-6' }] });
  });

  it('an option\'s roll only on a list with a table; empty takes it away', () => {
    expect(bgs(withOption(def(), 'bgs', 'dock', { roll: '2' })).options[0]).not.toHaveProperty('roll');
    const d = withList(def(), 'bgs', { table: 'd6' });
    expect(bgs(withOption(d, 'bgs', 'dock', { roll: '' })).options[0]).not.toHaveProperty('roll');
    expect(bgs(withOption(d, 'bgs', 'dock', { label: 'Docker' })).options[0]).toMatchObject({ label: 'Docker', roll: '1-2' });
  });
});

describe('lists', () => {
  it('are read with their options; anything not a list is left out', () => {
    const odd = { ...HEARTH, choices: [...(HEARTH.choices as unknown[]), 'junk', { id: 3 }] } as unknown as Definition;
    expect(choiceLists(odd).map((c) => [c.id, c.options.map((o) => o.id)])).toEqual([['classes', ['soldier']], ['feats', ['tough']]]);
    expect(choiceLists({ format: 1, name: 'x' })).toEqual([]);
  });

  it('a new one is named to rename, its id free, up to the limit', () => {
    const made = withNewList(HEARTH)!;
    expect(made.id).toBe('new_list');
    expect(choiceLists(made.definition).at(-1)).toEqual({ id: 'new_list', one: 'NEW CHOICE', many: 'NEW CHOICES', options: [] });
    expect(withNewList(made.definition)!.id).toBe('new_list_2');
    const full = { ...HEARTH, choices: Array.from({ length: LIMITS.lists }, (_, i) => ({ id: `l${i}`, one: 'A', many: 'As', options: [] })) } as unknown as Definition;
    expect(withNewList(full)).toBeNull();
  });

  it('one pick, not levelled and not again store nothing; several are capped', () => {
    const feats = (def: Definition) => choiceLists(def).find((c) => c.id === 'feats')!;
    expect(feats(withList(HEARTH, 'feats', { picks: 1 }))).not.toHaveProperty('picks');
    expect(picksOf(feats(withList(HEARTH, 'feats', { picks: 1 })))).toBe(1);
    expect(feats(withList(HEARTH, 'feats', { picks: 3 })).picks).toBe(3);
    expect(feats(withList(HEARTH, 'feats', { picks: 999 })).picks).toBe(LIMITS.picks);
    expect(picksOf(feats(HEARTH))).toBe('any');
    const flat = choiceLists(withList(HEARTH, 'classes', { levelled: false, again: false }))[0];
    expect(flat).not.toHaveProperty('levelled');
    expect(flat).not.toHaveProperty('again');
  });

  it('names are kept as typed, blank too, for PROBLEMS to point at', () => {
    expect(choiceLists(withList(HEARTH, 'feats', { many: '' }))[1].many).toBe('');
  });

  it('removing one leaves no feature opening it from another list', () => {
    const def = withoutList(HEARTH, 'feats');
    expect(choiceLists(def).map((c) => c.id)).toEqual(['classes']);
    expect(choiceLists(def)[0].options[0].features).toEqual([{ id: 'guard', label: 'Guard', modifiers: [{ target: 'defense', amount: '1' }] }]);
    expect(withoutList(withoutList(HEARTH, 'feats'), 'classes')).not.toHaveProperty('choices');
  });
});

describe('options', () => {
  it('a new one takes an id no option, feature or level name has', () => {
    const taken = { ...HEARTH, choices: [{ id: 'feats', one: 'Feat', many: 'Feats', options: [{ id: 'new_option', label: 'X', features: [{ id: 'new_option_2', label: 'Y' }] }] }] } as unknown as Definition;
    expect(withNewOption(taken, 'feats')!.id).toBe('new_option_3');
    // A formula called new_option_level: an option called new_option would read its level there.
    const clash = { ...HEARTH, derived: [{ id: 'new_option_level', formula: '1' }] } as unknown as Definition;
    expect(withNewOption(clash, 'classes')!.id).toBe('new_option_2');
    expect(withNewOption(HEARTH, 'classes')!.id).toBe('new_option');
    expect(withNewOption(HEARTH, 'nope')).toBeNull();
  });

  it('is named to rename, added to its own list only, up to the limit', () => {
    const made = withNewOption(HEARTH, 'feats')!;
    expect(choiceLists(made.definition)[1].options.map((o) => o.label)).toEqual(['Tough', 'NEW OPTION']);
    expect(choiceLists(made.definition)[0].options).toHaveLength(1);
    const full = { ...HEARTH, choices: [{ id: 'feats', one: 'Feat', many: 'Feats', options: Array.from({ length: LIMITS.options }, (_, i) => ({ id: `o${i}`, label: 'O' })) }] } as unknown as Definition;
    expect(withNewOption(full, 'feats')).toBeNull();
  });

  it('empty words and requirement store nothing; its features stay as they are', () => {
    const def = withOption(HEARTH, 'classes', 'soldier', { description: '  ', requires: '' });
    expect(choiceLists(def)[0].options[0]).toEqual(choiceLists(HEARTH)[0].options[0]);
    const set = withOption(HEARTH, 'classes', 'soldier', { label: 'Veteran', requires: '@int >= 13' });
    expect(choiceLists(set)[0].options[0]).toMatchObject({ id: 'soldier', label: 'Veteran', requires: '@int >= 13', features: [{ id: 'guard' }] });
  });

  it('removed from its list alone, even where a broken file has its id in another', () => {
    expect(choiceLists(withoutOption(HEARTH, 'classes', 'soldier')).map((c) => c.options.length)).toEqual([0, 1]);
    const twice = { ...HEARTH, choices: [{ id: 'a', one: 'A', many: 'As', options: [{ id: 'x', label: 'X' }] }, { id: 'b', one: 'B', many: 'Bs', options: [{ id: 'x', label: 'X' }] }] } as unknown as Definition;
    expect(choiceLists(withoutOption(twice, 'a', 'x')).map((c) => c.options.length)).toEqual([0, 1]);
  });
});

describe('level names', () => {
  it('as the server reads them: each option\'s and the list\'s sum', () => {
    const classes = choiceLists(HEARTH)[0];
    expect(levelNames(classes)).toEqual({ list: '@classes_level', options: { soldier: '@soldier_level' } });
    expect([...backend.levelNamesOf(HEARTH)].sort()).toEqual(['classes_level', 'level', 'soldier_level']);
  });
});

const WITH_ROLLS = {
  ...HEARTH,
  core: { health: { model: 'pool' } },
  rests: { vigil: { name: 'Vigil' } },
  rolls: [
    { id: 'spark', label: 'Spark', dice: [{ count: '1', sides: 10 }] },
    { id: 'mind_save', label: 'Mind save', dice: [{ count: '1', sides: 20 }], changes: [{ id: 'advantage', label: 'Advantage', extra: { dice: 1, keep: 'highest' } }] },
  ],
} as unknown as Definition;
const soldier = (def: Definition) => featureList(choiceLists(def)[0].options[0]);
const tough = (def: Definition) => featureList(choiceLists(def)[1].options[0]);

describe('features (7a2b2)', () => {
  it('every kind written, several at once, is a system the server takes', () => {
    let def = WITH_ROLLS;
    const made = withNewFeature(def, 'classes', 'soldier', 3)!;
    def = withFeature(made.definition, 'classes', 'soldier', made.id, {
      label: 'Arcane Guard', text: 'A ward of light.', at: 3,
      modifiers: [{ target: 'defense', amount: '@soldier_level' }, { target: 'int', amount: '1' }, { target: 'hp_max', amount: '5' }],
      uses: { count: '1', refill: 'vigil' }, rolls: ['spark'], changes: [{ roll: 'mind_save', change: 'advantage' }], choice: 'feats',
    });
    expect(problems(def)).toEqual([]);
    expect(soldier(def).at(-1)).toEqual({
      id: 'new_feature', label: 'Arcane Guard', text: 'A ward of light.', at: 3,
      modifiers: [{ target: 'defense', amount: '@soldier_level' }, { target: 'int', amount: '1' }, { target: 'hp_max', amount: '5' }],
      uses: { count: '1', refill: 'vigil' }, rolls: ['spark'], changes: [{ roll: 'mind_save', change: 'advantage' }], choice: 'feats',
    });
    expect(kindsOf(soldier(def).at(-1)!)).toEqual(['modifier', 'uses', 'roll', 'change', 'choice']);
    expect(problems(withoutFeature(def, 'classes', 'soldier', 'new_feature'))).toEqual([]);
  });

  it('a new one is named to rename, its id free, at the level asked in a levelled list only, up to the limit', () => {
    const made = withNewFeature(HEARTH, 'classes', 'soldier', 4)!;
    expect(made.id).toBe('new_feature');
    expect(soldier(made.definition).at(-1)).toEqual({ id: 'new_feature', label: 'NEW FEATURE', at: 4 });
    expect(tough(withNewFeature(HEARTH, 'feats', 'tough', 4)!.definition)).toEqual([{ id: 'new_feature', label: 'NEW FEATURE' }]);
    expect(soldier(withNewFeature(HEARTH, 'classes', 'soldier', 1)!.definition).at(-1)).not.toHaveProperty('at');
    expect(withNewFeature(HEARTH, 'classes', 'nope')).toBeNull();
    const full = { ...HEARTH, choices: [{ id: 'feats', one: 'Feat', many: 'Feats', options: [{ id: 'tough', label: 'T', features: Array.from({ length: LIMITS.features }, (_, i) => ({ id: `f${i}`, label: 'F' })) }] }] } as unknown as Definition;
    expect(withNewFeature(full, 'feats', 'tough')).toBeNull();
  });

  it('what says nothing stores nothing: blank words, level 1, empty lists, no uses, no list', () => {
    const def = withFeature(HEARTH, 'classes', 'soldier', 'guard', { text: ' ', at: 1, modifiers: [], rolls: [], changes: [], uses: null, choice: null });
    expect(soldier(def)[0]).toEqual({ id: 'guard', label: 'Guard' });
    expect(soldier(withFeature(HEARTH, 'classes', 'soldier', 'guard', { uses: { count: '2', refill: '' } }))[0].uses).toEqual({ count: '2' });
  });

  it('a level only in a levelled list, never past the highest', () => {
    expect(soldier(withFeature(HEARTH, 'classes', 'soldier', 'guard', { at: 999 }))[0].at).toBe(LIMITS.level);
    const flat = withList(HEARTH, 'classes', { levelled: false });
    expect(soldier(withFeature(flat, 'classes', 'soldier', 'guard', { at: 3 }))[0]).not.toHaveProperty('at');
    expect(levelOf({ id: 'x', label: 'X' })).toBe(1);
    expect(levelOf({ id: 'x', label: 'X', at: 4 })).toBe(4);
  });

  it('the last feature removed leaves the option without the key', () => {
    expect(choiceLists(withoutFeature(HEARTH, 'classes', 'soldier', 'guard'))[0].options[0]).not.toHaveProperty('features');
  });

  it('a feature that does nothing is words only', () => {
    expect(kindsOf({ id: 'x', label: 'X', text: 'Hi.' })).toEqual(['text']);
  });
});

describe('what a feature can name', () => {
  it('a modifier: the stats, formulas and health fields, as the server allows', () => {
    const targets = modifierTargets(WITH_ROLLS);
    expect(targets.map((g) => g.group)).toEqual(['STATS', 'FORMULAS', 'HEALTH']);
    // A kind the system has none of isn't offered as an empty group.
    expect(modifierTargets({ ...WITH_ROLLS, derived: [] } as unknown as Definition).map((g) => g.group)).toEqual(['STATS', 'HEALTH']);
    const ids = targets.flatMap((g) => g.items.map((i) => i.id));
    expect(ids).toEqual(expect.arrayContaining(['int', 'defense', 'rogue_level']));
    // Every one is a target the server's own check takes.
    for (const id of ids) {
      const def = withFeature(WITH_ROLLS, 'classes', 'soldier', 'guard', { modifiers: [{ target: id, amount: '1' }] });
      expect(problems(def), id).toEqual([]);
    }
  });

  it('uses: every rest, the off ones said so, each a refill the server takes', () => {
    const off = { ...WITH_ROLLS, rests: { ...(WITH_ROLLS.rests as object), end_of_scene: { on: false } } } as unknown as Definition;
    const rests = refillRests(off);
    expect(rests.map((r) => r.id)).toEqual(expect.arrayContaining(['short_rest', 'long_rest', 'vigil']));
    expect(rests.find((r) => r.id === 'end_of_scene')!.label).toMatch(/\(OFF\)$/);
    for (const r of rests) expect(problems(withFeature(off, 'classes', 'soldier', 'guard', { uses: { count: '1', refill: r.id } })), r.id).toEqual([]);
  });

  it('rolls and their changes, by name', () => {
    expect(rollChoices(WITH_ROLLS)).toEqual([
      { id: 'spark', label: 'SPARK', changes: [] },
      { id: 'mind_save', label: 'MIND SAVE', changes: [{ id: 'advantage', label: 'ADVANTAGE' }] },
    ]);
  });
});

describe('an INCREASE on a feature (7d6a)', () => {
  const RAISED = { ...HEARTH, stats: [
    { id: 'abilities', label: 'Abilities', stats: [{ id: 'might', label: 'Might' }] },
    { id: 'skills', label: 'SKILLS', stats: [] },
    { id: 'traits', stats: [{ id: 'grit', label: 'Grit' }] },
  ] } as unknown as Definition;
  const made = withNewFeature(RAISED, 'classes', 'soldier')!;
  const set = (increase: unknown) => featureList(choiceLists(withFeature(made.definition, 'classes', 'soldier', made.id, { increase } as never))
    .find((c) => c.id === 'classes')!.options.find((o) => o.id === 'soldier')!).find((f) => f.id === made.id)!;

  it('starts as D&D\'s: 2 points, all on one if they like, any stat, no limit', () => {
    expect(NEW_INCREASE).toEqual({ points: 2 });
    expect(set(NEW_INCREASE).increase).toEqual({ points: 2 });
    expect(kindsOf(set(NEW_INCREASE))).toEqual(['increase']);
    expect(kindsOf(set({ points: 2 }))).not.toContain('text');
  });

  it('kept as whole numbers within their limits, nothing for what is all or none', () => {
    expect(set({ points: 4, most: 1, stats: 'abilities', cap: 20 }).increase).toEqual({ points: 4, most: 1, stats: 'abilities', cap: 20 });
    expect(set({ points: 0 }).increase).toEqual({ points: 1 });
    expect(set({ points: 99 }).increase).toEqual({ points: LIMITS.increase });
    expect(set({ points: 2.7 }).increase).toEqual({ points: 2 });
    expect(set({ points: Number.NaN }).increase).toEqual({ points: 1 });
    expect(set({ points: 2, most: 2 }).increase).toEqual({ points: 2 });
    expect(set({ points: 2, most: 5 }).increase).toEqual({ points: 2 });
    expect(set({ points: 3, most: 0 }).increase).toEqual({ points: 3, most: 1 });
    expect(set({ points: 3, most: 1.9 }).increase).toEqual({ points: 3, most: 1 });
    expect(set({ points: 2, stats: '' }).increase).toEqual({ points: 2 });
    expect(set({ points: 2, cap: 99999 }).increase).toEqual({ points: 2, cap: LIMITS.cap });
    expect(set({ points: 2, cap: -99999 }).increase).toEqual({ points: 2, cap: -LIMITS.cap });
    expect(set({ points: 2, cap: 0 }).increase).toEqual({ points: 2, cap: 0 });
    expect(set({ points: 2, cap: Number.NaN }).increase).toEqual({ points: 2 });
    expect(set(null)).not.toHaveProperty('increase');
  });

  it('the groups it may raise: those with a stat, by name', () => {
    expect(increaseGroups(RAISED)).toEqual([{ id: 'abilities', label: 'ABILITIES' }, { id: 'traits', label: 'TRAITS' }]);
  });

  it('said in words', () => {
    expect(increaseWords(RAISED, { points: 2 })).toBe('2 POINTS · ALL ON ONE IF THEY LIKE · ANY STAT · NO LIMIT');
    expect(increaseWords(RAISED, { points: 4, most: 1, stats: 'abilities', cap: 20 })).toBe('4 POINTS · AT MOST 1 ON ONE · FROM ABILITIES · STOPS AT 20');
    expect(increaseWords(RAISED, { points: 1, stats: 'gone', cap: 0 })).toBe('1 POINT · ANY STAT · STOPS AT 0');
  });
});
