import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

import { pickLabel, workedOn, listShown, spentAfterClick, featureDoes, choiceEffects, pickedOf, listsOnTheirOwn, underFeature, keptAside, WORKED_KEY, type ChoiceListShown } from '../choicesShown';

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
    expect(workedOn({})).toEqual({ picks: [], opens: [], levels: {}, from: {}, uses: {}, unmet: [] });
    expect(workedOn(null).picks).toEqual([]);
    expect(workedOn({ [WORKED_KEY]: { picks: 'soldier', opens: [{ feature: 3 }], uses: [], unmet: [1, 'mage'] } })).toEqual({ picks: [], opens: [], levels: {}, from: {}, uses: {}, unmet: ['mage'] });
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

describe('what the picks do, on the fields (7a3b2)', () => {
  const template = {
    id: 'sys_x', name: 'Hearth', sections: [{ id: 'stats', label: 'STATS', layout: 'grid', fields: [
      { id: 'int', label: 'Intellect', type: 'number' }, { id: 'defense', label: 'Defense', type: 'number', derived: true },
    ] }],
  } as never;

  it('a stat as typed and with its bonus; a formula as saved, bonus in; each named', () => {
    const data = { int: 14, defense: 13, [WORKED_KEY]: { from: { int: [{ feature: 'Sharp', amount: 2 }], defense: [{ feature: 'Guard Stance', amount: 1 }, { feature: 'Ward', amount: 2 }] } } };
    const { fields } = choiceEffects(data, template);
    expect(fields.int).toEqual({ id: 'int', base: 14, value: 16, delta: 2, sources: [{ name: 'Sharp', value: 2, kind: 'stat' }] });
    expect(fields.defense).toMatchObject({ base: 10, value: 13, delta: 3 });
    expect(fields.defense.sources.map((s) => s.name)).toEqual(['Guard Stance', 'Ward']);
  });

  it('the token\'s maximum as the token holds it, bonus in; nothing without a token (7a5a3)', () => {
    const linked = {
      id: 'sys_x', name: 'Hearth', sections: [{ id: 'health', label: 'HEALTH', layout: 'grid', fields: [
        { id: 'hp_max', label: 'HP MAX', type: 'number', source: 'token_hp_max' },
      ] }],
    } as never;
    const from = { hp_max: [{ feature: 'Tough', amount: 6 }] };
    expect(choiceEffects({ hp_max: 26, [WORKED_KEY]: { from } }, linked).fields.hp_max).toMatchObject({ base: 20, value: 26, delta: 6 });
    expect(choiceEffects({ hp_max: null, [WORKED_KEY]: { from } }, linked).fields).toEqual({});
    expect(choiceEffects({ [WORKED_KEY]: { from } }, linked).fields).toEqual({});
  });

  it('nothing for a field the sheet doesn\'t show, or a sheet with no picks', () => {
    expect(choiceEffects({ [WORKED_KEY]: { from: { luck: [{ feature: 'Lucky', amount: 1 }] } } }, template).fields).toEqual({});
    expect(choiceEffects({}, template)).toEqual({ fields: {}, unmatched: [] });
  });
});

