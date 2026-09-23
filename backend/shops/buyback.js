// What a shop pays for something a player is selling back.
//
// A percentage of the book price rather than a second price list, because the book does
// not print one: it prices what things cost, and what a fence will give you for a used
// cyberdeck is a table decision. So the number lives in settings rather than in a
// catalogue, and every shop starts from the same one until somebody says otherwise.
//
// Two levels, and the per-location one is the point. A corp clinic and a back-alley fence
// giving the same forty-five percent is exactly the flatness that makes a city map dull,
// so a storefront can be set to its own rate and the global is what the rest fall back to.

/** The global rate, in `global_settings`. Per-location overrides live on the row. */
const BUYBACK_SETTING = 'shop_buyback_pct';

/**
 * What a shop pays when nobody has said otherwise.
 *
 * Under half deliberately. Selling back at anything near cost turns every shop into a
 * savings account and makes buying the wrong thing free, which takes the weight out of
 * every purchase decision in the game.
 */
const DEFAULT_BUYBACK_PCT = 45;

/**
 * A stored rate as a number, or null if it is not one.
 *
 * Null rather than a fallback, because the two callers below want different things from a
 * missing value: a missing location rate means "use the global", and a missing global
 * means "use the default". Collapsing them here would lose that difference.
 *
 * Bounded at 0 and 1000. Zero is a real answer - a shop that buys nothing back - and the
 * ceiling is not a rule so much as a guard: a rate above cost means selling something
 * back for more than it cost, which is a money printer rather than a house rule. A
 * hundred is still allowed, because a GM might well want a pawn shop that pays face value.
 */
const readPct = (value) => {
  /**
   * The type is checked before the value, and that is not belt-and-braces.
   *
   * `Number([])` is 0. Coercing whatever arrives would read an empty array as a shop that
   * pays nothing - a valid, meaningful setting - rather than as rubbish to ignore. The
   * same coercion read `null` as a free item in shops/purchase.js, which is why it is
   * spelled out both times.
   *
   * Strings are allowed because that is how settings come back from the database; a
   * string that is not a number still fails, since `Number('abc')` is NaN.
   */
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1000) return null;
  return n;
};

/**
 * The rate that applies at one storefront.
 *
 * `locationPct` wins when it is set, then the global, then the default. A location set to
 * 0 counts as set - a shop that pays nothing is a decision, not a blank.
 */
const buybackPct = (locationPct, globalPct) => {
  const local = readPct(locationPct);
  if (local !== null) return local;
  const global = readPct(globalPct);
  return global !== null ? global : DEFAULT_BUYBACK_PCT;
};

/**
 * What a shop hands over for something that cost `price`.
 *
 * Rounded down, so the rounding never invents money. Anything that is not a usable price
 * pays nothing rather than throwing: `priceOf` returns null for things no shelf carries,
 * and a sale of something unpriceable should be worth nothing rather than crash a socket.
 */
const buybackValue = (price, pct) => {
  if (typeof price !== 'number' || !Number.isFinite(price) || price < 0) return 0;
  return Math.floor((price * pct) / 100);
};

module.exports = {
  BUYBACK_SETTING, DEFAULT_BUYBACK_PCT, readPct, buybackPct, buybackValue,
};
