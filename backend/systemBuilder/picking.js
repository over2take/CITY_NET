// Picking on a character's sheet (7a3a; approved mockup docs/mockups/builder-choices.html, and the
// user's calls of 2026-10-28): what a player or the GM may do to a character's picks, checked here on
// the server, the sheet as stored the only thing trusted.
//
//   pick   a player picks for their own character while the list has room and the option's
//          requirement is met; the GM may pick past a requirement, never past the list's room.
//          A list picked through features (7a5a) is picked under one that opens it (`from`), while
//          that feature is unlocked and has room; a list picked both ways takes either. Nothing
//          is picked, dropped or levelled in a list every character has (7a5a2)
//   drop   only the GM takes a pick away, or a player their own while making the character (7c2), on
//          a list not rolled only, as that would be a second roll by another name
//   level  a pick's level in a levelled list, from 1 to the highest: the player or the GM
//   use    how many of a feature's uses are spent, from none to all of them: the player or the GM
//   recovery  how many of a pool of recovery dice are spent, from none to all (R2a): ticked off for
//          real dice, or put right; the player or the GM. Spending them with a roll is sheets/recover.js's
//   roll   ROLL FOR IT on a list with a table (7a5b2; approved mockup nested-choices, version 2): the
//          dice rolled, the option it lands on kept until taken, nothing picked; wherever a pick
//          would have room. Players roll where the list lets them (by hand or rolled, or rolled
//          only), and under ROLLED ONLY once, until it is taken: rolling again is the GM's, who may
//          roll on any list with a table. Under ROLLED ONLY a player picks only what was rolled;
//          the GM picks anything. A pick clears that list's roll
//
// Pure: takes the running definition and the sheet's data, and gives back the data to store or why
// not. The socket (sockets/choices.js) stores it through the sheet queue and works the numbers out
// again. Picks and spent uses are kept where choices.js says (PICKS_KEY, USES_KEY).

const {
  choicesOf, heldOf, pickedOf, openingsOf, capOf, meets, needsText, usesOf, tableOf, playersOf, rolledOn, rolledKey, rolledOf,
  PICKS_KEY, USES_KEY, ROLLED_KEY, LIMITS,
} = require('./choices');
const { poolsOf, RECOVERY_KEY } = require('./recovery');
const { creatingNow } = require('./creation');
const crypto = require('crypto');

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
/** The server's secure dice (as every roll's): 0 to 1. */
const cryptoRng = () => crypto.randomInt(0, 2 ** 32) / 2 ** 32;
const fail = (error) => ({ ok: false, error });

/** The list's picks, stored back as they are read: every one kept (those waiting too), in order. */
const storedPicks = (held, c) => held.filter((p) => p.list === c)
  .map((p) => ({ option: p.option.id, ...(p.level === null ? {} : { level: p.level }), ...(p.from ? { from: p.from } : {}) }));

const withPicks = (data, listId, stored) => ({ ...data, [PICKS_KEY]: { ...(isPlainObject(data[PICKS_KEY]) ? data[PICKS_KEY] : {}), [listId]: stored } });

/** The sheet with one list's roll kept, or taken away (`rolled` null). */
const withRolled = (data, key, rolled) => {
  const all = { ...(isPlainObject(data[ROLLED_KEY]) ? data[ROLLED_KEY] : {}) };
  if (rolled) all[key] = rolled; else delete all[key];
  const next = { ...data, [ROLLED_KEY]: all };
  if (!Object.keys(all).length) delete next[ROLLED_KEY];
  return next;
};

/**
 * Why a list has no room for another pick here, or null: under a feature that opens it (`from`),
 * that feature unlocked with picks to give; on its own, below what the list allows.
 */
const noRoom = (definition, held, c, from) => {
  const many = c.many || c.id;
  const mode = pickedOf(c);
  if (from) {
    if (mode === 'own') return `The ${many} aren't picked under features`;
    const opening = openingsOf(definition, held.filter((p) => p.active)).find((o) => o.feature.id === from);
    if (!opening || opening.list !== c) return `Nothing unlocked there opens the ${many}`;
    if (opening.used >= opening.count) return `No more ${many} can be picked there`;
    return null;
  }
  if (mode === 'features') return `The ${many} are picked under the features that open them`;
  if (held.filter((p) => p.list === c && !p.from && p.active).length >= capOf(c)) return `No more ${many} can be picked`;
  return null;
};

/**
 * One action on a sheet's picks. `action` is { kind: 'pick' | 'drop' | 'level', list, option, level, from },
 * { kind: 'roll', list, from }, or { kind: 'use', feature, spent }; `gm` says whether the GM asks;
 * `rng` rolls a roll's dice, 0 to 1 (the secure source unless one is handed in). Returns { ok: true, data } or { ok: false,
 * error } in words for the person who asked; a roll also { rolled: { list, dice, rolls, total, option } }.
 */
