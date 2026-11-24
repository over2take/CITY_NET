// A system's conditions (4e1a; approved mockup docs/mockups/builder-conditions.html, 2026-10-09):
// what can happen to a character besides losing health.
//
//   conditions: {
//     blinded:  { on: false },                                  // a standard one, turned off
//     poisoned: { ends: 'rounds', rounds: 3,
//                 modifiers: [{ target: 'all_rolls', amount: -1 }] },  // a standard one, edited
//     exhausted: { ends: 'rest', at: ['long_rest'] },            // wears off at a rest (4f, rests.js)
//     glitching: { name: 'Glitching', short: 'GLITCH', icon: '/uploads/condition_icons/<hash>.png',
//                  description: 'Chrome misfiring.' },          // one of the system's own
//     hacked: { name: 'Hacked', drawn: ['0000', ...] },           // a picture from the 16 x 16 pad (drawings.js)
//   }
//
// Every system starts with the standard set below; a definition stores only what it changes, as
// WORDS does: a standard condition left alone is not written down. Any other id is the system's
// own condition and needs a name. Decided with the user the same day:
// - conditions for every system, as many as a table needs (up to LIMITS.conditions in all);
// - an icon is one of ICONS, drawn for CITY_NET in the theme's colors, or an uploaded PNG, WebP or
//   SVG (POST /api/systems/condition-icons), kept in its own colors as currency icons are; or (8b1b, the user:
//   "add it here just to get it done") a drawing on the 16 x 16 pad, `drawn`, in the theme's color, one or the other;
// - a condition ends when removed, after a number of rounds, or at any of the rests it names
//   (4f1, rests.js; approved mockup docs/mockups/builder-rests.html), one way only;
// - modifiers name a stat, a formula or all rolls, and are recorded and shown; one on all rolls
//   reaches every roll of a system's own (tableRolls.js, 6b3b).
//
// A modifier's way (8a5e1; approved mockup docs/mockups/condition-modifiers.html, 2026-11-18): ADD, TIMES, SET TO or AT MOST,
// its amount a number or a formula (`{ target: 'speed', way: 'times', amount: '0.5' }`); ALL ROLLS adds a whole number only,
// as before. A condition APPLIED (`applied: true`) changes the numbers on the sheet of a character whose token has it,
// worked out in choices.js overlayOf; otherwise its modifiers stay a reminder. Conditions don't stack (the user: "they
// shouldn't stack"): of several changing one number one way, only the strongest counts. A visual change the GM explains;
// nothing is enforced at the table.
//
// EACH TURN (8a9a; approved mockup docs/mockups/condition-turn-effects.html, 2026-11-19): a condition may do something on
// initiative turns, up to three things, none to start ("this needs to be optional"):
//
//   each_turn: [{ when: 'turn_start', does: 'damage', roll: '1d4', changes_hp: true, rolled_by: 'table' },
//               { when: 'turn_end', does: 'roll_to_end', roll: 'd20 + @con_mod', ends_on: 13, rolled_by: 'player' }]
//
// WHEN the start or end of its turn, or of the round (the turn and round as agreed, written in the mockup); DOES damage,
// heal, a roll that takes it off on ENDS ON or more, or a roll for the log alone; DAMAGE and HEAL change the token's HP on
// their own unless changes_hp is false, the GM applying it by hand; ROLLED BY the table at once, or the player asked for
// their character's and the GM for an NPC's. And a condition may end AT THE END OF ITS NEXT TURN (ends: 'next_turn').
// Fired by tokens/turnEffects.js.
//
// Pure: the definition checks and the running game both read it.

const { isDrawn, DRAWN_PROBLEM } = require('./drawings');

const NAME = /^[a-z][a-z0-9_]{0,39}$/;
const LIMITS = { conditions: 60, name: 30, short: 8, description: 300, rounds: 99, modifiers: 10, amount: 99, number: 9999, times: 100, formula: 200, eachTurn: 3, endsOn: 9999 };

