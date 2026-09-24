/**
 * The buy-back rate, on both sides of the wire.
 *
 * The window works this out to SHOW a price and the server works it out again to PAY one.
 * If they ever disagree a player is quoted one figure and handed another, which is the
 * worst kind of wrong to have in a shop - so rather than asserting what each should say,
 * every case below is run through both and the answers compared.
 *
 * The backend copy already has its own tests for what the rules ARE. This is only about
 * the two agreeing.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import {
  readPct, buybackPct, buybackValue, BUYBACK_SETTING, DEFAULT_BUYBACK_PCT,
} from '../shopRules';

const backend = createRequire(import.meta.url)('../../../../backend/shops/buyback.js');

/**
 * Values chosen for the ways a rate arrives wrong, not for being typical.
 *
 * Settings come back from the database as strings, so '35' has to work. `Number([])` is 0,
 * which would read an array as a shop that pays nothing - a real, meaningful setting -
 * rather than as rubbish to ignore.
 */
const RATES: unknown[] = [
  45, 0, 100, 1000, '35', '0', '', '   ', null, undefined,
  -1, 1001, NaN, Infinity, 'abc', [], {}, true, 12.5,
];

describe('reading a stored rate', () => {
  for (const value of RATES) {
    it(`agrees on ${JSON.stringify(value) ?? String(value)}`, () => {
      expect(readPct(value)).toBe(backend.readPct(value));
    });
  }
});

describe('which rate applies at a shop', () => {
  it('agrees on every pairing of a location rate and a global one', () => {
    const wrong: string[] = [];
    for (const location of RATES) {
      for (const global of RATES) {
        const mine = buybackPct(location, global);
        const theirs = backend.buybackPct(location, global);
        if (mine !== theirs) {
          wrong.push(`location=${String(location)} global=${String(global)}: ${mine} vs ${theirs}`);
        }
      }
    }
    // Named rather than counted, so a failure says which pairing drifted.
    expect(wrong).toEqual([]);
  });

  it('lets a shop override the global, which is the point of the feature', () => {
    expect(buybackPct(20, 60)).toBe(20);
    expect(buybackPct(100, 45)).toBe(100);
  });

  it('treats a shop set to zero as set, not as blank', () => {
    // A storefront that buys nothing back is a decision somebody made. Reading 0 as
    // "unset" would quietly hand it the global rate instead.
    expect(buybackPct(0, 60)).toBe(0);
    expect(buybackPct('0', 60)).toBe(0);
  });

  it('falls back to the global, then to the default', () => {
    expect(buybackPct(null, 60)).toBe(60);
    expect(buybackPct(null, null)).toBe(DEFAULT_BUYBACK_PCT);
    expect(DEFAULT_BUYBACK_PCT).toBe(backend.DEFAULT_BUYBACK_PCT);
  });

  it('names the setting the same way the server reads it', () => {
    expect(BUYBACK_SETTING).toBe(backend.BUYBACK_SETTING);
  });
});

describe('what a shop hands over', () => {
  it('agrees on the payout for every rate and price', () => {
    const wrong: string[] = [];
    for (const price of [0, 1, 15, 101, 150, 999, 500000]) {
      for (const pct of [0, 10, 45, 50, 100]) {
        const mine = buybackValue(price, pct);
        const theirs = backend.buybackValue(price, pct);
        if (mine !== theirs) wrong.push(`${price} at ${pct}%: ${mine} vs ${theirs}`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('rounds down, so rounding never invents money', () => {
    // 45% of 150 is 67.5. Paying 68 would make every shop a very small mint.
    expect(buybackValue(150, 45)).toBe(67);
    expect(buybackValue(15, 45)).toBe(6);
  });

  it('pays nothing for something with no price', () => {
    for (const bad of [null, undefined, NaN, -100]) {
      expect(buybackValue(bad as never, 45), String(bad))
        .toBe(backend.buybackValue(bad, 45));
    }
  });
});
