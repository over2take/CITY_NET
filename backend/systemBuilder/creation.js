// A system's NEW CHARACTER flow (7c1; approved mockup docs/mockups/new-character.html, 2026-11-03):
// the steps a player is walked through for a new character, in the GM's order, in place of a blank
// sheet. Off unless the GM turns it on, so a game with no answer works as it always has.
//
//   creation: {
//     on: true,                               // GUIDED NEW CHARACTER
//     order: ['who', 'stats', 'list:classes', 'kits', 'money'],   // only what was moved
//     off: ['money', 'stats:stress'],         // steps switched off; WHO THEY ARE never is
//     statsBy: 'group',                       // GROUP BY GROUP (7c3a); unsaid, ONE WAY FOR ALL
//     ways: { stats: { way: 'array', numbers: [15, 14, 13, 12] } },   // how a stats step is set (7c3b); unsaid, typed in
//   }
//
// A step is read from what the system has, never stored: WHO THEY ARE always; THE STATS with stats to
// set, or one for each stats group with GROUP BY GROUP (stats:<group>); one for each list picked on its own (a list picked only under features is picked there, and
// one everyone has isn't picked); KITS; MONEY while the BANK part is on. So a list made later joins
// by itself, before KITS, and a list deleted leaves, and an order naming what has gone is no problem.
// A group left out says so the same way either way, as stats:<group> in `off`: a step switched off with
// GROUP BY GROUP, and left out of THE STATS with ONE WAY FOR ALL. So changing between them loses nothing.
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
// after it: the sheet works as it always has. What the flow does change on the server, while it is under
// way: a player may take a pick back (picking.js), and may not write a stat set some way other than
// typing (lockedWhileCreating), or a number placed could simply be typed over. Finished, it is theirs.
//
// A way is kept under the step it sets, so one way for all and each group's keep theirs through changing
// between them. A fixed array's numbers are placed by `place`, on the stats themselves, so there is
// nothing else to keep: a number counts as placed while a stat holds it and the pool still has it.
//
// Pure: checks and reads only. definition.js runs the checks, picking.js and the socket the rest.

const { partOn } = require('./parts');
const { choicesOf, pickedOf } = require('./choices');
const { fieldsOf } = require('./sheet');

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);

/** How many ids `order` and `off` may hold: every list a system can have, and room. */
const LIMITS = { steps: 40, numbers: 40 };
const KEYS = new Set(['on', 'order', 'off', 'statsBy', 'ways']);
const STATS_STEP = /^stats(?::[a-z][a-z0-9_]{0,63})?$/;
const WAY_KEYS = { typed: new Set(['way']), array: new Set(['way', 'numbers']) };
const STEP = /^(?:who|stats(?::[a-z][a-z0-9_]{0,63})?|kits|money|list:[a-z][a-z0-9_]{0,63})$/;
/** Where a sheet keeps its place in the flow. */
const CREATING_KEY = '_creating';
/** Steps with nothing to ask yet: KITS and MONEY come with 7c4. */
const NOT_ASKED_YET = new Set(['kits', 'money']);

const creationIn = (definition) => (isPlainObject(definition && definition.creation) ? definition.creation : {});
/** A stats group's own step, with GROUP BY GROUP. */
const isGroupStep = (id) => id.startsWith('stats:');
/** The stats groups with stats in them. */
const statGroupsOf = (definition) => list(definition && definition.stats).filter((g) => isPlainObject(g) && list(g.stats).length);
const byGroup = (definition) => creationIn(definition).statsBy === 'group';
/** The groups a player sets: all but those left out. */
const statGroupsAsked = (definition) => {
  const off = new Set(list(creationIn(definition).off));
  return statGroupsOf(definition).filter((g) => !off.has(`stats:${g.id}`));
};

/** Every step this system has, in the order they come until the GM moves them. */
const stepIdsOf = (definition) => [
  'who',
  ...(byGroup(definition)
    ? statGroupsOf(definition).map((g) => `stats:${g.id}`)
    : statGroupsOf(definition).length ? ['stats'] : []),
  ...choicesOf(definition).filter((c) => ['own', 'both'].includes(pickedOf(c))).map((c) => `list:${c.id}`),
  'kits',
  ...(partOn(definition, 'bank') ? ['money'] : []),
];

/**
 * The flow as this system has it: { on, steps: [{ id, off }] }, the steps the GM moved in their order,
 * then any since added, each before KITS and MONEY when it is a list, so a new list lands with the others,
 * and after the other groups when it is a stats group. THE STATS and the groups' steps stand in for each
 * other in an order, so changing how the stats are asked keeps their place.
 */
