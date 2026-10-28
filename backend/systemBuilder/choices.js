// A system's choices (7a1a; approved mockup docs/mockups/builder-choices.html, 2026-10-27): the
// lists a character picks from (classes, backgrounds, feats, playbooks), named in the game's own
// words, and the features each pick gives.
//
//   choices: [
//     { id: 'classes', one: 'Class', many: 'Classes',
//       picks: 1,            // how many a character picks: a whole number, or 'any'; 1 when absent
//       levelled: true,      // each pick has a level, and its features unlock by it
//       again: true,         // MORE THAN ONCE: more can be added after those (multiclassing)
//       options: [
//         { id: 'soldier', label: 'Soldier', description: '...',
//           requires: '@str >= 13',          // optional: a formula, met when it isn't 0
//           features: [
//             { id: 'guard_stance', label: 'Guard Stance', text: 'Words for the table.',
//               at: 1,                                          // the pick's level it unlocks at (levelled lists)
//               modifiers: [{ target: 'defense', amount: '1' }], // added to a stat, formula or health field
//               uses: { count: '1', refill: 'short_rest' },     // ticked off on the sheet, refilled by a rest
//               rolls: ['rally'],                               // rolls of the system it gives
//               changes: [{ roll: 'mind_save', change: 'advantage' }], // a change it lets one roll take
//               choice: 'specialties' },                        // a list picked from when it unlocks
//           ] },
//       ] },
//   ]
//
// A feature does any of these, several at once, or none: then it is words for the table. Option and
// feature ids share one set across the system, as has() will read them (7b). A requirement is
// optional, per option: one not met is shown with the reason at the table, and the GM may pick it
// anyway.
//
// A character's picks (7a1b) are kept on their sheet under PICKS_KEY, a name no stat can have, as
// { classes: [{ option: 'soldier', level: 3 }, { option: 'mage', level: 1 }], feats: ['tough'] }.
// Players never write it directly (sheets/templates.js playerMayEdit); picking, with its checks,
// comes with the sheet (7a3). Read here, only what holds is kept: an option of that list, once, no
// more than the list allows, a level from 1 up in a levelled list (1 when it has none).
//
// Levels are read in formulas, rolls and modifier amounts: @<option>_level (0 when not taken),
// @<list>_level, a levelled list's sum, and @level, every levelled list's sum, unless the system
// has a stat or formula called level of its own, which keeps meaning what it always did (the user,
// 2026-10-27). A modifier's amount reads the sheet as typed and these levels, never a formula, so a
// feature's modifiers can never go round in a loop.
//
// What the picks do to the numbers is worked out, never written into a stat (overlayOf): a stat
// stays as the player typed it while formulas and rolls read it with its modifiers; a formula's own
// modifiers are added once it is worked out, before anything reading it. Take the pick away and its
// effects are gone at once. definition.js runs the checks; runtime.js, tableRolls.js and
// versionDiff.js read the overlay.

const { parse, evaluate, references, NAME } = require('./expression');
const { ruleValue } = require('./rules');
const { tablesOf, lookupIn } = require('./derived');
const { statIdsOf } = require('./stats');
const { restIdsOf } = require('./rests');
const { healthLayout } = require('./core');

/** Where a sheet keeps its picks: starting with _, so no stat, formula or field can be called it. */
const PICKS_KEY = '_choices';

const LIMITS = {
  lists: 20,
  options: 100,
  features: 40,
  modifiers: 10,
  rolls: 10,
  /** The highest level a feature unlocks at, and how many of a list a character may pick. */
  level: 30,
  picks: 100,
  label: 40,
  description: 1000,
};
const LIST_KEYS = new Set(['id', 'one', 'many', 'picks', 'levelled', 'again', 'options']);
const OPTION_KEYS = new Set(['id', 'label', 'description', 'requires', 'features']);
const FEATURE_KEYS = new Set(['id', 'label', 'text', 'at', 'modifiers', 'uses', 'rolls', 'changes', 'choice']);

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);

/** A definition's lists, the entries well formed enough to read. */
const choicesOf = (definition) => list(definition && definition.choices).filter((c) => isPlainObject(c) && typeof c.id === 'string');

