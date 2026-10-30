// A system's choices (7a1a; approved mockup docs/mockups/builder-choices.html, 2026-10-27): the
// lists a character picks from (classes, backgrounds, feats, playbooks), named in the game's own
// words, and the features each pick gives.
//
//   choices: [
//     { id: 'classes', one: 'Class', many: 'Classes',
//       picks: 1,            // how many a character picks: a whole number, or 'any'; 1 when absent
//       levelled: true,      // each pick has a level, and its features unlock by it
//       again: true,         // MORE THAN ONCE: more can be added after those (multiclassing)
//       picked: 'features',  // 7a5a: own (on its own, as when absent), features (only under the
//                            // features that open it), both (its own picks, and those) or everyone
//                            // (7a5a2: every character has its options, nothing picked)
//       options: [
//         { id: 'soldier', label: 'Soldier', description: '...',
//           requires: '@str >= 13',          // optional: a formula, met when it isn't 0
//           die: 10,                         // optional, a levelled list's: its die, by its sides
//                                            // (R1a: recovery dice; level-up health in 7d)
//           features: [
//             { id: 'guard_stance', label: 'Guard Stance', text: 'Words for the table.',
//               at: 1,                                          // the pick's level it unlocks at (levelled lists)
//               modifiers: [{ target: 'defense', amount: '1' }], // added to a stat, formula or health field
//               uses: { count: '1', refill: 'short_rest' },     // ticked off on the sheet, refilled by a rest
//               rolls: ['rally'],                               // rolls of the system it gives
//               changes: [{ roll: 'mind_save', change: 'advantage' }], // a change it lets one roll take
//               choice: 'specialties', choice_count: 2 },       // a list picked from when it unlocks, and how many (1)
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
// Lists inside lists (7a5a; approved mockup docs/mockups/nested-choices.html, 2026-10-28): a list
// picked THROUGH FEATURES (or BOTH) gets a pick under each unlocked feature that opens it, as many as
// the feature says, stored with `from` naming that feature. A pick whose feature locks again (a level
// lowered, the pick above it dropped) is kept but not counted, and counts again once it unlocks:
// heldOf reads every pick kept, picksOf only those that count. Lists never open each other in a loop.
// A list EVERYONE HAS (7a5a2, the user asked for features no class gives) is never picked: every
// character holds each option whose requirement they meet, its features unlocking by their total level
// (the levelled lists' sum, or the system's own `level`).
//
// A pick under a feature, in a list without levels of its own, takes the level of the pick that
// opened it (7a5d, the user on Fighter's Martial Archetype): Champion, opened at Fighter 3, has
// Remarkable Athlete at Fighter 7. Opened by a pick with no level (a feat), it has everything at once.
// Its level is never added to @level or any list's: it is the opener's, counted there already.
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
// versionDiff.js read the overlay. The token's maximum (HP MAX, WOUNDS) is the one exception: it lives
// on the token, so its modifiers are moved onto the token itself, and back off (tokenMax.js, 7a5a3).
//
// At the table (7a3a): how many of each feature's uses are spent is kept under USES_KEY, by feature,
// and a rest that refills them sets them back (resting.js). Every save writes what the sheet shows of
// the picks under WORKED_KEY (workedOf): the picks and their levels, what each modifier comes from,
// each feature's uses left, and the options whose requirement isn't met. Picking itself, with who may
// do what, is picking.js's. The sheet is drawn from choicesShown, the lists without their formulas.

const { parse, evaluate, references, NAME } = require('./expression');
const { ruleValue } = require('./rules');
const { tablesOf, lookupIn } = require('./derived');
const { statIdsOf } = require('./stats');
const { restIdsOf } = require('./rests');
const { healthLayout } = require('./core');

