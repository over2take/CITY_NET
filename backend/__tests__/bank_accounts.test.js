import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { createRequire } from 'module';
import { makeTestDb, get, all, run } from './helpers/testDb.js';
import { until, untilValue, drain } from './helpers/until.js';

/**
 * One bank account per player per game system.
 *
 * A character's money belongs to the game it was earned in, so a CWN character's credits
 * must not turn up in a D&D campaign. The move from the old one-bank-per-player table copies
 * each balance into every system the player has a sheet in, plus the running one, once, after
 * copying the whole database - and never touches the old table, so nothing can be lost.
 */

process.env.JWT_SECRET = 'test-secret';
process.env.DICE_ANIM_MS = '0';
const require_ = createRequire(import.meta.url);
const accounts = require_('../bank/accounts');
const { migrateBankAccounts, MARKER } = require_('../startup/bankAccounts');
const { backupDatabase } = require_('../startup/backup');
const socketsFactory = require_('../sockets/index.js');
const sqlite3 = require_('sqlite3');

const CWN = 'cities_without_number';
const CPR = 'cyberpunk_red';
const cb2p = (fn, ...args) => new Promise((resolve, reject) => fn(...args, (err, v) => (err ? reject(err) : resolve(v))));
const quiet = { log: () => {}, warn: () => {} };

let db;
beforeEach(async () => { db = await makeTestDb(); });
afterEach(() => { accounts.setReady(Promise.resolve()); vi.restoreAllMocks(); });

describe('accounts', () => {
  it('keeps each system\'s money apart', async () => {
    await cb2p(accounts.put, db, 'GHOST', CWN, 500, 20);
    await cb2p(accounts.put, db, 'GHOST', CPR, 7, 0);
    expect(await cb2p(accounts.get, db, 'GHOST', CWN)).toMatchObject({ balance: 500, debt: 20 });
    expect(await cb2p(accounts.get, db, 'GHOST', CPR)).toMatchObject({ balance: 7, debt: 0 });
    expect(await cb2p(accounts.get, db, 'GHOST', 'shadowrun_6e')).toBeNull();
  });

  it('opens an account at zero when asked to make sure of one', async () => {
    expect(await cb2p(accounts.ensure, db, 'GHOST', CWN)).toMatchObject({ balance: 0, debt: 0, first_pay_done: 0 });
    await cb2p(accounts.put, db, 'GHOST', CWN, 50, 0);
    expect((await cb2p(accounts.ensure, db, 'GHOST', CWN)).balance).toBe(50);
  });

  it('adds to a balance, opening the account if needed', async () => {
    await cb2p(accounts.addToBalance, db, 'GHOST', CWN, 100);
    await cb2p(accounts.addToBalance, db, 'GHOST', CWN, 25.5);
    expect((await cb2p(accounts.get, db, 'GHOST', CWN)).balance).toBe(125.5);
  });

  it('moves an existing account, and leaves a missing one alone, as withdrawals always did', async () => {
    await cb2p(accounts.put, db, 'GHOST', CWN, 100, 10);
    expect(await cb2p(accounts.adjust, db, 'GHOST', CWN, { balance: -30, debt: 5 })).toBe(1);
    expect(await cb2p(accounts.get, db, 'GHOST', CWN)).toMatchObject({ balance: 70, debt: 15 });
    expect(await cb2p(accounts.adjust, db, 'NOBODY', CWN, { balance: -30 })).toBe(0);
    expect(await cb2p(accounts.get, db, 'NOBODY', CWN)).toBeNull();
  });

  it('marks one-time events per account, and only the known ones', async () => {
    await cb2p(accounts.ensure, db, 'GHOST', CWN);
    await cb2p(accounts.markFlag, db, 'GHOST', CWN, 'first_pay_done');
    expect((await cb2p(accounts.get, db, 'GHOST', CWN)).first_pay_done).toBe(1);
    await expect(cb2p(accounts.markFlag, db, 'GHOST', CWN, 'balance = 999999, first_pay_done')).rejects.toThrow(/unknown bank flag/);
  });

  it('holds every operation until the move has finished', async () => {
    let finish;
    accounts.setReady(new Promise((resolve) => { finish = resolve; }));
    let seen = 'waiting';
    accounts.ensure(db, 'GHOST', CWN, () => { seen = 'ran'; });
    await drain(db);
    expect(seen).toBe('waiting');
    finish();
    await untilValue(() => seen, (s) => s === 'ran', { label: 'the held operation' });
  });

  it('turns a failed move into an error for each operation, never a crash', async () => {
    accounts.setReady(Promise.reject(new Error('move failed')));
    await expect(cb2p(accounts.get, db, 'GHOST', CWN)).rejects.toThrow('move failed');
  });
});

