// A system's NEW CHARACTER flow (7c1; approved mockup docs/mockups/new-character.html, 2026-11-03):
// the steps a player is walked through for a new character, in the GM's order, in place of a blank
// sheet. Off unless the GM turns it on, so a game with no answer works as it always has.
//
//   creation: {
//     on: true,                               // GUIDED NEW CHARACTER
//     order: ['who', 'stats', 'list:classes', 'kits', 'money'],   // only what was moved
//     off: ['money'],                         // steps switched off; WHO THEY ARE never is
//   }
//
// A step is read from what the system has, never stored: WHO THEY ARE always; THE STATS with stats to
// set; one for each list picked on its own (a list picked only under features is picked there, and
// one everyone has isn't picked); KITS; MONEY while the BANK part is on. So a list made later joins
// by itself, before KITS, and a list deleted leaves, and an order naming what has gone is no problem.
//
// A character's place in the flow (7c2) is kept on their sheet, under CREATING_KEY, where a player's
// own edits can't reach it (an underscore key, as their picks are):
//
//   _creating: {}                   opened, nothing started: the window's START
//   _creating: { at: 'stats' }      working, on that step
//   _creating: { done: true, uploaded?: true }   finished, or came in as an upload
//
// Who is asked at all is the browser's to work out (sheets/newCharacterFlow.ts): a blank sheet with
// nothing here. Being asked only opens a window, so nothing is guarded by it, and nothing is locked
// after it: the sheet works as it always has. What the flow does change on the server is one thing:
// while it is under way a player may take a pick back (picking.js).
//
// Pure: checks and reads only. definition.js runs the checks, picking.js and the socket the rest.

const { partOn } = require('./parts');
const { choicesOf, pickedOf } = require('./choices');

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);

/** How many ids `order` and `off` may hold: every list a system can have, and room. */
const LIMITS = { steps: 40 };
const KEYS = new Set(['on', 'order', 'off']);
const STEP = /^(?:who|stats|kits|money|list:[a-z][a-z0-9_]{0,63})$/;
/** Where a sheet keeps its place in the flow. */
const CREATING_KEY = '_creating';
/** Steps with nothing to ask yet: KITS and MONEY come with 7c4. */
const NOT_ASKED_YET = new Set(['kits', 'money']);

/** Every step this system has, in the order they come until the GM moves them. */
const stepIdsOf = (definition) => [
  'who',
  ...(list(definition && definition.stats).some((g) => isPlainObject(g) && list(g.stats).length) ? ['stats'] : []),
  ...choicesOf(definition).filter((c) => ['own', 'both'].includes(pickedOf(c))).map((c) => `list:${c.id}`),
  'kits',
  ...(partOn(definition, 'bank') ? ['money'] : []),
];

/**
 * The flow as this system has it: { on, steps: [{ id, off }] }, the steps the GM moved in their order,
 * then any since added, each before KITS and MONEY when it is a list, so a new list lands with the others.
 */
const creationOf = (definition) => {
  const c = isPlainObject(definition && definition.creation) ? definition.creation : {};
  const have = stepIdsOf(definition);
  const moved = list(c.order).filter((id, i, all) => have.includes(id) && all.indexOf(id) === i);
  const ids = [...moved];
  for (const id of have) {
    if (ids.includes(id)) continue;
    const before = id.startsWith('list:') ? ids.findIndex((x) => x === 'kits' || x === 'money') : -1;
    if (before >= 0) ids.splice(before, 0, id); else ids.push(id);
  }
  const off = new Set(list(c.off));
  return { on: c.on === true, steps: ids.map((id) => ({ id, off: id !== 'who' && off.has(id) })) };
};

/** The steps a player is walked through, in order: those on, with something to ask. */
const stepsAsked = (definition) => creationOf(definition).steps
  .filter((s) => !s.off && !NOT_ASKED_YET.has(s.id)).map((s) => s.id);

