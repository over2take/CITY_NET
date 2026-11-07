import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import {
  buyCost, buyShown, CREATING_KEY, gmFlowLine, gmStatsWords, startOverWords, giftRolledOn, giftWords, moneyHeldOn, moneyWords, kitItemsText, kitsShownOn, flowDone, flowState, flowStepName, flowSteps, isBlankSheet, isStatsStep, placedFrom, rolledPool, savedStep, statProblem, statsToSet, stepAnswered, stepListId, stepWay, whoFields, withCreationLocks,
} from '../newCharacterFlow';
import { WORKED_KEY, type ChoiceListShown } from '../choicesShown';
import { clearCustomTemplates, registerCustomTemplate } from '../customTemplates';
import type { SheetTemplate } from '../types';

/**
 * The guided new character at the table, as logic (7c2). Approved mockup new-character (2026-11-03):
 * asked on a blank sheet only, once; a step's NEXT off until it is answered; a name needed, each stat
 * typed in and in range, a list's picks made as far as the requirements let them be.
 */

const req = createRequire(import.meta.url);
const backend = req('../../../../backend/systemBuilder/creation.js');
const chooser = req('../../../../backend/systemBuilder/choices.js');

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

describe('a point buy (7c3d)', () => {
  const FLAT = { way: 'buy' as const, points: 4, lowest: 8, highest: 12 };
  const COSTED = { ...FLAT, points: 5, costs: { 8: 0, 9: 1, 10: 2, 11: 4, 12: 6 } };
  const stats = [{ id: 'a' }, { id: 'b' }];

  it('costs by its table, or 1 for 1 above the lowest', () => {
    expect([8, 11, 12].map((n) => buyCost(FLAT, n))).toEqual([0, 3, 4]);
    expect([8, 11, 12].map((n) => buyCost(COSTED, n))).toEqual([0, 4, 6]);
    expect(buyCost({ ...COSTED, costs: { 8: 0 } }, 9)).toBe(0);
  });

  it('each stat holds the lowest until bought up, or if it holds no such number', () => {
    expect(buyShown(COSTED, stats, {}).held).toEqual({ a: 8, b: 8 });
    expect(buyShown(COSTED, stats, { a: 99, b: 10 }).held).toEqual({ a: 8, b: 10 });
    expect(buyShown(COSTED, stats, { a: 9.5, b: '10' }).held).toEqual({ a: 8, b: 8 });
    expect(buyShown(COSTED, stats, { a: 12 }).held.a).toBe(12);
    expect(buyShown(COSTED, stats, null).spent).toBe(0);
  });

  it('says the points spent and left', () => {
    const s = buyShown(COSTED, stats, { a: 11, b: 9 });
    expect([s.spent, s.left]).toEqual([5, 0]);
    expect(buyShown(COSTED, stats, { a: 12, b: 12 }).left).toBe(-7);
  });

  it('goes down to the lowest, up to the highest, as far as the points go', () => {
    const start = buyShown(COSTED, stats, { a: 8, b: 11 });
    expect(start.canLower('a')).toBe(false);
    expect(start.canLower('b')).toBe(true);
    expect(start.canRaise('a')).toBe(true);
    expect(start.canRaise('b')).toBe(false);
    expect(buyShown(COSTED, stats, { a: 10, b: 8 }).canRaise('a')).toBe(true);
    expect(buyShown({ ...FLAT, points: 100 }, stats, { a: 12 }).canRaise('a')).toBe(false);
  });

  it('answered with points left over, not with too many spent', () => {
    const template = { ...TEMPLATE, creation: { steps: ['stats'], ways: { stats: COSTED }, stats: [{ id: 'g', label: 'G', stats: [{ id: 'grit', label: 'Grit' }, { id: 'concept', label: 'C' }] }] } } as unknown as SheetTemplate;
    expect(stepAnswered(template, 'stats', {})).toBe(true);
    expect(stepAnswered(template, 'stats', { grit: 11, concept: 9 })).toBe(true);
    expect(stepAnswered(template, 'stats', { grit: 12, concept: 12 })).toBe(false);
  });

  it('counts as the server does', () => {
    const def = (way: object) => ({ format: 1, name: 'H', stats: [{ id: 'g', label: 'G', stats: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }] }], creation: { on: true, ways: { stats: way } } });
    const at = { [CREATING_KEY]: { at: 'stats' } };
    for (const way of [FLAT, COSTED]) {
      for (const data of [{ a: 8, b: 8 }, { a: 10, b: 9 }, { a: 11, b: 8 }, { a: 12, b: 8 }, { a: 99, b: 11 }]) {
        const view = buyShown(way, stats, data);
        const canAfford = backend.creationAction(def(way), { ...data, ...at }, { kind: 'buy', step: 'stats', stat: 'b', value: view.held.b + 1 });
        expect(view.canRaise('b'), JSON.stringify([way.points, data])).toBe(canAfford.ok);
      }
    }
  });
});

