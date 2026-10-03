import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { createRequire } from 'module';
import {
  currenciesFor, catalogueCurrencyFor, splitAmount, toBaseAmount, formatAmount, parseAmount, BUILT_IN_ICONS, isUploadedIcon, type Currency,
} from '../currencies';
import { registerCustomTemplate, clearCustomTemplates } from '../customTemplates';

/**
 * A custom system's own money in the browser (3c1a). Held to the same cases as the server's
 * rules (backend/__tests__/fixtures/currency-cases.json), so both write an amount the same way.
 */

const CASES = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../../../../backend/__tests__/fixtures/currency-cases.json'), 'utf8'));
const byId = (id: string): Currency => CASES.normalized.find((c: Currency) => c.id === id);

describe('the rules, shared with the server', () => {
  it('write each amount as the system would', () => {
    for (const c of CASES.format) expect(formatAmount(byId(c.currency), c.amount), `${c.currency} ${c.amount}`).toBe(c.text);
  });

  it('read an amount as people write it, and refuse what could be misread', () => {
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

describe('a currency\'s icon, as the server allows it (3c2c3)', () => {
  const server = createRequire(import.meta.url)('../../../../backend/systemBuilder/currencies.js');

  it('is one of the same five icons', () => {
    expect([...BUILT_IN_ICONS]).toEqual(server.BUILT_IN_ICONS);
  });

  it('is an uploaded icon exactly where the server says so', () => {
    const hash = 'a'.repeat(64);
    const cases = [
      `/uploads/currency_icons/${hash}.png`, `/uploads/currency_icons/${hash}.webp`, `/uploads/currency_icons/${hash}.svg`,
      `/uploads/currency_icons/${hash}.gif`, `/uploads/currency_icons/${'A'.repeat(64)}.png`, `/uploads/battle_maps/${hash}.png`,
      `https://example.com/uploads/currency_icons/${hash}.png`, `/uploads/currency_icons/${hash}.svg?x`, '$', 'credits', '', 42, null,
    ];
    for (const icon of cases) {
      const uploaded = typeof icon === 'string' && !server.BUILT_IN_ICONS.includes(icon) && server.isIcon(icon);
      expect(isUploadedIcon(icon), String(icon)).toBe(uploaded);
    }
    expect(isUploadedIcon(`/uploads/currency_icons/${hash}.svg`)).toBe(true);
  });
});

describe('the running system\'s currencies', () => {
  const HEARTH = 'sys_aaaaaaaaaaaaaaaa';
  beforeEach(() => {
    clearCustomTemplates();
    registerCustomTemplate({ id: HEARTH, name: 'Hearth', parts: {}, derived: [], sheet: { sections: [] }, words: {}, currencies: CASES.normalized });
  });
  afterEach(() => clearCustomTemplates());

  it('are a custom system\'s own, the first the main one', () => {
    expect(currenciesFor(HEARTH)).toEqual(CASES.normalized);
    expect(currenciesFor(HEARTH)[0].id).toBe('gold');
  });

  it('price each catalogue in the currency the system named for it, and the main one otherwise (3c2a2)', () => {
    registerCustomTemplate({ id: HEARTH, name: 'Hearth', parts: {}, derived: [], sheet: { sections: [] }, words: {},
      currencies: CASES.normalized, buildings: { catalogues: { cyberware: { currency: 'honor' }, gear: { name: 'Supplies' } } } });
    expect(catalogueCurrencyFor(HEARTH, 'cyberware')?.id).toBe('honor');
    expect(catalogueCurrencyFor(HEARTH, 'gear')?.id).toBe('gold');
    expect(catalogueCurrencyFor(HEARTH, 'weapons')?.id).toBe('gold');
    for (const system of ['cities_without_number', 'generic', 'sys_bbbbbbbbbbbbbbbb']) expect(catalogueCurrencyFor(system, 'gear'), system).toBeNull();
  });

  it('are none for a built-in system, or a custom one not loaded, which keep the app\'s money', () => {
    for (const system of ['cities_without_number', 'cyberpunk_red', 'shadowrun_6e', 'generic', 'sys_bbbbbbbbbbbbbbbb', null, undefined]) {
      expect(currenciesFor(system), String(system)).toEqual([]);
    }
  });
});
