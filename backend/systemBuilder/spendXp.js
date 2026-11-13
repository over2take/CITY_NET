// SPEND XP (7f2; approved mockup docs/mockups/ranks-and-xp.html, 2026-11-12): XP as money, spent from a price list
// the GM sets on the LEVELS page, for systems whose setup question answers SPEND XP (core.advancement 'spend').
//
//   spend: {
//     buys: [
//       { id: 'skills_up', what: 'stat', stats: 'skills', cost: '@new * 5', most: 5 },  // RAISE A STAT IN a group, COSTS, UP TO
//       { id: 'feats', what: 'option', list: 'feats', cost: '10' },                      // AN OPTION FROM a list, COSTS
//     ],
//     wait: true,   // PURCHASES WAIT FOR THE GM; off when unsaid
//   }
//
// RAISE A STAT raises one of a group's stats (every stat's, `stats` unsaid) by one: its cost a formula reading @old, the
// stat as it is, and @new, as it will be, and any other name a formula can. UP TO stops a number there; a stat held as
// a rank (7f1) goes up a step a time, to its top rank, @old and @new its steps. AN OPTION FROM buys a pick from a list
// that isn't levelled (a class goes up by LEVEL UP), never one held already, its requirement met.
//
// XP is kept as awarded (levels.js XP_KEY), never lowered by spending, so a level reached by XP is never lost.
//
// Buying (7f2a2): every purchase goes in the sheet's ledger under SPENT_KEY, a name no field can have and a player's own
// edits can't reach: [{ n, buy, what, target, from?, to?, cost, by, at, state }], `by` 'gm' or 'player', `at` when, in ms,
// `state` DONE, PENDING (waiting for the GM: its XP held, nothing raised yet), UNDONE or DECLINED. XP unspent is what was
// awarded less what is done or waiting. A stat bought is written up a step, a rank's as its step's text as its picker
// writes it; an option bought is a pick of its list marked `bought` with its purchase's number, always counting and
// locked, as a rolled pick is, so only the GM takes it away. The GM's UNDO takes a purchase back and gives its XP back;
// APPROVE makes a waiting one, checked again on the sheet as it is then; DECLINE gives its XP back. A GM's own purchase
// never waits.
//
// Pure: checks, reads, and the sheet a purchase leaves.

const { parse, evaluate, references } = require('./expression');
const { ruleValue } = require('./rules');
const { tablesOf, lookupIn } = require('./derived');
const { rankedStatsOf, stepFieldOf, rankNameAt } = require('./ranks');
const { choicesOf, heldOf, effectiveData, meets, needsText, namesOf, ownableOf, PICKS_KEY } = require('./choices');
const { XP_KEY } = require('./levels');
const { partOn } = require('./parts');
const { wordFor } = require('./terms');

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);
const ID = /^[a-z][a-z0-9_]{0,63}$/;

const LIMITS = { buys: 20, cost: 1000, most: 1000000, ledger: 1000 };
/** Where a sheet keeps its purchases (7f2a2). */
const SPENT_KEY = '_spent';
/** What a purchase can be: made, waiting for the GM, taken back by the GM, or turned down. */
const STATES = ['done', 'pending', 'undone', 'declined'];
const KEYS = new Set(['buys', 'wait']);
const BUY_KEYS = { stat: new Set(['id', 'what', 'stats', 'cost', 'most']), option: new Set(['id', 'what', 'list', 'cost']) };
/** What XP can buy: RAISE A STAT, AN OPTION. */
const WHATS = ['stat', 'option'];
/** The names a RAISE A STAT's cost reads besides the sheet's: the stat as it is and as it will be. */
const OWN_NAMES = ['old', 'new'];

/** A group's stats, or every stat's with no group named: [{ id, label, rank? }]. */
const statsIn = (definition, group) => list(definition && definition.stats)
  .filter((g) => isPlainObject(g) && Array.isArray(g.stats) && (group === undefined || g.id === group))
  .flatMap((g) => g.stats.filter((s) => isPlainObject(s) && typeof s.id === 'string'));

/** The system's price list, those buys well formed enough to read, and whether purchases wait for the GM. */
const spendOf = (definition) => {
  const set = definition && isPlainObject(definition.spend) ? definition.spend : {};
  return {
    buys: list(set.buys).filter((b) => isPlainObject(b) && typeof b.id === 'string' && WHATS.includes(b.what) && typeof b.cost === 'string'),
    wait: set.wait === true,
  };
};

