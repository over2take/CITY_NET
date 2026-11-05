import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import {
  CREATING_KEY, flowDone, flowState, flowStepName, flowSteps, isBlankSheet, isStatsStep, placedFrom, rolledPool, savedStep, statProblem, statsToSet, stepAnswered, stepListId, stepWay, whoFields, withCreationLocks,
} from '../newCharacterFlow';
import { WORKED_KEY, type ChoiceListShown } from '../choicesShown';
import type { SheetTemplate } from '../types';

/**
 * The guided new character at the table, as logic (7c2). Approved mockup new-character (2026-11-03):
 * asked on a blank sheet only, once; a step's NEXT off until it is answered; a name needed, each stat
 * typed in and in range, a list's picks made as far as the requirements let them be.
 */

const req = createRequire(import.meta.url);
const backend = req('../../../../backend/systemBuilder/creation.js');

const list = (over: Partial<ChoiceListShown> & { id: string }): ChoiceListShown => ({
  one: over.id.toUpperCase(), many: over.id, picks: 1, again: false, levelled: false, options: [{ id: `${over.id}_a`, label: 'A', features: [] }, { id: `${over.id}_b`, label: 'B', features: [] }], ...over,
} as unknown as ChoiceListShown);

const TEMPLATE = {
  id: 'sys_x', name: 'Hearth',
  header: { nameField: 'name' },
  sections: [
    { id: 'identity', label: 'IDENTITY', layout: 'list', fields: [
      { id: 'name', label: 'Name', type: 'text' }, { id: 'concept', label: 'Concept', type: 'text' }, { id: 'description', label: 'Description', type: 'textarea' },
    ] },
    { id: 'abilities', label: 'ABILITIES', layout: 'list', fields: [
      { id: 'grit', label: 'Grit', type: 'number' }, { id: 'luck', label: 'Luck', type: 'number', gmOnly: true }, { id: 'grit_mod', label: 'Grit mod', type: 'number', derived: true },
    ] },
    { id: 'links', label: 'LINKS', layout: 'list', fields: [{ id: 'hp', label: 'HP', type: 'number', source: 'token_hp' }] },
  ],
  choices: [list({ id: 'classes' }), list({ id: 'empty', options: [] })],
  creation: {
    steps: ['who', 'stats', 'list:classes', 'list:empty'],
    stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'grit', label: 'Grit', min: 3, max: 18 }, { id: 'luck', label: 'Luck' }] }, { id: 'hidden', label: 'H', stats: [{ id: 'luck', label: 'Luck' }] }],
  },
} as unknown as SheetTemplate;

const worked = (over: object) => ({ [WORKED_KEY]: { picks: [], opens: [], levels: {}, from: {}, uses: {}, unmet: [], recovery: null, ...over } });

describe('who is asked', () => {
  it('a sheet with nothing typed: what is worked out or linked does not count, nor bookkeeping', () => {
    expect(isBlankSheet(TEMPLATE, {})).toBe(true);
    expect(isBlankSheet(TEMPLATE, null)).toBe(true);
    expect(isBlankSheet(TEMPLATE, { grit_mod: -1, hp: 30, _worked: { picks: [] }, name: '  ', grit: 0, cash: null })).toBe(true);
  });

  it('anything typed, a pick, or a roll waiting makes it a sheet already', () => {
    for (const data of [{ name: 'Wren' }, { grit: 12 }, { notes_old: 'still here' }, { _choices: { classes: [{ option: 'a' }] } }, { _rolled: { omens: { option: 'x', roll: 3 } } }, { gear: [{ name: 'Rope' }] }, { flag: true }]) {
      expect(isBlankSheet(TEMPLATE, data), JSON.stringify(data)).toBe(false);
    }
    expect(isBlankSheet(TEMPLATE, { _choices: { classes: [] } })).toBe(true);
  });

  it('new on a blank sheet; going once opened, whatever is on it; none once done', () => {
    expect(flowState(TEMPLATE, {})).toBe('new');
    expect(flowState(TEMPLATE, { name: 'Wren' })).toBe('none');
    expect(flowState(TEMPLATE, { [CREATING_KEY]: {} })).toBe('going');
    expect(flowState(TEMPLATE, { name: 'Wren', [CREATING_KEY]: { at: 'stats' } })).toBe('going');
    expect(flowState(TEMPLATE, { name: 'Wren', [CREATING_KEY]: { done: true } })).toBe('none');
  });

  it('no flow, no asking: a blank sheet in a game without it, and one not loaded', () => {
    expect(flowState({ ...TEMPLATE, creation: undefined }, {})).toBe('none');
    expect(flowState(null, {})).toBe('none');
  });

  it('knows when it has ended', () => {
    expect(flowDone({ [CREATING_KEY]: { done: true, uploaded: true } })).toBe(true);
    expect(flowDone({ [CREATING_KEY]: {} })).toBe(false);
    expect(flowDone(undefined)).toBe(false);
  });
});

