import { describe, it, expect } from 'vitest';
import { characterLevel, xpMeter, xpMeterWords, XP_KEY } from '../xpMeter';
import { WORKED_KEY } from '../choicesShown';
import type { SheetTemplate } from '../types';

/** The XP meter on a sheet, as logic (7d2a): how far, in how many cells, and what it says. */

const template = (table: Record<number, number>) => ({ levels: { table } }) as unknown as SheetTemplate;
const TABLE = template({ 2: 300, 3: 900, 4: 2100 });
const at = (xp: number, level = 1) => ({ [XP_KEY]: xp, [WORKED_KEY]: { levels: { level } } });

describe('whether there is one', () => {
  it('not without a table', () => {
    expect(xpMeter({} as SheetTemplate, at(5))).toBeNull();
    expect(xpMeter(null, at(5))).toBeNull();
  });
});

describe('the level', () => {
  it('from their levelled lists, or a stat called level, and at least 1', () => {
    expect(characterLevel({ [WORKED_KEY]: { levels: { level: 3 } } })).toBe(3);
    expect(characterLevel({ level: 4 })).toBe(4);
    expect(characterLevel({ [WORKED_KEY]: { levels: { level: 3 } }, level: 9 })).toBe(3);
    expect(characterLevel({ [WORKED_KEY]: { levels: { level: 0 } } })).toBe(1);
    expect(characterLevel({})).toBe(1);
    expect(characterLevel(null)).toBe(1);
  });
});

describe('how far', () => {
  it('counts from the level they\'re at, in twenty cells past 40 points', () => {
    const m = xpMeter(TABLE, at(600, 2))!;
    expect(m).toEqual({ xp: 600, level: 2, need: 900, cells: 20, lit: 10, ready: false });
  });

  it('level 1 counts from nothing', () => {
    expect(xpMeter(TABLE, at(150, 1))).toMatchObject({ need: 300, lit: 10 });
  });

  it('a cell per point at 40 or fewer, as the HP bar has', () => {
    const small = template({ 2: 40, 3: 81 });
    expect(xpMeter(small, at(7, 1))).toMatchObject({ cells: 40, lit: 7 });
    expect(xpMeter(small, at(50, 2))).toMatchObject({ cells: 20 });
    expect(xpMeter(template({ 2: 3 }), at(2, 1))).toMatchObject({ cells: 3, lit: 2 });
  });

  it('a cell lights once it is fully earned', () => {
    expect(xpMeter(TABLE, at(14, 1))!.lit).toBe(0);
    expect(xpMeter(TABLE, at(15, 1))!.lit).toBe(1);
    expect(xpMeter(TABLE, at(29, 1))!.lit).toBe(1);
  });

  it('full and ready at the threshold, and past it stays full', () => {
    expect(xpMeter(TABLE, at(899, 2))).toMatchObject({ ready: false, lit: 19 });
    expect(xpMeter(TABLE, at(900, 2))).toMatchObject({ ready: true, lit: 20 });
    expect(xpMeter(TABLE, at(5000, 2))).toMatchObject({ ready: true, lit: 20 });
  });

  it('XP below their level, put there by the GM, shows nothing lit', () => {
    expect(xpMeter(TABLE, at(10, 3))).toMatchObject({ xp: 10, lit: 0, ready: false });
  });

  it('what carried over counts toward the next level once they go up', () => {
    expect(xpMeter(TABLE, at(1000, 2))!.ready).toBe(true);
    const after = xpMeter(TABLE, at(1000, 3))!;
    expect(after).toMatchObject({ need: 2100, ready: false, lit: 1 });
  });

  it('nothing past the highest level: full, never ready', () => {
    expect(xpMeter(TABLE, at(9999, 4))).toEqual({ xp: 9999, level: 4, need: null, cells: 20, lit: 20, ready: false });
    expect(xpMeter(TABLE, at(0, 9))).toMatchObject({ need: null });
  });

  it('XP that doesn\'t read is nothing', () => {
    expect(xpMeter(TABLE, { [XP_KEY]: 'lots' })).toMatchObject({ xp: 0 });
    expect(xpMeter(TABLE, { [XP_KEY]: -5 })).toMatchObject({ xp: 0 });
    expect(xpMeter(TABLE, { [XP_KEY]: 7.9 })).toMatchObject({ xp: 7 });
    expect(xpMeter(TABLE, undefined)).toMatchObject({ xp: 0, level: 1 });
  });

  it('a level typed over that doesn\'t climb can\'t divide by nothing', () => {
    const flat = template({ 2: 100, 3: 100 });
    expect(xpMeter(flat, at(100, 2))).toMatchObject({ cells: 1, ready: true });
  });
});

describe('what it says', () => {
  const words = (xp: number, level: number) => xpMeterWords(xpMeter(TABLE, at(xp, level))!);

  it('how much is left', () => {
    expect(words(600, 2)).toBe('600 / 900 · 300 TO LEVEL 3');
  });

  it('enough', () => {
    expect(words(900, 2)).toBe('900 / 900 · ENOUGH FOR LEVEL 3');
  });

  it('what carries over', () => {
    expect(words(1000, 2)).toBe('1000 / 900 · ENOUGH FOR LEVEL 3 · 100 CARRIES OVER');
  });

  it('the top', () => {
    expect(words(5000, 4)).toBe('5000 · THE HIGHEST LEVEL');
  });
});
