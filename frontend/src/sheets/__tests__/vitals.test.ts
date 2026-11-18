import { describe, it, expect } from 'vitest';
import { amountOf, healthBody, takesAnAmount, hasHealth, defenseOf } from '../vitals';
import { getTemplate, type SheetTemplate } from '..';
import { registerCustomTemplate, clearCustomTemplates } from '../customTemplates';

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
    // Two tracks too, with a picker (8s3d1).
    expect(takesAnAmount('tracks')).toBe(true);
    for (const m of ['typed', 'harm', 'wounds', 'locations', 'none']) expect(takesAnAmount(m), m).toBe(false);
    expect(hasHealth('none')).toBe(false);
    for (const m of [null, undefined, 'pool', 'wounds']) expect(hasHealth(m), String(m)).toBe(true);
  });
});

describe('the armor class the box shows, as each game has it (8s3c)', () => {
  it('the built-in games: generic\'s on the token; CWN MELEE and RANGED AC; Shadowrun ARMOR; Cyberpunk none (SP on the sheet)', () => {
    expect(defenseOf(getTemplate('generic'))).toEqual({ label: 'AC', ranged: 'RANGED AC', rangedWhenSet: true });
    expect(defenseOf(getTemplate('cities_without_number'))).toEqual({ label: 'MELEE AC', ranged: 'RANGED AC' });
    expect(defenseOf(getTemplate('shadowrun_6e'))).toEqual({ label: 'ARMOR' });
    expect(defenseOf(getTemplate('cyberpunk_red'))).toBeNull();
  });

  it('a built system: its field\'s own name; without one, the token\'s as its menu has it; none with combat off', () => {
    const ID = 'sys_0a1b2c3d4e5f6a7b';
    const sheet = (fields: object[]) => ({ id: ID, name: 'X', sections: [{ id: 's', label: 'S', layout: 'list', fields }] }) as unknown as SheetTemplate;
    expect(defenseOf(sheet([{ id: 'guard', label: 'Guard', type: 'number', source: 'token_ac' }]))).toEqual({ label: 'GUARD' });
    expect(defenseOf(sheet([]))).toEqual({ label: 'AC', ranged: 'RANGED AC', rangedWhenSet: true });
    registerCustomTemplate({ id: ID, name: 'X', parts: { combat: { on: false } }, derived: [], sheet: { sections: [] }, words: {} } as never);
    try {
      expect(defenseOf(sheet([]))).toBeNull();
    } finally { clearCustomTemplates(); }
  });
});
