/**
 * An uploaded catalogue, all the way through.
 *
 * The pieces are tested apart - the parser, the store, the arithmetic. What is tested here
 * is that they are actually joined up: a GM pastes a weapon list, saves it, and a player
 * can then walk into a gun shop and buy something that was not in the book an hour ago,
 * and sell it back.
 *
 * Also that saving one list does not cost anybody the 216 items the app ships with, which
 * is the quiet failure nobody would notice until they went looking for a gas mask.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeTestDb, get, run } from './helpers/testDb.js';
import { untilValue, drain } from './helpers/until.js';
import { createRequire } from 'module';
import jwt from 'jsonwebtoken';

process.env.JWT_SECRET = 'test-secret';
process.env.DICE_ANIM_MS = '0';

const socketsFactory = (await import('../sockets/index.js')).default;
const require_ = createRequire(import.meta.url);
const store = require_('../shops/catalogueStore');

let nextSocket = 0;
function boot(db, id = `cat-sock-${(nextSocket += 1)}`) {
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
  store.clear();
  db = await makeTestDb();
  await run(db, `CREATE TABLE IF NOT EXISTS player_banks (
    username TEXT PRIMARY KEY, balance REAL, debt REAL,
    first_pay_done INTEGER DEFAULT 0, high_roller_done INTEGER DEFAULT 0)`);
  await run(db, `CREATE TABLE IF NOT EXISTS shop_catalogues (
    system TEXT NOT NULL, catalogue TEXT NOT NULL, id TEXT NOT NULL,
    name TEXT NOT NULL, price REAL NOT NULL DEFAULT 0, fields TEXT NOT NULL DEFAULT '{}',
    PRIMARY KEY (system, catalogue, id))`);
  await run(db, `INSERT INTO global_settings (key, value) VALUES ('game_system', 'cities_without_number')`);
  const r = await run(db,
    `INSERT INTO locations (name, x, y, z, shape, building_type) VALUES ('Vic''s', 0, 0, 0, 'box', 'gun_shop')`);
  gunShop = r.lastID;
});

/**
 * An admin, with the signed token the server insists on.
 *
 * `isAdmin: true` on its own is a claim and the server resolves it to false - a deliberate
 * fix, and the reason the first version of these tests saw nothing happen at all.
 */
const admin = async (name = 'GM') => {
  const booted = boot(db);
  booted.handlers['identify']({
    userName: name,
    isAdmin: true,
    token: jwt.sign({ username: name, isTemporary: false }, 'test-secret'),
  });
  await drain(db);
  return booted;
};

const player = async (name = 'GHOST') => {
  const booted = boot(db);
  booted.handlers['identify'](name);
  await drain(db);
  return booted;
};

const seed = (data, username = 'GHOST') => run(db,
  `INSERT INTO character_sheets (username, system, data, is_npc)
   VALUES (?, 'cities_without_number', ?, 0)`, [username, JSON.stringify(data)]);

const fund = (username, balance) => run(db,
  'INSERT OR REPLACE INTO player_banks (username, balance, debt) VALUES (?, ?, 0)',
  [username, balance]);

const bank = (username = 'GHOST') =>
  get(db, 'SELECT balance FROM player_banks WHERE username = ?', [username]);

const last = (emitted, event) => [...emitted].reverse().find((e) => e.event === event);
const waitFor = (emitted, event) =>
  untilValue(() => last(emitted, event), Boolean, { label: event });

const ZIP_GUN = [
  '[weapons]',
  'name, price, dmg, skill',
  'Zip Gun, 15, 1d4, shoot',
].join('\n');

