// How a system's characters go up a level (7d1; approved mockup docs/mockups/level-up.html, 2026-11-07).
// Whether they do is the setup question, core.advancement ('levels' for XP levels, 'milestone'); what
// that needs is here:
//
//   levels: {
//     top: 10,                                  // the highest level
//     first: 300,                               // what level 2 costs
//     ranges: [{ to: 5, x: 2 }, { to: 10, x: 1.5 }],   // each level costs the last one's times x
//     typed: { 7: 5000 },                       // a total typed over: that level's, whatever the sums say
//   }
//
// The table holds running totals, and XP is never spent, so what a level doesn't need carries into the next
// by itself. The first range starts at level 1, each after the one before ends, and the last reaches the
// highest level, so every level has a multiplier. Level 2 costs `first`, so a multiplier first counts at level 3.
//
// A character's XP is kept on their sheet under XP_KEY, a name no field can have and a player's own edits
// can't reach: only the GM gives it (7d2a). It runs while the system answers XP LEVELS and has the XP part on.
//
// Pure: checks and reads only. The browser's copy of levelTable is sheets/levels.ts, held to this by its test.

const { partOn } = require('./parts');
const { parse } = require('./expression');
const { tablesOf } = require('./derived');

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** Where a sheet keeps its XP. */
const XP_KEY = '_xp';

const LIMITS = { top: 30, xp: 1000000000000, ranges: 30, times: 100, formula: 1000 };
const KEYS = new Set(['top', 'first', 'ranges', 'typed', 'health']);
/** MAX HEALTH (7d4): AS IT IS, the token's own number, A FORMULA it is worked out from, or PER LEVEL (7d5a). */
const HEALTH_HOWS = ['as_is', 'formula', 'level'];
const HEALTH_KEYS = new Set(['how', 'formula', 'die_on', 'die', 'gain', 'adds', 'beat_way', 'pool_count', 'pool_die', 'gain_die']);
/** PER LEVEL: the die is each class's HIT DIE (choices.js), or one for every level. */
const DIE_ONS = ['class', 'all'];
/** How a level's health is gained: AVERAGE (FIXED), ROLL, THE PLAYER CHOOSES (7d5b), or REROLL ALL, KEEP HIGHER (7d5c). */
const GAINS = ['average', 'roll', 'choose', 'reroll', 'beat'];
/** ROLL TO BEAT (7d5d): what is rolled to beat the maximum: A POOL (6d10, Mörk Borg) or A DIE PER LEVEL. */
const BEAT_WAYS = ['pool', 'level'];
const POOL_MOST = 20;
/** What ROLL TO BEAT starts with: a pool of 6d10, a d6 gained. */
const BEAT_DEFAULTS = { way: 'pool', count: 6, die: 10, gain: 6 };
/** The dice a level's health can roll: as a class's HIT DIE takes. */
const HEALTH_DIE = { least: 2, most: 100 };
/** Where a sheet keeps what each level gained (7d5a): { "<character level>": { die, took } }, level 1 left to the full die. */
const HEALTH_LEVELS_KEY = '_health_levels';
/**
 * Where a sheet keeps an uploaded maximum (7d7c): { max, level }, the base for its first `level` levels, each level
 * gained after them adding to it. It counts while the character is at that level or above.
 */
const HEALTH_BASE_KEY = '_health_base';
/** The most an uploaded maximum can be. */
const HEALTH_BASE_MOST = 9999;
/** An uploaded maximum, as kept: { max, level }, or null. */
const healthBaseOf = (data) => {
  const b = isPlainObject(data) ? data[HEALTH_BASE_KEY] : null;
  return isPlainObject(b) && Number.isInteger(b.max) && b.max >= 1 && b.max <= HEALTH_BASE_MOST && Number.isInteger(b.level) && b.level >= 1
    ? { max: b.max, level: b.level } : null;
};
/** A maximum as uploaded, commas and all, or null when it isn't a whole one from 1 to the most. */
const healthBaseFrom = (value) => {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  const digits = String(value).replace(/[,\s]/g, '');
  const n = digits === '' ? NaN : Number(digits);
  return Number.isInteger(n) && n >= 1 && n <= HEALTH_BASE_MOST ? n : null;
};
const RANGE_KEYS = new Set(['to', 'x']);
/** What the page starts from, and a system saying nothing has. */
const DEFAULTS = { top: 10, first: 300, ranges: [{ to: 10, x: 2 }] };

