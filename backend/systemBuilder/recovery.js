// How a system's characters rest (R1a; approved mockup docs/mockups/rest-on-sheet.html,
// 2026-10-30): who finishes a rest the GM calls, and the recovery dice a character spends to heal.
//
//   resting: {
//     finish: 'sheet',              // 'call' (as when absent): a called rest applies at once;
//                                   // 'sheet': it opens on each player's sheet, applied when they finish
//     recovery: {
//       name: 'Hit Dice',           // the system's own word for them
//       count: 'levels',            // how many each has: one per level of each option with a die (as
//                                   // when absent), or a formula (13th Age's 8 recoveries)
//       per_level: true,            // optional: each heals the die once per level (13th Age)
//       plus: '@con_mod',           // optional: a formula added to each die
//       spent_at: ['short_rest'],   // the rests they may be spent at, or 'any' (a fight too)
//       spend: 'gm',                // optional: players spend them only while the GM has spending
//                                   // open (the GAME tab); 'any' (as when absent): any time
//       back: [{ rest: 'long_rest', how: 'all' }],  // what a rest gives back: all, half (at least
//                                                   // 1), or 'by' an amount (a formula)
//     },
//   }
//
// The die is the option's own: a levelled list's option (a class) says its `die` (choices.js),
// the same die the level-up flow (7d) will roll for health. Generic, with no presets (the user:
// "give them the tools"): the builder's hint names the games it is like, D&D's hit dice and 13th
// Age's recoveries.
//
// At the table (R2a): a character's pools, worked out from their picks (poolsOf). Counted by levels,
// a pool for each class with a die, as many as its level (a Fighter 3 / Wizard 2 has three d10s and
// two d6s); counted by a formula, one pool of that many, of the largest die they have. How many of
// each are spent is kept on the sheet under RECOVERY_KEY, by pool. Spending rolls them (spendFrom):
// each one's die, once or once per level, plus the formula. Spent any time, SPENT AT the table's to
// keep (the user, 2026-10-30: "any time, trust the table"); or, for a GM who wants control (`spend:
// 'gm'`, the user the same day), only while the GM has spending open (OPEN_SETTING, a game-wide
// setting the GAME tab switches), the GM always. A rest giving them back sets them back (givenBack,
// read by resting.js). Ticking them off, for real dice, is picking.js's.

const { parse, references } = require('./expression');
const { tablesOf } = require('./derived');
const { namesOf, levelNamesOf, choicesOf, picksOf, valueOn, needsText } = require('./choices');
const { restIdsOf, restsOf } = require('./rests');

const FINISH = ['call', 'sheet'];
const SPEND = ['any', 'gm'];
const HOWS = ['all', 'half', 'by'];
const LIMITS = { name: 30, formula: 200, back: 12 };
const RESTING_KEYS = new Set(['finish', 'recovery']);
const RECOVERY_KEYS = new Set(['name', 'count', 'per_level', 'plus', 'spent_at', 'spend', 'back']);
const BACK_KEYS = new Set(['rest', 'how', 'amount']);

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);

/** The options with a die, in the levelled lists: [{ list, option, die }]. */
const diceOptionsOf = (definition) => choicesOf(definition).filter((c) => c.levelled === true)
  .flatMap((c) => list(c.options).filter((o) => isPlainObject(o) && Number.isInteger(o.die)).map((o) => ({ list: c, option: o, die: o.die })));

/** A formula's mistake, or null: it must read, name only what the system has, and call only its tables. */
const formulaProblem = (definition, text) => {
  if (typeof text !== 'string' || !text.trim()) return 'Must be formula text';
  if (text.length > LIMITS.formula) return `Longer than ${LIMITS.formula} characters`;
  const tables = tablesOf(isPlainObject(definition.lookups) ? definition.lookups : undefined);
  let tree;
  try { tree = parse(text, (name) => Object.prototype.hasOwnProperty.call(tables, name)); } catch (e) { return e.message; }
  const known = new Set([...namesOf(definition).keys(), ...levelNamesOf(definition)]);
  const unknown = [...references(tree).fields].find((n) => !known.has(n));
  return unknown ? `@${unknown} isn't one of this system's names` : null;
};

