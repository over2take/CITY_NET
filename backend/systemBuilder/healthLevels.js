// MAX HEALTH: PER LEVEL (7d5a; approved mockup docs/mockups/level-up.html, 2026-11-07). Level 1 is the full die of
// the first class (or the die for all); each level after it, what it gained, kept on the sheet as it went up
// (levelUp.js), a level with nothing kept counting as the average. EACH LEVEL ADDS is read as the sheet is now, so
// a stat changing recounts every level. Never less than 1 in a level. The token's maximum follows it (tokenMax.js).

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
  const levels = [{ level: 1, took: die ?? 0 }];
  for (let level = 2; level <= characterLevel(definition, sheet); level += 1) {
    levels.push({ level, took: kept[level] ?? averageOf(die) });
  }
  return { max: levels.reduce((n, l) => n + Math.max(1, l.took + adds), 0), adds, levels };
};

/** The token's maximum before any feature's bonus: the formula's (7d4) or per level's (7d5a). Null where it's as it is. */
const healthBase = (definition, data) => {
  const h = healthOf(definition);
  if (h.how === 'formula') return healthFormulaValue(definition, data);
  return h.how === 'level' ? healthByLevel(definition, data).max : null;
};

module.exports = { healthByLevel, healthBase, keptOf };