/** The sheet's own fields a modifier may change: the system's stats and health fields. */
const fieldTargetsOf = (definition) => new Set([
  ...statIdsOf(definition),
  ...healthLayout(isPlainObject(definition.core) ? definition.core.health : undefined).sections.flatMap((s) => s.fields.map((f) => f.id)),
].filter((id) => typeof id === 'string'));
const derivedIdsOf = (definition) => new Set(list(definition.derived).filter(isPlainObject).map((d) => d.id).filter((id) => typeof id === 'string'));

/** What a modifier may change: the system's stats, formulas and health fields. */
const targetsOf = (definition) => new Set([...fieldTargetsOf(definition), ...derivedIdsOf(definition)]);

const optionsOf = (c) => list(c.options).filter((o) => isPlainObject(o) && typeof o.id === 'string');
const levelledOf = (definition) => choicesOf(definition).filter((c) => c.levelled === true);

/** The level names a system's formulas can read: each option's, each list's sum, and @level unless it has its own. */
const levelNamesOf = (definition) => {
  const levelled = levelledOf(definition);
  return new Set([
    ...levelled.flatMap((c) => [`${c.id}_level`, ...optionsOf(c).map((o) => `${o.id}_level`)]),
    ...(levelled.length && !targetsOf(definition).has('level') ? ['level'] : []),
  ]);
};