/** A definition's `resting` checked, its problems added to `problems`. */
const checkResting = (definition, problems) => {
  const resting = definition.resting;
  if (resting === undefined) return;
  if (!isPlainObject(resting)) { problems.push({ where: 'resting', message: 'Must say how rests are finished and the recovery dice' }); return; }
  for (const key of Object.keys(resting)) if (!RESTING_KEYS.has(key)) problems.push({ where: `resting, ${key}`, message: 'Not part of resting' });
  if (resting.finish !== undefined && !FINISH.includes(resting.finish)) problems.push({ where: 'resting, finish', message: 'call (at the GM\'s call) or sheet (on each sheet)' });
  const r = resting.recovery;
  if (r === undefined) return;
  const where = 'resting, recovery';
  if (!isPlainObject(r)) { problems.push({ where, message: 'Must name the recovery dice and how they work' }); return; }
  for (const key of Object.keys(r)) if (!RECOVERY_KEYS.has(key)) problems.push({ where: `${where}, ${key}`, message: 'Not part of the recovery dice' });
  if (typeof r.name !== 'string' || !r.name.trim()) problems.push({ where: `${where}, name`, message: 'Required' });
  else if (r.name.length > LIMITS.name) problems.push({ where: `${where}, name`, message: `Longer than ${LIMITS.name} characters` });
  if (!diceOptionsOf(definition).length) problems.push({ where, message: 'No option has a die to roll: give a levelled list\'s options a die on CHOICES' });
  if (r.count !== undefined && r.count !== 'levels') {
    const wrong = formulaProblem(definition, r.count);
    if (wrong) problems.push({ where: `${where}, count`, message: `levels, or a formula: ${wrong}` });
  }
  if (r.per_level !== undefined && typeof r.per_level !== 'boolean') problems.push({ where: `${where}, per_level`, message: 'true or false' });
  if (r.spend !== undefined && !SPEND.includes(r.spend)) problems.push({ where: `${where}, spend`, message: 'any (any time) or gm (while the GM has spending open)' });
  if (r.plus !== undefined) {
    const wrong = formulaProblem(definition, r.plus);
    if (wrong) problems.push({ where: `${where}, plus`, message: wrong });
  }
  const rests = new Set(restIdsOf(definition));
  if (r.spent_at !== 'any') {
    if (!Array.isArray(r.spent_at) || !r.spent_at.length) problems.push({ where: `${where}, spent_at`, message: 'any, or a list of the rests they are spent at' });
    else {
      r.spent_at.forEach((id, i) => { if (typeof id !== 'string' || !rests.has(id)) problems.push({ where: `${where}, spent_at ${i + 1}`, message: 'Not one of this system\'s rests' }); });
      if (new Set(r.spent_at).size !== r.spent_at.length) problems.push({ where: `${where}, spent_at`, message: 'A rest is named twice' });
    }
  }
  if (r.back !== undefined) {
    if (!Array.isArray(r.back)) { problems.push({ where: `${where}, back`, message: 'A list of the rests that give them back' }); return; }
    if (r.back.length > LIMITS.back) problems.push({ where: `${where}, back`, message: `At most ${LIMITS.back}` });
    const seen = new Set();
    r.back.slice(0, LIMITS.back).forEach((b, i) => {
      const at = `${where}, back ${i + 1}`;
      if (!isPlainObject(b)) { problems.push({ where: at, message: 'Must name a rest and how many it gives back' }); return; }
      for (const key of Object.keys(b)) if (!BACK_KEYS.has(key)) problems.push({ where: `${at}, ${key}`, message: 'Not part of a rest giving them back' });
      if (typeof b.rest !== 'string' || !rests.has(b.rest)) problems.push({ where: `${at}, rest`, message: 'Not one of this system\'s rests' });
      else if (seen.has(b.rest)) problems.push({ where: `${at}, rest`, message: 'That rest already gives them back' });
      else seen.add(b.rest);
      if (!HOWS.includes(b.how)) problems.push({ where: `${at}, how`, message: 'all, half (at least 1), or by an amount' });
      else if (b.how === 'by') {
        const wrong = formulaProblem(definition, b.amount);
        if (wrong) problems.push({ where: `${at}, amount`, message: wrong });
      } else if (b.amount !== undefined) problems.push({ where: `${at}, amount`, message: 'Only by an amount has an amount' });
    });
  }
};