describe('kits (7c4b)', () => {
  const KITS = [
    { id: 'essentials', name: 'ESSENTIALS', items: [{ name: 'Knife', qty: 1 }], who: 'all' },
    { id: 'traveler', name: 'TRAVELER', items: [{ name: 'Rope', qty: 1 }, { name: 'Rations', qty: 3 }], who: 'pick' },
    { id: 'potions', name: 'POTION MAKER', items: [{ name: 'Mortar', qty: 1 }], who: 'needs', needs: 'WITS >= 12' },
  ];
  const kitted = (kits: unknown[] = KITS) => ({ ...TEMPLATE, creation: { steps: ['who', 'kits'], stats: [], kits } }) as unknown as SheetTemplate;
  const on = (kit?: string, unmet: string[] = []) => ({ [CREATING_KEY]: { at: 'kits', ...(kit ? { kit } : {}) }, ...worked({ kitsUnmet: unmet }) });

  it('names the step, and says the items', () => {
    expect(flowStepName(kitted(), 'kits')).toBe('KITS');
    expect(flowSteps(kitted())).toEqual(['who', 'kits']);
    expect(kitItemsText(KITS[1].items as { name: string; qty: number }[])).toBe('Rope, 3x Rations');
  });

  it('splits what everyone gets from what is offered, saying what one still needs', () => {
    const shown = kitsShownOn(kitted(), on(undefined, ['potions']));
    expect(shown.everyone.map((k) => k.id)).toEqual(['essentials']);
    expect(shown.offered.map((o) => [o.kit.id, o.unmet])).toEqual([['traveler', null], ['potions', 'WITS >= 12']]);
    expect(shown.picked).toBeNull();
    expect(kitsShownOn(kitted(), on('traveler')).picked?.kit.id).toBe('traveler');
    expect(kitsShownOn(kitted(), on('essentials')).picked).toBeNull();
    expect(kitsShownOn(kitted(), on('gone')).picked).toBeNull();
  });

  it('says a requirement even if its words are missing', () => {
    const bare = kitted([{ id: 'x', name: 'X', items: [], who: 'needs' }]);
    expect(kitsShownOn(bare, on(undefined, ['x'])).offered[0].unmet).toBe('a requirement');
  });

  it('with no kits worked out, nothing is unmet, and no template has none', () => {
    expect(kitsShownOn(kitted(), {}).offered.every((o) => !o.unmet)).toBe(true);
    expect(kitsShownOn(TEMPLATE, {}).offered).toEqual([]);
  });

  it('answered with a pick that is met, or with none in reach; not while one can be made', () => {
    expect(stepAnswered(kitted(), 'kits', on())).toBe(false);
    expect(stepAnswered(kitted(), 'kits', on('traveler'))).toBe(true);
    expect(stepAnswered(kitted(), 'kits', on('potions', ['potions']))).toBe(false);
    expect(stepAnswered(kitted([KITS[0]]), 'kits', on())).toBe(true);
    expect(stepAnswered(kitted([KITS[0], KITS[2]]), 'kits', on(undefined, ['potions']))).toBe(true);
    expect(stepAnswered(kitted([KITS[0], KITS[2]]), 'kits', on())).toBe(false);
  });

  it('reads what the server sends and works out', () => {
    const def = { format: 1, name: 'H', stats: [{ id: 'a', label: 'A', stats: [{ id: 'wits', label: 'Wits' }] }], creation: { on: true, kits: [
      { id: 'potions', name: 'POTION MAKER', items: [{ name: 'Mortar', qty: 1 }], who: 'needs', requires: '@wits >= 12' },
    ] } };
    const template = { ...TEMPLATE, creation: backend.creationShown(def) } as unknown as SheetTemplate;
    const worked_ = req('../../../../backend/systemBuilder/choices.js').workedOf(def, { wits: 3 });
    expect(kitsShownOn(template, { [WORKED_KEY]: worked_ }).offered[0].unmet).toBe('WITS >= 12');
    expect(stepAnswered(template, 'kits', { [WORKED_KEY]: worked_ })).toBe(true);
  });
});