/** Whether this system's characters spend XP: its setup question answers SPEND XP, with the XP part on. */
const spendsXp = (definition) => !!definition && isPlainObject(definition.core) && Array.isArray(definition.core.advancement)
  && definition.core.advancement.includes('spend') && partOn(definition, 'xp');

/** A cost's formula checked: written, short enough, read as a formula is, naming only what a sheet has. */
const checkCost = (definition, buy, where, problems) => {
  if (typeof buy.cost !== 'string' || !buy.cost.trim()) { problems.push({ where: `${where}, cost`, message: 'Write what it costs: a number or a formula' }); return; }
  if (buy.cost.length > LIMITS.cost) { problems.push({ where: `${where}, cost`, message: `At most ${LIMITS.cost} characters` }); return; }
  const tables = tablesOf(isPlainObject(definition.lookups) ? definition.lookups : undefined);
  let tree;
  try { tree = parse(buy.cost, (name) => Object.prototype.hasOwnProperty.call(tables, name)); } catch (e) { problems.push({ where: `${where}, cost`, message: e.message }); return; }
  const refs = references(tree);
  const names = namesOf(definition);
  const own = buy.what === 'stat' ? OWN_NAMES : [];
  for (const name of refs.fields) {
    if (own.includes(name) || names.has(name)) continue;
    problems.push({ where: `${where}, cost`, message: OWN_NAMES.includes(name)
      ? `@${name} is a stat's, read only by RAISE A STAT`
      : `@${name}: no stat or formula is called that` });
  }
  const ownable = ownableOf(definition);
  for (const name of refs.has) if (!ownable.has(name)) problems.push({ where: `${where}, cost`, message: `has(${name}): no option or feature is called that` });
};

/** A definition's `spend` checked, its problems added to `problems`. */
const checkSpend = (definition, problems) => {
  const set = definition.spend;
  if (set === undefined) return;
  if (!isPlainObject(set)) { problems.push({ where: 'spend', message: 'Must say what XP buys' }); return; }
  for (const key of Object.keys(set)) if (!KEYS.has(key)) problems.push({ where: `spend, ${key}`, message: 'Not part of SPEND XP' });
  if (set.wait !== undefined && typeof set.wait !== 'boolean') problems.push({ where: 'spend, wait', message: 'On or off' });
  if (set.buys === undefined) return;
  if (!Array.isArray(set.buys)) { problems.push({ where: 'spend, buys', message: 'Must be a list of what XP buys' }); return; }
  if (set.buys.length > LIMITS.buys) problems.push({ where: 'spend, buys', message: `At most ${LIMITS.buys}` });
  const groups = new Set(list(definition.stats).filter((g) => isPlainObject(g) && typeof g.id === 'string').map((g) => g.id));
  const lists = new Map(choicesOf(definition).map((c) => [c.id, c]));
  const ids = new Set();
  set.buys.slice(0, LIMITS.buys).forEach((b, i) => {
    const where = `spend, buy ${isPlainObject(b) && typeof b.id === 'string' ? b.id : i + 1}`;
    if (!isPlainObject(b)) { problems.push({ where, message: 'Must say what it buys' }); return; }
    if (typeof b.id !== 'string' || !ID.test(b.id)) problems.push({ where, message: 'Its id must start with a letter: lowercase letters, digits and _' });
    else if (ids.has(b.id)) problems.push({ where, message: 'Named twice' });
    else ids.add(b.id);
    if (!WHATS.includes(b.what)) { problems.push({ where: `${where}, what`, message: 'RAISE A STAT or AN OPTION' }); return; }
    for (const key of Object.keys(b)) if (!BUY_KEYS[b.what].has(key)) problems.push({ where: `${where}, ${key}`, message: b.what === 'stat' ? 'Not part of RAISE A STAT' : 'Not part of AN OPTION' });
    if (b.what === 'stat') {
      if (b.stats !== undefined && !groups.has(b.stats)) problems.push({ where: `${where}, stats`, message: `No group of stats is called ${b.stats}` });
      else if (!statsIn(definition, b.stats).length) problems.push({ where: `${where}, stats`, message: 'There are no stats to raise' });
      if (b.most !== undefined && (!Number.isInteger(b.most) || Math.abs(b.most) > LIMITS.most)) problems.push({ where: `${where}, most`, message: 'UP TO is a whole number' });
    } else if (!lists.has(b.list)) problems.push({ where: `${where}, list`, message: typeof b.list === 'string' ? `No list is called ${b.list}` : 'Pick the list it buys from' });
    else if (lists.get(b.list).levelled === true) problems.push({ where: `${where}, list`, message: `${lists.get(b.list).many || b.list} goes up by LEVEL UP, never bought` });
    checkCost(definition, b, where, problems);
  });
};