describe('the one-time move from one bank per player', () => {
  const legacy = async (rows) => {
    await run(db, `CREATE TABLE player_banks (username TEXT PRIMARY KEY, balance REAL DEFAULT 0, debt REAL DEFAULT 0,
      first_pay_done INTEGER DEFAULT 0, high_roller_done INTEGER DEFAULT 0)`);
    for (const r of rows) {
      await run(db, 'INSERT INTO player_banks (username, balance, debt, first_pay_done, high_roller_done) VALUES (?, ?, ?, ?, ?)',
        [r.username, r.balance, r.debt ?? 0, r.first ?? 0, r.high ?? 0]);
    }
  };
  const sheet = (username, system) => run(db,
    `INSERT INTO character_sheets (username, system, data, is_npc) VALUES (?, ?, '{}', 0)`, [username, system]);
  const accountsOf = (username) => all(db,
    'SELECT system, balance, debt, first_pay_done, high_roller_done FROM bank_accounts WHERE username = ? ORDER BY system', [username]);

  beforeEach(async () => {
    await run(db, `INSERT INTO global_settings (key, value) VALUES ('game_system', ?)`, [CWN]);
  });

  it('copies each balance into every system the player has a sheet in, and the running one', async () => {
    await legacy([
      { username: 'GHOST', balance: 1200.5, debt: 300, first: 1 },
      { username: 'NEWBIE', balance: 40 },
    ]);
    await sheet('GHOST', CPR);
    await sheet('GHOST', 'shadowrun_6e');
    // An NPC sheet is not a player's game.
    await run(db, `INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('GHOST', 'generic', '{}', 1)`);

    const result = await migrateBankAccounts(db, ':memory:', { log: quiet });
    expect(result).toMatchObject({ ran: true, accounts: 4 });

    const one = { balance: 1200.5, debt: 300, first_pay_done: 1, high_roller_done: 0 };
    expect(await accountsOf('GHOST')).toEqual([
      { system: CWN, ...one }, { system: CPR, ...one }, { system: 'shadowrun_6e', ...one },
    ]);
    // No sheets at all: the running game still gets their money.
    expect(await accountsOf('NEWBIE')).toEqual([{ system: CWN, balance: 40, debt: 0, first_pay_done: 0, high_roller_done: 0 }]);
  });

  it('never changes the old table', async () => {
    await legacy([{ username: 'GHOST', balance: 99, debt: 1 }]);
    const before = await all(db, 'SELECT * FROM player_banks');
    await migrateBankAccounts(db, ':memory:', { log: quiet });
    expect(await all(db, 'SELECT * FROM player_banks')).toEqual(before);
  });

  it('runs once: a sheet made later in a new system starts that bank at zero', async () => {
    await legacy([{ username: 'GHOST', balance: 500 }]);
    await migrateBankAccounts(db, ':memory:', { log: quiet });
    expect(await get(db, 'SELECT value FROM global_settings WHERE key = ?', [MARKER])).toBeTruthy();

    await sheet('GHOST', CPR);
    expect(await migrateBankAccounts(db, ':memory:', { log: quiet })).toEqual({ ran: false });
    expect((await accountsOf('GHOST')).map((a) => a.system)).toEqual([CWN]);
  });

  it('with nothing to move, only records that it ran, and makes no copy', async () => {
    const result = await migrateBankAccounts(db, ':memory:', { log: quiet });
    expect(result).toEqual({ ran: true, accounts: 0, backup: null });
    expect(await get(db, 'SELECT value FROM global_settings WHERE key = ?', [MARKER])).toBeTruthy();
  });

  it('keeps an account that somehow exists already', async () => {
    await legacy([{ username: 'GHOST', balance: 500 }]);
    await run(db, `INSERT INTO bank_accounts (username, system, balance, debt) VALUES ('GHOST', ?, 7, 0)`, [CWN]);
    await migrateBankAccounts(db, ':memory:', { log: quiet });
    expect((await accountsOf('GHOST'))[0].balance).toBe(7);
  });

  it('lands all or nothing: a failure part way leaves no accounts and no marker, to try again', async () => {
    await legacy([{ username: 'AAA', balance: 1 }, { username: 'ZZZ', balance: 2 }]);
    // Refuse the second player's account, after the first has been written.
    await run(db, `CREATE TRIGGER refuse BEFORE INSERT ON bank_accounts WHEN NEW.username = 'ZZZ'
                   BEGIN SELECT RAISE(ABORT, 'refused'); END`);
    await expect(migrateBankAccounts(db, ':memory:', { log: quiet })).rejects.toThrow('refused');
    expect(await all(db, 'SELECT * FROM bank_accounts')).toEqual([]);
    expect(await get(db, 'SELECT value FROM global_settings WHERE key = ?', [MARKER])).toBeUndefined();
    // And the connection is usable afterwards, not stuck in the transaction.
    await run(db, 'DROP TRIGGER refuse');
    expect((await migrateBankAccounts(db, ':memory:', { log: quiet })).accounts).toBe(2);
  });
});

