/**
 * The WORDS and FEATURES pages as logic (4b1a). Approved mockup builder-words-features (2026-10-06):
 * blank is the app's own and is never stored; unused parts shown off; building names under SHOPS.
 * Held to the server's own rules (backend/systemBuilder), which check and run what is written.
 */
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import {
  TERM_GROUPS, wordOf, withWord, withoutWord, readsAs, PART_ROWS, partIsOn, withPart, termPartOff,
  SHOP_TYPES, OTHER_TYPES, CATALOGUE_ROWS, CATALOGUE_PART, buildingSetting, cataloguePartOff, withBuilding,
  currencyList, countedIn, shapeCurrency, currencyIdFor, withNewCurrency, withoutCurrency, withMainCurrency, withCurrency,
  withCountedIn, withCoins, bankSettings, withBank, CURRENCY_LIMITS, type StoredCurrency,
} from '../wordsFeatures';
import { formatAmount } from '../currencies';
import type { Definition } from '../systemsApi';

const req = createRequire(import.meta.url);
const { TERMS } = req('../../../../backend/systemBuilder/terms.js');
const { PARTS, partOn } = req('../../../../backend/systemBuilder/parts.js');
const { buildingOn, catalogueCurrency } = req('../../../../backend/systemBuilder/buildings.js');
const { currenciesOf } = req('../../../../backend/systemBuilder/currencies.js');
const { bankOf } = req('../../../../backend/systemBuilder/bank.js');
const { checkDefinition } = req('../../../../backend/systemBuilder/definition.js');
const { BUILDING_TYPES, CATALOGUES } = req('../../../../backend/buildingTypes.js');

const HEARTH: Definition = { format: 1, name: 'Hearth' };
const problems = (def: Definition) => checkDefinition(def).problems;

describe('held to the server', () => {
  it('names every term with the app\'s own words', () => {
    const rows = TERM_GROUPS.flatMap((g) => g.terms);
    expect(Object.fromEntries(rows.map((r) => [r.id, r.app]))).toEqual(TERMS);
  });

  it('lists every part, marking the four with no rules for a custom system yet', () => {
    expect(PART_ROWS.map((p) => p.id).sort()).toEqual([...PARTS].sort());
    expect(PART_ROWS.filter((p) => p.unused).map((p) => p.id)).toEqual(['xp', 'death', 'luck', 'sheet_import']);
  });

  it('reads a part on or off as the server does, whatever a file says', () => {
    for (const setting of [undefined, { on: false }, { on: true }, {}, { on: 'no' }, false, 'off']) {
      const def = { ...HEARTH, parts: { bank: setting } };
      expect(partIsOn(def, 'bank'), JSON.stringify(setting)).toBe(partOn(def, 'bank'));
    }
  });

  it('lists every building type and catalogue the app has', () => {
    expect([...SHOP_TYPES, ...OTHER_TYPES].map((t) => t.id).sort()).toEqual(BUILDING_TYPES.map((t: { id: string }) => t.id).sort());
    expect(CATALOGUE_ROWS.map((c) => c.id)).toEqual(CATALOGUES.map((c: { id: string }) => c.id));
  });

  it('takes a catalogue off with its part exactly as the server does', () => {
    for (const part of ['vehicles', 'cyberware']) {
      const def = withPart(HEARTH, part, false);
      for (const c of CATALOGUE_ROWS) expect(!cataloguePartOff(def, c.id), `${part} ${c.id}`).toBe(buildingOn(def, 'catalogues', c.id));
    }
    expect(Object.keys(CATALOGUE_PART).every((id) => CATALOGUE_ROWS.some((c) => c.id === id))).toBe(true);
  });

  it('reads a currency as the game shows it', () => {
    const def: Definition = { ...HEARTH, currencies: [
      { id: 'gold', name: 'Gold', short: ' ', debt: true, denominations: [{ id: 'cp', name: 'Copper', value: 1 }, { id: 'gp', name: 'Gold', short: 'gp', value: 100 }] },
      { id: 'euro', name: 'Euro', symbol: '€', symbolAfter: true, decimals: 2, decimalMark: ',', icon: '€' },
      { id: 'favor', name: 'Favor', icon: 'https://example.com/x.png', negative: 'yes' },
    ] };
    expect(currencyList(def).map(shapeCurrency)).toEqual(currenciesOf(def));
  });

  it('reads the bank\'s settings as the server does', () => {
    for (const bank of [undefined, {}, { celebrations: true }, { celebrations: true, whale: 50000 }, { celebrations: false, whale: 5 }, { celebrations: true, whale: 0 }]) {
      expect(bankSettings({ ...HEARTH, ...(bank ? { bank } : {}) }), JSON.stringify(bank)).toEqual(bankOf({ ...HEARTH, bank }));
    }
  });
});

