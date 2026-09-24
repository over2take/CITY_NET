/**
 * What a shop pays for something sold back to it.
 *
 * Two levels of setting with a default underneath, which is three ways for a number to
 * arrive and several ways to get the precedence wrong. The case worth naming is a
 * location set to zero: a shop that buys nothing back is a decision somebody made, and
 * treating it as "unset" would silently hand it the global rate instead.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const {
  BUYBACK_SETTING, DEFAULT_BUYBACK_PCT, readPct, buybackPct, buybackValue,
} = createRequire(import.meta.url)('../shops/buyback');

describe('which rate applies', () => {
  it('falls back to the default when nothing is set anywhere', () => {
    expect(buybackPct(null, null)).toBe(DEFAULT_BUYBACK_PCT);
    expect(DEFAULT_BUYBACK_PCT).toBe(45);
  });

  it('uses the global when the location has no rate of its own', () => {
    expect(buybackPct(null, 60)).toBe(60);
    expect(buybackPct(undefined, 60)).toBe(60);
    expect(buybackPct('', 60)).toBe(60);
  });

  it('lets a location override the global', () => {
    expect(buybackPct(20, 60)).toBe(20);
  });

  it('treats a location set to zero as set', () => {
    // A shop that pays nothing for second-hand goods is a real storefront. Reading 0 as
    // "unset" would quietly give it the global rate, which is the opposite instruction.
    expect(buybackPct(0, 60)).toBe(0);
    expect(buybackPct('0', 60)).toBe(0);
  });

  it('reads a rate stored as text, because settings are strings', () => {
    expect(buybackPct('35', null)).toBe(35);
    expect(buybackPct(null, '70')).toBe(70);
  });

  it('ignores nonsense at either level rather than paying it', () => {
    for (const bad of ['abc', NaN, Infinity, -1, 1001, {}, []]) {
      expect(buybackPct(bad, 60), String(bad)).toBe(60);
      expect(buybackPct(null, bad), String(bad)).toBe(DEFAULT_BUYBACK_PCT);
    }
  });

  it('allows a rate up to face value, which a pawn shop might want', () => {
    expect(buybackPct(100, null)).toBe(100);
  });
});

describe('reading a stored rate', () => {
  it('says null for anything that is not a usable number', () => {
    // Null and not zero: "no rate set" and "pays nothing" are different answers.
    for (const bad of [null, undefined, '', 'abc', -5, 1001]) {
      expect(readPct(bad), String(bad)).toBeNull();
    }
    expect(readPct(0)).toBe(0);
  });
});

describe('what the shop hands over', () => {
  it('pays the percentage of the book price', () => {
    expect(buybackValue(1000, 45)).toBe(450);
    expect(buybackValue(200, 50)).toBe(100);
  });

  it('rounds down, so rounding never invents money', () => {
    // 45% of 101 is 45.45. Paying 46 would mean the shop is a very small mint.
    expect(buybackValue(101, 45)).toBe(45);
    expect(buybackValue(1, 45)).toBe(0);
  });

  it('pays nothing at all at zero percent', () => {
    expect(buybackValue(50000, 0)).toBe(0);
  });

  it('pays nothing for something that has no price', () => {
    // priceOf hands back null for anything no shelf carries. That has to be worth
    // nothing rather than crash a socket handler.
    for (const bad of [null, undefined, 'free', NaN, -100]) {
      expect(buybackValue(bad, 45), String(bad)).toBe(0);
    }
  });

  it('never pays more than the thing cost, at the default rate', () => {
    for (const price of [0, 1, 25, 999, 500000]) {
      expect(buybackValue(price, DEFAULT_BUYBACK_PCT)).toBeLessThanOrEqual(price);
    }
  });
});

describe('the setting key', () => {
  it('is universal rather than tied to one ruleset', () => {
    // Every system with a shop has a second-hand price. No system prefix, like the
    // overdraft rule and unlike cwn_encumbrance.
    expect(BUYBACK_SETTING).toBe('shop_buyback_pct');
    expect(BUYBACK_SETTING.startsWith('cwn_')).toBe(false);
  });
});