/** What the browser needs to draw the flow: the steps and the stats to set, or null while it is off. */
const creationShown = (definition) => (creationOf(definition).on ? {
  steps: stepsAsked(definition),
  stats: list(definition.stats).filter((g) => isPlainObject(g) && list(g.stats).length).map((g) => ({
    id: g.id,
    label: g.label || g.id,
    stats: g.stats.filter(isPlainObject).map((s) => ({ id: s.id, label: s.label || s.id, ...(s.min === undefined ? {} : { min: s.min }), ...(s.max === undefined ? {} : { max: s.max }) })),
  })),
} : null);

/** A sheet's place in the flow, or null. */
const placeOf = (data) => (isPlainObject(data) && isPlainObject(data[CREATING_KEY]) ? data[CREATING_KEY] : null);

/** Whether this character is partway through the flow: opened, not finished, with the flow still on. */
const creatingNow = (definition, data) => {
  const place = placeOf(data);
  return !!place && place.done !== true && creationOf(definition).on;
};

/**
 * One step of a character's way through the flow: { kind: 'open' }, { kind: 'at', step } or
 * { kind: 'finish' }. Gives back { ok: true, data } (no `data` when there is nothing to change), or
 * { ok: false, error } in words.
 */
const creationAction = (definition, data, action) => {
  const sheet = isPlainObject(data) ? data : {};
  const kind = isPlainObject(action) ? action.kind : null;
  if (!creationOf(definition).on) return { ok: false, error: 'This game has no guided new character' };
  if (kind === 'open') return placeOf(sheet) ? { ok: true } : { ok: true, data: { ...sheet, [CREATING_KEY]: {} } };
  if (kind !== 'at' && kind !== 'finish') return { ok: false, error: 'Nothing to do' };
  if (!creatingNow(definition, sheet)) return { ok: false, error: 'This character isn\'t being made' };
  if (kind === 'finish') return { ok: true, data: { ...sheet, [CREATING_KEY]: { done: true } } };
  if (!stepsAsked(definition).includes(action.step)) return { ok: false, error: 'Not one of this game\'s steps' };
  return { ok: true, data: { ...sheet, [CREATING_KEY]: { ...placeOf(sheet), at: action.step } } };
};

/**
 * The sheet after an upload (the approved mockup's call: taken as it is, no steps after it): marked
 * done, so it is never asked. Nothing changes where the flow is off or already finished.
 */
const withUpload = (definition, data) => {
  const place = placeOf(data);
  if (!creationOf(definition).on || (place && place.done === true)) return data;
  return { ...data, [CREATING_KEY]: { done: true, uploaded: true } };
};

/** A definition's `creation` checked, its problems added to `problems`. */
const checkCreation = (definition, problems) => {
  const c = definition.creation;
  if (c === undefined) return;
  if (!isPlainObject(c)) { problems.push({ where: 'creation', message: 'Must say how a new character is made' }); return; }
  for (const key of Object.keys(c)) if (!KEYS.has(key)) problems.push({ where: `creation, ${key}`, message: 'Not part of the new character flow' });
  if (c.on !== undefined && typeof c.on !== 'boolean') problems.push({ where: 'creation, on', message: 'Must say on: true or on: false' });
  for (const key of ['order', 'off']) {
    const v = c[key];
    if (v === undefined) continue;
    if (!Array.isArray(v)) { problems.push({ where: `creation, ${key}`, message: 'Must be a list of steps' }); continue; }
    if (v.length > LIMITS.steps) problems.push({ where: `creation, ${key}`, message: `At most ${LIMITS.steps} steps` });
    if (v.slice(0, LIMITS.steps).some((id) => typeof id !== 'string' || !STEP.test(id))) problems.push({ where: `creation, ${key}`, message: 'Steps are who, stats, kits, money, or list: and a list\'s id' });
  }
  if (list(c.off).includes('who')) problems.push({ where: 'creation, off', message: 'WHO THEY ARE is always asked: a character needs a name' });
};

module.exports = { LIMITS, CREATING_KEY, stepIdsOf, creationOf, checkCreation, stepsAsked, creationShown, creatingNow, creationAction, withUpload };
