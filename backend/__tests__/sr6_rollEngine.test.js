import { describe, it, expect } from 'vitest';
const { resolveFormula, executeRoll } = require('../sheets/rollEngine');

// rng stub: returns values so rollDie(6) yields the given faces in order
const rigged = (faces) => {
  let i = 0;
  return () => (faces[i++ % faces.length] - 1 + 0.5) / 6;
};

describe('SR6 pool rolls', () => {
  it('pool size = modifier sum; hits are 5s and 6s; total = hits', () => {
    const resolved = resolveFormula('@agility+@firearms+2', { agility: 4, firearms: 3 }, { allowNoDice: true });
    const out = executeRoll(resolved, 'pool', rigged([6, 5, 4, 3, 2, 1, 6, 5, 2]));
    expect(out.poolSize).toBe(9);
    expect(out.rolls[6]).toHaveLength(9);
    expect(out.hits).toBe(4);
    expect(out.total).toBe(4);
    expect(out.glitch).toBe(false);
    expect(out.critical).toBeNull();
    expect(out.breakdown).toBe('4 hits / 9 dice');
  });

  it('resolveFormula throws on no-dice formulas unless allowNoDice', () => {
    expect(() => resolveFormula('@agility+2', { agility: 3 })).toThrow(/no dice/i);
    expect(() => resolveFormula('@agility+2', { agility: 3 }, { allowNoDice: true })).not.toThrow();
  });

  it('dice terms contribute their count to the pool, not their rolled value', () => {
    const resolved = resolveFormula('2d6+@skill', { skill: 3 }, { allowNoDice: true });
    const out = executeRoll(resolved, 'pool', rigged([2, 2, 2, 2, 2]));
    expect(out.poolSize).toBe(5);
  });

  it('glitch when half or more of the pool shows 1', () => {
    // pool 4, two 1s -> glitch (2 >= ceil(4/2)), but a hit present -> not critical
    const resolved = resolveFormula('4', {}, { allowNoDice: true });
    const out = executeRoll(resolved, 'pool', rigged([1, 1, 6, 3]));
    expect(out.glitch).toBe(true);
    expect(out.critical).toBeNull();
    expect(out.breakdown).toContain('GLITCH');
    expect(out.breakdown).not.toContain('CRITICAL');
  });

  it('critical glitch = glitch with zero hits', () => {
    const resolved = resolveFormula('4', {}, { allowNoDice: true });
    const out = executeRoll(resolved, 'pool', rigged([1, 1, 3, 2]));
    expect(out.glitch).toBe(true);
    expect(out.critical).toBe('failure');
    expect(out.breakdown).toContain('CRITICAL GLITCH');
  });

  it('pool floors at 1 die even when modifiers are zero or negative', () => {
    const resolved = resolveFormula('@agility-3', { agility: 1 }, { allowNoDice: true });
    const out = executeRoll(resolved, 'pool', rigged([5]));
    expect(out.poolSize).toBe(1);
    expect(out.hits).toBe(1);
    expect(out.breakdown).toBe('1 hit / 1 dice');
  });

  it('missing sheet fields count as 0', () => {
    const resolved = resolveFormula('@agility+@firearms', { agility: 2 }, { allowNoDice: true });
    const out = executeRoll(resolved, 'pool', rigged([2, 2]));
    expect(out.poolSize).toBe(2);
  });

  it('sum and explode10 shapes are unchanged', () => {
    const resolved = resolveFormula('1d10+@ref', { ref: 5 });
    const out = executeRoll(resolved, 'explode10', () => 0.65); // d10 -> 7
    expect(out.total).toBe(12);
    expect(out.critical).toBeNull();
  });
});