/** Where a sheet keeps its picks: starting with _, so no stat, formula or field can be called it. */
const PICKS_KEY = '_choices';
/** Where a sheet keeps each feature's uses spent, by feature id. */
const USES_KEY = '_uses';
/** Where every save writes what the sheet shows of the picks (workedOf). Never read back as input. */
const WORKED_KEY = '_worked';

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
  /** How many picks one feature opening a list gives (7a5a). */
  opens: 10,
  /** A levelled option's die, by its sides (R1a). */
  dieLeast: 2,
  dieMost: 100,
};
/** How a list is picked (7a5a): on its own, only under the features that open it, both, or not at all (everyone has it). */
const PICKED = ['own', 'features', 'both', 'everyone'];
const LIST_KEYS = new Set(['id', 'one', 'many', 'picks', 'levelled', 'again', 'picked', 'options']);
const OPTION_KEYS = new Set(['id', 'label', 'description', 'requires', 'die', 'features']);
const FEATURE_KEYS = new Set(['id', 'label', 'text', 'at', 'modifiers', 'uses', 'rolls', 'changes', 'choice', 'choice_count']);

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

/** The health field linked to the token's maximum (HP MAX, WOUNDS), or null: its modifiers live on the token (tokenMax.js). */
const tokenMaxFieldOf = (definition) => {
  const fields = healthLayout(isPlainObject(definition.core) ? definition.core.health : undefined).sections.flatMap((s) => s.fields);
  const field = fields.find((f) => f.source === 'token_hp_max');
  return field ? field.id : null;
};

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

/**
 * The lists whose features unlock at a level (7a5d): a levelled list's, by its pick's; one everyone
 * has, by the character's; and one without levels picked through features (or both) and opened from
 * one of those, by the level of what opened it. Each as its id.
 */
const unlocksByLevelOf = (definition) => {
  const lists = choicesOf(definition);
  const opens = opensOf(definition);
  const out = new Set(lists.filter((c) => c.levelled === true || pickedOf(c) === 'everyone').map((c) => c.id));
  for (let changed = true; changed;) {
    changed = false;
    for (const c of lists) {
      if (out.has(c.id) || !['features', 'both'].includes(pickedOf(c))) continue;
      if ([...opens].some(([from, to]) => out.has(from) && to.includes(c.id))) { out.add(c.id); changed = true; }
    }
  }
  return out;
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
  const byLevel = unlocksByLevelOf(definition);
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
      if (!levelled) problems.push({ where: `${where}, at`, message: 'Only the features of a list with levels unlock at a level: a levelled list, one everyone has, or one a feature of those opens' });
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
    if (f.choice_count !== undefined) {
      if (f.choice === undefined) problems.push({ where: `${where}, choice_count`, message: 'Only a feature that opens a list says how many' });
      else if (!Number.isInteger(f.choice_count) || f.choice_count < 1 || f.choice_count > LIMITS.opens) problems.push({ where: `${where}, choice_count`, message: `A number from 1 to ${LIMITS.opens}` });
    }
  };

  const names = new Map(choicesOf(definition).map((c) => [c.id, String(c.many || c.id).toUpperCase()]));
  for (const { list: id, path } of loopsOf(definition)) {
    problems.push({ where: `list ${id}`, message: `Its features open lists that lead back to it: ${path.map((p) => names.get(p)).join(' → ')}` });
  }

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
    if (c.picked !== undefined && !PICKED.includes(c.picked)) problems.push({ where: `${where}, picked`, message: 'own (on its own), features (through the features that open it), both, or everyone (every character has it)' });
    if (c.picked === 'everyone' && c.levelled === true) problems.push({ where: `${where}, levelled`, message: 'A list everyone has has no levels of its own: its features unlock by the character\'s level' });
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
      if (o.die !== undefined) {
        if (c.levelled !== true) problems.push({ where: `${at}, die`, message: 'Only an option of a levelled list has a die' });
        else if (!Number.isInteger(o.die) || o.die < LIMITS.dieLeast || o.die > LIMITS.dieMost) problems.push({ where: `${at}, die`, message: `A die of ${LIMITS.dieLeast} to ${LIMITS.dieMost} sides` });
      }
      if (o.features === undefined) return;
      if (!Array.isArray(o.features)) { problems.push({ where: `${at}, features`, message: 'Must be a list of features' }); return; }
      if (o.features.length > LIMITS.features) problems.push({ where: `${at}, features`, message: `At most ${LIMITS.features} features` });
      o.features.slice(0, LIMITS.features).forEach((f, k) => {
        const fw = isPlainObject(f) && typeof f.id === 'string' && NAME.test(f.id) ? `${at}, feature ${f.id}` : `${at}, feature ${k + 1}`;
        if (!isPlainObject(f)) { problems.push({ where: fw, message: 'Must be a feature' }); return; }
        checkFeature(f, fw, byLevel.has(c.id), c.id);
      });
    });
  });
};

