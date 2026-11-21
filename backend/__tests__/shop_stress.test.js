/**
 * The shops under load (8n3; asked by the user 2026-11-21, "a stress test for the store like having 1000+ items"): a game with
 * 200 items of its own (the most a system holds) and a catalogue of 1500 lines across three types and a shelf. The file
 * previewed and saved; every catalogue sent to a player; a cart of 100 lines checked out; 300 lines of gear sold back at once.
 * Each within about twenty times what it took on a desk (CI is several times slower), and each answer still right at that size.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { createRequire } from 'module';
import jwt from 'jsonwebtoken';
import { makeTestDb, get, run } from './helpers/testDb.js';
import { untilValue, drain } from './helpers/until.js';

process.env.JWT_SECRET = 'test-secret';
const require_ = createRequire(import.meta.url);
const store = require_('../shops/catalogueStore');
const runtime = require_('../systemBuilder/runtime');
const { checkDefinition } = require_('../systemBuilder/definition');
const socketsFactory = (await import('../sockets/index.js')).default;

const ID = 'sys_stressstressstre';
const LINES = 1500;
const ITEMS = 200;
const TYPES = [
  { id: 'weapons', label: 'WEAPONS', one: 'Weapon', columns: [{ id: 'damage', label: 'DAMAGE', kind: 'damage' }, { id: 'ammo', label: 'AMMO', kind: 'count' }, { id: 'price', label: 'PRICE', kind: 'number' }] },
  { id: 'armor', label: 'ARMOR', one: 'Armor', columns: [{ id: 'defense', label: 'DEFENSE', kind: 'number' }, { id: 'grade', label: 'GRADE', kind: 'pick', options: ['LIGHT', 'HEAVY'] }] },
  { id: 'potions', label: 'POTIONS', one: 'Potion', columns: [{ id: 'heals', label: 'HEALS', kind: 'dice' }] },
];
/** 200 items, a third of each type, every one priced and IN SHOPS. */
const ITEM_LIST = Array.from({ length: ITEMS }, (_, i) => {
  const t = TYPES[i % 3];
  const values = t.id === 'weapons' ? { damage: '1d6', ammo: 6, price: 100 + i } : t.id === 'armor' ? { defense: 1 + (i % 5), grade: 'LIGHT' } : { heals: '2d4' };
  return { id: `own_${i}`, label: `Own Thing ${i}`, type: t.id, values, ...(t.id === 'weapons' ? {} : { price: 50 + i }), in_shops: true };
});
const SYSTEM = { format: 1, name: 'Stress', core: { health: { model: 'pool' } }, stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }] }], items: { types: TYPES, list: ITEM_LIST } };

/** 1500 lines: 400 of each type and 300 of GEAR (a shelf: this game has no type called GEAR). */
const FILE = [
  '[WEAPONS]', 'name, price, damage, ammo',
  ...Array.from({ length: 400 }, (_, i) => `Gun ${i}, ${10 + i}, 1d${4 + (i % 3) * 2}, ${i % 12}`),
  '[ARMOR]', 'name, price, defense, grade',
  ...Array.from({ length: 400 }, (_, i) => `Vest ${i}, ${20 + i}, ${i % 9}, ${i % 2 ? 'HEAVY' : 'LIGHT'}`),
  '[POTIONS]', 'name, price, heals',
  ...Array.from({ length: 400 }, (_, i) => `Tonic ${i}, ${5 + i}, ${1 + (i % 4)}d4`),
  '[gear]', 'name, price',
  ...Array.from({ length: 300 }, (_, i) => `Thing ${i}, ${1 + i}`),
].join('\n');

/** Milliseconds a step took. */
const timed = async (work) => { const t = performance.now(); const out = await work(); return { out, ms: performance.now() - t }; };

let db;
let goods;
const boot = async (who, admin) => {
  const emitted = [];
  let connect;
  const io = { on: (e, cb) => { if (e === 'connection') connect = cb; }, emit: (event, data) => emitted.push({ event, data }), to: () => ({ emit: () => {} }) };
  socketsFactory(io, db, { elevatedUsers: new Set(), emitUpdate: vi.fn(), recordAction: vi.fn() });
  const handlers = {};
  connect({ id: `s-${who}-${Math.random()}`, on: (e, fn) => { handlers[e] = fn; }, emit: (event, data) => emitted.push({ event, data }), broadcast: { emit: () => {} }, use: () => {}, join: () => {} });
  handlers.identify(admin ? { userName: who, isAdmin: true, token: jwt.sign({ id: 1, username: who, role: 'admin', isTemporary: false }, 'test-secret') } : who);
  await drain(db);
  return { handlers, emitted };
};
const last = (emitted, event) => untilValue(() => [...emitted].reverse().find((e) => e.event === event), Boolean, { label: event, timeout: 30_000 });
const report = {};

