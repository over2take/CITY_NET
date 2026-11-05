/**
 * The builder's NEW CHARACTER page as logic (7c1). Held to the server (backend/systemBuilder/creation.js),
 * so what the page writes is what the server takes and reads the same.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { creationOn, creationSteps, groupLeftOut, orderNotes, parseNumbers, statsByGroup, stepGroup, stepList, stepName, stepWayProblems, wayOfStep, withCreationOn, withStatsByGroup, withStepMoved, withStepOff, withStepWay } from '../newCharacter';
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
