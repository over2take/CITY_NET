// The builder's WORDS and FEATURES pages as logic (4b1a): a system's own words for the app's terms,
// which parts of the app it uses, its building and catalogue names, its currencies and its bank
// settings, read from its definition and written back. Pure, so the pages only draw it. Approved
// mockup docs/mockups/builder-words-features.html (2026-10-06).
//
// Anything left blank is the app's own (its word, its name: the page's placeholder) and is not
// stored, so a cleared box always falls back (the user, 2026-10-06). Whatever a system no longer
// sets is removed, down to the section, so an untouched system stays as small as it was. The server
// checks all of it (backend/systemBuilder: terms.js, parts.js, buildings.js, currencies.js, bank.js);
// the tests hold this module to those.

import type { Definition } from './systemsApi';
import { BUILT_IN_ICONS, isUploadedIcon, type Currency } from './currencies';
import type { Term, WordForm } from './words';
import { BUILDING_TYPES, CATALOGUES } from '../data/buildingTypes';

type Obj = Record<string, unknown>;
const isObject = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const section = (def: Definition, key: string): Obj => (isObject(def[key]) ? def[key] as Obj : {});

/** The definition with a section replaced, or removed when nothing is left in it. */
const withSection = (def: Definition, key: string, value: Obj | unknown[] | undefined): Definition => {
  const next: Definition = { ...def };
  const empty = value === undefined || (Array.isArray(value) ? value.length === 0 : Object.keys(value).length === 0);
  if (empty) delete next[key]; else next[key] = value;
  return next;
};

// ─── WORDS ──────────────────────────────────────────────────────────────────

export interface TermRow { id: Term; what: string; app: Partial<Record<WordForm, string>>; part?: string }

/** The app's terms in the page's groups, each with its own words (terms.js TERMS) and the part it belongs to. */
export const TERM_GROUPS: { label: string; terms: TermRow[] }[] = [
  { label: 'CHARACTERS', terms: [
    { id: 'character', what: 'The player\'s own', app: { singular: 'CHARACTER', plural: 'CHARACTERS' } },
    { id: 'class', what: 'What they are', app: { singular: 'CLASS', plural: 'CLASSES' } },
    { id: 'level', what: 'How far along', app: { singular: 'LEVEL', plural: 'LEVELS', short: 'LVL' } },
    { id: 'xp', what: 'What levels them up', app: { singular: 'XP', plural: 'XP', short: 'XP' } },
    { id: 'hp', what: 'Their health', app: { singular: 'HP', plural: 'HP', short: 'HP' } },
  ] },
  { label: 'MONEY', terms: [
    { id: 'money', what: 'What they pay with', app: { singular: 'CREDIT', plural: 'CREDITS', short: 'CR' }, part: 'bank' },
    { id: 'bank', what: 'Where it is kept', app: { singular: 'BANK', plural: 'BANKS' }, part: 'bank' },
    { id: 'shop', what: 'Where it is spent', app: { singular: 'SHOP', plural: 'SHOPS' }, part: 'shops' },
  ] },
  { label: 'PLAY', terms: [
    { id: 'initiative', what: 'Who acts first', app: { singular: 'INITIATIVE', plural: 'INITIATIVE', short: 'INIT' }, part: 'initiative' },
    { id: 'round', what: 'One pass of the order', app: { singular: 'ROUND', plural: 'ROUNDS' } },
    { id: 'turn', what: 'One character\'s go', app: { singular: 'TURN', plural: 'TURNS' } },
    { id: 'gm', what: 'Who runs the game', app: { singular: 'GM', plural: 'GMS', short: 'GM' } },
  ] },
  { label: 'VEHICLES', terms: [
    { id: 'vehicle', what: 'What they ride or drive', app: { singular: 'VEHICLE', plural: 'VEHICLES' }, part: 'vehicles' },
  ] },
];

/** The longest word the server takes (definition.js LIMITS.word). */
export const WORD_LIMIT = 40;

