/**
 * What a shop BUYS (8a7b1b; the user, 2026-11-21: "shops like pawns or fences that will buy anything"; drawn in the approved
 * mockup docs/mockups/types-in-shops.html, section 4). WHAT IT SELLS, as every shop always has, or ANYTHING: every priced
 * thing the game has, at the building's BUYBACK rate. Set on the app's shops and the game's own alike.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'module';
import { makeTestDb, get, run } from './helpers/testDb.js';
import { untilValue, drain } from './helpers/until.js';

const require_ = createRequire(import.meta.url);
const { checkDefinition } = require_('../systemBuilder/definition');
const { buysOf, ownShops, ownBuildings, BUYS } = require_('../systemBuilder/buildings');
const { boughtAt } = require_('../systemBuilder/itemTypes');
const citysys = require_('../systemBuilder/citysys');
const store = require_('../shops/catalogueStore');
const runtime = require_('../systemBuilder/runtime');
const socketsFactory = (await import('../sockets/index.js')).default;

const POTIONS = { id: 'potions', label: 'POTIONS', one: 'Potion', columns: [{ id: 'heals', label: 'HEALS', kind: 'dice' }] };
const HERBAL = (buildings) => ({
  format: 1, name: 'Herbal', core: { health: { model: 'pool' } },
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }] }],
  buildings,
  items: { types: [{ ...POTIONS, sold_at: ['apothecary'] }], list: [{ id: 'draught', label: 'Healing Draught', type: 'potions', values: { heals: '2d4' }, price: 40 }] },
});
const SHOPS = [{ id: 'apothecary', name: 'Apothecary' }, { id: 'fence', name: 'Fence', buys: 'anything' }];
const problemsOf = (buildings) => checkDefinition({ format: 1, name: 'A', buildings }).problems;

describe('checked', () => {
  it('WHAT IT SELLS or ANYTHING, on the app\'s shops and the game\'s own', () => {
    expect(BUYS).toEqual(['sells', 'anything']);
    expect(problemsOf({ types: { general_store: { buys: 'anything' }, gun_shop: { buys: 'sells' } }, shops: SHOPS })).toEqual([]);
  });

  it('names whatever it can\'t take; a building that is no shop buys nothing', () => {
    const word = 'WHAT IT SELLS ("sells") or ANYTHING ("anything")';
    expect(problemsOf({ types: { general_store: { buys: 'all' } } })).toEqual([{ where: 'buildings types general_store, buys', message: word }]);
    expect(problemsOf({ shops: [{ id: 'fence', name: 'Fence', buys: true }] })).toEqual([{ where: 'buildings shop 1, buys', message: word }]);
    expect(problemsOf({ types: { bar: { buys: 'anything' } } })).toEqual([{ where: 'buildings types bar, buys', message: 'Only "name" and "on" are set here' }]);
    expect(problemsOf({ types: { general_store: { sells: ['gear'] } } })).toEqual([{ where: 'buildings types general_store, sells', message: 'Only "name", "on" and "buys" are set here' }]);
    expect(problemsOf({ shops: [{ id: 'fence', name: 'Fence', sells: ['gear'] }] })).toEqual([{ where: 'buildings shop 1, sells', message: 'Only "id", "name", "on" and "buys" are set here' }]);
  });
});

describe('read', () => {
  const def = HERBAL({ types: { general_store: { buys: 'anything' }, gun_shop: { buys: 'sells' }, bar: { buys: 'anything' } }, shops: SHOPS });

  it('ANYTHING where it says so; else, and in every built-in game, what it sells', () => {
    expect(buysOf(def, 'general_store')).toBe('anything');
    expect(buysOf(def, 'fence')).toBe('anything');
    expect(buysOf(def, 'gun_shop')).toBe('sells');
    expect(buysOf(def, 'apothecary')).toBe('sells');
    expect(buysOf(def, 'bar')).toBe('sells');
    expect(buysOf(null, 'general_store')).toBe('sells');
  });

  it('sent to the browser: on a shop that buys anything, and the game\'s own shop that does', () => {
    expect(ownBuildings(def).types).toEqual({ general_store: { buys: 'anything' } });
    expect(ownShops(def)).toEqual([{ id: 'apothecary', name: 'Apothecary', on: true }, { id: 'fence', name: 'Fence', on: true, buys: 'anything' }]);
  });

  it('the shelves it buys back from: what it sells, or every shelf the game prices', () => {
    expect(boughtAt(def, 'apothecary', ['type:potions'], ['gear', 'weapons'])).toEqual(['type:potions']);
    expect(boughtAt(def, 'fence', [], ['gear', 'weapons'])).toEqual(['gear', 'weapons', 'type:potions']);
    expect(boughtAt(def, 'general_store', ['gear'], ['gear', 'weapons'])).toEqual(['gear', 'weapons', 'type:potions']);
    // A game with no types of its own: the app's shelves only.
    expect(boughtAt({ buildings: { types: { general_store: { buys: 'anything' } } } }, 'general_store', ['gear'], ['gear', 'weapons'])).toEqual(['gear', 'weapons']);
  });

  it('carried by the system file, exported and read back unchanged', () => {
    const read = citysys.readFile(JSON.stringify(citysys.buildFile({ definition: def, version: 1, origin: 'sys_herbalherbalherba' })));
    expect(read.file.definition.buildings).toEqual(def.buildings);
  });
});

describe('sold back at the table', () => {
  const ID = 'sys_herbalherbalherba';
  let db;
  const install = async (definition) => {
    const text = JSON.stringify(definition);
    await run(db, 'DELETE FROM custom_systems WHERE id = ?', [ID]);
    await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', [ID, 'Herbal', text, text]);
    await new Promise((resolve) => runtime.load(db, resolve));
  };
  const stall = async (type) => (await run(db, "INSERT INTO locations (name, x, y, z, shape, building_type) VALUES ('Stall', 0, 0, 0, 'box', ?)", [type])).lastID;
  const boot = async (who) => {
    const emitted = [];
    let connect;
    socketsFactory({ on: (e, cb) => { if (e === 'connection') connect = cb; }, emit: (event, data) => emitted.push({ event, data }), to: () => ({ emit: () => {} }) },
      db, { elevatedUsers: new Set(), emitUpdate: vi.fn(), recordAction: vi.fn() });
    const handlers = {};
    connect({ id: `sb-${who}-${Math.random()}`, on: (e, fn) => { handlers[e] = fn; }, emit: (event, data) => emitted.push({ event, data }), broadcast: { emit: () => {} }, use: () => {}, join: () => {} });
    handlers.identify(who);
    await drain(db);
    return { handlers, emitted };
  };
  const sell = async (who, locationId) => {
    who.emitted.length = 0;
    who.handlers.checkoutShop({ locationId, buys: [], sells: [{ catalogue: 'type:potions', id: 'item:draught', qty: 1 }] });
    return (await untilValue(() => [...who.emitted].reverse().find((e) => e.event === 'shopCheckout'), Boolean, { label: 'shopCheckout' })).data;
  };
  const balance = async () => (await get(db, 'SELECT balance FROM bank_accounts WHERE username = ?', ['kes'])).balance;
  const SHEET = JSON.stringify({ inventory: JSON.stringify([{ name: 'Healing Draught', qty: 1, carry: 'stowed', type: 'potions', values: { heals: '2d4' } }]) });

  beforeEach(async () => {
    store.clear();
    db = await makeTestDb();
    await run(db, `CREATE TABLE IF NOT EXISTS shop_catalogues (system TEXT NOT NULL, catalogue TEXT NOT NULL, id TEXT NOT NULL,
      name TEXT NOT NULL, price REAL NOT NULL DEFAULT 0, fields TEXT NOT NULL DEFAULT '{}', PRIMARY KEY (system, catalogue, id))`);
    await run(db, "INSERT INTO global_settings (key, value) VALUES ('game_system', ?)", [ID]);
    await run(db, 'INSERT INTO bank_accounts (username, system, balance, debt) VALUES (?, ?, 100, 0)', ['kes', ID]);
    await run(db, 'INSERT INTO character_sheets (username, system, data, is_npc) VALUES (?, ?, ?, 0)', ['kes', ID, SHEET]);
  });

  it('a Fence that buys anything takes the draught it never sells, at the building\'s rate, off the sheet', async () => {
    await install(HERBAL({ shops: SHOPS }));
    const fence = await stall('fence');
    await run(db, 'UPDATE locations SET buyback_pct = 50 WHERE id = ?', [fence]);
    const kes = await boot('kes');
    expect(await sell(kes, fence)).toMatchObject({ ok: true, payout: 20 });
    expect(await balance()).toBe(120);
    const sheet = JSON.parse((await get(db, 'SELECT data FROM character_sheets WHERE username = ?', ['kes'])).data);
    expect(JSON.parse(sheet.inventory)).toEqual([]);
  });

  it('a General Store set to ANYTHING takes it; on WHAT IT SELLS, and as a Fence that doesn\'t, it is not sold', async () => {
    await install(HERBAL({ types: { general_store: { buys: 'anything' } }, shops: [{ id: 'fence', name: 'Fence' }] }));
    const goods = await stall('general_store');
    const fence = await stall('fence');
    const kes = await boot('kes');
    expect(await sell(kes, fence)).toMatchObject({ ok: false, reason: 'not_sold' });
    // The app's 45% of its 40.
    expect(await sell(kes, goods)).toMatchObject({ ok: true, payout: 18 });
    await run(db, 'UPDATE character_sheets SET data = ? WHERE username = ?', [SHEET, 'kes']);
    await install(HERBAL({ types: { general_store: { buys: 'sells' } } }));
    expect(await sell(kes, goods)).toMatchObject({ ok: false, reason: 'not_sold' });
  });
});
