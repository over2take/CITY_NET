import { describe, it, expect } from 'vitest';
import { totalIn } from '../rollTotal';

/** The final total of a roll line, for the dice history to bold (the user, 2026-11-11). */

const total = (line: string) => totalIn(line)?.total ?? null;

describe('a roll line\'s final total', () => {
  it('what follows the last = in the dice part, or the lone number with nothing added', () => {
    expect(total('Sam rolled Save (Might) [3 + 13 = 16] — vs 15: SUCCESS')).toBe('16');
    expect(total('Sam rolled Check (Wits) [(4, 2) | 6 + 13 = 19]')).toBe('19');
    expect(total('Sam rolled Pool (Str) [(7, 2 miss, 10 Hunger) = 2]')).toBe('2');
    expect(total('Kestrel rolled Save (Save) for Rex [17] — vs 15: SUCCESS')).toBe('17');
    expect(total('Sam rolled 1d20 + 13 [(3) + 13 = 16]')).toBe('16');
    expect(total('K rolled 3×dF [(+1, 0, -1) = -1]')).toBe('-1');
    // A line from before 2026-11-11, still in the history: the last =.
    expect(total('Sam rolled Save (Might) [3 = 3 + 13 = 16]')).toBe('16');
    // A later [ ] is not the dice part.
    expect(total('Sam rolled Save [5] — note [x]')).toBe('5');
  });

  it('never what is said after a ·, nor anything outside the dice part', () => {
    expect(total('K rolled 2×Good [✶◆ ✶ = 2 HIT, 1 EDGE]')).toBe('2 HIT, 1 EDGE');
    expect(total('K rolled Check [(4, 5) | 9 + 3 = 12 · 1 HIT] — FULL = 3')).toBe('12');
    expect(total('K rolled Check (Push: +2 STRESS) [5 + 5 = 10]')).toBe('10');
  });

  it('the line in three, put back together unchanged', () => {
    const line = 'Sam rolled Save (Might) [3 + 13 = 16] — vs 15: SUCCESS';
    const split = totalIn(line)!;
    expect(split).toEqual({ before: 'Sam rolled Save (Might) [3 + 13 = ', total: '16', after: '] — vs 15: SUCCESS' });
    expect(split.before + split.total + split.after).toBe(line);
    expect(totalIn('Sam rolled [17]')).toEqual({ before: 'Sam rolled [', total: '17', after: ']' });
  });

  it('nothing to find: no dice part, or an empty one', () => {
    expect(totalIn('SHORT REST called')).toBeNull();
    expect(totalIn('rolled [ ]')).toBeNull();
    expect(totalIn('rolled [ = ]')).toBeNull();
    expect(totalIn('rolled [ 5')).toBeNull();
  });
});
