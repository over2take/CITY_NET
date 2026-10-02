// A player's money in each of a custom system's currencies (3c1b).
//
// A system's first currency is its main one, and its balance is the account it has always had
// (accounts.js, bank_accounts), so every balance already held is that currency's and nothing
// moves. Each further currency keeps its own balance and debt in bank_balances, which starts
// empty. A currency the system does not have is refused rather than guessed at.
//
// This stores and moves amounts, as accounts.js does; it does not decide what is allowed. Whether
// a player may owe in a currency, or go below zero, is the system's to say (currencies.js debt and
// negative), and the handlers that move money ask that first (3c2a). Amounts are whole numbers of
// the currency's smallest unit (434 for $4.34).
//
// A built-in system has no currencies here: it keeps its single account, through accounts.js.

const accounts = require('./accounts');
const customSystems = require('../systemBuilder/runtime');

const NOT_A_CURRENCY = (system, currency) => new Error(`${system} has no currency ${currency}`);

/** Where a currency's balance lives: 'main' (bank_accounts), 'extra' (bank_balances), or null. */
const placeOf = (system, currency) => {
  const list = customSystems.currenciesIn(system);
  const index = list.findIndex((c) => c.id === currency);
  if (index < 0) return null;
  return index === 0 ? 'main' : 'extra';
};

/** A player's balance and debt in one currency, zero where they have none yet. */
const get = (db, username, system, currency, cb) => {
  const place = placeOf(system, currency);
  if (!place) return cb(NOT_A_CURRENCY(system, currency));
  if (place === 'main') {
    return accounts.get(db, username, system, (err, row) => cb(err, err ? null : { balance: row ? row.balance : 0, debt: row ? row.debt : 0 }));
  }
  db.get('SELECT balance, debt FROM bank_balances WHERE username = ? AND system = ? AND currency = ?', [username, system, currency],
    (err, row) => cb(err || null, err ? null : { balance: row ? row.balance : 0, debt: row ? row.debt : 0 }));
};

/** A player's money in every currency of the system, in the system's order. Empty for a built-in. */
const all = (db, username, system, cb) => {
  const list = customSystems.currenciesIn(system);
  if (!list.length) return cb(null, []);
  accounts.get(db, username, system, (err, main) => {
    if (err) return cb(err);
    db.all('SELECT currency, balance, debt FROM bank_balances WHERE username = ? AND system = ?', [username, system], (err2, rows) => {
      if (err2) return cb(err2);
      const extra = new Map((rows || []).map((r) => [r.currency, r]));
      cb(null, list.map((c, i) => {
        const row = i === 0 ? main : extra.get(c.id);
        return { id: c.id, balance: row ? row.balance : 0, debt: row ? row.debt : 0 };
      }));
    });
  });
};

/** Set a player's balance and debt in one currency, opening it if needed. */
const put = (db, username, system, currency, balance, debt, cb) => {
  const place = placeOf(system, currency);
  if (!place) return cb(NOT_A_CURRENCY(system, currency));
  if (place === 'main') return accounts.put(db, username, system, balance, debt, cb);
  db.run(
    `INSERT INTO bank_balances (username, system, currency, balance, debt) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(username, system, currency) DO UPDATE SET balance = excluded.balance, debt = excluded.debt`,
    [username, system, currency, balance, debt],
    (err) => cb(err || null),
  );
};

/** Add to a player's balance in one currency, opening it at that amount if needed. */
const addToBalance = (db, username, system, currency, amount, cb) => {
  const place = placeOf(system, currency);
  if (!place) return cb(NOT_A_CURRENCY(system, currency));
  if (place === 'main') return accounts.addToBalance(db, username, system, amount, cb);
  db.run(
    `INSERT INTO bank_balances (username, system, currency, balance, debt) VALUES (?, ?, ?, ?, 0)
     ON CONFLICT(username, system, currency) DO UPDATE SET balance = COALESCE(balance, 0) + excluded.balance`,
    [username, system, currency, amount],
    (err) => cb(err || null),
  );
};

/**
 * Move an existing balance and debt by these amounts. cb(err, changed): a currency the player
 * holds nothing in yet is left alone, as accounts.adjust leaves a missing account.
 */
const adjust = (db, username, system, currency, { balance = 0, debt = 0 }, cb) => {
  const place = placeOf(system, currency);
  if (!place) return cb(NOT_A_CURRENCY(system, currency));
  if (place === 'main') return accounts.adjust(db, username, system, { balance, debt }, cb);
  db.run(
    'UPDATE bank_balances SET balance = balance + ?, debt = debt + ? WHERE username = ? AND system = ? AND currency = ?',
    [balance, debt, username, system, currency],
    function (err) { cb(err || null, err ? 0 : this.changes); },
  );
};

module.exports = { get, all, put, addToBalance, adjust };
