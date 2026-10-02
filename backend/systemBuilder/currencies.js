// A system's own money (3c): any number of currencies, each with coins or decimals if it needs them.
//
//   currencies: [
//     { id: 'gold', name: 'Gold', short: 'gp', debt: true,
//       denominations: [{ id: 'gp', name: 'Gold', short: 'gp', value: 100 },
//                       { id: 'sp', name: 'Silver', short: 'sp', value: 10 },
//                       { id: 'cp', name: 'Copper', short: 'cp', value: 1 }] },
//     { id: 'dollars', name: 'Dollars', symbol: '$', decimals: 2 },
//     { id: 'euro', name: 'Euro', symbol: '€', symbolAfter: true, decimals: 2, decimalMark: ',' },
//     { id: 'honor', name: 'Honor' },
//   ]
//
// The first currency is the main one: it is the balance a player's bank account has always
// held (bank_accounts), so every existing balance already is the system's first currency and
// nothing is moved. Further currencies are kept apart (3c1b).
//
// Every amount is a whole number of a currency's smallest unit, so no rounding creeps in. With
// coins that is the coin worth 1: gold, silver and copper are one amount, shown split into
// coins. With decimals it is the smallest fraction: $4.34 is 434 cents, shown as "$4.34". The
// decimal mark is the system's to choose: a point ("£1,234.56") or a comma, as much of Europe
// writes euros ("1.234,56 €"). A currency has coins or decimals, not both. Currencies do not
// convert into each other.
//
// Debt and a balance below zero are each the GM's to allow, per currency, and off unless the
// system turns them on (decided with the user, 2026-10-02). A system that says nothing about
// currencies has the app's own single money, as every built-in system keeps (the user, same day).
//
// Pure: the definition checks, the running game and the browser (sheets/currencies.ts, which
// mirrors the shaping and formatting below) all use the same rules, held to the same cases by
// __tests__/fixtures/currency-cases.json.

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

const ID = /^[a-z][a-z0-9_]{0,31}$/;
const LIMITS = { currencies: 8, denominations: 8, name: 40, short: 8, symbol: 4, decimals: 4 };
const CURRENCY_KEYS = new Set(['id', 'name', 'short', 'symbol', 'symbolAfter', 'decimals', 'decimalMark', 'debt', 'negative', 'denominations', 'icon']);

/**
 * A currency's icon (3c2c, decided with the user 2026-10-01 and 2026-10-02): one of the five the
 * app's CURRENCY_ICON has always offered, or a small image the GM uploaded, named by its content
 * (routes/systems.js stores it). An uploaded one is only ever an address under /uploads, served with
 * the sandbox headers (middleware/uploadHeaders.js) and drawn through <img>, never inlined.
 */
const BUILT_IN_ICONS = ['credits', '$', '£', '€', '🪙'];
const UPLOADED_ICON = /^\/uploads\/currency_icons\/[0-9a-f]{64}\.(png|webp|svg)$/;
const isIcon = (icon) => typeof icon === 'string' && (BUILT_IN_ICONS.includes(icon) || UPLOADED_ICON.test(icon));
const DECIMAL_MARKS = ['.', ','];
const DENOMINATION_KEYS = new Set(['id', 'name', 'short', 'value']);

const text = (value, where, max, problems, { required = false } = {}) => {
  if (value === undefined || value === null) { if (required) problems.push({ where, message: 'Required' }); return; }
  if (typeof value !== 'string') { problems.push({ where, message: 'Must be text' }); return; }
  if (!value.trim()) problems.push({ where, message: 'Cannot be blank' });
  if (value.length > max) problems.push({ where, message: `Longer than ${max} characters` });
};

const checkDenominations = (list, where, problems) => {
  if (list === undefined) return;
  if (!Array.isArray(list) || !list.length) { problems.push({ where, message: 'Must be a list of coins' }); return; }
  if (list.length > LIMITS.denominations) problems.push({ where, message: `At most ${LIMITS.denominations} coins` });
  const ids = new Set();
  const values = new Set();
  list.forEach((d, i) => {
    const at = `${where} ${isPlainObject(d) && typeof d.id === 'string' ? d.id : i + 1}`;
    if (!isPlainObject(d)) { problems.push({ where: at, message: 'Must be a coin' }); return; }
    for (const key of Object.keys(d)) if (!DENOMINATION_KEYS.has(key)) problems.push({ where: `${at}, ${key}`, message: 'Not something a coin has' });
    if (typeof d.id !== 'string' || !ID.test(d.id)) problems.push({ where: at, message: 'Needs an id: lowercase letters, digits and _' });
    else if (ids.has(d.id)) problems.push({ where: at, message: 'Used twice' });
    else ids.add(d.id);
    text(d.name, `${at}, name`, LIMITS.name, problems, { required: true });
    text(d.short, `${at}, short`, LIMITS.short, problems);
    if (!Number.isInteger(d.value) || d.value < 1) problems.push({ where: `${at}, value`, message: 'Must be a whole number of the smallest coin, 1 or more' });
    else if (values.has(d.value)) problems.push({ where: `${at}, value`, message: 'Two coins cannot be worth the same' });
    else values.add(d.value);
  });
  if (!values.has(1)) problems.push({ where, message: 'One coin must be worth 1: the smallest, which amounts are counted in' });
};