describe('the steps', () => {
  it('skips a list with nothing in it, and names them', () => {
    expect(flowSteps(TEMPLATE)).toEqual(['who', 'stats', 'list:classes']);
    expect(flowSteps({ ...TEMPLATE, creation: undefined })).toEqual([]);
    expect(['who', 'stats', 'list:classes'].map((id) => flowStepName(TEMPLATE, id))).toEqual(['WHO THEY ARE', 'THE STATS', 'CLASSES']);
    expect(stepListId('list:classes')).toBe('classes');
    expect(stepListId('who')).toBeNull();
  });

  it('a step is called by its one name, then its many, then its id', () => {
    const named = { ...TEMPLATE, choices: [list({ id: 'feats', one: 'Feat', many: 'Feats' }), list({ id: 'bare', one: '', many: 'Bares' }), list({ id: 'none', one: '', many: '' })] } as unknown as SheetTemplate;
    expect(flowStepName(named, 'list:feats')).toBe('FEAT');
    expect(flowStepName(named, 'list:bare')).toBe('BARES');
    expect(flowStepName(named, 'list:none')).toBe('LIST:NONE');
  });

  it('the place saved, the first when that step has gone, none before starting', () => {
    expect(savedStep(TEMPLATE, { [CREATING_KEY]: { at: 'stats' } })).toBe('stats');
    expect(savedStep(TEMPLATE, { [CREATING_KEY]: { at: 'list:gone' } })).toBe('who');
    expect(savedStep(TEMPLATE, { [CREATING_KEY]: {} })).toBeNull();
    expect(savedStep(TEMPLATE, {})).toBeNull();
  });

  it('asks the sheet\'s own identity, as far as a player may write it', () => {
    expect(whoFields(TEMPLATE).map((f) => f.id)).toEqual(['name', 'concept', 'description']);
    const gmConcept = { ...TEMPLATE, sections: [{ id: 'i', label: 'I', layout: 'list', fields: [
      { id: 'name', label: 'Name', type: 'text' }, { id: 'concept', label: 'Concept', type: 'text', gmOnly: true }, { id: 'description', label: 'D', type: 'text', derived: true },
    ] }] } as unknown as SheetTemplate;
    expect(whoFields(gmConcept).map((f) => f.id)).toEqual(['name']);
  });

  it('asks the stats a player may set, a group left with none going', () => {
    expect(statsToSet(TEMPLATE)).toEqual([{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'grit', label: 'Grit', min: 3, max: 18 }] }]);
    expect(statsToSet({ ...TEMPLATE, creation: undefined })).toEqual([]);
  });
});

