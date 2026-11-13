// IMPROVE BY USE (7f3; approved mockup docs/mockups/ranks-and-xp.html, 2026-11-12): a stat used is marked, and at a rest
// the GM picks each marked stat rolls to improve, as Call of Cthulhu's skills do. For systems whose setup question answers
// IMPROVE BY USE (core.advancement 'use'):
//
//   improve: {
//     stats: 'skills',          // STATS THAT IMPROVE: a group's (every stat's, unsaid)
//     marked: 'success',        // MARKED BY: 'success' (a successful roll of it), 'any' (any roll of it), 'hand' (by hand only)
//     at: 'end_of_session',     // AT: the rest it is rolled at (or one that counts as it)
//     roll: 'd100',             // ROLL: dice or a formula, reading the sheet and @this, the stat
//     over: '@this',            // IMPROVES IF OVER: the roll must beat it
//     gain: '1d10',             // THEN ADD: dice or a formula
//     most: 99,                 // UP TO: the highest it goes (no end, unsaid); the stat's own highest too
//   }
//
// A stat held as a rank (7f1) isn't improved by use: a roll over it reads as a number, and a rank goes up a step.
// The marks are kept on the sheet under MARKS_KEY, { stat: true }: set by the server after a roll, ticked or cleared by
// the player or the GM by hand, and cleared by the rest that rolls them.
//
// Pure: checks, reads, and what a rest does to a sheet's marked stats (resting.js restOn).

const { rollAmount, boxProblem } = require('./tierRolls');
const { rankedStatsOf } = require('./ranks');
const { restsOf } = require('./rests');
const { namesOf, effectiveData } = require('./choices');

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

/** Where a sheet keeps which stats are marked. */
const MARKS_KEY = '_marks';
/** What marks a stat: a successful roll of it, any roll of it, or the player's or GM's hand alone. */
const MARKED_BY = ['success', 'any', 'hand'];
const KEYS = new Set(['stats', 'marked', 'at', 'roll', 'over', 'gain', 'most']);
const LIMITS = { text: 200, most: 1000000 };
/** What it does, said nothing else: Call of Cthulhu's. */
const DEFAULTS = { marked: 'success', at: 'end_of_session', roll: 'd100', over: '@this', gain: '1d10' };

/** Whether this system's characters improve by use: its setup question says so. */
const improvesBy = (definition) => !!definition && isPlainObject(definition.core) && Array.isArray(definition.core.advancement)
  && definition.core.advancement.includes('use');

/** How a system's stats improve, with what it leaves unsaid filled in. */
const improveOf = (definition) => {
  const set = definition && isPlainObject(definition.improve) ? definition.improve : {};
  const text = (key) => (typeof set[key] === 'string' && set[key].trim() ? set[key] : DEFAULTS[key]);
  return {
    ...(typeof set.stats === 'string' ? { stats: set.stats } : {}),
    marked: MARKED_BY.includes(set.marked) ? set.marked : DEFAULTS.marked,
    at: typeof set.at === 'string' && set.at ? set.at : DEFAULTS.at,
    roll: text('roll'), over: text('over'), gain: text('gain'),
    most: Number.isInteger(set.most) ? set.most : null,
  };
};

/** The stats that improve: a group's (every stat's with none named), never one held as a rank. */
const improvingStats = (definition) => {
  const ranked = new Set(rankedStatsOf(definition).map((r) => r.stat.id));
  const { stats } = improveOf(definition);
  return list(definition && definition.stats).filter((g) => isPlainObject(g) && (stats === undefined || g.id === stats))
    .flatMap((g) => list(g.stats)).filter((s) => isPlainObject(s) && typeof s.id === 'string' && !ranked.has(s.id));
};

/** What a box may name: the sheet's names, and @this, the stat. */
const namesFor = (definition) => {
  const names = new Set([...namesOf(definition).keys(), 'this']);
  return { known: (name) => names.has(name), refused: (name) => `@${name}: no stat or formula is called that` };
};

/** A definition's `improve` checked, its problems added to `problems`. */
const checkImprove = (definition, problems) => {
  const set = definition.improve;
  if (set === undefined) return;
  if (!isPlainObject(set)) { problems.push({ where: 'improve', message: 'Must say how stats improve by use' }); return; }
  for (const key of Object.keys(set)) if (!KEYS.has(key)) problems.push({ where: `improve, ${key}`, message: 'Not part of IMPROVE BY USE' });
  const groups = new Set(list(definition.stats).filter((g) => isPlainObject(g) && typeof g.id === 'string').map((g) => g.id));
  if (set.stats !== undefined && !groups.has(set.stats)) problems.push({ where: 'improve, stats', message: `No group of stats is called ${set.stats}` });
  else if (!improvingStats(definition).length) problems.push({ where: 'improve, stats', message: 'There are no stats to improve: a stat held as a rank isn\'t' });
  if (set.marked !== undefined && !MARKED_BY.includes(set.marked)) problems.push({ where: 'improve, marked', message: 'A SUCCESSFUL ROLL OF IT, ANY ROLL OF IT or BY HAND ONLY' });
  if (set.at !== undefined && !restsOf(definition).some((r) => r.id === set.at)) problems.push({ where: 'improve, at', message: typeof set.at === 'string' ? `No rest is called ${set.at}` : 'Pick the rest it is rolled at' });
  const names = namesFor(definition);
  for (const key of ['roll', 'over', 'gain']) {
    if (set[key] === undefined) continue;
    if (typeof set[key] !== 'string' || !set[key].trim()) { problems.push({ where: `improve, ${key}`, message: 'Dice or a formula' }); continue; }
    if (set[key].length > LIMITS.text) { problems.push({ where: `improve, ${key}`, message: `At most ${LIMITS.text} characters` }); continue; }
    const problem = boxProblem(set[key], names);
    if (problem) problems.push({ where: `improve, ${key}`, message: problem });
  }
  if (set.most !== undefined && (!Number.isInteger(set.most) || Math.abs(set.most) > LIMITS.most)) problems.push({ where: 'improve, most', message: 'UP TO is a whole number' });
};

