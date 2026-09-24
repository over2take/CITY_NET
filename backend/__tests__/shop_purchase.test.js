/**
 * What a purchase does to an account.
 *
 * Arithmetic rather than plumbing, which is the point of keeping planPurchase pure: every
 * case below is a sentence about money that somebody at the table could disagree with, and
 * none of them need a database to settle.
 */

import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';

const { planPurchase, OVERDRAFT_RULE, SETTLE_BALANCE, SETTLE_DEBT } =
  createRequire(import.meta.url)('../shops/purchase');

const buy = (over) => planPurchase({
  balance: 1000, debt: 0, price: 200, overdraftAllowed: false, ...over,
});

describe('paying for something you can afford', () => {
  it('takes it out of the balance and leaves the debt alone', () => {
    expect(buy({ balance: 1000, price: 200 }))
      .toEqual({ ok: true, balance: 800, debt: 0, settled: SETTLE_BALANCE });
  });

  it('allows spending the account exactly to zero', () => {
    // Not a shortfall. Spending your last credit needs no house rule and no dialog.
    expect(buy({ balance: 200, price: 200 }))
      .toEqual({ ok: true, balance: 0, debt: 0, settled: SETTLE_BALANCE });
  });

  it('leaves an existing debt untouched', () => {
    expect(buy({ balance: 1000, debt: 5000, price: 200 }))
      .toMatchObject({ ok: true, balance: 800, debt: 5000 });
  });

  it('costs nothing for a free item', () => {
    expect(buy({ price: 0 })).toMatchObject({ ok: true, balance: 1000 });
  });
});

describe('when you cannot afford it and the house says no', () => {
  it('refuses rather than quietly going under', () => {
    expect(buy({ balance: 100, price: 900, overdraftAllowed: false }))
      .toEqual({ ok: false, reason: 'funds' });
  });

  it('refuses on an account already in the red', () => {
    expect(buy({ balance: -50, price: 10, overdraftAllowed: false }))
      .toEqual({ ok: false, reason: 'funds' });
  });
});

describe('when the house rule is on', () => {
  it('will not choose for the player', () => {
    // Going into debt and going negative are different decisions with different
    // consequences. Picking one silently would be making a call that is theirs.
    expect(buy({ balance: 100, price: 900, overdraftAllowed: true }))
      .toEqual({ ok: false, reason: 'needs_choice' });
  });

  it('takes the balance under when that is what was chosen', () => {
    expect(buy({ balance: 100, price: 900, overdraftAllowed: true, settle: SETTLE_BALANCE }))
      .toEqual({ ok: true, balance: -800, debt: 0, settled: SETTLE_BALANCE });
  });

  it('spends the cash first and borrows only the shortfall', () => {
    expect(buy({ balance: 100, price: 900, overdraftAllowed: true, settle: SETTLE_DEBT }))
      .toEqual({ ok: true, balance: 0, debt: 800, settled: SETTLE_DEBT });
  });

  it('adds to a debt that is already there', () => {
    expect(buy({ balance: 100, debt: 300, price: 900, overdraftAllowed: true, settle: SETTLE_DEBT }))
      .toEqual({ ok: true, balance: 0, debt: 1100, settled: SETTLE_DEBT });
  });

  it('does not hand out money when borrowing against an account in the red', () => {
    /**
     * The case the clamp is there for. Balance -100, price 900: there is no cash to put
     * towards it, so the whole 900 is borrowed and the balance stays where it was.
     * Subtracting a negative balance would have borrowed 1000 and paid the player 100.
     */
    const out = planPurchase({
      balance: -100, debt: 0, price: 900, overdraftAllowed: true, settle: SETTLE_DEBT,
    });
    expect(out).toEqual({ ok: true, balance: -100, debt: 900, settled: SETTLE_DEBT });
    // Nothing was created: what they owe plus what they hold is down by exactly the price.
    expect((out.balance - out.debt) - (-100 - 0)).toBe(-900);
  });

  it('conserves money however the shortfall is covered', () => {
    // Net worth has to fall by the price on every route, or the shop is a mint.
    for (const balance of [-500, -1, 0, 1, 250, 10000]) {
      for (const settle of [SETTLE_BALANCE, SETTLE_DEBT]) {
        const out = planPurchase({
          balance, debt: 40, price: 900, overdraftAllowed: true, settle,
        });
        expect(out.ok, `${balance}/${settle}`).toBe(true);
        const before = balance - 40;
        const after = out.balance - out.debt;
        expect(after - before, `${balance}/${settle}`).toBeCloseTo(-900, 10);
      }
    }
  });
});

describe('a price that is not a price', () => {
  it('refuses an unknown item rather than treating it as free', () => {
    // priceOf hands back null for anything no shelf carries.
    expect(buy({ price: null })).toEqual({ ok: false, reason: 'price' });
    expect(buy({ price: undefined })).toEqual({ ok: false, reason: 'price' });
    expect(buy({ price: 'free' })).toEqual({ ok: false, reason: 'price' });
  });

  it('refuses a negative price, which would pay the player to shop', () => {
    expect(buy({ price: -500 })).toEqual({ ok: false, reason: 'price' });
  });
});

describe('the house rule', () => {
  it('is universal rather than tied to one ruleset', () => {
    // Every system in the app has money. The key carries no system prefix, unlike
    // cwn_encumbrance and friends, and that is deliberate.
    expect(OVERDRAFT_RULE).toBe('allow_overdraft');
    expect(OVERDRAFT_RULE.startsWith('cwn_')).toBe(false);
  });
});