/** A definition's `choices` checked, its problems added to `problems`. */
const checkChoices = (definition, problems) => {
  const lists = definition.choices;
  if (lists === undefined) return;
  if (!Array.isArray(lists)) { problems.push({ where: 'choices', message: 'Must be a list of choices' }); return; }
  if (lists.length > LIMITS.lists) problems.push({ where: 'choices', message: `At most ${LIMITS.lists} lists` });

  const tables = new Set(isPlainObject(definition.lookups) ? Object.keys(definition.lookups) : []);
  const isFunction = (name) => tables.has(name);
  const targets = targetsOf(definition);
  const formulas = derivedIdsOf(definition);
  const levels = levelNamesOf(definition);
  const optionLevels = new Set(levelledOf(definition).flatMap((c) => optionsOf(c).map((o) => `${o.id}_level`)));
  const rests = restIdsOf(definition);
  const rolls = new Map(list(definition.rolls).filter((r) => isPlainObject(r) && typeof r.id === 'string')
    .map((r) => [r.id, new Set(list(r.changes).filter(isPlainObject).map((c) => c.id))]));
  const listIds = new Set(choicesOf(definition).map((c) => c.id));
  const listSeen = new Set();
  const named = new Set();

  const text = (value, where, max, { required = false } = {}) => {
    if (value === undefined) { if (required) problems.push({ where, message: 'Required' }); return; }
    if (typeof value !== 'string' || (required && !value.trim())) { problems.push({ where, message: required ? 'Cannot be blank' : 'Must be text' }); return; }
    if (value.length > max) problems.push({ where, message: `Longer than ${max} characters` });
  };
  const formula = (value, where) => {
    if (typeof value !== 'string' || !value.trim()) { problems.push({ where, message: 'Must be formula text' }); return; }
    try { parse(value, isFunction); } catch (e) { problems.push({ where, message: e.message }); }
  };
  const id = (value, where, seen, what) => {
    if (typeof value !== 'string' || !NAME.test(value)) { problems.push({ where, message: 'Ids use lowercase letters, digits and _, starting with a letter' }); return false; }
    if (seen.has(value)) { problems.push({ where, message: `${what} has this id already` }); return false; }
    seen.add(value);
    return true;
  };
  const keys = (obj, allowed, where, what) => {
    for (const key of Object.keys(obj)) if (!allowed.has(key)) problems.push({ where: `${where}, ${key}`, message: `Not part of ${what}` });
  };

  const checkFeature = (f, where, levelled, ownList) => {
    keys(f, FEATURE_KEYS, where, 'a feature');
    id(f.id, where, named, 'Another option or feature');
    text(f.label, `${where}, label`, LIMITS.label, { required: true });
    text(f.text, `${where}, text`, LIMITS.description);
    if (f.at !== undefined) {
      if (!levelled) problems.push({ where: `${where}, at`, message: 'Only a levelled list\'s features unlock at a level' });
      else if (!Number.isInteger(f.at) || f.at < 1 || f.at > LIMITS.level) problems.push({ where: `${where}, at`, message: `A level from 1 to ${LIMITS.level}` });
    }
    if (f.modifiers !== undefined) {
      if (!Array.isArray(f.modifiers)) problems.push({ where: `${where}, modifiers`, message: 'Must be a list of modifiers' });
      else {
        if (f.modifiers.length > LIMITS.modifiers) problems.push({ where: `${where}, modifiers`, message: `At most ${LIMITS.modifiers}` });
        f.modifiers.slice(0, LIMITS.modifiers).forEach((m, i) => {
          const at = `${where}, modifier ${i + 1}`;
          if (!isPlainObject(m)) { problems.push({ where: at, message: 'Must say what it changes and by how much' }); return; }
          keys(m, new Set(['target', 'amount']), at, 'a modifier');
          if (typeof m.target !== 'string' || !targets.has(m.target)) problems.push({ where: `${at}, target`, message: 'Not one of this system\'s stats, formulas or health fields' });
          formula(m.amount, `${at}, amount`);
          // Worked out from the sheet as typed and the levels: a formula could read this modifier back.
          if (typeof m.amount === 'string') {
            let read = [];
            try { read = [...references(parse(m.amount, isFunction)).fields]; } catch { /* reported above */ }
            for (const name of read.filter((n) => formulas.has(n) && !levels.has(n))) {
              problems.push({ where: `${at}, amount`, message: `Reads @${name}, a formula: an amount reads the sheet as typed and levels` });
            }
          }
        });
      }
    }
    if (f.uses !== undefined) {
      if (!isPlainObject(f.uses)) problems.push({ where: `${where}, uses`, message: 'Must say how many, and what refills them' });
      else {
        keys(f.uses, new Set(['count', 'refill']), `${where}, uses`, 'uses');
        formula(f.uses.count, `${where}, uses, count`);
        if (f.uses.refill !== undefined && (typeof f.uses.refill !== 'string' || !rests.has(f.uses.refill))) {
          problems.push({ where: `${where}, uses, refill`, message: 'Not one of this system\'s rests' });
        }
      }
    }
    if (f.rolls !== undefined) {
      if (!Array.isArray(f.rolls)) problems.push({ where: `${where}, rolls`, message: 'Must be a list of rolls' });
      else {
        if (f.rolls.length > LIMITS.rolls) problems.push({ where: `${where}, rolls`, message: `At most ${LIMITS.rolls}` });
        for (const r of f.rolls.slice(0, LIMITS.rolls)) {
          if (typeof r !== 'string' || !rolls.has(r)) problems.push({ where: `${where}, rolls`, message: `${typeof r === 'string' ? r : 'That'} is not one of this system's rolls` });
        }
      }
    }
    if (f.changes !== undefined) {
      if (!Array.isArray(f.changes)) problems.push({ where: `${where}, changes`, message: 'Must be a list of a roll and its change' });
      else {
        if (f.changes.length > LIMITS.rolls) problems.push({ where: `${where}, changes`, message: `At most ${LIMITS.rolls}` });
        f.changes.slice(0, LIMITS.rolls).forEach((c, i) => {
          const at = `${where}, change ${i + 1}`;
          if (!isPlainObject(c)) { problems.push({ where: at, message: 'Must name a roll and one of its changes' }); return; }
          keys(c, new Set(['roll', 'change']), at, 'a change');
          if (typeof c.roll !== 'string' || !rolls.has(c.roll)) problems.push({ where: `${at}, roll`, message: 'Not one of this system\'s rolls' });
          else if (typeof c.change !== 'string' || !rolls.get(c.roll).has(c.change)) problems.push({ where: `${at}, change`, message: 'Not one of that roll\'s changes' });
        });
      }
    }
    if (f.choice !== undefined) {
      if (typeof f.choice !== 'string' || !listIds.has(f.choice)) problems.push({ where: `${where}, choice`, message: 'Not one of this system\'s lists' });
      else if (f.choice === ownList) problems.push({ where: `${where}, choice`, message: 'A list can\'t be picked from inside itself' });
    }
  };

  lists.slice(0, LIMITS.lists).forEach((c, i) => {
    const where = isPlainObject(c) && typeof c.id === 'string' && NAME.test(c.id) ? `list ${c.id}` : `list ${i + 1}`;
    if (!isPlainObject(c)) { problems.push({ where, message: 'Must be a list to pick from' }); return; }
    keys(c, LIST_KEYS, where, 'a list');
    id(c.id, where, listSeen, 'Another list');
    text(c.one, `${where}, one`, LIMITS.label, { required: true });
    text(c.many, `${where}, many`, LIMITS.label, { required: true });
    if (c.picks !== undefined && c.picks !== 'any' && (!Number.isInteger(c.picks) || c.picks < 1 || c.picks > LIMITS.picks)) {
      problems.push({ where: `${where}, picks`, message: `A number from 1 to ${LIMITS.picks}, or any` });
    }
    for (const key of ['levelled', 'again']) {
      if (c[key] !== undefined && typeof c[key] !== 'boolean') problems.push({ where: `${where}, ${key}`, message: `Must say ${key}: true or ${key}: false` });
    }
    if (c.levelled === true && typeof c.id === 'string' && (targets.has(`${c.id}_level`) || optionLevels.has(`${c.id}_level`))) {
      problems.push({ where, message: `Its levels add up as @${c.id}_level, which a stat, formula or option already has` });
    }
    if (!Array.isArray(c.options)) { problems.push({ where: `${where}, options`, message: 'Must be a list of options' }); return; }
    if (c.options.length > LIMITS.options) problems.push({ where: `${where}, options`, message: `At most ${LIMITS.options} options` });
    c.options.slice(0, LIMITS.options).forEach((o, j) => {
      const at = isPlainObject(o) && typeof o.id === 'string' && NAME.test(o.id) ? `${where}, option ${o.id}` : `${where}, option ${j + 1}`;
      if (!isPlainObject(o)) { problems.push({ where: at, message: 'Must be an option' }); return; }
      keys(o, OPTION_KEYS, at, 'an option');
      if (id(o.id, at, named, 'Another option or feature') && c.levelled === true && targets.has(`${o.id}_level`)) {
        problems.push({ where: at, message: `Its level is read as @${o.id}_level, which a stat or formula already has` });
      }
      text(o.label, `${at}, label`, LIMITS.label, { required: true });
      text(o.description, `${at}, description`, LIMITS.description);
      if (o.requires !== undefined) formula(o.requires, `${at}, requires`);
      if (o.features === undefined) return;
      if (!Array.isArray(o.features)) { problems.push({ where: `${at}, features`, message: 'Must be a list of features' }); return; }
      if (o.features.length > LIMITS.features) problems.push({ where: `${at}, features`, message: `At most ${LIMITS.features} features` });
      o.features.slice(0, LIMITS.features).forEach((f, k) => {
        const fw = isPlainObject(f) && typeof f.id === 'string' && NAME.test(f.id) ? `${at}, feature ${f.id}` : `${at}, feature ${k + 1}`;
        if (!isPlainObject(f)) { problems.push({ where: fw, message: 'Must be a feature' }); return; }
        checkFeature(f, fw, c.levelled === true, c.id);
      });
    });
  });
};

