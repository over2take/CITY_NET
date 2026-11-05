import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import {
  CREATING_KEY, flowDone, flowState, flowStepName, flowSteps, isBlankSheet, savedStep, statProblem, statsToSet, stepAnswered, stepListId, whoFields,
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

describe('held to the server', () => {
  it('reads the same key the server writes, and the steps it sends', () => {
    expect(CREATING_KEY).toBe(backend.CREATING_KEY);
    const def = { format: 1, name: 'H', stats: [{ id: 'a', label: 'A', stats: [{ id: 'grit', label: 'Grit' }] }], choices: [{ id: 'classes', one: 'Class', many: 'Classes', options: [{ id: 'x', label: 'X' }] }], creation: { on: true } };
    const shown = backend.creationShown(def);
    const template = { ...TEMPLATE, choices: [list({ id: 'classes' })], creation: shown } as unknown as SheetTemplate;
    expect(flowSteps(template)).toEqual(['who', 'stats', 'list:classes']);
    expect(statsToSet(template)[0].stats[0].id).toBe('grit');
  });
});