/** The lists each list's features open, other than itself (that is refused on its own). */
const opensOf = (definition) => {
  const lists = choicesOf(definition);
  const ids = new Set(lists.map((c) => c.id));
  return new Map(lists.map((c) => [c.id, [...new Set(optionsOf(c).flatMap((o) => list(o.features)).filter(isPlainObject)
    .map((f) => f.choice).filter((id) => typeof id === 'string' && id !== c.id && ids.has(id)))]]));
};

/** Each list that leads back to itself through others, with the way round: [{ list, path }]. */
const loopsOf = (definition) => {
  const opens = opensOf(definition);
  const out = [];
  for (const start of opens.keys()) {
    // Breadth first, so the way round named is the shortest.
    const came = new Map([[start, null]]);
    const queue = [start];
    let found = null;
    while (queue.length && !found) {
      const at = queue.shift();
      for (const next of opens.get(at) || []) {
        if (next === start) { found = at; break; }
        if (!came.has(next)) { came.set(next, at); queue.push(next); }
      }
    }
    if (!found) continue;
    const path = [start];
    for (let at = found; at !== start; at = came.get(at)) path.splice(1, 0, at);
    out.push({ list: start, path: [...path, start] });
  }
  return out;
};

/** How many of a list a character may have: as many as it picks, or no end when more can follow (again) or any. */
const capOf = (c) => (c.again === true || c.picks === 'any' ? Infinity : Number.isInteger(c.picks) ? c.picks : 1);

/** How a list is picked: on its own when it says nothing. */
const pickedOf = (c) => (PICKED.includes(c.picked) ? c.picked : 'own');
/** How many picks a feature opening a list gives: 1 when it says nothing. */
const openCountOf = (f) => (Number.isInteger(f.choice_count) && f.choice_count >= 1 ? Math.min(f.choice_count, LIMITS.opens) : 1);

/**
 * The features among `picks` that open a list picked through features (or both), each with how
 * many picks it gives and how many of them are taken: [{ feature, list, count, used }].
 */
const openingsOf = (definition, picks) => {
  const lists = new Map(choicesOf(definition).map((c) => [c.id, c]));
  return unlockedOf(picks)
    .filter(({ feature }) => typeof feature.choice === 'string' && lists.has(feature.choice) && ['features', 'both'].includes(pickedOf(lists.get(feature.choice))))
    .map(({ feature }) => ({ feature, list: lists.get(feature.choice), count: openCountOf(feature), used: picks.filter((p) => p.from === feature.id).length }));
};

/**
 * Every pick a character's sheet keeps: [{ list, option, level, from, active }], the list and option
 * as the definition has them, level null in a list that isn't levelled (one picked under a feature
 * has the level of the pick that opened it, 7a5d), `from` the feature it was
 * picked under (null for a list's own), `active` whether it counts. A list's own picks count up to
 * what it allows (those past it aren't kept); one picked under a feature counts while that feature is
 * unlocked by a pick that counts, and has room, worked out down the lists until nothing more
 * changes. Picks that don't count are kept for when they do: a list switched to THROUGH FEATURES
 * keeps its own, a list switched back keeps those picked under features.
 */
