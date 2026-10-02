import { customTemplate, isCustomSystem } from './customTemplates';

// A custom system's own money in the browser (3c): its currencies, the first the main one, and
// an amount shown in coins. Mirrors backend/systemBuilder/currencies.js, which shapes the list
// the server sends (the render copy's `currencies`); the two are held to the same cases by a
// shared table (backend/__tests__/fixtures/currency-cases.json).
//
// A built-in system, or a custom one that defines none, has no list here: it keeps the app's
// own single money, shown as it always has been.

export interface Denomination {
  id: string;
  name: string;
  short?: string;
  /** What one is worth in the smallest coin, which is worth 1. */
  value: number;
}

export interface Currency {
  id: string;
  name: string;
  short?: string;
  /** Shown with the amount instead of the name: "$4.34", or after it with symbolAfter ("4.34 €"). */
  symbol?: string;
  symbolAfter?: boolean;
  /** Places after the point, for a currency without coins: 2 for dollars and cents. Amounts are
   *  whole numbers of the smallest unit (434 cents), so no rounding creeps in. */
  decimals: number;
  /** "." ("£1,234.56") or "," ("1.234,56 €", as much of Europe writes euros). */
  decimalMark: '.' | ',';
  /** May a player owe in this currency? Off unless the system turns it on. */
  debt: boolean;
  /** May a balance go below zero? Off unless the system turns it on. */
  negative: boolean;
  /** Largest first; empty for a currency without coins. */
  denominations: Denomination[];
}

/** The running system's currencies, the first the main one; empty where it has the app's money. */
export const currenciesFor = (system: string | null | undefined): Currency[] =>
  (isCustomSystem(system) ? customTemplate(system)?.currencies ?? [] : []);

/**
 * The currency a shop catalogue is priced in: the one the system named for it, its main currency
 * otherwise, or null where the system has the app's single money (decided with the user,
 * 2026-10-02). Mirrors backend/systemBuilder/buildings.js catalogueCurrency.
 */
export const catalogueCurrencyFor = (system: string | null | undefined, catalogue: string): Currency | null => {
  const list = currenciesFor(system);
  if (!list.length) return null;
  const own = isCustomSystem(system) ? customTemplate(system)?.buildings?.catalogues?.[catalogue]?.currency : undefined;
  return list.find((c) => c.id === own) ?? list[0];
};

/**
 * An amount in coins, largest first, leaving out the coins it has none of. Zero is one line of
 * the smallest coin; a currency without coins is one line of the amount, its decimals applied
 * (434 cents is 4.34). The sign is apart.
 */
export const splitAmount = (currency: Currency, amount: number): { negative: boolean; parts: { id: string; count: number }[] } => {
  // Every amount is a whole number of the smallest coin or unit.
  const n = Math.round(Number(amount) || 0);
  const coins = currency.denominations ?? [];
  if (!coins.length) return { negative: n < 0, parts: [{ id: currency.id, count: Math.abs(n) / 10 ** (currency.decimals ?? 0) }] };
  let left = Math.abs(n);
  const parts: { id: string; count: number }[] = [];
  for (const coin of coins) {
    const count = Math.floor(left / coin.value);
    left -= count * coin.value;
    if (count) parts.push({ id: coin.id, count });
  }
  if (!parts.length) parts.push({ id: coins[coins.length - 1].id, count: 0 });
  return { negative: n < 0, parts };
};

/** Coins back to one amount of the smallest. Unknown coins count for nothing. */
export const toBaseAmount = (currency: Currency, counts: Record<string, number>): number =>
  (currency.denominations ?? []).reduce((sum, coin) => {
    const count = Number(counts?.[coin.id]);
    return sum + (Number.isFinite(count) ? Math.round(count) : 0) * coin.value;
  }, 0);

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export type ParsedAmount = { ok: true; amount: number } | { ok: false; reason: 'empty' | 'not_a_number' | 'which_coin' | 'unknown_coin' | 'too_precise' };

/**
 * Read an amount as people write it into whole smallest units: "$4.34" is 434, "1.234,56 €" is
 * 123456, "2gp 5sp" is 250, "120 Honor" is 120, a leading "-" negative. A bare number in a
 * currency of several coins, misgrouped thousands ("4,34" is not $434) and more decimals than
 * the currency has are refused. Mirrors backend/systemBuilder/currencies.js parseAmount.
 */
