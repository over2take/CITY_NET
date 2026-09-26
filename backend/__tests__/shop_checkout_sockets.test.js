/**
 * Checking out a shop cart over the socket.
 *
 * The cart settles buying and selling as one: the account moves once, by the difference,
 * and nothing moves unless every line is good. So the cases worth holding are the totals
 * in each direction, and every way a line can fail taking the WHOLE checkout down with it
 * - no money moved, nothing taken off the sheet.
 *
 * Prices come from the server's own table, as in shop_buy_sockets.test.js; the sale half
 * is planSale's, as in shop_sell_sockets.test.js.
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
const prices = require_('../shops/catalogueStore');

let nextSocket = 0;
function boot(db, id = `checkout-sock-${(nextSocket += 1)}`) {
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

const seed = async (data, username = 'GHOST') => run(db,
  `INSERT INTO character_sheets (username, system, data, is_npc)
   VALUES (?, 'cities_without_number', ?, 0)`,
  [username, JSON.stringify(data)]);

const fund = (username, balance, debt = 0) => run(db,
  'INSERT OR REPLACE INTO player_banks (username, balance, debt) VALUES (?, ?, ?)',
  [username, balance, debt]);

const identified = async (name = 'GHOST') => {
  const booted = boot(db);
  booted.handlers['identify'](name);
  await drain(db);
  return booted;
};

const sheet = async (username = 'GHOST') => JSON.parse((await get(db,
  `SELECT data FROM character_sheets WHERE username = ?`, [username])).data);

const bank = async (username = 'GHOST') =>
  get(db, 'SELECT balance, debt FROM player_banks WHERE username = ?', [username]);

const result = (emitted) => [...emitted].reverse().find((e) => e.event === 'shopCheckout');
const waitResult = (emitted) =>
  untilValue(() => result(emitted), Boolean, { label: 'a shopCheckout reply' });

const PISTOL = prices.priceOf('weapons', 'heavy_pistol'); // 200
const LIGHT = prices.priceOf('weapons', 'light_pistol');
const SELL_PISTOL = Math.floor((PISTOL * 45) / 100); // 90 at the default rate

const checkout = (handlers, over) => handlers['checkoutShop']({ locationId: gunShop, ...over });

describe('the totals', () => {
  it('buying only: the account pays the lot, once', async () => {
    await fund('GHOST', 5000);
    const { handlers, emitted } = await identified();
    checkout(handlers, {
      buys: [{ catalogue: 'weapons', itemId: 'heavy_pistol', qty: 2 }, { catalogue: 'weapons', itemId: 'light_pistol', qty: 1 }],
    });
    const out = (await waitResult(emitted)).data;
    const total = PISTOL * 2 + LIGHT;
    expect(out).toMatchObject({ ok: true, buyTotal: total, payout: 0, net: total });
    expect(out.buys).toEqual([
      { catalogue: 'weapons', itemId: 'heavy_pistol', qty: 2, price: PISTOL },
      { catalogue: 'weapons', itemId: 'light_pistol', qty: 1, price: LIGHT },
    ]);
    expect((await bank()).balance).toBe(5000 - total);
  });

  it('selling only: the shop pays, and the thing leaves the sheet', async () => {
    await seed({ weapon1_name: 'Heavy Pistol' });
    await fund('GHOST', 100);
    const { handlers, emitted } = await identified();
    checkout(handlers, { sells: [{ catalogue: 'weapons', id: 'heavy_pistol', qty: 1 }] });
    const out = (await waitResult(emitted)).data;
    expect(out).toMatchObject({ ok: true, buyTotal: 0, payout: SELL_PISTOL, net: -SELL_PISTOL });
    expect((await bank()).balance).toBe(100 + SELL_PISTOL);
    expect((await sheet()).weapon1_name).toBe('');
    expect(emitted.some((e) => e.event === 'sheetUpdated')).toBe(true);
  });

  it('both, costing more than the sale: only the difference is paid', async () => {
    await seed({ weapon1_name: 'Heavy Pistol' });
    await fund('GHOST', 1000);
    const { handlers, emitted } = await identified();
    checkout(handlers, {
      buys: [{ catalogue: 'weapons', itemId: 'heavy_pistol', qty: 2 }],
      sells: [{ catalogue: 'weapons', id: 'heavy_pistol', qty: 1 }],
    });
    const out = (await waitResult(emitted)).data;
    expect(out.net).toBe(PISTOL * 2 - SELL_PISTOL);
    expect((await bank()).balance).toBe(1000 - (PISTOL * 2 - SELL_PISTOL));
  });

  it('both, the sale worth more: the difference is paid out', async () => {
    await seed({ weapon1_name: 'Heavy Pistol', weapon2_name: 'Heavy Pistol' });
    await fund('GHOST', 0);
    const { handlers, emitted } = await identified();
    checkout(handlers, {
      buys: [{ catalogue: 'weapons', itemId: 'knife', qty: 1 }],
      sells: [{ catalogue: 'weapons', id: 'heavy_pistol', qty: 2 }],
    });
    const out = (await waitResult(emitted)).data;
    const knife = prices.priceOf('weapons', 'knife');
    expect(out.net).toBe(knife - SELL_PISTOL * 2);
    expect(out.net).toBeLessThan(0);
    expect((await bank()).balance).toBe(SELL_PISTOL * 2 - knife);
  });

  it('a sale never pays debt off behind the player\'s back', async () => {
    await seed({ weapon1_name: 'Heavy Pistol' });
    await fund('GHOST', 0, 500);
    const { handlers, emitted } = await identified();
    checkout(handlers, { sells: [{ catalogue: 'weapons', id: 'heavy_pistol', qty: 1 }] });
    await waitResult(emitted);
    expect(await bank()).toEqual({ balance: SELL_PISTOL, debt: 500 });
  });
});

describe('all or nothing', () => {
  it('one line this shop does not sell refuses the lot', async () => {
    await seed({ weapon1_name: 'Heavy Pistol' });
    await fund('GHOST', 5000);
    const { handlers, emitted } = await identified();
    checkout(handlers, {
      buys: [{ catalogue: 'weapons', itemId: 'heavy_pistol', qty: 1 }, { catalogue: 'cyberware', itemId: 'cranial-jack', qty: 1 }],
      sells: [{ catalogue: 'weapons', id: 'heavy_pistol', qty: 1 }],
    });
    expect((await waitResult(emitted)).data).toMatchObject({ ok: false, reason: 'not_sold', itemId: 'cranial-jack' });
    expect((await bank()).balance).toBe(5000);
    expect((await sheet()).weapon1_name).toBe('Heavy Pistol');
  });

  it('an invented item is not free', async () => {
    await fund('GHOST', 5000);
    const { handlers, emitted } = await identified();
    checkout(handlers, { buys: [{ catalogue: 'weapons', itemId: 'railgun_of_doom', qty: 1 }] });
    expect((await waitResult(emitted)).data).toMatchObject({ ok: false, reason: 'price' });
    expect((await bank()).balance).toBe(5000);
  });

  it('a quantity that is not a small whole number is refused', async () => {
    await fund('GHOST', 5000);
    const { handlers, emitted } = await identified();
    for (const qty of [0, -1, 1.5, 100, 'lots']) {
      checkout(handlers, { buys: [{ catalogue: 'weapons', itemId: 'heavy_pistol', qty }] });
      expect((await waitResult(emitted)).data).toMatchObject({ ok: false, reason: 'qty' });
    }
    expect((await bank()).balance).toBe(5000);
  });

  it('selling something no longer owned refuses the purchases with it', async () => {
    await seed({});
    await fund('GHOST', 5000);
    const { handlers, emitted } = await identified();
    checkout(handlers, {
      buys: [{ catalogue: 'weapons', itemId: 'heavy_pistol', qty: 1 }],
      sells: [{ catalogue: 'weapons', id: 'heavy_pistol', qty: 1 }],
    });
    expect((await waitResult(emitted)).data).toMatchObject({ ok: false, reason: 'not_owned' });
    expect((await bank()).balance).toBe(5000);
  });

  it('an empty cart does nothing', async () => {
    await fund('GHOST', 5000);
    const { handlers, emitted } = await identified();
    checkout(handlers, { buys: [], sells: [] });
    expect((await waitResult(emitted)).data).toMatchObject({ ok: false, reason: 'empty' });
  });
});

describe('the total the player was shown', () => {
  it('goes through when it matches', async () => {
    await fund('GHOST', 5000);
    const { handlers, emitted } = await identified();
    checkout(handlers, { buys: [{ catalogue: 'weapons', itemId: 'heavy_pistol', qty: 1 }], expectedNet: PISTOL });
    expect((await waitResult(emitted)).data.ok).toBe(true);
  });

  it('charges nothing when it does not, and says what it is now', async () => {
    await fund('GHOST', 5000);
    const { handlers, emitted } = await identified();
    checkout(handlers, { buys: [{ catalogue: 'weapons', itemId: 'heavy_pistol', qty: 1 }], expectedNet: PISTOL - 50 });
    expect((await waitResult(emitted)).data).toMatchObject({ ok: false, reason: 'total_changed', net: PISTOL });
    expect((await bank()).balance).toBe(5000);
  });
});

describe('not enough credits', () => {
  it('is refused when the house does not allow going under', async () => {
    await fund('GHOST', 50);
    const { handlers, emitted } = await identified();
    checkout(handlers, { buys: [{ catalogue: 'weapons', itemId: 'heavy_pistol', qty: 1 }] });
    expect((await waitResult(emitted)).data).toMatchObject({ ok: false, reason: 'funds' });
    expect((await bank()).balance).toBe(50);
  });

  it('counts the sale towards it: selling first can make a purchase affordable', async () => {
    await seed({ weapon1_name: 'Heavy Pistol' });
    await fund('GHOST', PISTOL - SELL_PISTOL);
    const { handlers, emitted } = await identified();
    checkout(handlers, {
      buys: [{ catalogue: 'weapons', itemId: 'heavy_pistol', qty: 1 }],
      sells: [{ catalogue: 'weapons', id: 'heavy_pistol', qty: 1 }],
    });
    expect((await waitResult(emitted)).data.ok).toBe(true);
    expect((await bank()).balance).toBe(0);
  });

  it('with overdraft on, asks once for the whole cart and then takes debt', async () => {
    await run(db, 'INSERT INTO global_settings (key, value) VALUES (?, ?)', [OVERDRAFT_RULE, '1']);
    await fund('GHOST', 100);
    const { handlers, emitted } = await identified();
    checkout(handlers, { buys: [{ catalogue: 'weapons', itemId: 'heavy_pistol', qty: 2 }] });
    expect((await waitResult(emitted)).data).toMatchObject({ ok: false, reason: 'needs_choice' });
    expect((await bank()).balance).toBe(100);

    emitted.length = 0;
    checkout(handlers, { buys: [{ catalogue: 'weapons', itemId: 'heavy_pistol', qty: 2 }], settle: 'debt' });
    expect((await waitResult(emitted)).data).toMatchObject({ ok: true, settled: 'debt' });
    expect(await bank()).toEqual({ balance: 0, debt: PISTOL * 2 - 100 });
  });
});

describe('who pays', () => {
  it('is the signed-in player, whatever the message says', async () => {
    await fund('GHOST', 5000);
    await fund('VIPER', 5000);
    const { handlers, emitted } = await identified('GHOST');
    checkout(handlers, { buys: [{ catalogue: 'weapons', itemId: 'heavy_pistol', qty: 1 }], username: 'VIPER' });
    await waitResult(emitted);
    expect((await bank('GHOST')).balance).toBe(5000 - PISTOL);
    expect((await bank('VIPER')).balance).toBe(5000);
  });

  it('is nobody before signing in', async () => {
    await fund('GHOST', 5000);
    const { handlers, emitted } = boot(db);
    checkout(handlers, { buys: [{ catalogue: 'weapons', itemId: 'heavy_pistol', qty: 1 }] });
    await drain(db);
    expect(result(emitted)).toBeUndefined();
    expect((await bank()).balance).toBe(5000);
  });
});