const heldOf = (definition, data) => {
  const stored = isPlainObject(data) && isPlainObject(data[PICKS_KEY]) ? data[PICKS_KEY] : {};
  const sheet = isPlainObject(data) ? data : {};
  const held = [];
  const everyone = [];
  for (const c of choicesOf(definition)) {
    const mode = pickedOf(c);
    if (mode === 'everyone') {
      for (const option of optionsOf(c)) {
        const p = { list: c, option, level: null, from: null, active: true, everyone: true };
        held.push(p);
        everyone.push(p);
      }
      continue;
    }
    const mine = Object.prototype.hasOwnProperty.call(stored, c.id) && Array.isArray(stored[c.id]) ? stored[c.id] : [];
    const options = new Map(optionsOf(c).map((o) => [o.id, o]));
    const taken = new Set();
    let own = 0;
    for (const p of mine.slice(0, LIMITS.options)) {
      const id = isPlainObject(p) ? p.option : p;
      if (typeof id !== 'string' || !options.has(id) || taken.has(id)) continue;
      const from = isPlainObject(p) && typeof p.from === 'string' ? p.from : null;
      // A list's own picks past what it allows were never kept.
      if (!from && mode !== 'features' && own >= capOf(c)) continue;
      taken.add(id);
      const level = c.levelled !== true ? null
        : isPlainObject(p) && Number.isInteger(p.level) && p.level >= 1 ? Math.min(p.level, LIMITS.level) : 1;
      const counts = from ? (mode === 'own' ? false : null) : mode !== 'features';
      if (counts) own += 1;
      held.push({ list: c, option: options.get(id), level, from, active: counts });
    }
  }
  // What everyone has: the options whose requirement is met on the sheet as typed and the levels so
  // far (never what picks add, which would read back into this), at the character's total level.
  const ownLevel = targetsOf(definition).has('level');
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  // At least 1, so a character with no class yet has what comes at the start; in a system with no
  // levels at all, null: every feature counts.
  const levelled = levelledOf(definition).length > 0;
  const totalLevel = () => (ownLevel ? Math.max(1, Math.floor(num(sheet.level)))
    : levelled ? Math.max(1, levelsOf(definition, held.filter((p) => p.active === true && !p.everyone)).level ?? 0) : null);
  if (everyone.length) {
    const levels = levelsOf(definition, held.filter((p) => p.active === true && !p.everyone));
    const tables = tablesOf(isPlainObject(definition.lookups) ? definition.lookups : undefined);
    const own = (o, name) => Object.prototype.hasOwnProperty.call(o, name);
    const env = {
      field: (name) => (own(levels, name) ? levels[name] : num(sheet[name])),
      rule: (name) => ruleValue(name, sheet),
      table: (name, x) => lookupIn(own(tables, name) ? tables[name] : [], x),
    };
    for (const p of everyone) {
      const needs = p.option.requires;
      if (typeof needs !== 'string' || !needs.trim()) continue;
      let n = null;
      try { n = evaluate(parse(needs, (name) => own(tables, name)), env); } catch { n = null; }
      if (Number.isFinite(n) && n === 0) held.splice(held.indexOf(p), 1);
    }
  }
  // Picks under features, settled from the top down: each pass may unlock features for the next.
  for (let changed = true; changed;) {
    changed = false;
    const total = totalLevel();
    for (const p of everyone) p.level = total;
    // 7a5d: a pick under a feature, in a list without levels, at the level of the pick that opened it.
    for (const p of held) {
      if (!p.from || p.list.levelled === true) continue;
      const opener = held.find((q) => list(q.option.features).some((f) => isPlainObject(f) && f.id === p.from));
      const level = opener ? opener.level : null;
      if (level !== p.level) { p.level = level; changed = true; }
    }
    const room = new Map(openingsOf(definition, held.filter((p) => p.active === true))
      .map((o) => [o.feature.id, { list: o.list, left: o.count - o.used }]));
    for (const p of held.filter((x) => x.active === null)) {
      const r = room.get(p.from);
      if (r && r.list === p.list && r.left > 0) { p.active = true; r.left -= 1; changed = true; }
    }
  }
  for (const p of held) if (p.active === null) p.active = false;
  for (const p of everyone) delete p.everyone;
  return held;
};

/**
 * A character's picks that count: [{ list, option, level, from }], as heldOf reads them. What the
 * numbers, uses, rests and rolls read.
 */
const picksOf = (definition, data) => heldOf(definition, data).filter((p) => p.active)
  .map(({ list: c, option, level, from }) => ({ list: c, option, level, from }));

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
  // The token's maximum already holds its modifiers (7a5a3, tokenMax.js): read as it is, never added twice.
  const onToken = tokenMaxFieldOf(definition);
  for (const [target, amount] of Object.entries(totals)) {
    if (target === onToken) continue;
    if (fields.has(target)) over[target] = num(sheet[target]) + amount;
    else add[target] = amount;
  }
  return { sheet: over, add, levels, from };
};