describe('the database copy before a migration', () => {
  let dir;
  let fileDb;
  beforeEach(async () => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'citynet-backup-'));
    fileDb = await new Promise((resolve, reject) => {
      const d = new sqlite3.Database(path.join(dir, 'city.db'), (err) => (err ? reject(err) : resolve(d)));
    });
    await run(fileDb, 'CREATE TABLE player_banks (username TEXT PRIMARY KEY, balance REAL)');
    await run(fileDb, `INSERT INTO player_banks VALUES ('GHOST', 1234)`);
  });
  afterEach(async () => {
    await new Promise((resolve) => fileDb.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('writes a whole, readable copy beside the database', async () => {
    const result = await cb2p(backupDatabase, fileDb, path.join(dir, 'city.db'), 'test');
    expect(path.dirname(result.path)).toBe(dir);
    expect(path.basename(result.path)).toMatch(/^city\.db\.before-test-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d\.bak$/);
    const copy = await new Promise((resolve, reject) => {
      const d = new sqlite3.Database(result.path, sqlite3.OPEN_READONLY, (err) => (err ? reject(err) : resolve(d)));
    });
    expect(await get(copy, 'SELECT balance FROM player_banks')).toEqual({ balance: 1234 });
    await new Promise((resolve) => copy.close(resolve));
  });

  it('makes no copy, and says why, when the disk is too full for one', async () => {
    const result = await new Promise((resolve, reject) => backupDatabase(fileDb, path.join(dir, 'city.db'), 'test',
      (err, r) => (err ? reject(err) : resolve(r)), { free: () => 1024 }));
    expect(result.skipped).toMatch(/not enough disk space/);
    expect(fs.readdirSync(dir).filter((f) => f.endsWith('.bak'))).toEqual([]);
  });

  it('has nothing to copy for an in-memory database', async () => {
    expect(await cb2p(backupDatabase, db, ':memory:', 'test')).toEqual({ skipped: 'in-memory database' });
  });
});

describe('money in play, with more than one system', () => {
  const server = () => {
    const sent = [];
    let connectionCb;
    const io = {
      on: (event, cb) => { if (event === 'connection') connectionCb = cb; },
      emit: (event, data) => sent.push({ event, data }),
      to: () => ({ emit: (event, data) => sent.push({ event, data }) }),
    };
    socketsFactory(io, db, { elevatedUsers: new Set(), emitUpdate: vi.fn(), recordAction: vi.fn() });
    const connect = async (name) => {
      const handlers = {};
      connectionCb({
        id: `bank-${Math.random().toString(36).slice(2)}`,
        on: (e, fn) => { handlers[e] = fn; },
        emit: (event, data) => sent.push({ event, data, self: true }),
        broadcast: { emit: () => {} }, use: () => {}, join: () => {}, disconnect: vi.fn(),
      });
      handlers.identify(name);
      await drain(db);
      return handlers;
    };
    return { sent, connect };
  };
  const setSystem = (system) => run(db, `INSERT OR REPLACE INTO global_settings (key, value) VALUES ('game_system', ?)`, [system]);
  const latestBalance = (sent, username) => {
    const u = sent.filter((e) => e.event === 'bankUpdate' && e.data.username === username).at(-1);
    return u ? u.data.balance : undefined;
  };

  beforeEach(() => { vi.spyOn(console, 'log').mockImplementation(() => {}); });

  it('shows and moves the running system\'s account, and keeps the other one intact', async () => {
    await setSystem(CWN);
    await run(db, `INSERT INTO bank_accounts (username, system, balance, debt) VALUES ('GHOST', ?, 1000, 0)`, [CWN]);
    const s = server();
    const ghost = await s.connect('GHOST');

    ghost.requestBankBalance({ username: 'GHOST' });
    expect(await untilValue(() => latestBalance(s.sent, 'GHOST'), (b) => b === 1000, { label: 'CWN balance' })).toBe(1000);

    // A new campaign on another system: a fresh account, not the CWN money.
    await setSystem(CPR);
    ghost.requestBankBalance({ username: 'GHOST' });
    // until, not untilValue: that one hands back the value, and a balance of 0 reads as "not yet".
    await until(() => latestBalance(s.sent, 'GHOST') === 0, { label: 'a fresh CP:R account' });
    ghost.borrowFunds({ amount: 50 });
    await untilValue(() => get(db, 'SELECT debt FROM bank_accounts WHERE username = ? AND system = ?', ['GHOST', CPR]),
      (r) => r && r.debt === 50, { label: 'CP:R debt' });

    // Back to the CWN campaign: its money is exactly where it was.
    await setSystem(CWN);
    expect(await get(db, 'SELECT balance, debt FROM bank_accounts WHERE username = ? AND system = ?', ['GHOST', CWN]))
      .toEqual({ balance: 1000, debt: 0 });
  });
});

describe('the real startup path', () => {
  it('moves an existing server\'s banks when db.js opens it, after copying the database', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'citynet-startup-'));
    const file = path.join(dir, 'city.db');
    try {
      // A database as a server running 1.14.4 left it: one bank per player.
      const seed = [
        `CREATE TABLE global_settings (key TEXT PRIMARY KEY, value TEXT)`,
        `INSERT INTO global_settings VALUES ('game_system', '${CWN}')`,
        `CREATE TABLE character_sheets (id INTEGER PRIMARY KEY AUTOINCREMENT, username TEXT NOT NULL, system TEXT NOT NULL,
          data TEXT NOT NULL DEFAULT '{}', portrait_url TEXT, is_npc INTEGER DEFAULT 0, npc_label TEXT, folder TEXT,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
        `INSERT INTO character_sheets (username, system, data, is_npc) VALUES ('GHOST', '${CPR}', '{}', 0)`,
        `CREATE TABLE player_banks (username TEXT PRIMARY KEY, balance REAL DEFAULT 0.00, debt REAL DEFAULT 0.00,
          first_pay_done INTEGER DEFAULT 0, high_roller_done INTEGER DEFAULT 0)`,
        `INSERT INTO player_banks VALUES ('GHOST', 750, 25, 1, 0)`,
      ];
      const script = `
        const sqlite3 = require(${JSON.stringify(require_.resolve('sqlite3'))});
        const seedDb = new sqlite3.Database(${JSON.stringify(file)});
        seedDb.serialize(() => { for (const s of ${JSON.stringify(seed)}) seedDb.run(s); });
        seedDb.close(() => {
          process.env.DB_PATH = ${JSON.stringify(file)};
          console.log = () => {}; console.warn = () => {};
          const db = require(${JSON.stringify(require_.resolve('../db.js'))});
          const accounts = require(${JSON.stringify(require_.resolve('../bank/accounts.js'))});
          accounts.get(db, 'GHOST', '${CPR}', (err, cpr) => {
            accounts.get(db, 'GHOST', '${CWN}', (err2, cwn) => {
              // Exit rather than close: db.js's other startup work may still be queued.
              process.stdout.write(JSON.stringify({ err: err && err.message, cpr, cwn }), () => process.exit(0));
            });
          });
        });`;
      const out = JSON.parse(execFileSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 60000 }));
      const moved = { balance: 750, debt: 25, first_pay_done: 1, high_roller_done: 0 };
      expect(out).toEqual({ err: null, cpr: moved, cwn: moved });
      const copies = fs.readdirSync(dir).filter((f) => /^city\.db\.before-bank-accounts-.*\.bak$/.test(f));
      expect(copies).toHaveLength(1);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
