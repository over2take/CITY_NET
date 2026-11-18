import { describe, it, expect } from 'vitest';
import { amountOf, healthBody, takesAnAmount, hasHealth, defenseOf } from '../vitals';
import { getTemplate, type SheetTemplate } from '..';

// The vitals strip's rules (8s3b).

describe('the amount typed', () => {
  it('a whole number from 0 to 9999; anything else 0', () => {
    expect(amountOf('5')).toBe(5);
    expect(amountOf('5.9')).toBe(5);
    expect(amountOf('-3')).toBe(0);
    expect(amountOf('')).toBe(0);
    expect(amountOf('abc')).toBe(0);
    expect(amountOf('9999')).toBe(9999);
    expect(amountOf('100000')).toBe(9999);
  });
});

describe('what is sent', () => {
  it('as HEALTH sends it: TEMP carries the amount as the new temp', () => {
    expect(healthBody('damage', 4)).toEqual({ action: 'damage', amount: 4 });
    expect(healthBody('heal', 2)).toEqual({ action: 'heal', amount: 2 });
    expect(healthBody('set_temp', 3)).toEqual({ action: 'set_temp', amount: 3, hp_temp: 3 });
  });
});

describe('which models the strip changes', () => {
  it('an amount for one pool (every built-in game, a custom pool); the rest in HEALTH ▾; no strip with no health', () => {
    expect(takesAnAmount(null)).toBe(true);
    expect(takesAnAmount(undefined)).toBe(true);
    expect(takesAnAmount('pool')).toBe(true);
    for (const m of ['tracks', 'typed', 'harm', 'wounds', 'locations', 'none']) expect(takesAnAmount(m), m).toBe(false);
    expect(hasHealth('none')).toBe(false);
    for (const m of [null, undefined, 'pool', 'wounds']) expect(hasHealth(m), String(m)).toBe(true);
  });
});