/** The sheet as rolls read it: the stats and health fields with their modifiers, and the levels. Never stored. */
const effectiveData = (definition, data) => ({ ...(isPlainObject(data) ? data : {}), ...overlayOf(definition, data).sheet });

/**
 * Formula text worked out on the sheet as it reads now: stats with their modifiers, the levels, and
 * formulas as last saved. Null when it can't be (it never happens to a published system's).
 */
const valueOn = (definition, data, text) => {
  if (typeof text !== 'string') return null;
  const sheet = effectiveData(definition, data);
  const own = (o, name) => Object.prototype.hasOwnProperty.call(o, name);
  const tables = tablesOf(isPlainObject(definition.lookups) ? definition.lookups : undefined);
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  try {
    const n = evaluate(parse(text, (name) => own(tables, name)), {
      field: (name) => num(sheet[name]),
      rule: (name) => ruleValue(name, sheet),
      table: (name, x) => lookupIn(own(tables, name) ? tables[name] : [], x),
    });
    return Number.isFinite(n) ? n : null;
  } catch { return null; }
};

/** Whether a character meets an option's requirement: one with none always does. */
const meets = (definition, data, option) => {
  if (!isPlainObject(option) || typeof option.requires !== 'string' || !option.requires.trim()) return true;
  const v = valueOn(definition, data, option.requires);
  return v === null || v !== 0;
};

/** Every name a sheet shows for what a formula can read: stats, formulas, health fields, levels. */
const namesOf = (definition) => {
  const names = new Map();
  for (const g of list(definition.stats)) for (const s of list(g.stats)) if (typeof s.id === 'string') names.set(s.id, s.label || s.id);
  for (const d of list(definition.derived)) if (typeof d.id === 'string') names.set(d.id, d.label || d.id);
  for (const s of healthLayout(isPlainObject(definition.core) ? definition.core.health : undefined).sections) for (const f of s.fields) names.set(f.id, f.label || f.id);
  for (const c of levelledOf(definition)) {
    names.set(`${c.id}_level`, `${c.many || c.id} level`);
    for (const o of optionsOf(c)) names.set(`${o.id}_level`, `${o.label || o.id} level`);
  }
  if (!names.has('level') && levelledOf(definition).length) names.set('level', 'Level');
  return names;
};

/** A requirement in the words the sheet shows: @int >= 13 as INTELLECT >= 13. */
const needsText = (definition, text) => {
  const names = namesOf(definition);
  return String(text).replace(/@([a-z][a-z0-9_]*)/g, (_, id) => String(names.get(id) || id).toUpperCase()).trim();
};

/** Each unlocked feature with uses: how many it has (its count worked out), how many are spent, and its rest. */
const usesOf = (definition, data) => {
  const stored = isPlainObject(data) && isPlainObject(data[USES_KEY]) ? data[USES_KEY] : {};
  return unlockedOf(picksOf(definition, data)).filter(({ feature }) => isPlainObject(feature.uses)).map(({ feature }) => {
    const max = Math.max(0, Math.floor(valueOn(definition, data, feature.uses.count) ?? 0));
    const had = Object.prototype.hasOwnProperty.call(stored, feature.id) ? Number(stored[feature.id]) : 0;
    const spent = Math.max(0, Math.min(max, Number.isInteger(had) ? had : 0));
    return { feature, max, spent, refill: typeof feature.uses.refill === 'string' ? feature.uses.refill : null };
  });
};

/**
 * What the sheet shows of a character's picks, worked out on every save: every pick kept with its
 * level, the feature it was picked under and whether it waits (7a5a), each feature's picks open, the
 * levels formulas read, what each changed value's modifiers come from, each feature's uses
 * ({ max, spent }), and the options not taken whose requirement isn't met.
 */
