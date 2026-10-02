/**
 * Shops under custom systems (3b3a). A published custom system has shops, as the generic sheet
 * does: what it buys and sells is an inventory line, from what its GM uploaded. It can turn its
 * shops off, and with the bank off it has none either (decided with the user, 2026-10-01).
 * Every built-in system keeps the shops it has.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import { createRequire } from 'module';
import { makeTestDb, get, run } from './helpers/testDb.js';
import { drain } from './helpers/until.js';
import locationsRouteFactory from '../routes/locations.js';

process.env.JWT_SECRET = 'test-secret';
const ADMIN = jwt.sign({ id: 1, username: 'gm', role: 'admin', isTemporary: false }, 'test-secret');

const require_ = createRequire(import.meta.url);
const runtime = require_('../systemBuilder/runtime');
const { shopsOpen, knowsSheet } = require_('../shops/availability');
const { planSale } = require_('../shops/sell');
const owned = require_('../shops/owned');
const store = require_('../shops/catalogueStore');
const socketsFactory = (await import('../sockets/index.js')).default;

const BUILT_INS = ['cities_without_number', 'cyberpunk_red', 'shadowrun_6e', 'generic'];
const OPEN = 'sys_aaaaaaaaaaaaaaaa';
const NOSHOPS = 'sys_bbbbbbbbbbbbbbbb';
const NOBANK = 'sys_cccccccccccccccc';
const NOBANK_SHOPS_ON = 'sys_dddddddddddddddd';
const DRAFT_ONLY = 'sys_eeeeeeeeeeeeeeee';

const def = (parts) => JSON.stringify({ format: 1, name: 'Hearth', ...(parts ? { parts } : {}) });

let db;
beforeEach(async () => {
  db = await makeTestDb();
  const rows = [
    [OPEN, def(), def()],
    [NOSHOPS, def({ shops: { on: false } }), def({ shops: { on: false } })],
    [NOBANK, def({ bank: { on: false } }), def({ bank: { on: false } })],
    [NOBANK_SHOPS_ON, def({ bank: { on: false }, shops: { on: true } }), def({ bank: { on: false }, shops: { on: true } })],
    [DRAFT_ONLY, def(), null],
  ];
  for (const [id, draft, published] of rows) {
    await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', [id, id, draft, published]);
  }
  await new Promise((resolve) => runtime.load(db, resolve));
});
afterEach(() => store.clear());

const setSystem = (system) =>
  run(db, `INSERT OR REPLACE INTO global_settings (key, value) VALUES ('game_system', ?)`, [system]);

describe('which systems have shops', () => {
  it('every built-in system, as before', () => {
    for (const system of BUILT_INS) expect(shopsOpen(system), system).toBe(true);
  });

  it('a published custom system, unless it turned shops or the bank off', () => {
    expect(shopsOpen(OPEN)).toBe(true);
    expect(shopsOpen(NOSHOPS)).toBe(false);
    expect(shopsOpen(NOBANK)).toBe(false);
    // Shops on cannot outvote the bank: a shop has nothing to trade in.
    expect(shopsOpen(NOBANK_SHOPS_ON)).toBe(false);
  });

  it('not a system the server does not know, or one never published', () => {
    for (const system of ['dnd_5e', '', undefined, DRAFT_ONLY]) expect(shopsOpen(system), String(system)).toBe(false);
    expect(knowsSheet(OPEN)).toBe(true);
    expect(knowsSheet(DRAFT_ONLY)).toBe(false);
  });
});

describe('building types', () => {
  const app = () => {
    const a = express();
    a.use(express.json());
    a.use('/api/locations', locationsRouteFactory(db, { emit: () => {} }, { emitUpdate: () => {}, recordAction: () => {} }));
    return a;
  };
  const tryAll = async (system) => {
    await setSystem(system);
    const { lastID } = await run(db, `INSERT INTO locations (name, x, y, z, shape) VALUES ('Stall', 0, 0, 0, 'box')`);
    const set = await request(app()).patch(`/api/locations/${lastID}/building-type`)
      .set('Authorization', `Bearer ${ADMIN}`).send({ building_type: 'general_store' });
    const list = await request(app()).get('/api/locations/building-types');
    const stored = (await get(db, 'SELECT building_type FROM locations WHERE id = ?', [lastID])).building_type;
    return { set: set.status, list: list.status, stored };
  };

  it('can be set and listed under a custom system with shops', async () => {
    expect(await tryAll(OPEN)).toEqual({ set: 200, list: 200, stored: 'general_store' });
  });

  it('are refused under a custom system without them', async () => {
    for (const system of [NOSHOPS, NOBANK, NOBANK_SHOPS_ON]) {
      expect(await tryAll(system), system).toEqual({ set: 409, list: 409, stored: null });
    }
  });
});

describe('the checkout', () => {
  let nextSocket = 0;
  const checkout = async (system) => {
    await setSystem(system);
    const sent = [];
    let connect;
    socketsFactory({ on: (e, cb) => { if (e === 'connection') connect = cb; }, emit: () => {}, to: () => ({ emit: () => {} }) },
      db, { elevatedUsers: new Set(), emitUpdate: vi.fn(), recordAction: vi.fn() });
    const handlers = {};
    connect({ id: `shop-sock-${(nextSocket += 1)}`, on: (e, fn) => { handlers[e] = fn; }, emit: (event, data) => sent.push({ event, data }),
      broadcast: { emit: () => {} }, use: () => {}, join: () => {} });
    handlers.identify('GHOST');
    await drain(db);
    handlers.checkoutShop({ locationId: 999, buys: [] });
    await drain(db);
    return sent.find((e) => e.event === 'shopCheckout').data.reason;
  };

  it('says a custom system without shops has none', async () => {
    expect(await checkout(NOSHOPS)).toBe('no_shops');
    // The bank is asked first, so a system with neither says why money cannot move.
    expect(await checkout(NOBANK)).toBe('no_bank');
  });

  it('goes on to the shop itself under a custom system with shops', async () => {
    // Location 999 does not exist, so the next thing it says is that there is no shop there.
    expect(await checkout(OPEN)).toBe('no_shop');
    expect(await checkout('generic')).toBe('no_shop');
  });
});

describe('selling from a custom system\'s sheet', () => {
  it('sells inventory lines, which is all it has, as on the generic sheet', () => {
    store.load(OPEN, { gear: [{ id: 'rope', name: 'Rope', price: 20 }] });
    const data = { inventory: JSON.stringify([{ name: 'Rope', qty: 2 }]), weapon1_name: 'Rope' };
    const sell = (qty) => planSale({ data, items: [{ catalogue: 'gear', id: 'rope', qty }], catalogues: ['gear'],
      locationPct: null, globalPct: null, system: OPEN });
    // Two owned, not three: weapon1_name is not a slot on a custom sheet.
    expect(sell(3)).toMatchObject({ ok: false, reason: 'not_owned' });
    const out = sell(2);
    expect(out).toMatchObject({ ok: true, payout: 18 });
    expect(JSON.parse(out.patch[owned.INVENTORY_FIELD])).toEqual([]);
  });

  it('still refuses a system it does not know the sheet of', () => {
    for (const system of ['dnd_5e', DRAFT_ONLY]) {
      expect(planSale({ data: {}, items: [{ catalogue: 'gear', id: 'rope', qty: 1 }], catalogues: ['gear'],
        locationPct: null, globalPct: null, system }), system).toMatchObject({ ok: false, reason: 'no_system' });
    }
  });
});
