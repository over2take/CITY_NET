/**
 * Buying something over the socket.
 *
 * The arithmetic is tested on its own in shop_purchase.test.js. What is tested HERE is
 * everything the handler refuses, which is the half that matters: this is the only code
 * path in the app where a message from a client moves money, so the interesting cases are
 * all the ways a crafted message should fail to.
 *
 * In particular it should not be possible to name somebody else as the payer, to buy from
 * a shop that does not stock the thing, or to invent a price.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeTestDb, get, run } from './helpers/testDb.js';
import { untilValue, drain } from './helpers/until.js';
import { createRequire } from 'module';

process.env.JWT_SECRET = 'test-secret';
process.env.DICE_ANIM_MS = '0';

const socketsFactory = (await import('../sockets/index.js')).default;
const require_ = createRequire(import.meta.url);
const { OVERDRAFT_RULE } = require_('../shops/purchase');
const prices = require_('../shops/prices');

/**
 * `id` matters more than it looks.
 *
 * The server keeps who-is-who in a map keyed by socket id, and that map outlives a single
 * test in this file. Booting every socket as "sock-1" meant an unidentified socket
 * inherited the previous test's user and looked authenticated - which is exactly the case
 * the test below is trying to prove cannot happen.
 */
let nextSocket = 0;
function boot(db, id = `sock-${(nextSocket += 1)}`) {
  const emitted = [];
  let connectionCb;
  const io = {
    on: (event, cb) => { if (event === 'connection') connectionCb = cb; },
    emit: (event, data) => emitted.push({ event, data }),
    to: () => ({ emit: (event, data) => emitted.push({ event, data }) }),
  };
  socketsFactory(io, db, { elevatedUsers: new Set(), emitUpdate: vi.fn(), recordAction: vi.fn() });
  const handlers = {};
  const socket = {
    id,
    on: (event, fn) => { handlers[event] = fn; },
    emit: (event, data) => emitted.push({ event, data, direct: true }),
    broadcast: { emit: (event, data) => emitted.push({ event, data, broadcast: true }) },
    use: () => {}, join: () => {},
  };
  connectionCb(socket);
  return { handlers, emitted };
}

let db;
let gunShop;

beforeEach(async () => {
  db = await makeTestDb();
  await run(db, `CREATE TABLE IF NOT EXISTS player_banks (
    username TEXT PRIMARY KEY, balance REAL, debt REAL,
    first_pay_done INTEGER DEFAULT 0, high_roller_done INTEGER DEFAULT 0)`);
  await run(db, `INSERT INTO global_settings (key, value) VALUES ('game_system', 'cities_without_number')`);
  const r = await run(db,
    `INSERT INTO locations (name, x, y, z, shape, building_type) VALUES ('Vic''s', 0, 0, 0, 'box', 'gun_shop')`);
  gunShop = r.lastID;
});

const identified = async (name = 'GHOST') => {
  const booted = boot(db);
  booted.handlers['identify'](name);
  await drain(db);
  return booted;
};

const fund = (username, balance, debt = 0) => run(db,
  'INSERT OR REPLACE INTO player_banks (username, balance, debt) VALUES (?, ?, ?)',
  [username, balance, debt]);

const bank = async (username = 'GHOST') =>
  get(db, 'SELECT balance, debt FROM player_banks WHERE username = ?', [username]);

const receipt = (emitted) =>
  [...emitted].reverse().find((e) => e.event === 'shopPurchase');

const waitReceipt = (emitted) =>
  untilValue(() => receipt(emitted), Boolean, { label: 'a shopPurchase reply' });

/** The heavy pistol is the running example; its price comes from the server's own table. */
const PISTOL = 'heavy_pistol';
const PISTOL_PRICE = prices.priceOf('weapons', PISTOL);

const buy = (handlers, over = {}) => handlers['buyFromShop']({
  locationId: gunShop, catalogue: 'weapons', itemId: PISTOL, ...over,
});