/** The system's own word for a term's form, or '' where it keeps the app's. */
export const wordOf = (def: Definition, term: Term, form: WordForm): string => {
  const forms = section(def, 'words')[term];
  const v = isObject(forms) ? forms[form] : undefined;
  return typeof v === 'string' ? v : '';
};

/** The definition with a term's form set, in capitals as the app shows its terms; blank removes it. */
export const withWord = (def: Definition, term: Term, form: WordForm, value: string): Definition => {
  const words = { ...section(def, 'words') };
  const forms = { ...(isObject(words[term]) ? words[term] as Obj : {}) };
  if (value.trim()) forms[form] = value.toUpperCase(); else delete forms[form];
  if (Object.keys(forms).length) words[term] = forms; else delete words[term];
  return withSection(def, 'words', words);
};

/** The definition with every form of a term back to the app's. */
export const withoutWord = (def: Definition, term: Term): Definition => {
  const words = { ...section(def, 'words') };
  delete words[term];
  return withSection(def, 'words', words);
};

/** A term as players will read it: "1 WOUND · 3 WOUNDS · WND". */
export const readsAs = (def: Definition, row: TermRow): string => {
  const w = (form: WordForm) => wordOf(def, row.id, form).trim() || row.app[form] || '';
  return [`1 ${w('singular')}`, `3 ${w('plural')}`, ...(row.app.short ? [w('short')] : [])].join(' · ');
};

// ─── FEATURES: the parts ────────────────────────────────────────────────────

export interface PartRow { id: string; label: string; what: string; unused?: true }

/**
 * The parts a system can turn off (parts.js PARTS), in the page's order. `unused` ones have no
 * rules a custom system can use yet: shown off and greyed until a later piece gives them some
 * (decided with the user, 2026-10-06).
 */
export const PART_ROWS: PartRow[] = [
  { id: 'bank', label: 'BANK', what: 'Money: the BANK window, pay and debt.' },
  { id: 'shops', label: 'SHOPS', what: 'Buildings that sell from catalogues, and the cart.' },
  { id: 'vehicles', label: 'VEHICLES', what: 'VEHICLES.EXE and vehicle sheets.' },
  { id: 'cyberware', label: 'CYBERWARE', what: 'Cyberware on the sheet, and its shelves.' },
  { id: 'initiative', label: 'INITIATIVE', what: 'The initiative tracker in combat.' },
  { id: 'combat', label: 'COMBAT', what: 'Attack and damage rolls from the sheet.' },
  { id: 'token_health', label: 'TOKEN HEALTH', what: 'The health monitor over each token.' },
  { id: 'npc_tiers', label: 'NPC TIERS', what: 'Tiers to pick when generating an NPC sheet.' },
  { id: 'xp', label: 'XP AWARDS', what: 'The GM awarding XP from the admin panel.', unused: true },
  { id: 'death', label: 'DEATH SAVES', what: 'Rolling against death when dying.', unused: true },
  { id: 'luck', label: 'LUCK', what: 'A pool of luck points to spend on rolls.', unused: true },
  { id: 'sheet_import', label: 'PDF IMPORT', what: 'Filling a sheet from a PDF.', unused: true },
];

/** Is a part on? Everything is, unless the system turns it off (parts.js partOn). */
export const partIsOn = (def: Definition, part: string): boolean => {
  const setting = section(def, 'parts')[part];
  return !(isObject(setting) && setting.on === false);
};

/** The definition with a part turned on (nothing stored) or off. */
export const withPart = (def: Definition, part: string, on: boolean): Definition => {
  const parts = { ...section(def, 'parts') };
  if (on) delete parts[part]; else parts[part] = { on: false };
  return withSection(def, 'parts', parts);
};

/** Is a term's part off, so its words have nothing to show? */
export const termPartOff = (def: Definition, row: TermRow): boolean => !!row.part && !partIsOn(def, row.part);

// ─── FEATURES: buildings and catalogues ─────────────────────────────────────

