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

describe('a hit\'s line and a typed DAMAGE (8b5c)', () => {
  const ROLL = 'Kes rolled Flame Tongue DAMAGE 4 SLASHING + 6 FIRE DMG [0 + 4] + [0 + 6] = 4 SLASHING + 6 FIRE DMG (10)';
  it('what a hit took, last, marked a hit; never what comes before it', () => {
    const line = `${ROLL} → GHOUL · RESISTS FIRE: 6 → 3 · HIDDEN FROM PLAYERS · TAKES 7 OF 10`;
    expect(totalIn(line)).toEqual({ before: line.slice(0, -'TAKES 7 OF 10'.length), total: 'TAKES 7 OF 10', after: '', hit: true });
    expect(total(`${ROLL} → GHOUL · NOT APPLIED: APPLY DAMAGE IS OFF · WOULD TAKE 10`)).toBe('WOULD TAKE 10');
    expect(total('Kes rolled Club DAMAGE 5 [0 + 5 = 5] → GHOUL · TAKES 5')).toBe('TAKES 5');
  });

  it("a to-hit: HIT or MISS after its target, marked a hit; a symbol roll's own HIT inside its dice part never", () => {
    expect(totalIn('Kes rolled 1d20 [(13) = 13] → GHOUL · VS AC 12 · HIT')).toEqual({ before: 'Kes rolled 1d20 [(13) = 13] → GHOUL · VS AC 12 · ', total: 'HIT', after: '', hit: true });
    expect(total('Kes rolled 1d20 [(3) = 3] → GHOUL · MISS')).toBe('MISS');
    expect(totalIn('K rolled 2×Good [✶◆ ✶ = 2 HIT, 1 EDGE]')).toMatchObject({ total: '2 HIT, 1 EDGE' });
    expect(totalIn('K rolled Check [(4, 5) | 9 + 3 = 12 · 1 HIT]')!.hit).toBeUndefined();
    // HIT last with no target before it: not a to-hit.
    expect(totalIn('K rolled Strike [5] · HIT')).toMatchObject({ total: '5' });
  });

  it('a typed DAMAGE\'s whole after its dice, up to where a hit\'s words begin; not a hit', () => {
    expect(totalIn(ROLL)).toEqual({ before: ROLL.slice(0, -'4 SLASHING + 6 FIRE DMG (10)'.length), total: '4 SLASHING + 6 FIRE DMG (10)', after: '' });
    expect(total(`${ROLL} → GHOUL`)).toBe('4 SLASHING + 6 FIRE DMG (10)');
    expect(totalIn(`${ROLL} → GHOUL`)!.after).toBe(' → GHOUL');
    expect(total('Kes rolled Torch DAMAGE 2d6 FIRE DMG [(3, 3)] = 6 FIRE DMG')).toBe('6 FIRE DMG');
    // Nothing after it: the dice part's own, as before.
    expect(total('rolled [5] = ')).toBe('5');
    // A plain roll's own = inside its brackets: as before.
    expect(total('Sam rolled Save (Might) [3 + 13 = 16] — vs 15: SUCCESS')).toBe('16');
  });
});
