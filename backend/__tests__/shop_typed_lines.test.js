/**
 * Lines of an item type in the shops and GIVE (8a7a2; decided 2026-11-20, mockup docs/mockups/item-types-in-shops.html): a type
 * is sold at the kinds of shop its SOLD AT says, the General Store where the GM said none; bought, sold back or given, a line
 * lands on the gear as a line of its type with the type's columns as its values, a COUNT full, stacked only onto the same
 * thing untouched. The shops' own shelves, and the games without types of their own, as they were.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createRequire } from 'module';
import jwt from 'jsonwebtoken';
import { makeTestDb, get, run } from './helpers/testDb.js';
import { untilValue, drain } from './helpers/until.js';

process.env.JWT_SECRET = 'test-secret';
const require_ = createRequire(import.meta.url);
const { soldAt, typeShelvesAt, DEFAULT_SOLD_AT } = require_('../systemBuilder/itemTypes');
const { checkDefinition } = require_('../systemBuilder/definition');
const citysys = require_('../systemBuilder/citysys');
const { placeUploaded } = require_('../shops/placement');
const give = require_('../shops/give');
const store = require_('../shops/catalogueStore');
const runtime = require_('../systemBuilder/runtime');
const socketsFactory = (await import('../sockets/index.js')).default;

const GUNS = {
  id: 'guns', label: 'GUNS', one: 'Gun', columns: [
    { id: 'damage', label: 'DAMAGE', kind: 'damage' },
    { id: 'ammo', label: 'AMMO', kind: 'count', button: 'FIRE' },
    { id: 'grade', label: 'GRADE', kind: 'pick', options: ['LIGHT', 'HEAVY'] },
  ],
};
const SYSTEM = (types) => ({
  format: 1, name: 'Typed', core: { health: { model: 'pool' } },
  stats: [{ id: 'abilities', label: 'ABILITIES', stats: [{ id: 'might', label: 'Might' }] }],
  items: { types, list: [] },
});

describe('SOLD AT', () => {
  it('the kinds of shop a type says, those that are shops; the General Store where it says none', () => {
    expect(DEFAULT_SOLD_AT).toEqual(['general_store']);
    expect(soldAt(GUNS)).toEqual(['general_store']);
    expect(soldAt({ ...GUNS, sold_at: ['gun_shop', 'armorer'] })).toEqual(['gun_shop', 'armorer']);
    // None at all: given only.
    expect(soldAt({ ...GUNS, sold_at: [] })).toEqual([]);
    expect(soldAt({ ...GUNS, sold_at: ['gun_shop', 'noodle_bar'] })).toEqual(['gun_shop']);
  });

  it('a kind of building\'s type shelves; none in a game without types of its own', () => {
    const def = SYSTEM([{ ...GUNS, sold_at: ['gun_shop', 'general_store'] }, { id: 'potions', label: 'POTIONS', columns: [] }]);
    expect(typeShelvesAt(def, 'gun_shop')).toEqual(['type:guns']);
    expect(typeShelvesAt(def, 'general_store')).toEqual(['type:guns', 'type:potions']);
    expect(typeShelvesAt(def, 'clinic')).toEqual([]);
    expect(typeShelvesAt(SYSTEM(undefined), 'general_store')).toEqual([]);
  });

  it('checked: a list of the kinds of shop, each once', () => {
    const problems = (soldAtValue) => checkDefinition(SYSTEM([{ ...GUNS, sold_at: soldAtValue }])).problems.filter((p) => /sold_at/.test(p.where));
    expect(problems(['gun_shop', 'general_store'])).toEqual([]);
    expect(problems('gun_shop')).toEqual([{ where: 'type guns, sold_at', message: 'A list of the kinds of shop that sell it' }]);
    expect(problems(['gun_shop', 'noodle_bar', 'gun_shop'])).toEqual([
      { where: 'type guns, sold_at 2', message: 'No kind of shop is called noodle_bar' },
      { where: 'type guns, sold_at 3', message: 'Said twice' },
    ]);
  });

  it('carried by the system file: exported, then read back unchanged, still checked', () => {
    const definition = SYSTEM([{ ...GUNS, sold_at: ['gun_shop', 'armorer'] }, { id: 'potions', label: 'POTIONS', columns: [], sold_at: [] }]);
    const read = citysys.readFile(JSON.stringify(citysys.buildFile({ definition, version: 1, origin: 'sys_soldatsoldatsolda' })));
    expect(read.problems, JSON.stringify(read)).toEqual([]);
    expect(read.file.definition.items.types.map((t) => t.sold_at)).toEqual([['gun_shop', 'armorer'], []]);
    expect(typeShelvesAt(read.file.definition, 'armorer')).toEqual(['type:guns']);
    expect(typeShelvesAt(read.file.definition, 'general_store')).toEqual([]);
    const broken = citysys.readFile(JSON.stringify(citysys.buildFile({ definition: SYSTEM([{ ...GUNS, sold_at: ['noodle_bar'] }]), version: 1, origin: 'sys_soldatsoldatsolda' })));
    expect(broken.problems).toEqual([{ where: 'type guns, sold_at 1', message: 'No kind of shop is called noodle_bar' }]);
  });
});

describe('a typed line placed', () => {
  const PISTOL = { id: 'pistol', name: 'Pistol', price: 250, fields: { damage: '2d6', ammo: 6, grade: 'LIGHT', description: 'Snub.' } };
  const COLUMNS = GUNS.columns.map((c) => c.id);
  const inv = (patch) => JSON.parse(patch.inventory);
  const place = (data) => placeUploaded('sys_x', 'type:guns', PISTOL, data, COLUMNS);

  it('a line of the type, its values the type\'s own columns, nothing spent, stowed', () => {
    const placed = place({});
    expect(placed.ok).toBe(true);
    expect(inv(placed.patch)).toEqual([{ name: 'Pistol', qty: 1, enc: '', bundled: false, carry: 'stowed', location: '', type: 'guns', values: { damage: '2d6', ammo: 6, grade: 'LIGHT' } }]);
    // A column left blank, or none at all: no value for it.
    expect(inv(placeUploaded('sys_x', 'type:guns', { ...PISTOL, fields: { damage: '2d6', ammo: '' } }, {}, COLUMNS).patch)[0].values).toEqual({ damage: '2d6' });
    expect(inv(placeUploaded('sys_x', 'type:guns', { ...PISTOL, fields: {} }, {}, COLUMNS).patch)[0]).not.toHaveProperty('values');
  });

  it('stacked onto the same thing untouched; never onto one made UNIQUE, half spent, of another type, or in the stash', () => {
    const one = inv(place({}).patch);
    expect(inv(place({ inventory: JSON.stringify(one) }).patch).map((l) => l.qty)).toEqual([2]);
    const changed = [{ ...one[0], values: { ...one[0].values, damage: '2d8' } }];
    expect(inv(place({ inventory: JSON.stringify(changed) }).patch).map((l) => l.qty)).toEqual([1, 1]);
    const spent = [{ ...one[0], counts: { ammo: 2 } }];
    expect(inv(place({ inventory: JSON.stringify(spent) }).patch).map((l) => l.qty)).toEqual([1, 1]);
    const other = [{ ...one[0], type: 'wands' }];
    expect(inv(place({ inventory: JSON.stringify(other) }).patch).map((l) => l.qty)).toEqual([1, 1]);
    const stashed = [{ ...one[0], carry: 'stash' }];
    expect(inv(place({ inventory: JSON.stringify(stashed) }).patch).map((l) => l.qty)).toEqual([1, 1]);
  });
});

describe('at the table', () => {
  const ID = 'sys_typedlinestypedli';
  let db;
  let store_;
  let gun;
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
  const install = async (types) => {
    const def = JSON.stringify(SYSTEM(types));
    await run(db, 'DELETE FROM custom_systems WHERE id = ?', [ID]);
    await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', [ID, 'Typed', def, def]);
    await new Promise((resolve) => runtime.load(db, resolve));
  };
  const save = async () => {
    const gm = await boot('gm', true);
    gm.handlers.saveCatalogue({ text: '[GUNS]\nname, price, damage, ammo, grade\nPistol, 250, 2d6, 6, LIGHT\n' });
    expect((await last(gm.emitted, 'catalogueSaved')).data.ok).toBe(true);
    return gm;
  };
  const checkout = async (who, locationId, more) => {
    who.handlers.checkoutShop({ locationId, ...more });
    return (await last(who.emitted, 'shopCheckout')).data;
  };
  const inventoryOf = async (username) => JSON.parse(JSON.parse((await get(db, 'SELECT data FROM character_sheets WHERE username = ?', [username])).data).inventory || '[]');

  beforeEach(async () => {
    store.clear();
    db = await makeTestDb();
    await run(db, `CREATE TABLE IF NOT EXISTS shop_catalogues (system TEXT NOT NULL, catalogue TEXT NOT NULL, id TEXT NOT NULL,
      name TEXT NOT NULL, price REAL NOT NULL DEFAULT 0, fields TEXT NOT NULL DEFAULT '{}', PRIMARY KEY (system, catalogue, id))`);
    await install([GUNS]);
    await run(db, "INSERT INTO global_settings (key, value) VALUES ('game_system', ?)", [ID]);
    store_ = (await run(db, "INSERT INTO locations (name, x, y, z, shape, building_type) VALUES ('Goods', 0, 0, 0, 'box', 'general_store')")).lastID;
    gun = (await run(db, "INSERT INTO locations (name, x, y, z, shape, building_type) VALUES ('Arms', 0, 0, 0, 'box', 'gun_shop')")).lastID;
    await run(db, 'INSERT INTO bank_accounts (username, system, balance, debt) VALUES (?, ?, 1000, 0)', ['kes', ID]);
    await run(db, 'INSERT INTO character_sheets (username, system, data, is_npc) VALUES (?, ?, ?, 0)', ['kes', ID, JSON.stringify({ inventory: '[]' })]);
  });

  it('bought where the type is sold (the General Store, unsaid), paid for; not where it isn\'t', async () => {
    await save();
    const kes = await boot('kes', false);
    expect(await checkout(kes, store_, { buys: [{ catalogue: 'type:guns', itemId: 'pistol', qty: 1 }] })).toMatchObject({ ok: true, buys: [{ catalogue: 'type:guns', itemId: 'pistol', qty: 1, price: 250 }] });
    expect(await get(db, 'SELECT balance FROM bank_accounts WHERE username = ?', ['kes'])).toEqual({ balance: 750 });
    kes.emitted.length = 0;
    expect(await checkout(kes, gun, { buys: [{ catalogue: 'type:guns', itemId: 'pistol', qty: 1 }] })).toMatchObject({ ok: false, reason: 'not_sold' });
  });

  it('SOLD AT the gun shop: sold there, and no longer at the General Store', async () => {
    await install([{ ...GUNS, sold_at: ['gun_shop'] }]);
    await save();
    const kes = await boot('kes', false);
    expect(await checkout(kes, gun, { buys: [{ catalogue: 'type:guns', itemId: 'pistol', qty: 1 }] })).toMatchObject({ ok: true });
    kes.emitted.length = 0;
    expect(await checkout(kes, store_, { buys: [{ catalogue: 'type:guns', itemId: 'pistol', qty: 1 }] })).toMatchObject({ ok: false, reason: 'not_sold' });
  });

  it('a typed line sold back where its type is sold: paid at the shop\'s rate, off the sheet', async () => {
    await save();
    await run(db, 'UPDATE character_sheets SET data = ? WHERE username = ?', [JSON.stringify({ inventory: JSON.stringify([{ name: 'Pistol', qty: 1, enc: '', bundled: false, carry: 'stowed', location: '', type: 'guns', values: { damage: '2d6', ammo: 6, grade: 'LIGHT' } }]) }), 'kes']);
    const kes = await boot('kes', false);
    const out = await checkout(kes, store_, { buys: [], sells: [{ catalogue: 'type:guns', id: 'pistol', qty: 1 }] });
    expect(out).toMatchObject({ ok: true });
    expect(await inventoryOf('kes')).toEqual([]);
    // Exactly the app's 45% of its 250 (8a7a3c2; it said only "more than 1000").
    expect(out).toMatchObject({ payout: 112 });
    expect((await get(db, 'SELECT balance FROM bank_accounts WHERE username = ?', ['kes'])).balance).toBe(1112);
  });

  it('GIVE: every type offered, sold anywhere or not; given, a line of its type with its values', async () => {
    await install([{ ...GUNS, sold_at: [] }]);
    await save();
    expect(give.givable(ID).map((c) => c.catalogue)).toEqual(['type:guns']);
    const gift = give.placeGift(ID, 'type:guns', 'pistol', { inventory: '[]' }, 2);
    expect(gift.ok).toBe(true);
    expect(JSON.parse(gift.patch.inventory)).toEqual([expect.objectContaining({ name: 'Pistol', qty: 2, type: 'guns', values: { damage: '2d6', ammo: 6, grade: 'LIGHT' } })]);
    // Not a type of this game: not given.
    expect(give.placeGift(ID, 'type:wands', 'pistol', {}, 1)).toEqual({ ok: false, reason: 'Not something this game can give.' });
  });
});