const pickAction = (definition, data, action, { gm = false, rng = cryptoRng } = {}) => {
  const sheet = isPlainObject(data) ? data : {};
  if (!isPlainObject(action)) return fail('Nothing to do');

  if (action.kind === 'use') {
    const u = usesOf(definition, sheet).find((x) => x.feature.id === action.feature);
    if (!u) return fail('This character has no such feature with uses');
    const spent = Number(action.spent);
    if (!Number.isInteger(spent) || spent < 0 || spent > u.max) return fail(`Between none and all ${u.max} of its uses`);
    return { ok: true, data: { ...sheet, [USES_KEY]: { ...(isPlainObject(sheet[USES_KEY]) ? sheet[USES_KEY] : {}), [u.feature.id]: spent } } };
  }

  if (action.kind === 'recovery') {
    const pool = poolsOf(definition, sheet).find((p) => p.id === action.pool);
    if (!pool) return fail('This character has no such recovery dice');
    const spent = Number(action.spent);
    if (!Number.isInteger(spent) || spent < 0 || spent > pool.total) return fail(`Between none and all ${pool.total} of them`);
    return { ok: true, data: { ...sheet, [RECOVERY_KEY]: { ...(isPlainObject(sheet[RECOVERY_KEY]) ? sheet[RECOVERY_KEY] : {}), [pool.id]: spent } } };
  }

  const c = choicesOf(definition).find((x) => x.id === action.list);
  if (!c) return fail('Not one of this system\'s lists');
  const from = typeof action.from === 'string' ? action.from : null;

  if (action.kind === 'roll') {
    const many = c.many || c.id;
    const table = tableOf(c);
    if (!table) return fail(`The ${many} have no table to roll on`);
    if (pickedOf(c) === 'everyone') return fail(`Every character has the ${many}: nothing to pick`);
    const players = playersOf(c);
    if (!gm && players === 'hand') return fail(`The ${many} are picked by hand`);
    const room = noRoom(definition, heldOf(definition, sheet), c, from);
    if (room) return fail(room);
    const before = rolledOf(sheet, c.id, from);
    if (!gm && players === 'roll' && before) return fail('Rolled already: take what came up, or ask the GM to roll again');
    const rolls = Array.from({ length: table.count }, () => Math.floor(rng() * table.sides) + 1);
    const total = rolls.reduce((a, b) => a + b, 0);
    const hit = rolledOn(c, total);
    return {
      ok: true,
      data: withRolled(sheet, rolledKey(c.id, from), { option: hit ? hit.id : null, roll: total }),
      rolled: { list: c, dice: c.table.trim().toLowerCase(), sides: table.sides, rolls, total, option: hit },
    };
  }

  const option = (Array.isArray(c.options) ? c.options : []).find((o) => isPlainObject(o) && o.id === action.option);
  if (!option) return fail(`Not one of the ${c.many || c.id}`);
  const name = option.label || option.id;
  const many = c.many || c.id;
  if (pickedOf(c) === 'everyone') return fail(`Every character has the ${many}: nothing to pick`);
  const held = heldOf(definition, sheet);
  const mine = held.filter((p) => p.list === c);
  const taken = mine.find((p) => p.option === option);

  if (action.kind === 'pick') {
    if (taken) return fail(`${name} is already picked`);
    const room = noRoom(definition, held, c, from);
    if (room) return fail(room);
    // Rolled only (7a5b2): a player takes what was rolled; the GM picks anything.
    const rolled = rolledOf(sheet, c.id, from);
    if (!gm && playersOf(c) === 'roll' && (!rolled || rolled.option !== option.id)) return fail(`The ${many} are picked by roll: ROLL FOR IT`);
    if (!gm && !meets(definition, sheet, option)) return fail(`${name} needs ${needsText(definition, option.requires)}`);
    const added = { option: option.id, ...(c.levelled === true ? { level: 1 } : {}), ...(from ? { from } : {}) };
    return { ok: true, data: withRolled(withPicks(sheet, c.id, [...storedPicks(held, c), added]), rolledKey(c.id, from), null) };
  }

  if (action.kind === 'drop') {
    if (!gm && !(creatingNow(definition, sheet) && playersOf(c) !== 'roll')) return fail('Only the GM takes a pick away');
    if (!taken) return fail(`${name} isn't picked`);
    return { ok: true, data: withPicks(sheet, c.id, storedPicks(held, c).filter((p) => p.option !== option.id)) };
  }

  if (action.kind === 'level') {
    if (c.levelled !== true) return fail(`The ${c.many || c.id} have no levels`);
    if (!taken) return fail(`${name} isn't picked`);
    const level = Number(action.level);
    if (!Number.isInteger(level) || level < 1 || level > LIMITS.level) return fail(`A level from 1 to ${LIMITS.level}`);
    return { ok: true, data: withPicks(sheet, c.id, storedPicks(held, c).map((p) => (p.option === option.id ? { ...p, level } : p))) };
  }

  return fail('Nothing to do');
};

/**
 * The dice-log line for ROLL FOR IT (7a5b2): "Wren rolled Background (2d6) [3 + 4 = 7] — SCRIBE", or
 * "— NOTHING ON THE TABLE" when the roll lands on no option.
 */
const rollLine = (who, rolled) => {
  const one = rolled.list.one || rolled.list.id;
  const landed = rolled.option ? String(rolled.option.label || rolled.option.id).toUpperCase() : 'NOTHING ON THE TABLE';
  return `${who} rolled ${one} (${rolled.dice}) [${rolled.rolls.join(' + ')} = ${rolled.total}] — ${landed}`;
};

module.exports = { pickAction, rollLine };