/** The price list as the sheet is told it: what each buys, by name, never a formula; and whether purchases wait. */
const spendShown = (definition) => {
  const ranks = new Map(rankedStatsOf(definition).map(({ stat, ranks: r }) => [stat.id, r]));
  const lists = new Map(choicesOf(definition).map((c) => [c.id, c]));
  const { buys, wait } = spendOf(definition);
  return {
    buys: buys.flatMap((b) => {
      if (b.what === 'stat') {
        return [{ id: b.id, what: 'stat', stats: statsIn(definition, b.stats).map((s) => ({ id: s.id, label: s.label || s.id, ...(ranks.has(s.id) ? { ranks: ranks.get(s.id).list.map((k) => k.name) } : {}) })),
          ...(Number.isInteger(b.most) ? { most: b.most } : {}) }];
      }
      const c = lists.get(b.list);
      return c && c.levelled !== true ? [{ id: b.id, what: 'option', list: c.id, one: c.one || c.id, many: c.many || c.id }] : [];
    }),
    wait,
  };
};

/**
 * A cost worked out on the sheet as it reads now (`sheet`, when it is worked out already), with `own` names (@old, @new)
 * over the sheet's: a whole amount, never below 0, or null.
 */
const costOn = (definition, data, text, own = {}, sheet = effectiveData(definition, data)) => {
  const has = (o, name) => Object.prototype.hasOwnProperty.call(o, name);
  const tables = tablesOf(isPlainObject(definition.lookups) ? definition.lookups : undefined);
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  try {
    const n = evaluate(parse(text, (name) => has(tables, name)), {
      field: (name) => (has(own, name) ? own[name] : num(sheet[name])),
      rule: (name) => ruleValue(name, sheet),
      table: (name, x) => lookupIn(has(tables, name) ? tables[name] : [], x),
    });
    return Number.isFinite(n) ? Math.max(0, Math.round(n)) : null;
  } catch { return null; }
};

/**
 * What one purchase would be on this sheet now (7f2a1): buying `buy` (its id) for `target`, a stat it raises or an option
 * of its list. `{ cost, from, to }` for a stat (a rank's steps, with `fromName` and `toName`), `{ cost }` for an option, or
 * `{ error }` in the sheet's words when it can't be bought.
 */