const creationOf = (definition) => {
  const c = creationIn(definition);
  const have = stepIdsOf(definition);
  const groups = have.filter(isGroupStep);
  const read = list(c.order).flatMap((id) => {
    if (id === 'stats' && byGroup(definition)) return groups;
    return typeof id === 'string' && isGroupStep(id) && !byGroup(definition) ? ['stats'] : [id];
  });
  const moved = read.filter((id, i, all) => have.includes(id) && all.indexOf(id) === i);
  const ids = [...moved];
  for (const id of have) {
    if (ids.includes(id)) continue;
    const lastGroup = ids.map(isGroupStep).lastIndexOf(true);
    const before = id.startsWith('list:') ? ids.findIndex((x) => x === 'kits' || x === 'money')
      : isGroupStep(id) && lastGroup >= 0 ? lastGroup + 1 : -1;
    if (before >= 0) ids.splice(before, 0, id); else ids.push(id);
  }
  const off = new Set(list(c.off));
  return { on: c.on === true, steps: ids.map((id) => ({ id, off: id !== 'who' && off.has(id) })) };
};

/** How a stats step is set: typed in, unless the GM says otherwise. */
const wayOf = (definition, step) => {
  const ways = creationIn(definition).ways;
  const way = isPlainObject(ways) ? ways[step] : null;
  return isPlainObject(way) && way.way === 'array' && Array.isArray(way.numbers) ? way : { way: 'typed' };
};

/** The stats a step sets: all asked, or one group's, without those the GM keeps to themselves on the sheet. */
const statsOfStep = (definition, step) => {
  const gmOnly = new Set(fieldsOf(definition && definition.sheet).filter((f) => isPlainObject(f) && f.edit === 'gm').map((f) => f.id));
  const groups = step === 'stats' ? statGroupsAsked(definition) : statGroupsOf(definition).filter((g) => `stats:${g.id}` === step);
  return groups.flatMap((g) => g.stats.filter(isPlainObject)).filter((s) => !gmOnly.has(s.id));
};

/**
 * Which numbers of a pool the stats hold, and those left: a number counts once, and a value the pool
 * doesn't have isn't placed (it can only be there from before the GM changed the way).
 */
const placedFrom = (pool, stats, data) => {
  const left = [...pool];
  const placed = {};
  for (const s of stats) {
    const at = left.indexOf(data[s.id]);
    if (at >= 0) placed[s.id] = left.splice(at, 1)[0];
  }
  return { placed, left };
};

/** Whether a stats step with a way of its own is done: every stat holding a number. */
const wayDone = (definition, data, step) => {
  const way = wayOf(definition, step);
  if (way.way !== 'array') return true;
  const stats = statsOfStep(definition, step);
  const { placed } = placedFrom(way.numbers, stats, data);
  return stats.every((s) => placed[s.id] !== undefined);
};

/** The steps a player is walked through, in order: those on, with something to ask. */
const stepsAsked = (definition) => creationOf(definition).steps
  .filter((s) => !s.off && !NOT_ASKED_YET.has(s.id) && (s.id !== 'stats' || statGroupsAsked(definition).length > 0))
  .map((s) => s.id);

/** The ways of the steps asked, those not typed in, by step. */
const waysShown = (definition) => {
  const ways = {};
  for (const step of stepsAsked(definition)) if (STATS_STEP.test(step) && wayOf(definition, step).way !== 'typed') ways[step] = wayOf(definition, step);
  return ways;
};