/** The icons drawn for CITY_NET (frontend/src/sheets/conditionIcons.ts holds the drawings). */
const ICONS = [
  'blind', 'drop', 'skull', 'down', 'star', 'hand', 'ghost', 'zzz', 'chain', 'battery', 'flame', 'bolt',
  'spiral', 'snow', 'bio', 'closed', 'signal', 'mask', 'anchor', 'target', 'heart', 'shield', 'music', 'pill',
  // A snail, a figure under too much, a heavy pack (8a5i; approved 2026-11-19).
  'snail', 'laden', 'pack',
];
const UPLOADED_ICON = /^\/uploads\/condition_icons\/[0-9a-f]{64}\.(png|webp|svg)$/;
const isIcon = (icon) => typeof icon === 'string' && (ICONS.includes(icon) || UPLOADED_ICON.test(icon));

/** How a condition ends: when someone takes it off, after a number of rounds, at a rest, or at the end of its next turn (8a9a). */
const ENDS = ['removed', 'rounds', 'rest', 'next_turn'];
/** EACH TURN (8a9a): when it fires, what it does, and who rolls it. */
const WHENS = ['turn_start', 'turn_end', 'round_start', 'round_end'];
const DOES = ['damage', 'heal', 'roll_to_end', 'just_roll'];
const ROLLED_BY = ['table', 'player'];
/** A modifier's target that is no single number: every roll the character makes. */
const ALL_ROLLS = 'all_rolls';
/** How a modifier counts (8a5e1): added, times, set to, or no more than. */
const WAYS = ['add', 'times', 'set', 'most'];

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

// only_with, the house rule a condition waits on, is houseRules.js's to check.
const STANDARD_KEYS = new Set(['on', 'name', 'short', 'icon', 'drawn', 'description', 'ends', 'rounds', 'at', 'modifiers', 'only_with', 'applied', 'each_turn']);
const OWN_KEYS = new Set(['name', 'short', 'icon', 'drawn', 'description', 'ends', 'rounds', 'at', 'modifiers', 'only_with', 'applied', 'each_turn']);

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

const text = (value, where, max, problems, { required = false } = {}) => {
  if (value === undefined) { if (required) problems.push({ where, message: 'Required' }); return; }
  if (typeof value !== 'string' || (required && !value.trim())) { problems.push({ where, message: required ? 'Cannot be blank' : 'Must be text' }); return; }
  if (value.length > max) problems.push({ where, message: `Longer than ${max} characters` });
};

/**
 * A modifier's amount, as checked: ALL ROLLS adds a whole number; a stat or formula takes a number (TIMES 0 to so many) or
 * formula text that `parse` reads (8a5e1).
 */
const checkAmount = (m, mw, problems, parse) => {
  const way = m.way === undefined ? 'add' : m.way;
  if (m.target === ALL_ROLLS) {
    if (!Number.isInteger(m.amount) || m.amount === 0 || Math.abs(m.amount) > LIMITS.amount) problems.push({ where: `${mw}, amount`, message: `A whole number from -${LIMITS.amount} to ${LIMITS.amount}, not 0` });
    return;
  }
  if (typeof m.amount === 'string') {
    if (!m.amount.trim()) problems.push({ where: `${mw}, amount`, message: 'A number, or formula text' });
    else if (m.amount.length > LIMITS.formula) problems.push({ where: `${mw}, amount`, message: `Longer than ${LIMITS.formula} characters` });
    else if (parse) { try { parse(m.amount); } catch (e) { problems.push({ where: `${mw}, amount`, message: e.message }); } }
    return;
  }
  if (typeof m.amount !== 'number' || !Number.isFinite(m.amount)) { problems.push({ where: `${mw}, amount`, message: 'A number, or formula text' }); return; }
  if (way === 'times') { if (m.amount < 0 || m.amount > LIMITS.times) problems.push({ where: `${mw}, amount`, message: `Times 0 to ${LIMITS.times}` }); return; }
  if (Math.abs(m.amount) > LIMITS.number) problems.push({ where: `${mw}, amount`, message: `From -${LIMITS.number} to ${LIMITS.number}` });
  else if (way === 'add' && m.amount === 0) problems.push({ where: `${mw}, amount`, message: 'Adding 0 changes nothing' });
};