/** What the sheet is told (7f3b): the stats that improve, by name; what marks them; the rest they are rolled at, by name. */
const improveShown = (definition) => {
  const set = improveOf(definition);
  const rest = restsOf(definition).find((r) => r.id === set.at);
  return {
    stats: improvingStats(definition).map((s) => ({ id: s.id, label: s.label || s.id })),
    marked: set.marked,
    at: { id: set.at, name: rest ? rest.name : set.at },
  };
};

/** A sheet's marks, those on stats that improve. */
const marksOf = (definition, data) => {
  const kept = isPlainObject(data) && isPlainObject(data[MARKS_KEY]) ? data[MARKS_KEY] : {};
  return improvingStats(definition).filter((s) => kept[s.id] === true).map((s) => s.id);
};

/** The sheet with `stat` marked or not, its marks kept only while there are any. */
const withMark = (data, stat, on) => {
  const marks = { ...(isPlainObject(data[MARKS_KEY]) ? data[MARKS_KEY] : {}) };
  if (on) marks[stat] = true; else delete marks[stat];
  const next = { ...data, [MARKS_KEY]: marks };
  if (!Object.keys(marks).length) delete next[MARKS_KEY];
  return next;
};

/**
 * What a roll of `fieldId` marks (7f3a1): the stat, where it improves by use, isn't marked yet, and the roll is one MARKED BY
 * takes (any, or a success: `success` true). The sheet so marked, or null.
 */
const markedByRoll = (definition, data, fieldId, success) => {
  if (!improvesBy(definition)) return null;
  const { marked } = improveOf(definition);
  if (marked === 'hand' || (marked === 'success' && success !== true)) return null;
  if (!improvingStats(definition).some((s) => s.id === fieldId)) return null;
  const sheet = isPlainObject(data) ? data : {};
  if (marksOf(definition, sheet).includes(fieldId)) return null;
  return withMark(sheet, fieldId, true);
};

/** A mark ticked or cleared by hand, the player's or the GM's: { kind: 'mark', stat, on }. { ok, data } or { ok: false, error }. */
const improveAction = (definition, data, action) => {
  if (!improvesBy(definition)) return { ok: false, error: 'Stats don\'t improve by use in this game' };
  if (!isPlainObject(action) || action.kind !== 'mark') return { ok: false, error: 'Nothing to do' };
  if (!improvingStats(definition).some((s) => s.id === action.stat)) return { ok: false, error: 'That stat doesn\'t improve by use' };
  return { ok: true, data: withMark(isPlainObject(data) ? data : {}, action.stat, action.on === true) };
};

/**
 * What a rest does to the marked stats (7f3a1), in restOn: where it is the rest they are rolled at (`ends`, the rest and
 * those it counts as), each marked stat rolls; over its target, it gains, up to its most and its own highest. The marks
 * clear. `rng` null is a preview: nothing rolled, each marked stat said as waiting. `{ patch, changes, rolls }`, or null
 * when the rest does nothing here.
 */
const improveAt = (definition, data, ends, rng) => {
  if (!improvesBy(definition)) return null;
  const set = improveOf(definition);
  if (!ends.has(set.at)) return null;
  const marked = marksOf(definition, data);
  if (!marked.length) return null;
  const stats = new Map(improvingStats(definition).map((s) => [s.id, s]));
  const names = namesFor(definition);
  const seen = effectiveData(definition, data);
  const patch = {};
  const changes = [];
  const rolls = [];
  for (const id of marked) {
    const stat = stats.get(id);
    const label = stat.label || id;
    const from = num(data[id]);
    if (!rng) { changes.push({ what: id, label, from, to: null, pending: [`${set.roll} over ${set.over}`] }); continue; }
    const values = { ...seen, this: from };
    const rolled = rollAmount(set.roll, values, names, rng);
    const over = rollAmount(set.over, values, names, rng);
    if ('error' in rolled || 'blank' in rolled || 'error' in over || 'blank' in over) continue;
    rolls.push({ amount: set.roll, value: rolled.value, dice: rolled.dice });
    if (rolled.value <= over.value) continue;
    const gained = rollAmount(set.gain, values, names, rng);
    if ('error' in gained || 'blank' in gained) continue;
    rolls.push({ amount: set.gain, value: gained.value, dice: gained.dice });
    const top = Math.min(set.most ?? Infinity, Number.isFinite(stat.max) ? stat.max : Infinity);
    const to = Math.max(from, Math.min(top, from + gained.value));
    if (to === from) continue;
    patch[id] = to;
    changes.push({ what: id, label, from, to });
  }
  // The marks are spent by the rest, improved or not; a preview leaves them.
  if (rng) patch[MARKS_KEY] = {};
  return { patch, changes, rolls };
};

module.exports = { MARKS_KEY, MARKED_BY, DEFAULTS, improvesBy, improveOf, improvingStats, checkImprove, improveShown, marksOf, withMark, markedByRoll, improveAction, improveAt };