export type BuildingKind = 'types' | 'catalogues';
export interface BuildingSetting { name?: string; on?: boolean; currency?: string }

/** The app's shop types, its other buildings, and its catalogues, with the app's names. */
export const SHOP_TYPES = BUILDING_TYPES.filter((t) => t.shop).map((t) => ({ id: t.id, label: t.label }));
export const OTHER_TYPES = BUILDING_TYPES.filter((t) => !t.shop).map((t) => ({ id: t.id, label: t.label }));
export const CATALOGUE_ROWS = CATALOGUES.map((c) => ({ id: c.id, label: c.label }));
/** The longest name the server takes (buildings.js NAME_LIMIT). */
export const BUILDING_NAME_LIMIT = 40;

/** The catalogues a part takes with it when off (buildings.js CATALOGUE_PART). */
export const CATALOGUE_PART: Record<string, string> = {
  vehicles: 'vehicles', vehicle_fittings: 'vehicles', vehicle_weapons: 'vehicles',
  cyberware: 'cyberware', cyber_mods: 'cyberware', skillplugs: 'cyberware',
};

/** What a system sets for a building type or catalogue. */
export const buildingSetting = (def: Definition, kind: BuildingKind, id: string): BuildingSetting => {
  const entries = section(def, 'buildings')[kind];
  const s = isObject(entries) ? entries[id] : undefined;
  return isObject(s) ? s as BuildingSetting : {};
};

/** Is a catalogue's part off, so it can't be sold whatever it says? */
export const cataloguePartOff = (def: Definition, id: string): boolean => !!CATALOGUE_PART[id] && !partIsOn(def, CATALOGUE_PART[id]);

/**
 * The definition with a building type's or catalogue's setting changed. A blank name, `on`, and a
 * catalogue priced in the main currency are the app's way and are not stored.
 */
export const withBuilding = (def: Definition, kind: BuildingKind, id: string, patch: BuildingSetting): Definition => {
  const merged: BuildingSetting = { ...buildingSetting(def, kind, id), ...patch };
  const next: BuildingSetting = {};
  if (typeof merged.name === 'string' && merged.name.trim()) next.name = merged.name;
  if (merged.on === false) next.on = false;
  const main = currencyList(def)[0]?.id;
  if (kind === 'catalogues' && merged.currency && merged.currency !== main) next.currency = merged.currency;
  const buildings = { ...section(def, 'buildings') };
  const entries = { ...(isObject(buildings[kind]) ? buildings[kind] as Obj : {}) };
  if (Object.keys(next).length) entries[id] = next; else delete entries[id];
  if (Object.keys(entries).length) buildings[kind] = entries; else delete buildings[kind];
  return withSection(def, 'buildings', buildings);
};

// ─── FEATURES: currencies ───────────────────────────────────────────────────

/** A currency as the definition stores it (currencies.js). */
export interface StoredCurrency {
  id: string; name: string; short?: string; symbol?: string; symbolAfter?: boolean;
  decimals?: number; decimalMark?: '.' | ','; debt?: boolean; negative?: boolean;
  denominations?: { id: string; name: string; short?: string; value: number }[]; icon?: string;
}
export type CountedIn = 'whole' | 'decimals' | 'coins';
/** The server's limits (currencies.js LIMITS). */
export const CURRENCY_LIMITS = { currencies: 8, denominations: 8, name: 40, short: 8, symbol: 4, decimals: 4 } as const;

const CURRENCY_ID = /^[a-z][a-z0-9_]{0,31}$/;

/** The system's currencies as stored, the first the main one. */
export const currencyList = (def: Definition): StoredCurrency[] =>
  (Array.isArray(def.currencies) ? def.currencies.filter(isObject) as unknown as StoredCurrency[] : []);

/** How a currency is counted: in coins, with decimals, or in whole numbers. */
export const countedIn = (c: StoredCurrency): CountedIn =>
  (Array.isArray(c.denominations) ? 'coins' : c.decimals ? 'decimals' : 'whole');

