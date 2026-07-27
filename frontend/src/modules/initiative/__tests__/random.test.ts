import { describe, it, expect } from 'vitest';
import { cryptoRng } from '../systems/random';
import { generic } from '../systems/generic';
import { sr6 } from '../systems/sr6';
import { cpr } from '../systems/cpr';
import { cwn } from '../systems/cwn';

describe('cryptoRng', () => {
  it('returns a number in [0, 1)', () => {
    const v = cryptoRng();
    expect(typeof v).toBe('number');
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(1);
  });

  it('produces different values across rolls', () => {
    const values = new Set(Array.from({ length: 20 }, cryptoRng));
    expect(values.size).toBeGreaterThan(1);
  });

  it('keeps all 500 values in [0, 1)', () => {
    for (let i = 0; i < 500; i++) {
      const v = cryptoRng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('generic system default rng integration', () => {
  it('rollNpc score lands in [1, 20]', () => {
    const { score } = generic.rollNpc({});
    expect(score).toBeGreaterThanOrEqual(1);
    expect(score).toBeLessThanOrEqual(20);
  });
});

describe('SR6 system default rng integration', () => {
  it('rollNpc score is a positive number', () => {
    const { score } = sr6.rollNpc({ reaction: 4, intuition: 3 });
    expect(score).toBeGreaterThanOrEqual(5); // min: REA(4)+INT(3)+1d6(1)
    expect(score).toBeLessThanOrEqual(13);   // max: REA(4)+INT(3)+1d6(6)
  });

  it('rollPlayer with extra dice returns diceResults with correct count', () => {
    const { diceResults } = sr6.rollPlayer({ reaction: 3, intuition: 3 }, { extraDice: 2 });
    expect(diceResults['6']).toHaveLength(3);
  });
});

describe('CP:R system default rng integration', () => {
  it('rollNpc score lands in [ref+1, ref+10]', () => {
    const sheet = { ref: 6 };
    const { score } = cpr.rollNpc(sheet);
    expect(score).toBeGreaterThanOrEqual(7);  // ref(6) + 1d10(1)
    expect(score).toBeLessThanOrEqual(16);    // ref(6) + 1d10(10)
  });

  it('rollNpc diceResults contains a d10 entry', () => {
    const { diceResults } = cpr.rollNpc({ ref: 5 });
    expect(Array.isArray(diceResults['10'])).toBe(true);
    expect(diceResults['10'].length).toBeGreaterThanOrEqual(1);
  });
});

describe('CWN system default rng integration', () => {
  it('rollNpc score lands in [dex_mod+1, dex_mod+8]', () => {
    const sheet = { dex_mod: 1 };
    const { score } = cwn.rollNpc(sheet);
    expect(score).toBeGreaterThanOrEqual(2);  // dex_mod(1) + 1d8(1)
    expect(score).toBeLessThanOrEqual(9);     // dex_mod(1) + 1d8(8)
  });

  it('rollNpc diceResults contains a d8 entry', () => {
    const { diceResults } = cwn.rollNpc({ dex_mod: 0 });
    expect(Array.isArray(diceResults['8'])).toBe(true);
    expect(diceResults['8']).toHaveLength(1);
  });
});
