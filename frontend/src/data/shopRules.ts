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

/** Why a purchase was refused, as the server names it. */
export type RefusalReason =
  | 'no_shop' | 'not_sold' | 'price' | 'funds' | 'needs_choice' | 'no_account' | 'write';

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
};
