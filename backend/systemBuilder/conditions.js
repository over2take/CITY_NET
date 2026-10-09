// A system's conditions (4e1a; approved mockup docs/mockups/builder-conditions.html, 2026-10-09):
// what can happen to a character besides losing health.
//
//   conditions: {
//     blinded:  { on: false },                                  // a standard one, turned off
//     poisoned: { ends: 'rounds', rounds: 3,
//                 modifiers: [{ target: 'all_rolls', amount: -1 }] },  // a standard one, edited
//     glitching: { name: 'Glitching', short: 'GLITCH', icon: '/uploads/condition_icons/<hash>.png',
//                  description: 'Chrome misfiring.' },          // one of the system's own
//   }
//
// Every system starts with the standard set below; a definition stores only what it changes, as
// WORDS does: a standard condition left alone is not written down. Any other id is the system's
// own condition and needs a name. Decided with the user the same day:
// - conditions for every system, as many as a table needs (up to LIMITS.conditions in all);
// - an icon is one of ICONS, drawn for CITY_NET in the theme's colors, or an uploaded PNG, WebP or
//   SVG (POST /api/systems/condition-icons), kept in its own colors as currency icons are;
// - a condition ends when removed, or after a number of rounds (refresh events come with 4f);
// - modifiers name a stat, a formula or all rolls, and are recorded and shown now; they reach
//   rolls once a system's rolls are built (Phase 6).
//
// Pure: the definition checks and the running game both read it.

const NAME = /^[a-z][a-z0-9_]{0,39}$/;
const LIMITS = { conditions: 60, name: 30, short: 8, description: 300, rounds: 99, modifiers: 10, amount: 99 };

/** The icons drawn for CITY_NET (frontend/src/sheets/conditionIcons.ts holds the drawings). */
const ICONS = [
  'blind', 'drop', 'skull', 'down', 'star', 'hand', 'ghost', 'zzz', 'chain', 'battery', 'flame', 'bolt',
  'spiral', 'snow', 'bio', 'closed', 'signal', 'mask', 'anchor', 'target', 'heart', 'shield', 'music', 'pill',
];
const UPLOADED_ICON = /^\/uploads\/condition_icons\/[0-9a-f]{64}\.(png|webp|svg)$/;
const isIcon = (icon) => typeof icon === 'string' && (ICONS.includes(icon) || UPLOADED_ICON.test(icon));

/** How a condition ends: when someone takes it off, or after a number of rounds. */
const ENDS = ['removed', 'rounds'];
/** A modifier's target that is no single number: every roll the character makes. */
const ALL_ROLLS = 'all_rolls';

/** The standard set every system starts with, in this order. Names and words are CITY_NET's own. */
const STANDARD = [
  { id: 'blinded', name: 'Blinded', short: 'BLIND', icon: 'blind', description: 'Can\'t see.' },
  { id: 'bleeding', name: 'Bleeding', short: 'BLEED', icon: 'drop', description: 'Losing blood until treated.' },
  { id: 'poisoned', name: 'Poisoned', short: 'POISON', icon: 'skull', description: 'Sickened by a toxin.' },
  { id: 'prone', name: 'Prone', short: 'PRONE', icon: 'down', description: 'On the ground.' },
  { id: 'stunned', name: 'Stunned', short: 'STUN', icon: 'star', description: 'Reeling, unable to act.' },
  { id: 'grappled', name: 'Grappled', short: 'GRAB', icon: 'hand', description: 'Held in place by someone.' },
  { id: 'frightened', name: 'Frightened', short: 'FEAR', icon: 'ghost', description: 'Shaken by fear.' },
  { id: 'unconscious', name: 'Unconscious', short: 'OUT', icon: 'zzz', description: 'Knocked out and unaware.' },
  { id: 'restrained', name: 'Restrained', short: 'BOUND', icon: 'chain', description: 'Tied, cuffed or pinned.' },
  { id: 'exhausted', name: 'Exhausted', short: 'TIRED', icon: 'battery', description: 'Running on empty.' },
];
const STANDARD_IDS = new Set(STANDARD.map((c) => c.id));

const STANDARD_KEYS = new Set(['on', 'name', 'short', 'icon', 'description', 'ends', 'rounds', 'modifiers']);
const OWN_KEYS = new Set(['name', 'short', 'icon', 'description', 'ends', 'rounds', 'modifiers']);

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

const text = (value, where, max, problems, { required = false } = {}) => {
  if (value === undefined) { if (required) problems.push({ where, message: 'Required' }); return; }
  if (typeof value !== 'string' || (required && !value.trim())) { problems.push({ where, message: required ? 'Cannot be blank' : 'Must be text' }); return; }
  if (value.length > max) problems.push({ where, message: `Longer than ${max} characters` });
};

