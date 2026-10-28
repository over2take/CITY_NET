import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

import { workedOn, listShown, spentAfterClick, featureDoes, WORKED_KEY, type ChoiceListShown } from '../choicesShown';

/**
 * A character's picks on their sheet, as logic (7a3b1): the server's worked-out view read safely, each
 * list drawn from it (picks, levels, unlocked features, the next to come, room, what isn't met), held
 * to the server's own shapes (backend choices.js choicesShown and workedOf).
 */

const req = createRequire(import.meta.url);
const backend = req('../../../../backend/systemBuilder/choices.js');

const HEARTH = {
  format: 1, name: 'Hearth',
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'int', label: 'Intellect' }] }],
  derived: [{ id: 'defense', label: 'Defense', formula: '10' }],
  rolls: [{ id: 'spark', label: 'Spark', dice: [{ count: '1', sides: 10 }] }],
  choices: [
    { id: 'classes', one: 'Class', many: 'Classes', levelled: true, again: true, options: [
      { id: 'soldier', label: 'Soldier', description: 'Trained to fight.', features: [
        { id: 'veteran', label: 'Veteran', at: 5 },
        { id: 'guard', label: 'Guard Stance', modifiers: [{ target: 'defense', amount: '1' }] },
        { id: 'rally', label: 'Rally', uses: { count: '2', refill: 'short_rest' }, text: 'Catch your breath.' },
        { id: 'specialty', label: 'Specialty', at: 3, choice: 'paths' },
      ] },
      { id: 'mage', label: 'Mage', requires: '@int >= 13', features: [{ id: 'spark_f', label: 'Spark', rolls: ['spark'] }] },
    ] },
    { id: 'paths', one: 'Path', many: 'Paths', options: [{ id: 'duelist', label: 'Duelist' }] },
  ],
};
const lists = backend.choicesShown(HEARTH) as ChoiceListShown[];
const worked = (data: Record<string, unknown>) => workedOn({ [WORKED_KEY]: backend.workedOf(HEARTH, data) });

describe('the server\'s worked-out view', () => {
  it('read as the server writes it', () => {
    const w = worked({ int: 10, _choices: { classes: [{ option: 'soldier', level: 3 }] }, _uses: { rally: 1 } });
    expect(w.picks).toEqual([{ list: 'classes', option: 'soldier', level: 3 }]);
    expect(w.uses).toEqual({ rally: { max: 2, spent: 1 } });
    expect(w.unmet).toEqual(['mage']);
  });

  it('empty when a sheet has none yet, or something else is there', () => {
    expect(workedOn({})).toEqual({ picks: [], levels: {}, from: {}, uses: {}, unmet: [] });
    expect(workedOn(null).picks).toEqual([]);
    expect(workedOn({ [WORKED_KEY]: { picks: 'soldier', uses: [], unmet: [1, 'mage'] } })).toEqual({ picks: [], levels: {}, from: {}, uses: {}, unmet: ['mage'] });
  });
});

describe('a list on the sheet', () => {
  it('each pick with its level, the features it has by level, and the next to come', () => {
    const view = listShown(lists[0], worked({ _choices: { classes: [{ option: 'soldier', level: 3 }] } }));
    expect(view.picks.map((p) => [p.option.id, p.level, p.unlocked.map((f) => f.id), p.next?.id])).toEqual([['soldier', 3, ['guard', 'rally', 'specialty'], 'veteran']]);
    expect(view.level).toBe(3);
  });

  it('levels added up, and said how', () => {
    const view = listShown(lists[0], worked({ int: 14, _choices: { classes: [{ option: 'soldier', level: 3 }, { option: 'mage', level: 1 }] } }));
    expect([view.level, view.breakdown]).toEqual([4, 'SOLDIER 3 + MAGE 1']);
  });

  it('what is left to pick, one not met saying what it needs; room while the list allows more', () => {
    const view = listShown(lists[0], worked({ int: 10, _choices: { classes: [{ option: 'soldier', level: 1 }] } }));
    expect(view.open).toEqual([{ option: lists[0].options[1], unmet: 'INTELLECT >= 13' }]);
    expect(view.room).toBe(true);
    const paths = listShown(lists[1], worked({ _choices: { paths: ['duelist'] } }));
    expect([paths.room, paths.open, paths.level, paths.picks[0].level]).toEqual([false, [], null, null]);
  });

  it('a pick of an option the list no longer has is left out', () => {
    const view = listShown(lists[0], workedOn({ [WORKED_KEY]: { picks: [{ list: 'classes', option: 'gone', level: 2 }] } }));
    expect(view.picks).toEqual([]);
  });
});

describe('uses and what a feature does', () => {
  it('a pip spends up to it, or takes back from it', () => {
    expect(spentAfterClick(0, 0)).toBe(1);
    expect(spentAfterClick(1, 0)).toBe(2);
    expect(spentAfterClick(0, 2)).toBe(0);
    expect(spentAfterClick(1, 2)).toBe(1);
  });

  it('in a few words', () => {
    const soldier = lists[0].options[0].features;
    expect(featureDoes(soldier.find((f) => f.id === 'guard')!, lists)).toEqual(['+ DEFENSE']);
    expect(featureDoes(soldier.find((f) => f.id === 'specialty')!, lists)).toEqual(['PICK PATH']);
    expect(featureDoes(lists[0].options[1].features[0], lists)).toEqual(['ROLL SPARK']);
    expect(featureDoes(soldier.find((f) => f.id === 'rally')!, lists)).toEqual([]);
  });
});