/** Problems with a definition's `currencies` section, pushed onto `problems`. */
const checkCurrencies = (currencies, problems) => {
  if (currencies === undefined) return;
  if (!Array.isArray(currencies)) { problems.push({ where: 'currencies', message: 'Must be a list of currencies' }); return; }
  if (currencies.length > LIMITS.currencies) problems.push({ where: 'currencies', message: `At most ${LIMITS.currencies} currencies` });
  const ids = new Set();
  currencies.forEach((c, i) => {
    const where = `currencies ${isPlainObject(c) && typeof c.id === 'string' ? c.id : i + 1}`;
    if (!isPlainObject(c)) { problems.push({ where, message: 'Must be a currency' }); return; }
    for (const key of Object.keys(c)) if (!CURRENCY_KEYS.has(key)) problems.push({ where: `${where}, ${key}`, message: 'Not something a currency has' });
    if (typeof c.id !== 'string' || !ID.test(c.id)) problems.push({ where, message: 'Needs an id: lowercase letters, digits and _' });
    else if (ids.has(c.id)) problems.push({ where, message: 'Used twice' });
    else ids.add(c.id);
    text(c.name, `${where}, name`, LIMITS.name, problems, { required: true });
    text(c.short, `${where}, short`, LIMITS.short, problems);
    text(c.symbol, `${where}, symbol`, LIMITS.symbol, problems);
    if (c.decimals !== undefined && !(Number.isInteger(c.decimals) && c.decimals >= 0 && c.decimals <= LIMITS.decimals)) {
      problems.push({ where: `${where}, decimals`, message: `Must be a whole number from 0 to ${LIMITS.decimals}` });
    }
    if (c.decimals && c.denominations !== undefined) problems.push({ where, message: 'Has coins or decimals, not both' });
    if (c.decimalMark !== undefined && !DECIMAL_MARKS.includes(c.decimalMark)) problems.push({ where: `${where}, decimalMark`, message: 'Must be "." or ","' });
    for (const flag of ['debt', 'negative', 'symbolAfter']) {
      if (c[flag] !== undefined && typeof c[flag] !== 'boolean') problems.push({ where: `${where}, ${flag}`, message: 'Must be true or false' });
    }
    checkDenominations(c.denominations, `${where}, denominations`, problems);
    if (c.icon !== undefined && !isIcon(c.icon)) {
      problems.push({ where: `${where}, icon`, message: `Must be one of ${BUILT_IN_ICONS.join(' ')} or an uploaded icon` });
    }
  });
};

/**
 * A checked definition's currencies, as the game uses them: the debt and negative switches
 * filled in (off unless on), decimals 0 unless set, coins largest first. Empty for a system that
 * defines none, which then has the app's own single money.
 */
const currenciesOf = (definition) => {
  const list = definition && Array.isArray(definition.currencies) ? definition.currencies : [];
  return list.filter(isPlainObject).map((c) => ({
    id: c.id,
    name: c.name,
    ...(typeof c.short === 'string' && c.short.trim() ? { short: c.short } : {}),
    ...(typeof c.symbol === 'string' && c.symbol.trim() ? { symbol: c.symbol, symbolAfter: c.symbolAfter === true } : {}),
    decimals: Number.isInteger(c.decimals) ? c.decimals : 0,
    decimalMark: c.decimalMark === ',' ? ',' : '.',
    debt: c.debt === true,
    negative: c.negative === true,
    // Only a usable icon is sent; a currency without one shows its symbol or coins, as before.
    ...(isIcon(c.icon) ? { icon: c.icon } : {}),
    denominations: (Array.isArray(c.denominations) ? c.denominations : [])
      .filter(isPlainObject)
      .map((d) => ({ id: d.id, name: d.name, ...(typeof d.short === 'string' && d.short.trim() ? { short: d.short } : {}), value: d.value }))
      .sort((a, b) => b.value - a.value),
  }));
};

const coinsOf = (currency) => (currency && Array.isArray(currency.denominations) ? currency.denominations : []);
const placesOf = (currency) => (currency && Number.isInteger(currency.decimals) ? currency.decimals : 0);

/** A number with this currency's decimal mark: "1,234.56", or "1.234,56" with a comma. */
const numberIn = (currency, value) => {
  const places = placesOf(currency);
  const written = value.toLocaleString('en-US', { minimumFractionDigits: places, maximumFractionDigits: places });
  return currency && currency.decimalMark === ',' ? written.replace(/[.,]/g, (m) => (m === '.' ? ',' : '.')) : written;
};

/**
 * An amount in coins, largest first, leaving out the coins it has none of: 1234 copper is
 * 12 gold, 3 silver, 4 copper. Zero is one line of the smallest coin. A currency without coins
 * is one line of the amount, its decimals applied (434 cents is 4.34). The sign is kept apart:
 * a debt shows its coins positive.
 */
