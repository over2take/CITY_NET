import { describe, it, expect } from 'vitest';
import { getInitiativeSystem } from '../systems';
import { generic } from '../systems/generic';
import { sr6 } from '../systems/sr6';
import { cpr } from '../systems/cpr';

describe('getInitiativeSystem', () => {
  it('returns generic for unknown keys', () => {
    expect(getInitiativeSystem('unknown')).toBe(generic);
  });

  it('returns generic for "generic"', () => {
    expect(getInitiativeSystem('generic')).toBe(generic);
  });

  it('returns sr6 for "shadowrun_6e"', () => {
    expect(getInitiativeSystem('shadowrun_6e')).toBe(sr6);
  });

  it('returns cpr for "cyberpunk_red"', () => {
    expect(getInitiativeSystem('cyberpunk_red')).toBe(cpr);
  });
});

describe('generic system', () => {
  it('has counterLabel TURN', () => {
    expect(generic.counterLabel).toBe('TURN');
  });

  it('passDecay is false', () => {
    expect(generic.passDecay).toBe(false);
  });

  it('rollNpc returns score between 1 and 20', () => {
    for (let i = 0; i < 50; i++) {
      const { score } = generic.rollNpc();
      expect(score).toBeGreaterThanOrEqual(1);
      expect(score).toBeLessThanOrEqual(20);
    }
  });

  it('rollNpc breakdown matches score', () => {
    const { score, breakdown } = generic.rollNpc();
    expect(breakdown).toBe(`1d20(${score}) = ${score}`);
  });

  it('rollPlayer returns score between 1 and 20', () => {
    for (let i = 0; i < 50; i++) {
      const { score } = generic.rollPlayer();
      expect(score).toBeGreaterThanOrEqual(1);
      expect(score).toBeLessThanOrEqual(20);
    }
  });
});

describe('sr6 system', () => {
  it('has counterLabel PASS', () => {
    expect(sr6.counterLabel).toBe('PASS');
  });

  it('passDecay is true', () => {
    expect(sr6.passDecay).toBe(true);
  });

  it('rollNpc uses REA + INT + 1d6 from sheet data', () => {
    const sheet = { data: { reaction: 4, intuition: 3 } };
    for (let i = 0; i < 50; i++) {
      const { score } = sr6.rollNpc(sheet);
      expect(score).toBeGreaterThanOrEqual(8);
      expect(score).toBeLessThanOrEqual(13);
    }
  });

  it('rollNpc breakdown contains REA, INT, and d6 values', () => {
    const sheet = { data: { reaction: 4, intuition: 3 } };
    const { score, breakdown } = sr6.rollNpc(sheet);
    expect(breakdown).toMatch(/REA\(4\) \+ INT\(3\) \+ 1d6\(\d\) = \d+/);
    expect(breakdown).toContain(`= ${score}`);
  });

  it('rollNpc falls back to 3 for missing sheet stats', () => {
    for (let i = 0; i < 50; i++) {
      const { score } = sr6.rollNpc();
      expect(score).toBeGreaterThanOrEqual(7);
      expect(score).toBeLessThanOrEqual(12);
    }
  });

  it('rollPlayer with no extra dice uses REA + INT + 1d6', () => {
    const sheet = { reaction: 5, intuition: 4 };
    for (let i = 0; i < 50; i++) {
      const { score } = sr6.rollPlayer(sheet, { extraDice: 0 });
      expect(score).toBeGreaterThanOrEqual(10);
      expect(score).toBeLessThanOrEqual(15);
    }
  });

  it('rollPlayer adds extra d6 dice (e.g. Wired Reflexes)', () => {
    const sheet = { reaction: 4, intuition: 4 };
    for (let i = 0; i < 50; i++) {
      const { score } = sr6.rollPlayer(sheet, { extraDice: 2 });
      expect(score).toBeGreaterThanOrEqual(11);
      expect(score).toBeLessThanOrEqual(26);
    }
  });

  it('rollPlayer breakdown shows extra dice', () => {
    const sheet = { reaction: 4, intuition: 4 };
    const { score, breakdown } = sr6.rollPlayer(sheet, { extraDice: 2 });
    expect(breakdown).toMatch(/REA\(4\) \+ INT\(4\) \+ 3d6\(.+\) = \d+/);
    expect(breakdown).toContain(`= ${score}`);
  });

  it('rollPlayer reads stats from sheet.data if not top-level', () => {
    const sheet = { data: { reaction: 6, intuition: 5 } };
    for (let i = 0; i < 50; i++) {
      const { score } = sr6.rollPlayer(sheet, { extraDice: 0 });
      expect(score).toBeGreaterThanOrEqual(12);
      expect(score).toBeLessThanOrEqual(17);
    }
  });
});

describe('cpr system', () => {
  it('has counterLabel ROUND', () => {
    expect(cpr.counterLabel).toBe('ROUND');
  });

  it('passDecay is false', () => {
    expect(cpr.passDecay).toBe(false);
  });

  it('rollNpc uses REF + 1d10', () => {
    const sheet = { ref: 6 };
    for (let i = 0; i < 50; i++) {
      const { score } = cpr.rollNpc(sheet);
      expect(score).toBeGreaterThanOrEqual(7);
      expect(score).toBeLessThanOrEqual(16);
    }
  });

  it('rollNpc breakdown contains REF and d10 roll', () => {
    const sheet = { ref: 7 };
    const { score, breakdown } = cpr.rollNpc(sheet);
    expect(breakdown).toMatch(/REF\(7\) \+ 1d10\(\d+\) = \d+/);
    expect(breakdown).toContain(`= ${score}`);
  });

  it('rollNpc falls back to ref=5 when sheet is missing', () => {
    for (let i = 0; i < 50; i++) {
      const { score } = cpr.rollNpc();
      expect(score).toBeGreaterThanOrEqual(6);
      expect(score).toBeLessThanOrEqual(15);
    }
  });

  it('rollPlayer reads ref from sheet.data if not top-level', () => {
    const sheet = { data: { ref: 8 } };
    for (let i = 0; i < 50; i++) {
      const { score } = cpr.rollPlayer(sheet);
      expect(score).toBeGreaterThanOrEqual(9);
      expect(score).toBeLessThanOrEqual(18);
    }
  });

  it('diceResults uses string key "10"', () => {
    const { diceResults } = cpr.rollNpc();
    expect(diceResults).toHaveProperty('10');
    expect(Array.isArray(diceResults['10'])).toBe(true);
  });

  it('does not explode by default (RAW)', () => {
    for (let i = 0; i < 100; i++) {
      const { diceResults } = cpr.rollNpc();
      expect(diceResults['10']).toHaveLength(1);
    }
  });

  it('explodes when explodingInitiative option is true and a 10 is rolled', () => {
    const original = Math.random;
    let call = 0;
    Math.random = () => call++ === 0 ? 0.9999 : 0.4;
    const { exploded, diceResults, breakdown } = cpr.rollNpc({ ref: 6 }, { explodingInitiative: true });
    Math.random = original;

    expect(exploded).toBe(true);
    expect(diceResults['10']).toEqual([10, 5]);
    expect(breakdown).toContain('[EXPLOD]');
  });

  it('keeps exploding on consecutive 10s when option is on', () => {
    const original = Math.random;
    let call = 0;
    Math.random = () => [0.9999, 0.9999, 0.2][call++] ?? 0.5;
    const { diceResults } = cpr.rollNpc({ ref: 5 }, { explodingInitiative: true });
    Math.random = original;

    expect(diceResults['10']).toEqual([10, 10, 3]);
  });
});
