/**
 * NPC tiers that roll (4b4a1). Approved mockup builder-npcs (2026-10-07): a tier is a difficulty,
 * GENERATE_SHEET asks for a level, and each box is a number, a formula with @level, or dice.
 * Dice come from a fixed sequence here, so every roll is known.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require_ = createRequire(import.meta.url);
const { rollBox, rollTier, boxProblem, levelOf } = require_('../systemBuilder/tierRolls');

/** Dice that come up as listed, in order: a 4 on a d6 is 0.5 of the way (floor(0.5 * 6) + 1). */
const faces = (...rolls) => (sides) => { let i = 0; return () => (rolls[i++] - 1) / sides + 1e-9; };

describe('a box', () => {
  it('is a number as it is, rounded', () => {
    expect(rollBox(14, 3)).toEqual({ value: 14, dice: [] });
    expect(rollBox(2.5, 3)).toEqual({ value: 3, dice: [] });
    expect(rollBox('14', 3)).toEqual({ value: 14, dice: [] });
  });

  it('works a formula out for the level', () => {
    expect(rollBox('12 + floor(@level / 3)', 7).value).toBe(14);
    expect(rollBox('@level * 2', 0).value).toBe(0);
    expect(rollBox('max(@level, 5)', 3).value).toBe(5);
    // A whole number, halves up.
    expect(rollBox('@level / 2', 3).value).toBe(2);
    expect(rollBox('@level / 4', 3).value).toBe(1);
  });

  it('rolls dice, one roll per die, and says what came up', () => {
    expect(rollBox('3d6 + 2', 1, faces(4, 1, 6)(6))).toEqual({ value: 13, dice: [{ count: 3, sides: 6, rolls: [4, 1, 6] }] });
    expect(rollBox('d20', 1, faces(17)(20))).toEqual({ value: 17, dice: [{ count: 1, sides: 20, rolls: [17] }] });
    expect(rollBox('2D4', 1, faces(1, 2)(4)).value).toBe(3);
  });

  it('rolls as many dice as the level', () => {
    expect(rollBox('@level d8 + 4', 3, faces(8, 1, 5)(8))).toEqual({ value: 18, dice: [{ count: 3, sides: 8, rolls: [8, 1, 5] }] });
    expect(rollBox('@level  d8', 2, faces(2, 2)(8)).value).toBe(4);
    // Run together it reads as one name, and says so.
    expect(rollBox('@leveld8', 2)).toEqual({ error: 'Only @level can be used here, not @leveld8' });
    expect(rollBox('@level d8', 0)).toEqual({ value: 0, dice: [{ count: 0, sides: 8, rolls: [] }] });
  });

  it('mixes dice of different sizes, each rolled once', () => {
    const r = rollBox('1d4 + 1d6 + @level', 2, (() => { const seq = [0, 0.99]; let i = 0; return () => seq[i++]; })());
    expect(r).toEqual({ value: 9, dice: [{ count: 1, sides: 4, rolls: [1] }, { count: 1, sides: 6, rolls: [6] }] });
  });

  it('never takes a name containing d and digits for dice', () => {
    expect(boxProblem('@hd6 + 1')).toBe('Only @level can be used here, not @hd6');
    expect(rollBox('floor(7 / 2)', 1).value).toBe(3);
  });

  it('is blank when empty', () => {
    expect(rollBox('', 3)).toEqual({ blank: true });
    expect(rollBox('  ', 3)).toEqual({ blank: true });
    expect(rollBox(undefined, 3)).toEqual({ blank: true });
    expect(rollBox(null, 3)).toEqual({ blank: true });
  });

  it('says what is wrong rather than guessing', () => {
    expect(rollBox('12 + oops', 1)).toEqual({ error: expect.stringMatching(/Unknown function|oops/) });
    expect(rollBox('@str + 1', 1)).toEqual({ error: 'Only @level can be used here, not @str' });
    expect(rollBox('$armor_soak', 1)).toEqual({ error: 'Only @level can be used here' });
    expect(rollBox('3d1', 1)).toEqual({ error: 'A die has 2 to 1000 sides' });
    expect(rollBox('2d1001', 1)).toEqual({ error: 'A die has 2 to 1000 sides' });
    expect(rollBox('101d6', 1)).toEqual({ error: 'At most 100 dice' });
    expect(rollBox(Infinity, 1)).toEqual({ error: 'Not a number' });
  });

  it('never shows the dice\'s stand-in names in a mistake', () => {
    for (const bad of ['3d6 3d6', '2d6 +', '(1d4', '@level d8 @level']) {
      const r = rollBox(bad, 1);
      expect(r.error, bad).toBeTruthy();
      expect(r.error, bad).not.toMatch(/tier_die|at character/);
    }
    expect(rollBox('3d6 3d6', 1).error).toMatch(/dice/);
  });

  it('never rolls more than a hundred dice at the top level', () => {
    expect(rollBox('@level d6', 99, () => 0).dice[0].count).toBe(99);
  });
});