describe('WORDS', () => {
  const hp = TERM_GROUPS[0].terms.find((t) => t.id === 'hp')!;

  it('sets a word in capitals, and blank goes back to the app\'s, down to nothing stored', () => {
    let def = withWord(HEARTH, 'hp', 'singular', 'wound');
    def = withWord(def, 'hp', 'plural', 'Wounds');
    expect(def.words).toEqual({ hp: { singular: 'WOUND', plural: 'WOUNDS' } });
    expect(wordOf(def, 'hp', 'singular')).toBe('WOUND');
    expect(wordOf(def, 'hp', 'short')).toBe('');
    expect(problems(def)).toEqual([]);
    def = withWord(def, 'hp', 'singular', '   ');
    expect(def.words).toEqual({ hp: { plural: 'WOUNDS' } });
    def = withWord(def, 'hp', 'plural', '');
    expect(def).toEqual(HEARTH);
    expect(withoutWord(withWord(withWord(HEARTH, 'hp', 'short', 'wnd'), 'xp', 'short', 'exp'), 'hp').words).toEqual({ xp: { short: 'EXP' } });
    expect(withoutWord(withWord(HEARTH, 'hp', 'short', 'wnd'), 'hp')).toEqual(HEARTH);
  });

  it('reads a term as players will, the app\'s word where none is set', () => {
    expect(readsAs(HEARTH, hp)).toBe('1 HP · 3 HP · HP');
    expect(readsAs(withWord(withWord(HEARTH, 'hp', 'singular', 'wound'), 'hp', 'plural', 'wounds'), hp)).toBe('1 WOUND · 3 WOUNDS · HP');
    const round = TERM_GROUPS[2].terms.find((t) => t.id === 'round')!;
    expect(readsAs(HEARTH, round)).toBe('1 ROUND · 3 ROUNDS');
  });

  it('knows a term whose part is off', () => {
    const vehicle = TERM_GROUPS[3].terms[0];
    expect(termPartOff(HEARTH, vehicle)).toBe(false);
    expect(termPartOff(withPart(HEARTH, 'vehicles', false), vehicle)).toBe(true);
    expect(termPartOff(withPart(HEARTH, 'vehicles', false), hp)).toBe(false);
  });
});

describe('FEATURES: parts', () => {
  it('turns a part off, and on again leaves nothing stored', () => {
    const off = withPart(HEARTH, 'vehicles', false);
    expect(off.parts).toEqual({ vehicles: { on: false } });
    expect(partIsOn(off, 'vehicles')).toBe(false);
    expect(partIsOn(off, 'bank')).toBe(true);
    expect(problems(off)).toEqual([]);
    expect(withPart(off, 'vehicles', true)).toEqual(HEARTH);
    expect(withPart(withPart(off, 'shops', false), 'vehicles', true).parts).toEqual({ shops: { on: false } });
  });
});

describe('FEATURES: buildings and catalogues', () => {
  it('renames and turns off, storing only what differs from the app', () => {
    let def = withBuilding(HEARTH, 'types', 'ripperdoc', { name: 'Temple' });
    def = withBuilding(def, 'types', 'corp', { on: false });
    expect(def.buildings).toEqual({ types: { ripperdoc: { name: 'Temple' }, corp: { on: false } } });
    expect(buildingSetting(def, 'types', 'ripperdoc')).toEqual({ name: 'Temple' });
    expect(problems(def)).toEqual([]);
    def = withBuilding(def, 'types', 'ripperdoc', { name: '  ' });
    def = withBuilding(def, 'types', 'corp', { on: true });
    expect(def).toEqual(HEARTH);
  });

  it('prices a catalogue in another currency, and in the main one by storing nothing', () => {
    let def = withNewCurrency(withNewCurrency(HEARTH, 'Gold'), 'Favor');
    def = withBuilding(def, 'catalogues', 'cyberware', { currency: 'favor', name: 'Relics' });
    expect(buildingSetting(def, 'catalogues', 'cyberware')).toEqual({ name: 'Relics', currency: 'favor' });
    expect(catalogueCurrency(def, 'cyberware')).toBe('favor');
    expect(problems(def)).toEqual([]);
    def = withBuilding(def, 'catalogues', 'cyberware', { currency: 'gold' });
    expect(buildingSetting(def, 'catalogues', 'cyberware')).toEqual({ name: 'Relics' });
  });
});

