// Checking out a shop cart: everything bought and everything sold, settled as one.
//
// The cart replaced a BUY that charged on every press and a separate sell list with its own
// confirmation. Settling it as one is the point: the account moves once, by the difference,
// and either every line goes through or none does. A cart that stopped halfway - paid for
// the first two guns, refused the third - would leave the player to work out what they now
// owe and own.
//
// Pure: prices, the sale and the account come in, the plan goes out, and the caller writes
// it. The sale half is shops/sell.js's planSale, unchanged, so selling through the cart is
// held to exactly what selling was held to.

const { planPurchase, SETTLE_BALANCE, SETTLE_DEBT } = require('./purchase');

/** More of one line than anybody buys at a counter; a typo, or a crafted message. */
const MAX_QTY = 99;

/** Credits to the cent, so a total computed twice compares equal. */
const cents = (n) => Math.round((Number(n) || 0) * 100);

/**
 * Plan a checkout.
 *
 * `buys` are `{ catalogue, itemId, qty }` as the window sent them; nothing about their price
 * is taken from it. `priceOf(catalogue, itemId)` is the server's own price, null when there
 * is no such item. `shelved` is what this shop puts on its shelves. `sale` is planSale's
 * successful result, or null when nothing is being sold.
 *
 * `expectedNet` is what the window showed the player. If the server works out something
 * else - a GM repriced a shelf while the cart sat there - nothing is charged and the new
 * figures go back, so nobody pays a total they were never shown.
 *
 * Returns `{ ok: true, lines, buyTotal, payout, net, balance, debt, settled }` or
 * `{ ok: false, reason, ... }`. `net` is positive when the player pays the shop and
 * negative when the shop pays the player.
 */
const planCheckout = ({
  buys, priceOf, shelved, sale, balance, debt, overdraftAllowed, settle, expectedNet,
}) => {
  const lines = [];
  for (const b of Array.isArray(buys) ? buys : []) {
    const catalogue = String((b && b.catalogue) || '');
    const itemId = String((b && b.itemId) || '');
    const qty = Number(b && b.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) {
      return { ok: false, reason: 'qty', catalogue, itemId };
    }
    if (!shelved.includes(catalogue)) return { ok: false, reason: 'not_sold', catalogue, itemId };
    const price = priceOf(catalogue, itemId);
    // The same guard as planPurchase: null is "no such item", never "free".
    if (typeof price !== 'number' || !Number.isFinite(price) || price < 0) {
      return { ok: false, reason: 'price', catalogue, itemId };
    }
    lines.push({ catalogue, itemId, qty, price });
  }
  if (lines.length === 0 && !sale) return { ok: false, reason: 'empty' };

  const buyTotal = lines.reduce((sum, l) => sum + l.price * l.qty, 0);
  const payout = sale ? Number(sale.payout) || 0 : 0;
  const net = buyTotal - payout;
  const totals = { buyTotal, payout, net };

  if (expectedNet !== undefined && expectedNet !== null && cents(expectedNet) !== cents(net)) {
    return { ok: false, reason: 'total_changed', ...totals };
  }

  if (net > 0) {
    // Paying the difference is a purchase of that much: same funds, overdraft and
    // settle rules as a single BUY always had.
    const plan = planPurchase({ balance, debt, price: net, overdraftAllowed, settle });
    if (!plan.ok) return { ...plan, ...totals };
    return { ok: true, lines, ...totals, balance: plan.balance, debt: plan.debt, settled: plan.settled };
  }

  // The shop owes the player, or they come out even. Debt is left alone: paying it off is
  // the bank's own button, not something a sale does behind the player's back.
  return {
    ok: true, lines, ...totals,
    balance: (Number(balance) || 0) - net,
    debt: Number(debt) || 0,
    settled: SETTLE_BALANCE,
  };
};

