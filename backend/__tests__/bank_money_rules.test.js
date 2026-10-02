/**
 * What the bank allows in one currency (3c2a1). The built-in systems keep today's bank exactly
 * (bank_own_account.test.js pins the handlers that do it): borrowing open, overdrawing allowed,
 * the GM's edit taking any numbers. A custom currency borrows only with debt on and goes below
 * zero only with negative on, both off unless the GM turns them on (the user, 2026-10-02), and
 * the GM's own edit is held to the same switches.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const require_ = createRequire(import.meta.url);
const { BUILT_IN, rulesFor, withdraw, borrow, payDebt, setAccount } = require_('../bank/moneyRules');

const account = { balance: 100, debt: 40 };
const custom = (debt, negative) => rulesFor({ id: 'gold', name: 'Gold', debt, negative });

describe('the rules for a currency', () => {
  it('are today\'s bank for a built-in system (no currency), and the switches for a custom one', () => {
    expect(rulesFor(null)).toBe(BUILT_IN);
    expect(rulesFor(undefined)).toEqual({ debt: true, negative: true, free: true });
    expect(rulesFor({ id: 'g', name: 'G' })).toEqual({ debt: false, negative: false });
    expect(rulesFor({ id: 'g', name: 'G', debt: true, negative: true })).toEqual({ debt: true, negative: true });
    expect(rulesFor({ id: 'g', name: 'G', debt: 'yes', negative: 1 })).toEqual({ debt: false, negative: false });
  });
});

describe('a withdrawal', () => {
  it('takes the amount, and overdraws as today under a built-in system', () => {
    expect(withdraw(account, 30, BUILT_IN)).toEqual({ ok: true, moved: { balance: -30, debt: 0 } });
    expect(withdraw(account, 500, BUILT_IN)).toEqual({ ok: true, moved: { balance: -500, debt: 0 } });
  });

  it('goes below zero in a custom currency only with negative on', () => {
    expect(withdraw(account, 100, custom(false, false))).toEqual({ ok: true, moved: { balance: -100, debt: 0 } });
    expect(withdraw(account, 101, custom(false, false))).toEqual({ ok: false, reason: 'funds' });
    expect(withdraw(account, 101, custom(true, false))).toEqual({ ok: false, reason: 'funds' });
    expect(withdraw(account, 101, custom(false, true))).toEqual({ ok: true, moved: { balance: -101, debt: 0 } });
  });

  it('wants a positive amount', () => {
    for (const amount of [0, -5, 'abc', undefined, NaN, Infinity]) expect(withdraw(account, amount, BUILT_IN), String(amount)).toEqual({ ok: false, reason: 'amount' });
  });
});

describe('borrowing', () => {
  it('adds to the debt, as today under a built-in system', () => {
    expect(borrow(account, 25, BUILT_IN)).toEqual({ ok: true, moved: { balance: 0, debt: 25 } });
  });

  it('is open in a custom currency only with debt on', () => {
    expect(borrow(account, 25, custom(false, true))).toEqual({ ok: false, reason: 'no_debt' });
    expect(borrow(account, 25, custom(true, false))).toEqual({ ok: true, moved: { balance: 0, debt: 25 } });
    expect(borrow(account, 0, custom(true, false))).toEqual({ ok: false, reason: 'amount' });
  });
});

describe('paying debt', () => {
  it('pays what was asked, never more than is owed or held, in any currency', () => {
    for (const rules of [BUILT_IN, custom(true, false), custom(false, false)]) {
      expect(payDebt(account, 10, rules)).toEqual({ ok: true, moved: { balance: -10, debt: -10 } });
      expect(payDebt(account, 999, rules)).toEqual({ ok: true, moved: { balance: -40, debt: -40 } });
      expect(payDebt({ balance: 15, debt: 40 }, 999, rules)).toEqual({ ok: true, moved: { balance: -15, debt: -15 } });
    }
  });

  it('does nothing with nothing to pay or nothing to pay with', () => {
    expect(payDebt({ balance: 100, debt: 0 }, 10)).toEqual({ ok: false, reason: 'nothing' });
    expect(payDebt({ balance: 0, debt: 50 }, 10)).toEqual({ ok: false, reason: 'nothing' });
    expect(payDebt({ balance: -5, debt: 50 }, 10)).toEqual({ ok: false, reason: 'nothing' });
    expect(payDebt(account, -10)).toEqual({ ok: false, reason: 'amount' });
  });
});

describe('the GM setting an account', () => {
  it('takes any numbers under a built-in system, as today', () => {
    expect(setAccount(-50, 30, BUILT_IN)).toEqual({ ok: true, balance: -50, debt: 30 });
    expect(setAccount(10, -5, BUILT_IN)).toEqual({ ok: true, balance: 10, debt: -5 });
    expect(setAccount('abc', 0, BUILT_IN)).toEqual({ ok: false, reason: 'amount' });
  });

  it('is held to a custom currency\'s switches', () => {
    expect(setAccount(50, 0, custom(false, false))).toEqual({ ok: true, balance: 50, debt: 0 });
    expect(setAccount(50, 10, custom(false, false))).toEqual({ ok: false, reason: 'no_debt' });
    expect(setAccount(50, 10, custom(true, false))).toEqual({ ok: true, balance: 50, debt: 10 });
    expect(setAccount(-1, 0, custom(true, false))).toEqual({ ok: false, reason: 'no_negative' });
    expect(setAccount(-1, 0, custom(false, true))).toEqual({ ok: true, balance: -1, debt: 0 });
    expect(setAccount(50, -5, custom(true, true))).toEqual({ ok: false, reason: 'amount' });
  });
});
