// Bank accounts: one per player per game system.
//
// A character's money belongs to the game it was earned in (decided with the user,
// 2026-09-29): a CWN character's credits must not turn up in a D&D campaign. So an account
// is keyed by player AND system, in `bank_accounts`. The account a handler uses is the
// running system's, which `activeSystem` reads.
//
// Every read and write of an account goes through here, and each one waits for the one-time
// move from the old per-player table (startup/bankAccounts.js) to finish. That wait is not
// decoration: browsers reconnect within milliseconds of a restart, and an empty account
// opened before the move would block the player's real balance from being copied in.

const { DEFAULT_SYSTEM } = require('../sheets/templates');

let ready = Promise.resolve();

/**
 * Hold every account operation until `promise` settles. Set once at startup by db.js. A
 * failure is handled here as well as by each operation, so it can never surface as an
 * unhandled rejection, which would stop the whole server.
 */
const setReady = (promise) => {
  ready = Promise.resolve(promise);
  ready.catch(() => {});
};

/** Run `fn` once accounts are ready, or hand `cb` the reason they never became ready. */
const whenReady = (cb, fn) => {
  ready.then(fn, (err) => cb(err || new Error('Bank accounts are not ready')));
};

/** The system the game is running. */
const activeSystem = (db, cb) => {
  db.get(`SELECT value FROM global_settings WHERE key = 'game_system'`, [], (err, row) => {
    cb(err, row && row.value ? row.value : DEFAULT_SYSTEM);
  });
};

const COLUMNS = 'balance, debt, first_pay_done, high_roller_done';

/** A player's account in `system`, or null when they have none yet. */
const get = (db, username, system, cb) => whenReady(cb, () => {
  db.get(`SELECT ${COLUMNS} FROM bank_accounts WHERE username = ? AND system = ?`, [username, system],
    (err, row) => cb(err || null, row || null));
});

/** A player's account in `system`, opened at zero if they have none. */
const ensure = (db, username, system, cb) => whenReady(cb, () => {
  db.run(`INSERT OR IGNORE INTO bank_accounts (username, system, balance, debt) VALUES (?, ?, 0, 0)`, [username, system], (err) => {
    if (err) return cb(err);
    db.get(`SELECT ${COLUMNS} FROM bank_accounts WHERE username = ? AND system = ?`, [username, system],
      (err2, row) => cb(err2 || null, row || null));
  });
});

/** Set an account's balance and debt, opening it if needed. */
const put = (db, username, system, balance, debt, cb) => whenReady(cb, () => {
  db.run(
    `INSERT INTO bank_accounts (username, system, balance, debt) VALUES (?, ?, ?, ?)
     ON CONFLICT(username, system) DO UPDATE SET balance = excluded.balance, debt = excluded.debt`,
    [username, system, balance, debt],
    (err) => cb(err || null),
  );
});

/** Add to an account's balance, opening it at that amount if needed. */
const addToBalance = (db, username, system, amount, cb) => whenReady(cb, () => {
  db.run(
    `INSERT INTO bank_accounts (username, system, balance, debt) VALUES (?, ?, ?, 0)
     ON CONFLICT(username, system) DO UPDATE SET balance = COALESCE(balance, 0) + excluded.balance`,
    [username, system, amount],
    (err) => cb(err || null),
  );
});

/**
 * Move an existing account's balance and debt by these amounts. An account that does not
 * exist is left alone, as the old handlers did (a withdrawal never opens an account).
 */
const adjust = (db, username, system, { balance = 0, debt = 0 }, cb) => whenReady(cb, () => {
  db.run(
    `UPDATE bank_accounts SET balance = balance + ?, debt = debt + ? WHERE username = ? AND system = ?`,
    [balance, debt, username, system],
    function (err) { cb(err || null, err ? 0 : this.changes); },
  );
});

const FLAGS = new Set(['first_pay_done', 'high_roller_done']);

/** Mark a one-time bank event (first payday, high roller) done for this account. */
const markFlag = (db, username, system, flag, cb) => whenReady(cb, () => {
  if (!FLAGS.has(flag)) return cb(new Error(`unknown bank flag ${flag}`));
  db.run(`UPDATE bank_accounts SET ${flag} = 1 WHERE username = ? AND system = ?`, [username, system], (err) => cb(err || null));
});

module.exports = { setReady, activeSystem, get, ensure, put, addToBalance, adjust, markFlag };