const workedOf = (definition, data) => {
  const held = heldOf(definition, data);
  const picks = held.filter((p) => p.active);
  const taken = new Set(held.map((p) => p.option.id));
  return {
    picks: held.map((p) => ({ list: p.list.id, option: p.option.id, ...(p.level === null ? {} : { level: p.level }),
      ...(p.from ? { from: p.from } : {}), ...(p.active ? {} : { waiting: true }) })),
    // 7a5a: each unlocked feature opening a list picked through features, and how many it gives and has.
    opens: openingsOf(definition, picks).map((o) => ({ feature: o.feature.id, list: o.list.id, count: o.count, used: o.used })),
    levels: levelsOf(definition, picks),
    from: overlayOf(definition, data).from,
    uses: Object.fromEntries(usesOf(definition, data).map((u) => [u.feature.id, { max: u.max, spent: u.spent }])),
    unmet: choicesOf(definition).flatMap((c) => optionsOf(c).filter((o) => !taken.has(o.id) && !meets(definition, data, o)).map((o) => o.id)),
  };
};

/**
 * The lists as the sheet draws them (7a3a): names, how many and how, each option's words and what
 * it needs in words, and each feature's words, level and what it does, named. Never a formula.
 */
const choicesShown = (definition) => {
  const names = namesOf(definition);
  const rolls = new Map(list(definition.rolls).filter((r) => typeof r.id === 'string').map((r) => [r.id, r]));
  const restName = new Map(list(Object.entries(isPlainObject(definition.rests) ? definition.rests : {}).map(([id, r]) => ({ id, ...r }))).map((r) => [r.id, r.name]));
  const STANDARD_REST = { short_rest: 'Short rest', long_rest: 'Long rest', end_of_scene: 'End of scene', end_of_session: 'End of session' };
  const lists = choicesOf(definition);
  const byLevel = unlocksByLevelOf(definition);
  return lists.map((c) => ({
    id: c.id, one: c.one, many: c.many,
    picks: c.picks === 'any' ? 'any' : Number.isInteger(c.picks) ? c.picks : 1,
    again: c.again === true, levelled: c.levelled === true, picked: pickedOf(c),
    options: optionsOf(c).map((o) => ({
      id: o.id, label: o.label || o.id,
      ...(typeof o.description === 'string' && o.description.trim() ? { description: o.description } : {}),
      ...(typeof o.requires === 'string' && o.requires.trim() ? { needs: needsText(definition, o.requires) } : {}),
      features: list(o.features).filter((f) => typeof f.id === 'string').map((f) => ({
        id: f.id, label: f.label || f.id,
        ...(typeof f.text === 'string' && f.text.trim() ? { text: f.text } : {}),
        ...(byLevel.has(c.id) ? { at: Number.isInteger(f.at) && f.at >= 1 ? f.at : 1 } : {}),
        ...(list(f.modifiers).length ? { modifies: [...new Set(list(f.modifiers).map((m) => String(names.get(m.target) || m.target)))] } : {}),
        ...(isPlainObject(f.uses) ? { uses: { refill: typeof f.uses.refill === 'string' ? (restName.get(f.uses.refill) || STANDARD_REST[f.uses.refill] || f.uses.refill) : null } } : {}),
        ...(Array.isArray(f.rolls) && f.rolls.length ? { rolls: f.rolls.map((id) => (rolls.get(id) ? rolls.get(id).label || id : id)) } : {}),
        ...(list(f.changes).length ? { changes: list(f.changes).map((ch) => {
          const roll = rolls.get(ch.roll);
          const change = roll ? list(roll.changes).find((x) => x.id === ch.change) : null;
          return `${(change && change.label) || ch.change} on ${(roll && roll.label) || ch.roll}`;
        }) } : {}),
        ...(typeof f.choice === 'string' && lists.some((l) => l.id === f.choice) ? { opens: f.choice, opensCount: openCountOf(f) } : {}),
      })),
    })),
  }));
};

module.exports = {
  LIMITS, PICKED, PICKS_KEY, USES_KEY, WORKED_KEY, checkChoices, choicesOf, heldOf, picksOf, pickedOf, unlocksByLevelOf, openingsOf, loopsOf, levelsOf, levelNamesOf, unlockedOf, overlayOf, effectiveData,
  capOf, valueOn, meets, namesOf, needsText, usesOf, workedOf, choicesShown, tokenMaxFieldOf,
};