/** A system's levels, with what it leaves unsaid filled in. */
const levelsOf = (definition) => {
  const set = definition && isPlainObject(definition.levels) ? definition.levels : {};
  return {
    top: Number.isInteger(set.top) && set.top >= 2 && set.top <= LIMITS.top ? set.top : DEFAULTS.top,
    first: Number.isInteger(set.first) && set.first >= 1 ? set.first : DEFAULTS.first,
    ranges: Array.isArray(set.ranges) && set.ranges.length ? set.ranges.filter(isPlainObject) : DEFAULTS.ranges,
    typed: isPlainObject(set.typed) ? set.typed : {},
  };
};

/** The running total of XP to reach each level from 2: { 2: 300, 3: 900 }. Never past the most a number holds. */
const levelTable = (definition) => {
  const { top, first, ranges, typed } = levelsOf(definition);
  const table = {};
  let cost = first;
  let total = 0;
  for (let level = 2; level <= top; level += 1) {
    if (level > 2) {
      const range = ranges.find((r) => level <= r.to) || ranges[ranges.length - 1];
      cost *= Number(range.x) || 1;
    }
    total = Math.min(LIMITS.xp, total + Math.round(cost));
    table[level] = Number.isInteger(typed[level]) ? typed[level] : total;
  }
  return table;
};

/** Whether this system's characters earn XP toward levels. */
const earnsXp = (definition) => !!definition && isPlainObject(definition.core) && Array.isArray(definition.core.advancement)
  && definition.core.advancement.includes('levels') && partOn(definition, 'xp');

/** Whether this system's characters go up at all here: by XP, or the GM saying so (milestone). */
const advances = (definition) => earnsXp(definition)
  || (!!definition && isPlainObject(definition.core) && Array.isArray(definition.core.advancement) && definition.core.advancement.includes('milestone'));

/** What the browser needs (7d2): the highest level, and the XP table if there's a meter. Null where they don't go up. */
const levelsShown = (definition) => {
  if (!advances(definition)) return null;
  const h = healthOf(definition);
  // PER LEVEL (7d5a): how a level gains it, and the die of each class, for LEVEL_UP.EXE's HEALTH.
  const dice = {};
  for (const c of (Array.isArray(definition.choices) ? definition.choices : []).filter((l) => isPlainObject(l) && l.levelled === true)) {
    for (const o of (Array.isArray(c.options) ? c.options : []).filter(isPlainObject)) if (typeof o.id === 'string' && levelDie(definition, o) !== null) dice[o.id] = levelDie(definition, o);
  }
  return {
    top: levelsOf(definition).top, ...(earnsXp(definition) ? { table: levelTable(definition) } : {}),
    ...(h.how === 'level' ? { health: { gain: h.gain, dieOn: h.dieOn, ...(h.die ? { die: h.die } : {}), dice, ...(h.gain === 'beat' ? { beat: h.beat } : {}) } } : {}),
  };
};

/**
 * MAX HEALTH as set (7d4): { how, formula? }, and PER LEVEL's (7d5a) { dieOn, die?, gain, adds? }. What isn't the
 * way chosen is kept, for going back to it.
 */
