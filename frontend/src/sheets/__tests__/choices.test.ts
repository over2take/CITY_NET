import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

import {
  LIMITS, choiceLists, picksOf, withNewList, withList, withoutList, withNewOption, withOption, withoutOption, levelNames,
} from '../choices';
import type { Definition } from '../systemsApi';

/**
 * The builder's CHOICES page as logic (7a2b1; approved mockup builder-choices, 2026-10-27): lists and
 * their options made, changed and removed, each result held to the server's own checks
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
