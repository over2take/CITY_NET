import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { currenciesFor, catalogueCurrencyFor, splitAmount, toBaseAmount, formatAmount, type Currency } from '../currencies';
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

  it('split amounts into coins and back', () => {
    for (const c of CASES.split) {
      expect(splitAmount(byId(c.currency), c.amount), `${c.currency} ${c.amount}`).toEqual({ negative: c.negative, parts: c.parts });
    }
    for (const c of CASES.toBase) expect(toBaseAmount(byId(c.currency), c.counts), JSON.stringify(c.counts)).toBe(c.amount);
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