describe('previewing before saving', () => {
  it('says what would be read, and stores nothing', async () => {
    const { handlers, emitted } = await admin();
    handlers['previewCatalogue']({ text: ZIP_GUN });

    const out = await waitFor(emitted, 'cataloguePreview');
    expect(out.data.problems).toEqual([]);
    expect(out.data.summary).toEqual([{ catalogue: 'weapons', count: 1, overrides: [] }]);
    expect(await get(db, 'SELECT COUNT(*) n FROM shop_catalogues')).toMatchObject({ n: 0 });
  });

  it('warns that a row would override something the app ships with', async () => {
    // A GM is entitled to house-rule a price. They should know they are doing it.
    const { handlers, emitted } = await admin();
    handlers['previewCatalogue']({
      text: '[weapons]\nname, price\nHeavy Pistol, 250',
    });
    const out = await waitFor(emitted, 'cataloguePreview');
    expect(out.data.summary[0].overrides).toEqual(['Heavy Pistol']);
  });

  it('names a bad line without losing the good ones', async () => {
    const { handlers, emitted } = await admin();
    handlers['previewCatalogue']({
      text: '[weapons]\nname, price\nZip Gun, 15\nBroken, ask the GM',
    });
    const out = await waitFor(emitted, 'cataloguePreview');
    expect(out.data.summary[0].count).toBe(1);
    expect(out.data.problems[0]).toMatchObject({ line: 4, name: 'Broken' });
  });

  it('is not something a player can do', async () => {
    /**
     * Asserting "nothing was emitted" after a drain passes whether the handler is gated
     * or merely slow - it did exactly that when the admin check was deliberately removed.
     * So an admin does the same thing afterwards and is waited for: once THAT reply has
     * landed, the loop has turned far enough that the player's would have too.
     */
    const ghost = await player();
    ghost.handlers['previewCatalogue']({ text: ZIP_GUN });

    const gm = await admin();
    gm.handlers['previewCatalogue']({ text: ZIP_GUN });
    await waitFor(gm.emitted, 'cataloguePreview');

    expect(last(ghost.emitted, 'cataloguePreview')).toBeUndefined();
  });
});

describe('saving a catalogue', () => {
  const save = async (text = ZIP_GUN) => {
    const booted = await admin();
    booted.handlers['saveCatalogue']({ text });
    await waitFor(booted.emitted, 'catalogueSaved');
    return booted;
  };

  it('stores it and tells everybody to redraw', async () => {
    const { emitted } = await save();
    expect(last(emitted, 'catalogueSaved').data).toMatchObject({ ok: true });
    expect(last(emitted, 'cataloguesChanged')).toBeTruthy();
    const row = await get(db, `SELECT * FROM shop_catalogues WHERE id = 'zip_gun'`);
    expect(row).toMatchObject({ system: 'cities_without_number', catalogue: 'weapons', price: 15 });
    expect(JSON.parse(row.fields)).toEqual({ dmg: '1d4', skill: 'shoot' });
  });

  it('leaves everything the app ships with exactly where it was', async () => {
    // The quiet failure: six uploaded guns costing somebody the other 210 items.
    await save();
    expect(store.priceOf('weapons', 'heavy_pistol')).toBe(200);
    expect(store.priceOf('gear', 'climbing_kit')).toBe(150);
    expect(store.priceOf('cyberware', 'cranial-jack')).toBe(1000);
    expect(store.priceOf('weapons', 'zip_gun')).toBe(15);
  });

  it('replaces the uploaded set, which is how a line is removed', async () => {
    await save('[weapons]\nname, price\nZip Gun, 15\nSlug Thrower, 80');
    await save('[weapons]\nname, price\nZip Gun, 15');
    const rows = await new Promise((res, rej) => db.all(
      `SELECT id FROM shop_catalogues WHERE catalogue = 'weapons'`,
      (e, r) => (e ? rej(e) : res(r)),
    ));
    expect(rows.map((r) => r.id)).toEqual(['zip_gun']);
  });

  it('is not something a player can do', async () => {
    // Waited out through an admin's own save, for the reason given on the preview test:
    // absence after a drain is not evidence of a gate.
    const ghost = await player();
    ghost.handlers['saveCatalogue']({
      text: ['[gear]', 'name, price', 'Smuggled Thing, 1'].join('\n'),
    });

    const gm = await admin();
    gm.handlers['saveCatalogue']({ text: ZIP_GUN });
    await waitFor(gm.emitted, 'catalogueSaved');

    expect(last(ghost.emitted, 'catalogueSaved')).toBeUndefined();
    const rows = await new Promise((res, rej) => db.all(
      'SELECT id FROM shop_catalogues', (e, r) => (e ? rej(e) : res(r)),
    ));
    expect(rows.map((r) => r.id)).toEqual(['zip_gun']);
  });

  it('refuses a file with nothing readable in it', async () => {
    const { handlers, emitted } = await admin();
    handlers['saveCatalogue']({ text: 'nonsense with no sections' });
    expect((await waitFor(emitted, 'catalogueSaved')).data).toMatchObject({ ok: false });
  });
});