/**
 * A currency as the game shows it, for the page's READS AS line: currencies.js currenciesOf's
 * shaping, which the frontend's formatAmount reads.
 */
export const shapeCurrency = (c: StoredCurrency): Currency => ({
  id: c.id,
  name: c.name,
  ...(typeof c.short === 'string' && c.short.trim() ? { short: c.short } : {}),
  ...(typeof c.symbol === 'string' && c.symbol.trim() ? { symbol: c.symbol, symbolAfter: c.symbolAfter === true } : {}),
  decimals: Number.isInteger(c.decimals) ? c.decimals! : 0,
  decimalMark: c.decimalMark === ',' ? ',' : '.',
  debt: c.debt === true,
  negative: c.negative === true,
  // Only a usable icon, as the server sends.
  ...((BUILT_IN_ICONS as readonly string[]).includes(c.icon as string) || isUploadedIcon(c.icon) ? { icon: c.icon } : {}),
  denominations: (Array.isArray(c.denominations) ? c.denominations : [])
    .filter(isObject)
    .map((d) => ({ id: d.id, name: d.name, ...(typeof d.short === 'string' && d.short.trim() ? { short: d.short } : {}), value: d.value }))
    .sort((a, b) => b.value - a.value),
});

/** A new id from a name, as the server allows and not already taken. */
export const currencyIdFor = (name: string, taken: string[], limit = 32): string => {
  let base = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, limit - 4);
  if (!/^[a-z]/.test(base)) base = `c${base}`.slice(0, limit - 4);
  let id = base;
  for (let n = 2; taken.includes(id); n += 1) id = `${base}_${n}`;
  return CURRENCY_ID.test(id) ? id : `c${taken.length + 1}`;
};

const withCurrencies = (def: Definition, list: StoredCurrency[]): Definition => withSection(def, 'currencies', list);

/** The definition with one more currency, counted in whole numbers until the GM says otherwise. */
export const withNewCurrency = (def: Definition, name = 'NEW CURRENCY'): Definition => {
  const list = currencyList(def);
  if (list.length >= CURRENCY_LIMITS.currencies) return def;
  return withCurrencies(def, [...list, { id: currencyIdFor(name, list.map((c) => c.id)), name }]);
};

/**
 * The definition without a currency. Catalogues priced in it go back to the main one, and
 * whale status, counted in the main currency, goes when the main one changes.
 */
export const withoutCurrency = (def: Definition, index: number): Definition => {
  const list = currencyList(def);
  const gone = list[index];
  if (!gone) return def;
  let next = withCurrencies(def, list.filter((_, i) => i !== index));
  next = dropCatalogueCurrency(next, gone.id);
  if (index === 0) next = withBank(next, { whale: undefined });
  return next;
};

/** The definition with a currency moved to first: the main one, the bank balance. */
export const withMainCurrency = (def: Definition, index: number): Definition => {
  const list = currencyList(def);
  if (index <= 0 || !list[index]) return def;
  const oldMain = list[0].id;
  const reordered = [list[index], ...list.filter((_, i) => i !== index)];
  let next = withCurrencies(def, reordered);
  // A catalogue on the old main now names it, so its prices don't move; one naming the new main
  // needn't any more.
  for (const c of CATALOGUE_ROWS) {
    const own = buildingSetting(def, 'catalogues', c.id).currency;
    if (own === undefined || own === list[index].id) next = withBuilding(next, 'catalogues', c.id, { currency: own === undefined ? oldMain : undefined });
  }
  // Whale status was counted in the old main currency.
  return withBank(next, { whale: undefined });
};

/** The definition with every catalogue priced in a currency back on the main one. */
const dropCatalogueCurrency = (def: Definition, currencyId: string): Definition => CATALOGUE_ROWS.reduce(
  (next, c) => (buildingSetting(next, 'catalogues', c.id).currency === currencyId ? withBuilding(next, 'catalogues', c.id, { currency: undefined }) : next),
  def,
);