/** How many of a list a character may have: as many as it picks, or no end when more can follow (again) or any. */
const capOf = (c) => (c.again === true || c.picks === 'any' ? Infinity : Number.isInteger(c.picks) ? c.picks : 1);

/**
 * A character's picks, as stored on their sheet, kept only where they hold: [{ list, option, level }],
 * the list and option as the definition has them, level null in a list that isn't levelled.
 */
const picksOf = (definition, data) => {
  const stored = isPlainObject(data) && isPlainObject(data[PICKS_KEY]) ? data[PICKS_KEY] : {};
  const out = [];
  for (const c of choicesOf(definition)) {
    const mine = Object.prototype.hasOwnProperty.call(stored, c.id) && Array.isArray(stored[c.id]) ? stored[c.id] : [];
    const options = new Map(optionsOf(c).map((o) => [o.id, o]));
    const taken = new Set();
    for (const p of mine.slice(0, LIMITS.options)) {
      if (taken.size >= capOf(c)) break;
      const id = isPlainObject(p) ? p.option : p;
      if (typeof id !== 'string' || !options.has(id) || taken.has(id)) continue;
      taken.add(id);
      const level = c.levelled !== true ? null
        : isPlainObject(p) && Number.isInteger(p.level) && p.level >= 1 ? Math.min(p.level, LIMITS.level) : 1;
      out.push({ list: c, option: options.get(id), level });
    }
  }
  return out;
};