describe('paying for something you can afford', () => {
  it('takes the price out of the buyer\'s account', async () => {
    await fund('GHOST', 5000);
    const { handlers, emitted } = await identified();
    buy(handlers);

    const out = await waitReceipt(emitted);
    expect(out.data).toMatchObject({ ok: true, itemId: PISTOL, price: PISTOL_PRICE });
    expect((await bank()).balance).toBe(5000 - PISTOL_PRICE);
  });

  it('tells everyone the balance moved, so the sheet\'s cash field follows', async () => {
    await fund('GHOST', 5000);
    const { handlers, emitted } = await identified();
    buy(handlers);
    await waitReceipt(emitted);

    /**
     * Waited for, not read straight after the reply. sendBankUpdate reads the account
     * back out of the database before it broadcasts, so this lands AFTER the purchase
     * reply rather than with it. Reading it immediately passed on its own and lost the
     * race under a full, loaded suite run.
     */
    // And waited for the one carrying the NEW balance, since an earlier broadcast from
    // before the purchase would otherwise satisfy "any bankUpdate" immediately.
    const update = await untilValue(
      () => [...emitted].reverse().find((e) => e.event === 'bankUpdate'),
      (u) => Boolean(u) && u.data.balance === 5000 - PISTOL_PRICE,
      { label: 'a bankUpdate carrying the new balance' },
    );
    expect(update.data).toMatchObject({ username: 'GHOST', balance: 5000 - PISTOL_PRICE });
  });

  it('charges the book price, not one the client asked for', async () => {
    await fund('GHOST', 5000);
    const { handlers, emitted } = await identified();
    // A crafted message naming its own price. The field is not read at all.
    buy(handlers, { price: 1, cost: 1, amount: 1 });

    await waitReceipt(emitted);
    expect((await bank()).balance).toBe(5000 - PISTOL_PRICE);
  });
});

describe('who pays', () => {
  it('charges the socket\'s own user, never a username in the message', async () => {
    // The older money handlers take data.username and will drain whoever is named. This
    // one must not: identity comes from the verified socket.
    await fund('GHOST', 5000);
    await fund('VICTIM', 9000);
    const { handlers, emitted } = await identified('GHOST');
    buy(handlers, { username: 'VICTIM' });

    await waitReceipt(emitted);
    expect((await bank('GHOST')).balance).toBe(5000 - PISTOL_PRICE);
    expect((await bank('VICTIM')).balance).toBe(9000);
  });

  it('does nothing at all for a socket that never identified', async () => {
    await fund('GHOST', 5000);
    const { handlers, emitted } = boot(db);
    buy(handlers, { username: 'GHOST' });
    await drain(db);

    expect(receipt(emitted)).toBeUndefined();
    expect((await bank('GHOST')).balance).toBe(5000);
  });
});

describe('what the shop actually stocks', () => {
  it('refuses a catalogue this storefront does not carry', async () => {
    await fund('GHOST', 999999);
    const { handlers, emitted } = await identified();
    // A gun shop sells weapons and weapon mods. Not vehicles.
    buy(handlers, { catalogue: 'vehicles', itemId: 'tank' });

    expect((await waitReceipt(emitted)).data).toMatchObject({ ok: false, reason: 'not_sold' });
    expect((await bank()).balance).toBe(999999);
  });

  it('refuses a catalogue the book names but no shelf can show', async () => {
    // A ripperdoc `sells` cyber_mods on paper; nothing can price them, because the book
    // charges a percentage of the system they go on.
    const r = await run(db,
      `INSERT INTO locations (name, x, y, z, shape, building_type) VALUES ('Doc', 0, 0, 0, 'box', 'ripperdoc')`);
    await fund('GHOST', 999999);
    const { handlers, emitted } = await identified();
    handlers['buyFromShop']({ locationId: r.lastID, catalogue: 'cyber_mods', itemId: 'firewalled' });

    expect((await waitReceipt(emitted)).data).toMatchObject({ ok: false, reason: 'not_sold' });
  });

  it('refuses a building that is not a shop', async () => {
    const r = await run(db,
      `INSERT INTO locations (name, x, y, z, shape, building_type) VALUES ('Bar', 0, 0, 0, 'box', 'bar')`);
    await fund('GHOST', 999999);
    const { handlers, emitted } = await identified();
    handlers['buyFromShop']({ locationId: r.lastID, catalogue: 'weapons', itemId: PISTOL });

    expect((await waitReceipt(emitted)).data).toMatchObject({ ok: false, reason: 'not_sold' });
  });

  it('refuses a building that is not there', async () => {
    await fund('GHOST', 999999);
    const { handlers, emitted } = await identified();
    buy(handlers, { locationId: 99999 });

    expect((await waitReceipt(emitted)).data).toMatchObject({ ok: false, reason: 'no_shop' });
  });

  it('refuses an item no shelf carries rather than selling it for nothing', async () => {
    await fund('GHOST', 5000);
    const { handlers, emitted } = await identified();
    buy(handlers, { itemId: 'railgun-of-doom' });

    expect((await waitReceipt(emitted)).data).toMatchObject({ ok: false, reason: 'price' });
    expect((await bank()).balance).toBe(5000);
  });
});

