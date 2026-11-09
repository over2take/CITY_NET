import { describe, it, expect } from 'vitest';
import { canRaise, increasesSpent, insteadAsked, insteadTaken, pointsLeft, statNow, withRaised, withoutSpread } from '../levelUpFlow';
import { LEVEL_UP_STEP_NAMES, gmLevelingLine, healthGain, healthRolledFor, chosenTarget, levelUpSteps, levelUpTitle, newClasses, picksAsked, picksMade, picksWanted, unlockedBy, withPickToggled, type Unlocked } from '../levelUpFlow';
import { WORKED_KEY } from '../choicesShown';
import { levelUpOffer, type LevelUpOffer } from '../xpMeter';
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
        { id: 'path', label: 'Path', at: 3, opens: 'paths', opensCount: 2 },
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
    // A class they could take up is a choice too (7d3b).
    expect(levelUpSteps(offer([SOLDIER]), 1)).toEqual(['which', 'unlocks']);
    expect(levelUpSteps(offer([SOLDIER]), 0)).toEqual(['unlocks']);
    expect(LEVEL_UP_STEP_NAMES).toEqual({ which: 'WHICH CLASS', health: 'HEALTH', unlocks: 'WHAT IT UNLOCKS', increase: 'ABILITY INCREASE' });
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
      { id: 'path', label: 'Path', from: 'Soldier', opens: 'paths', opensList: 'paths', count: 2 },
      { id: 'crit', label: 'Better Crits', from: 'Champion' },
      { id: 'second', label: 'Second Wind', from: 'Breath' },
    ]);
  });

  it('another class brings its own, and names the list a feature opens', () => {
    expect(unlockedBy(TEMPLATE, sheet(picks, 1), MAGE)).toEqual([{ id: 'spark', label: 'Spark', from: 'Mage' }]);
    const school = unlockedBy(TEMPLATE, sheet([], 0), { ...MAGE, level: 0 });
    // A feature with no level of its own comes with the first.
    expect(school).toEqual([{ id: 'school', label: 'School', from: 'Mage', opens: 'schools', opensList: 'schools', count: 1 }, { id: 'cantrip', label: 'Cantrip', from: 'Mage' }]);
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

describe('a class not held yet (7d3b)', () => {
  const LISTS = [
    { id: 'classes', one: 'Class', many: 'Classes', picks: 'any', again: true, levelled: true, options: [
      { id: 'soldier', label: 'Soldier', features: [] }, { id: 'mage', label: 'Mage', features: [], needs: 'WITS >= 13' }, { id: 'rogue', label: 'Rogue', features: [] },
    ] },
    { id: 'callings', one: 'Calling', many: 'Callings', picks: 1, levelled: true, options: [{ id: 'priest', label: 'Priest', features: [] }, { id: 'bard', label: 'Bard', features: [] }] },
    { id: 'sub', one: 'Sub', many: 'Subs', levelled: true, picked: 'features', options: [{ id: 'x', label: 'X', features: [] }] },
    { id: 'fated', one: 'Fate', many: 'Fates', picks: 1, levelled: true, table: 'd6', players: 'roll', options: [{ id: 'doom', label: 'Doom', features: [] }] },
    { id: 'feats', one: 'Feat', many: 'Feats', picks: 'any', options: [{ id: 'tough', label: 'Tough', features: [] }] },
  ];
  const tpl = { levels: { top: 10 }, choices: LISTS } as unknown as SheetTemplate;
  const data = { [WORKED_KEY]: { picks: [{ list: 'classes', option: 'soldier', level: 2 }, { list: 'callings', option: 'priest', level: 1 }], levels: { level: 3 }, unmet: ['mage'] } };
  const held = offer([SOLDIER, { list: 'callings', option: 'priest', name: 'Priest', level: 1 }]);

  it('from a levelled list of their own picking with room, not held, saying what one needs', () => {
    expect(newClasses(tpl, data, held)).toEqual([
      { list: 'classes', option: 'mage', name: 'Mage', level: 0, new: true, unmet: 'WITS >= 13' },
      { list: 'classes', option: 'rogue', name: 'Rogue', level: 0, new: true },
    ]);
  });

  it('none until they hold a class, nor where levels are the level itself', () => {
    expect(newClasses(tpl, data, offer([]))).toEqual([]);
    expect(newClasses(tpl, data, offer([{ name: 'LEVEL', level: 3 }]))).toEqual([]);
    expect(newClasses(null, data, held)).toEqual([]);
  });

  it('chosen when their place names it, and only if they meet it', () => {
    const joinable = newClasses(tpl, data, held);
    expect(chosenTarget({ ...held, leveling: { list: 'classes', option: 'rogue' } }, joinable)?.option).toBe('rogue');
    expect(chosenTarget({ ...held, leveling: { list: 'classes', option: 'mage' } }, joinable)?.option).toBe('soldier');
    expect(chosenTarget({ ...held, leveling: { list: 'classes', option: 'rogue' } })?.option).toBe('soldier');
  });
});

describe('the picks a new level asks for (7d3b)', () => {
  const LISTS = [
    { id: 'classes', one: 'Class', many: 'Classes', levelled: true, options: [{ id: 'soldier', label: 'Soldier', features: [] }] },
    { id: 'paths', one: 'Path', many: 'Paths', picked: 'features', options: [
      { id: 'duelist', label: 'Duelist', features: [] }, { id: 'vanguard', label: 'Vanguard', features: [], needs: 'MIGHT >= 15' }, { id: 'scout', label: 'Scout', features: [] },
    ] },
    { id: 'both', one: 'Trick', many: 'Tricks', picked: 'both', options: [{ id: 'feint', label: 'Feint', features: [] }] },
    { id: 'own', one: 'Feat', many: 'Feats', options: [{ id: 'tough', label: 'Tough', features: [] }] },
    { id: 'rolled', one: 'Scar', many: 'Scars', picked: 'features', table: 'd6', players: 'roll', options: [{ id: 'burn', label: 'Burn', features: [] }] },
  ];
  const tpl = { choices: LISTS } as unknown as SheetTemplate;
  const data = { [WORKED_KEY]: { picks: [{ list: 'paths', option: 'scout', from: 'old' }], levels: {}, unmet: ['vanguard'] } };
  const u = (id: string, opensList: string, count = 1): Unlocked => ({ id, label: id, from: 'Soldier', opens: opensList, opensList, count });

  it('one per feature opening a list picked under features, with what is left to pick and what it needs', () => {
    const asked = picksAsked(tpl, data, [u('path', 'paths', 2), u('trick', 'both'), u('feat', 'own'), u('scar', 'rolled'), u('gone', 'nowhere'), { id: 'plain', label: 'Plain', from: 'Soldier' }]);
    expect(asked.map((a) => [a.feature, a.list.id, a.count, a.rolled])).toEqual([['path', 'paths', 2, false], ['trick', 'both', 1, false], ['scar', 'rolled', 1, true]]);
    expect(asked[0].options.map((o) => [o.option.id, o.unmet])).toEqual([['duelist', null], ['vanguard', 'MIGHT >= 15']]);
  });

  it('how many each still wants: as many as it opens, as far as there are ones they meet; a roll, none here', () => {
    const [path, trick, scar] = picksAsked(tpl, data, [u('path', 'paths', 2), u('trick', 'both'), u('scar', 'rolled')]);
    expect(picksWanted(path)).toBe(1);
    expect(picksWanted({ ...path, count: 1 })).toBe(1);
    expect(picksWanted(trick)).toBe(1);
    expect(picksWanted(scar)).toBe(0);
    expect(picksWanted({ ...path, options: [] })).toBe(0);
  });

  it('FINISH waits until each is made, counting only its own', () => {
    const asked = picksAsked(tpl, data, [u('path', 'paths'), u('trick', 'both')]);
    expect(picksMade(asked, [])).toBe(false);
    expect(picksMade(asked, [{ list: 'paths', option: 'duelist', from: 'path' }])).toBe(false);
    expect(picksMade(asked, [{ list: 'paths', option: 'duelist', from: 'path' }, { list: 'both', option: 'feint', from: 'trick' }])).toBe(true);
    expect(picksMade(asked, [{ list: 'paths', option: 'duelist', from: 'trick' }, { list: 'both', option: 'feint', from: 'trick' }])).toBe(false);
    expect(picksMade(asked, [{ list: 'both', option: 'duelist', from: 'path' }, { list: 'both', option: 'feint', from: 'trick' }])).toBe(false);
    expect(picksMade([], [])).toBe(true);
  });

  it('a pick toggled: made while there is room, taken back, others left alone', () => {
    const [path] = picksAsked(tpl, data, [u('path', 'paths')]);
    const other = { list: 'both', option: 'feint', from: 'trick' };
    const one = withPickToggled([other], path, 'duelist');
    expect(one).toEqual([other, { list: 'paths', option: 'duelist', from: 'path' }]);
    expect(withPickToggled(one, path, 'scout')).toBe(one);
    expect(withPickToggled(one, path, 'duelist')).toEqual([other]);
    // Another list's pick under a feature of the same name is its own.
    const elsewhere = { list: 'both', option: 'duelist', from: 'path' };
    expect(withPickToggled([elsewhere], path, 'duelist')).toEqual([elsewhere, { list: 'paths', option: 'duelist', from: 'path' }]);
    const two = withPickToggled(withPickToggled([], { ...path, count: 2 }, 'duelist'), { ...path, count: 2 }, 'scout');
    expect(two.map((p) => p.option)).toEqual(['duelist', 'scout']);
  });
});

describe('HEALTH, per level (7d5a)', () => {
  const tpl = (health: object | undefined) => ({ levels: { top: 10, ...(health ? { health } : {}) }, choices: [{ id: 'classes', levelled: true, options: [{ id: 'soldier', label: 'Soldier', features: [] }, { id: 'mage', label: 'Mage', features: [] }] }] }) as unknown as SheetTemplate;
  const ON = { gain: 'average', dieOn: 'class', dice: { soldier: 10, mage: 6 } };
  const data = (adds?: number) => ({ [WORKED_KEY]: { picks: [{ list: 'classes', option: 'mage', level: 1 }, { list: 'classes', option: 'soldier', level: 2 }], levels: { level: 3 } }, ...(adds === undefined ? {} : { _health: { adds } }) });

  it('a folder only where health is per level', () => {
    expect(levelUpSteps(offer([SOLDIER]), 0, true)).toEqual(['health', 'unlocks']);
    expect(levelUpSteps(offer(), 0, true)).toEqual(['which', 'health', 'unlocks']);
    expect(LEVEL_UP_STEP_NAMES.health).toBe('HEALTH');
  });

  it('the class going up\'s die, half rounded up, with what each level adds; at least 1', () => {
    const A = { by: 'average', rolled: null, tookAverage: false, dice: 1, max: 0, over: null };
    expect(healthGain(tpl(ON), data(2), SOLDIER)).toEqual({ die: 10, average: 5, adds: 2, gained: 7, ...A });
    expect(healthGain(tpl(ON), data(-9), MAGE)).toEqual({ die: 6, average: 3, adds: -9, gained: 1, ...A });
    expect(healthGain(tpl(ON), data(), MAGE)).toEqual({ die: 6, average: 3, adds: 0, gained: 3, ...A });
  });

  it('the level itself has only the die for all; one for all; none', () => {
    expect(healthGain(tpl(ON), data(1), { name: 'LEVEL', level: 3 })?.die).toBeNull();
    expect(healthGain(tpl({ ...ON, dieOn: 'all', die: 8 }), data(1), { name: 'LEVEL', level: 3 })?.die).toBe(8);
    // An odd die rounds up.
    expect(healthGain(tpl({ ...ON, dice: { soldier: 7 } }), data(0), SOLDIER)).toMatchObject({ die: 7, average: 4, adds: 0, gained: 4 });
    expect(healthGain(tpl({ ...ON, dieOn: 'all', die: 8 }), data(1), SOLDIER)?.die).toBe(8);
    expect(healthGain(tpl({ ...ON, dieOn: 'all' }), data(1), SOLDIER)).toMatchObject({ die: null, average: 0, adds: 1, gained: 1 });
    expect(healthGain(tpl(ON), data(1), { ...SOLDIER, option: 'rogue' })?.die).toBeNull();
    expect(healthGain(tpl(ON), {}, { name: 'LEVEL', level: 1 })?.die).toBeNull();
  });

  it('nothing where health isn\'t per level', () => {
    expect(healthGain(tpl(undefined), data(2), SOLDIER)).toBeNull();
    expect(healthGain(null, data(2), SOLDIER)).toBeNull();
  });
});

describe('HEALTH rolled, or the player choosing (7d5b)', () => {
  const tpl = (gain: string) => ({ levels: { top: 10, table: { 2: 1, 3: 2, 4: 3 }, health: { gain, dieOn: 'class', dice: { soldier: 10, mage: 6 } } },
    choices: [{ id: 'classes', one: 'Class', levelled: true, options: [{ id: 'soldier', label: 'Soldier', features: [] }, { id: 'mage', label: 'Mage', features: [] }] }] }) as unknown as SheetTemplate;
  const data = (health?: object, place: object = { list: 'classes', option: 'soldier' }) => ({
    _xp: 9, [WORKED_KEY]: { picks: [{ list: 'classes', option: 'soldier', level: 2 }, { list: 'classes', option: 'mage', level: 1 }], levels: { level: 3 } }, _health: { adds: 2 },
    ...(health === undefined ? {} : { _leveling: { ...place, health } }),
  });

  it('ROLL: nothing gained until rolled; the roll kept for this class, with what each level adds', () => {
    expect(healthGain(tpl('roll'), data(), SOLDIER)).toEqual({ die: 10, average: 5, adds: 2, by: 'roll', rolled: null, tookAverage: false, gained: null, dice: 1, max: 0, over: null });
    expect(healthGain(tpl('roll'), data({ roll: 7, die: 10 }), SOLDIER)?.gained).toBe(9);
    expect(healthGain(tpl('roll'), data({ roll: 1, die: 10 }), { ...SOLDIER })?.rolled).toBe(1);
    // A low roll still gains 1.
    expect(healthGain(tpl('roll'), { ...data({ roll: 1, die: 10 }), _health: { adds: -3 } }, SOLDIER)?.gained).toBe(1);
    // A roll kept for Soldier is no roll for Mage.
    expect(healthGain(tpl('roll'), data({ roll: 7, die: 10 }), MAGE)?.rolled).toBeNull();
    expect(healthGain(tpl('roll'), data({ roll: 7, die: 10 }), MAGE)?.gained).toBeNull();
  });

  it('THE PLAYER CHOOSES: the average once taken, or the roll', () => {
    expect(healthGain(tpl('choose'), data(), SOLDIER)?.gained).toBeNull();
    expect(healthGain(tpl('choose'), data({ average: true }), SOLDIER)).toMatchObject({ tookAverage: true, gained: 7 });
    expect(healthGain(tpl('choose'), data({ roll: 2, die: 10 }), SOLDIER)).toMatchObject({ rolled: 2, gained: 4 });
    expect(healthGain(tpl('choose'), data({ average: true }), MAGE)?.tookAverage).toBe(false);
  });

  it('a class with no die has nothing to roll: what each level adds, settled', () => {
    expect(healthGain(tpl('roll'), data(), { list: 'classes', option: 'rogue', name: 'Rogue', level: 1 })?.gained).toBe(2);
  });

  it('the class a kept roll belongs to, while another is shown', () => {
    const offer = levelUpOffer(tpl('roll'), data({ roll: 7, die: 10 }))!;
    expect(healthRolledFor(offer, offer.targets, MAGE)).toBe('Soldier');
    expect(healthRolledFor(offer, offer.targets, SOLDIER)).toBeNull();
    expect(healthRolledFor(levelUpOffer(tpl('roll'), data({ average: true }))!, offer.targets, MAGE)).toBeNull();
    expect(healthRolledFor(levelUpOffer(tpl('roll'), data())!, offer.targets, MAGE)).toBeNull();
  });

  it('the GM\'s line: where they are, a kept roll to clear, and FILL IT IN FOR THEM while there\'s a level to go (7d7a)', () => {
    expect(gmLevelingLine(tpl('roll'), data({ roll: 7, die: 10 }))).toEqual({ words: 'LEVELING UP · SOLDIER 2 → 3 · HEALTH ROLLED 7 ON A D10', canClear: true, canFill: true });
    expect(gmLevelingLine(tpl('roll'), data({ average: true }))).toEqual({ words: 'LEVELING UP · SOLDIER 2 → 3 · HEALTH: THE AVERAGE', canClear: false, canFill: true });
    expect(gmLevelingLine(tpl('roll'), data({}, { list: 'classes', option: 'rogue' }))).toEqual({ words: 'LEVELING UP · NEW: ROGUE', canClear: false, canFill: true });
    expect(gmLevelingLine(tpl('roll'), { ...data(), _leveling: {} })).toEqual({ words: 'LEVELING UP · THE NEXT LEVEL', canClear: false, canFill: true });
    // Not leveling up: their level, and whether one is ready.
    expect(gmLevelingLine(tpl('roll'), data())).toEqual({ words: 'LEVEL 3 · LEVEL UP READY', canClear: false, canFill: true });
    expect(gmLevelingLine(tpl('roll'), { ...data(), _xp: 0 })).toEqual({ words: 'LEVEL 3', canClear: false, canFill: true });
    // At the highest level, nothing to fill in.
    const top = { ...tpl('roll'), levels: { ...tpl('roll').levels, top: 3 } } as SheetTemplate;
    expect(gmLevelingLine(top, data())).toEqual({ words: 'LEVEL 3', canClear: false, canFill: false });
    expect(gmLevelingLine(top, data({ roll: 7, die: 10 }))?.canFill).toBe(false);
    // Before a class is picked, and where levels are typed in, nothing.
    expect(gmLevelingLine(tpl('roll'), { _xp: 9, [WORKED_KEY]: { picks: [], levels: { level: 0 } } })).toBeNull();
    expect(gmLevelingLine(null, data({ roll: 7 }))).toBeNull();
  });
});

describe('REROLL ALL, KEEP HIGHER (7d5c)', () => {
  const tpl = { levels: { top: 10, table: { 2: 1, 3: 2 }, health: { gain: 'reroll', dieOn: 'class', dice: { soldier: 10 } } },
    choices: [{ id: 'classes', one: 'Class', levelled: true, options: [{ id: 'soldier', label: 'Soldier', features: [] }] }] } as unknown as SheetTemplate;
  const data = (health?: object) => ({
    _xp: 9, [WORKED_KEY]: { picks: [{ list: 'classes', option: 'soldier', level: 2 }], levels: { level: 2 } },
    _health: { adds: 2, max: 19, levels: [{ level: 1, took: 10, die: 10 }, { level: 2, took: 5, die: 10 }] },
    ...(health ? { _leveling: { list: 'classes', option: 'soldier', health } } : {}),
  });

  it('before: every level\'s die and the new one, the maximum to beat, nothing gained yet', () => {
    expect(healthGain(tpl, data(), SOLDIER)).toMatchObject({ by: 'reroll', dice: 3, max: 19, rolled: null, gained: null, over: null });
    // A level with no die, or a class going up with none, rolls nothing.
    const none = { ...data(), _health: { adds: 2, max: 19, levels: [{ level: 1, took: 10, die: 10 }, { level: 2, took: 0, die: null }] } };
    expect(healthGain(tpl, none, SOLDIER)?.dice).toBe(2);
    expect(healthGain(tpl, none, { ...SOLDIER, option: 'monk' })?.dice).toBe(1);
  });

  it('over the maximum: what takes it there; not over: 1', () => {
    expect(healthGain(tpl, data({ roll: 33, die: 10, gained: 14, over: 19 }), SOLDIER)).toMatchObject({ rolled: 33, gained: 14, over: true, max: 19 });
    expect(healthGain(tpl, data({ roll: 9, die: 10, gained: 1, over: 19 }), SOLDIER)).toMatchObject({ rolled: 9, gained: 1, over: false, max: 19 });
    // One over is still over, and gains just 1.
    expect(healthGain(tpl, data({ roll: 20, die: 10, gained: 1, over: 19 }), SOLDIER)).toMatchObject({ rolled: 20, gained: 1, over: true });
    // The maximum it had to beat is the one kept, though the sheet's has since moved.
    expect(healthGain(tpl, { ...data({ roll: 9, die: 10, gained: 1, over: 17 }), _health: { adds: 2, max: 25, levels: [] } }, SOLDIER)?.max).toBe(17);
  });

  it('the GM\'s line says it was rerolled, and what it adds', () => {
    expect(gmLevelingLine(tpl, data({ roll: 33, die: 10, gained: 14, over: 19 }))?.words).toBe('LEVELING UP · SOLDIER 2 → 3 · HEALTH REROLLED 33, +14');
  });
});

describe('ROLL TO BEAT (7d5d)', () => {
  const tpl = (beat: object, dice: Record<string, number> = { soldier: 10 }) => ({ levels: { top: 10, table: { 2: 1, 3: 2 }, health: { gain: 'beat', dieOn: 'class', dice, beat } },
    choices: [{ id: 'classes', one: 'Class', levelled: true, options: [{ id: 'soldier', label: 'Soldier', features: [] }] }] }) as unknown as SheetTemplate;
  const POOL = { way: 'pool', count: 6, die: 10, gain: 6 };
  const data = (health?: object) => ({
    _xp: 9, [WORKED_KEY]: { picks: [{ list: 'classes', option: 'soldier', level: 2 }], levels: { level: 2 } },
    _health: { adds: 2, max: 19, levels: [{ level: 1, took: 10, die: 10 }, { level: 2, took: 5, die: 10 }] },
    ...(health ? { _leveling: { list: 'classes', option: 'soldier', health } } : {}),
  });

  it('a pool: its own dice, whatever the levels; nothing settled until rolled', () => {
    expect(healthGain(tpl(POOL), data(), SOLDIER)).toMatchObject({ by: 'beat', dice: 6, max: 19, gained: null, beat: POOL });
    // A class with no die still has the pool to roll.
    expect(healthGain(tpl(POOL, {}), data(), SOLDIER)?.gained).toBeNull();
  });

  it('a die per level: every level\'s and the new one', () => {
    expect(healthGain(tpl({ ...POOL, way: 'level' }), data(), SOLDIER)).toMatchObject({ dice: 3, gained: null });
    expect(healthGain(tpl({ ...POOL, way: 'level' }, {}), data(), SOLDIER)?.gained).toBe(2);
  });

  it('beaten: what it gained; not: nothing, settled', () => {
    expect(healthGain(tpl(POOL), data({ roll: 31, die: 10, gained: 4, over: 19, beat: true }), SOLDIER)).toMatchObject({ rolled: 31, gained: 4, over: true });
    expect(healthGain(tpl(POOL), data({ roll: 15, die: 10, gained: 0, over: 19, beat: true }), SOLDIER)).toMatchObject({ rolled: 15, gained: 0, over: false });
  });

  it('the GM\'s line', () => {
    expect(gmLevelingLine(tpl(POOL), data({ roll: 31, die: 10, gained: 4, over: 19, beat: true }))?.words).toBe('LEVELING UP · SOLDIER 2 → 3 · HEALTH ROLLED 31 TO BEAT 19, +4');
  });
});

describe('ABILITY INCREASE (7d6b)', () => {
  const STATS = [{ id: 'might', label: 'Might' }, { id: 'wits', label: 'Wits' }];
  const ASI = { id: 'asi', label: 'Ability Score Improvement', from: 'Soldier', increase: { points: 2, most: 2, stats: STATS, cap: 20 } } as Unlocked;
  const ONE_EACH = { id: 'boost', label: 'Boost', from: 'Everyone', increase: { points: 2, most: 1, stats: STATS } } as Unlocked;
  // Might 18 typed, +1 from Grit: 19.
  const data = { might: 18, wits: '12', [WORKED_KEY]: { picks: [], levels: { level: 3 }, from: { might: [{ feature: 'Grit', amount: 1 }] } } };

  it('a folder of its own, after what it unlocks, only when there is one to spend', () => {
    expect(LEVEL_UP_STEP_NAMES.increase).toBe('ABILITY INCREASE');
    expect(levelUpSteps(offer([SOLDIER]), 0, true, true)).toEqual(['health', 'unlocks', 'increase']);
    expect(levelUpSteps(offer([SOLDIER]), 0, false, false)).toEqual(['unlocks']);
  });

  it('carried with what the new level unlocks', () => {
    const tpl = { ...TEMPLATE, choices: [{ ...(TEMPLATE.choices as object[])[0] as object, options: [{ id: 'soldier', label: 'Soldier', features: [{ id: 'asi', label: 'Ability Score Improvement', at: 3, increase: ASI.increase }] }] }] } as unknown as SheetTemplate;
    expect(unlockedBy(tpl, sheet([{ list: 'classes', option: 'soldier', level: 2 }], 2), SOLDIER)).toEqual([{ id: 'asi', label: 'Ability Score Improvement', from: 'Soldier', increase: ASI.increase }]);
  });

  it('a stat as it reads now: as typed, with what the picks add', () => {
    expect(statNow(data, 'might')).toBe(19);
    expect(statNow(data, 'wits')).toBe(12);
    expect(statNow(data, 'lore')).toBe(0);
    expect(statNow({ might: 'x', [WORKED_KEY]: { picks: [], from: { might: [{ feature: 'A', amount: 2 }, { feature: 'B', amount: Number.NaN }] } } }, 'might')).toBe(2);
    expect(statNow(null, 'might')).toBe(0);
  });

  it('points left, and whether one more can go on a stat', () => {
    expect(pointsLeft(ASI)).toBe(2);
    expect(pointsLeft(ASI, { wits: 1 })).toBe(1);
    expect(pointsLeft({ id: 'x', label: 'X', from: 'Y' })).toBe(0);
    expect(canRaise(data, ASI, {}, 'wits')).toBe(true);
    expect(canRaise(data, ASI, { wits: 1 }, 'wits')).toBe(true);
    // None left.
    expect(canRaise(data, ASI, { wits: 2 }, 'might')).toBe(false);
    // At most 1 on one.
    expect(canRaise(data, ONE_EACH, { might: 1 }, 'might')).toBe(false);
    expect(canRaise(data, ONE_EACH, { might: 1 }, 'wits')).toBe(true);
    // Stops at 20: Might is 19 with Grit, so one more and no further.
    expect(canRaise(data, ASI, {}, 'might')).toBe(true);
    expect(canRaise(data, ASI, { might: 1 }, 'might')).toBe(false);
    expect(canRaise(data, ONE_EACH, {}, 'might')).toBe(true);
    expect(canRaise(data, { id: 'x', label: 'X', from: 'Y' }, {}, 'might')).toBe(false);
  });

  it('a point on and off, an emptied one left out', () => {
    let spreads = withRaised({}, 'asi', 'might', 1);
    expect(spreads).toEqual({ asi: { might: 1 } });
    spreads = withRaised(withRaised(spreads, 'asi', 'wits', 1), 'boost', 'wits', 1);
    expect(spreads).toEqual({ asi: { might: 1, wits: 1 }, boost: { wits: 1 } });
    spreads = withRaised(spreads, 'asi', 'might', -1);
    expect(spreads).toEqual({ asi: { wits: 1 }, boost: { wits: 1 } });
    expect(withRaised(spreads, 'boost', 'wits', -1)).toEqual({ asi: { wits: 1 } });
    expect(withRaised({}, 'asi', 'might', -1)).toEqual({});
  });

  it('FINISH waits for every point of each', () => {
    const unlocked = [ASI, ONE_EACH, { id: 'extra', label: 'Extra', from: 'Soldier' } as Unlocked];
    expect(increasesSpent(unlocked, {})).toBe(false);
    expect(increasesSpent(unlocked, { asi: { might: 1, wits: 1 } })).toBe(false);
    expect(increasesSpent([ASI], { asi: { might: 1 } })).toBe(false);
    expect(increasesSpent([ASI], { asi: { might: 2 } })).toBe(true);
    expect(increasesSpent(unlocked, { asi: { wits: 2 }, boost: { might: 1, wits: 1 } })).toBe(true);
    expect(increasesSpent([{ id: 'extra', label: 'Extra', from: 'Soldier' } as Unlocked], {})).toBe(true);
  });
});

describe('OR A FEAT INSTEAD (7d6c)', () => {
  const STATS = [{ id: 'might', label: 'Might' }];
  const ASI = { id: 'asi', label: 'Ability Score Improvement', from: 'Soldier', increase: { points: 2, most: 2, stats: STATS, instead: 'archetypes' } } as Unlocked;
  const PLAIN = { id: 'plain', label: 'Plain', from: 'Soldier', increase: { points: 1, most: 1, stats: STATS } } as Unlocked;
  const CHAMPION = { list: 'archetypes', option: 'champion', from: 'asi' };

  it('taken: a pick from its list, under it', () => {
    expect(insteadTaken([CHAMPION], ASI)).toBe(true);
    expect(insteadTaken([{ ...CHAMPION, from: 'other' }], ASI)).toBe(false);
    expect(insteadTaken([{ ...CHAMPION, list: 'drills' }], ASI)).toBe(false);
    expect(insteadTaken([CHAMPION], PLAIN)).toBe(false);
  });

  it('asked as one pick from its list, what is held left out', () => {
    const asked = insteadAsked(TEMPLATE, sheet([{ list: 'classes', option: 'soldier', level: 1 }], 1), ASI)!;
    expect(asked).toMatchObject({ feature: 'asi', count: 1, rolled: false });
    expect(asked.list.id).toBe('archetypes');
    expect(asked.options.map((o) => o.option.id)).toEqual(['champion']);
    expect(insteadAsked(TEMPLATE, sheet([], 1), PLAIN)).toBeNull();
    expect(insteadAsked(TEMPLATE, sheet([], 1), { ...ASI, increase: { ...ASI.increase!, instead: 'classes' } })).toBeNull();
  });

  it('FINISH goes with the points or the pick', () => {
    expect(increasesSpent([ASI], {}, [])).toBe(false);
    expect(increasesSpent([ASI], {}, [CHAMPION])).toBe(true);
    expect(increasesSpent([ASI], { asi: { might: 2 } })).toBe(true);
    expect(increasesSpent([ASI, PLAIN], {}, [CHAMPION])).toBe(false);
  });

  it('a feature\'s spread taken away', () => {
    expect(withoutSpread({ asi: { might: 1 }, plain: { might: 1 } }, 'asi')).toEqual({ plain: { might: 1 } });
    expect(withoutSpread({}, 'asi')).toEqual({});
  });
});

describe('the GM counts picks they don\'t meet (7d7a)', () => {
  const asked = { feature: 'path', list: { id: 'paths', one: 'Path', many: 'Paths' }, count: 2, rolled: false,
    options: [{ option: { id: 'a', label: 'A' }, unmet: 'MIGHT >= 15' }, { option: { id: 'b', label: 'B' }, unmet: null }] } as never;
  it('wanted, and made', () => {
    expect(picksWanted(asked)).toBe(1);
    expect(picksWanted(asked, true)).toBe(2);
    const one = [{ list: 'paths', option: 'b', from: 'path' }];
    expect(picksMade([asked], one)).toBe(true);
    expect(picksMade([asked], one, true)).toBe(false);
    expect(picksMade([asked], [...one, { list: 'paths', option: 'a', from: 'path' }], true)).toBe(true);
  });
});
