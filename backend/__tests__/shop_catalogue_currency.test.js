/**
 * Catalogue prices in a custom system's currencies (3c2a4d). A GM writes a price as people read
 * it in the catalogue's currency ("15gp", "2gp 5sp", "$4.34", "1.234,56"), and it is stored as
 * whole smallest units, the preview saying how each was read (decided with the user,
 * 2026-10-02). What could be misread is refused with a reason. Everywhere else, prices are read
 * as they always were (shop_catalogue_sockets.test.js holds that).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import jwt from 'jsonwebtoken';
import { createRequire } from 'module';
import { makeTestDb, get, run } from './helpers/testDb.js';
import { drain, untilValue } from './helpers/until.js';

process.env.JWT_SECRET = 'test-secret';

const require_ = createRequire(import.meta.url);
const runtime = require_('../systemBuilder/runtime');
const { currenciesOf } = require_('../systemBuilder/currencies');
const { parseCatalogue } = require_('../shops/catalogueParse');
const store = require_('../shops/catalogueStore');
const socketsFactory = (await import('../sockets/index.js')).default;

const HEARTH = 'sys_aaaaaaaaaaaaaaaa';
const CURRENCIES = [
  { id: 'gold', name: 'Gold', denominations: [{ id: 'gp', name: 'Gold', short: 'gp', value: 100 }, { id: 'sp', name: 'Silver', short: 'sp', value: 10 }, { id: 'cp', name: 'Copper', short: 'cp', value: 1 }] },
  { id: 'dollars', name: 'Dollars', symbol: '$', decimals: 2 },
  { id: 'euro', name: 'Euro', symbol: '€', symbolAfter: true, decimals: 2, decimalMark: ',' },
];
const [GOLD, DOLLARS, EURO] = currenciesOf({ currencies: CURRENCIES });
const IN = { weapons: GOLD, gear: DOLLARS, armor: EURO };
const options = { currencyOf: (catalogue) => IN[catalogue] || null };

describe('reading a catalogue\'s prices in its currency', () => {
  it('reads coins, symbols, decimals and a comma mark into whole smallest units, saying how', () => {
    const parsed = parseCatalogue([
      '[weapons]', 'name; price', 'Sword; 15gp', 'Dagger; 2gp 5sp', 'Club; 0 cp',
      '[gear]', 'name; price', 'Rope; $4.34', 'Lamp; 12',
      '[armor]', 'name; price', 'Mail; 1.234,56 €',
    ].join('\n'), options);
    expect(parsed.problems).toEqual([]);
    const rows = Object.fromEntries(Object.entries(parsed.sections).map(([c, list]) => [c, list.map((e) => [e.name, e.price, e.read])]));
    expect(rows).toEqual({
      weapons: [['Sword', 1500, '15 gp'], ['Dagger', 250, '2 gp 5 sp'], ['Club', 0, '0 cp']],
      gear: [['Rope', 434, '$4.34'], ['Lamp', 1200, '$12.00']],
      armor: [['Mail', 123456, '1.234,56 €']],
    });
  });

  it('refuses what could be misread, and says why', () => {
    const parsed = parseCatalogue([
      '[weapons]', 'name; price', 'Stick; 15', 'Rock; 2 pp', 'Bad; -5 gp',
      '[gear]', 'name; price', 'Pin; 4.345', 'Odd; 4,34', 'Nothing;',
    ].join('\n'), options);
    // Every row refused: each catalogue is left empty, as the parser always leaves one.
    expect(parsed.sections).toEqual({ weapons: [], gear: [] });
    expect(parsed.problems.map((p) => p.message)).toEqual([
      'price "15" needs a coin, like 15 gp',
      'price "2 pp" names a coin Gold does not have',
      'price "-5 gp" is below zero',
      'price "4.345" has more decimals than Dollars has (2)',
      'price "4,34" is not a number',
      'price "" is not a number',
    ]);
  });

  it('reads a JSON catalogue the same way', () => {
    const parsed = parseCatalogue(JSON.stringify({ weapons: [{ name: 'Sword', price: '15gp' }], gear: [{ name: 'Rope', price: 4.34 }] }), options);
    expect(parsed.problems).toEqual([]);
    expect(parsed.sections.weapons[0]).toMatchObject({ price: 1500, read: '15 gp' });
    expect(parsed.sections.gear[0]).toMatchObject({ price: 434, read: '$4.34' });
  });

  it('reads prices as always without a currency, and says nothing of how', () => {
    const parsed = parseCatalogue(['[gear]', 'name; price', 'Rope; $4.34', 'Lamp; 1,200'].join('\n'));
    expect(parsed.sections.gear.map((e) => [e.price, e.read])).toEqual([[4.34, undefined], [1200, undefined]]);
  });
});

describe('the catalogue window\'s preview and save', () => {
  let db;
  let nextSocket = 0;
  beforeEach(async () => {
    store.clear();
    db = await makeTestDb();
    await run(db, `CREATE TABLE IF NOT EXISTS shop_catalogues (
      system TEXT NOT NULL, catalogue TEXT NOT NULL, id TEXT NOT NULL,
      name TEXT NOT NULL, price REAL NOT NULL DEFAULT 0, fields TEXT NOT NULL DEFAULT '{}',
      PRIMARY KEY (system, catalogue, id))`);
    const text = JSON.stringify({ format: 1, name: 'Hearth', currencies: CURRENCIES, buildings: { catalogues: { gear: { currency: 'dollars' } } } });
    await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', [HEARTH, 'Hearth', text, text]);
    await new Promise((resolve) => runtime.load(db, resolve));
  });

  const gm = async (system) => {
    await run(db, `INSERT OR REPLACE INTO global_settings (key, value) VALUES ('game_system', ?)`, [system]);
    const sent = [];
    let connect;
    socketsFactory({ on: (e, cb) => { if (e === 'connection') connect = cb; }, emit: () => {}, to: () => ({ emit: () => {} }) },
      db, { elevatedUsers: new Set(), emitUpdate: vi.fn(), recordAction: vi.fn() });
    const handlers = {};
    connect({ id: `cat-cur-${(nextSocket += 1)}`, on: (e, fn) => { handlers[e] = fn; }, emit: (event, data) => sent.push({ event, data }),
      broadcast: { emit: () => {} }, use: () => {}, join: () => {} });
    handlers.identify({ userName: 'GM', isAdmin: true, token: jwt.sign({ id: 1, username: 'GM', role: 'admin', isTemporary: false }, 'test-secret') });
    await drain(db);
    return { handlers, sent };
  };
  const TEXT = ['[weapons]', 'name; price', 'Sword; 15gp', '[gear]', 'name; price', 'Rope; $4.34'].join('\n');

  it('previews each price as it was read in its catalogue\'s currency', async () => {
    const { handlers, sent } = await gm(HEARTH);
    handlers.previewCatalogue({ text: TEXT });
    const preview = (await untilValue(() => sent.find((e) => e.event === 'cataloguePreview'), Boolean, { label: 'the preview' })).data;
    expect(preview.problems).toEqual([]);
    expect(preview.sections.weapons[0]).toMatchObject({ name: 'Sword', price: 1500, read: '15 gp' });
    expect(preview.sections.gear[0]).toMatchObject({ name: 'Rope', price: 434, read: '$4.34' });
  });

  it('stores whole smallest units', async () => {
    // One catalogue per save: a file of several fails to save today, whatever the system
    // (found 2026-10-02, its own fix).
    for (const text of [['[weapons]', 'name; price', 'Sword; 15gp'], ['[gear]', 'name; price', 'Rope; $4.34']]) {
      const { handlers, sent } = await gm(HEARTH);
      handlers.saveCatalogue({ text: text.join('\n') });
      expect((await untilValue(() => sent.find((e) => e.event === 'catalogueSaved'), Boolean, { label: 'the save' })).data.ok).toBe(true);
    }
    expect(await get(db, "SELECT price FROM shop_catalogues WHERE system = ? AND id = 'sword'", [HEARTH])).toEqual({ price: 1500 });
    expect(await get(db, "SELECT price FROM shop_catalogues WHERE system = ? AND id = 'rope'", [HEARTH])).toEqual({ price: 434 });
  });

  it('reads them as always under a built-in system', async () => {
    const { handlers, sent } = await gm('cyberpunk_red');
    handlers.previewCatalogue({ text: ['[gear]', 'name; price', 'Rope; $4.34'].join('\n') });
    const preview = (await untilValue(() => sent.find((e) => e.event === 'cataloguePreview'), Boolean, { label: 'the preview' })).data;
    expect(preview.sections.gear[0]).toMatchObject({ price: 4.34 });
    expect(preview.sections.gear[0].read).toBeUndefined();
  });
});
