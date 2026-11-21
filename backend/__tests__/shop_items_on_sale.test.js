/**
 * The game's own items on the shelves (8a7a3a; decided 2026-11-21, mockup docs/mockups/types-in-shops.html): an item with a
 * price (its own, or its type's PRICE column's) and IN SHOPS sells itself at the shops its type is sold at, beside the
 * uploaded lines; a line uploaded with its name wins; one turned off is never sold, not even from a file; one IN SHOPS needs a
 * price; one saved before IN SHOPS was is in the shops only if priced. Bought, sold back at the shop's rate; GIVE lists items
 * in its own ITEMS folder, so not again under their type.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'module';
import jwt from 'jsonwebtoken';
import { makeTestDb, get, run } from './helpers/testDb.js';
import { untilValue, drain } from './helpers/until.js';

process.env.JWT_SECRET = 'test-secret';
const require_ = createRequire(import.meta.url);
const { itemPrice, inShops } = require_('../systemBuilder/itemTypes');
const { checkDefinition } = require_('../systemBuilder/definition');
const citysys = require_('../systemBuilder/citysys');
const { ownStock, againstItems } = require_('../shops/ownItems');
const { parseCatalogue } = require_('../shops/catalogueParse');
const { typesOf } = require_('../systemBuilder/itemTypes');
const store = require_('../shops/catalogueStore');
const give = require_('../shops/give');
const runtime = require_('../systemBuilder/runtime');
const socketsFactory = (await import('../sockets/index.js')).default;

const WEAPONS = { id: 'weapons', label: 'WEAPONS', one: 'Weapon', columns: [
  { id: 'damage', label: 'DAMAGE', kind: 'damage' },
  { id: 'price', label: 'PRICE', kind: 'number' },
] };
const ARMOR = { id: 'armor', label: 'ARMOR', one: 'Armor', sold_at: ['armorer'], columns: [{ id: 'defense', label: 'DEFENSE', kind: 'number' }] };
const PISTOL = { id: 'pistol', label: 'Pistol', type: 'weapons', values: { damage: '2d6', price: 200 }, description: 'Snub.' };
const JACKET = { id: 'jacket', label: 'Leather Jacket', type: 'armor', values: { defense: 2 }, price: 50, in_shops: true };
const RING = { id: 'ring', label: 'Ring of Might', type: 'armor', price: 5000, in_shops: false };
const ROPE = { id: 'rope', label: 'Rope', type: 'armor' };
const SYSTEM = (list, types = [WEAPONS, ARMOR]) => ({
  format: 1, name: 'Priced', core: { health: { model: 'pool' } },
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }] }],
  items: { types, list },
});
const DEF = SYSTEM([PISTOL, JACKET, RING, ROPE]);

describe('an item\'s price and IN SHOPS', () => {
  it('its own PRICE, else its type\'s own PRICE column, read as it; neither: none', () => {
    expect(itemPrice(DEF, JACKET)).toBe(50);
    expect(itemPrice(DEF, PISTOL)).toBe(200);
    expect(itemPrice(DEF, { ...PISTOL, price: 180 })).toBe(180);
    expect(itemPrice(DEF, ROPE)).toBeUndefined();
    // A `price` value on a type without a PRICE column, or one that isn't a NUMBER, is no price.
    expect(itemPrice(DEF, { ...ROPE, values: { price: 9 } })).toBeUndefined();
    expect(itemPrice(SYSTEM([], [{ ...WEAPONS, columns: [{ id: 'price', label: 'PRICE', kind: 'text' }] }]), { ...PISTOL, values: { price: 9 } })).toBeUndefined();
    // Nor one that isn't a price.
    expect(itemPrice(DEF, { ...PISTOL, values: { damage: '2d6', price: -5 } })).toBeUndefined();
    expect(itemPrice(DEF, null)).toBeUndefined();
  });

  it('IN SHOPS as its switch says; one saved before the switch was, by whether it has a price', () => {
    expect(inShops(DEF, JACKET)).toBe(true);
    expect(inShops(DEF, RING)).toBe(false);
    expect(inShops(DEF, PISTOL)).toBe(true);
    expect(inShops(DEF, ROPE)).toBe(false);
  });

  it('checked: one IN SHOPS needs a price, its own or its column\'s; a price a number; the switch on or off', () => {
    const problems = (item) => checkDefinition(SYSTEM([item])).problems.filter((p) => /^item /.test(p.where));
    expect(problems({ ...ROPE, in_shops: true })).toEqual([{ where: 'item rope, price', message: 'A price, to be sold in the shops; or turn IN SHOPS off' }]);
    expect(problems({ ...PISTOL, in_shops: true })).toEqual([]);
    expect(problems(JACKET)).toEqual([]);
    expect(problems(RING)).toEqual([]);
    // Saved before IN SHOPS was: no price, no problem.
    expect(problems(ROPE)).toEqual([]);
    expect(problems({ ...ROPE, price: -1 })).toEqual([{ where: 'item rope, price', message: 'What it costs: 0 to 1000000000' }]);
    expect(problems({ ...ROPE, price: '5' })).toEqual([{ where: 'item rope, price', message: 'What it costs: 0 to 1000000000' }]);
    expect(problems({ ...ROPE, in_shops: 'yes' })).toEqual([{ where: 'item rope, in_shops', message: 'On or off' }]);
  });

  it('carried by the system file: exported, then read back unchanged, still checked', () => {
    const read = citysys.readFile(JSON.stringify(citysys.buildFile({ definition: DEF, version: 1, origin: 'sys_pricedpricedpric' })));
    expect(read.problems, JSON.stringify(read.problems)).toEqual([]);
    expect(read.file.definition.items.list).toEqual(DEF.items.list);
    const broken = citysys.readFile(JSON.stringify(citysys.buildFile({ definition: SYSTEM([{ ...ROPE, in_shops: true }]), version: 1, origin: 'sys_pricedpricedpric' })));
    expect(broken.problems).toEqual([{ where: 'item rope, price', message: 'A price, to be sold in the shops; or turn IN SHOPS off' }]);
  });
});

describe('the lines they make', () => {
  it('each priced item IN SHOPS a line of its type, its values and words as fields; the names of those turned off', () => {
    const stock = ownStock(DEF);
    expect(stock.catalogues).toEqual({
      'type:weapons': [{ id: 'item:pistol', name: 'Pistol', price: 200, fields: { damage: '2d6', price: 200, description: 'Snub.' } }],
      'type:armor': [{ id: 'item:jacket', name: 'Leather Jacket', price: 50, fields: { defense: 2 } }],
    });
    expect([...stock.off]).toEqual(['ring of might', 'rope']);
    // Turned off with a price: bought back by a shop of its type, never on a shelf (8a7a3c2); the Rope, with none, not.
    expect(stock.buyback).toEqual({ 'type:armor': [{ id: 'item:ring', name: 'Ring of Might', price: 5000 }] });
    // Worked out once for a definition.
    expect(ownStock(DEF)).toBe(stock);
  });

  it('an item naming no type is a line of the first; none for a game without types of its own', () => {
    expect(Object.keys(ownStock(SYSTEM([{ id: 'axe', label: 'Axe', price: 3 }])).catalogues)).toEqual(['type:weapons']);
    expect(ownStock({ ...DEF, items: { list: [JACKET] } }).catalogues).toEqual({});
    expect(ownStock(null).catalogues).toEqual({});
  });

  it('one IN SHOPS whose price isn\'t one, or with none: no line (the builder lists the problem)', () => {
    expect(ownStock(SYSTEM([{ ...JACKET, price: -1 }])).catalogues).toEqual({});
    expect(ownStock(SYSTEM([{ ...ROPE, in_shops: true }])).catalogues).toEqual({});
  });
});

describe('in the store, under the uploads', () => {
  // The sockets' own, put back after, so the table below runs on what they set.
  let was;
  beforeEach(() => { store.clear(); was = store.ownSourceNow(); store.setOwnSource(() => ownStock(DEF)); });
  afterEach(() => { store.clear(); store.setOwnSource(was); });

  it('a type\'s shelf: the game\'s items, then the uploaded lines; a line of an item\'s name stands in for it', () => {
    store.load('sys_x', { 'type:weapons': [{ id: 'hand_cannon', name: 'Hand Cannon', price: 900, fields: {} }] });
    expect(store.entriesIn('type:weapons').map((e) => [e.name, e.price, e.source])).toEqual([['Pistol', 200, 'items'], ['Hand Cannon', 900, 'uploaded']]);
    store.load('sys_x', { 'type:weapons': [{ id: 'pistol', name: 'pistol ', price: 260, fields: {} }] });
    expect(store.entriesIn('type:weapons').map((e) => [e.name, e.price, e.source])).toEqual([['pistol ', 260, 'uploaded']]);
    // The item's own line is off the shelf while the upload stands in for it.
    expect(store.priceOf('type:weapons', 'item:pistol')).toBeNull();
  });

  it('priced, named and filled as the shop sells it; found by name, so it sells back', () => {
    store.load('sys_x', {});
    expect(store.priceOf('type:weapons', 'item:pistol')).toBe(200);
    expect(store.labelOf('type:weapons', 'item:pistol')).toBe('Pistol');
    expect(store.fieldsOf('type:weapons', 'item:pistol')).toEqual({ damage: '2d6', price: 200, description: 'Snub.' });
    expect(store.findByName('PISTOL')).toEqual({ catalogue: 'type:weapons', id: 'item:pistol' });
    // Not on another type's shelf.
    expect(store.priceOf('type:armor', 'item:pistol')).toBeNull();
  });

  it('an item turned off: never sold, not even from a file that names it', () => {
    store.load('sys_x', { 'type:armor': [{ id: 'ring_of_might', name: 'Ring of Might', price: 10, fields: {} }] });
    expect(store.entriesIn('type:armor').map((e) => e.name)).toEqual(['Leather Jacket']);
    expect(store.priceOf('type:armor', 'ring_of_might')).toBeNull();
    expect(store.labelOf('type:armor', 'ring_of_might')).toBeNull();
    expect(store.fieldsOf('type:armor', 'ring_of_might')).toEqual({});
    // Found by name only as the item it is, to sell back at its own price, never to buy (8a7a3c2).
    expect(store.findByName('Ring of Might')).toEqual({ catalogue: 'type:armor', id: 'item:ring' });
    expect(store.priceOf('type:armor', 'item:ring')).toBeNull();
    expect(store.sellPriceOf('type:armor', 'item:ring')).toBe(5000);
    expect(store.labelOf('type:armor', 'item:ring')).toBe('Ring of Might');
    expect(store.sellPriceOf('type:armor', 'ring_of_might')).toBeNull();
    expect(store.sellPriceOf('type:armor', 'item:jacket')).toBe(50);
    // Still uploaded, for the GM's file.
    expect(store.uploadedIn('type:armor').map((e) => e.name)).toEqual(['Ring of Might']);
  });
});

describe('a catalogue file held against them (8a7a3c1)', () => {
  const parse = (text) => parseCatalogue(text, { types: typesOf(DEF), names: { known: () => true, refused: (n) => n } }).sections;
  const FILE = '[WEAPONS]\nname, price, damage, description\nPistol, 200, 2d6, Snub.\nHand Cannon, 900, 3d6\n[ARMOR]\nname, price, defense\nRing of Might, 10, \nLeather Jacket, 75, 2\n';

  it('an exact copy of an item left out; one kept out of the shops left out; one of an item\'s name otherwise overrules it', () => {
    const held = againstItems(parse(FILE), DEF);
    expect(Object.fromEntries(Object.entries(held.sections).map(([c, list]) => [c, list.map((e) => e.name)]))).toEqual({ 'type:weapons': ['Hand Cannon'], 'type:armor': ['Leather Jacket'] });
    expect(held.leftOut).toEqual([
      { line: 3, catalogue: 'type:weapons', name: 'Pistol', message: 'already on ITEMS at 200, the same in every column: left out, as it sells itself' },
      { line: 7, catalogue: 'type:armor', name: 'Ring of Might', message: 'kept out of the shops on ITEMS (IN SHOPS is off), so never sold: left out' },
    ]);
    expect(held.overrules).toEqual([{ line: 8, catalogue: 'type:armor', name: 'Leather Jacket', from: 50, to: 75 }]);
    expect(held.onSale).toBe(2);
    // The exact copy, by its line's id, for a publish to take out (8a7a4b).
    expect(held.copies).toEqual([{ catalogue: 'type:weapons', id: 'pistol' }]);
  });

  it('a column apart, the price the same: it overrules the item\'s columns; a game without types of its own, nothing held', () => {
    const held = againstItems(parse('[WEAPONS]\nname, price, damage, description\nPistol, 200, 2d8, Snub.\n'), DEF);
    expect(held.overrules).toEqual([{ line: 3, catalogue: 'type:weapons', name: 'Pistol', from: 200, to: 200 }]);
    expect(held.leftOut).toEqual([]);
    const sections = { gear: [{ id: 'rope', name: 'Rope', price: 1, fields: {} }] };
    expect(againstItems(sections, { ...DEF, items: { list: DEF.items.list } })).toEqual({ sections, leftOut: [], overrules: [], onSale: 0, copies: [] });
  });
});

describe('at the table', () => {
  const ID = 'sys_pricedpricedpric';
  let db;
  let goods;
  let arms;
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
  const last = (emitted, event) => untilValue(() => [...emitted].reverse().find((e) => e.event === event), Boolean, { label: event });
  const checkout = async (who, locationId, more) => {
    who.handlers.checkoutShop({ locationId, ...more });
    return (await last(who.emitted, 'shopCheckout')).data;
  };
  const balance = async () => (await get(db, 'SELECT balance FROM bank_accounts WHERE username = ?', ['kes'])).balance;

  beforeEach(async () => {
    store.clear();
    db = await makeTestDb();
    await run(db, `CREATE TABLE IF NOT EXISTS shop_catalogues (system TEXT NOT NULL, catalogue TEXT NOT NULL, id TEXT NOT NULL,
      name TEXT NOT NULL, price REAL NOT NULL DEFAULT 0, fields TEXT NOT NULL DEFAULT '{}', PRIMARY KEY (system, catalogue, id))`);
    const def = JSON.stringify(DEF);
    await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', [ID, 'Priced', def, def]);
    await new Promise((resolve) => runtime.load(db, resolve));
    await run(db, "INSERT INTO global_settings (key, value) VALUES ('game_system', ?)", [ID]);
    goods = (await run(db, "INSERT INTO locations (name, x, y, z, shape, building_type, buyback_pct) VALUES ('Goods', 0, 0, 0, 'box', 'general_store', 50)")).lastID;
    arms = (await run(db, "INSERT INTO locations (name, x, y, z, shape, building_type) VALUES ('Arms', 0, 0, 0, 'box', 'armorer')")).lastID;
    await run(db, 'INSERT INTO bank_accounts (username, system, balance, debt) VALUES (?, ?, 1000, 0)', ['kes', ID]);
    await run(db, 'INSERT INTO character_sheets (username, system, data, is_npc) VALUES (?, ?, ?, 0)', ['kes', ID, JSON.stringify({ inventory: '[]' })]);
  });

  it('on the players\' shelves with nothing uploaded, marked as the game\'s own', async () => {
    const kes = await boot('kes', false);
    kes.handlers.requestCatalogues();
    const { entries } = (await last(kes.emitted, 'catalogues')).data;
    expect(entries['type:weapons']).toEqual([{ id: 'item:pistol', name: 'Pistol', price: 200, fields: { damage: '2d6', price: 200, description: 'Snub.' }, source: 'items' }]);
    expect(entries['type:armor'].map((e) => e.name)).toEqual(['Leather Jacket']);
  });

  it('bought where its type is sold, at its price; not where it isn\'t', async () => {
    const kes = await boot('kes', false);
    expect(await checkout(kes, goods, { buys: [{ catalogue: 'type:weapons', itemId: 'item:pistol', qty: 1 }] })).toMatchObject({ ok: true, buys: [{ itemId: 'item:pistol', price: 200 }] });
    expect(await balance()).toBe(800);
    kes.emitted.length = 0;
    expect(await checkout(kes, arms, { buys: [{ catalogue: 'type:weapons', itemId: 'item:pistol', qty: 1 }] })).toMatchObject({ ok: false, reason: 'not_sold' });
    kes.emitted.length = 0;
    expect(await checkout(kes, arms, { buys: [{ catalogue: 'type:armor', itemId: 'item:jacket', qty: 1 }] })).toMatchObject({ ok: true, buys: [{ price: 50 }] });
    expect(await balance()).toBe(750);
  });

  it('sold back at the shop\'s BUYBACK rate', async () => {
    await run(db, 'UPDATE character_sheets SET data = ? WHERE username = ?', [JSON.stringify({ inventory: JSON.stringify([{ name: 'Pistol', qty: 1, enc: '', bundled: false, carry: 'stowed', location: '', type: 'weapons', values: { damage: '2d6', price: 200 } }]) }), 'kes']);
    const kes = await boot('kes', false);
    expect(await checkout(kes, goods, { buys: [], sells: [{ catalogue: 'type:weapons', id: 'item:pistol', qty: 1 }] })).toMatchObject({ ok: true, payout: 100 });
    expect(await balance()).toBe(1100);
  });

  it('a one-of-a-kind item kept out of the shops: sold back where its type is sold, at its price and the shop\'s rate; never at another (8a7a3c2)', async () => {
    await run(db, 'UPDATE character_sheets SET data = ? WHERE username = ?', [JSON.stringify({ inventory: JSON.stringify([{ name: 'Ring of Might', qty: 1, enc: '', bundled: false, carry: 'stowed', location: '', type: 'armor' }]) }), 'kes']);
    const kes = await boot('kes', false);
    // Not at the General Store, which sells no ARMOR: no ring at a gun shop.
    expect(await checkout(kes, goods, { buys: [], sells: [{ catalogue: 'type:armor', id: 'item:ring', qty: 1 }] })).toMatchObject({ ok: false, reason: 'not_sold' });
    kes.emitted.length = 0;
    // Nor bought, anywhere.
    expect(await checkout(kes, arms, { buys: [{ catalogue: 'type:armor', itemId: 'item:ring', qty: 1 }] })).toMatchObject({ ok: false });
    kes.emitted.length = 0;
    // At the Armorer, at the app's 45%: 5000 → 2250.
    expect(await checkout(kes, arms, { buys: [], sells: [{ catalogue: 'type:armor', id: 'item:ring', qty: 1 }] })).toMatchObject({ ok: true, payout: 2250 });
    expect(await balance()).toBe(3250);
  });

  it('the window is told what a shop buys back with the catalogues (8a7a3c2)', async () => {
    const kes = await boot('kes', false);
    kes.handlers.requestCatalogues();
    expect((await last(kes.emitted, 'catalogues')).data.buyback).toEqual({ 'type:armor': [{ id: 'item:ring', name: 'Ring of Might', price: 5000 }] });
  });

  it('a line uploaded with its name wins: one Pistol, at the file\'s price', async () => {
    const gm = await boot('gm', true);
    gm.handlers.saveCatalogue({ text: '[WEAPONS]\nname, price, damage\nPistol, 260, 2d6\n' });
    expect((await last(gm.emitted, 'catalogueSaved')).data.ok).toBe(true);
    const kes = await boot('kes', false);
    expect(await checkout(kes, goods, { buys: [{ catalogue: 'type:weapons', itemId: 'item:pistol', qty: 1 }] })).toMatchObject({ ok: false });
    kes.emitted.length = 0;
    expect(await checkout(kes, goods, { buys: [{ catalogue: 'type:weapons', itemId: 'pistol', qty: 1 }] })).toMatchObject({ ok: true, buys: [{ price: 260 }] });
  });

  it('the catalogue preview says what the file does to the items, and the save leaves out what it said (8a7a3c1)', async () => {
    const gm = await boot('gm', true);
    const text = '[WEAPONS]\nname, price, damage, description\nPistol, 200, 2d6, Snub.\nHand Cannon, 900, 3d6\n[ARMOR]\nname, price, defense\nRing of Might, 10, \nLeather Jacket, 75, 2\n';
    gm.handlers.previewCatalogue({ text });
    const preview = (await last(gm.emitted, 'cataloguePreview')).data;
    expect(preview.summary.map((x) => [x.label, x.count])).toEqual([['WEAPONS', 1], ['ARMOR', 1]]);
    expect(preview.items).toEqual({
      onSale: 2,
      overrules: [{ line: 8, catalogue: 'type:armor', name: 'Leather Jacket', from: 50, to: 75 }],
      leftOut: [
        { line: 3, catalogue: 'type:weapons', name: 'Pistol', message: 'already on ITEMS at 200, the same in every column: left out, as it sells itself' },
        { line: 7, catalogue: 'type:armor', name: 'Ring of Might', message: 'kept out of the shops on ITEMS (IN SHOPS is off), so never sold: left out' },
      ],
    });
    gm.handlers.saveCatalogue({ text });
    expect((await last(gm.emitted, 'catalogueSaved')).data).toMatchObject({ ok: true, saved: [{ catalogue: 'type:weapons', count: 1 }, { catalogue: 'type:armor', count: 1 }] });
    const rows = await new Promise((resolve, reject) => db.all('SELECT catalogue, name, price FROM shop_catalogues WHERE system = ? ORDER BY catalogue, name', [ID], (e, r) => (e ? reject(e) : resolve(r))));
    expect(rows).toEqual([{ catalogue: 'type:armor', name: 'Leather Jacket', price: 75 }, { catalogue: 'type:weapons', name: 'Hand Cannon', price: 900 }]);
  });

  it('GIVE: the game\'s items in its own ITEMS folder, not again under their type', async () => {
    await boot('gm', true);
    expect(give.givable(ID).find((c) => c.catalogue === 'type:weapons')?.items ?? []).toEqual([]);
    expect(give.placeGift(ID, 'type:weapons', 'item:pistol', { inventory: '[]' }, 1)).toEqual({ ok: false, reason: 'Not something this game can give.' });
  });
});
