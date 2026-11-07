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
// Pure: checks and reads only. The browser's copy of levelTable is sheets/levels.ts, held to this by its test.

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

const LIMITS = { top: 30, xp: 1000000000000, ranges: 30, times: 100 };
const KEYS = new Set(['top', 'first', 'ranges', 'typed']);
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

/** A definition's levels checked, its problems added to `problems`. */
const checkLevels = (definition, problems) => {
  const set = definition.levels;
  if (set === undefined) return;
  if (!isPlainObject(set)) { problems.push({ where: 'levels', message: 'Must say how levels work' }); return; }
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

module.exports = { LIMITS, DEFAULTS, levelsOf, levelTable, checkLevels };
