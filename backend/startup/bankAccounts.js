// The one-time move from one bank per player to one bank per player per system.
//
// Before this, `player_banks` held a single balance per player, shared by every game system.
// Now each system has its own (`bank_accounts`, see bank/accounts.js). The move copies each
// player's balance, debt and one-time flags into every system they have a sheet in, plus the
// system the game is running now - so every game looks exactly as it did the day this ships,
// and from then on each system's account is its own (decided with the user, 2026-09-29).
//
// Safety, in order:
//  1. A copy of the whole database is taken first, when the disk has room (startup/backup.js).
//  2. `player_banks` is only read, never changed or dropped, so the old balances stay in the
//     database whatever happens.
//  3. The copying is one transaction: all of it lands, or none.
//  4. A marker in global_settings records that it ran, so it runs once. That matters beyond
//     tidiness: a player who later makes a sheet in a new system must start that bank at zero,
//     not have an old balance copied in again.
//
// Until it finishes, every bank operation waits (bank/accounts.js `setReady`).

const { backupDatabase } = require('./backup');
const { DEFAULT_SYSTEM } = require('../sheets/templates');

const MARKER = 'migration_bank_accounts';

const q = (db, method, sql, params = []) => new Promise((resolve, reject) => {
  db[method](sql, params, function (err, rows) { if (err) reject(err); else resolve(method === 'run' ? this : rows); });
});

/**
 * Run the move if it has not run. Resolves to what happened:
 * `{ ran: false }`, or `{ ran: true, accounts, backup }` where backup is the copy's path or
 * the reason none was made.
 */
const migrateBankAccounts = async (db, dbPath, { log = console } = {}) => {
  const done = await q(db, 'get', 'SELECT value FROM global_settings WHERE key = ?', [MARKER]);
  if (done) return { ran: false };

  const legacy = await q(db, 'get', `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'player_banks'`);
  const rows = legacy ? await q(db, 'all', 'SELECT * FROM player_banks') : [];

  let backup = null;
  if (rows.length) {
    backup = await new Promise((resolve) => {
      backupDatabase(db, dbPath, 'bank-accounts', (err, result) => {
        if (err) {
          log.warn(`[bank] Could not copy the database before moving banks (${err.message}). The old balances stay in player_banks.`);
          return resolve(`failed: ${err.message}`);
        }
        if (result.skipped) {
          log.warn(`[bank] No database copy made: ${result.skipped}. The old balances stay in player_banks.`);
          return resolve(`skipped: ${result.skipped}`);
        }
        log.log(`[bank] Database copied to ${result.path} before moving banks.`);
        return resolve(result.path);
      });
    });
  }

  const active = await q(db, 'get', `SELECT value FROM global_settings WHERE key = 'game_system'`);
  const activeSystem = active && active.value ? active.value : DEFAULT_SYSTEM;
  const sheets = await q(db, 'all', 'SELECT DISTINCT username, system FROM character_sheets WHERE is_npc = 0');
  const systemsOf = new Map();
  for (const s of sheets) {
    if (!systemsOf.has(s.username)) systemsOf.set(s.username, new Set());
    systemsOf.get(s.username).add(s.system);
  }

  let accounts = 0;
  await q(db, 'run', 'BEGIN IMMEDIATE');
  try {
    for (const row of rows) {
      const systems = new Set(systemsOf.get(row.username) || []);
      systems.add(activeSystem);
      for (const system of systems) {
        // OR IGNORE: an account that somehow exists already keeps what it has.
        const res = await q(db, 'run',
          `INSERT OR IGNORE INTO bank_accounts (username, system, balance, debt, first_pay_done, high_roller_done)
           VALUES (?, ?, ?, ?, ?, ?)`,
          [row.username, system, row.balance ?? 0, row.debt ?? 0, row.first_pay_done ? 1 : 0, row.high_roller_done ? 1 : 0]);
        accounts += res.changes;
      }
    }
    await q(db, 'run', 'INSERT OR REPLACE INTO global_settings (key, value) VALUES (?, ?)', [MARKER, new Date().toISOString()]);
    await q(db, 'run', 'COMMIT');
  } catch (err) {
    await q(db, 'run', 'ROLLBACK').catch(() => {});
    throw err;
  }
  if (rows.length) log.log(`[bank] Moved ${rows.length} player bank(s) into ${accounts} per-system account(s).`);
  return { ran: true, accounts, backup };
};

module.exports = { migrateBankAccounts, MARKER };