const checkModifiers = (modifiers, where, targets, problems) => {
  if (modifiers === undefined) return;
  if (!Array.isArray(modifiers)) { problems.push({ where, message: 'Must be a list of modifiers' }); return; }
  if (modifiers.length > LIMITS.modifiers) problems.push({ where, message: `At most ${LIMITS.modifiers} modifiers` });
  modifiers.slice(0, LIMITS.modifiers).forEach((m, i) => {
    const mw = `${where} ${i + 1}`;
    if (!isPlainObject(m)) { problems.push({ where: mw, message: 'Must say a target and an amount' }); return; }
    for (const key of Object.keys(m)) if (key !== 'target' && key !== 'amount') problems.push({ where: `${mw}, ${key}`, message: 'Only a target and an amount' });
    if (m.target !== ALL_ROLLS && !(typeof m.target === 'string' && targets.has(m.target))) {
      problems.push({ where: `${mw}, target`, message: 'Must be all rolls, or one of this system\'s stats or formulas' });
    }
    if (!Number.isInteger(m.amount) || m.amount === 0 || Math.abs(m.amount) > LIMITS.amount) {
      problems.push({ where: `${mw}, amount`, message: `A whole number from -${LIMITS.amount} to ${LIMITS.amount}, not 0` });
    }
  });
};

/**
 * Problems with a definition's `conditions`, pushed onto `problems`. `targets` are the ids a
 * modifier may name: the system's stats and formulas.
 */
const checkConditions = (conditions, targets, problems) => {
  if (conditions === undefined) return;
  if (!isPlainObject(conditions)) { problems.push({ where: 'conditions', message: 'Must be a set of conditions' }); return; }
  const own = Object.keys(conditions).filter((id) => !STANDARD_IDS.has(id));
  if (STANDARD.length + own.length > LIMITS.conditions) {
    problems.push({ where: 'conditions', message: `At most ${LIMITS.conditions} conditions, the ${STANDARD.length} standard ones included` });
  }
  for (const [id, c] of Object.entries(conditions)) {
    const where = `condition ${id}`;
    const standard = STANDARD_IDS.has(id);
    if (!NAME.test(id)) { problems.push({ where, message: 'Ids use lowercase letters, digits and _, starting with a letter' }); continue; }
    if (!isPlainObject(c)) { problems.push({ where, message: 'Must be a condition' }); continue; }
    for (const key of Object.keys(c)) {
      if ((standard ? STANDARD_KEYS : OWN_KEYS).has(key)) continue;
      problems.push({ where: `${where}, ${key}`, message: key === 'on' ? 'Only a standard condition is turned off; delete one of the system\'s own instead' : 'Not part of a condition' });
    }
    if (has(c, 'on') && typeof c.on !== 'boolean') problems.push({ where: `${where}, on`, message: 'Must say on: true or on: false' });
    text(c.name, `${where}, name`, LIMITS.name, problems, { required: !standard });
    text(c.short, `${where}, short`, LIMITS.short, problems);
    text(c.description, `${where}, description`, LIMITS.description, problems);
    if (c.icon !== undefined && !isIcon(c.icon)) problems.push({ where: `${where}, icon`, message: 'Must be one of the drawn icons or an uploaded one' });
    if (c.ends !== undefined && !ENDS.includes(c.ends)) problems.push({ where: `${where}, ends`, message: 'Ends when removed, or after rounds' });
    if (c.ends === 'rounds') {
      if (!Number.isInteger(c.rounds) || c.rounds < 1 || c.rounds > LIMITS.rounds) {
        problems.push({ where: `${where}, rounds`, message: `A whole number from 1 to ${LIMITS.rounds}` });
      }
    } else if (c.rounds !== undefined) {
      problems.push({ where: `${where}, rounds`, message: 'Only a condition that ends after rounds has rounds' });
    }
    checkModifiers(c.modifiers, `${where}, modifier`, targets, problems);
  }
};

/** A label for a chip from a name: its first word in capitals, cut to fit. */
const shortFrom = (name) => String(name).trim().split(/\s+/)[0].toUpperCase().slice(0, LIMITS.short);

/**
 * The conditions a system offers, each whole: the standard set with the system's edits (those
 * it turned off left out), then its own, in the order written. What the running game and the
 * builder read; the stored definition keeps only the changes.
 */
const conditionsOf = (definition) => {
  const stored = definition && isPlainObject(definition.conditions) ? definition.conditions : {};
  const whole = (base, c, standard) => {
    const ends = ENDS.includes(c.ends) ? c.ends : 'removed';
    return {
      id: base.id,
      name: typeof c.name === 'string' && c.name.trim() ? c.name.trim() : base.name,
      short: typeof c.short === 'string' && c.short.trim() ? c.short.trim().toUpperCase() : (base.short || shortFrom(c.name || base.name)),
      icon: isIcon(c.icon) ? c.icon : (base.icon || 'target'),
      description: typeof c.description === 'string' ? c.description : (base.description || ''),
      ends,
      ...(ends === 'rounds' && Number.isInteger(c.rounds) ? { rounds: c.rounds } : {}),
      modifiers: Array.isArray(c.modifiers) ? c.modifiers.filter((m) => isPlainObject(m)).map((m) => ({ target: m.target, amount: m.amount })) : [],
      standard,
    };
  };
  const out = [];
  for (const base of STANDARD) {
    const c = isPlainObject(stored[base.id]) ? stored[base.id] : {};
    if (c.on === false) continue;
    out.push(whole(base, c, true));
  }
  for (const [id, c] of Object.entries(stored)) {
    if (STANDARD_IDS.has(id) || !NAME.test(id) || !isPlainObject(c) || typeof c.name !== 'string' || !c.name.trim()) continue;
    out.push(whole({ id, name: c.name.trim() }, c, false));
  }
  return out.slice(0, LIMITS.conditions);
};

module.exports = { STANDARD, ICONS, ENDS, ALL_ROLLS, LIMITS, isIcon, checkConditions, conditionsOf };
