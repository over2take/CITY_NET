import { describe, it, expect } from 'vitest';
import { partShown, cellShown, textsToRead, type WorkedPart } from '../gearWorked';
import type { GearDiceRead } from '../gearDice';

// A line's numbers worked out on the character (8e1; approved mockup docs/mockups/gear-table.html, answered 2026-11-25:
// a lone d20 its bonus, other dice with their sum, the formula behind a "?").

const part = (dice: [number, number][], add: number, type: string | null = null): WorkedPart => ({ dice: dice.map(([count, sides]) => ({ count, sides })), add, type });

describe('a part as the line shows it', () => {
  it('a lone d20: its bonus, signed, nothing added +0', () => {
    expect(partShown(part([[1, 20]], 12), true)).toBe('+12');
    expect(partShown(part([[1, 20]], -1), true)).toBe('−1');
    expect(partShown(part([[1, 20]], 0), true)).toBe('+0');
  });
  it('a d20 among parts, two of them, or with another die: dice and sum, as any other', () => {
    expect(partShown(part([[1, 20]], 3), false)).toBe('1d20+3');
    expect(partShown(part([[2, 20]], 3), true)).toBe('2d20+3');
    expect(partShown(part([[1, 20], [1, 4]], 3), true)).toBe('1d20+1d4+3');
  });
  it('other dice with their sum, taken away said with a minus, none added nothing; no dice its number', () => {
    expect(partShown(part([[1, 8]], 7), true)).toBe('1d8+7');
    expect(partShown(part([[2, 6]], -1), true)).toBe('2d6−1');
    expect(partShown(part([[4, 6]], 0), false)).toBe('4d6');
    expect(partShown(part([], 3), true)).toBe('3');
    expect(partShown(part([], -2), true)).toBe('−2');
  });
});

describe('what a cell shows, from what the server read', () => {
  const read = (worked: WorkedPart[] | null, low = 1, high = 8, used: { token: string; label: string; value: number }[] = []): GearDiceRead =>
    ({ ok: true, low, high, used, names: [], worked });
  it('before an answer, or blank: as before', () => {
    expect(cellShown('1d8', null)).toEqual({ kind: 'reading' });
    expect(cellShown('1d8', undefined)).toEqual({ kind: 'reading' });
    expect(cellShown('1d8', { ok: true, blank: true, names: [] })).toEqual({ kind: 'reading' });
  });
  it('worked: each part shown with its type, the "?" the formula, its names on this character, the sum and the range', () => {
    const r = cellShown(' 1d6 + @str_mod PIERCING + 4d6 LIGHTNING DMG ', read([part([[1, 6]], 4, 'PIERCING'), part([[4, 6]], 0, 'LIGHTNING')], 9, 34,
      [{ token: '@str_mod', label: 'STR mod', value: 4 }]));
    expect(r).toEqual({
      kind: 'roll',
      parts: [{ text: '1d6+4', type: 'PIERCING' }, { text: '4d6', type: 'LIGHTNING' }],
      hint: '1d6 + @str_mod PIERCING + 4d6 LIGHTNING DMG · on this character 1d6 + STR mod (4) PIERCING + 4d6 LIGHTNING DMG = 1d6 + 4 PIERCING + 4d6 LIGHTNING (9 to 34)',
    });
    // One part: a lone d20 says its bonus; its sum said in words with a minus; one number, its range so.
    expect(cellShown('1d20 - 1', read([part([[1, 20]], -1)], 0, 19))).toMatchObject({ parts: [{ text: '−1', type: null }], hint: '1d20 - 1 = 1d20 − 1 (0 to 19)' });
    expect(cellShown('3', read([part([], 3)], 3, 3))).toMatchObject({ parts: [{ text: '3' }], hint: '3 = 3 (3)' });
    // A d20 among a DAMAGE's parts keeps its die.
    expect(cellShown('1d20 + 3 FIRE + 1d4 COLD DMG', read([part([[1, 20]], 3, 'FIRE'), part([[1, 4]], 0, 'COLD')], 5, 27))).toMatchObject({ parts: [{ text: '1d20+3' }, { text: '1d4' }] });
    expect(cellShown('0', read([part([], 0)], 0, 0))).toMatchObject({ hint: '0 = 0 (0)' });
    expect(cellShown('1d4', read([part([[1, 4]], 0)], 1, 4))).toMatchObject({ hint: '1d4 = 1d4 (1 to 4)' });
    expect(cellShown('-2', read([part([], -2)], -2, -2))).toMatchObject({ hint: '-2 = −2 (-2)' });
  });
  it('no plain sum: as typed, the "?" the range; won\'t roll: the "?" saying why', () => {
    expect(cellShown('10 - 1d4', read(null, 6, 9))).toEqual({ kind: 'as typed', hint: '10 - 1d4: 6 to 9' });
    expect(cellShown('10 - 1d4', read([], 6, 9))).toMatchObject({ kind: 'as typed' });
    expect(cellShown('1d6 + @gone', { ok: false, error: "@gone isn't one of this system's names" }))
      .toEqual({ kind: 'wont', hint: "1d6 + @gone: @gone isn't one of this system's names. It won't roll." });
  });
});

describe('what one reading asks', () => {
  it('each DAMAGE and DICE text once, in the order met; blank and other columns left out', () => {
    expect(textsToRead([
      { kind: 'damage', text: '1d8' }, { kind: 'dice', text: '1d20 + 2' }, { kind: 'damage', text: '1d8' },
      { kind: 'text', text: '5 ft.' }, { kind: 'count', text: '6' }, { kind: 'dice', text: '  ' },
    ])).toEqual(['1d8', '1d20 + 2']);
  });
});