const splitAmount = (currency, amount) => {
  // Every amount is a whole number of the smallest coin or unit.
  const n = Math.round(Number(amount) || 0);
  const coins = coinsOf(currency);
  if (!coins.length) return { negative: n < 0, parts: [{ id: currency ? currency.id : '', count: Math.abs(n) / 10 ** placesOf(currency) }] };
  let left = Math.abs(n);
  const parts = [];
  for (const coin of coins) {
    const count = Math.floor(left / coin.value);
    left -= count * coin.value;
    if (count) parts.push({ id: coin.id, count });
  }
  if (!parts.length) parts.push({ id: coins[coins.length - 1].id, count: 0 });
  return { negative: n < 0, parts };
};

/** Coins back to one amount of the smallest: { gp: 12, sp: 3, cp: 4 } is 1234. Unknown coins count for nothing. */
const toBaseAmount = (currency, counts) => coinsOf(currency).reduce((sum, coin) => {
  const count = Number(counts && counts[coin.id]);
  return sum + (Number.isFinite(count) ? Math.round(count) : 0) * coin.value;
}, 0);

/** An amount as text: "12 gp 3 sp 4 cp", "-5 gp", "$4.34", "-$1,234.56", "1.234,56 €", "120 Honor". */
const formatAmount = (currency, amount) => {
  const { negative, parts } = splitAmount(currency, amount);
  const sign = negative ? '-' : '';
  const coins = coinsOf(currency);
  if (!coins.length) {
    const number = numberIn(currency, parts[0].count);
    if (currency && currency.symbol) return currency.symbolAfter ? `${sign}${number} ${currency.symbol}` : `${sign}${currency.symbol}${number}`;
    return `${sign}${number} ${(currency && (currency.short || currency.name)) || ''}`.trimEnd();
  }
  const label = (id) => { const coin = coins.find((c) => c.id === id); return coin ? coin.short || coin.name : ''; };
  return `${sign}${parts.map((p) => `${p.count} ${label(p.id)}`).join(' ')}`;
};

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Read an amount as a GM or player writes it (3c2a4b) into whole smallest units: "$4.34" and
 * "4.34" are 434, "1.234,56 €" is 123456 with a comma for the decimal mark, "2gp 5sp" or
 * "2 Gold, 5 Silver" is 250, "120 Honor" is 120. A leading "-" makes it negative.
 *
 * Written as people read amounts, not in the smallest unit (decided with the user,
 * 2026-10-02). So a bare number in a currency of several coins is refused ("15" could be
 * copper or gold), thousands separators must group by three ("4,34" is not $434), and more
 * decimals than the currency has are refused rather than rounded.
 *
 * Returns { ok: true, amount } or { ok: false, reason }: 'empty', 'not_a_number',
 * 'which_coin', 'unknown_coin', 'too_precise'.
 */
const parseAmount = (currency, input) => {
  let text = String(input === undefined || input === null ? '' : input).trim();
  if (!text) return { ok: false, reason: 'empty' };
  let sign = 1;
  if (text.startsWith('-')) { sign = -1; text = text.slice(1).trim(); }
  const coins = coinsOf(currency);

  if (coins.length) {
    if (/^\d+$/.test(text)) {
      if (coins.length > 1) return { ok: false, reason: 'which_coin' };
      return { ok: true, amount: sign * Number(text) * coins[0].value };
    }
    const named = new Map();
    for (const coin of coins) {
      named.set(coin.name.trim().toLowerCase(), coin.value);
      if (coin.short) named.set(coin.short.trim().toLowerCase(), coin.value);
    }
    let amount = 0;
    let rest = text.toLowerCase();
    const part = /(\d+)\s*([^\d\s,]+(?:\s+[^\d\s,]+)*)/g;
    let match;
    while ((match = part.exec(text.toLowerCase())) !== null) {
      const value = named.get(match[2].trim());
      if (value === undefined) return { ok: false, reason: 'unknown_coin' };
      amount += Number(match[1]) * value;
      rest = rest.replace(match[0], '');
    }
    if (rest.replace(/[\s,]/g, '')) return { ok: false, reason: 'not_a_number' };
    return { ok: true, amount: sign * amount };
  }

  // Without coins: drop the symbol, and the name or short name written after the number.
  if (currency && currency.symbol) text = text.split(currency.symbol).join(' ').trim();
  for (const word of [currency && currency.name, currency && currency.short]) {
    if (word) text = text.replace(new RegExp(`\\s*${escapeRegExp(word)}$`, 'i'), '').trim();
  }
  if (text.startsWith('-')) { sign = -sign; text = text.slice(1).trim(); }
  const mark = currency && currency.decimalMark === ',' ? ',' : '.';
  const group = mark === ',' ? '.' : ',';
  const places = placesOf(currency);
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
  const frac = (fraction || '').padEnd(places, '0');
  return { ok: true, amount: sign * (Number(digits) * 10 ** places + (places ? Number(frac) : 0)) };
};

module.exports = { checkCurrencies, currenciesOf, splitAmount, toBaseAmount, formatAmount, parseAmount, LIMITS, BUILT_IN_ICONS, isIcon };