beforeAll(async () => {
  store.clear();
  db = await makeTestDb();
  await run(db, `CREATE TABLE IF NOT EXISTS shop_catalogues (system TEXT NOT NULL, catalogue TEXT NOT NULL, id TEXT NOT NULL,
    name TEXT NOT NULL, price REAL NOT NULL DEFAULT 0, fields TEXT NOT NULL DEFAULT '{}', PRIMARY KEY (system, catalogue, id))`);
  const def = JSON.stringify(SYSTEM);
  await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', [ID, 'Stress', def, def]);
  await new Promise((resolve) => runtime.load(db, resolve));
  await run(db, "INSERT INTO global_settings (key, value) VALUES ('game_system', ?)", [ID]);
  goods = (await run(db, "INSERT INTO locations (name, x, y, z, shape, building_type) VALUES ('Goods', 0, 0, 0, 'box', 'general_store')")).lastID;
  await run(db, 'INSERT INTO bank_accounts (username, system, balance, debt) VALUES (?, ?, 100000000, 0)', ['kes', ID]);
  await run(db, 'INSERT INTO character_sheets (username, system, data, is_npc) VALUES (?, ?, ?, 0)', ['kes', ID, JSON.stringify({ inventory: '[]' })]);
}, 60_000);

describe('the shops under load', () => {
  it('the game itself is sound: 200 items, three types, no problems', () => {
    expect(checkDefinition(SYSTEM).problems).toEqual([]);
  });

  it('a 1500-line file previewed, then saved, each in time, every line read', async () => {
    const gm = await boot('gm', true);
    const preview = await timed(async () => { gm.handlers.previewCatalogue({ text: FILE }); return (await last(gm.emitted, 'cataloguePreview')).data; });
    expect(preview.out.problems).toEqual([]);
    expect(preview.out.summary.map((s) => [s.label ?? s.catalogue, s.count])).toEqual([['WEAPONS', 400], ['ARMOR', 400], ['POTIONS', 400], ['gear', 300]]);
    expect(preview.out.items.onSale).toBe(ITEMS);
    const saved = await timed(async () => { gm.handlers.saveCatalogue({ text: FILE }); return (await last(gm.emitted, 'catalogueSaved')).data; });
    expect(saved.out.ok).toBe(true);
    expect((await get(db, 'SELECT COUNT(*) AS n FROM shop_catalogues WHERE system = ?', [ID])).n).toBe(LINES);
    report.preview = Math.round(preview.ms);
    report.save = Math.round(saved.ms);
    expect(preview.ms).toBeLessThan(1_000);
    expect(saved.ms).toBeLessThan(3_000);
  }, 60_000);

  it('every catalogue sent to a player in time: 1500 lines and 200 items, the payload\'s size said', async () => {
    const kes = await boot('kes', false);
    const sent = await timed(async () => { kes.emitted.length = 0; kes.handlers.requestCatalogues(); return (await last(kes.emitted, 'catalogues')).data; });
    const lines = Object.values(sent.out.entries).flat().filter((e) => e.source === 'uploaded' || e.source === 'items');
    expect(lines).toHaveLength(LINES + ITEMS);
    report.send = Math.round(sent.ms);
    report.payloadKb = Math.round(JSON.stringify(sent.out).length / 1024);
    expect(sent.ms).toBeLessThan(1_000);
    // Under a megabyte, as everything sent to a browser here is.
    expect(JSON.stringify(sent.out).length).toBeLessThan(1_000_000);
  }, 60_000);

  it('a cart of 100 lines checked out in time, each at its price', async () => {
    const kes = await boot('kes', false);
    const buys = [
      ...Array.from({ length: 50 }, (_, i) => ({ catalogue: 'type:weapons', itemId: `gun_${i}`, qty: 1 })),
      ...Array.from({ length: 50 }, (_, i) => ({ catalogue: 'type:weapons', itemId: `item:own_${i * 3}`, qty: 1 })),
    ];
    const done = await timed(async () => { kes.handlers.checkoutShop({ locationId: goods, buys }); return (await last(kes.emitted, 'shopCheckout')).data; });
    expect(done.out.ok, JSON.stringify(done.out).slice(0, 300)).toBe(true);
    const expected = Array.from({ length: 50 }, (_, i) => 10 + i).reduce((a, b) => a + b, 0) + Array.from({ length: 50 }, (_, i) => 100 + i * 3).reduce((a, b) => a + b, 0);
    expect(done.out.buyTotal).toBe(expected);
    report.checkout = Math.round(done.ms);
    expect(done.ms).toBeLessThan(1_000);
  }, 60_000);

  it('300 lines of gear sold back at once, in time, each paid at the shop\'s rate', async () => {
    const gear = Array.from({ length: 300 }, (_, i) => ({ name: `Gun ${i}`, qty: 1, enc: '', bundled: false, carry: 'stowed', location: '', type: 'weapons', values: { damage: '1d4', ammo: 0 } }));
    await run(db, 'UPDATE character_sheets SET data = ? WHERE username = ?', [JSON.stringify({ inventory: JSON.stringify(gear) }), 'kes']);
    const kes = await boot('kes', false);
    const sells = gear.map((_, i) => ({ catalogue: 'type:weapons', id: `gun_${i}`, qty: 1 }));
    const done = await timed(async () => { kes.handlers.checkoutShop({ locationId: goods, buys: [], sells }); return (await last(kes.emitted, 'shopCheckout')).data; });
    expect(done.out.ok, JSON.stringify(done.out).slice(0, 300)).toBe(true);
    // The app's 45% of each, rounded down line by line.
    expect(done.out.payout).toBe(gear.reduce((n, _, i) => n + Math.floor(((10 + i) * 45) / 100), 0));
    report.sellBack = Math.round(done.ms);
    expect(done.ms).toBeLessThan(3_000);
    // What it took, for the record.
    console.log('shop stress (ms, KB):', JSON.stringify(report));
  }, 60_000);
});