describe('buying and selling something a GM added', () => {
  const save = async (text = ZIP_GUN) => {
    const booted = await admin();
    booted.handlers['saveCatalogue']({ text });
    await waitFor(booted.emitted, 'catalogueSaved');
  };

  it('can be bought, at the price the GM set', async () => {
    await save();
    await seed({});
    await fund('GHOST', 1000);
    const { handlers, emitted } = await player();

    handlers['buyFromShop']({ locationId: gunShop, catalogue: 'weapons', itemId: 'zip_gun' });
    const out = await waitFor(emitted, 'shopPurchase');

    expect(out.data).toMatchObject({ ok: true, price: 15 });
    expect((await bank()).balance).toBe(985);
  });

  it('can be sold back, at the shop\'s rate on that price', async () => {
    await save();
    // Owning one, by name, the way a sheet records it.
    await seed({ weapon1_name: 'Zip Gun' });
    await fund('GHOST', 0);
    const { handlers, emitted } = await player();

    handlers['sellToShop']({
      locationId: gunShop,
      items: [{ catalogue: 'weapons', id: 'zip_gun', qty: 1 }],
    });
    const out = await waitFor(emitted, 'shopSale');

    // 15 at the default 45% is 6, rounded down from 6.75.
    expect(out.data).toMatchObject({ ok: true, payout: 6 });
    expect((await bank()).balance).toBe(6);
    expect((await get(db, `SELECT data FROM character_sheets WHERE username = 'GHOST'`)).data)
      .toContain('"weapon1_name":""');
  });

  it('charges the overridden price once a GM has house-ruled it', async () => {
    await save('[weapons]\nname, price\nHeavy Pistol, 250');
    await seed({});
    await fund('GHOST', 1000);
    const { handlers, emitted } = await player();

    handlers['buyFromShop']({ locationId: gunShop, catalogue: 'weapons', itemId: 'heavy_pistol' });
    expect((await waitFor(emitted, 'shopPurchase')).data.price).toBe(250);
  });
});