/**
 * The definition with a currency's fields changed. Blank text fields and switches turned off are
 * left out, as the server reads them.
 */
export const withCurrency = (def: Definition, index: number, patch: Partial<StoredCurrency>): Definition => {
  const list = currencyList(def);
  const c = list[index];
  if (!c) return def;
  const next: StoredCurrency = { ...c, ...patch };
  for (const key of ['short', 'symbol', 'icon'] as const) if (typeof next[key] === 'string' && !next[key]!.trim()) delete next[key];
  for (const key of ['debt', 'negative', 'symbolAfter'] as const) if (next[key] !== true) delete next[key];
  if (next.decimalMark !== ',') delete next.decimalMark;
  if (!next.symbol) delete next.symbolAfter;
  return withCurrencies(def, list.map((x, i) => (i === index ? next : x)));
};

/**
 * The definition with a currency counted another way. Coins start as one coin worth 1, named
 * after the currency; decimals start at two places. A currency has coins or decimals, not both.
 */
export const withCountedIn = (def: Definition, index: number, how: CountedIn): Definition => {
  const c = currencyList(def)[index];
  if (!c || countedIn(c) === how) return def;
  const { denominations: _coins, decimals: _places, decimalMark: _mark, ...rest } = c;
  const next: StoredCurrency = how === 'coins'
    ? { ...rest, denominations: [{ id: currencyIdFor(c.short || c.name, []), name: c.name, ...(c.short ? { short: c.short } : {}), value: 1 }] }
    : how === 'decimals' ? { ...rest, decimals: 2 } : rest;
  const list = currencyList(def).map((x, i) => (i === index ? next : x));
  return withCurrencies(def, list);
};

/** The definition with a coin added (worth 10 of the currently largest), changed, or removed. */
export const withCoins = (def: Definition, index: number, change: { add: true } | { remove: number } | { edit: number; patch: Partial<{ name: string; short: string; value: number }> }): Definition => {
  const c = currencyList(def)[index];
  if (!c || !Array.isArray(c.denominations)) return def;
  let coins = [...c.denominations];
  if ('add' in change) {
    if (coins.length >= CURRENCY_LIMITS.denominations) return def;
    const largest = Math.max(1, ...coins.map((d) => d.value));
    coins = [{ id: currencyIdFor('coin', coins.map((d) => d.id)), name: 'NEW COIN', value: largest * 10 }, ...coins];
  } else if ('remove' in change) {
    if (coins.length <= 1) return def;
    coins = coins.filter((_, i) => i !== change.remove);
  } else {
    coins = coins.map((d, i) => {
      if (i !== change.edit) return d;
      const next = { ...d, ...change.patch };
      if (typeof next.short === 'string' && !next.short.trim()) delete next.short;
      return next;
    });
  }
  return withCurrencies(def, currencyList(def).map((x, i) => (i === index ? { ...x, denominations: coins } : x)));
};

// ─── FEATURES: the bank's celebrations ──────────────────────────────────────

/** The bank's settings (bank.js): celebrations off unless on; a whale threshold only while they are. */
export const bankSettings = (def: Definition): { celebrations: boolean; whale: number | null } => {
  const b = section(def, 'bank');
  const celebrations = b.celebrations === true;
  return { celebrations, whale: celebrations && Number.isSafeInteger(b.whale) && (b.whale as number) >= 1 ? b.whale as number : null };
};

/** The definition with the bank's settings changed. Off clears the threshold, which needs them on. */
export const withBank = (def: Definition, patch: { celebrations?: boolean; whale?: number | null }): Definition => {
  const b = { ...section(def, 'bank') };
  if (patch.celebrations !== undefined) b.celebrations = patch.celebrations;
  if ('whale' in patch) b.whale = patch.whale ?? undefined;
  const next: Obj = {};
  if (b.celebrations === true) {
    next.celebrations = true;
    if (Number.isSafeInteger(b.whale) && (b.whale as number) >= 1) next.whale = b.whale;
  }
  return withSection(def, 'bank', next);
};