/** The levels `picks` give, by the names formulas read them (levelNamesOf): untaken options read 0. */
const levelsOf = (definition, picks) => {
  const levels = {};
  let total = 0;
  const levelled = levelledOf(definition);
  for (const c of levelled) {
    for (const o of optionsOf(c)) levels[`${o.id}_level`] = 0;
    let sum = 0;
    for (const p of picks.filter((x) => x.list === c)) { levels[`${p.option.id}_level`] = p.level; sum += p.level; }
    levels[`${c.id}_level`] = sum;
    total += sum;
  }
  if (levelled.length && !targetsOf(definition).has('level')) levels.level = total;
  return levels;
};

/** The features `picks` have unlocked: [{ feature, option, list }], each pick's in its order. */
const unlockedOf = (picks) => picks.flatMap((p) => list(p.option.features)
  .filter((f) => isPlainObject(f) && typeof f.id === 'string' && (p.level === null || (Number.isInteger(f.at) ? f.at : 1) <= p.level))
  .map((feature) => ({ feature, option: p.option, list: p.list })));

/**
 * What a character's picks do to their numbers: `{ sheet, add, levels, from }`, the overlay
 * derived.js reads. `sheet` holds the levels and each stat or health field a feature changes, as
 * modified; `add` each formula's modifiers, added once it is worked out; `from` every modifier by
 * what it changes, [{ feature, amount }], for the sheet to name. Empty for a sheet with no picks.
 */
const overlayOf = (definition, data) => {
  const sheet = isPlainObject(data) ? data : {};
  const picks = picksOf(definition, sheet);
  const levels = levelsOf(definition, picks);
  const own = (o, name) => Object.prototype.hasOwnProperty.call(o, name);
  const tables = tablesOf(isPlainObject(definition.lookups) ? definition.lookups : undefined);
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const env = {
    field: (name) => (own(levels, name) ? levels[name] : num(sheet[name])),
    rule: (name) => ruleValue(name, sheet),
    table: (name, x) => lookupIn(own(tables, name) ? tables[name] : [], x),
  };
  const isTable = (name) => own(tables, name);
  const targets = targetsOf(definition);
  const fields = fieldTargetsOf(definition);
  const from = {};
  const totals = {};
  for (const { feature } of unlockedOf(picks)) {
    for (const m of list(feature.modifiers).slice(0, LIMITS.modifiers)) {
      if (!isPlainObject(m) || typeof m.target !== 'string' || !targets.has(m.target) || typeof m.amount !== 'string') continue;
      let amount;
      try { amount = evaluate(parse(m.amount, isTable), env); } catch { continue; }
      if (!Number.isFinite(amount)) continue;
      totals[m.target] = (own(totals, m.target) ? totals[m.target] : 0) + amount;
      (own(from, m.target) ? from[m.target] : (from[m.target] = [])).push({ feature: feature.label || feature.id, amount });
    }
  }
  const over = { ...levels };
  const add = {};
  for (const [target, amount] of Object.entries(totals)) {
    if (fields.has(target)) over[target] = num(sheet[target]) + amount;
    else add[target] = amount;
  }
  return { sheet: over, add, levels, from };
};

/** The sheet as rolls read it: the stats and health fields with their modifiers, and the levels. Never stored. */
const effectiveData = (definition, data) => ({ ...(isPlainObject(data) ? data : {}), ...overlayOf(definition, data).sheet });

module.exports = { LIMITS, PICKS_KEY, checkChoices, choicesOf, picksOf, levelsOf, levelNamesOf, unlockedOf, overlayOf, effectiveData };
