import { describe, it, expect } from 'vitest';
import {
  showOf, pageOf, pagesOf, sayOf, boardText, centerLine, emptyField, putShow, putNoise, putReady, putChar, decodedAt,
  COLS, WIDTH, HEIGHT, PAGE_MS, SETTLE_MS, type BoardRoll,
} from '../trayBoard';

const d6 = (total: number, board?: BoardRoll['board']): BoardRoll => ({ total, results: { 6: [total] }, ...(board ? { board } : {}) });
const lit = (f: number[][]) => f.flat().filter(Boolean).length;

describe('what the board shows (6c4e)', () => {
  it('a lone plain total in big digits, as the old board did', () => {
    expect(showOf([d6(9)])).toEqual({ big: '9' });
    expect(showOf([{ total: -3, results: { dF: [-1, -1, -1] } }])).toEqual({ big: '-3' });
    expect(showOf([{ total: 1234, results: { 20: [1] } }])).toEqual({ big: '1234' });
    // Five figures don't fit big: written instead.
    expect(showOf([{ total: 12345, results: { 20: [1] } }])).toEqual({ lines: ['12345'] });
  });

  it('a named roll on its line, its outcome on the next (decided 2026-10-23)', () => {
    expect(showOf([d6(17, { label: 'Athletics' })])).toEqual({ lines: ['ATHLETICS 17'] });
    expect(showOf([d6(14, { label: 'PHYSICAL SAVE', outcome: 'SUCCESS' })])).toEqual({ lines: ['PHYSICAL SAVE 14', 'SUCCESS'] });
    // On its own line even where it would fit beside the roll.
    expect(showOf([d6(15, { label: 'TO HIT', outcome: 'HIT' })])).toEqual({ lines: ['TO HIT 15', 'HIT'] });
    // A name too long to share a line breaks at its spaces.
    expect(showOf([d6(9, { label: 'THE UNSEEN HAND OF FATE' })])).toEqual({ lines: ['THE UNSEEN HAND', 'OF FATE 9'] });
  });

  it('symbols left and word faces, two spaces between, wrapped greedily, the outcome after', () => {
    expect(showOf([{ total: 1, results: { Good: ['✶'] }, board: { label: 'Fight', words: '1 HIT · 1 EDGE', outcome: 'vs 1: SUCCESS' } }]))
      .toEqual({ lines: ['FIGHT 1 HIT', '1 EDGE', 'VS 1: SUCCESS'] });
    expect(showOf([{ total: 0, results: { punk: ['apple', 'peach'] }, board: { words: 'APPLE · PEACH' } }])).toEqual({ lines: ['APPLE  PEACH'] });
    // An item that fits a line is kept whole rather than broken across two.
    expect(showOf([{ total: 0, results: { Good: ['·'] }, board: { label: '3×Good', words: 'NOTHING LEFT' } }])).toEqual({ lines: ['3XGOOD', 'NOTHING LEFT'] });
  });

  it('a group, each roll its line, the outcome beside it where it fits: TO HIT 15 / DAMAGE 7', () => {
    expect(showOf([d6(15, { label: 'TO HIT', outcome: 'HIT' }), d6(7, { label: 'DAMAGE', outcome: 'DOWN' })]))
      .toEqual({ lines: ['TO HIT 15 HIT', 'DAMAGE 7 DOWN'] });
    expect(showOf([d6(4, { label: 'DAMAGE', outcome: 'CRITICAL INJURY' })])).toEqual({ lines: ['DAMAGE 4', 'CRITICAL INJURY'] });
    // Too long to sit beside it: its own line.
    expect(showOf([d6(15, { label: 'TO HIT', outcome: 'HIT' }), d6(12, { label: 'DAMAGE', outcome: 'CRITICAL INJURY' })]))
      .toEqual({ lines: ['TO HIT 15 HIT', 'DAMAGE 12', 'CRITICAL INJURY'] });
    // A plain roll in a group is written, not drawn big.
    expect(showOf([d6(3), d6(5)])).toEqual({ lines: ['3', '5'] });
  });

  it('a roll of no dice says only what it was, unless it came to something', () => {
    expect(showOf([{ total: 0, results: {}, board: { label: 'Mend' } }])).toEqual({ lines: ['MEND'] });
    expect(showOf([{ total: 3, results: {}, board: { label: 'SHOCK' } }])).toEqual({ lines: ['SHOCK 3'] });
  });

  it('draws what it can: capitals, look-alikes, a space for the rest', () => {
    expect(boardText('2×good — a’s ✶ ok?')).toBe("2XGOOD - A'S   OK?");
    expect(boardText('  many   spaces ')).toBe('MANY SPACES');
  });
});