describe('a step answered', () => {
  it('WHO THEY ARE needs a name', () => {
    expect(stepAnswered(TEMPLATE, 'who', {})).toBe(false);
    expect(stepAnswered(TEMPLATE, 'who', { name: '   ' })).toBe(false);
    expect(stepAnswered(TEMPLATE, 'who', { name: 7 })).toBe(false);
    expect(stepAnswered(TEMPLATE, 'who', { name: 'Wren' })).toBe(true);
    const nick = { ...TEMPLATE, header: { nameField: 'nick' } } as unknown as SheetTemplate;
    expect(stepAnswered(nick, 'who', { nick: 'Wren' })).toBe(true);
    expect(stepAnswered(nick, 'who', { name: 'Wren' })).toBe(false);
  });

  it('a group\'s step sets that group, named by it, answered on its own (7c3a)', () => {
    const groups = {
      ...TEMPLATE,
      creation: {
        steps: ['who', 'stats:abilities', 'stats:skills'],
        stats: [
          { id: 'abilities', label: 'Abilities', stats: [{ id: 'grit', label: 'Grit', min: 3 }] },
          { id: 'skills', label: 'SKILLS', stats: [{ id: 'climb', label: 'Climb' }] },
        ],
      },
    } as unknown as SheetTemplate;
    expect(['stats', 'stats:skills', 'who', 'list:classes', 'kits'].map(isStatsStep)).toEqual([true, true, false, false, false]);
    expect(flowSteps(groups)).toEqual(['who', 'stats:abilities', 'stats:skills']);
    expect(['stats:abilities', 'stats:skills', 'stats:gone'].map((id) => flowStepName(groups, id))).toEqual(['ABILITIES', 'SKILLS', 'STATS:GONE']);
    expect(statsToSet(groups, 'stats:skills').map((g) => g.id)).toEqual(['skills']);
    expect(statsToSet(groups, 'stats:gone')).toEqual([]);
    expect(statsToSet(groups).map((g) => g.id)).toEqual(['abilities', 'skills']);
    expect(stepAnswered(groups, 'stats:abilities', { grit: 3 })).toBe(true);
    expect(stepAnswered(groups, 'stats:skills', { grit: 3 })).toBe(false);
    expect(stepAnswered(groups, 'stats:abilities', { climb: 1 })).toBe(false);
  });

  it('a step of stats the GM keeps to themselves has nothing to ask (7c3a)', () => {
    const secret = {
      ...TEMPLATE,
      sections: [{ id: 's', label: 'S', layout: 'grid', fields: [{ id: 'worry', label: 'Worry', type: 'number', gmOnly: true }] }],
      creation: { steps: ['who', 'stats:stress', 'stats'], stats: [{ id: 'stress', label: 'STRESS', stats: [{ id: 'worry', label: 'Worry' }] }] },
    } as unknown as SheetTemplate;
    expect(flowSteps(secret)).toEqual(['who']);
  });

  it('THE STATS needs each typed in and in range; a 0 is typed in', () => {
    expect(stepAnswered(TEMPLATE, 'stats', {})).toBe(false);
    expect(stepAnswered(TEMPLATE, 'stats', { grit: '' })).toBe(false);
    expect(stepAnswered(TEMPLATE, 'stats', { grit: null })).toBe(false);
    expect(stepAnswered(TEMPLATE, 'stats', { grit: 2 })).toBe(false);
    expect(stepAnswered(TEMPLATE, 'stats', { grit: 12 })).toBe(true);
    const anyRange = { ...TEMPLATE, creation: { steps: ['stats'], stats: [{ id: 'a', label: 'A', stats: [{ id: 'grit', label: 'Grit' }] }] } } as unknown as SheetTemplate;
    expect(stepAnswered(anyRange, 'stats', { grit: 0 })).toBe(true);
  });

  it('says what is wrong with a stat: nothing yet, a range, not a number', () => {
    const s = { id: 'grit', label: 'Grit', min: 3, max: 18 };
    expect(statProblem(s, undefined)).toBeNull();
    expect(statProblem(s, '')).toBeNull();
    expect(statProblem(s, null)).toBeNull();
    expect(statProblem(s, 3)).toBeNull();
    expect(statProblem(s, 18)).toBeNull();
    expect(statProblem(s, 2)).toBe('At least 3');
    expect(statProblem(s, 19)).toBe('At most 18');
    expect(statProblem(s, 'x')).toBe('A number');
    expect(statProblem({ id: 'y', label: 'Y' }, 500)).toBeNull();
  });

  it('a list needs its picks', () => {
    expect(stepAnswered(TEMPLATE, 'list:classes', worked({}))).toBe(false);
    expect(stepAnswered(TEMPLATE, 'list:classes', worked({ picks: [{ list: 'classes', option: 'classes_a' }] }))).toBe(true);
  });

  it('counts each pick asked for', () => {
    const two = { ...TEMPLATE, choices: [list({ id: 'classes', picks: 2 })] } as unknown as SheetTemplate;
    expect(stepAnswered(two, 'list:classes', worked({ picks: [{ list: 'classes', option: 'classes_a' }] }))).toBe(false);
    expect(stepAnswered(two, 'list:classes', worked({ picks: [{ list: 'classes', option: 'classes_a' }, { list: 'classes', option: 'classes_b' }] }))).toBe(true);
  });

  it('a list of ANY needs none', () => {
    const any = { ...TEMPLATE, choices: [list({ id: 'classes', picks: 'any' })] } as unknown as SheetTemplate;
    expect(stepAnswered(any, 'list:classes', worked({}))).toBe(true);
  });

  it('never strands them: with nothing they meet, it lets them on', () => {
    expect(stepAnswered(TEMPLATE, 'list:classes', worked({ unmet: ['classes_a', 'classes_b'] }))).toBe(true);
    expect(stepAnswered(TEMPLATE, 'list:classes', worked({ unmet: ['classes_a'] }))).toBe(false);
  });

  it('a feature opening a list waits for its pick, however deep; not one they can\'t make', () => {
    const nest = {
      ...TEMPLATE,
      choices: [
        { ...list({ id: 'classes' }), options: [{ id: 'soldier', label: 'Soldier', features: [{ id: 'spec', label: 'Spec', opens: 'specs' }] }] },
        { ...list({ id: 'specs', picked: 'features' } as never), options: [{ id: 'duelist', label: 'Duelist', features: [{ id: 'style', label: 'Style', opens: 'styles' }] }, { id: 'vanguard', label: 'Vanguard', features: [] }] },
        { ...list({ id: 'styles', picked: 'features' } as never), options: [{ id: 'fast', label: 'Fast', features: [] }] },
      ],
    } as unknown as SheetTemplate;
    const soldier = { list: 'classes', option: 'soldier' };
    const duelist = { list: 'specs', option: 'duelist', from: 'spec' };
    const fast = { list: 'styles', option: 'fast', from: 'style' };
    const data = (over: object) => worked({ picks: [soldier], ...over });
    const open = (used: number) => ({ feature: 'spec', list: 'specs', count: 1, used });
    expect(stepAnswered(nest, 'list:classes', data({ opens: [open(0)] }))).toBe(false);
    expect(stepAnswered(nest, 'list:classes', data({ opens: [open(0)], unmet: ['duelist', 'vanguard'] }))).toBe(true);
    const style = (used: number) => ({ feature: 'style', list: 'styles', count: 1, used });
    expect(stepAnswered(nest, 'list:classes', data({ picks: [soldier, duelist], opens: [open(1), style(0)] }))).toBe(false);
    expect(stepAnswered(nest, 'list:classes', data({ picks: [soldier, duelist, fast], opens: [open(1), style(1)] }))).toBe(true);
  });

  it('a step this code doesn\'t know has nothing to answer', () => {
    expect(stepAnswered(TEMPLATE, 'list:gone', {})).toBe(true);
    expect(stepAnswered(TEMPLATE, 'kits', {})).toBe(true);
  });
});

