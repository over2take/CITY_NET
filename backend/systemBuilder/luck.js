// Luck (8c5a; approved mockup docs/mockups/rule-library.html, section 1's LUCK card and section 4, every recommended answer):
// points a character spends on a roll before it is thrown, as Cyberpunk RED's LUCK or a dice pool game's EDGE.
//
//   luck: {
//     name: 'LUCK',                     // CALLED: what the sheet and the log say (EDGE)
//     most: '@luck',                    // THE MOST: a number or a formula of the character's own
//     each: 'plus',                     // EACH POINT ADDS +1 ('plus') or A DIE ('die', of the roll's first kind)
//     on: 'all',                        // ON EVERY ROLL, or ONLY THESE ROLLS: ['shoot', 'dodge']
//     refills: ['end_of_session'],      // REFILLED BY these rests (and REFILL LUCK on the GAME tab, the GM's)
//   }
//
// On with the PARTS row LUCK and the section written. A character's points left are kept on their sheet (LUCK_KEY), none kept
// meaning all of them: a refill only lets go of what was kept. Spent from the strip before a roll (8c6), set aside then spent by
// the roll the sheet makes next; the socket checks there are enough, rolls with them, and takes them off.
//
// Pure: the definition checks, the rolls and the rests read it.

const { rollAmount } = require('./tierRolls');
const { partOn } = require('./parts');
const { namesOf, effectiveData } = require('./choices');
const { restIdsOf } = require('./rests');

