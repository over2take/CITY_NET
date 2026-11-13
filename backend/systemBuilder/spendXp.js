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
// Pure: checks and reads.

const { parse, evaluate, references } = require('./expression');
const { ruleValue } = require('./rules');
const { tablesOf, lookupIn } = require('./derived');
const { rankedStatsOf, stepFieldOf, rankNameAt } = require('./ranks');
const { choicesOf, heldOf, effectiveData, meets, needsText, namesOf, ownableOf } = require('./choices');

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);
const ID = /^[a-z][a-z0-9_]{0,63}$/;

const LIMITS = { buys: 20, cost: 1000, most: 1000000 };
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

/** A cost worked out on the sheet as it reads now, with `own` names (@old, @new) over the sheet's: a whole amount, never below 0, or null. */
const costOn = (definition, data, text, own = {}) => {
  const sheet = effectiveData(definition, data);
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
const priceOf = (definition, data, buyId, target) => {
  const buy = spendOf(definition).buys.find((b) => b.id === buyId);
  if (!buy) return { error: 'XP buys nothing called that' };
  const sheet = isPlainObject(data) ? data : {};
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
      const cost = costOn(definition, sheet, buy.cost, { old: from, new: from + 1 });
      if (cost === null) return { error: 'Its cost can\'t be worked out' };
      return { cost, from, to: from + 1, fromName: rankNameAt(held.ranks, from), toName: rankNameAt(held.ranks, from + 1) };
    }
    const from = num(sheet[stat.id]);
    if (Number.isInteger(buy.most) && from + 1 > buy.most) return { error: `${name} stops at ${buy.most}` };
    const cost = costOn(definition, sheet, buy.cost, { old: from, new: from + 1 });
    if (cost === null) return { error: 'Its cost can\'t be worked out' };
    return { cost, from, to: from + 1 };
  }
  const c = choicesOf(definition).find((l) => l.id === buy.list);
  const option = c && c.levelled !== true ? list(c.options).find((o) => isPlainObject(o) && o.id === target) : null;
  if (!option) return { error: `That isn't one of ${c ? c.many || c.id : 'its list'}` };
  const name = option.label || option.id;
  if (heldOf(definition, sheet).some((p) => p.list.id === c.id && p.option.id === option.id)) return { error: `${name} is taken already` };
  if (!meets(definition, sheet, option)) return { error: `${name} needs ${needsText(definition, option.requires)}` };
  const cost = costOn(definition, sheet, buy.cost);
  if (cost === null) return { error: 'Its cost can\'t be worked out' };
  return { cost };
};

module.exports = { LIMITS, WHATS, spendOf, checkSpend, spendShown, priceOf, costOn };