describe('a shop in another system\'s game', () => {
  /**
   * The CWN book is CWN's. A Cyberpunk RED gun shop carries only what that GM uploaded,
   * and it is priced and emptied by Cyberpunk RED's sheet, not CWN's.
   */
  const UNITY = [
    '[weapons]',
    'name, price, dmg, skill, rof',
    'Militech Unity, 100, 3d6, Handgun, 2',
  ].join('\n');

  beforeEach(async () => {
    await run(db, `UPDATE global_settings SET value = 'cyberpunk_red' WHERE key = 'game_system'`);
  });

  const seedRed = (data, username = 'GHOST') => run(db,
    `INSERT INTO character_sheets (username, system, data, is_npc)
     VALUES (?, 'cyberpunk_red', ?, 0)`, [username, JSON.stringify(data)]);

  it('sends a player the uploads when they sign in, without being asked', async () => {
    /**
     * The window asks for catalogues the moment its socket connects - before it has
     * identified - and that request is dropped. Nothing asked again, so outside CWN, where
     * the uploads are all a shop has, a player found every shop empty after a fresh load.
     */
    const gm = await admin();
    gm.handlers['saveCatalogue']({ text: UNITY });
    await waitFor(gm.emitted, 'catalogueSaved');

    const { emitted } = await player();
    const out = await waitFor(emitted, 'catalogues');
    expect(out.data.entries.weapons.map((e) => e.name)).toEqual(['Militech Unity']);
  });

  it('will not sell a gun out of the CWN book', async () => {
    await seedRed({});
    await fund('GHOST', 1000);
    const { handlers, emitted } = await player();

    handlers['buyFromShop']({ locationId: gunShop, catalogue: 'weapons', itemId: 'heavy_pistol' });
    expect((await waitFor(emitted, 'shopPurchase')).data).toMatchObject({ ok: false, reason: 'price' });
    expect((await bank()).balance).toBe(1000);
  });

  it('reloads rather than pricing from whatever system is in memory', async () => {
    // The store is back on CWN, as if the system change's reload never landed. The
    // handler has to notice, not charge 200 for the CWN book's Heavy Pistol.
    await seedRed({});
    await fund('GHOST', 1000);
    const { handlers, emitted } = await player();
    store.clear();

    handlers['buyFromShop']({ locationId: gunShop, catalogue: 'weapons', itemId: 'heavy_pistol' });
    expect((await waitFor(emitted, 'shopPurchase')).data).toMatchObject({ ok: false, reason: 'price' });
    expect(store.systemLoaded()).toBe('cyberpunk_red');
  });

  it('buys and sells what that GM uploaded, clearing the whole row', async () => {
    const gm = await admin();
    gm.handlers['saveCatalogue']({ text: UNITY });
    await waitFor(gm.emitted, 'catalogueSaved');
    expect(await get(db, `SELECT system FROM shop_catalogues WHERE id = 'militech_unity'`))
      .toMatchObject({ system: 'cyberpunk_red' });

    await seedRed({
      weapon4_name: 'Militech Unity', weapon4_dmg: '3d6', weapon4_skill: 'Handgun', weapon4_rof: '2',
    });
    await fund('GHOST', 1000);
    const { handlers, emitted } = await player();

    handlers['buyFromShop']({ locationId: gunShop, catalogue: 'weapons', itemId: 'militech_unity' });
    expect((await waitFor(emitted, 'shopPurchase')).data).toMatchObject({ ok: true, price: 100 });
    expect((await bank()).balance).toBe(900);

    handlers['sellToShop']({
      locationId: gunShop,
      items: [{ catalogue: 'weapons', id: 'militech_unity', qty: 1 }],
    });
    expect((await waitFor(emitted, 'shopSale')).data).toMatchObject({ ok: true, payout: 45 });
    await untilValue(() => bank(), (b) => b && b.balance === 945, { label: 'credited' });

    const sheet = JSON.parse((await get(db,
      `SELECT data FROM character_sheets WHERE username = 'GHOST' AND system = 'cyberpunk_red'`)).data);
    for (const f of ['weapon4_name', 'weapon4_dmg', 'weapon4_skill', 'weapon4_rof']) {
      expect(sheet[f], f).toBe('');
    }
  });
});

describe('what a GM can download', () => {
  it('lists the book and the uploaded rows, each saying which it is', async () => {
    const booted = await admin();
    booted.handlers['saveCatalogue']({ text: ZIP_GUN });
    await waitFor(booted.emitted, 'catalogueSaved');

    booted.handlers['requestCatalogues']();
    // Signing in pushes the catalogues too, from before the save, so wait for the answer
    // that has the saved row in it rather than whichever arrived first.
    const out = await untilValue(
      () => last(booted.emitted, 'catalogues'),
      (e) => Boolean(e && e.data.entries.weapons.some((w) => w.id === 'zip_gun')),
      { label: 'catalogues with the upload' },
    );
    const weapons = out.data.entries.weapons;

    const zip = weapons.find((e) => e.id === 'zip_gun');
    const pistol = weapons.find((e) => e.id === 'heavy_pistol');
    expect(zip).toMatchObject({ source: 'uploaded', price: 15 });
    expect(pistol).toMatchObject({ source: 'book', price: 200 });
  });
});