describe('FEATURES: currencies', () => {
  const gold = (): Definition => withNewCurrency(HEARTH, 'Gold');

  it('adds currencies with ids of their own, up to eight', () => {
    let def = gold();
    def = withNewCurrency(def, 'Gold');
    expect(currencyList(def).map((c) => c.id)).toEqual(['gold', 'gold_2']);
    for (let i = 0; i < 10; i += 1) def = withNewCurrency(def);
    expect(currencyList(def)).toHaveLength(CURRENCY_LIMITS.currencies);
    expect(problems(def)).toEqual([]);
    expect(currencyIdFor('2 Bits!', [])).toBe('c2_bits');
    expect(currencyIdFor('', [])).toBe('c');
    expect(currencyIdFor('A'.repeat(50), []).length).toBeLessThanOrEqual(32);
  });

  it('removes one, putting its catalogues back on the main currency', () => {
    let def = withNewCurrency(gold(), 'Favor');
    def = withBuilding(def, 'catalogues', 'weapons', { currency: 'favor', name: 'Arms' });
    def = withoutCurrency(def, 1);
    expect(currencyList(def).map((c) => c.id)).toEqual(['gold']);
    expect(buildingSetting(def, 'catalogues', 'weapons')).toEqual({ name: 'Arms' });
    expect(withoutCurrency(def, 0)).toEqual({ ...HEARTH, buildings: { catalogues: { weapons: { name: 'Arms' } } } });
    expect(withoutCurrency(def, 5)).toBe(def);
  });

  it('removing the main currency clears whale status, which was counted in it', () => {
    let def = withBank(withNewCurrency(gold(), 'Favor'), { celebrations: true, whale: 500 });
    def = withoutCurrency(def, 0);
    expect(bankSettings(def)).toEqual({ celebrations: true, whale: null });
    expect(problems(def)).toEqual([]);
  });

  it('makes another the main one, keeping every catalogue\'s prices where they were', () => {
    let def = withNewCurrency(withNewCurrency(gold(), 'Favor'), 'Scrip');
    def = withBuilding(def, 'catalogues', 'armor', { currency: 'favor' });
    def = withBuilding(def, 'catalogues', 'gear', { currency: 'scrip' });
    def = withBank(def, { celebrations: true, whale: 500 });
    const before = Object.fromEntries(CATALOGUE_ROWS.map((c) => [c.id, catalogueCurrency(def, c.id)]));
    def = withMainCurrency(def, 1);
    expect(currencyList(def).map((c) => c.id)).toEqual(['favor', 'gold', 'scrip']);
    expect(Object.fromEntries(CATALOGUE_ROWS.map((c) => [c.id, catalogueCurrency(def, c.id)]))).toEqual(before);
    expect(buildingSetting(def, 'catalogues', 'armor')).toEqual({});
    expect(bankSettings(def).whale).toBeNull();
    expect(problems(def)).toEqual([]);
    expect(withMainCurrency(def, 0)).toBe(def);
  });

  it('changes a currency\'s fields, leaving out blanks and switches turned off', () => {
    let def = withCurrency(gold(), 0, { short: 'gp', symbol: '₲', symbolAfter: true, debt: true, negative: false, decimalMark: ',' });
    expect(currencyList(def)[0]).toEqual({ id: 'gold', name: 'Gold', short: 'gp', symbol: '₲', symbolAfter: true, debt: true, decimalMark: ',' });
    def = withCurrency(def, 0, { short: ' ', symbol: '', debt: false, decimalMark: '.' });
    expect(currencyList(def)[0]).toEqual({ id: 'gold', name: 'Gold' });
    expect(withCurrency(def, 3, { name: 'x' })).toBe(def);
  });

  it('counts a currency in whole numbers, decimals or coins, never two at once', () => {
    let def = gold();
    expect(countedIn(currencyList(def)[0])).toBe('whole');
    def = withCountedIn(def, 0, 'decimals');
    expect(currencyList(def)[0]).toEqual({ id: 'gold', name: 'Gold', decimals: 2 });
    expect(formatAmount(shapeCurrency(currencyList(withCurrency(def, 0, { symbol: '$' }))[0]), 123456)).toBe('$1,234.56');
    def = withCountedIn(withCurrency(def, 0, { decimalMark: ',' }), 0, 'coins');
    expect(currencyList(def)[0]).toEqual({ id: 'gold', name: 'Gold', denominations: [{ id: 'gold', name: 'Gold', value: 1 }] });
    expect(countedIn(currencyList(def)[0])).toBe('coins');
    expect(problems(def)).toEqual([]);
    def = withCountedIn(def, 0, 'whole');
    expect(currencyList(def)[0]).toEqual({ id: 'gold', name: 'Gold' });
    expect(withCountedIn(def, 0, 'whole')).toBe(def);
  });

  it('adds, edits and removes coins, keeping at least one', () => {
    let def = withCountedIn(withCurrency(gold(), 0, { short: 'cp' }), 0, 'coins');
    def = withCoins(def, 0, { add: true });
    def = withCoins(def, 0, { add: true });
    const coins = () => currencyList(def)[0].denominations!;
    expect(coins().map((d) => d.value)).toEqual([100, 10, 1]);
    def = withCoins(def, 0, { edit: 0, patch: { name: 'Gold', short: 'gp' } });
    def = withCoins(def, 0, { edit: 1, patch: { name: 'Silver', short: 'sp' } });
    def = withCoins(def, 0, { edit: 2, patch: { name: 'Copper' } });
    expect(formatAmount(shapeCurrency(currencyList(def)[0]), 1234)).toBe('12 gp 3 sp 4 cp');
    expect(problems(def)).toEqual([]);
    def = withCoins(def, 0, { edit: 1, patch: { short: '' } });
    expect('short' in coins()[1]).toBe(false);
    def = withCoins(withCoins(def, 0, { remove: 0 }), 0, { remove: 0 });
    expect(coins()).toHaveLength(1);
    expect(withCoins(def, 0, { remove: 0 })).toBe(def);
    for (let i = 0; i < 10; i += 1) def = withCoins(def, 0, { add: true });
    expect(coins()).toHaveLength(CURRENCY_LIMITS.denominations);
    expect(withCoins(gold(), 0, { add: true })).toEqual(gold());
  });

  it('every step keeps the definition one the server accepts', () => {
    let def = withNewCurrency(gold(), 'Euro');
    def = withCountedIn(def, 1, 'decimals');
    def = withCurrency(def, 1, { symbol: '€', symbolAfter: true, decimalMark: ',', icon: '€' });
    def = withCountedIn(def, 0, 'coins');
    def = withCoins(def, 0, { add: true });
    def = withBuilding(def, 'catalogues', 'gear', { currency: 'euro' });
    def = withBank(def, { celebrations: true, whale: 1000 });
    expect(problems(def)).toEqual([]);
    expect((currencyList(def) as StoredCurrency[]).map(shapeCurrency)).toEqual(currenciesOf(def));
  });
});

describe('FEATURES: the bank\'s celebrations', () => {
  it('turns them on with a whale threshold, and off takes the threshold too', () => {
    let def = withBank(HEARTH, { celebrations: true });
    expect(def.bank).toEqual({ celebrations: true });
    def = withBank(def, { whale: 50000 });
    expect(bankSettings(def)).toEqual({ celebrations: true, whale: 50000 });
    expect(problems(def)).toEqual([]);
    def = withBank(def, { whale: null });
    expect(def.bank).toEqual({ celebrations: true });
    def = withBank(withBank(def, { whale: 7 }), { celebrations: false });
    expect(def).toEqual(HEARTH);
    expect(withBank(HEARTH, { whale: 5 })).toEqual(HEARTH);
    expect(withBank(def, { celebrations: true, whale: 0 }).bank).toEqual({ celebrations: true });
  });
});
