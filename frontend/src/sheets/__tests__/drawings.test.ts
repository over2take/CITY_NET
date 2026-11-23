import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import { BLANK_DRAWN, drawnAt, withSquare, drawnSquares } from '../drawings';

// A drawing from the builder's 16 by 16 pad (8b0, moved out of dice.ts): squares drawn and rubbed out, stored as the server
// keeps it (backend systemBuilder/drawings.js).

const req = createRequire(import.meta.url);
const backend = req('../../../../backend/systemBuilder/drawings.js');
const SKULL = ['07e0', '1ff8', '3ffc', '3ffc', '73ce', '6186', '6186', '73ce', '3e7c', '1ff8', '0ff0', '0db0', '0db0', '07e0', '0000', '0000'];

describe('a drawing on the pad', () => {
  it('blank as the server\'s blank', () => {
    expect(BLANK_DRAWN).toEqual([...backend.BLANK_DRAWN]);
    expect(backend.isDrawn(BLANK_DRAWN)).toBe(true);
  });

  it('drawn a square at a time, the row\'s highest bit its first square; outside the pad, nothing', () => {
    let d = BLANK_DRAWN;
    d = withSquare(d, 0, 0, true);
    d = withSquare(d, 15, 15, true);
    d = withSquare(d, 7, 3, true);
    expect([d[0], d[3], d[15]]).toEqual(['8000', '0100', '0001']);
    expect([drawnAt(d, 0, 0), drawnAt(d, 1, 0), drawnAt(d, 15, 15), drawnAt(d, 7, 3)]).toEqual([true, false, true, true]);
    expect(drawnSquares(d)).toEqual([[0, 0], [7, 3], [15, 15]]);
    expect(withSquare(d, 0, 0, false)[0]).toBe('0000');
    // Rubbing out a square never drawn leaves it blank.
    expect(withSquare(d, 1, 0, false)[0]).toBe('8000');
    expect(withSquare(d, 7, 3, true)).toEqual(d);
    expect(withSquare(d, 16, 0, true)).toEqual(d);
    expect(withSquare(d, -1, 0, true)).toEqual(d);
    expect(drawnAt(d, 0, 20)).toBe(false);
    expect(drawnSquares(SKULL).length).toBe(SKULL.reduce((n, row) => n + [...parseInt(row, 16).toString(2)].filter((b) => b === '1').length, 0));
  });

  it('any strokes at all make a drawing the server takes', () => {
    let d = BLANK_DRAWN;
    let seed = 3;
    for (let i = 0; i < 300; i += 1) { seed = (seed * 69069 + 1) % 4294967296; d = withSquare(d, seed % 16, (seed >> 4) % 16, !!(seed & 256)); }
    expect(backend.isDrawn(d)).toBe(true);
  });
});
