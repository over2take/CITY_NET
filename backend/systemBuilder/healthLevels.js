// MAX HEALTH: PER LEVEL (7d5a; approved mockup docs/mockups/level-up.html, 2026-11-07). Level 1 is the full die of
// the first class (or the die for all); each level after it, what it gained, kept on the sheet as it went up
// (levelUp.js), a level with nothing kept counting as the average. EACH LEVEL ADDS is read as the sheet is now, so
// a stat changing recounts every level. Never less than 1 in a level. The token's maximum follows it (tokenMax.js).
//
// REROLL ALL, KEEP HIGHER (7d5c, Cities Without Number): going up, every level's die is rolled again with what each
// level adds for each; over the current maximum, that total is the new maximum, otherwise it goes up by 1. What that
// level added is kept as `gained`, the level's own share, already counted, so it isn't recounted when a stat changes.
//
// ROLL TO BEAT (7d5d): going up, a pool (6d10, Mörk Borg's) or a die for every level is rolled against the current
// maximum; beaten, the level gains the gain die (or, by level, the new level's die and what each level adds); not
// beaten, nothing: a `gained` of 0.
//
// What each level gained, put right (7d7b; approved mockup docs/mockups/level-record.html, 2026-11-09): a kept roll
// the GM clears is kept as `cleared`, counting as its die's average until the player rolls it again; a level the
// GM sets is kept as `set`, the die's part, what each level adds still on top. Level 1, the full die, may be set
// too. Each level says how it was kept (rolled, set, cleared), for the record on the sheet.

const { heldOf } = require('./choices');
const { healthOf, levelDie, averageOf, HEALTH_LEVELS_KEY } = require('./levels');
const { characterLevel } = require('./levelUp');
const { formulaValueOf, healthFormulaValue } = require('./healthFormula');

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** What each level gained, as the sheet keeps it: { level: took }. */
const keptOf = (data) => {
  const kept = isPlainObject(data) && isPlainObject(data[HEALTH_LEVELS_KEY]) ? data[HEALTH_LEVELS_KEY] : {};
  const out = {};
  for (const [level, k] of Object.entries(kept)) if (isPlainObject(k) && Number.isInteger(k.took) && k.took >= 0) out[level] = k.took;
  return out;
};
/** What a level was kept as adding outright (7d5c): { level: gained }, from a reroll, or a roll to beat that may add nothing. */
const gainedOf = (data) => {
  const kept = isPlainObject(data) && isPlainObject(data[HEALTH_LEVELS_KEY]) ? data[HEALTH_LEVELS_KEY] : {};
  const out = {};
  for (const [level, k] of Object.entries(kept)) if (isPlainObject(k) && Number.isInteger(k.gained) && k.gained >= 0) out[level] = k.gained;
  return out;
};
/** The die each level had, as kept, or the first class's. */
const diesOf = (data, first) => {
  const kept = isPlainObject(data) && isPlainObject(data[HEALTH_LEVELS_KEY]) ? data[HEALTH_LEVELS_KEY] : {};
  return (level) => (isPlainObject(kept[level]) && Number.isInteger(kept[level].die) ? kept[level].die : first);
};

/** How each level was kept, for the record (7d7b): { level: { rolled?, set?, cleared? } }. */
const howOf = (data) => {
  const kept = isPlainObject(data) && isPlainObject(data[HEALTH_LEVELS_KEY]) ? data[HEALTH_LEVELS_KEY] : {};
  const out = {};
  for (const [level, k] of Object.entries(kept)) {
    if (!isPlainObject(k)) continue;
    const how = { ...(k.rolled === true ? { rolled: true } : {}), ...(k.set === true ? { set: true } : {}), ...(k.cleared === true ? { cleared: true } : {}) };
    out[level] = how;
  }
  return out;
};

/** The first class they hold, whose die level 1 is. */
const firstClassOf = (definition, data) => heldOf(definition, data).find((p) => p.active && !p.from && p.list.levelled === true) || null;

