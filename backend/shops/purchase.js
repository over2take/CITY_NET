// What a purchase does to a bank account.
//
// Pure arithmetic, deliberately separate from the socket handler that calls it. Money is
// the thing in this app most worth being able to test without a database, a socket or a
// logged-in user, and every rule below is a sentence somebody at the table can argue with.
//
// The authority question is settled here and not in the window: the shop prints a price,
// but the amount taken out of an account is looked up on this side from shops/prices.js.
// A modified client can ask to buy a Tank. It cannot ask to buy one for nothing.

/**
 * The house rule that lets a player buy something they cannot afford.
 *
 * Universal rather than CWN-only. Every system in the app has money, and "can you spend
 * what you have not got" is a table decision rather than a ruleset one - which is why it
 * sits with INITIATIVE FOLLOWS BUILDING in the global list rather than beside the CWN
 * rules.
 *
 * Off by default. On, a player who cannot afford something is asked how to cover it
 * rather than being refused, and what happens to someone carrying a negative balance is
 * left to the GM - the app records the hole, it does not collect on it.
 */
const OVERDRAFT_RULE = 'allow_overdraft';

/** How a shortfall was covered. The window says which, so a choice is never silent. */
const SETTLE_BALANCE = 'balance';
const SETTLE_DEBT = 'debt';

/**
 * Work out what an account looks like after buying something at `price`.
 *
 * Returns either `{ ok: true, balance, debt, settled }` or `{ ok: false, reason }`. The
 * caller writes the two numbers; nothing here touches a database.
 *
 * `reason` is one of:
 *   'price'        - nothing on any shelf answers to that catalogue and id
 *   'funds'        - short, and the house rule does not allow going under
 *   'needs_choice' - short, allowed, but nobody said how to cover it
 *
 * That last one is a backstop rather than a flow. The window knows the balance already -
 * the server broadcasts it - so it asks before sending, and one round trip covers the
 * whole purchase. This exists so a client that forgets to ask cannot pick for the player
 * by accident.
 */
const planPurchase = ({ balance, debt, price, overdraftAllowed, settle }) => {
  /**
   * A number and nothing else.
   *
   * `Number(null)` is 0, so coercing here would read "no such item" - which is exactly
   * what priceOf hands back - as "free", and sell a Tank for nothing to anyone who
   * mistyped an id. Free and unpriced have to stay different answers, so the check is on
   * the type before the value.
   */
  if (typeof price !== 'number' || !Number.isFinite(price) || price < 0) {
    return { ok: false, reason: 'price' };
  }
  const cost = price;

  const have = Number(balance) || 0;
  const owed = Number(debt) || 0;

  // The ordinary case, and the only one that needs no permission from anybody.
  if (cost <= have) {
    return { ok: true, balance: have - cost, debt: owed, settled: SETTLE_BALANCE };
  }

  if (!overdraftAllowed) return { ok: false, reason: 'funds' };

  if (settle === SETTLE_DEBT) {
    /**
     * Cash first, then borrow the rest.
     *
     * `spend` is clamped at zero deliberately. An account already in the red has no cash
     * to put towards it, and subtracting a negative balance would hand the player money
     * on the way to borrowing more.
     */
    const spend = Math.max(0, Math.min(have, cost));
    return { ok: true, balance: have - spend, debt: owed + (cost - spend), settled: SETTLE_DEBT };
  }

  if (settle === SETTLE_BALANCE) {
    // Straight through and under. The GM decides what that costs them later.
    return { ok: true, balance: have - cost, debt: owed, settled: SETTLE_BALANCE };
  }

  return { ok: false, reason: 'needs_choice' };
};

module.exports = { OVERDRAFT_RULE, SETTLE_BALANCE, SETTLE_DEBT, planPurchase };
