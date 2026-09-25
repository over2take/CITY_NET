// Spending money you have not got.
//
// Mirrored from backend/shops/purchase.js, which owns these names and is the only thing
// that actually moves a balance. A test cross-checks the two rather than trusting that
// both were edited.
//
// The window needs them because it asks the question: the server broadcasts every balance
// change already, so the shop knows before it sends whether a purchase will come up short
// and can ask how to cover it, rather than sending, being refused, and asking afterwards.

/**
 * The house rule that lets a player buy something they cannot afford.
 *
 * Universal, and the key says so by carrying no system prefix. Every ruleset in the app
 * has money, and whether you can spend past zero is a table decision rather than a CWN or
 * Cyberpunk one - which is why it sits in the global list beside INITIATIVE FOLLOWS
 * BUILDING rather than with the per-system rules.
 */
export const OVERDRAFT_RULE = 'allow_overdraft';

/**
 * How a shortfall gets covered.
 *
 * Two different decisions with two different consequences, which is why the shop asks
 * instead of picking. `balance` takes the account under and leaves the GM to decide what
 * that costs. `debt` spends whatever cash is there and borrows the rest, feeding the
 * debt the bank window already tracks.
 */
export type Settle = 'balance' | 'debt';

export const SETTLE_BALANCE: Settle = 'balance';
export const SETTLE_DEBT: Settle = 'debt';

/**
 * What a shop pays for something sold back to it, as a percentage of the book price.
 *
 * Mirrored from backend/shops/buyback.js, which is the only thing that decides what a
 * sale is actually worth. Two levels: this global rate, and an optional per-shop override
 * stored on the location. A blank override means "use the global"; an override of 0 means
 * a shop that buys nothing back, and those must not collapse into each other.
 */
export const BUYBACK_SETTING = 'shop_buyback_pct';
export const DEFAULT_BUYBACK_PCT = 45;

/**
 * A stored rate as a number, or null if it is not one.
 *
 * Null rather than a fallback: a missing location rate means "use the global", a missing
 * global means "use the default", and collapsing those loses the difference. The type is
 * checked before the value because `Number([])` is 0, which would read as a shop that
 * pays nothing - a real, meaningful setting - rather than as rubbish.
 */
export const readPct = (value: unknown): number | null => {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1000) return null;
  return n;
};

/**
 * The rate that applies at one storefront: its own, then the global, then the default.
 *
 * A location set to 0 counts as set - a shop that pays nothing is a decision, not a blank.
 * This is for SHOWING a price; the server works the same number out again when it pays.
 */
export const buybackPct = (locationPct: unknown, globalPct: unknown): number => {
  const local = readPct(locationPct);
  if (local !== null) return local;
  const global = readPct(globalPct);
  return global !== null ? global : DEFAULT_BUYBACK_PCT;
};

/** What a shop hands over for something that cost `price`. Rounded down, never up. */
export const buybackValue = (price: number | null | undefined, pct: number): number => {
  if (typeof price !== 'number' || !Number.isFinite(price) || price < 0) return 0;
  return Math.floor((price * pct) / 100);
};

/** Why a purchase or a sale was refused, as the server names it. */
export type RefusalReason =
  | 'no_shop' | 'not_sold' | 'price' | 'funds' | 'needs_choice' | 'no_account' | 'write'
  // Selling adds its own: nothing staged, nothing owned, or no sheet to sell from.
  | 'empty' | 'not_owned' | 'no_sheet' | 'no_system'
  // The cart adds a count the server will not take.
  | 'qty';

/**
 * What to tell the player when the server says no.
 *
 * `needs_choice` is deliberately phrased as a fault on this side rather than theirs: the
 * window is supposed to ask before sending, so seeing it means the shop failed to.
 */
export const REFUSAL_TEXT: Record<RefusalReason, string> = {
  no_shop: 'This building is not a shop any more.',
  not_sold: 'This shop does not sell that.',
  price: 'That is not on the shelf.',
  funds: 'Not enough credits.',
  needs_choice: 'The shop did not ask how to cover this. Nothing was bought.',
  no_account: 'Could not read your account.',
  write: 'The payment did not go through. Nothing was bought.',
  empty: 'Nothing on the sell list.',
  /**
   * The sale was checked against the sheet and came up short.
   *
   * Reachable without anybody cheating: a sheet edited in another window while the sell
   * list sat here is enough. So it reads as something to look at again rather than as an
   * accusation.
   */
  not_owned: 'You do not have all of that any more. Nothing was sold — check the list.',
  no_sheet: 'No character sheet to sell from.',
  no_system: 'Could not tell which game is running.',
  qty: 'A quantity in the cart is more than the shop will sell at once. Nothing was charged.',
};
