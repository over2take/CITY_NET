/**
 * Selling over the socket.
 *
 * The arithmetic and the sheet patch are tested on their own in shop_sell.test.js. What is
 * tested HERE is that the two halves actually happen together: the sheet really loses the
 * item and the bank really gains the money, against a real database, through the real
 * handler.
 *
 * Selling is the direction where getting it wrong pays somebody for goods they still have,
 * so the refusals matter as much as the successes.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { makeTestDb, get, run } from './helpers/testDb.js';
import { untilValue, drain } from './helpers/until.js';
import { createRequire } from 'module';

process.env.JWT_SECRET = 'test-secret';
process.env.DICE_ANIM_MS = '0';

const socketsFactory = (await import('../sockets/index.js')).default;
const require_ = createRequire(import.meta.url);
const { BUYBACK_SETTING } = require_('../shops/buyback');

let nextSocket = 0;
function boot(db, id = `sell-sock-${(nextSocket += 1)}`) {
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

const fund = (username, balance) => run(db,
  'INSERT OR REPLACE INTO player_banks (username, balance, debt) VALUES (?, ?, 0)',
  [username, balance]);

const identified = async (name = 'GHOST') => {
  const booted = boot(db);
  booted.handlers['identify'](name);
  await drain(db);
  return booted;
};

const sheet = async (username = 'GHOST') => JSON.parse((await get(db,
  `SELECT data FROM character_sheets WHERE username = ?`, [username])).data);

const bank = async (username = 'GHOST') =>
  get(db, 'SELECT balance FROM player_banks WHERE username = ?', [username]);

const result = (emitted) => [...emitted].reverse().find((e) => e.event === 'shopSale');
const waitResult = (emitted) =>
  untilValue(() => result(emitted), Boolean, { label: 'a shopSale reply' });

describe('selling something', () => {
  it('takes it off the sheet and puts the money in the bank', async () => {
    // Heavy Pistol is 200. At the default 45% that is 90.
    await seed({ weapon1_name: 'Heavy Pistol', weapon1_dmg: '1d8' });
    await fund('GHOST', 1000);
    const { handlers, emitted } = await identified();

    handlers['sellToShop']({
      locationId: gunShop,
      items: [{ catalogue: 'weapons', id: 'heavy_pistol', qty: 1 }],
    });

    const out = await waitResult(emitted);
    expect(out.data).toMatchObject({ ok: true, payout: 90 });
    expect((await bank()).balance).toBe(1090);
    // Both halves, or the player has been paid for a gun they still have.
    const after = await sheet();
    expect(after.weapon1_name).toBe('');
    expect(after.weapon1_dmg).toBe('');
  });

  it('broadcasts the new balance so the cash field follows', async () => {
    await seed({ weapon1_name: 'Heavy Pistol' });
    await fund('GHOST', 0);
    const { handlers, emitted } = await identified();
    handlers['sellToShop']({ locationId: gunShop, items: [{ catalogue: 'weapons', id: 'heavy_pistol', qty: 1 }] });
    await waitResult(emitted);

    const update = [...emitted].reverse().find((e) => e.event === 'bankUpdate');
    expect(update.data).toMatchObject({ username: 'GHOST', balance: 90 });
  });

  it('uses this shop\'s own rate over the global one', async () => {
    await run(db, 'UPDATE locations SET buyback_pct = 100 WHERE id = ?', [gunShop]);
    await run(db, `INSERT INTO global_settings (key, value) VALUES (?, '10')`, [BUYBACK_SETTING]);
    await seed({ weapon1_name: 'Heavy Pistol' });
    await fund('GHOST', 0);
    const { handlers, emitted } = await identified();
    handlers['sellToShop']({ locationId: gunShop, items: [{ catalogue: 'weapons', id: 'heavy_pistol', qty: 1 }] });

    expect((await waitResult(emitted)).data.payout).toBe(200);
  });

  it('sells several at once and pays for all of them', async () => {
    await seed({ weapon1_name: 'Heavy Pistol', weapon2_name: 'Rifle' });
    await fund('GHOST', 0);
    const { handlers, emitted } = await identified();
    handlers['sellToShop']({
      locationId: gunShop,
      items: [
        { catalogue: 'weapons', id: 'heavy_pistol', qty: 1 },
        { catalogue: 'weapons', id: 'rifle', qty: 1 },
      ],
    });

    // 200 and 1000 at 45% = 90 and 450.
    expect((await waitResult(emitted)).data.payout).toBe(90 + 450);
    const after = await sheet();
    expect(after.weapon1_name).toBe('');
    expect(after.weapon2_name).toBe('');
  });
});

describe('what it will not do', () => {
  it('pays nothing for a price the client made up', async () => {
    await seed({ weapon1_name: 'Heavy Pistol' });
    await fund('GHOST', 0);
    const { handlers, emitted } = await identified();
    handlers['sellToShop']({
      locationId: gunShop,
      items: [{ catalogue: 'weapons', id: 'heavy_pistol', qty: 1, price: 999999, each: 999999 }],
    });

    expect((await waitResult(emitted)).data.payout).toBe(90);
    expect((await bank()).balance).toBe(90);
  });

  it('refuses to sell something the player does not have', async () => {
    await seed({});
    await fund('GHOST', 500);
    const { handlers, emitted } = await identified();
    handlers['sellToShop']({ locationId: gunShop, items: [{ catalogue: 'weapons', id: 'heavy_pistol', qty: 1 }] });

    expect((await waitResult(emitted)).data).toMatchObject({ ok: false, reason: 'not_owned' });
    expect((await bank()).balance).toBe(500);
  });

  it('refuses a catalogue this shop does not deal in', async () => {
    // A gun shop does not buy chrome.
    await seed({ cyberware: [{ name: 'Cranial Jack', placed: true }] });
    await fund('GHOST', 0);
    const { handlers, emitted } = await identified();
    handlers['sellToShop']({ locationId: gunShop, items: [{ catalogue: 'cyberware', id: 'cranial-jack', qty: 1 }] });

    expect((await waitResult(emitted)).data).toMatchObject({ ok: false, reason: 'not_sold' });
    expect((await sheet()).cyberware).toHaveLength(1);
  });

  it('sells the seller\'s own goods, never a username in the message', async () => {
    await seed({ weapon1_name: 'Heavy Pistol' }, 'GHOST');
    await seed({ weapon1_name: 'Rifle' }, 'VICTIM');
    await fund('GHOST', 0);
    await fund('VICTIM', 0);
    const { handlers, emitted } = await identified('GHOST');

    handlers['sellToShop']({
      locationId: gunShop,
      username: 'VICTIM',
      items: [{ catalogue: 'weapons', id: 'heavy_pistol', qty: 1 }],
    });

    await waitResult(emitted);
    expect((await bank('GHOST')).balance).toBe(90);
    expect((await bank('VICTIM')).balance).toBe(0);
    expect((await sheet('VICTIM')).weapon1_name).toBe('Rifle');
  });

  it('does nothing for a socket that never identified', async () => {
    await seed({ weapon1_name: 'Heavy Pistol' });
    await fund('GHOST', 0);
    const { handlers, emitted } = boot(db);
    handlers['sellToShop']({ locationId: gunShop, items: [{ catalogue: 'weapons', id: 'heavy_pistol', qty: 1 }] });
    await drain(db);

    expect(result(emitted)).toBeUndefined();
    expect((await sheet()).weapon1_name).toBe('Heavy Pistol');
  });

  it('leaves the sheet alone when a basket fails part way', async () => {
    await seed({ weapon1_name: 'Heavy Pistol', weapon2_name: 'Rifle' });
    await fund('GHOST', 0);
    const { handlers, emitted } = await identified();
    handlers['sellToShop']({
      locationId: gunShop,
      items: [
        { catalogue: 'weapons', id: 'heavy_pistol', qty: 1 },
        { catalogue: 'weapons', id: 'rifle', qty: 9 },
      ],
    });

    expect((await waitResult(emitted)).data.ok).toBe(false);
    const after = await sheet();
    expect(after.weapon1_name).toBe('Heavy Pistol');
    expect(after.weapon2_name).toBe('Rifle');
    expect((await bank()).balance).toBe(0);
  });
});

describe('chrome out of a body', () => {
  it('says how many pieces were installed, so the window can warn', async () => {
    // The app does not model extraction surgery. The player has to be told.
    const r = await run(db,
      `INSERT INTO locations (name, x, y, z, shape, building_type) VALUES ('Doc', 0, 0, 0, 'box', 'ripperdoc')`);
    await seed({ cyberware: [{ name: 'Cranial Jack', placed: true }] });
    await fund('GHOST', 0);
    const { handlers, emitted } = await identified();
    handlers['sellToShop']({
      locationId: r.lastID,
      items: [{ catalogue: 'cyberware', id: 'cranial-jack', qty: 1 }],
    });

    const out = await waitResult(emitted);
    expect(out.data).toMatchObject({ ok: true, fromBody: 1 });
    expect((await sheet()).cyberware).toEqual([]);
  });
});
