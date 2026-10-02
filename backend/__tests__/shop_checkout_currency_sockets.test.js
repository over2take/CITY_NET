/**
 * Checking out a shop cart in a custom system's currencies, through the socket (3c2a4c). The
 * gun shop's weapons are priced in Gold, the system's main currency, and its weapon mods in
 * Favor (decided with the user, 2026-10-02: each catalogue picks its currency). Each currency
 * the cart touches is settled on its own account, all of them or none; a shortfall is covered
 * only as that currency allows. The built-in checkout, which shop_checkout_sockets.test.js
 * holds, is not this path.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'module';
import { makeTestDb, get, run } from './helpers/testDb.js';
import { drain, untilValue } from './helpers/until.js';

process.env.JWT_SECRET = 'test-secret';

const require_ = createRequire(import.meta.url);
const runtime = require_('../systemBuilder/runtime');
const prices = require_('../shops/catalogueStore');
const money = require_('../bank/currencies');
const socketsFactory = (await import('../sockets/index.js')).default;

const HEARTH = 'sys_aaaaaaaaaaaaaaaa';
const DEFINITION = {
  format: 1, name: 'Hearth',
  currencies: [{ id: 'gold', name: 'Gold' }, { id: 'favor', name: 'Favor', debt: true }],
  buildings: { catalogues: { weapon_mods: { currency: 'favor' } } },
};

const call = (fn, ...args) => new Promise((resolve, reject) => fn(...args, (err, value) => (err ? reject(err) : resolve(value))));

let db;
let shop;
let nextSocket = 0;
beforeEach(async () => {
  db = await makeTestDb();
  const text = JSON.stringify(DEFINITION);
  await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', [HEARTH, 'Hearth', text, text]);
  await new Promise((resolve) => runtime.load(db, resolve));
  await run(db, `INSERT INTO global_settings (key, value) VALUES ('game_system', ?)`, [HEARTH]);
  shop = (await run(db, `INSERT INTO locations (name, x, y, z, shape, building_type) VALUES ('Forge', 0, 0, 0, 'box', 'gun_shop')`)).lastID;
  await call(money.put, db, 'GHOST', HEARTH, 'gold', 2000, 0);
  await call(money.put, db, 'GHOST', HEARTH, 'favor', 5, 0);
});

const checkout = async (payload) => {
  const sent = [];
  let connect;
  socketsFactory({ on: (e, cb) => { if (e === 'connection') connect = cb; }, emit: () => {}, to: () => ({ emit: () => {} }) },
    db, { elevatedUsers: new Set(), emitUpdate: vi.fn(), recordAction: vi.fn() });
  const handlers = {};
  connect({ id: `cc-sock-${(nextSocket += 1)}`, on: (e, fn) => { handlers[e] = fn; }, emit: (event, data) => sent.push({ event, data }),
    broadcast: { emit: () => {} }, use: () => {}, join: () => {} });
  handlers.identify('GHOST');
  await drain(db);
  // After the boot, which loads the running system's catalogues from a table this database
  // lacks: held as the running system's, the store is not reloaded by the checkout.
  prices.load(HEARTH, {
    weapons: [{ id: 'sword', name: 'Sword', price: 1500, fields: {} }],
    weapon_mods: [{ id: 'rune', name: 'Rune', price: 3, fields: {} }],
  });
  handlers.checkoutShop({ locationId: shop, buys: [], ...payload });
  const reply = await untilValue(() => sent.find((e) => e.event === 'shopCheckout'), Boolean, { label: 'the checkout' });
  await drain(db);
  return reply.data;
};
const held = async () => ({ gold: await call(money.get, db, 'GHOST', HEARTH, 'gold'), favor: await call(money.get, db, 'GHOST', HEARTH, 'favor') });

describe('a cart in two currencies', () => {
  it('pays each from its own account', async () => {
    const reply = await checkout({ buys: [{ catalogue: 'weapons', itemId: 'sword', qty: 1 }, { catalogue: 'weapon_mods', itemId: 'rune', qty: 1 }] });
    expect(reply).toMatchObject({
      ok: true,
      currencies: { gold: { net: 1500, balance: 500 }, favor: { net: 3, balance: 2 } },
    });
    expect(reply.buys.map((l) => `${l.itemId}:${l.currency}`)).toEqual(['sword:gold', 'rune:favor']);
    expect(await held()).toEqual({ gold: { balance: 500, debt: 0 }, favor: { balance: 2, debt: 0 } });
  });

  it('pays for neither when one currency falls short', async () => {
    const reply = await checkout({ buys: [{ catalogue: 'weapon_mods', itemId: 'rune', qty: 1 }, { catalogue: 'weapons', itemId: 'sword', qty: 2 }] });
    expect(reply).toMatchObject({ ok: false, reason: 'funds', currency: 'gold' });
    expect(await held()).toEqual({ gold: { balance: 2000, debt: 0 }, favor: { balance: 5, debt: 0 } });
  });

  it('refuses a total the player was not shown, in any currency', async () => {
    const reply = await checkout({ buys: [{ catalogue: 'weapon_mods', itemId: 'rune', qty: 1 }], expectedNet: { favor: 2 } });
    expect(reply).toMatchObject({ ok: false, reason: 'total_changed', currency: 'favor' });
    expect((await held()).favor).toEqual({ balance: 5, debt: 0 });
  });
});

describe('a shortfall', () => {
  it('is asked about where the currency allows debt, and covered by it once chosen', async () => {
    const buys = [{ catalogue: 'weapon_mods', itemId: 'rune', qty: 3 }];
    expect(await checkout({ buys })).toMatchObject({ ok: false, reason: 'needs_choice', currency: 'favor', options: ['debt'] });
    expect((await held()).favor).toEqual({ balance: 5, debt: 0 });
    expect(await checkout({ buys, settle: { favor: 'debt' } })).toMatchObject({ ok: true, currencies: { favor: { balance: 0, debt: 4, settled: 'debt' } } });
    expect((await held()).favor).toEqual({ balance: 0, debt: 4 });
  });

  it('is refused in a currency that allows neither, whatever the cart asks', async () => {
    const reply = await checkout({ buys: [{ catalogue: 'weapons', itemId: 'sword', qty: 2 }], settle: { gold: 'debt' } });
    expect(reply).toMatchObject({ ok: false, reason: 'funds', currency: 'gold' });
    expect((await held()).gold).toEqual({ balance: 2000, debt: 0 });
  });
});

describe('selling back', () => {
  it('takes the item off the sheet and pays in its catalogue\'s currency', async () => {
    await run(db, 'INSERT INTO character_sheets (username, system, data, is_npc) VALUES (?, ?, ?, 0)',
      ['GHOST', HEARTH, JSON.stringify({ inventory: JSON.stringify([{ name: 'Sword', qty: 1 }]) })]);
    const reply = await checkout({ sells: [{ catalogue: 'weapons', id: 'sword', qty: 1 }] });
    expect(reply).toMatchObject({ ok: true, currencies: { gold: { payout: 675, net: -675, balance: 2675 } } });
    expect((await held()).gold).toEqual({ balance: 2675, debt: 0 });
    const sheet = JSON.parse((await get(db, 'SELECT data FROM character_sheets WHERE username = ?', ['GHOST'])).data);
    expect(JSON.parse(sheet.inventory)).toEqual([]);
  });
});