const healthOf = (definition) => {
  const h = definition && isPlainObject(definition.levels) && isPlainObject(definition.levels.health) ? definition.levels.health : {};
  return {
    how: HEALTH_HOWS.includes(h.how) ? h.how : 'as_is',
    ...(typeof h.formula === 'string' ? { formula: h.formula } : {}),
    dieOn: DIE_ONS.includes(h.die_on) ? h.die_on : 'class',
    ...(Number.isInteger(h.die) && h.die >= HEALTH_DIE.least && h.die <= HEALTH_DIE.most ? { die: h.die } : {}),
    gain: GAINS.includes(h.gain) ? h.gain : 'average',
    ...(typeof h.adds === 'string' && h.adds.trim() ? { adds: h.adds } : {}),
    beat: {
      way: BEAT_WAYS.includes(h.beat_way) ? h.beat_way : BEAT_DEFAULTS.way,
      count: Number.isInteger(h.pool_count) && h.pool_count >= 1 && h.pool_count <= POOL_MOST ? h.pool_count : BEAT_DEFAULTS.count,
      die: Number.isInteger(h.pool_die) && h.pool_die >= HEALTH_DIE.least && h.pool_die <= HEALTH_DIE.most ? h.pool_die : BEAT_DEFAULTS.die,
      gain: Number.isInteger(h.gain_die) && h.gain_die >= HEALTH_DIE.least && h.gain_die <= HEALTH_DIE.most ? h.gain_die : BEAT_DEFAULTS.gain,
    },
  };
};

/** The die a level rolls (7d5a): `option`'s HIT DIE, or the one for all. Null without one. */
const levelDie = (definition, option) => {
  const h = healthOf(definition);
  if (h.dieOn === 'all') return h.die ?? null;
  return option && Number.isInteger(option.die) ? option.die : null;
};
/** AVERAGE (FIXED): half the die, rounded up. */
const averageOf = (die) => (Number.isInteger(die) ? Math.ceil(die / 2) : 0);

/**
 * A formula of max health's, read only while the way it belongs to is chosen (one kept for going back to it isn't);
 * `required` says one must be written then.
 */
const checkHealthFormula = (definition, text, where, inUse, required, problems) => {
  if (text !== undefined && typeof text !== 'string') { problems.push({ where, message: 'Must be a formula' }); return; }
  if (!inUse) return;
  if (text === undefined || !text.trim()) { if (required) problems.push({ where, message: 'Write the formula max health is worked out from' }); return; }
  if (text.length > LIMITS.formula) { problems.push({ where, message: `At most ${LIMITS.formula} characters` }); return; }
  const tables = tablesOf(isPlainObject(definition.lookups) ? definition.lookups : undefined);
  try { parse(text, (name) => Object.prototype.hasOwnProperty.call(tables, name)); } catch (e) { problems.push({ where, message: e.message }); }
};

const checkHealth = (definition, h, problems) => {
  const where = 'levels, health';
  if (!isPlainObject(h)) { problems.push({ where, message: 'Must say how max health is set' }); return; }
  for (const key of Object.keys(h)) if (!HEALTH_KEYS.has(key)) problems.push({ where: `${where}, ${key}`, message: 'Not part of max health' });
  if (!HEALTH_HOWS.includes(h.how)) problems.push({ where: `${where}, how`, message: 'AS IT IS, A FORMULA or PER LEVEL' });
  checkHealthFormula(definition, h.formula, `${where}, formula`, h.how === 'formula', true, problems);
  checkHealthFormula(definition, h.adds, `${where}, adds`, h.how === 'level', false, problems);
  if (h.die_on !== undefined && !DIE_ONS.includes(h.die_on)) problems.push({ where: `${where}, die_on`, message: 'ON EACH CLASS or ONE FOR ALL' });
  if (h.die !== undefined && (!Number.isInteger(h.die) || h.die < HEALTH_DIE.least || h.die > HEALTH_DIE.most)) problems.push({ where: `${where}, die`, message: `A die of ${HEALTH_DIE.least} to ${HEALTH_DIE.most} sides` });
  if (h.gain !== undefined && !GAINS.includes(h.gain)) problems.push({ where: `${where}, gain`, message: 'AVERAGE (FIXED), ROLL, THE PLAYER CHOOSES, REROLL ALL, KEEP HIGHER or ROLL TO BEAT' });
  if (h.beat_way !== undefined && !BEAT_WAYS.includes(h.beat_way)) problems.push({ where: `${where}, beat_way`, message: 'A POOL or A DIE PER LEVEL' });
  if (h.pool_count !== undefined && (!Number.isInteger(h.pool_count) || h.pool_count < 1 || h.pool_count > POOL_MOST)) problems.push({ where: `${where}, pool_count`, message: `From 1 to ${POOL_MOST} dice` });
  for (const key of ['pool_die', 'gain_die']) {
    if (h[key] !== undefined && (!Number.isInteger(h[key]) || h[key] < HEALTH_DIE.least || h[key] > HEALTH_DIE.most)) problems.push({ where: `${where}, ${key}`, message: `A die of ${HEALTH_DIE.least} to ${HEALTH_DIE.most} sides` });
  }
  if (h.how === 'level' && h.die_on === 'all' && h.die === undefined) problems.push({ where: `${where}, die`, message: 'Pick the die every level rolls' });
};