const checkModifiers = (modifiers, where, targets, problems, parse) => {
  if (modifiers === undefined) return;
  if (!Array.isArray(modifiers)) { problems.push({ where, message: 'Must be a list of modifiers' }); return; }
  if (modifiers.length > LIMITS.modifiers) problems.push({ where, message: `At most ${LIMITS.modifiers} modifiers` });
  modifiers.slice(0, LIMITS.modifiers).forEach((m, i) => {
    const mw = `${where} ${i + 1}`;
    if (!isPlainObject(m)) { problems.push({ where: mw, message: 'Must say a target and an amount' }); return; }
    for (const key of Object.keys(m)) if (key !== 'target' && key !== 'amount' && key !== 'way') problems.push({ where: `${mw}, ${key}`, message: 'Only a target, a way and an amount' });
    if (m.target !== ALL_ROLLS && !(typeof m.target === 'string' && targets.has(m.target))) {
      problems.push({ where: `${mw}, target`, message: 'Must be all rolls, or one of this system\'s stats or formulas' });
    }
    if (m.way !== undefined && !WAYS.includes(m.way)) problems.push({ where: `${mw}, way`, message: 'ADD, TIMES, SET TO or AT MOST' });
    else if (m.target === ALL_ROLLS && m.way !== undefined && m.way !== 'add') problems.push({ where: `${mw}, way`, message: 'All rolls only take an ADD' });
    checkAmount(m, mw, problems, parse);
  });
};

/** A condition's EACH TURN, as checked (8a9a): `readRoll` reads a ROLL, answering why it can't or null; none checks it is text. */
const checkEachTurn = (list, where, problems, readRoll) => {
  if (list === undefined) return;
  if (!Array.isArray(list)) { problems.push({ where, message: 'Must be a list of what it does each turn' }); return; }
  if (list.length > LIMITS.eachTurn) problems.push({ where, message: `At most ${LIMITS.eachTurn}` });
  list.slice(0, LIMITS.eachTurn).forEach((e, i) => {
    const ew = `${where} ${i + 1}`;
    if (!isPlainObject(e)) { problems.push({ where: ew, message: 'Must say when, what it does and its roll' }); return; }
    for (const key of Object.keys(e)) if (!['when', 'does', 'roll', 'ends_on', 'changes_hp', 'rolled_by'].includes(key)) problems.push({ where: `${ew}, ${key}`, message: 'Not part of what a condition does each turn' });
    if (!WHENS.includes(e.when)) problems.push({ where: `${ew}, when`, message: 'The start or end of its turn, or of the round' });
    if (!DOES.includes(e.does)) problems.push({ where: `${ew}, does`, message: 'DAMAGE, HEAL, ROLL TO END or JUST ROLL' });
    if (typeof e.roll !== 'string' || !e.roll.trim()) problems.push({ where: `${ew}, roll`, message: 'Dice to roll, like 1d4' });
    else if (e.roll.length > LIMITS.formula) problems.push({ where: `${ew}, roll`, message: `Longer than ${LIMITS.formula} characters` });
    else if (readRoll) { const why = readRoll(e.roll); if (why) problems.push({ where: `${ew}, roll`, message: why }); }
    if (e.does === 'roll_to_end') {
      if (!Number.isInteger(e.ends_on) || Math.abs(e.ends_on) > LIMITS.endsOn) problems.push({ where: `${ew}, ends_on`, message: `The whole number it ends on or more, up to ${LIMITS.endsOn}` });
    } else if (e.ends_on !== undefined) problems.push({ where: `${ew}, ends_on`, message: 'Only a ROLL TO END ends on a number' });
    if (e.changes_hp !== undefined) {
      if (e.does !== 'damage' && e.does !== 'heal') problems.push({ where: `${ew}, changes_hp`, message: 'Only DAMAGE and HEAL change HP' });
      else if (typeof e.changes_hp !== 'boolean') problems.push({ where: `${ew}, changes_hp`, message: 'Whether it changes HP on its own: true or false' });
    }
    if (e.rolled_by !== undefined && !ROLLED_BY.includes(e.rolled_by)) problems.push({ where: `${ew}, rolled_by`, message: 'The table, or the player (the GM for an NPC)' });
  });
};

/**
 * Problems with a definition's `conditions`, pushed onto `problems`. `targets` are the ids a
 * modifier may name: the system's stats and formulas; `rests` the ids a condition may end at; `parse` reads a modifier's
 * formula (8a5e1), none checking only that it is text.
 */
