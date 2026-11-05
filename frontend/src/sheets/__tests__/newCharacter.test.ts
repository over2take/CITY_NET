/**
 * The builder's NEW CHARACTER page as logic (7c1). Held to the server (backend/systemBuilder/creation.js),
 * so what the page writes is what the server takes and reads the same.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { buyNumbers, buyPreset, buyWith, buyWithCost, climbingCosts, creationOn, creationSteps, kitItemsText, kitsOf, parseKitItems, withKit, withNewKit, withoutKit, groupLeftOut, orderNotes, parseNumbers, parseStatRoll, statsByGroup, stepGroup, stepList, stepName, stepWayProblems, wayOfStep, withCreationOn, withStatsByGroup, withStepMoved, withStepOff, withStepWay } from '../newCharacter';
import { OTHER_NAMES } from '../versionPreview';
import type { Definition } from '../systemsApi';

const req = createRequire(import.meta.url);
const server = req('../../../../backend/systemBuilder/creation.js');
const { checkDefinition } = req('../../../../backend/systemBuilder/definition.js');
const { OTHER } = req('../../../../backend/systemBuilder/versionDiff.js');

const HEARTH = {
  format: 1, name: 'Hearth',
  stats: [{ id: 'traits', label: 'TRAITS', stats: [{ id: 'grit', label: 'Grit' }] }],
  choices: [
    { id: 'classes', one: 'Class', many: 'Classes', options: [{ id: 'soldier', label: 'Soldier' }, { id: 'mage', label: 'Mage', requires: '@grit >= 13' }] },
    { id: 'backgrounds', one: '', many: 'Backgrounds', options: [{ id: 'dockhand', label: 'Dockhand', requires: 'has(soldier)' }] },
    { id: 'specs', one: 'Spec', many: 'Specs', picked: 'features', options: [] },
  ],
} as unknown as Definition;
const GROUPS = {
  ...HEARTH,
  stats: [
    { id: 'abilities', label: 'Abilities', stats: [{ id: 'grit', label: 'Grit' }] },
    { id: 'skills', label: 'SKILLS', stats: [{ id: 'climb', label: 'Climb' }] },
    { id: 'empty', label: 'EMPTY', stats: [] },
  ],
} as unknown as Definition;
const ids = (def: Definition) => creationSteps(def).map((s) => s.id);
const off = (def: Definition) => creationSteps(def).filter((s) => s.off).map((s) => s.id);

describe('held to the server', () => {
  it('reads every system as the server does', () => {
    const cases: Definition[] = [
      HEARTH,
      { format: 1, name: 'Bare' } as Definition,
      { ...HEARTH, parts: { bank: { on: false } } } as Definition,
      { ...HEARTH, creation: { on: true, order: ['money', 'who', 'gone', 'who'], off: ['kits', 'who', 'gone'] } } as Definition,
      { ...HEARTH, creation: { order: ['who', 'stats', 'kits', 'money'] } } as Definition,
      { ...HEARTH, creation: 'on' } as unknown as Definition,
      { ...HEARTH, choices: [{ id: 'feats', one: 'Feat', many: 'Feats', picked: 'both', options: [] }] } as unknown as Definition,
      GROUPS,
      { ...GROUPS, creation: { statsBy: 'group' } } as unknown as Definition,
      { ...GROUPS, creation: { statsBy: 'group', order: ['list:classes', 'stats', 'who'], off: ['stats:skills'] } } as unknown as Definition,
      { ...GROUPS, creation: { order: ['who', 'stats:skills', 'stats:abilities', 'stats:gone', 'list:classes'], off: ['stats:skills'] } } as unknown as Definition,
      { ...GROUPS, creation: { statsBy: 'group', order: ['stats:skills', 'who', 'list:classes'] } } as unknown as Definition,
      { ...GROUPS, creation: { statsBy: 'all' } } as unknown as Definition,
      { format: 1, name: 'Bare', creation: { statsBy: 'group' } } as unknown as Definition,
    ];
    for (const def of cases) {
      expect({ on: creationOn(def), steps: creationSteps(def) }, JSON.stringify(def.creation)).toEqual(server.creationOf(def));
    }
  });

  it('what it writes, the server takes, and the version preview names it', () => {
    const def = withStepOff(withStepMoved(withCreationOn(HEARTH, true), 'kits', -1), 'money', true);
    expect(checkDefinition(def).problems.filter((p: { where: string }) => p.where.startsWith('creation'))).toEqual([]);
    expect(OTHER.filter((k: string) => !OTHER_NAMES[k])).toEqual([]);
    const groups = withStepOff(withStepMoved(withStatsByGroup(GROUPS, true), 'stats:skills', -1), 'stats:abilities', true);
    expect(checkDefinition(groups).problems.filter((p: { where: string }) => p.where.startsWith('creation'))).toEqual([]);
  });
});

describe('a fixed array (7c3b)', () => {
  const array = (numbers: number[]) => ({ way: 'array' as const, numbers });

  it('a step is typed in to start, and typed in again leaves nothing behind', () => {
    expect(wayOfStep(GROUPS, 'stats')).toEqual({ way: 'typed' });
    const set = withStepWay(GROUPS, 'stats', array([15, 14]));
    expect(set.creation).toEqual({ ways: { stats: array([15, 14]) } });
    expect(wayOfStep(set, 'stats')).toEqual(array([15, 14]));
    expect(withStepWay(set, 'stats', { way: 'typed' })).toEqual(GROUPS);
  });

  it('each step keeps its own, through changing how the stats are asked', () => {
    const both = withStepWay(withStepWay(GROUPS, 'stats', array([1, 2])), 'stats:skills', array([3]));
    expect(wayOfStep(both, 'stats:skills')).toEqual(array([3]));
    expect(wayOfStep(withStatsByGroup(both, true), 'stats')).toEqual(array([1, 2]));
    expect(withStepWay(both, 'stats', { way: 'typed' }).creation).toEqual({ ways: { 'stats:skills': array([3]) } });
  });

  it('what isn\'t a way reads as typed in, as the server does', () => {
    for (const ways of ['array', { stats: 'array' }, { stats: { way: 'dice' } }, { stats: { way: 'array', numbers: 'x' } }]) {
      expect(wayOfStep({ ...GROUPS, creation: { ways } } as unknown as Definition, 'stats'), JSON.stringify(ways)).toEqual({ way: 'typed' });
    }
  });

  it('reads numbers with commas between them, or not at all', () => {
    expect(parseNumbers('15, 14,13 , -2')).toEqual([15, 14, 13, -2]);
    expect(parseNumbers('')).toEqual([]);
    expect(parseNumbers('15, 14,')).toEqual([15, 14]);
    for (const bad of ['15 14', 'a', '1.5', '1,b', '--2']) expect(parseNumbers(bad), bad).toBeNull();
  });

  it('says what is wrong in the server\'s words, for what the server reads', () => {
    const sheet = { sections: [{ id: 's', label: 'S', layout: 'grid', fields: [{ id: 'climb', label: 'Climb', type: 'number', edit: 'gm' }] }] };
    const ranged = { ...GROUPS, stats: [{ id: 'abilities', label: 'A', stats: [{ id: 'grit', label: 'Grit', min: 3, max: 18 }, { id: 'wits' }] }, { id: 'skills', label: 'S', stats: [{ id: 'climb', label: 'Climb' }] }] } as unknown as Definition;
    const cases: [Definition, string][] = [
      [GROUPS, 'stats'],
      [withStepWay(GROUPS, 'stats', array([])), 'stats'],
      [withStepWay(GROUPS, 'stats', array([1])), 'stats'],
      [withStepWay(GROUPS, 'stats', array([1, 2])), 'stats'],
      [withStepOff(withStepWay(GROUPS, 'stats', array([1])), 'stats:skills', true), 'stats'],
      [withStepWay(withStatsByGroup(GROUPS, true), 'stats:skills', array([])), 'stats:skills'],
      [withStepWay(ranged, 'stats', array([19, 2, 18, 19, 3])), 'stats'],
      [{ ...withStepWay(GROUPS, 'stats', array([1])), sheet } as unknown as Definition, 'stats'],
    ];
    for (const [def, id] of cases) expect(stepWayProblems(def, id), JSON.stringify(def.creation)).toEqual(server.stepWayProblems(def, id));
    expect(stepWayProblems(withStepWay(GROUPS, 'stats', array([1])), 'stats')).toEqual(['1 number for 2 stats: each stat needs one']);
    expect(stepWayProblems(GROUPS, 'stats')).toEqual([]);
  });

  it('what it writes, the server takes', () => {
    const def = withStepWay(GROUPS, 'stats', array([15, 14]));
    expect(checkDefinition(def).problems.filter((p: { where: string }) => p.where.startsWith('creation'))).toEqual([]);
  });
});

describe('rolled (7c3c)', () => {
  const roll = (each = '4d6 drop lowest', placed: 'order' | 'arrange' = 'arrange') => ({ way: 'roll' as const, each, placed });

  it('reads a roll as the server does', () => {
    for (const text of ['3d6', '4d6 drop lowest', ' 5D6  DROP HIGHEST 2 ', '2d6 + 6', '2d6-1', 'd20', '4d6 drop lowest + 1', '20d100 + 1000', '', 'four', '4d', '0d6', '21d6', '4d1', '4d101', '4d6 drop', '4d6 drop lowest 4', '4d6 drop lowest 0', '1d6 drop lowest', '2d6 + 1001', '2d6 * 10']) {
      expect(parseStatRoll(text), text).toEqual(server.parseStatRoll(text));
    }
  });

  it('a step keeps its roll, reading as the server does; what isn\'t one reads as typed in', () => {
    const set = withStepWay(GROUPS, 'stats', roll());
    expect(wayOfStep(set, 'stats')).toEqual(roll());
    expect(wayOfStep({ ...GROUPS, creation: { ways: { stats: { way: 'roll', each: 3 } } } } as unknown as Definition, 'stats')).toEqual({ way: 'typed' });
    expect(checkDefinition(set).problems.filter((p: { where: string }) => p.where.startsWith('creation'))).toEqual([]);
    expect(withStepWay(set, 'stats', { way: 'typed' })).toEqual(GROUPS);
  });

  it('says what is wrong in the server\'s words', () => {
    const ranged = { ...GROUPS, stats: [{ id: 'g', label: 'G', stats: [{ id: 'a', label: 'Aim', min: 3, max: 18 }, { id: 'b', min: 5, max: 12 }] }] } as unknown as Definition;
    for (const def of [
      withStepWay(GROUPS, 'stats', roll('lots')),
      withStepWay(GROUPS, 'stats', roll('')),
      withStepWay(ranged, 'stats', roll('3d6')),
      withStepWay(ranged, 'stats', roll('4d6 drop lowest + 1')),
      withStepWay(ranged, 'stats', roll('2d6 + 3')),
    ]) expect(stepWayProblems(def, 'stats'), JSON.stringify(def.creation)).toEqual(server.stepWayProblems(def, 'stats'));
    expect(stepWayProblems(withStepWay(ranged, 'stats', roll('3d6')), 'stats')).toContain('3d6 can roll 3, below b\'s lowest, 5');
    expect(stepWayProblems(withStepWay(GROUPS, 'stats', roll()), 'stats')).toEqual([]);
  });
});

describe('a point buy (7c3d)', () => {
  const FLAT = { way: 'buy' as const, points: 20, lowest: 8, highest: 15 };
  const CLIMBING = { ...FLAT, costs: climbingCosts(8, 15) };

  it('the climbing cost adds 1 a number for five, then 2', () => {
    expect(climbingCosts(8, 15)).toEqual({ 8: 0, 9: 1, 10: 2, 11: 3, 12: 4, 13: 5, 14: 7, 15: 9 });
    expect(climbingCosts(1, 2)).toEqual({ 1: 0, 2: 1 });
  });

  it('knows which preset it is, until the GM changes one', () => {
    expect(buyPreset(FLAT)).toBe('flat');
    expect(buyPreset(CLIMBING)).toBe('climbing');
    expect(buyPreset(buyWithCost(CLIMBING, 15, 10))).toBe('own');
    expect(buyPreset({ ...FLAT, costs: { 8: 0 } })).toBe('own');
    expect(buyPreset({ ...CLIMBING, costs: { ...CLIMBING.costs, 99: 1 } })).toBe('own');
  });

  it('one cost changed writes the table out, keeping the rest', () => {
    const own = buyWithCost({ ...FLAT, highest: 10 }, 10, 5);
    expect(own.costs).toEqual({ 8: 0, 9: 1, 10: 5 });
  });

  it('the range changed keeps the costs still in it; a new number costs 1 more than the one below', () => {
    const own = { ...FLAT, highest: 10, costs: { 8: 0, 9: 3, 10: 7 } };
    expect(buyWith(own, { highest: 12 }).costs).toEqual({ 8: 0, 9: 3, 10: 7, 11: 8, 12: 9 });
    expect(buyWith(own, { highest: 9 }).costs).toEqual({ 8: 0, 9: 3 });
    expect(buyWith(own, { lowest: 7 }).costs).toEqual({ 7: 0, 8: 0, 9: 3, 10: 7 });
    expect(buyWith(own, { points: 5 })).toEqual({ ...own, points: 5 });
    expect(buyWith(FLAT, { highest: 9 }).costs).toBeUndefined();
  });

  it('a range that can\'t be walked lists nothing, and keeps its costs for when it can', () => {
    expect(buyNumbers(FLAT)).toEqual([8, 9, 10, 11, 12, 13, 14, 15]);
    expect(buyNumbers({ ...FLAT, lowest: 16 })).toEqual([]);
    expect(buyNumbers({ ...FLAT, highest: 108 })).toEqual([]);
    expect(buyNumbers({ ...FLAT, highest: 107 })).toHaveLength(100);
    expect(buyWith(CLIMBING, { lowest: 16 }).costs).toEqual(CLIMBING.costs);
  });

  it('reads as the server does, and what isn\'t one reads as typed in', () => {
    expect(wayOfStep(withStepWay(GROUPS, 'stats', CLIMBING), 'stats')).toEqual(CLIMBING);
    for (const bad of [{ way: 'buy' }, { way: 'buy', points: 'x', lowest: 1, highest: 2 }, { way: 'buy', points: 1, lowest: 1.5, highest: 2 }, { way: 'buy', points: 1, lowest: 1 }]) {
      expect(wayOfStep({ ...GROUPS, creation: { ways: { stats: bad } } } as unknown as Definition, 'stats'), JSON.stringify(bad)).toEqual({ way: 'typed' });
    }
    expect(checkDefinition(withStepWay(GROUPS, 'stats', CLIMBING)).problems.filter((p: { where: string }) => p.where.startsWith('creation'))).toEqual([]);
  });

  it('says what is wrong in the server\'s words', () => {
    const ranged = { ...GROUPS, stats: [{ id: 'g', label: 'G', stats: [{ id: 'a', label: 'Aim', min: 9, max: 11 }, { id: 'b' }] }] } as unknown as Definition;
    const sheet = { sections: [{ id: 's', label: 'S', layout: 'grid', fields: [{ id: 'climb', label: 'Climb', type: 'number', edit: 'gm' }] }] };
    for (const def of [
      withStepWay(GROUPS, 'stats', FLAT),
      withStepWay(GROUPS, 'stats', { ...FLAT, lowest: 16 }),
      withStepWay(GROUPS, 'stats', { ...FLAT, highest: 108 }),
      withStepWay(GROUPS, 'stats', { ...FLAT, highest: 107 }),
      withStepWay(GROUPS, 'stats', { ...FLAT, highest: 10, costs: { 8: 0, 9: -1 } }),
      withStepWay(GROUPS, 'stats', { ...FLAT, points: 3, highest: 9, costs: { 8: 2, 9: 3 } }),
      withStepWay(ranged, 'stats', FLAT),
      { ...withStepWay(GROUPS, 'stats', { ...FLAT, points: 2, highest: 9, costs: { 8: 2, 9: 3 } }), sheet } as unknown as Definition,
    ]) expect(stepWayProblems(def, 'stats'), JSON.stringify(def.creation)).toEqual(server.stepWayProblems(def, 'stats'));
    expect(stepWayProblems(withStepWay(GROUPS, 'stats', { ...FLAT, lowest: 16 }), 'stats')).toEqual(['The lowest is above the highest']);
    expect(stepWayProblems(withStepWay(GROUPS, 'stats', { ...FLAT, highest: 107 }), 'stats')).toEqual([]);
  });
});

describe('kits (7c4a)', () => {
  it('none to start; one more is a kit a player may pick, with an id of its own', () => {
    expect(kitsOf(HEARTH)).toEqual([]);
    const one = withNewKit(HEARTH);
    expect(one.id).toBe('new_kit');
    expect(kitsOf(one.definition)).toEqual([{ id: 'new_kit', name: 'NEW KIT', items: [], who: 'pick' }]);
    const two = withNewKit(one.definition);
    expect(two.id).not.toBe('new_kit');
    expect(kitsOf(two.definition).map((k) => k.id)).toEqual(['new_kit', two.id]);
  });

  it('what isn\'t a kit isn\'t read as one', () => {
    for (const kits of ['x', [3], [{ name: 'no id' }]]) expect(kitsOf({ ...HEARTH, creation: { kits } } as unknown as Definition)).toEqual([]);
  });

  it('changes one, leaving the others; gone, leaves nothing behind', () => {
    const { definition, id } = withNewKit(HEARTH);
    const other = withNewKit(definition);
    const named = withKit(other.definition, id, { name: 'TRAVELER' });
    expect(kitsOf(named).map((k) => k.name)).toEqual(['TRAVELER', 'NEW KIT']);
    expect(kitsOf(withoutKit(named, id)).map((k) => k.id)).toEqual([other.id]);
    expect(withoutKit(withoutKit(named, id), other.id)).toEqual(HEARTH);
  });

  it('a requirement comes with ONLY IF and goes with it', () => {
    const { definition, id } = withNewKit(HEARTH);
    const needs = withKit(definition, id, { who: 'needs' });
    expect(kitsOf(needs)[0].requires).toBe('');
    const written = withKit(needs, id, { requires: '@grit >= 12' });
    expect(kitsOf(written)[0].requires).toBe('@grit >= 12');
    expect(kitsOf(withKit(written, id, { name: 'X' }))[0].requires).toBe('@grit >= 12');
    expect('requires' in kitsOf(withKit(written, id, { who: 'pick' }))[0]).toBe(false);
  });

  it('reads items as typed, and says them back', () => {
    expect(parseKitItems('Rope, Lantern, 3x Rations')).toEqual([{ name: 'Rope', qty: 1 }, { name: 'Lantern', qty: 1 }, { name: 'Rations', qty: 3 }]);
    expect(parseKitItems(' 3X  Rations ,, ')).toEqual([{ name: 'Rations', qty: 3 }]);
    expect(parseKitItems('')).toEqual([]);
    expect(parseKitItems('Box of 3x matches')).toEqual([{ name: 'Box of 3x matches', qty: 1 }]);
    expect(parseKitItems('3xRations')).toEqual([{ name: '3xRations', qty: 1 }]);
    expect(kitItemsText([{ name: 'Rope', qty: 1 }, { name: 'Rations', qty: 3 }])).toBe('Rope, 3x Rations');
    expect(parseKitItems(kitItemsText([{ name: 'Rope', qty: 1 }, { name: 'Rations', qty: 3 }]))).toEqual([{ name: 'Rope', qty: 1 }, { name: 'Rations', qty: 3 }]);
  });

  it('what it writes, the server takes', () => {
    const { definition, id } = withNewKit(GROUPS);
    const made = withKit(definition, id, { name: 'TRAVELER', items: parseKitItems('Rope, 3x Rations'), who: 'needs', requires: '@grit >= 12' });
    expect(checkDefinition(made).problems.filter((p: { where: string }) => p.where.startsWith('creation'))).toEqual([]);
    expect(checkDefinition(definition).problems.filter((p: { where: string }) => p.where.startsWith('creation')).map((p: { message: string }) => p.message)).toEqual(['Has nothing in it']);
  });
});

describe('the stats, one way for all or group by group (7c3a)', () => {
  it('one way to start; group by group a step each, named by the group; back again leaves nothing', () => {
    expect(statsByGroup(GROUPS)).toBe(false);
    const by = withStatsByGroup(GROUPS, true);
    expect(by.creation).toEqual({ statsBy: 'group' });
    expect(statsByGroup(by)).toBe(true);
    expect(ids(by).slice(0, 3)).toEqual(['who', 'stats:abilities', 'stats:skills']);
    expect(['stats:abilities', 'stats:skills', 'stats:gone'].map((id) => stepName(by, id))).toEqual(['ABILITIES', 'SKILLS', 'STATS:GONE']);
    expect(stepGroup(by, 'stats:skills')?.label).toBe('SKILLS');
    expect([stepGroup(by, 'stats'), stepGroup(by, 'who')]).toEqual([undefined, undefined]);
    expect(withStatsByGroup(by, false)).toEqual(GROUPS);
  });

  it('a group left out is the same switch either way, and carries over', () => {
    expect(groupLeftOut(GROUPS, 'skills')).toBe(false);
    const out = withStepOff(GROUPS, 'stats:skills', true);
    expect(out.creation).toEqual({ off: ['stats:skills'] });
    expect(groupLeftOut(out, 'skills')).toBe(true);
    expect(groupLeftOut(out, 'abilities')).toBe(false);
    expect(off(out)).toEqual([]);
    expect(off(withStatsByGroup(out, true))).toEqual(['stats:skills']);
    expect(withStepOff(out, 'stats:skills', false)).toEqual(GROUPS);
  });

  it('a moved group keeps its place through changing and back', () => {
    const by = withStepMoved(withStatsByGroup(withStepMoved(GROUPS, 'stats', 1), true), 'stats:skills', -1);
    expect(ids(by).slice(0, 4)).toEqual(['who', 'list:classes', 'stats:skills', 'stats:abilities']);
    expect(ids(withStatsByGroup(by, false)).slice(0, 3)).toEqual(['who', 'list:classes', 'stats']);
  });

  it('says when a list comes before the group whose stat it needs, and not before the other group', () => {
    const by = withStatsByGroup(GROUPS, true);
    expect(orderNotes(by)).toEqual([]);
    // CLASS between the groups: MAGE needs GRIT, in ABILITIES.
    const between = withStepMoved(withStepMoved(by, 'list:classes', -1), 'list:classes', -1);
    expect(ids(between).slice(0, 3)).toEqual(['who', 'list:classes', 'stats:abilities']);
    expect(orderNotes(between)).toEqual(['CLASS comes before ABILITIES, and MAGE needs a stat: off until the stats are set, so it can\'t be picked here.']);
    const afterIt = withStepMoved(between, 'stats:abilities', -1);
    expect(ids(afterIt).slice(0, 3)).toEqual(['who', 'stats:abilities', 'list:classes']);
    expect(orderNotes(afterIt)).toEqual([]);
  });

  it('a stat in a group left out is never set here, so no note says it will be', () => {
    const first = withStepMoved(GROUPS, 'stats', 1);
    expect(orderNotes(first)).toHaveLength(1);
    expect(orderNotes(withStepOff(first, 'stats:abilities', true))).toEqual([]);
    const byFirst = withStepMoved(withStepMoved(withStatsByGroup(GROUPS, true), 'list:classes', -1), 'list:classes', -1);
    expect(orderNotes(withStepOff(byFirst, 'stats:abilities', true))).toEqual([]);
  });
});

describe('the steps', () => {
  it('are named as the page says them: a list by its one name, or its many', () => {
    expect(ids(HEARTH).map((id) => stepName(HEARTH, id))).toEqual(['WHO THEY ARE', 'THE STATS', 'CLASS', 'BACKGROUNDS', 'KITS', 'MONEY']);
    expect(stepName(HEARTH, 'list:gone')).toBe('LIST:GONE');
    expect(stepList(HEARTH, 'list:classes')?.many).toBe('Classes');
    expect([stepList(HEARTH, 'kits'), stepList(HEARTH, 'list:gone')]).toEqual([undefined, undefined]);
  });

  it('switch on and off, nothing stored once it says nothing', () => {
    expect(creationOn(HEARTH)).toBe(false);
    const on = withCreationOn(HEARTH, true);
    expect(on.creation).toEqual({ on: true });
    expect(withCreationOn(on, false)).toEqual(HEARTH);
  });

  it('move up and down, the whole order kept; past either end, nothing changes', () => {
    const down = withStepMoved(HEARTH, 'who', 1);
    expect(ids(down)).toEqual(['stats', 'who', 'list:classes', 'list:backgrounds', 'kits', 'money']);
    expect((down.creation as { order: string[] }).order).toEqual(ids(down));
    expect(ids(withStepMoved(down, 'who', -1))).toEqual(ids(HEARTH));
    expect(withStepMoved(HEARTH, 'who', -1)).toBe(HEARTH);
    expect(withStepMoved(HEARTH, 'money', 1)).toBe(HEARTH);
    expect(withStepMoved(HEARTH, 'gone', 1)).toBe(HEARTH);
  });

  it('go off and on again, WHO THEY ARE never', () => {
    const noKits = withStepOff(HEARTH, 'kits', true);
    expect(off(noKits)).toEqual(['kits']);
    expect(off(withStepOff(noKits, 'money', true))).toEqual(['kits', 'money']);
    expect(withStepOff(noKits, 'kits', false)).toEqual(HEARTH);
    expect(withStepOff(HEARTH, 'who', true)).toBe(HEARTH);
  });

  it('keep the switch and the order through each other', () => {
    const def = withStepOff(withStepMoved(withCreationOn(HEARTH, true), 'kits', -1), 'money', true);
    expect(def.creation).toMatchObject({ on: true, off: ['money'] });
    expect(ids(def).indexOf('kits')).toBe(3);
  });
});

describe('what the order means', () => {
  const mageFirst = withStepMoved(HEARTH, 'stats', 1);

  it('says when a list before THE STATS has an option needing a stat, by name', () => {
    expect(orderNotes(HEARTH)).toEqual([]);
    expect(orderNotes(mageFirst)).toEqual(['CLASS comes before THE STATS, and MAGE needs a stat: off until the stats are set, so it can\'t be picked here.']);
  });

  it('doesn\'t for a requirement reading no stat, nor with THE STATS or that list switched off', () => {
    const bgFirst = withStepMoved(withStepMoved(HEARTH, 'list:backgrounds', -1), 'list:backgrounds', -1);
    expect(ids(bgFirst).indexOf('list:backgrounds')).toBeLessThan(ids(bgFirst).indexOf('stats'));
    expect(orderNotes(bgFirst)).toEqual([]);
    // A level is no stat: it comes from picks, not from THE STATS.
    const byLevel = { ...HEARTH, choices: [{ id: 'paths', one: 'Path', many: 'Paths', options: [{ id: 'sage', label: 'Sage', requires: '@paths_level >= 2' }] }] } as unknown as Definition;
    expect(orderNotes(withStepMoved(byLevel, 'stats', 1))).toEqual([]);
    expect(orderNotes(withStepOff(mageFirst, 'stats', true))).toEqual([]);
    expect(orderNotes(withStepOff(mageFirst, 'list:classes', true))).toEqual([]);
  });
});
