/**
 * What a checkout buys, placed by the server (8n6a; found by the two-games journey, 2026-11-23). Placed by the buyer's window
 * after paying, a purchase could land in another game's sheet when the game changed in that moment, or nowhere when the
 * window closed. Asked to (`place: true`), the checkout places it on the sheet in the same write as the sale, before the
 * bank, in the game that took the money; and refuses before anything is charged when it won't fit. Not asked, as before.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeTestDb, get, run } from './helpers/testDb.js';
import { untilValue, drain } from './helpers/until.js';
import { createRequire } from 'module';

process.env.JWT_SECRET = 'test-secret';
process.env.DICE_ANIM_MS = '0';

const socketsFactory = (await import('../sockets/index.js')).default;
const require_ = createRequire(import.meta.url);
const prices = require_('../shops/catalogueStore');
const runtime = require_('../systemBuilder/runtime');
const { placePurchases } = require_('../shops/give');

const CWN = 'cities_without_number';
const PISTOL = prices.priceOf('weapons', 'heavy_pistol');

let nextSocket = 0;
const boot = (db) => {
  const emitted = [];
  let connectionCb;
  socketsFactory({ on: (e, cb) => { if (e === 'connection') connectionCb = cb; }, emit: (event, data) => emitted.push({ event, data }), to: () => ({ emit: () => {} }) },
    db, { elevatedUsers: new Set(), emitUpdate: vi.fn(), recordAction: vi.fn() });
  const handlers = {};
  connectionCb({ id: `places-${(nextSocket += 1)}`, on: (e, fn) => { handlers[e] = fn; }, emit: (event, data) => emitted.push({ event, data }), broadcast: { emit: () => {} }, use: () => {}, join: () => {} });
  return { handlers, emitted };
};

let db;
const running = (system) => run(db, "INSERT INTO global_settings (key, value) VALUES ('game_system', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [system]);
const shop = async (type) => (await run(db, "INSERT INTO locations (name, x, y, z, shape, building_type) VALUES ('Shop', 0, 0, 0, 'box', ?)", [type])).lastID;
const seed = (system, data) => run(db, 'INSERT INTO character_sheets (username, system, data, is_npc) VALUES (?, ?, ?, 0)', ['GHOST', system, JSON.stringify(data)]);
const fund = (system, balance) => run(db, 'INSERT OR REPLACE INTO bank_accounts (username, system, balance, debt) VALUES (?, ?, ?, 0)', ['GHOST', system, balance]);
const sheetIn = async (system) => JSON.parse((await get(db, 'SELECT data FROM character_sheets WHERE username = ? AND system = ?', ['GHOST', system])).data);
const balanceIn = async (system) => (await get(db, 'SELECT balance FROM bank_accounts WHERE username = ? AND system = ?', ['GHOST', system])).balance;
const checkout = async (locationId, over) => {
  const ghost = boot(db);
  ghost.handlers.identify('GHOST');
  await drain(db);
  ghost.handlers.checkoutShop({ locationId, ...over });
  const answer = await untilValue(() => [...ghost.emitted].reverse().find((e) => e.event === 'shopCheckout'), Boolean, { label: 'shopCheckout' });
  return { answer: answer.data, emitted: ghost.emitted };
};

beforeEach(async () => {
  prices.clear();
  db = await makeTestDb();
  await run(db, `CREATE TABLE IF NOT EXISTS shop_catalogues (system TEXT NOT NULL, catalogue TEXT NOT NULL, id TEXT NOT NULL,
    name TEXT NOT NULL, price REAL NOT NULL DEFAULT 0, fields TEXT NOT NULL DEFAULT '{}', PRIMARY KEY (system, catalogue, id))`);
});

describe('CWN\'s book, asked to place', () => {
  beforeEach(async () => { await running(CWN); });

  it('a pistol on the first free weapon row, Stowed, in the same checkout; paid; every screen told', async () => {
    const gun = await shop('gun_shop');
    await seed(CWN, { weapon1_name: 'Knife' });
    await fund(CWN, 1000);
    const { answer, emitted } = await checkout(gun, { buys: [{ catalogue: 'weapons', itemId: 'heavy_pistol', qty: 1 }], place: true });
    expect(answer).toMatchObject({ ok: true, placed: true, net: PISTOL });
    expect(await sheetIn(CWN)).toMatchObject({ weapon1_name: 'Knife', weapon2_name: 'Heavy Pistol', weapon2_carry: 'stowed' });
    expect(await balanceIn(CWN)).toBe(1000 - PISTOL);
    expect(emitted).toContainEqual({ event: 'sheetUpdated', data: { username: 'GHOST', system: CWN } });
  });

  it('no room on the rack: refused, the reason said, nothing charged, nothing written', async () => {
    const gun = await shop('gun_shop');
    const full = Object.fromEntries(Array.from({ length: 6 }, (_, n) => [`weapon${n + 1}_name`, `Gun ${n + 1}`]));
    await seed(CWN, full);
    await fund(CWN, 1000);
    const { answer } = await checkout(gun, { buys: [{ catalogue: 'weapons', itemId: 'heavy_pistol', qty: 1 }], place: true });
    expect(answer).toEqual({ ok: false, reason: 'no_room', message: 'No free weapon row — all 6 are full. Clear one on the sheet first.', itemId: 'heavy_pistol' });
    expect(await balanceIn(CWN)).toBe(1000);
    expect(await sheetIn(CWN)).toEqual(full);
  });

  it('a sale and a buy in one write: the sold row cleared, the bought one on the row it freed', async () => {
    const gun = await shop('gun_shop');
    await seed(CWN, { weapon1_name: 'Heavy Pistol' });
    await fund(CWN, 1000);
    const { answer } = await checkout(gun, { buys: [{ catalogue: 'weapons', itemId: 'light_pistol', qty: 1 }], sells: [{ catalogue: 'weapons', id: 'heavy_pistol', qty: 1 }], place: true });
    expect(answer).toMatchObject({ ok: true, placed: true });
    expect((await sheetIn(CWN)).weapon1_name).toBe('Light Pistol');
  });

  it('no sheet to place on: refused; not asked, as before, placed by nobody here', async () => {
    const gun = await shop('gun_shop');
    await fund(CWN, 1000);
    expect((await checkout(gun, { buys: [{ catalogue: 'weapons', itemId: 'heavy_pistol', qty: 1 }], place: true })).answer).toEqual({ ok: false, reason: 'no_sheet' });
    expect(await balanceIn(CWN)).toBe(1000);
    await seed(CWN, {});
    const { answer } = await checkout(gun, { buys: [{ catalogue: 'weapons', itemId: 'heavy_pistol', qty: 1 }] });
    expect(answer).toMatchObject({ ok: true, placed: false });
    expect(await sheetIn(CWN)).toEqual({});
  });
});

describe('a custom game\'s own items, asked to place', () => {
  const NORTH = 'sys_0a0a0a0a0a0a0a0a';
  const SOUTH = 'sys_0b0b0b0b0b0b0b0b';
  const game = (name, currencies) => ({
    format: 1, name, core: { health: { model: 'pool' } }, stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }] }],
    ...(currencies ? { currencies } : {}),
    items: { types: [{ id: 'potions', label: 'POTIONS', one: 'Potion', sold_at: ['general_store'], columns: [{ id: 'heals', label: 'HEALS', kind: 'dice' }] }],
      list: [{ id: 'draught', label: 'Healing Draught', type: 'potions', values: { heals: '2d4' }, price: 40, in_shops: true }] },
  });
  const install = async (id, def) => {
    const text = JSON.stringify(def);
    await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', [id, def.name, text, text]);
  };

  it('a line of its type, onto the sheet of the game that took the money, the other game\'s sheet untouched', async () => {
    await install(NORTH, game('North'));
    await install(SOUTH, game('South'));
    await new Promise((resolve) => runtime.load(db, resolve));
    await running(NORTH);
    const store_ = await shop('general_store');
    await seed(NORTH, { inventory: '[]' });
    await seed(SOUTH, { inventory: '[]' });
    await fund(NORTH, 100);
    const { answer } = await checkout(store_, { buys: [{ catalogue: 'type:potions', itemId: 'item:draught', qty: 2 }], place: true });
    expect(answer).toMatchObject({ ok: true, placed: true });
    expect(JSON.parse((await sheetIn(NORTH)).inventory)).toEqual([{ name: 'Healing Draught', qty: 2, enc: '', bundled: false, carry: 'stowed', location: '', type: 'potions', values: { heals: '2d4' } }]);
    expect((await sheetIn(SOUTH)).inventory).toBe('[]');
    expect(await balanceIn(NORTH)).toBe(20);
  });

  it('in a game with currencies of its own, the same', async () => {
    await install(NORTH, game('Coins', [{ id: 'gold', name: 'Gold' }]));
    await new Promise((resolve) => runtime.load(db, resolve));
    await running(NORTH);
    const store_ = await shop('general_store');
    await seed(NORTH, { inventory: '[]' });
    await new Promise((resolve, reject) => require_('../bank/currencies').put(db, 'GHOST', NORTH, 'gold', 100, 0, (e) => (e ? reject(e) : resolve())));
    const { answer, emitted } = await checkout(store_, { buys: [{ catalogue: 'type:potions', itemId: 'item:draught', qty: 1 }], place: true });
    expect(answer).toMatchObject({ ok: true, placed: true });
    expect(JSON.parse((await sheetIn(NORTH)).inventory).map((l) => [l.name, l.qty])).toEqual([['Healing Draught', 1]]);
    expect(emitted).toContainEqual({ event: 'sheetUpdated', data: { username: 'GHOST', system: NORTH } });
  });
});

describe('placing what was bought', () => {
  it('line by line against the sheet as the last left it; one gone from the shelf, said', async () => {
    await running(CWN);
    prices.clear();
    const twoGuns = placePurchases(CWN, [{ catalogue: 'weapons', itemId: 'heavy_pistol', qty: 2 }], {});
    expect(twoGuns.ok).toBe(true);
    expect([twoGuns.patch.weapon1_name, twoGuns.patch.weapon2_name]).toEqual(['Heavy Pistol', 'Heavy Pistol']);
    // Two lines: the second placed on the sheet as the first left it.
    const pair = placePurchases(CWN, [{ catalogue: 'weapons', itemId: 'heavy_pistol', qty: 1 }, { catalogue: 'weapons', itemId: 'light_pistol', qty: 1 }], {});
    expect([pair.patch.weapon1_name, pair.patch.weapon2_name]).toEqual(['Heavy Pistol', 'Light Pistol']);
    expect(placePurchases(CWN, [{ catalogue: 'weapons', itemId: 'nothing_here', qty: 1 }], {})).toEqual({ ok: false, reason: 'Not on the shelf any more.', itemId: 'nothing_here' });
    expect(placePurchases(CWN, null, {})).toEqual({ ok: true, patch: {} });
  });
});
