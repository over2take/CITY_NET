import { describe, it, expect } from 'vitest';
import { levelRecord, levelTools, recordHead, spreadWords, type RecordLevel } from '../levelRecord';
import type { SheetTemplate } from '../types';

/**
 * WHAT EACH LEVEL GAINED (7d7b2; approved mockup docs/mockups/level-record.html, 2026-11-09): the record, as the
 * last save worked it out (backend healthLevels.js under _health, choices.js workedOf under _worked), in words.
 */

const STATS = [{ id: 'mgt', label: 'Might' }, { id: 'wit', label: 'Wits' }];
const ASI = { id: 'asi', label: 'Ability Score Improvement', at: 4, increase: { points: 2, most: 1, stats: STATS, instead: 'feats' } };
const CLASSES = { id: 'classes', one: 'Class', many: 'Classes', picks: 'any', again: true, levelled: true, options: [
  { id: 'soldier', label: 'Soldier', features: [ASI] }, { id: 'mage', label: 'Mage', features: [] },
] };
const FEATS = { id: 'feats', one: 'Feat', many: 'Feats', picks: 'any', again: false, levelled: false, picked: 'features', options: [{ id: 'tough', label: 'Tough', features: [] }] };
const tpl = (gain = 'roll', health = true) => ({
  levels: { top: 10, ...(health ? { health: { gain, dieOn: 'class', dice: { soldier: 10, mage: 6 } } } : {}) }, choices: [CLASSES, FEATS],
}) as unknown as SheetTemplate;

const worked = (more: object = {}) => ({ picks: [{ list: 'classes', option: 'soldier', level: 4 }, { list: 'classes', option: 'mage', level: 1 }], levels: { level: 5 }, ...more });
const sheet = (levels: object[], adds = 2, more: object = {}) => ({ _health: { adds, max: 0, levels }, _worked: worked(), ...more });
const at = (data: object, level: number, t = tpl()) => levelRecord(t, data as never)!.health!.levels.find((l) => l.level === level)!;

describe('levelRecord: each level', () => {
  it('level 1 the full die; a roll; the average; set; cleared, all with what each level adds', () => {
    const data = sheet([
      { level: 1, took: 10, die: 10 }, { level: 2, took: 5, die: 10, rolled: true }, { level: 3, took: 3, die: 6 },
      { level: 4, took: 6, die: 10, set: true }, { level: 5, took: 5, die: 10, cleared: true },
    ]);
    const r = levelRecord(tpl(), data)!;
    expect(r.health!.levels.map((l) => [l.level, l.kept, l.gained, l.words])).toEqual([
      [1, 'first', 12, 'THE FULL D10, +2 EACH LEVEL'],
      [2, 'rolled', 7, 'ROLLED 5, +2 EACH LEVEL'],
      [3, 'average', 5, '3 AVERAGE, +2 EACH LEVEL'],
      [4, 'set', 8, 'SET TO 6 BY THE GM, +2 EACH LEVEL'],
      [5, 'cleared', 7, "5 AVERAGE TILL IT'S ROLLED AGAIN, +2 EACH LEVEL"],
    ]);
  });

  it('level 1 set by the GM; nothing each level; less than nothing, at least 1', () => {
    expect(at(sheet([{ level: 1, took: 4, die: 10, set: true }]), 1)).toMatchObject({ kept: 'set', gained: 6 });
    expect(at(sheet([{ level: 2, took: 5, die: 10, rolled: true }], 0), 2).words).toBe('ROLLED 5');
    expect(at(sheet([{ level: 2, took: 1, die: 10, rolled: true }], -3), 2)).toMatchObject({ gained: 1, words: 'ROLLED 1, −3 EACH LEVEL, AT LEAST 1' });
    // Exactly 1 is 1, not at least.
    expect(at(sheet([{ level: 2, took: 3, die: 10, rolled: true }], -2), 2)).toMatchObject({ gained: 1, words: 'ROLLED 3, −2 EACH LEVEL' });
  });

  it('no die: only what each level adds', () => {
    expect(at(sheet([{ level: 1, took: 0, die: null }]), 1)).toMatchObject({ die: null, words: 'NO DIE, +2 EACH LEVEL', gained: 2 });
    expect(at(sheet([{ level: 2, took: 0, die: null }]), 2).words).toBe('NO DIE, +2 EACH LEVEL');
    expect(at(sheet([{ level: 2, took: 0 }]), 2).die).toBeNull();
  });

  it('a reroll and a roll to beat keep what they gained, said as such; the GM\'s level up with none, nothing', () => {
    expect(at(sheet([{ level: 2, took: 31, die: 10, rolled: true, gained: 4 }]), 2, tpl('reroll'))).toMatchObject({ kept: 'reroll', gained: 4, words: 'REROLLED EVERY LEVEL: 31' });
    expect(at(sheet([{ level: 2, took: 31, die: 10, rolled: true, gained: 4 }]), 2, tpl('beat'))).toMatchObject({ kept: 'beat', words: 'ROLLED 31 TO BEAT, BEATEN' });
    expect(at(sheet([{ level: 2, took: 15, die: 10, rolled: true, gained: 0 }]), 2, tpl('beat'))).toMatchObject({ gained: 0, words: 'ROLLED 15 TO BEAT, NOT BEATEN' });
    expect(at(sheet([{ level: 2, took: 0, die: 10, gained: 0 }]), 2, tpl('beat'))).toMatchObject({ kept: 'none', gained: 0, words: 'NOTHING GAINED' });
  });

  it('the maximum as the server worked it out, or added up', () => {
    const levels = [{ level: 1, took: 10, die: 10 }, { level: 2, took: 5, die: 10, rolled: true }];
    expect(levelRecord(tpl(), { ...sheet(levels), _health: { adds: 2, max: 25, levels } })!.health!.max).toBe(25);
    expect(levelRecord(tpl(), { ...sheet(levels), _health: { adds: 2, levels } })!.health!.max).toBe(19);
  });

  it('what isn\'t a level is passed over', () => {
    expect(levelRecord(tpl(), sheet([{ level: 1, took: 10, die: 10 }, { level: 'x', took: 1 }, { level: 2 }, null]))!.health!.levels).toHaveLength(1);
  });
});

