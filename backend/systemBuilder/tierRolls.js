// NPC tiers that roll (4b4a1). Approved mockup docs/mockups/builder-npcs.html (2026-10-07): a tier
// is a difficulty, GENERATE_SHEET asks for a level, and each of a tier's boxes (HP, defense, every
// number on the stat block) is a number, a formula reading @level, or dice:
//
//   14                      a number
//   12 + floor(@level / 3)  a formula, in the language derived values use (expression.js)
//   3d6 + 2                 dice
//   @level d8 + 4           as many dice as the level
//
// Dice are taken out first, each replaced by a name only this file uses, and the rest is the
// ordinary safe expression language: nothing else can be named but @level and its built-in
// functions, so a tier can compute a wrong number but cannot do anything else. Each die is rolled
// once, when its term is reached. The result is a whole number, rounded.
//
// A rest's amounts (4f, rests.js) are read the same way, naming the character's own numbers
// rather than @level ("1d8 + @con_mod", "@level d6"): NAMES says what a box may name.

const crypto = require('crypto');
const { parse, evaluate, references, ExpressionError, BUILTINS } = require('./expression');

const LIMITS = { dice: 100, sides: 1000, level: 99 };

/** "3d6", "d20", "@level d8": an optional count (a number or a name), then d and the sides. */
const DICE = /(^|[^\w@.])(?:(\d+|@[a-zA-Z_][a-zA-Z0-9_]*)\s*)?d(\d+)(?![\w.])/gi;
const DIE = (i) => `@tier_die_${i}`;

/** A whole number from 0 to 1 below 1, from the operating system's random source. */
const cryptoRng = () => crypto.randomInt(0, 2 ** 32) / 2 ** 32;

/** What a tier's box may name: @level alone. */
const TIER_NAMES = { known: (name) => name === 'level', refused: (name) => `Only @level can be used here, not @${name}` };

/**
 * A box's text as a tree and its dice, or an ExpressionError saying what is wrong with it. Only
 * the names `names` knows (a tier's: @level) and the built-in functions can be named.
 */
const prepare = (text, names = TIER_NAMES) => {
  for (const m of String(text).matchAll(/@([a-zA-Z_][a-zA-Z0-9_]*)/g)) {
    if (!names.known(m[1])) throw new ExpressionError(names.refused(m[1]));
  }
  const dice = [];
  const source = String(text).replace(DICE, (_, before, count, sides) => {
    const n = Number(sides);
    if (n < 2 || n > LIMITS.sides) throw new ExpressionError(`A die has 2 to ${LIMITS.sides} sides`);
    if (count !== undefined && !count.startsWith('@') && Number(count) > LIMITS.dice) throw new ExpressionError(`At most ${LIMITS.dice} dice`);
    dice.push({ count: count === undefined ? 1 : count.startsWith('@') ? { name: count.slice(1) } : Number(count), sides: n });
    return `${before}${DIE(dice.length - 1)}`;
  });
  let tree;
  try {
    tree = parse(source, (name) => !!BUILTINS[name]);
  } catch (err) {
    // The dice's stand-in names are this file's own; the GM wrote dice. Positions shift with
    // them, so they are left out.
    if (err instanceof ExpressionError) throw new ExpressionError(err.message.replace(/@?tier_die_\d+/g, 'dice').replace(/ \(at character \d+\)$/, ''));
    throw err;
  }
  const refs = references(tree);
  // Checked before the dice came out; kept as a backstop against a name that slipped through.
  for (const f of refs.fields) {
    if (!names.known(f) && !/^tier_die_\d+$/.test(f)) throw new ExpressionError(names.refused(f));
  }
  if (refs.rules.size) throw new ExpressionError(names === TIER_NAMES ? 'Only @level can be used here' : 'A rule can\'t be used here');
  return { tree, dice };
};

/** Why a box can't be worked out, or null when it can. A number, or nothing, is always fine. */
const boxProblem = (text, names = TIER_NAMES) => {
  if (text === undefined || text === null || typeof text === 'number') return null;
  if (typeof text !== 'string') return 'A number, a formula or dice';
  if (!text.trim()) return null;
  try { prepare(text, names); return null; } catch (err) { return err instanceof ExpressionError ? err.message : 'Not a number, formula or dice'; }
};

/** The level as a whole number from 0 to 99; 1 when none was given. */
const levelOf = (level) => (Number.isFinite(Number(level)) && level !== null && level !== '' ? Math.max(0, Math.min(LIMITS.level, Math.round(Number(level)))) : 1);

/**
 * A box worked out for a level: its whole-number value and each die rolled, as
 * { value, dice: [{ count, sides, rolls }] }, or { error } when it can't be. A blank box gives
 * { blank: true }. `rng` answers 0 to below 1, as the dice tray's does.
 */
const rollBox = (text, level, rng = cryptoRng) => rollAmount(text, { level: levelOf(level) }, TIER_NAMES, rng);

/**
 * Any box worked out with `values` for the names it may use (`names`, a tier's by default), as
 * rollBox answers. A name with no value counts as 0; a count of dice from a name is held to 0 to
 * LIMITS.dice.
 */
const rollAmount = (text, values, names = TIER_NAMES, rng = cryptoRng) => {
  if (text === undefined || text === null || (typeof text === 'string' && !text.trim())) return { blank: true };
  if (typeof text === 'number') return Number.isFinite(text) ? { value: Math.round(text), dice: [] } : { error: 'Not a number' };
  let prepared;
  try { prepared = prepare(text, names); } catch (err) { return { error: err instanceof ExpressionError ? err.message : 'Not a number, formula or dice' }; }
  const valueOf = (name) => { const n = Number(values && values[name]); return Number.isFinite(n) ? n : 0; };
  const rolled = prepared.dice.map((d) => {
    const count = Math.max(0, Math.min(LIMITS.dice, typeof d.count === 'object' ? Math.round(valueOf(d.count.name)) : d.count));
    const rolls = Array.from({ length: count }, () => Math.floor(rng() * d.sides) + 1);
    return { count, sides: d.sides, rolls };
  });
  const value = evaluate(prepared.tree, {
    field: (name) => (/^tier_die_\d+$/.test(name) ? rolled[Number(name.slice('tier_die_'.length))].rolls.reduce((a, b) => a + b, 0) : valueOf(name)),
    rule: () => 0,
  });
  return { value: Math.round(value), dice: rolled };
};

/**
 * A tier worked out for a level: its HP and defense (held to the token's limits) and each value
 * it sets, number fields rolled and others as written. `fields` are the NPC sheet's, by id.
 */
const rollTier = (tier, level, fields, limits, rng = cryptoRng) => {
  const clampTo = (box, max) => ('value' in box ? { ...box, value: Math.max(0, Math.min(max, box.value)) } : box);
  // In the order they are shown: HP, defense, then the stat block.
  const hp = clampTo(rollBox(tier.hp, level, rng), limits.hp);
  const defense = clampTo(rollBox(tier.defense, level, rng), limits.defense);
  const values = {};
  for (const [id, raw] of Object.entries(tier.values || {})) {
    const field = fields.get(id);
    values[id] = field && field.type === 'number' ? rollBox(raw, level, rng) : { value: raw, dice: [] };
  }
  return { level: levelOf(level), hp, defense, values };
};

module.exports = { rollBox, rollAmount, rollTier, boxProblem, levelOf, LIMITS };
