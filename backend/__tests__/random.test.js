import { describe, it, expect } from 'vitest';
import { cryptoRng } from '../utils/random.js';
import { executeRoll, resolveFormula } from '../sheets/rollEngine.js';
import * as cprAttack from '../sheets/attack.js';
import * as cwnAttack from '../sheets/attackCwn.js';
import * as sr6Attack from '../sheets/attackSr6.js';

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

describe('rollEngine default rng integration', () => {
  it('executeRoll 1d6+2 lands in [3, 8] without rng injection', () => {
    const resolved = resolveFormula('1d6 + 2', {});
    const { total } = executeRoll(resolved);
    expect(total).toBeGreaterThanOrEqual(3);
    expect(total).toBeLessThanOrEqual(8);
  });

  it('executeRoll 2d10 lands in [2, 20] without rng injection', () => {
    const resolved = resolveFormula('2d10', {});
    const { total } = executeRoll(resolved);
    expect(total).toBeGreaterThanOrEqual(2);
    expect(total).toBeLessThanOrEqual(20);
  });

  it('executeRoll pool:4d6 returns hits between 0 and 4', () => {
    const resolved = resolveFormula('4d6', {});
    const { hits, poolSize } = executeRoll(resolved, 'pool');
    expect(poolSize).toBe(4);
    expect(hits).toBeGreaterThanOrEqual(0);
    expect(hits).toBeLessThanOrEqual(4);
  });
});

describe('CP:R attack default rng integration', () => {
  const weapon = { dmg: '1d6', skill: 'handgun', atk: 0 };
  const data = { ref: 6, handgun: 4, luck: 0 };

  it('rollToHit returns a total without rng injection', () => {
    const result = cprAttack.rollToHit(data, weapon, false);
    expect(typeof result.total).toBe('number');
    expect(result.total).toBeGreaterThanOrEqual(1);
  });

  it('rollDeathSave returns a boolean success without rng injection', () => {
    const result = cprAttack.rollDeathSave(6, 0);
    expect(typeof result.success).toBe('boolean');
    expect(result.die).toBeGreaterThanOrEqual(1);
    expect(result.die).toBeLessThanOrEqual(10);
  });
});

describe('CWN attack default rng integration', () => {
  const weapon = { dmg: '1d8', skill: 'stab', mod: 'str_mod', atk: 0, trauma: '1d6' };
  const data = { base_hit_bonus: 2, stab: 1, str_mod: 1, luck: 0 };

  it('rollToHit returns a total without rng injection', () => {
    const result = cwnAttack.rollToHit(data, weapon);
    expect(typeof result.total).toBe('number');
    expect(result.rolls['20'][0]).toBeGreaterThanOrEqual(1);
    expect(result.rolls['20'][0]).toBeLessThanOrEqual(20);
  });
});

describe('SR6 attack default rng integration', () => {
  const weapon = { attr: 'agility', skill: 'pistols', atk: 0, dv: '8P', ar: 10 };
  const data = { agility: 4, pistols: 3 };

  it('rollAttack returns hits in [0, pool] without rng injection', () => {
    const result = sr6Attack.rollAttack(data, weapon);
    expect(result.hits).toBeGreaterThanOrEqual(0);
    expect(result.hits).toBeLessThanOrEqual(result.poolSize);
  });
});