/** PER LEVEL's max health for this sheet: { max, adds, levels: [{ level, took }] }, or null where health isn't per level. */
const healthByLevel = (definition, data) => {
  const h = healthOf(definition);
  if (h.how !== 'level') return null;
  const sheet = isPlainObject(data) ? data : {};
  const adds = h.adds ? Math.floor(formulaValueOf(definition, sheet, h.adds) ?? 0) : 0;
  const first = firstClassOf(definition, sheet);
  const die = levelDie(definition, first ? first.option : null);
  const kept = keptOf(sheet);
  const fixed = gainedOf(sheet);
  const dieAt = diesOf(sheet, die);
  const how = howOf(sheet);
  // Level 1 is the full die, unless the GM set it (7d7b).
  const one = how[1] && how[1].set && 1 in kept ? kept[1] : die ?? 0;
  const levels = [{ level: 1, took: one, die, ...(how[1] && how[1].set ? { set: true } : {}) }];
  for (let level = 2; level <= characterLevel(definition, sheet); level += 1) {
    // Nothing kept, or cleared: the average of that level's own die.
    levels.push({ level, took: kept[level] ?? averageOf(dieAt(level)), die: dieAt(level), ...(level in fixed ? { gained: fixed[level] } : {}), ...(how[level] || {}) });
  }
  return { max: levels.reduce((n, l) => n + (l.gained ?? Math.max(1, l.took + adds)), 0), adds, levels };
};

/**
 * REROLL ALL, KEEP HIGHER (7d5c): every level's die rolled again and the new level's `die`, each with what each level adds.
 * { total, rolls: [{ die, roll }], over, gained }: over the current maximum, `gained` takes it there; otherwise 1.
 * A level with no die rolls nothing, adding only what each level adds.
 */
const rerollAll = (definition, data, die, rng) => {
  const now = healthByLevel(definition, data);
  const dice = [...now.levels.map((l) => l.die), die];
  const rolls = dice.filter((d) => Number.isInteger(d)).map((d) => ({ die: d, roll: Math.floor(rng() * d) + 1 }));
  const total = rolls.reduce((n, r) => n + r.roll, 0) + now.adds * dice.length;
  return { total, rolls, over: now.max, gained: total > now.max ? total - now.max : 1 };
};

/** The token's maximum before any feature's bonus: the formula's (7d4) or per level's (7d5a). Null where it's as it is. */
const healthBase = (definition, data) => {
  const h = healthOf(definition);
  if (h.how === 'formula') return healthFormulaValue(definition, data);
  return h.how === 'level' ? healthByLevel(definition, data).max : null;
};

/**
 * ROLL TO BEAT (7d5d): { total, rolls: [{ die, roll }], over, beaten, gained, gainRoll }: the pool, or every level's
 * die and the new level's with what each level adds, against the current maximum. Beaten, `gained` is the gain die's
 * roll (by level: the new level's die again and what each level adds, at least 1); not beaten, 0.
 */
const rollToBeat = (definition, data, die, rng) => {
  const { beat } = healthOf(definition);
  const now = healthByLevel(definition, data);
  const roll = (d) => ({ die: d, roll: Math.floor(rng() * d) + 1 });
  const dice = beat.way === 'pool' ? Array(beat.count).fill(beat.die) : [...now.levels.map((l) => l.die), die];
  const rolls = dice.filter((d) => Number.isInteger(d)).map(roll);
  const total = rolls.reduce((n, r) => n + r.roll, 0) + (beat.way === 'pool' ? 0 : now.adds * dice.length);
  const beaten = total > now.max;
  const gainDie = beat.way === 'pool' ? beat.gain : die;
  const gainRoll = beaten && Number.isInteger(gainDie) ? roll(gainDie) : null;
  const gained = !beaten ? 0 : beat.way === 'pool' ? gainRoll.roll : Math.max(1, (gainRoll ? gainRoll.roll : 0) + now.adds);
  return { total, rolls, over: now.max, beaten, gained, gainRoll };
};

module.exports = { healthByLevel, healthBase, keptOf, rerollAll, rollToBeat };