const checkConditions = (conditions, targets, problems, rests = new Set(), parse = null, readRoll = null) => {
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
    if (c.drawn !== undefined && !isDrawn(c.drawn)) problems.push({ where: `${where}, drawn`, message: DRAWN_PROBLEM });
    if (c.icon !== undefined && c.drawn !== undefined) problems.push({ where: `${where}, drawn`, message: 'An icon or a drawing, not both' });
    if (c.ends !== undefined && !ENDS.includes(c.ends)) problems.push({ where: `${where}, ends`, message: 'Ends when removed, after rounds, at a rest, or at the end of its next turn' });
    if (c.ends === 'rounds') {
      if (!Number.isInteger(c.rounds) || c.rounds < 1 || c.rounds > LIMITS.rounds) {
        problems.push({ where: `${where}, rounds`, message: `A whole number from 1 to ${LIMITS.rounds}` });
      }
    } else if (c.rounds !== undefined) {
      problems.push({ where: `${where}, rounds`, message: 'Only a condition that ends after rounds has rounds' });
    }
    if (c.ends === 'rest') {
      if (!Array.isArray(c.at) || !c.at.length) problems.push({ where: `${where}, at`, message: 'Name the rests it wears off at' });
      else c.at.forEach((id, i) => { if (!rests.has(id)) problems.push({ where: `${where}, at ${i + 1}`, message: 'Not one of this system\'s rests' }); });
    } else if (c.at !== undefined) {
      problems.push({ where: `${where}, at`, message: 'Only a condition that ends at a rest names rests' });
    }
    if (has(c, 'applied') && typeof c.applied !== 'boolean') problems.push({ where: `${where}, applied`, message: 'Whether its modifiers are applied: true or false' });
    checkModifiers(c.modifiers, `${where}, modifier`, targets, problems, parse);
    checkEachTurn(c.each_turn, `${where}, each turn`, problems, readRoll);
  }
};

/** A condition's EACH TURN as the game runs it (8a9a): the well-formed ones, each whole. */
const eachTurnOf = (c) => (Array.isArray(c.each_turn) ? c.each_turn : []).slice(0, LIMITS.eachTurn)
  .filter((e) => isPlainObject(e) && WHENS.includes(e.when) && DOES.includes(e.does) && typeof e.roll === 'string' && e.roll.trim() && (e.does !== 'roll_to_end' || Number.isInteger(e.ends_on)))
  .map((e) => ({
    when: e.when, does: e.does, roll: e.roll.trim(),
    ...(e.does === 'roll_to_end' ? { ends_on: e.ends_on } : {}),
    ...(e.does === 'damage' || e.does === 'heal' ? { changes_hp: e.changes_hp !== false } : {}),
    rolled_by: e.rolled_by === 'player' ? 'player' : 'table',
  }));

/**
 * Whether any of `conditions` (as conditionsOf gives them) does anything on initiative turns (8a9c): an EACH TURN, or an
 * ending AT THE END OF ITS NEXT TURN. Where none does, round 1 needs no BEGIN.
 */
const onTurns = (conditions) => conditions.some((c) => c.ends === 'next_turn' || (Array.isArray(c.each_turn) && c.each_turn.length > 0));

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
      // A drawing (8b1b) shows instead of the icon wherever the condition is drawn; the icon stays, for what draws only icons.
      ...(isDrawn(c.drawn) ? { drawn: [...c.drawn] } : {}),
      description: typeof c.description === 'string' ? c.description : (base.description || ''),
      ends,
      ...(ends === 'rounds' && Number.isInteger(c.rounds) ? { rounds: c.rounds } : {}),
      ...(ends === 'rest' ? { at: Array.isArray(c.at) ? c.at.filter((id) => typeof id === 'string') : [] } : {}),
      modifiers: Array.isArray(c.modifiers) ? c.modifiers.filter((m) => isPlainObject(m)).map((m) => ({ target: m.target, amount: m.amount, ...(WAYS.includes(m.way) && m.way !== 'add' ? { way: m.way } : {}) })) : [],
      // Its modifiers change the sheet's numbers (8a5e1), or are a reminder.
      ...(c.applied === true ? { applied: true } : {}),
      // What it does on initiative turns (8a9a), each whole: changes_hp on and rolled by the table unless said otherwise.
      ...(eachTurnOf(c).length ? { each_turn: eachTurnOf(c) } : {}),
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

module.exports = { STANDARD, ICONS, ENDS, ALL_ROLLS, WAYS, WHENS, DOES, ROLLED_BY, LIMITS, UPLOADED_ICON, isIcon, checkConditions, conditionsOf, eachTurnOf, onTurns };