describe('the two lines on show', () => {
  it('centered, the odd space to the right, a single line on the lower one', () => {
    expect(centerLine('HIT')).toBe('      HIT       ');
    expect(centerLine('X'.repeat(20))).toBe('X'.repeat(16));
    expect(pageOf(['ATHLETICS 17'], 0)).toEqual([' '.repeat(16), centerLine('ATHLETICS 17')]);
  });

  it('turn pages when there are more than two, coming round again', () => {
    const lines = ['A', 'B', 'C'];
    expect(pagesOf({ lines })).toBe(2);
    expect(pageOf(lines, 0)).toEqual([centerLine('A'), centerLine('B')]);
    expect(pageOf(lines, PAGE_MS)).toEqual([centerLine('C'), centerLine('')]);
    expect(pageOf(lines, PAGE_MS * 2)).toEqual([centerLine('A'), centerLine('B')]);
    expect(pagesOf({ big: '9' })).toBe(1);
    expect(pagesOf({ lines: ['A'] })).toBe(1);
  });

  it('say what they show, for a screen reader', () => {
    expect(sayOf({ big: '9' })).toBe('9');
    expect(sayOf({ lines: ['TO HIT 15 HIT', 'DAMAGE 7'] })).toBe('TO HIT 15 HIT / DAMAGE 7');
  });
});

describe('the field of dots', () => {
  it('is 16 by 2 cells of 5 by 7', () => {
    const f = emptyField();
    expect([f.length, f[0].length, WIDTH, HEIGHT]).toEqual([14, 80, 80, 14]);
  });

  it('a character fills its own cell only', () => {
    const f = emptyField();
    putChar(f, 1, 3, 'I');
    for (let y = 0; y < HEIGHT; y += 1) for (let x = 0; x < WIDTH; x += 1) {
      if (f[y][x]) expect(y >= 7 && x >= 15 && x < 20, `${x},${y}`).toBe(true);
    }
    expect(lit(f)).toBe(11);
  });

  it('big digits span both lines, centered', () => {
    const f = emptyField();
    putShow(f, { big: '8' }, 0);
    const xs = f.flatMap((row) => row.map((v, x) => (v ? x : -1)).filter((x) => x >= 0));
    expect([Math.min(...xs), Math.max(...xs)]).toEqual([34, 45]);
    expect(f[0].some(Boolean) && f[HEIGHT - 1].some(Boolean)).toBe(true);
  });

  it('decodes left to right over SETTLE_MS, noise in the cells not yet decoded', () => {
    expect([decodedAt(0), decodedAt(SETTLE_MS / 2), decodedAt(SETTLE_MS), decodedAt(SETTLE_MS * 9)]).toEqual([0, 8, COLS, COLS]);
    const f = emptyField();
    putShow(f, { lines: ['HIT'] }, 0);
    const shown = f.map((row) => [...row]);
    putNoise(f, 8, () => 0);
    // Cells 0-7 untouched, 8-15 an 'A' each (the first of the noise).
    for (let y = 0; y < HEIGHT; y += 1) for (let x = 0; x < 40; x += 1) expect(f[y][x]).toBe(shown[y][x]);
    // An A's top row: .###.
    expect([0, 1, 2, 3, 4].map((x) => f[0][40 + x])).toEqual([0, 1, 1, 1, 0]);
  });

  it('waits on DICE_TRAY.EXE and a blinking READY_', () => {
    const on = emptyField(); putReady(on, 600);
    const off = emptyField(); putReady(off, 0);
    expect(lit(on)).toBe(lit(off) + 5);
  });
});