/**
 * How a system's characters rest, filled in: `{ finish, recovery }`, finish 'call' when it says
 * nothing, recovery null when it has none, or with its defaults: one per level, healing the die
 * once with nothing added.
 */
const restingOf = (definition) => {
  const resting = isPlainObject(definition && definition.resting) ? definition.resting : {};
  const r = isPlainObject(resting.recovery) ? resting.recovery : null;
  return {
    finish: FINISH.includes(resting.finish) ? resting.finish : 'call',
    recovery: r && {
      name: typeof r.name === 'string' ? r.name : '',
      count: r.count === undefined ? 'levels' : r.count,
      perLevel: r.per_level === true,
      plus: typeof r.plus === 'string' ? r.plus : null,
      spentAt: r.spent_at === 'any' ? 'any' : list(r.spent_at).filter((id) => typeof id === 'string'),
      spend: r.spend === 'gm' ? 'gm' : 'any',
      back: list(r.back).filter(isPlainObject).map((b) => ({ rest: b.rest, how: b.how, ...(b.how === 'by' ? { amount: b.amount } : {}) })),
    },
  };
};

/**
 * The recovery dice in the sheet's words (R2b), never a formula: their name, what one heals ("its die
 * for each level + CON MODIFIER"), the rests they're spent at by name (or 'any'), and who says when.
 * Null for a system without them.
 */
const recoveryShown = (definition) => {
  const r = restingOf(definition).recovery;
  if (!r) return null;
  const restName = new Map(restsOf(definition).map((x) => [x.id, x.name]));
  return {
    name: r.name,
    heals: `its die${r.perLevel ? ' for each level' : ''}${typeof r.plus === 'string' && r.plus.trim() ? ` + ${needsText(definition, r.plus)}` : ''}`,
    spentAt: r.spentAt === 'any' ? 'any' : r.spentAt.map((id) => restName.get(id) || id),
    spend: r.spend,
  };
};

/** The game-wide setting the GM opens spending with ('1' open), for recovery dice spent at the GM's say. */
const OPEN_SETTING = 'recovery_open';

/**
 * Whether a player may spend recovery dice, or tick them off, now: always, unless the system leaves
 * it to the GM and `open` (the GM's setting) is off. The GM always may.
 */
const maySpend = (definition, { gm = false, open = false } = {}) => {
  const r = restingOf(definition).recovery;
  return !!r && (gm || r.spend !== 'gm' || open);
};

/** Where a sheet keeps how many of each pool are spent, by pool id. */
const RECOVERY_KEY = '_recovery';
/** The one pool a formula's count makes. */
const ALL_POOL = '_all';
/** The most dice a pool holds, and one spend rolls. */
const MOST = { pool: 100, rolled: 1000 };

const whole = (v) => (Number.isFinite(v) ? Math.floor(v) : 0);
const spentStored = (data) => (isPlainObject(data) && isPlainObject(data[RECOVERY_KEY]) ? data[RECOVERY_KEY] : {});

/**
 * A character's recovery dice: [{ id, label, die, total, spent, times }], `times` how many of its die
 * one heals (its level, when they heal once per level). None without recovery dice, or a class with a die.
 */
