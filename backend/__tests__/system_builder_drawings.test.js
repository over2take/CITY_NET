import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

// A drawing from the builder's 16 by 16 pad (8b0, drawings.js): what is one, as everything that takes one checks it.

const require_ = createRequire(import.meta.url);
const { SIZE, isDrawn, DRAWN_PROBLEM, BLANK_DRAWN } = require_('../systemBuilder/drawings');
const { checkDice } = require_('../systemBuilder/diceFaces');

const ROW = 'f00f';

describe('a drawing', () => {
  it('16 rows of 4 lowercase hex digits; the blank one is one', () => {
    expect(SIZE).toBe(16);
    expect(isDrawn(Array(16).fill(ROW))).toBe(true);
    expect(isDrawn(BLANK_DRAWN)).toBe(true);
    expect(BLANK_DRAWN).toEqual(Array(16).fill('0000'));
    expect(Object.isFrozen(BLANK_DRAWN)).toBe(true);
  });

  it('anything else is not: a row short or long, too few or too many rows, capitals, not hex, not text, not a list', () => {
    for (const rows of [
      Array(15).fill(ROW), Array(17).fill(ROW), [...Array(15).fill(ROW), 'f0f'], [...Array(15).fill(ROW), 'f00ff'],
      [...Array(15).fill(ROW), 'F00F'], [...Array(15).fill(ROW), 'g00f'], [...Array(15).fill(ROW), 0xf00f],
      // A number that reads as four digits is still not a row.
      [...Array(15).fill(ROW), 4660],
      'f00f'.repeat(16), null, undefined, {},
    ]) expect(isDrawn(rows)).toBe(false);
  });

  it('the dice\'s symbols check theirs here, saying why', () => {
    const problems = [];
    checkDice({ symbols: [{ id: 'skull', name: 'Skull', drawn: ['zz'] }] }, problems);
    expect(problems).toContainEqual({ where: 'symbol skull, drawn', message: DRAWN_PROBLEM });
    const fine = [];
    checkDice({ symbols: [{ id: 'skull', name: 'Skull', drawn: [...BLANK_DRAWN] }] }, fine);
    expect(fine).toEqual([]);
  });
});