export const parseAmount = (currency: Currency, input: string | number | null | undefined): ParsedAmount => {
  let text = String(input ?? '').trim();
  if (!text) return { ok: false, reason: 'empty' };
  let sign = 1;
  if (text.startsWith('-')) { sign = -1; text = text.slice(1).trim(); }
  const coins = currency.denominations ?? [];

  if (coins.length) {
    if (/^\d+$/.test(text)) {
      if (coins.length > 1) return { ok: false, reason: 'which_coin' };
      return { ok: true, amount: sign * Number(text) * coins[0].value };
    }
    const named = new Map<string, number>();
    for (const coin of coins) {
      named.set(coin.name.trim().toLowerCase(), coin.value);
      if (coin.short) named.set(coin.short.trim().toLowerCase(), coin.value);
    }
    let amount = 0;
    const lower = text.toLowerCase();
    let rest = lower;
    for (const match of lower.matchAll(/(\d+)\s*([^\d\s,]+(?:\s+[^\d\s,]+)*)/g)) {
      const value = named.get(match[2].trim());
      if (value === undefined) return { ok: false, reason: 'unknown_coin' };
      amount += Number(match[1]) * value;
      rest = rest.replace(match[0], '');
    }
    if (rest.replace(/[\s,]/g, '')) return { ok: false, reason: 'not_a_number' };
    return { ok: true, amount: sign * amount };
  }

  // Without coins: drop the symbol, and the name or short name written after the number.
  if (currency.symbol) text = text.split(currency.symbol).join(' ').trim();
  for (const word of [currency.name, currency.short]) {
    if (word) text = text.replace(new RegExp(`\\s*${escapeRegExp(word)}$`, 'i'), '').trim();
  }
  if (text.startsWith('-')) { sign = -sign; text = text.slice(1).trim(); }
  const mark = currency.decimalMark === ',' ? ',' : '.';
  const group = mark === ',' ? '.' : ',';
  const places = currency.decimals ?? 0;
  const [whole, fraction, extra] = text.split(mark);
  if (extra !== undefined || whole === undefined) return { ok: false, reason: 'not_a_number' };
  const grouped = whole.replace(/\s/g, group);
  const groupRe = new RegExp(`^\\d{1,3}(${escapeRegExp(group)}\\d{3})*$`);
  if (!/^\d+$/.test(grouped) && !groupRe.test(grouped)) return { ok: false, reason: 'not_a_number' };
  const digits = grouped.split(group).join('');
  if (fraction !== undefined) {
    if (!/^\d+$/.test(fraction)) return { ok: false, reason: 'not_a_number' };
    if (fraction.length > places) return { ok: false, reason: 'too_precise' };
  }
  const frac = (fraction ?? '').padEnd(places, '0');
  return { ok: true, amount: sign * (Number(digits) * 10 ** places + (places ? Number(frac) : 0)) };
};

/** A number with this currency's decimal mark: "1,234.56", or "1.234,56" with a comma. */
const numberIn = (currency: Currency, value: number): string => {
  const places = currency.decimals ?? 0;
  const written = value.toLocaleString('en-US', { minimumFractionDigits: places, maximumFractionDigits: places });
  return currency.decimalMark === ',' ? written.replace(/[.,]/g, (m) => (m === '.' ? ',' : '.')) : written;
};

/** An amount as text: "12 gp 3 sp 4 cp", "-5 gp", "$4.34", "-$1,234.56", "1.234,56 €", "120 Honor". */
export const formatAmount = (currency: Currency, amount: number): string => {
  const { negative, parts } = splitAmount(currency, amount);
  const sign = negative ? '-' : '';
  const coins = currency.denominations ?? [];
  if (!coins.length) {
    const number = numberIn(currency, parts[0].count);
    if (currency.symbol) return currency.symbolAfter ? `${sign}${number} ${currency.symbol}` : `${sign}${currency.symbol}${number}`;
    return `${sign}${number} ${currency.short || currency.name}`.trimEnd();
  }
  const label = (id: string) => { const coin = coins.find((c) => c.id === id); return coin ? coin.short || coin.name : ''; };
  return `${sign}${parts.map((p) => `${p.count} ${label(p.id)}`).join(' ')}`;
};