const priceOf = (definition, data, buyId, target, ready = {}) => {
  const buy = spendOf(definition).buys.find((b) => b.id === buyId);
  if (!buy) return { error: 'XP buys nothing called that' };
  const sheet = isPlainObject(data) ? data : {};
  // The sheet worked out, and what it holds, once for every price on it (pricesOf).
  const seen = ready.seen || effectiveData(definition, sheet);
  if (buy.what === 'stat') {
    const stat = statsIn(definition, buy.stats).find((s) => s.id === target);
    if (!stat) return { error: 'That stat isn\'t raised here' };
    const name = stat.label || stat.id;
    const held = rankedStatsOf(definition).find((r) => r.stat.id === stat.id);
    const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
    if (held) {
      const from = Math.max(0, Math.round(num(sheet[stepFieldOf(stat.id)])));
      const top = held.ranks.list.length - 1;
      if (from >= top) return { error: `${name} is at its top rank, ${rankNameAt(held.ranks, top)}` };
      const cost = costOn(definition, sheet, buy.cost, { old: from, new: from + 1 }, seen);
      if (cost === null) return { error: 'Its cost can\'t be worked out' };
      return { cost, from, to: from + 1, fromName: rankNameAt(held.ranks, from), toName: rankNameAt(held.ranks, from + 1) };
    }
    const from = num(sheet[stat.id]);
    if (Number.isInteger(buy.most) && from + 1 > buy.most) return { error: `${name} stops at ${buy.most}` };
    const cost = costOn(definition, sheet, buy.cost, { old: from, new: from + 1 }, seen);
    if (cost === null) return { error: 'Its cost can\'t be worked out' };
    return { cost, from, to: from + 1 };
  }
  const c = choicesOf(definition).find((l) => l.id === buy.list);
  const option = c && c.levelled !== true ? list(c.options).find((o) => isPlainObject(o) && o.id === target) : null;
  if (!option) return { error: `That isn't one of ${c ? c.many || c.id : 'its list'}` };
  const name = option.label || option.id;
  if ((ready.held || heldOf(definition, sheet)).some((p) => p.list.id === c.id && p.option.id === option.id)) return { error: `${name} is taken already` };
  if (!meets(definition, sheet, option)) return { error: `${name} needs ${needsText(definition, option.requires)}` };
  const cost = costOn(definition, sheet, buy.cost, {}, seen);
  if (cost === null) return { error: 'Its cost can\'t be worked out' };
  return { cost };
};

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** A sheet's purchases, those whole enough to read, oldest first. */
const ledgerOf = (data) => list(isPlainObject(data) ? data[SPENT_KEY] : undefined)
  .filter((e) => isPlainObject(e) && Number.isInteger(e.n) && Number.isInteger(e.cost) && e.cost >= 0 && STATES.includes(e.state) && typeof e.buy === 'string' && typeof e.target === 'string');

/** XP awarded less what is spent or waiting for the GM. */
const unspentOf = (data) => Math.round(num(isPlainObject(data) ? data[XP_KEY] : 0))
  - ledgerOf(data).filter((e) => e.state === 'done' || e.state === 'pending').reduce((sum, e) => sum + e.cost, 0);

/** What a purchase is of, by name: a stat's or an option's label, or its id. */
const nameOf = (definition, e) => {
  const named = e.what === 'stat'
    ? statsIn(definition).find((s) => s.id === e.target)
    : choicesOf(definition).flatMap((c) => list(c.options)).find((o) => isPlainObject(o) && o.id === e.target);
  return (named && named.label) || e.target;
};

/** The sheet with a purchase's stat raised to `to` (a rank's step as its picker writes it), or its option picked. */
const withBought = (definition, data, e, to) => {
  if (e.what === 'stat') {
    const ranked = rankedStatsOf(definition).some((r) => r.stat.id === e.target);
    return ranked ? { ...data, [stepFieldOf(e.target)]: String(to) } : { ...data, [e.target]: to };
  }
  const picks = isPlainObject(data[PICKS_KEY]) ? data[PICKS_KEY] : {};
  return { ...data, [PICKS_KEY]: { ...picks, [e.list]: [...list(picks[e.list]), { option: e.target, locked: true, bought: e.n }] } };
};

/** The sheet with a purchase taken back: its stat a step down (a rank never below its lowest), or its pick gone. */
const withoutBought = (definition, data, e) => {
  if (e.what === 'stat') {
    const field = rankedStatsOf(definition).some((r) => r.stat.id === e.target) ? stepFieldOf(e.target) : null;
    if (field) return { ...data, [field]: String(Math.max(0, Math.round(num(data[field])) - 1)) };
    return { ...data, [e.target]: num(data[e.target]) - 1 };
  }
  const picks = isPlainObject(data[PICKS_KEY]) ? data[PICKS_KEY] : {};
  return { ...data, [PICKS_KEY]: { ...picks, [e.list]: list(picks[e.list]).filter((p) => !(isPlainObject(p) && p.bought === e.n)) } };
};

/** The sheet with one purchase in its ledger set to `state`. */
const withState = (data, n, state) => ({ ...data, [SPENT_KEY]: list(data[SPENT_KEY]).map((e) => (isPlainObject(e) && e.n === n ? { ...e, state } : e)) });

const fail = (error) => ({ ok: false, error });

/**
 * A purchase made or settled (7f2a2), on a character's sheet: { kind: 'buy', buy, target }, the player's or the GM's, and the
 * GM's { kind: 'undo' | 'approve' | 'decline', entry } on a purchase by its number. `{ ok: true, data, entry }`, the sheet it
 * leaves and the purchase as it now is, or `{ ok: false, error }` in the sheet's words.
 */