/**
 * Plan a checkout in a custom system's currencies (3c2a4a).
 *
 * Each catalogue is priced in its own currency (buildings.js catalogueCurrency, decided with
 * the user 2026-10-02), so a cart can hold Gold for the market's goods and Favor for the guild
 * hall's. Every currency the cart touches is worked out, and settled on its own account, as
 * planCheckout settles the one: either every currency goes through or none does.
 *
 * A shortfall is covered only as that currency allows (the user, 2026-10-02): with debt on, by
 * borrowing the rest ('debt'); with negative on, by going below zero ('balance'); with neither,
 * it is refused. Where it may be covered and the cart did not say how, the answer is
 * 'needs_choice' with the ways that currency allows, so the window can ask.
 *
 * Amounts are whole numbers of each currency's smallest unit (currencies.js); a buy-back that
 * comes to a fraction pays the whole units below it.
 *
 * `currencyOf(catalogue)` is the catalogue's currency (currencies.js shape). `accounts`,
 * `settle` and `expectedNet` are keyed by currency id. Returns
 * `{ ok: true, lines, currencies: { [id]: { buyTotal, payout, net, balance, debt, settled } } }`
 * or `{ ok: false, reason, currency?, ... }`.
 */
const planCheckoutInCurrencies = ({
  buys, priceOf, shelved, sale, currencyOf, accounts, settle, expectedNet,
}) => {
  const lines = [];
  const byId = new Map();
  const note = (currency) => {
    if (!byId.has(currency.id)) byId.set(currency.id, { currency, buyTotal: 0, payout: 0 });
    return byId.get(currency.id);
  };
  for (const b of Array.isArray(buys) ? buys : []) {
    const catalogue = String((b && b.catalogue) || '');
    const itemId = String((b && b.itemId) || '');
    const qty = Number(b && b.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > MAX_QTY) return { ok: false, reason: 'qty', catalogue, itemId };
    if (!shelved.includes(catalogue)) return { ok: false, reason: 'not_sold', catalogue, itemId };
    const price = priceOf(catalogue, itemId);
    if (typeof price !== 'number' || !Number.isFinite(price) || price < 0) return { ok: false, reason: 'price', catalogue, itemId };
    const currency = currencyOf(catalogue);
    if (!currency) return { ok: false, reason: 'price', catalogue, itemId };
    lines.push({ catalogue, itemId, qty, price, currency: currency.id });
    note(currency).buyTotal += price * qty;
  }
  for (const s of sale && Array.isArray(sale.sold) ? sale.sold : []) {
    const currency = currencyOf(s.catalogue);
    if (!currency) return { ok: false, reason: 'not_sold', catalogue: s.catalogue };
    note(currency).payout += (Number(s.each) || 0) * (Number(s.qty) || 0);
  }
  if (!byId.size) return { ok: false, reason: 'empty' };

  const out = {};
  for (const [id, t] of byId) {
    const buyTotal = Math.round(t.buyTotal);
    const payout = Math.floor(t.payout);
    const net = buyTotal - payout;
    const totals = { buyTotal, payout, net };
    const shown = expectedNet && Object.prototype.hasOwnProperty.call(expectedNet, id) ? expectedNet[id] : undefined;
    if (shown !== undefined && shown !== null && Math.round(Number(shown)) !== net) {
      return { ok: false, reason: 'total_changed', currency: id, ...totals };
    }
    const account = (accounts && accounts[id]) || {};
    const have = Number(account.balance) || 0;
    const owed = Number(account.debt) || 0;
    if (net <= 0 || net <= have) {
      // Paying what is held, or the shop paying the player: debt is left alone, as in
      // planCheckout (paying it off is the bank's own button). A sale is never short, even to
      // a balance already below zero: it only brings it up (found by the browser's own totals
      // being held to these, 3c2b2).
      out[id] = { ...totals, balance: have - net, debt: owed, settled: SETTLE_BALANCE };
      continue;
    }
    const ways = [t.currency.negative && SETTLE_BALANCE, t.currency.debt && SETTLE_DEBT].filter(Boolean);
    if (!ways.length) return { ok: false, reason: 'funds', currency: id, ...totals };
    const how = settle && settle[id];
    if (!ways.includes(how)) return { ok: false, reason: 'needs_choice', currency: id, options: ways, ...totals };
    const plan = planPurchase({ balance: have, debt: owed, price: net, overdraftAllowed: true, settle: how });
    if (!plan.ok) return { ...plan, currency: id, ...totals };
    out[id] = { ...totals, balance: plan.balance, debt: plan.debt, settled: plan.settled };
  }
  return { ok: true, lines, currencies: out };
};

module.exports = { planCheckout, planCheckoutInCurrencies, MAX_QTY };