/** What the browser needs to draw the flow: the steps and the stats to set, or null while it is off. */
const creationShown = (definition) => (creationOf(definition).on ? {
  steps: stepsAsked(definition),
  ...(Object.keys(waysShown(definition)).length ? { ways: waysShown(definition) } : {}),
  stats: statGroupsAsked(definition).map((g) => ({
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
 * The stats a player may not write themselves just now: while this character is being made, those of a
 * step set some way other than typing. Empty with no system (a built-in one), or once it is finished.
 */
const lockedWhileCreating = (definition, data) => {
  if (!definition || !creatingNow(definition, data)) return new Set();
  return new Set(stepsAsked(definition)
    .filter((step) => STATS_STEP.test(step) && wayOf(definition, step).way !== 'typed')
    .flatMap((step) => statsOfStep(definition, step).map((s) => s.id)));
};

/** A number put on a stat, or with `value` null taken back, in its pool. */
const placeNumber = (definition, sheet, action) => {
  if (!stepsAsked(definition).includes(action.step)) return { ok: false, error: 'Not one of this game\'s steps' };
  const way = wayOf(definition, action.step);
  if (way.way !== 'array') return { ok: false, error: 'These stats aren\'t placed' };
  const stats = statsOfStep(definition, action.step);
  if (!stats.some((s) => s.id === action.stat)) return { ok: false, error: 'Not one of this step\'s stats' };
  const { placed, left } = placedFrom(way.numbers, stats, sheet);
  if (action.value === null) {
    const { [action.stat]: gone, ...rest } = sheet;
    return { ok: true, data: rest };
  }
  // The number already on this stat goes back in the pool as this one comes off it.
  const free = placed[action.stat] === undefined ? left : [...left, placed[action.stat]];
  if (!free.includes(action.value)) return { ok: false, error: 'That number is already placed' };
  return { ok: true, data: { ...sheet, [action.stat]: action.value } };
};

/**
 * One step of a character's way through the flow: { kind: 'open' }, { kind: 'at', step },
 * { kind: 'place', step, stat, value } or { kind: 'finish' }. Gives back { ok: true, data } (no `data`
 * when there is nothing to change), or { ok: false, error } in words.
 */
const creationAction = (definition, data, action) => {
  const sheet = isPlainObject(data) ? data : {};
  const kind = isPlainObject(action) ? action.kind : null;
  if (!creationOf(definition).on) return { ok: false, error: 'This game has no guided new character' };
  if (kind === 'open') return placeOf(sheet) ? { ok: true } : { ok: true, data: { ...sheet, [CREATING_KEY]: {} } };
  if (!['at', 'finish', 'place'].includes(kind)) return { ok: false, error: 'Nothing to do' };
  if (!creatingNow(definition, sheet)) return { ok: false, error: 'This character isn\'t being made' };
  if (kind === 'place') return placeNumber(definition, sheet, action);
  if (kind === 'finish') {
    if (stepsAsked(definition).some((step) => STATS_STEP.test(step) && !wayDone(definition, sheet, step))) return { ok: false, error: 'Every stat needs its number first' };
    return { ok: true, data: { ...sheet, [CREATING_KEY]: { done: true } } };
  }
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

/** "2 numbers", "1 stat". */
const counted = (n, what) => `${n} ${what}${n === 1 ? '' : 's'}`;

/**
 * What stops a step's way working at the table, in words: too few numbers for its stats, or one that
 * doesn't fit a stat, as a player may place each on any.
 */
const stepWayProblems = (definition, step) => {
  const way = wayOf(definition, step);
  if (way.way !== 'array') return [];
  const stats = statsOfStep(definition, step);
  const numbers = way.numbers.filter(Number.isSafeInteger);
  const found = [];
  if (numbers.length < stats.length) found.push(`${counted(numbers.length, 'number')} for ${counted(stats.length, 'stat')}: each stat needs one`);
  for (const n of [...new Set(numbers)]) {
    for (const s of stats) {
      if (Number.isSafeInteger(s.min) && n < s.min) found.push(`${n} is below ${s.label || s.id}'s lowest, ${s.min}`);
      if (Number.isSafeInteger(s.max) && n > s.max) found.push(`${n} is above ${s.label || s.id}'s highest, ${s.max}`);
    }
  }
  return found;
};

/** A definition's `ways` checked: what each is, then whether the steps asked can be done that way. */
const checkWays = (definition, ways, problems) => {
  if (ways === undefined) return;
  if (!isPlainObject(ways)) { problems.push({ where: 'creation, ways', message: 'Must say how each step\'s stats are set' }); return; }
  for (const [step, way] of Object.entries(ways)) {
    const where = `creation, ways, ${step}`;
    if (!STATS_STEP.test(step)) { problems.push({ where, message: 'Only the stats have a way to be set' }); continue; }
    if (!isPlainObject(way) || !Object.keys(WAY_KEYS).includes(way.way)) { problems.push({ where, message: 'Must be typed or array' }); continue; }
    for (const key of Object.keys(way)) if (!WAY_KEYS[way.way].has(key)) problems.push({ where: `${where}, ${key}`, message: 'Not part of this way' });
    if (way.way !== 'array') continue;
    if (!Array.isArray(way.numbers)) { problems.push({ where: `${where}, numbers`, message: 'Must be a list of numbers' }); continue; }
    if (way.numbers.length > LIMITS.numbers) problems.push({ where: `${where}, numbers`, message: `At most ${LIMITS.numbers} numbers` });
    if (!way.numbers.every(Number.isSafeInteger)) problems.push({ where: `${where}, numbers`, message: 'Must be whole numbers' });
  }
  // Only the way of a step this game has: the other way of asking's stays set, unused.
  for (const { id } of creationOf(definition).steps) {
    if (STATS_STEP.test(id)) stepWayProblems(definition, id).forEach((message) => problems.push({ where: `creation, ways, ${id}`, message }));
  }
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
    if (v.slice(0, LIMITS.steps).some((id) => typeof id !== 'string' || !STEP.test(id))) problems.push({ where: `creation, ${key}`, message: 'Steps are who, stats, kits, money, stats: and a group\'s id, or list: and a list\'s id' });
  }
  if (list(c.off).includes('who')) problems.push({ where: 'creation, off', message: 'WHO THEY ARE is always asked: a character needs a name' });
  if (c.statsBy !== undefined && c.statsBy !== 'group') problems.push({ where: 'creation, statsBy', message: 'Must say group, or nothing for one way for all' });
  checkWays(definition, c.ways, problems);
};

module.exports = { LIMITS, CREATING_KEY, stepIdsOf, creationOf, checkCreation, stepsAsked, creationShown, creatingNow, creationAction, withUpload, lockedWhileCreating, placedFrom, stepWayProblems };