describe('starting money (7c4d)', () => {
  const moneyed = (money: unknown[]) => ({ ...TEMPLATE, creation: { steps: ['who', 'money'], stats: [], money } }) as unknown as SheetTemplate;
  const held = (money: unknown) => ({ [CREATING_KEY]: { at: 'money', money } });

  it('reads what is held, or nothing', () => {
    expect(moneyHeldOn(held({ gold: 12 }), 'gold')).toBe(12);
    expect(moneyHeldOn(held({ gold: 0 }), 'gold')).toBe(0);
    expect(moneyHeldOn(held({ gold: 12 }), 'honor')).toBeNull();
    expect(moneyHeldOn(held({ gold: 'x' }), 'gold')).toBeNull();
    expect(moneyHeldOn(held('x'), 'gold')).toBeNull();
    expect(moneyHeldOn({}, 'gold')).toBeNull();
  });

  it('answered once each roll is rolled and each amount said; a number needs nothing', () => {
    const t = moneyed([{ id: 'gold', name: 'Gold', how: 'roll', each: '3d6' }, { id: 'honor', name: 'Honor', how: 'typed' }, { id: 'tin', name: 'Tin', how: 'number', amount: 5 }]);
    expect(stepAnswered(t, 'money', held({}))).toBe(false);
    expect(stepAnswered(t, 'money', held({ gold: 120 }))).toBe(false);
    expect(stepAnswered(t, 'money', held({ gold: 120, honor: 0 }))).toBe(true);
    expect(stepAnswered(moneyed([{ id: 'tin', name: 'Tin', how: 'number', amount: 5 }]), 'money', {})).toBe(true);
    expect(flowStepName(t, 'money')).toBe('MONEY');
    expect(flowSteps(t)).toEqual(['who', 'money']);
  });

  it('reads what the server keeps', () => {
    const def = { format: 1, name: 'H', creation: { on: true, money: { main: { how: 'typed' } } } };
    const template = { ...TEMPLATE, creation: backend.creationShown(def) } as unknown as SheetTemplate;
    const done = backend.creationAction(def, { [CREATING_KEY]: {} }, { kind: 'moneyTyped', id: 'main', amount: 7 }).data;
    expect(moneyHeldOn(done, 'main')).toBe(7);
    expect(stepAnswered(template, 'money', done)).toBe(true);
  });
});