/** A definition's levels checked, its problems added to `problems`. */
const checkLevels = (definition, problems) => {
  const set = definition.levels;
  if (set === undefined) return;
  if (!isPlainObject(set)) { problems.push({ where: 'levels', message: 'Must say how levels work' }); return; }
  if (set.health !== undefined) checkHealth(definition, set.health, problems);
  for (const key of Object.keys(set)) if (!KEYS.has(key)) problems.push({ where: `levels, ${key}`, message: 'Not part of levels' });
  if (set.top !== undefined && (!Number.isInteger(set.top) || set.top < 2 || set.top > LIMITS.top)) problems.push({ where: 'levels, top', message: `The highest level is from 2 to ${LIMITS.top}` });
  if (set.first !== undefined && (!Number.isInteger(set.first) || set.first < 1 || set.first > LIMITS.xp)) problems.push({ where: 'levels, first', message: 'Level 2 costs a whole amount, 1 or more' });
  const { top } = levelsOf(definition);
  if (set.ranges !== undefined) {
    if (!Array.isArray(set.ranges) || !set.ranges.length) problems.push({ where: 'levels, ranges', message: 'Must be a list of ranges' });
    else {
      if (set.ranges.length > LIMITS.ranges) problems.push({ where: 'levels, ranges', message: `At most ${LIMITS.ranges} ranges` });
      let before = 0;
      set.ranges.forEach((r, i) => {
        const where = `levels, range ${i + 1}`;
        if (!isPlainObject(r)) { problems.push({ where, message: 'Must be a range' }); return; }
        for (const key of Object.keys(r)) if (!RANGE_KEYS.has(key)) problems.push({ where: `${where}, ${key}`, message: 'Not part of a range' });
        if (!Number.isInteger(r.to) || r.to <= before) problems.push({ where, message: 'Must end after the range before it' });
        else before = r.to;
        if (typeof r.x !== 'number' || r.x < 1 || r.x > LIMITS.times) problems.push({ where, message: `Each level costs from 1 to ${LIMITS.times} times the last` });
      });
      const last = set.ranges[set.ranges.length - 1];
      if (isPlainObject(last) && last.to !== top) problems.push({ where: 'levels, ranges', message: `The last range must reach the highest level, ${top}` });
    }
  }
  if (set.typed !== undefined) {
    if (!isPlainObject(set.typed)) { problems.push({ where: 'levels, typed', message: 'Must say the total for each level typed over' }); return; }
    for (const [level, total] of Object.entries(set.typed)) {
      if (!/^\d+$/.test(level)) problems.push({ where: `levels, typed, ${level}`, message: 'Must be a level' });
      else if (!Number.isInteger(total) || total < 0 || total > LIMITS.xp) problems.push({ where: `levels, level ${level}`, message: 'A whole amount, 0 or more' });
    }
    // Only where something was typed: the sums always climb, until they reach the most a number holds.
    const table = levelTable(definition);
    for (let level = 3; level <= top; level += 1) {
      const touched = set.typed[level] !== undefined || set.typed[level - 1] !== undefined;
      if (touched && table[level] <= table[level - 1]) problems.push({ where: `levels, level ${level}`, message: `Level ${level} needs more than level ${level - 1}, ${table[level - 1]}` });
    }
  }
};

module.exports = { LIMITS, DEFAULTS, XP_KEY, levelsOf, levelTable, earnsXp, advances, levelsShown, checkLevels, healthOf, HEALTH_HOWS, GAINS, HEALTH_LEVELS_KEY, HEALTH_BASE_KEY, HEALTH_BASE_MOST, healthBaseOf, healthBaseFrom, levelDie, averageOf };