describe('a fixed array (7c3b)', () => {
  const ARRAY = {
    ...TEMPLATE,
    creation: { steps: ['who', 'stats'], ways: { stats: { way: 'array', numbers: [15, 14] } }, stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'grit', label: 'Grit' }, { id: 'luck', label: 'Luck' }, { id: 'name', label: 'Name' }] }] },
  } as unknown as SheetTemplate;
  const going = { [CREATING_KEY]: { at: 'stats' } };

  it('a step is typed in unless it says', () => {
    expect(stepWay(TEMPLATE, 'stats')).toEqual({ way: 'typed' });
    expect(stepWay(ARRAY, 'stats')).toEqual({ way: 'array', numbers: [15, 14] });
    expect(stepWay(ARRAY, 'stats:other')).toEqual({ way: 'typed' });
  });

  it('answered once each stat holds a number from the pool, without those the GM keeps', () => {
    const two = { ...ARRAY, creation: { ...ARRAY.creation, stats: [{ id: 'a', label: 'A', stats: [{ id: 'grit', label: 'Grit' }, { id: 'luck', label: 'Luck' }] }] } } as unknown as SheetTemplate;
    expect(stepAnswered(two, 'stats', {})).toBe(false);
    expect(stepAnswered(two, 'stats', { grit: 15 })).toBe(true);
    expect(stepAnswered(two, 'stats', { grit: 99 })).toBe(false);
    const hers = { ...two, creation: { ...two.creation, stats: [{ id: 'a', label: 'A', stats: [{ id: 'grit', label: 'Grit' }, { id: 'concept', label: 'C' }] }] } } as unknown as SheetTemplate;
    expect(stepAnswered(hers, 'stats', { grit: 15 })).toBe(false);
    expect(stepAnswered(hers, 'stats', { grit: 15, concept: 15 })).toBe(false);
    expect(stepAnswered(hers, 'stats', { grit: 15, concept: 14 })).toBe(true);
  });

  it('locks those stats on the sheet while it is being made, and no others', () => {
    const fieldsOf = (t: SheetTemplate) => Object.fromEntries(t.sections.flatMap((s) => s.fields).map((f) => [f.id, !!f.gmOnly]));
    const locked = fieldsOf(withCreationLocks(ARRAY, going));
    expect([locked.grit, locked.name, locked.concept]).toEqual([true, true, false]);
    for (const data of [{}, { [CREATING_KEY]: { done: true } }, { name: 'Wren' }]) expect(withCreationLocks(ARRAY, data), JSON.stringify(data)).toBe(ARRAY);
    expect(withCreationLocks(TEMPLATE, going)).toBe(TEMPLATE);
    expect(withCreationLocks({ ...ARRAY, creation: undefined } as unknown as SheetTemplate, going).creation).toBeUndefined();
  });
});