describe('when the money is not there', () => {
  it('refuses while the house rule is off', async () => {
    await fund('GHOST', 10);
    const { handlers, emitted } = await identified();
    buy(handlers);

    const out = await waitReceipt(emitted);
    expect(out.data).toMatchObject({ ok: false, reason: 'funds', price: PISTOL_PRICE, balance: 10 });
    expect((await bank()).balance).toBe(10);
  });

  it('will not pick for the player when the rule is on', async () => {
    await run(db, `INSERT INTO global_settings (key, value) VALUES (?, '1')`, [OVERDRAFT_RULE]);
    await fund('GHOST', 10);
    const { handlers, emitted } = await identified();
    buy(handlers);

    expect((await waitReceipt(emitted)).data).toMatchObject({ ok: false, reason: 'needs_choice' });
    expect((await bank()).balance).toBe(10);
  });

  it('takes the account under when that is the choice', async () => {
    await run(db, `INSERT INTO global_settings (key, value) VALUES (?, '1')`, [OVERDRAFT_RULE]);
    await fund('GHOST', 10);
    const { handlers, emitted } = await identified();
    buy(handlers, { settle: 'balance' });

    expect((await waitReceipt(emitted)).data).toMatchObject({ ok: true, settled: 'balance' });
    const after = await bank();
    expect(after.balance).toBe(10 - PISTOL_PRICE);
    expect(after.debt).toBe(0);
  });

  it('borrows only the shortfall when that is the choice', async () => {
    await run(db, `INSERT INTO global_settings (key, value) VALUES (?, '1')`, [OVERDRAFT_RULE]);
    await fund('GHOST', 10);
    const { handlers, emitted } = await identified();
    buy(handlers, { settle: 'debt' });

    expect((await waitReceipt(emitted)).data).toMatchObject({ ok: true, settled: 'debt' });
    const after = await bank();
    expect(after.balance).toBe(0);
    expect(after.debt).toBe(PISTOL_PRICE - 10);
  });

  it('ignores a settle choice the rule has not been turned on for', async () => {
    // Rule off: asking to go negative is not a way around it.
    await fund('GHOST', 10);
    const { handlers, emitted } = await identified();
    buy(handlers, { settle: 'balance' });

    expect((await waitReceipt(emitted)).data).toMatchObject({ ok: false, reason: 'funds' });
    expect((await bank()).balance).toBe(10);
  });
});

describe('a player with no account yet', () => {
  it('cannot buy on credit just by never having banked', async () => {
    // No player_banks row at all reads as nothing saved, not as unlimited.
    const { handlers, emitted } = await identified();
    buy(handlers);
    expect((await waitReceipt(emitted)).data).toMatchObject({ ok: false, reason: 'funds' });
  });

  it('opens an account when the rule lets the purchase through', async () => {
    await run(db, `INSERT INTO global_settings (key, value) VALUES (?, '1')`, [OVERDRAFT_RULE]);
    const { handlers, emitted } = await identified();
    buy(handlers, { settle: 'balance' });

    await waitReceipt(emitted);
    expect((await bank()).balance).toBe(-PISTOL_PRICE);
  });
});