const spendAction = (definition, data, action, { gm = false, now = Date.now() } = {}) => {
  const xp = wordFor(definition, 'xp', 'short') || 'XP';
  if (!spendsXp(definition)) return fail(`${xp} isn't spent in this game`);
  if (!isPlainObject(action)) return fail('Nothing to do');
  const sheet = isPlainObject(data) ? data : {};
  const ledger = ledgerOf(sheet);
  if (action.kind === 'buy') {
    const price = priceOf(definition, sheet, action.buy, action.target);
    if (price.error) return fail(price.error);
    const buy = spendOf(definition).buys.find((b) => b.id === action.buy);
    const e = { buy: buy.id, what: buy.what, target: action.target, ...(buy.what === 'option' ? { list: buy.list } : {}) };
    if (ledger.some((x) => x.state === 'pending' && x.what === e.what && x.target === e.target)) return fail(`${nameOf(definition, e)} waits for the GM already`);
    const unspent = unspentOf(sheet);
    if (price.cost > unspent) return fail(`That costs ${price.cost} ${xp}, and ${unspent} is unspent`);
    if (list(sheet[SPENT_KEY]).length >= LIMITS.ledger) return fail('No more purchases fit on this sheet');
    const waits = spendOf(definition).wait && !gm;
    const entry = {
      n: ledger.reduce((most, x) => Math.max(most, x.n), 0) + 1, ...e,
      ...(buy.what === 'stat' ? { from: price.from, to: price.to } : {}),
      cost: price.cost, by: gm ? 'gm' : 'player', at: now, state: waits ? 'pending' : 'done',
    };
    const kept = { ...sheet, [SPENT_KEY]: [...list(sheet[SPENT_KEY]), entry] };
    return { ok: true, data: waits ? kept : withBought(definition, kept, entry, price.to), entry };
  }
  if (!['undo', 'approve', 'decline'].includes(action.kind)) return fail('Nothing to do');
  if (!gm) return fail('That is the GM\'s to do');
  const e = ledger.find((x) => x.n === action.entry);
  if (!e) return fail('No purchase has that number');
  if (action.kind === 'undo') {
    if (e.state !== 'done') return fail('Only a purchase made can be undone');
    return { ok: true, data: withState(withoutBought(definition, sheet, e), e.n, 'undone'), entry: { ...e, state: 'undone' } };
  }
  if (e.state !== 'pending') return fail('That purchase isn\'t waiting for the GM');
  if (action.kind === 'decline') return { ok: true, data: withState(sheet, e.n, 'declined'), entry: { ...e, state: 'declined' } };
  // Checked again on the sheet as it is now; its XP was held when it was bought.
  const price = priceOf(definition, sheet, e.buy, e.target);
  if (price.error) return fail(price.error);
  return { ok: true, data: withState(withBought(definition, sheet, e, price.to), e.n, 'done'), entry: { ...e, state: 'done' } };
};

/**
 * What the sheet shows of spending (7f2a2), written with every save: XP unspent, and each price on the list for this
 * character now, by buy and by stat or option: { cost, from?, to?, fromName?, toName? } or { error }.
 */
const spendWorked = (definition, data) => {
  const sheet = isPlainObject(data) ? data : {};
  const ready = { seen: effectiveData(definition, sheet), held: heldOf(definition, sheet) };
  const lists = new Map(choicesOf(definition).map((c) => [c.id, c]));
  const prices = {};
  for (const b of spendOf(definition).buys) {
    const targets = b.what === 'stat' ? statsIn(definition, b.stats).map((s) => s.id)
      : list(lists.has(b.list) ? lists.get(b.list).options : []).filter((o) => isPlainObject(o) && typeof o.id === 'string').map((o) => o.id);
    prices[b.id] = Object.fromEntries(targets.map((t) => [t, priceOf(definition, sheet, b.id, t, ready)]));
  }
  return { unspent: unspentOf(sheet), prices };
};

module.exports = { LIMITS, WHATS, SPENT_KEY, STATES, spendOf, spendsXp, checkSpend, spendShown, priceOf, costOn, ledgerOf, unspentOf, spendAction, spendWorked };
