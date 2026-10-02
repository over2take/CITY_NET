// What the bank allows in one currency (3c2a1): withdraw, borrow, pay debt, and the GM's own
// edit, worked out before anything is written.
//
// A custom currency says whether a player may owe in it (debt) and whether a balance may go
// below zero (negative), both off unless the GM turns them on (decided with the user,
// 2026-10-02; systemBuilder/currencies.js). The built-in systems keep today's bank exactly:
// borrowing is always open and a withdrawal may overdraw, so their rules are both on.
//
// Pure: it takes the account as it stands and answers with what moves (`moved`, the amounts a
// handler hands to accounts.adjust or currencies.adjust), or why nothing does (`reason`). The
// handlers that call it are 3c2a3's.

/**
 * Today's bank, which every built-in system keeps: borrowing open, overdrawing allowed, and the
 * GM's own edit taking any numbers at all (`free`), as adminUpdateBank always has.
 */
const BUILT_IN = Object.freeze({ debt: true, negative: true, free: true });

/** The rules for a custom currency (currencies.js shape), or the built-in bank's for none. */
const rulesFor = (currency) => (currency ? { debt: currency.debt === true, negative: currency.negative === true } : BUILT_IN);

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
/** A positive amount, or null for anything else (zero, negative, not a number). */
const positive = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : null; };

/** Take `amount` out of the balance. Below zero only where the currency allows it. */
const withdraw = (account, amount, rules) => {
  const a = positive(amount);
  if (a === null) return { ok: false, reason: 'amount' };
  if (num(account && account.balance) - a < 0 && !rules.negative) return { ok: false, reason: 'funds' };
  return { ok: true, moved: { balance: -a, debt: 0 } };
};

/** Owe `amount` more. Only where the currency allows debt. */
const borrow = (account, amount, rules) => {
  if (!rules.debt) return { ok: false, reason: 'no_debt' };
  const a = positive(amount);
  if (a === null) return { ok: false, reason: 'amount' };
  return { ok: true, moved: { balance: 0, debt: a } };
};

/** Pay `amount` off the debt, from the balance: never more than is owed or held. */
const payDebt = (account, amount) => {
  const asked = positive(amount);
  if (asked === null) return { ok: false, reason: 'amount' };
  const a = Math.min(asked, num(account && account.balance), num(account && account.debt));
  if (a <= 0) return { ok: false, reason: 'nothing' };
  return { ok: true, moved: { balance: -a, debt: -a } };
};

/**
 * The GM setting a balance and debt outright, held to the same switches: no debt where the
 * currency has none, no balance below zero where it may not go there.
 */
const setAccount = (balance, debt, rules) => {
  const b = Number(balance);
  const d = Number(debt);
  if (!Number.isFinite(b) || !Number.isFinite(d)) return { ok: false, reason: 'amount' };
  if (rules.free) return { ok: true, balance: b, debt: d };
  if (d < 0) return { ok: false, reason: 'amount' };
  if (d > 0 && !rules.debt) return { ok: false, reason: 'no_debt' };
  if (b < 0 && !rules.negative) return { ok: false, reason: 'no_negative' };
  return { ok: true, balance: b, debt: d };
};

module.exports = { BUILT_IN, rulesFor, withdraw, borrow, payDebt, setAccount };
