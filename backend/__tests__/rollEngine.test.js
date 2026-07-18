import { describe, it, expect } from 'vitest';
import { parseFormula, resolveFormula, executeRoll } from '../sheets/rollEngine.js';
import { ROLLS, getRoll } from '../sheets/rolls.js';

// Deterministic RNG: feed die faces in order; each call returns a fraction
// that makes rollDie land exactly on the queued d10 face.
const d10rng = (...faces) => {
  const queue = [...faces];
  return () => (queue.shift() - 1 + 0.5) / 10;
};

describe('parseFormula', () => {
  it('parses dice, field refs, and literals with signs', () => {
    expect(parseFormula('1d10 + @ref - 2')).toEqual([
      { kind: 'dice', sign: 1, count: 1, sides: 10 },
      { kind: 'field', sign: 1, field: 'ref' },
      { kind: 'int', sign: -1, value: 2 },
    ]);
  });

  it('rejects garbage terms', () => {
    expect(() => parseFormula('1d10 + DROP TABLE')).toThrow();
    expect(() => parseFormula('!!')).toThrow();
  });

  it('rejects out-of-range dice', () => {
    expect(() => parseFormula('999d10')).toThrow();
    expect(() => parseFormula('1d1')).toThrow();
  });
});

describe('resolveFormula', () => {
  it('substitutes stored sheet values', () => {
    const r = resolveFormula('1d10 + @ref + @handgun', { ref: 7, handgun: 5 });
    expect(r.dice).toEqual([{ count: 1, sides: 10, sign: 1 }]);
    expect(r.modifiers).toEqual([
      { label: 'ref', value: 7 },
      { label: 'handgun', value: 5 },
    ]);
  });

  it('missing or non-numeric fields resolve to 0', () => {
    const r = resolveFormula('1d10 + @ref + @handgun', { ref: 'abc' });
    expect(r.modifiers.map(m => m.value)).toEqual([0, 0]);
  });

  it('requires at least one dice term', () => {
    expect(() => resolveFormula('@ref + 2', { ref: 5 })).toThrow();
  });
});

describe('executeRoll — sum', () => {
  it('totals dice plus modifiers', () => {
    const resolved = resolveFormula('1d10 + @ref + @handgun', { ref: 7, handgun: 5 });
    const out = executeRoll(resolved, 'sum', d10rng(6));
    expect(out.total).toBe(18);
    expect(out.rolls).toEqual({ 10: [6] });
    expect(out.critical).toBeNull();
    expect(out.breakdown).toBe('(6) + 12');
  });
});

describe('executeRoll — explode10 (CP:R check die)', () => {
  it('natural 10 adds one extra d10 (critical success)', () => {
    const resolved = resolveFormula('1d10 + @ref', { ref: 7 });
    const out = executeRoll(resolved, 'explode10', d10rng(10, 4));
    expect(out.total).toBe(10 + 4 + 7);
    expect(out.critical).toBe('success');
    expect(out.rolls[10]).toEqual([10, 4]);
    expect(out.breakdown).toContain('10!+4');
  });

  it('natural 1 subtracts one extra d10 (fumble)', () => {
    const resolved = resolveFormula('1d10 + @ref', { ref: 7 });
    const out = executeRoll(resolved, 'explode10', d10rng(1, 6));
    expect(out.total).toBe(1 - 6 + 7);
    expect(out.critical).toBe('failure');
    expect(out.breakdown).toContain('1!-6');
  });

  it('never chains: a 10 on the extra die does not explode again', () => {
    const resolved = resolveFormula('1d10 + @ref', { ref: 0 });
    const out = executeRoll(resolved, 'explode10', d10rng(10, 10));
    expect(out.total).toBe(20);
    expect(out.rolls[10]).toEqual([10, 10]);
  });

  it('mid-range rolls do not explode', () => {
    const resolved = resolveFormula('1d10 + @ref', { ref: 3 });
    const out = executeRoll(resolved, 'explode10', d10rng(5));
    expect(out.total).toBe(8);
    expect(out.critical).toBeNull();
  });
});

describe('executeRoll — pool', () => {
  it('counts hits on 5s and 6s (full coverage in sr6_rollEngine.test.js)', () => {
    const resolved = resolveFormula('6d6', {});
    const out = executeRoll(resolved, 'pool', () => 0.99); // all 6s
    expect(out.poolSize).toBe(6);
    expect(out.total).toBe(6);
  });
});

describe('roll map', () => {
  it('CP:R stats and skills all resolve and parse', () => {
    const rolls = ROLLS.cyberpunk_red;
    expect(Object.keys(rolls).length).toBeGreaterThan(60);
    Object.values(rolls).forEach(({ formula, shape }) => {
      expect(shape).toBe('explode10');
      expect(() => resolveFormula(formula, {})).not.toThrow();
    });
  });

  it('getRoll returns null for unknown fields and systems', () => {
    expect(getRoll('cyberpunk_red', 'sp_body')).toBeNull(); // combat field: not rollable
    expect(getRoll('cyberpunk_red', 'nope')).toBeNull();
    expect(getRoll('calvinball', 'handgun')).toBeNull();
  });

  it('skill rolls reference the skill and its stat', () => {
    expect(getRoll('cyberpunk_red', 'handgun').formula).toBe('1d10 + @ref + @handgun');
    expect(getRoll('cyberpunk_red', 'perception').formula).toBe('1d10 + @int + @perception');
  });
});
