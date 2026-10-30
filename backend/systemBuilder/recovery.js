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
//       back: [{ rest: 'long_rest', how: 'all' }],  // what a rest gives back: all, half (at least
//                                                   // 1), or 'by' an amount (a formula)
//     },
//   }
//
// The die is the option's own: a levelled list's option (a class) says its `die` (choices.js),
// the same die the level-up flow (7d) will roll for health. Generic, with no presets (the user:
// "give them the tools"): the builder's hint names the games it is like, D&D's hit dice and 13th
// Age's recoveries. The pools on the sheet, spending them and finishing a rest come in later pieces
// (R2 to R4); this is what the system says, and its checks.

const { parse, references } = require('./expression');
const { tablesOf } = require('./derived');
const { namesOf, levelNamesOf, choicesOf } = require('./choices');
const { restIdsOf } = require('./rests');

const FINISH = ['call', 'sheet'];
const HOWS = ['all', 'half', 'by'];
const LIMITS = { name: 30, formula: 200, back: 12 };
const RESTING_KEYS = new Set(['finish', 'recovery']);
const RECOVERY_KEYS = new Set(['name', 'count', 'per_level', 'plus', 'spent_at', 'back']);
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
      back: list(r.back).filter(isPlainObject).map((b) => ({ rest: b.rest, how: b.how, ...(b.how === 'by' ? { amount: b.amount } : {}) })),
    },
  };
};

module.exports = { FINISH, HOWS, LIMITS, checkResting, restingOf, diceOptionsOf };