describe('rolled (7c3c)', () => {
  const ROLLED = {
    ...TEMPLATE,
    creation: { steps: ['who', 'stats'], ways: { stats: { way: 'roll', each: '3d6', placed: 'arrange' } }, stats: [{ id: 'a', label: 'A', stats: [{ id: 'grit', label: 'Grit' }, { id: 'concept', label: 'C' }] }] },
  } as unknown as SheetTemplate;
  const with_ = (rolled: unknown, more: object = {}) => ({ [CREATING_KEY]: { at: 'stats', rolled }, ...more });

  it('what a step came to, or nothing yet', () => {
    expect(rolledPool(with_({ stats: [9, 8] }), 'stats')).toEqual([9, 8]);
    expect(rolledPool(with_({ stats: [9, 8] }), 'stats:other')).toBeNull();
    expect(rolledPool(with_('x'), 'stats')).toBeNull();
    expect(rolledPool(with_({ stats: 'x' }), 'stats')).toBeNull();
    expect(rolledPool({}, 'stats')).toBeNull();
  });

  it('answered once rolled and each holds what came up; a number typed earlier doesn\'t count', () => {
    expect(stepAnswered(ROLLED, 'stats', { grit: 9, concept: 8 })).toBe(false);
    expect(stepAnswered(ROLLED, 'stats', with_({ stats: [9, 8] }))).toBe(false);
    expect(stepAnswered(ROLLED, 'stats', with_({ stats: [9, 8] }, { grit: 9 }))).toBe(false);
    expect(stepAnswered(ROLLED, 'stats', with_({ stats: [9, 8] }, { grit: 9, concept: 7 }))).toBe(false);
    expect(stepAnswered(ROLLED, 'stats', with_({ stats: [9, 8] }, { grit: 8, concept: 9 }))).toBe(true);
  });

  it('locks them on the sheet while being made', () => {
    const fields = withCreationLocks(ROLLED, with_({})).sections.flatMap((s) => s.fields);
    expect(fields.find((f) => f.id === 'grit')?.gmOnly).toBe(true);
  });

  it('reads what the server keeps', () => {
    const def = { format: 1, name: 'H', stats: [{ id: 'a', label: 'A', stats: [{ id: 'grit', label: 'Grit' }] }], creation: { on: true, ways: { stats: { way: 'roll', each: '3d6', placed: 'order' } } } };
    const template = { ...TEMPLATE, creation: backend.creationShown(def) } as unknown as SheetTemplate;
    const done = backend.creationAction(def, { [CREATING_KEY]: {} }, { kind: 'roll', step: 'stats' }).data;
    expect(rolledPool(done, 'stats')).toEqual([done.grit]);
    expect(stepAnswered(template, 'stats', done)).toBe(true);
  });
});

describe('held to the server', () => {
  it('counts a number placed as the server does', () => {
    const stats = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const cases: [number[], Record<string, unknown>][] = [[[15, 14, 14], { a: 14, b: 14, c: 99 }], [[15], { a: 15, b: 15 }], [[15], { a: '15' }], [[], {}], [[1, 2], { c: 2, b: 1 }]];
    for (const [pool, data] of cases) expect(placedFrom(pool, stats, data), JSON.stringify(data)).toEqual(backend.placedFrom(pool, stats, data));
  });

  it('tells a step\'s way as the server sends it', () => {
    const def = { format: 1, name: 'H', stats: [{ id: 'a', label: 'A', stats: [{ id: 'grit', label: 'Grit' }] }], creation: { on: true, ways: { stats: { way: 'array', numbers: [9] } } } };
    const template = { ...TEMPLATE, creation: backend.creationShown(def) } as unknown as SheetTemplate;
    expect(stepWay(template, 'stats')).toEqual({ way: 'array', numbers: [9] });
    expect(stepAnswered(template, 'stats', { grit: 9 })).toBe(true);
    expect(stepAnswered(template, 'stats', { grit: 8 })).toBe(false);
  });

  it('reads the same key the server writes, and the steps it sends', () => {
    expect(CREATING_KEY).toBe(backend.CREATING_KEY);
    const def = { format: 1, name: 'H', stats: [{ id: 'a', label: 'A', stats: [{ id: 'grit', label: 'Grit' }] }], choices: [{ id: 'classes', one: 'Class', many: 'Classes', options: [{ id: 'x', label: 'X' }] }], creation: { on: true } };
    const shown = backend.creationShown(def);
    const template = { ...TEMPLATE, choices: [list({ id: 'classes' })], creation: shown } as unknown as SheetTemplate;
    expect(flowSteps(template)).toEqual(['who', 'stats', 'list:classes']);
    expect(statsToSet(template)[0].stats[0].id).toBe('grit');
  });
});
