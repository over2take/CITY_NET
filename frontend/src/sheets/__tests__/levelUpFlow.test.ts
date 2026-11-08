import { describe, it, expect } from 'vitest';
import { LEVEL_UP_STEP_NAMES, chosenTarget, levelUpSteps, levelUpTitle, unlockedBy } from '../levelUpFlow';
import { WORKED_KEY } from '../choicesShown';
import type { LevelUpOffer } from '../xpMeter';
import type { SheetTemplate } from '../types';

/** LEVEL_UP.EXE as logic (7d3a): its folders, which is going up, what the new level brings, and its title. */

const SOLDIER = { list: 'classes', option: 'soldier', name: 'Soldier', level: 2 };
const MAGE = { list: 'classes', option: 'mage', name: 'Mage', level: 1 };
const offer = (targets = [SOLDIER, MAGE], leveling: LevelUpOffer['leveling'] = null): LevelUpOffer => ({ ready: true, targets, firstPick: null, leveling });

const TEMPLATE = {
  levels: { top: 10 },
  choices: [
    { id: 'classes', one: 'Class', many: 'Classes', levelled: true, options: [
      { id: 'soldier', label: 'Soldier', features: [
        { id: 'guard', label: 'Guard', at: 1 },
        { id: 'extra', label: 'Extra Attack', at: 3, text: 'Attack twice.' },
        { id: 'path', label: 'Path', at: 3, opens: 'paths' },
        { id: 'veteran', label: 'Veteran', at: 4 },
      ] },
      { id: 'mage', label: 'Mage', features: [{ id: 'spark', label: 'Spark', at: 2 }, { id: 'school', label: 'School', at: 1, opens: 'schools' }, { id: 'cantrip', label: 'Cantrip' }] },
    ] },
    { id: 'archetypes', one: 'Archetype', many: 'Archetypes', levelled: false, picked: 'features', options: [
      { id: 'champion', label: 'Champion', features: [{ id: 'crit', label: 'Better Crits', at: 3 }, { id: 'later', label: 'Later', at: 7 }] },
    ] },
    { id: 'drills', one: 'Drill', many: 'Drills', levelled: true, picked: 'features', options: [
      { id: 'parry', label: 'Parry', features: [{ id: 'riposte', label: 'Riposte', at: 3 }] },
    ] },
    { id: 'commons', one: 'Common', many: 'Commons', levelled: false, picked: 'everyone', options: [
      { id: 'breath', label: 'Breath', features: [{ id: 'second', label: 'Second Wind', at: 4 }, { id: 'first', label: 'First', at: 1 }] },
    ] },
  ],
} as unknown as SheetTemplate;

const sheet = (picks: object[], level: number) => ({ [WORKED_KEY]: { picks, levels: { level } } });

describe('the folders', () => {
  it('WHICH CLASS only when there is a choice', () => {
    expect(levelUpSteps(offer())).toEqual(['which', 'unlocks']);
    expect(levelUpSteps(offer([SOLDIER]))).toEqual(['unlocks']);
    expect(LEVEL_UP_STEP_NAMES).toEqual({ which: 'WHICH CLASS', unlocks: 'WHAT IT UNLOCKS' });
  });
});

describe('what is going up', () => {
  it('the one their place names, or the first', () => {
    expect(chosenTarget(offer())).toBe(SOLDIER);
    expect(chosenTarget(offer(undefined, { list: 'classes', option: 'mage' }))).toBe(MAGE);
    expect(chosenTarget(offer(undefined, { list: 'feats', option: 'mage' }))).toBe(SOLDIER);
    expect(chosenTarget(offer(undefined, { list: 'classes', option: 'rogue' }))).toBe(SOLDIER);
    expect(chosenTarget(offer([]))).toBeNull();
    const level = { name: 'LEVEL', level: 3 };
    expect(chosenTarget(offer([level], {}))).toBe(level);
  });
});

describe('what the new level unlocks', () => {
  const picks = [
    { list: 'classes', option: 'soldier', level: 2 },
    { list: 'classes', option: 'mage', level: 1 },
    { list: 'archetypes', option: 'champion', from: 'path' },
    { list: 'drills', option: 'parry', level: 1, from: 'path' },
    { list: 'commons', option: 'breath' },
  ];

  it('the class\'s features at its new level, a pick under it following along, and what everyone has at the new total', () => {
    expect(unlockedBy(TEMPLATE, sheet(picks, 3), SOLDIER)).toEqual([
      { id: 'extra', label: 'Extra Attack', text: 'Attack twice.', from: 'Soldier' },
      { id: 'path', label: 'Path', from: 'Soldier', opens: 'paths' },
      { id: 'crit', label: 'Better Crits', from: 'Champion' },
      { id: 'second', label: 'Second Wind', from: 'Breath' },
    ]);
  });

  it('another class brings its own, and names the list a feature opens', () => {
    expect(unlockedBy(TEMPLATE, sheet(picks, 1), MAGE)).toEqual([{ id: 'spark', label: 'Spark', from: 'Mage' }]);
    const school = unlockedBy(TEMPLATE, sheet([], 0), { ...MAGE, level: 0 });
    // A feature with no level of its own comes with the first.
    expect(school).toEqual([{ id: 'school', label: 'School', from: 'Mage', opens: 'schools' }, { id: 'cantrip', label: 'Cantrip', from: 'Mage' }]);
    const named = unlockedBy({ ...TEMPLATE, choices: [...(TEMPLATE.choices ?? []), { id: 'schools', one: 'School of magic', options: [] }] } as unknown as SheetTemplate, sheet([], 0), { ...MAGE, level: 0 });
    expect(named[0].opens).toBe('School of magic');
  });

  it('a pick waiting, or under another class, brings nothing', () => {
    const waiting = picks.map((p) => (p.option === 'champion' ? { ...p, waiting: true } : p));
    expect(unlockedBy(TEMPLATE, sheet(waiting, 3), SOLDIER).map((u) => u.id)).toEqual(['extra', 'path', 'second']);
    expect(unlockedBy(TEMPLATE, sheet(picks, 1), MAGE).map((u) => u.id)).not.toContain('crit');
    // Champion was picked under Soldier's Path: Mage reaching 3 doesn't bring its level 3.
    expect(unlockedBy(TEMPLATE, sheet(picks, 3), { ...MAGE, level: 2 }).map((u) => u.id)).not.toContain('crit');
  });

  it('the level itself brings only what everyone has', () => {
    expect(unlockedBy(TEMPLATE, sheet(picks, 3), { name: 'LEVEL', level: 3 })).toEqual([{ id: 'second', label: 'Second Wind', from: 'Breath' }]);
    expect(unlockedBy(null, {}, { name: 'LEVEL', level: 1 })).toEqual([]);
  });
});

describe('the title', () => {
  it('whose, and what it goes to', () => {
    expect(levelUpTitle('Wren', SOLDIER)).toBe('LEVEL_UP.EXE · WREN · SOLDIER 3');
    expect(levelUpTitle('Wren', { name: 'LEVEL', level: 4 })).toBe('LEVEL_UP.EXE · WREN · LEVEL 5');
    expect(levelUpTitle('Wren', null)).toBe('LEVEL_UP.EXE · WREN');
  });
});
