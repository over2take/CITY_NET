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
// Pure: checks and reads only. definition.js runs the checks.

const { partOn } = require('./parts');
const { choicesOf, pickedOf } = require('./choices');

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);

/** How many ids `order` and `off` may hold: every list a system can have, and room. */
const LIMITS = { steps: 40 };
const KEYS = new Set(['on', 'order', 'off']);
const STEP = /^(?:who|stats|kits|money|list:[a-z][a-z0-9_]{0,63})$/;

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

module.exports = { LIMITS, stepIdsOf, creationOf, checkCreation };