/** Where a character's points left are kept on their sheet; none kept is all of them. */
const LUCK_KEY = '_luck';
const EACH = ['plus', 'die'];
const LIMITS = { name: 30, text: 200, most: 99, spend: 20, rolls: 50 };
const START = { name: 'LUCK', most: '3', each: 'plus', on: 'all', refills: ['end_of_session'] };
const LUCK_KEYS = new Set(['name', 'most', 'each', 'on', 'refills']);
const NAME = /^[A-Za-z][A-Za-z0-9 '-]*$/;

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const namesFor = (definition) => {
  const names = namesOf(definition);
  return { known: (n) => names.has(n), refused: (n) => `@${n} isn't one of this system's names` };
};
const rollIdsOf = (definition) => new Set((Array.isArray(definition.rolls) ? definition.rolls : []).filter((r) => isPlainObject(r) && typeof r.id === 'string').map((r) => r.id));

/** Problems with a definition's `luck`, pushed onto `problems`. */
const checkLuck = (definition, problems) => {
  const luck = definition.luck;
  if (luck === undefined) return;
  if (!isPlainObject(luck)) { problems.push({ where: 'luck', message: 'Must say what luck is called, its most and what a point does' }); return; }
  for (const key of Object.keys(luck)) if (!LUCK_KEYS.has(key)) problems.push({ where: `luck, ${key}`, message: 'Not part of luck' });
  if (luck.name !== undefined) {
    if (typeof luck.name !== 'string' || !luck.name.trim()) problems.push({ where: 'luck, name', message: 'Needs a name, as LUCK' });
    else if (luck.name.trim().length > LIMITS.name) problems.push({ where: 'luck, name', message: `Longer than ${LIMITS.name} characters` });
    else if (!NAME.test(luck.name.trim())) problems.push({ where: 'luck, name', message: 'Letters, digits, spaces, a hyphen or an apostrophe, starting with a letter' });
  }
  if (luck.most !== undefined) {
    const read = typeof luck.most === 'number' || (typeof luck.most === 'string' && luck.most.length <= LIMITS.text)
      ? rollAmount(luck.most, {}, namesFor(definition), () => 0) : { error: 'A number or a formula' };
    if ('error' in read) problems.push({ where: 'luck, most', message: read.error });
    else if ('blank' in read) problems.push({ where: 'luck, most', message: 'Needs a number or a formula' });
    else if (read.dice.length) problems.push({ where: 'luck, most', message: 'A number or a formula, not dice' });
  }
  if (luck.each !== undefined && !EACH.includes(luck.each)) problems.push({ where: 'luck, each', message: 'plus or die' });
  if (luck.on !== undefined && luck.on !== 'all') {
    if (!Array.isArray(luck.on)) problems.push({ where: 'luck, on', message: 'all, or a list of rolls' });
    else {
      if (luck.on.length > LIMITS.rolls) problems.push({ where: 'luck, on', message: `At most ${LIMITS.rolls}` });
      const rolls = rollIdsOf(definition);
      luck.on.forEach((id, i) => { if (!rolls.has(id)) problems.push({ where: `luck, on ${i + 1}`, message: 'Not one of this system\'s rolls' }); });
    }
  }
  if (luck.refills !== undefined) {
    if (!Array.isArray(luck.refills)) problems.push({ where: 'luck, refills', message: 'Must be a list of rests' });
    else {
      const rests = restIdsOf(definition);
      luck.refills.forEach((id, i) => { if (!rests.has(id)) problems.push({ where: `luck, refills ${i + 1}`, message: 'Not one of this system\'s rests' }); });
    }
  }
};

/** The game's rule, every key filled in, or null where it is off or not written. */
const luckRuleOf = (definition) => {
  if (!isPlainObject(definition) || !isPlainObject(definition.luck) || !partOn(definition, 'luck')) return null;
  const l = definition.luck;
  return {
    name: typeof l.name === 'string' && l.name.trim() ? l.name.trim().toUpperCase() : START.name,
    most: typeof l.most === 'number' || (typeof l.most === 'string' && l.most.trim()) ? String(l.most).trim() : START.most,
    each: EACH.includes(l.each) ? l.each : START.each,
    on: Array.isArray(l.on) ? l.on.filter((id) => typeof id === 'string') : 'all',
    refills: Array.isArray(l.refills) ? l.refills.filter((id) => typeof id === 'string') : START.refills,
  };
};

/** A character's luck: the most they may have, worked out on their sheet, and what they have left (all of it, kept none). */
const luckOf = (definition, rule, data) => {
  const read = rollAmount(rule.most, effectiveData(definition, data || {}), namesFor(definition), () => 0);
  const most = 'value' in read ? Math.max(0, Math.min(LIMITS.most, read.value)) : 0;
  const kept = data ? data[LUCK_KEY] : undefined;
  const current = Number.isInteger(kept) ? Math.max(0, Math.min(most, kept)) : most;
  return { current, most };
};

/** Whether luck may be spent on this roll. */
const luckOn = (rule, rollId) => !!rule && (rule.on === 'all' || rule.on.includes(rollId));

/**
 * A roll with `n` points spent on it (8c5a): `{ roll, chosen, terms }` for rollField. +1 a point is a term the log names
 * (+ 2 LUCK); a die a point is a change adding as many dice of the roll's first kind (the log says 2 EDGE).
 */
const withLuck = (rule, roll, n) => {
  if (rule.each === 'die') {
    return { roll: { ...roll, changes: [...(Array.isArray(roll.changes) ? roll.changes : []), { id: '_luck', label: `${n} ${rule.name}`, extra: { dice: n } }] }, chosen: ['_luck'], terms: [] };
  }
  return { roll, chosen: [], terms: [{ label: rule.name, amount: n }] };
};

/** Whether a rest refills luck: it, or a rest it counts as, among REFILLED BY. `ends` are the rests it is, as restOrder gives them. */
const refilledAt = (rule, ends) => !!rule && rule.refills.some((id) => ends.has(id));

/** The rule as a sheet shows it (8c6): its name, what a point does, the rolls it is on. Null without it. */
const luckShown = (definition) => {
  const rule = luckRuleOf(definition);
  return rule ? { name: rule.name, each: rule.each, on: rule.on } : null;
};

module.exports = { LUCK_KEY, EACH, LIMITS, START, checkLuck, luckRuleOf, luckOf, luckOn, withLuck, refilledAt, luckShown };
