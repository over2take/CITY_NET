// Picking on a character's sheet (7a3a; approved mockup docs/mockups/builder-choices.html, and the
// user's calls of 2026-10-28): what a player or the GM may do to a character's picks, checked here on
// the server, the sheet as stored the only thing trusted.
//
//   pick   a player picks for their own character while the list has room and the option's
//          requirement is met; the GM may pick past a requirement, never past the list's room.
//          A list picked through features (7a5a) is picked under one that opens it (`from`), while
//          that feature is unlocked and has room; a list picked both ways takes either. Nothing
//          is picked, dropped or levelled in a list every character has (7a5a2)
//   drop   only the GM takes a pick away
//   level  a pick's level in a levelled list, from 1 to the highest: the player or the GM
//   use    how many of a feature's uses are spent, from none to all of them: the player or the GM
//   recovery  how many of a pool of recovery dice are spent, from none to all (R2a): ticked off for
//          real dice, or put right; the player or the GM. Spending them with a roll is sheets/recover.js's
//
// Pure: takes the running definition and the sheet's data, and gives back the data to store or why
// not. The socket (sockets/choices.js) stores it through the sheet queue and works the numbers out
// again. Picks and spent uses are kept where choices.js says (PICKS_KEY, USES_KEY).

const { choicesOf, heldOf, pickedOf, openingsOf, capOf, meets, needsText, usesOf, PICKS_KEY, USES_KEY, LIMITS } = require('./choices');
const { poolsOf, RECOVERY_KEY } = require('./recovery');

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const fail = (error) => ({ ok: false, error });

/** The list's picks, stored back as they are read: every one kept (those waiting too), in order. */
const storedPicks = (held, c) => held.filter((p) => p.list === c)
  .map((p) => ({ option: p.option.id, ...(p.level === null ? {} : { level: p.level }), ...(p.from ? { from: p.from } : {}) }));

const withPicks = (data, listId, stored) => ({ ...data, [PICKS_KEY]: { ...(isPlainObject(data[PICKS_KEY]) ? data[PICKS_KEY] : {}), [listId]: stored } });

/**
 * One action on a sheet's picks. `action` is { kind: 'pick' | 'drop' | 'level', list, option, level, from }
 * or { kind: 'use', feature, spent }; `gm` says whether the GM asks. Returns { ok: true, data } or
 * { ok: false, error } in words for the person who asked.
 */
const pickAction = (definition, data, action, { gm = false } = {}) => {
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
    const from = typeof action.from === 'string' ? action.from : null;
    const mode = pickedOf(c);
    if (from) {
      if (mode === 'own') return fail(`The ${many} aren't picked under features`);
      const opening = openingsOf(definition, held.filter((p) => p.active)).find((o) => o.feature.id === from);
      if (!opening || opening.list !== c) return fail(`Nothing unlocked there opens the ${many}`);
      if (opening.used >= opening.count) return fail(`No more ${many} can be picked there`);
    } else {
      if (mode === 'features') return fail(`The ${many} are picked under the features that open them`);
      if (mine.filter((p) => !p.from && p.active).length >= capOf(c)) return fail(`No more ${many} can be picked`);
    }
    if (!gm && !meets(definition, sheet, option)) return fail(`${name} needs ${needsText(definition, option.requires)}`);
    const added = { option: option.id, ...(c.levelled === true ? { level: 1 } : {}), ...(from ? { from } : {}) };
    return { ok: true, data: withPicks(sheet, c.id, [...storedPicks(held, c), added]) };
  }

  if (action.kind === 'drop') {
    if (!gm) return fail('Only the GM takes a pick away');
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

module.exports = { pickAction };