describe('what an option gives (7c4e)', () => {
  const roll = { id: 'gold', name: 'Gold', how: 'roll', each: '3d6 * 10' };
  const giving = list({ id: 'bgs', one: 'Background', options: [
    { id: 'noble', label: 'Noble', gives: { items: [{ name: 'Rope', qty: 1 }, { name: 'Rations', qty: 3 }], money: [roll, { id: 'honor', name: 'Honor', how: 'number', amount: 5 }] }, features: [{ id: 'armed', label: 'Armed', opens: 'weapons' }] },
    { id: 'plain', label: 'Plain', features: [] },
  ] as never });
  const weapons = list({ id: 'weapons', picked: 'features', options: [{ id: 'sword', label: 'Sword', gives: { money: [{ ...roll, id: 'honor' }] }, features: [] }] as never });
  const t = { ...TEMPLATE, choices: [giving, weapons], creation: { steps: ['who', 'list:bgs'], stats: [] } } as unknown as SheetTemplate;
  const on = (picks: object[], gifts?: object, opens: object[] = []) => ({ ...worked({ picks, opens }), [CREATING_KEY]: { at: 'list:bgs', ...(gifts ? { gifts } : {}) } });
  const NOBLE = { list: 'bgs', option: 'noble' };
  const SWORD = { list: 'weapons', option: 'sword', from: 'armed' };

  it('reads what an option rolled, or nothing', () => {
    expect(giftRolledOn(on([], { noble: { gold: 12 } }), 'noble', 'gold')).toBe(12);
    expect(giftRolledOn(on([], { noble: { gold: 0 } }), 'noble', 'gold')).toBe(0);
    expect(giftRolledOn(on([], { noble: { gold: 12 } }), 'noble', 'honor')).toBeNull();
    expect(giftRolledOn(on([], { noble: { gold: 12 } }), 'plain', 'gold')).toBeNull();
    expect(giftRolledOn(on([], { noble: { gold: 'x' } }), 'noble', 'gold')).toBeNull();
    expect(giftRolledOn(on([], { noble: 'x' }), 'noble', 'gold')).toBeNull();
    expect(giftRolledOn(on([], 'x' as never), 'noble', 'gold')).toBeNull();
    expect(giftRolledOn({}, 'noble', 'gold')).toBeNull();
  });

  it('says it in a line: items, then each money', () => {
    expect(giftWords({ items: [{ name: 'Rope', qty: 1 }, { name: 'Rations', qty: 3 }], money: [roll as never, { id: 'main', name: 'Money', how: 'number', amount: 5 }] }, null)).toBe('Rope, 3x Rations · Gold: 3d6 * 10 · Money: 5');
    expect(giftWords({ items: [{ name: 'Rope', qty: 1 }] }, null)).toBe('Rope');
    expect(giftWords({ money: [{ id: 'main', name: 'Money', how: 'number' }] }, null)).toBe('Money: 0');
  });

  it('an amount as the currency says it, or the app\'s money as a number', () => {
    expect(moneyWords(null, 'main', 120)).toBe('120');
    registerCustomTemplate({ id: 'sys_0123456789abcdef', name: 'G', words: {}, parts: {}, derived: [], currencies: [{ id: 'gold', name: 'Gold', short: 'gp', decimals: 0, decimalMark: '.', debt: false, negative: false, denominations: [] }] } as never);
    expect(moneyWords('sys_0123456789abcdef', 'gold', 120)).toBe('120 gp');
    expect(moneyWords('sys_0123456789abcdef', 'tin', 120)).toBe('120');
    clearCustomTemplates();
  });

  it('a step holds until each picked option\'s money is rolled; a number needs nothing', () => {
    expect(stepAnswered(t, 'list:bgs', on([{ list: 'bgs', option: 'plain' }]))).toBe(true);
    expect(stepAnswered(t, 'list:bgs', on([NOBLE]))).toBe(false);
    expect(stepAnswered(t, 'list:bgs', on([NOBLE], { noble: { gold: 120 } }))).toBe(true);
    // Another option's roll isn't this one's.
    expect(stepAnswered(t, 'list:bgs', on([NOBLE], { plain: { gold: 120 } }))).toBe(false);
    // Rolled, even to nothing.
    expect(stepAnswered(t, 'list:bgs', on([NOBLE], { noble: { gold: 0 } }))).toBe(true);
  });

  it('and for a pick under a feature, however deep', () => {
    const opens = [{ feature: 'armed', list: 'weapons', count: 1, used: 1 }];
    expect(stepAnswered(t, 'list:bgs', on([NOBLE, SWORD], { noble: { gold: 1 } }, opens))).toBe(false);
    expect(stepAnswered(t, 'list:bgs', on([NOBLE, SWORD], { noble: { gold: 1 }, sword: { honor: 2 } }, opens))).toBe(true);
    // The pick above it rolled last holds it just the same.
    expect(stepAnswered(t, 'list:bgs', on([NOBLE, SWORD], { sword: { honor: 2 } }, opens))).toBe(false);
  });

  it('reads what the server keeps, and sends', () => {
    const def = { format: 1, name: 'H', choices: [{ id: 'bgs', one: 'B', many: 'Bs', options: [{ id: 'noble', label: 'Noble', gives: { money: { main: { how: 'roll', each: '1d6' } } } }] }], creation: { on: true } };
    const shown = chooser.choicesShown(def);
    const template = { ...TEMPLATE, choices: shown, creation: backend.creationShown(def) } as unknown as SheetTemplate;
    const start = { [chooser.PICKS_KEY]: { bgs: [{ option: 'noble' }] }, [CREATING_KEY]: {} };
    const data = (d: object) => ({ ...d, [WORKED_KEY]: { ...chooser.workedOf(def, d), recovery: null } });
    expect(stepAnswered(template, 'list:bgs', data(start))).toBe(false);
    const done = backend.creationAction(def, start, { kind: 'giftRoll', option: 'noble', id: 'main' }, { rng: () => 0 }).data;
    expect(giftRolledOn(done, 'noble', 'main')).toBe(1);
    expect(stepAnswered(template, 'list:bgs', data(done))).toBe(true);
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

describe('the GM\'s line on a player\'s sheet (7c5)', () => {
  const at = (place: object, more: object = {}) => ({ ...more, [CREATING_KEY]: place });
  const on = (data: Record<string, unknown>) => gmFlowLine(TEMPLATE as unknown as SheetTemplate, data);

  it('says nothing with the flow off, or for a character never asked', () => {
    expect(gmFlowLine({ ...TEMPLATE, creation: undefined } as unknown as SheetTemplate, at({ at: 'who' }))).toBeNull();
    expect(gmFlowLine(null, {})).toBeNull();
    expect(on({ name: 'Old Hand' })).toBeNull();
  });

  it('a blank sheet: not opened yet, with nothing to start over', () => {
    expect(on({})).toEqual({ words: 'CREATING · NOT OPENED YET', canSkip: true, canStartOver: false });
  });

  it('started over: asked again, whatever stayed on the sheet', () => {
    expect(on(at({ restarted: true }, { notes: 'Mine' }))).toEqual({ words: 'CREATING · STARTED OVER, NOT OPENED YET', canSkip: true, canStartOver: false });
  });

  it('opened, not begun', () => {
    expect(on(at({}))).toEqual({ words: 'CREATING · OPENED, NOT BEGUN', canSkip: true, canStartOver: true });
  });

  it('says which step of how many, by the steps they are really asked', () => {
    expect(on(at({ at: 'stats' }))).toEqual({ words: 'CREATING · STEP 2 OF 3 · THE STATS', canSkip: true, canStartOver: true });
    expect(on(at({ at: 'gone' }))?.words).toBe('CREATING · STEP 1 OF 3 · WHO THEY ARE');
  });

  it('done, it says how, and only START OVER is left', () => {
    expect(on(at({ done: true }))).toEqual({ words: 'NEW CHARACTER · FINISHED', canSkip: false, canStartOver: true });
    expect(on(at({ done: true, uploaded: true }))?.words).toBe('NEW CHARACTER · UPLOADED');
    expect(on(at({ done: true, skipped: true }))?.words).toBe('NEW CHARACTER · SKIPPED BY THE GM');
  });
});

describe('started over by the GM (7c5)', () => {
  it('asks again as a blank sheet does, whatever stayed on the sheet', () => {
    expect(flowState(TEMPLATE as unknown as SheetTemplate, { notes: 'Mine', [CREATING_KEY]: { restarted: true } })).toBe('new');
    expect(flowDone({ [CREATING_KEY]: { restarted: true } })).toBe(false);
  });
});

describe('what START OVER warns of (7c5)', () => {
  const CLEARS = 'Clears their name, stats, picks and rolls, and asks them again. The rest of the sheet and their portrait stay.';
  const words = (place: object) => startOverWords({ [CREATING_KEY]: place }, null);

  it('nothing handed out yet: only what it clears', () => {
    expect(words({ at: 'stats' })).toBe(CLEARS);
    expect(words({ done: true, uploaded: true })).toBe(CLEARS);
    expect(words({ done: true, skipped: true })).toBe(CLEARS);
    expect(words({ done: true, given: { items: [], pay: [] } })).toBe(CLEARS);
  });

  it('finished: says exactly what comes back, and how far', () => {
    expect(words({ done: true, given: { items: [{ name: 'Rope', qty: 1 }, { name: 'Rations', qty: 3 }], pay: [{ id: null, amount: 50 }] } }))
      .toBe(`${CLEARS} It also takes back what FINISH gave: Rope, 3x Rations, 50. An item they no longer have is passed over, and money stops at 0.`);
    expect(words({ done: true, given: { items: [], pay: [{ id: null, amount: 7 }] } })).toContain('gave: 7. An item');
  });

  it('finished before it was recorded: says it stays', () => {
    expect(words({ done: true })).toBe(`${CLEARS} They finished before what FINISH gives was recorded, so what they were given stays.`);
  });
});

describe('what filling in says on a stats step (7c5)', () => {
  it('says what the game would give, with the boxes open whatever it is', () => {
    expect(gmStatsWords({ way: 'typed' }, null)).toBe('Type in what they have.');
    expect(gmStatsWords({ way: 'array', numbers: [15, 14] }, null)).toBe('This game places 15, 14. Type what you like.');
    expect(gmStatsWords({ way: 'buy', points: 20, lowest: 8, highest: 15 }, null)).toBe('This game buys them: 20 points, 8 to 15. Type what you like.');
    expect(gmStatsWords({ way: 'roll', each: '3d6', placed: 'order' }, null)).toBe('3d6 for each stat, or type what you like.');
    expect(gmStatsWords({ way: 'roll', each: '3d6', placed: 'order' }, [9, 11])).toBe('Rolled 9, 11. Type what you like, or clear it to roll again.');
  });
});
