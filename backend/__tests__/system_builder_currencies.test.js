/**
 * A system's own currencies (3c1a): the format and its rules, on the server. The shaping and
 * formatting cases are shared with the browser's copy (fixtures/currency-cases.json), so the
 * two give the same answers. Nothing uses currencies yet: the bank keeps one balance per
 * system until 3c1b, and every built-in system keeps the app's single money (the user,
 * 2026-10-02).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import sqlite3 from 'sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const require_ = createRequire(import.meta.url);
const { checkDefinition } = require_('../systemBuilder/definition');
const { currenciesOf, splitAmount, toBaseAmount, formatAmount, parseAmount } = require_('../systemBuilder/currencies');
const runtime = require_('../systemBuilder/runtime');

const here = path.dirname(fileURLToPath(import.meta.url));
const CASES = JSON.parse(fs.readFileSync(path.join(here, 'fixtures/currency-cases.json'), 'utf8'));
const byId = (id) => CASES.normalized.find((c) => c.id === id);

const where = (currencies) => checkDefinition({ format: 1, name: 'A', currencies }).problems.map((p) => p.where);
const messages = (currencies) => checkDefinition({ format: 1, name: 'A', currencies }).problems.map((p) => `${p.where}: ${p.message}`);

describe('the currencies section', () => {
  it('takes coins, decimals, symbols, decimal marks and the debt and negative switches', () => {
    expect(where(CASES.definition)).toEqual([]);
    expect(where(undefined)).toEqual([]);
    expect(where([])).toEqual([]);
  });

  it('names each currency it cannot take', () => {
    expect(where('gold')).toEqual(['currencies']);
    expect(where(['gold'])).toEqual(['currencies 1']);
    expect(where([{ id: 'Gold', name: 'Gold' }])).toEqual(['currencies Gold']);
    expect(where([{ id: 'gold', name: 'Gold' }, { id: 'gold', name: 'Again' }])).toEqual(['currencies gold']);
    expect(where([{ id: 'gold' }])).toEqual(['currencies gold, name']);
    expect(where([{ id: 'gold', name: '  ' }])).toEqual(['currencies gold, name']);
    expect(where([{ id: 'gold', name: 'x'.repeat(41) }])).toEqual(['currencies gold, name']);
    expect(where([{ id: 'gold', name: 'Gold', short: 'x'.repeat(9) }])).toEqual(['currencies gold, short']);
    expect(where([{ id: 'gold', name: 'Gold', symbol: 'GOLD!' }])).toEqual(['currencies gold, symbol']);
    expect(where([{ id: 'gold', name: 'Gold', rate: 2 }])).toEqual(['currencies gold, rate']);
    expect(where(Array.from({ length: 9 }, (_, i) => ({ id: `c${i}`, name: `C${i}` })))).toEqual(['currencies']);
  });

  it('holds the switches to true or false, the decimals to 0 to 4, and the mark to a point or a comma', () => {
    expect(where([{ id: 'g', name: 'G', debt: 'yes' }])).toEqual(['currencies g, debt']);
    expect(where([{ id: 'g', name: 'G', negative: 1 }])).toEqual(['currencies g, negative']);
    expect(where([{ id: 'g', name: 'G', symbolAfter: 'after' }])).toEqual(['currencies g, symbolAfter']);
    expect(where([{ id: 'g', name: 'G', decimals: 5 }])).toEqual(['currencies g, decimals']);
    expect(where([{ id: 'g', name: 'G', decimals: 1.5 }])).toEqual(['currencies g, decimals']);
    expect(where([{ id: 'g', name: 'G', decimals: 4 }])).toEqual([]);
    expect(where([{ id: 'g', name: 'G', decimalMark: ' ' }])).toEqual(['currencies g, decimalMark']);
  });

  it('wants coins or decimals, not both', () => {
    expect(messages([{ id: 'g', name: 'G', decimals: 2, denominations: [{ id: 'c', name: 'C', value: 1 }] }]))
      .toEqual(['currencies g: Has coins or decimals, not both']);
    expect(where([{ id: 'g', name: 'G', decimals: 0, denominations: [{ id: 'c', name: 'C', value: 1 }] }])).toEqual([]);
  });

  it('wants whole coins of distinct worth, one of them worth 1', () => {
    const coins = (denominations) => where([{ id: 'g', name: 'G', denominations }]);
    expect(coins([])).toEqual(['currencies g, denominations']);
    expect(coins([{ id: 'gp', name: 'Gold', value: 100 }])).toEqual(['currencies g, denominations']);
    expect(coins([{ id: 'cp', name: 'Copper', value: 1 }, { id: 'sp', name: 'Silver', value: 1 }])).toEqual(['currencies g, denominations sp, value']);
    expect(coins([{ id: 'cp', name: 'Copper', value: 1 }, { id: 'cp', name: 'Again', value: 10 }])).toEqual(['currencies g, denominations cp']);
    expect(coins([{ id: 'cp', name: 'Copper', value: 1 }, { id: 'sp', name: 'Silver', value: 2.5 }])).toEqual(['currencies g, denominations sp, value']);
    expect(coins([{ id: 'cp', name: 'Copper', value: 1 }, { id: 'sp', name: 'Silver', value: 0 }])).toEqual(['currencies g, denominations sp, value']);
    expect(coins([{ id: 'cp', value: 1 }])).toEqual(['currencies g, denominations cp, name']);
    expect(coins([{ id: 'cp', name: 'C', value: 1, weight: 3 }])).toEqual(['currencies g, denominations cp, weight']);
    expect(coins(Array.from({ length: 9 }, (_, i) => ({ id: `c${i}`, name: `C${i}`, value: i + 1 })))).toEqual(['currencies g, denominations']);
  });
});

describe('a currency\'s icon (3c2c1)', () => {
  const HASH = 'a'.repeat(64);
  const icon = (value) => [{ id: 'gold', name: 'Gold', icon: value }];

  it('is one of the five the app has always offered, or an icon the GM uploaded', () => {
    for (const ok of ['credits', '$', '£', '€', '🪙', `/uploads/currency_icons/${HASH}.png`, `/uploads/currency_icons/${HASH}.webp`, `/uploads/currency_icons/${HASH}.svg`]) {
      expect(where(icon(ok)), ok).toEqual([]);
      expect(currenciesOf({ currencies: icon(ok) })[0].icon, ok).toBe(ok);
    }
  });

  it('is refused as anything else: another folder, another type, a name, or not text', () => {
    const refused = [
      'gold.png', '¥', `/uploads/currency_icons/${'a'.repeat(63)}.png`, `/uploads/currency_icons/${'A'.repeat(64)}.png`,
      `/uploads/battle_maps/${HASH}.png`, `/uploads/currency_icons/${HASH}.gif`, `/uploads/currency_icons/${HASH}.svg?x=1`,
      `https://example.com/uploads/currency_icons/${HASH}.png`, `/uploads/currency_icons/../${HASH}.png`, '', 42, null, { upload: HASH },
    ];
    for (const bad of refused) {
      expect(messages(icon(bad)), String(bad)).toEqual(['currencies gold, icon: Must be one of credits $ £ € 🪙 or an uploaded icon']);
      // Never sent to a browser, even from a draft holding it.
      expect(currenciesOf({ currencies: icon(bad) })[0], String(bad)).not.toHaveProperty('icon');
    }
  });

  it('is absent where a currency has none, which shows its symbol or coins as before', () => {
    expect(currenciesOf({ currencies: [{ id: 'gold', name: 'Gold' }] })[0]).not.toHaveProperty('icon');
  });
});

describe('the rules, shared with the browser', () => {
  it('fill in the switches (off unless on) and sort the coins, largest first', () => {
    expect(currenciesOf({ currencies: CASES.definition })).toEqual(CASES.normalized);
    expect(currenciesOf({ name: 'A' })).toEqual([]);
  });

  it('write each amount as the system would', () => {
    for (const c of CASES.format) expect(formatAmount(byId(c.currency), c.amount), `${c.currency} ${c.amount}`).toBe(c.text);
  });

  it('read an amount as people write it, and refuse what could be misread (3c2a4b)', () => {
    for (const c of CASES.parse) expect(parseAmount(byId(c.currency), c.text), `${c.currency} ${c.text}`).toEqual({ ok: true, amount: c.amount });
    for (const c of CASES.parseRefused) expect(parseAmount(byId(c.currency), c.text), `${c.currency} ${c.text}`).toEqual({ ok: false, reason: c.reason });
  });

  it('read back what they write', () => {
    for (const c of CASES.format) {
      if (c.amount !== Math.round(c.amount)) continue;
      expect(parseAmount(byId(c.currency), c.text), c.text).toEqual({ ok: true, amount: c.amount });
    }
  });

  it('split amounts into coins and back', () => {
    for (const c of CASES.split) {
      expect(splitAmount(byId(c.currency), c.amount), `${c.currency} ${c.amount}`).toEqual({ negative: c.negative, parts: c.parts });
    }
    for (const c of CASES.toBase) expect(toBaseAmount(byId(c.currency), c.counts), JSON.stringify(c.counts)).toBe(c.amount);
  });
});

describe('the running game', () => {
  const ID = 'sys_aaaaaaaaaaaaaaaa';
  const run = (db, sql, p = []) => new Promise((res, rej) => db.run(sql, p, function (e) { e ? rej(e) : res(this); }));
  beforeEach(async () => {
    const db = new sqlite3.Database(':memory:');
    await run(db, 'CREATE TABLE custom_systems (id TEXT PRIMARY KEY, name TEXT, draft TEXT, published TEXT, version INTEGER, deleted_at DATETIME)');
    const text = JSON.stringify({ format: 1, name: 'Hearth', currencies: CASES.definition });
    await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', [ID, 'Hearth', text, text]);
    await new Promise((resolve) => runtime.load(db, resolve));
  });

  it('knows a custom system\'s currencies, the first the main one, and sends them to the browser', () => {
    expect(runtime.currenciesIn(ID)).toEqual(CASES.normalized);
    expect(runtime.currenciesIn(ID)[0].id).toBe('gold');
    expect(runtime.render(ID).currencies).toEqual(CASES.normalized);
  });

  it('sends each currency\'s icon with it', async () => {
    const db = new sqlite3.Database(':memory:');
    await run(db, 'CREATE TABLE custom_systems (id TEXT PRIMARY KEY, name TEXT, draft TEXT, published TEXT, version INTEGER, deleted_at DATETIME)');
    const upload = `/uploads/currency_icons/${'b'.repeat(64)}.svg`;
    const text = JSON.stringify({ format: 1, name: 'Hearth', currencies: [{ id: 'gold', name: 'Gold', icon: upload }, { id: 'favor', name: 'Favor', icon: '🪙' }] });
    await run(db, 'INSERT INTO custom_systems (id, name, draft, published, version) VALUES (?, ?, ?, ?, 1)', [ID, 'Hearth', text, text]);
    await new Promise((resolve) => runtime.load(db, resolve));
    expect(runtime.render(ID).currencies.map((c) => c.icon)).toEqual([upload, '🪙']);
  });

  it('gives every built-in system none, so each keeps the app\'s single money', () => {
    for (const system of ['cities_without_number', 'cyberpunk_red', 'shadowrun_6e', 'generic', 'sys_bbbbbbbbbbbbbbbb']) {
      expect(runtime.currenciesIn(system), system).toEqual([]);
    }
  });
});