describe('lists inside lists, and a list everyone has (7a5a2)', () => {
  const NEST = {
    format: 1, name: 'Nest',
    stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'int', label: 'Intellect' }] }],
    choices: [
      { id: 'classes', one: 'Class', many: 'Classes', levelled: true, options: [
        { id: 'soldier', label: 'Soldier', features: [
          { id: 'specialty', label: 'Specialty', at: 3, choice: 'specs' },
          { id: 'feat_2', label: 'Feat', at: 2, choice: 'feats', choice_count: 2 },
        ] },
      ] },
      { id: 'specs', one: 'Specialty', many: 'Specialties', picked: 'features', options: [{ id: 'duelist', label: 'Duelist' }, { id: 'vanguard', label: 'Vanguard', requires: '@int >= 13' }] },
      { id: 'feats', one: 'Feat', many: 'Feats', picked: 'both', options: [{ id: 'tough', label: 'Tough' }, { id: 'quick', label: 'Quick' }, { id: 'keen', label: 'Keen' }] },
      { id: 'commons', one: 'Common', many: 'Commons', picked: 'everyone', options: [
        { id: 'breath', label: 'Second Wind', features: [{ id: 'b1', label: 'Breath' }, { id: 'b4', label: 'Improvement', at: 4 }] },
        { id: 'strong', label: 'Strong Back', requires: '@int >= 13' },
      ] },
    ],
  };
  const nestLists = backend.choicesShown(NEST) as ChoiceListShown[];
  const list = (id: string) => nestLists.find((l) => l.id === id)!;
  const seen = (stored: Record<string, unknown>) => workedOn({ [WORKED_KEY]: backend.workedOf(NEST, { int: 10, _choices: stored }) });
  const feature = (id: string) => list('classes').options[0].features.find((f) => f.id === id)!;

  it('draws as blocks every list but those picked only under features', () => {
    expect(listsOnTheirOwn(nestLists).map((l) => l.id)).toEqual(['classes', 'feats', 'commons']);
    expect(pickedOf({ ...list('classes'), picked: undefined })).toBe('own');
    // Nothing to pick in its own name, even with none picked.
    expect(listShown(list('specs'), seen({})).room).toBe(false);
  });

  it('under a feature: room while it is unlocked, its picks once made, and a pick waiting when it locks', () => {
    const at3 = underFeature(feature('specialty'), nestLists, seen({ classes: [{ option: 'soldier', level: 3 }] }))!;
    expect([at3.room, at3.picks.length, at3.open.map((o) => [o.option.id, o.unmet])]).toEqual([1, 0, [['duelist', null], ['vanguard', 'INTELLECT >= 13']]]);
    const picked = underFeature(feature('specialty'), nestLists, seen({ classes: [{ option: 'soldier', level: 3 }], specs: [{ option: 'duelist', from: 'specialty' }] }))!;
    expect([picked.room, picked.picks.map((p) => p.option.id), picked.waiting]).toEqual([0, ['duelist'], []]);
    const lowered = underFeature(feature('specialty'), nestLists, seen({ classes: [{ option: 'soldier', level: 2 }], specs: [{ option: 'duelist', from: 'specialty' }] }))!;
    expect([lowered.room, lowered.picks, lowered.waiting.map((o) => o.id)]).toEqual([0, [], ['duelist']]);
    // A list picked on its own has nothing under the feature naming it.
    expect(underFeature({ id: 'x', label: 'X', opens: 'classes' }, nestLists, seen({}))).toBeNull();
  });

  it('a list picked both ways: its own picks in its block, those under features under them, room counted apart', () => {
    const w = seen({ classes: [{ option: 'soldier', level: 2 }], feats: [{ option: 'tough' }, { option: 'quick', from: 'feat_2' }] });
    const view = listShown(list('feats'), w);
    expect([view.picks.map((p) => p.option.id), view.room, view.open.map((o) => o.option.id)]).toEqual([['tough'], false, ['keen']]);
    const under = underFeature(feature('feat_2'), nestLists, w)!;
    expect([under.picks.map((p) => p.option.id), under.room]).toEqual([['quick'], 1]);
  });

  it('keeps aside only what has nothing to wait under', () => {
    expect(keptAside(nestLists, seen({ classes: [{ option: 'soldier', level: 2 }], specs: [{ option: 'duelist', from: 'specialty' }] }))).toEqual([]);
    expect(keptAside(nestLists, seen({ specs: [{ option: 'duelist', from: 'specialty' }] })).map((k) => `${k.list.id}:${k.option.id}`)).toEqual(['specs:duelist']);
  });

  it('a list everyone has: what every character has, unlocked by their level, nothing to pick', () => {
    const at3 = listShown(list('commons'), seen({ classes: [{ option: 'soldier', level: 3 }] }));
    expect([at3.picks.map((p) => [p.option.id, p.level, p.unlocked.map((f) => f.id), p.next?.id]), at3.room]).toEqual([[['breath', null, ['b1'], 'b4']], false]);
    expect(at3.open.map((o) => [o.option.id, o.unmet])).toEqual([['strong', 'INTELLECT >= 13']]);
    const at4 = listShown(list('commons'), seen({ classes: [{ option: 'soldier', level: 4 }] }));
    expect(at4.picks[0].unlocked.map((f) => f.id)).toEqual(['b1', 'b4']);
  });
});

describe('a pick under a feature, at the level of what opened it (7a5d)', () => {
  const FORGE = {
    format: 1, name: 'Forge',
    choices: [
      { id: 'classes', one: 'Class', many: 'Classes', levelled: true, options: [
        { id: 'fighter', label: 'Fighter', features: [{ id: 'martial_archetype', label: 'Martial Archetype', at: 3, choice: 'archetypes' }] },
      ] },
      { id: 'archetypes', one: 'Archetype', many: 'Archetypes', picked: 'features', options: [
        { id: 'champion', label: 'Champion', features: [
          { id: 'superior_critical', label: 'Superior Critical', at: 15 },
          { id: 'improved_critical', label: 'Improved Critical', at: 3 },
          { id: 'remarkable_athlete', label: 'Remarkable Athlete', at: 7 },
        ] },
      ] },
    ],
  };
  const forgeLists = backend.choicesShown(FORGE) as ChoiceListShown[];
  const opener = forgeLists[0].options[0].features[0];
  const at = (level: number) => underFeature(opener, forgeLists, workedOn({ [WORKED_KEY]: backend.workedOf(FORGE, {
    _choices: { classes: [{ option: 'fighter', level }], archetypes: [{ option: 'champion', from: 'martial_archetype' }] } }) }))!.picks[0];

  it('is offered as Pick an Archetype', () => {
    expect([pickLabel('Archetype'), pickLabel('Class'), pickLabel(' item')]).toEqual(['Pick an Archetype', 'Pick a Class', 'Pick an  item']);
  });

  it('has the features up to the Fighter\'s level and names the next, with no level of its own shown', () => {
    expect([at(3).level, at(3).unlocked.map((f) => f.id), at(3).next?.id]).toEqual([null, ['improved_critical'], 'remarkable_athlete']);
    expect([at(7).unlocked.map((f) => f.id), at(7).next?.id]).toEqual([['improved_critical', 'remarkable_athlete'], 'superior_critical']);
    expect([at(15).unlocked.length, at(15).next]).toEqual([3, null]);
  });
});