describe('checking a box', () => {
  it('passes numbers, formulas, dice and nothing', () => {
    for (const ok of [14, '14', '12 + floor(@level / 3)', '3d6', '@level d8 + 4', '', undefined, null]) expect(boxProblem(ok), String(ok)).toBeNull();
  });

  it('names the problem', () => {
    expect(boxProblem('3d6 +')).toMatch(/./);
    expect(boxProblem('@str')).toBe('Only @level can be used here, not @str');
    expect(boxProblem(['3d6'])).toBe('A number, a formula or dice');
  });
});

describe('the level', () => {
  it('is a whole number from 0 to 99, 1 when none is given', () => {
    expect([undefined, null, '', 'x', 3, 3.6, -2, 150, '7'].map(levelOf)).toEqual([1, 1, 1, 1, 3, 4, 0, 99, 7]);
  });
});

describe('a tier', () => {
  const fields = new Map([
    ['level', { id: 'level', type: 'number' }], ['str', { id: 'str', type: 'number' }],
    ['tactics', { id: 'tactics', type: 'text' }], ['morale', { id: 'morale', type: 'select' }],
  ]);
  const LIMITS = { hp: 9999, defense: 99 };
  const BOSS = { id: 'boss', label: 'BOSS', hp: '@level d10 + 10', defense: '14 + floor(@level / 2)',
    values: { level: '@level', str: '4d6', tactics: 'Calls for backup', morale: 'Fanatic' } };

  it('rolls HP, defense and number fields for the level, and sets the rest as written', () => {
    const r = rollTier(BOSS, 2, fields, LIMITS, faces(10, 3, 6, 6, 6, 6)(10));
    expect(r.level).toBe(2);
    expect(r.hp).toEqual({ value: 23, dice: [{ count: 2, sides: 10, rolls: [10, 3] }] });
    expect(r.defense).toEqual({ value: 15, dice: [] });
    expect(r.values.level).toEqual({ value: 2, dice: [] });
    expect(r.values.str.dice[0].count).toBe(4);
    expect(r.values.tactics).toEqual({ value: 'Calls for backup', dice: [] });
    expect(r.values.morale).toEqual({ value: 'Fanatic', dice: [] });
  });

  it('keeps HP and defense within the token\'s limits', () => {
    const r = rollTier({ hp: '20000', defense: '-5 + @level' }, 1, fields, LIMITS);
    expect(r.hp.value).toBe(9999);
    expect(r.defense.value).toBe(0);
  });

  it('leaves out what a tier leaves blank, and fixed numbers as they were', () => {
    const r = rollTier({ hp: 5, values: { str: 12 } }, 4, fields, LIMITS);
    expect(r.hp).toEqual({ value: 5, dice: [] });
    expect(r.defense).toEqual({ blank: true });
    expect(r.values).toEqual({ str: { value: 12, dice: [] } });
  });
});