describe('levelRecord: when it shows', () => {
  it('none where levels are typed in, or with no health per level and no increase', () => {
    expect(levelRecord({ choices: [] } as unknown as SheetTemplate, sheet([]))).toBeNull();
    expect(levelRecord(null, sheet([]))).toBeNull();
    expect(levelRecord(tpl('roll', false), sheet([{ level: 1, took: 10, die: 10 }]))).toBeNull();
    expect(levelRecord(tpl(), { _worked: worked() })).toBeNull();
    // Levels typed in: an increase open isn't the sheet's to spend.
    expect(levelRecord({ choices: [CLASSES, FEATS] } as unknown as SheetTemplate, { _worked: worked({ increasesOpen: ['asi'] }) })).toBeNull();
  });

  it('the head: the level, and the maximum where health is per level', () => {
    expect(recordHead(levelRecord(tpl(), { ...sheet([{ level: 1, took: 10, die: 10 }]), _health: { adds: 2, max: 37, levels: [{ level: 1, took: 10, die: 10 }] } })!)).toBe('LEVELS · 5 · MAX HEALTH 37');
    const raising = levelRecord(tpl('roll', false), { _worked: worked({ increasesOpen: ['asi'] }) })!;
    expect(raising.health).toBeNull();
    expect(recordHead(raising)).toBe('LEVELS · 5');
  });
});

describe('levelRecord: increases', () => {
  const incs = (data: object) => levelRecord(tpl(), { _health: { adds: 0, max: 10, levels: [] }, ...data })!.increases;

  it('spent, in the stats\' own names, under the feature and what it came from', () => {
    expect(incs({ _worked: worked(), _increases: { asi: { mgt: 1, wit: 1 } } })).toEqual([
      expect.objectContaining({ feature: 'asi', label: 'Ability Score Improvement', from: 'Soldier', kept: 'spent', words: '+1 MIGHT, +1 WITS' }),
    ]);
  });

  it('open to spend, as the server says', () => {
    expect(incs({ _worked: worked({ increasesOpen: ['asi'] }) })).toEqual([expect.objectContaining({ kept: 'open', words: '2 POINTS TO SPEND' })]);
    const one = { ...tpl(), choices: [{ ...CLASSES, options: [{ id: 'soldier', label: 'Soldier', features: [{ ...ASI, increase: { ...ASI.increase, points: 1 } }] }] }] } as unknown as SheetTemplate;
    expect(levelRecord(one, { _health: { adds: 0, max: 10, levels: [] }, _worked: worked({ increasesOpen: ['asi'] }) })!.increases[0].words).toBe('1 POINT TO SPEND');
  });

  it('a pick taken in its place, from the list it offers', () => {
    const picks = [...worked().picks, { list: 'feats', option: 'tough', from: 'asi' }];
    expect(incs({ _worked: worked({ picks }) })).toEqual([expect.objectContaining({ kept: 'instead', words: 'FEAT · TOUGH, IN PLACE OF THE POINTS' })]);
    // One waiting, its feature locked again, isn't taken in its place.
    expect(incs({ _worked: worked({ picks: [...worked().picks, { list: 'feats', option: 'tough', from: 'asi', waiting: true }] }) })).toEqual([]);
  });

  it('not unlocked: not there', () => {
    expect(incs({ _worked: worked() })).toEqual([]);
  });

  it('a spread in words: a stat the increase doesn\'t name by its id; nothing on one left out', () => {
    expect(spreadWords(ASI.increase, { mgt: 2, luck: 1, wit: 0 })).toBe('+2 MIGHT, +1 LUCK');
  });
});

describe('levelTools', () => {
  const l = (kept: RecordLevel['kept'], level = 2, die: number | null = 10): RecordLevel => ({ level, die, took: 5, gained: 7, kept, words: '' });
  it('the GM: CLEAR THE ROLL on a past roll, SET TO with a die, CLEAR on one set', () => {
    expect(levelTools(l('rolled'), true)).toEqual({ clear: true, set: true, back: false, roll: false });
    expect(levelTools(l('reroll'), true).clear).toBe(true);
    expect(levelTools(l('beat'), true).clear).toBe(true);
    expect(levelTools(l('average'), true)).toEqual({ clear: false, set: true, back: false, roll: false });
    expect(levelTools(l('set'), true)).toEqual({ clear: false, set: true, back: true, roll: false });
    expect(levelTools(l('cleared'), true)).toEqual({ clear: false, set: true, back: false, roll: false });
    expect(levelTools(l('first', 1), true)).toEqual({ clear: false, set: true, back: false, roll: false });
    expect(levelTools(l('rolled', 1), true).clear).toBe(false);
    expect(levelTools(l('average', 2, null), true).set).toBe(false);
  });
  it('the player: only ROLL, on a level cleared with a die', () => {
    expect(levelTools(l('cleared'), false)).toEqual({ clear: false, set: false, back: false, roll: true });
    expect(levelTools(l('cleared', 2, null), false).roll).toBe(false);
    expect(levelTools(l('rolled'), false)).toEqual({ clear: false, set: false, back: false, roll: false });
    expect(levelTools(l('set'), false)).toEqual({ clear: false, set: false, back: false, roll: false });
  });
});