const poolsOf = (definition, data) => {
  const r = restingOf(definition).recovery;
  if (!r) return [];
  const picks = picksOf(definition, data).filter((p) => p.list.levelled === true && Number.isInteger(p.option.die) && p.level >= 1);
  if (!picks.length) return [];
  const stored = spentStored(data);
  const spentOf = (id, total) => {
    const n = Number(stored[id]);
    return Number.isInteger(n) ? Math.max(0, Math.min(total, n)) : 0;
  };
  if (r.count === 'levels') {
    return picks.map((p) => {
      // A level is at most 30 (choices.js LIMITS), well inside a pool's most.
      return { id: p.option.id, label: p.option.label || p.option.id, die: p.option.die, total: p.level, spent: spentOf(p.option.id, p.level), times: r.perLevel ? p.level : 1 };
    });
  }
  const total = Math.max(0, Math.min(MOST.pool, whole(valueOn(definition, data, r.count))));
  const levels = picks.reduce((sum, p) => sum + p.level, 0);
  return [{ id: ALL_POOL, label: r.name, die: Math.max(...picks.map((p) => p.option.die)), total, spent: spentOf(ALL_POOL, total), times: r.perLevel ? levels : 1 }];
};

/**
 * `count` spent from one pool and rolled: its die `times` over for each, the plus formula added for
 * each. `{ ok: true, pool, count, rolls, plus, heal, data }`, `data` the sheet with them spent; or
 * `{ ok: false, error }`. A heal is never below 0.
 */
const spendFrom = (definition, data, poolId, count, rng) => {
  const pool = poolsOf(definition, data).find((p) => p.id === poolId);
  if (!pool) return { ok: false, error: 'No such recovery dice on this character' };
  const left = pool.total - pool.spent;
  if (!Number.isInteger(count) || count < 1) return { ok: false, error: 'Spend at least one' };
  if (count > left) return { ok: false, error: `Only ${left} left` };
  const r = restingOf(definition).recovery;
  const plus = r.plus ? Math.round(valueOn(definition, data, r.plus) ?? 0) * count : 0;
  const rolls = Array.from({ length: Math.min(MOST.rolled, count * pool.times) }, () => Math.floor(rng() * pool.die) + 1);
  const heal = Math.max(0, rolls.reduce((a, b) => a + b, 0) + plus);
  return { ok: true, pool, count, rolls, plus, heal, data: { ...data, [RECOVERY_KEY]: { ...spentStored(data), [pool.id]: pool.spent + count } } };
};

/**
 * What the rests in `ends` give back, each pool on its own: all spent, half its dice (at least 1),
 * or an amount worked out on the sheet. `{ spent, changes: [{ pool, from, to }] }` with the dice
 * left before and after, or null when nothing comes back.
 */
const givenBack = (definition, data, ends) => {
  const r = restingOf(definition).recovery;
  const backs = r ? r.back.filter((b) => ends.has(b.rest)) : [];
  if (!backs.length) return null;
  const spent = { ...spentStored(data) };
  const changes = [];
  for (const pool of poolsOf(definition, data)) {
    let now = pool.spent;
    for (const b of backs) {
      const n = b.how === 'all' ? now : b.how === 'half' ? Math.max(1, Math.floor(pool.total / 2)) : Math.max(0, whole(valueOn(definition, data, b.amount)));
      now = Math.max(0, now - n);
    }
    if (now === pool.spent) continue;
    spent[pool.id] = now;
    changes.push({ pool, from: pool.total - pool.spent, to: pool.total - now });
  }
  return changes.length ? { spent, changes } : null;
};

module.exports = {
  FINISH, HOWS, SPEND, LIMITS, RECOVERY_KEY, ALL_POOL, MOST, OPEN_SETTING, checkResting, restingOf, recoveryShown, diceOptionsOf, maySpend, poolsOf, spendFrom, givenBack,
};
