// A system's rests (4f1; approved mockup docs/mockups/builder-rests.html, 2026-10-09): the moments
// the game refills things and wears things off, which the GM calls from the GAME tab.
//
//   rests: {
//     short_rest: { refills: [{ what: 'health', how: 'by', amount: '1d8 + @con_mod' }] },
//     long_rest:  { counts_as: ['short_rest'],
//                   refills: [{ what: 'health', how: 'full' },
//                             { what: 'fatigue', how: 'by', amount: '-1' },
//                             { what: 'section:magic', how: 'max' }] },
//     end_of_scene: { on: false },                                  // a standard one, turned off
//     downtime: { name: 'Downtime', counts_as: ['long_rest'], refills: [] }, // one of the system's own
//   }
//
// Every system starts with the four standard rests, on and refilling nothing; a definition stores
// only what it changes, as conditions do. Decided with the user the same day:
// - a refill is health (to full; or up by an amount where the health model heals by amounts, and
//   a two-track system may say which track), a number on the character sheet (to its maximum
//   when it has one, up or down by an amount, or set to one), or a whole sheet section, every
//   number in it to its maximum (spell slots by level in one row);
// - an amount is a number, a formula or dice, naming the character's own numbers (tierRolls.js);
// - a rest that counts as another does that one's refills first, then its own; never itself;
// - conditions end at a rest (conditions.js `ends: 'rest', at: [...]`);
// - a rest turned off is neither called nor counted; nothing it holds is deleted.
// Uses on one spell or ability come with Phase 7's features, which name the rest by its id.
//
// Pure: the definition checks, the builder and the running game read it.

const { boxProblem } = require('./tierRolls');
const { effectiveSheet, fieldsOf } = require('./sheet');
const { healthLayout } = require('./core');
const { partOn } = require('./parts');
const { statIdsOf } = require('./stats');

const NAME = /^[a-z][a-z0-9_]{0,39}$/;
const LIMITS = { rests: 12, name: 30, refills: 20, amount: 200 };

/** The standard rests every system starts with, in this order. */
const STANDARD = [
  { id: 'short_rest', name: 'Short rest' },
  { id: 'long_rest', name: 'Long rest' },
  { id: 'end_of_scene', name: 'End of scene' },
  { id: 'end_of_session', name: 'End of session' },
];
const STANDARD_IDS = new Set(STANDARD.map((r) => r.id));

const STANDARD_KEYS = new Set(['on', 'name', 'counts_as', 'refills']);
const OWN_KEYS = new Set(['name', 'counts_as', 'refills']);
const REFILL_KEYS = new Set(['what', 'how', 'amount', 'track']);

/** What a refill of `what` may do. */
const HOWS = { health: ['full', 'by'], field: ['max', 'by', 'to'], section: ['max'] };
/** The health models whose HEAL takes an amount; harm levels heal a slot, and none has no health. */
const HEALS_BY_AMOUNT = new Set(['pool', 'tracks', 'typed', 'wounds', 'locations']);
const SECTION = 'section:';

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const has = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);

/**
 * What a system's rests can reach: its health model, the sheet numbers a rest may refill (by id,
 * each with its maximum's id or null), its sections that hold any with a maximum, and the names
 * an amount may use.
 */
const reachOf = (definition) => {
  const def = isPlainObject(definition) ? definition : {};
  // No answer is one pool, as the starter sheet draws it (core.js healthLayout); token health off is none.
  const health = !partOn(def, 'token_health') ? null
    : isPlainObject(def.core) && isPlainObject(def.core.health) ? def.core.health : { model: 'pool' };
  const derived = new Set(Array.isArray(def.derived) ? def.derived.filter((d) => d && typeof d.id === 'string').map((d) => d.id) : []);
  const healthFields = new Set(healthLayout(health || { model: 'none' }, 'HP').sections.flatMap((s) => s.fields.map((f) => f.id)));
  const sheet = effectiveSheet(def);
  const all = fieldsOf(sheet).filter((f) => f && typeof f.id === 'string');
  // Worked out by a formula, linked to the token or bank, or part of the health layout: a rest
  // refills those through HEALTH, or through what they are worked out from.
  const refillable = (f) => f.type === 'number' && !f.source && !derived.has(f.id) && !healthFields.has(f.id);
  const numbers = new Map(all.filter(refillable).map((f) => [f.id, typeof f.maxField === 'string' ? f.maxField : null]));
  const sections = new Map((Array.isArray(sheet.sections) ? sheet.sections : [])
    .filter((s) => s && typeof s.id === 'string' && Array.isArray(s.fields))
    .map((s) => [s.id, s.fields.filter((f) => f && numbers.get(f.id)).map((f) => f.id)])
    .filter(([, ids]) => ids.length));
  const names = new Set([...all.map((f) => f.id), ...statIdsOf(def), ...derived]);
  return { health, numbers, sections, names };
};

/** What an amount may name: the character's own numbers. */
const amountNames = (names) => ({
  known: (name) => names.has(name),
  refused: (name) => `@${name} isn't a stat, formula or sheet field of this system`,
});

const checkRefill = (r, where, reach, problems) => {
  if (!isPlainObject(r)) { problems.push({ where, message: 'Must say what it refills and how' }); return; }
  for (const key of Object.keys(r)) if (!REFILL_KEYS.has(key)) problems.push({ where: `${where}, ${key}`, message: 'Not part of a refill' });
  let kind;
  if (r.what === 'health') {
    if (!reach.health || reach.health.model === 'none') { problems.push({ where: `${where}, what`, message: 'This system has no health to refill' }); return; }
    kind = 'health';
  } else if (typeof r.what === 'string' && r.what.startsWith(SECTION)) {
    if (!reach.sections.has(r.what.slice(SECTION.length))) { problems.push({ where: `${where}, what`, message: 'Not a section of the character sheet with numbers that have a maximum' }); return; }
    kind = 'section';
  } else if (typeof r.what === 'string' && reach.numbers.has(r.what)) {
    kind = 'field';
  } else {
    problems.push({ where: `${where}, what`, message: 'Health, a number on the character sheet, or a section of it' });
    return;
  }
  if (!HOWS[kind].includes(r.how)) {
    problems.push({ where: `${where}, how`, message: { health: 'To full, or up by an amount', field: 'To its maximum, up or down by an amount, or set to an amount', section: 'Every number in it to its maximum' }[kind] });
    return;
  }
  if (kind === 'field' && r.how === 'max' && !reach.numbers.get(r.what)) problems.push({ where: `${where}, how`, message: 'This number has no maximum' });
  if (kind === 'health' && r.how === 'by' && !HEALS_BY_AMOUNT.has(reach.health.model)) problems.push({ where: `${where}, how`, message: 'This health model heals one harm at a time; refill it to full' });
  if (r.track !== undefined) {
    const tracks = reach.health && reach.health.model === 'tracks' && Array.isArray(reach.health.tracks) ? reach.health.tracks.filter(isPlainObject).map((t) => t.id) : [];
    if (kind !== 'health' || r.how !== 'by' || !tracks.length) problems.push({ where: `${where}, track`, message: 'Only health up by an amount, in a system with two tracks, names a track' });
    else if (!tracks.includes(r.track)) problems.push({ where: `${where}, track`, message: 'Not one of this system\'s tracks' });
  }
  const needsAmount = r.how === 'by' || r.how === 'to';
  if (!needsAmount) {
    if (r.amount !== undefined) problems.push({ where: `${where}, amount`, message: 'Only up or down by, or set to, has an amount' });
    return;
  }
  if (r.amount === undefined || (typeof r.amount === 'string' && !r.amount.trim())) { problems.push({ where: `${where}, amount`, message: 'Required' }); return; }
  if (typeof r.amount === 'string' && r.amount.length > LIMITS.amount) { problems.push({ where: `${where}, amount`, message: `Longer than ${LIMITS.amount} characters` }); return; }
  const problem = boxProblem(r.amount, amountNames(reach.names));
  if (problem) problems.push({ where: `${where}, amount`, message: problem });
};

/** Every rest id `id` counts as through `edges`, or the rest it loops back through. */
const loopFrom = (id, edges) => {
  const seen = new Set();
  const walk = (at) => {
    for (const next of edges.get(at) || []) {
      if (next === id) return at;
      if (seen.has(next)) continue;
      seen.add(next);
      const found = walk(next);
      if (found) return found;
    }
    return null;
  };
  return walk(id);
};

/** Problems with a definition's `rests`, pushed onto `problems`. */
const checkRests = (definition, problems) => {
  const rests = definition && definition.rests;
  if (rests === undefined) return;
  if (!isPlainObject(rests)) { problems.push({ where: 'rests', message: 'Must be a set of rests' }); return; }
  const own = Object.keys(rests).filter((id) => !STANDARD_IDS.has(id));
  if (STANDARD.length + own.length > LIMITS.rests) problems.push({ where: 'rests', message: `At most ${LIMITS.rests} rests, the ${STANDARD.length} standard ones included` });
  const known = new Set([...STANDARD_IDS, ...own.filter((id) => NAME.test(id) && isPlainObject(rests[id]))]);
  const reach = reachOf(definition);
  const edges = new Map();
  for (const [id, r] of Object.entries(rests)) {
    const where = `rest ${id}`;
    const standard = STANDARD_IDS.has(id);
    if (!NAME.test(id)) { problems.push({ where, message: 'Ids use lowercase letters, digits and _, starting with a letter' }); continue; }
    if (!isPlainObject(r)) { problems.push({ where, message: 'Must be a rest' }); continue; }
    for (const key of Object.keys(r)) {
      if ((standard ? STANDARD_KEYS : OWN_KEYS).has(key)) continue;
      problems.push({ where: `${where}, ${key}`, message: key === 'on' ? 'Only a standard rest is turned off; delete one of the system\'s own instead' : 'Not part of a rest' });
    }
    if (has(r, 'on') && typeof r.on !== 'boolean') problems.push({ where: `${where}, on`, message: 'Must say on: true or on: false' });
    if (r.name !== undefined || !standard) {
      if (typeof r.name !== 'string' || (!standard && !r.name.trim())) problems.push({ where: `${where}, name`, message: standard ? 'Must be text' : 'Cannot be blank' });
      else if (r.name.length > LIMITS.name) problems.push({ where: `${where}, name`, message: `Longer than ${LIMITS.name} characters` });
    }
    if (r.counts_as !== undefined) {
      if (!Array.isArray(r.counts_as)) problems.push({ where: `${where}, counts_as`, message: 'Must be a list of rests' });
      else {
        r.counts_as.forEach((other, i) => {
          if (other === id) problems.push({ where: `${where}, counts_as ${i + 1}`, message: 'A rest can\'t count as itself' });
          else if (!known.has(other)) problems.push({ where: `${where}, counts_as ${i + 1}`, message: 'Not one of this system\'s rests' });
        });
        edges.set(id, r.counts_as.filter((other) => other !== id && known.has(other)));
      }
    }
    if (r.refills !== undefined) {
      if (!Array.isArray(r.refills)) problems.push({ where: `${where}, refills`, message: 'Must be a list of refills' });
      else {
        if (r.refills.length > LIMITS.refills) problems.push({ where: `${where}, refills`, message: `At most ${LIMITS.refills} refills` });
        r.refills.slice(0, LIMITS.refills).forEach((refill, i) => checkRefill(refill, `${where}, refill ${i + 1}`, reach, problems));
      }
    }
  }
  for (const id of edges.keys()) {
    const through = loopFrom(id, edges);
    if (through) problems.push({ where: `rest ${id}, counts_as`, message: `Counts as itself through ${through}` });
  }
};

/** The ids of every rest a system has, on or off: what a condition's `at` may name. */
const restIdsOf = (definition) => {
  const stored = definition && isPlainObject(definition.rests) ? definition.rests : {};
  return new Set([...STANDARD_IDS, ...Object.keys(stored).filter((id) => NAME.test(id) && isPlainObject(stored[id]) && !STANDARD_IDS.has(id))]);
};

/**
 * The rests a system offers, each whole: the standard ones with the system's edits (those turned
 * off left out), then its own in the order written. `counts_as` keeps only rests that are on.
 * What the running game and the builder read; the stored definition keeps only the changes.
 */
const restsOf = (definition) => {
  const stored = definition && isPlainObject(definition.rests) ? definition.rests : {};
  const whole = (base, r, standard) => ({
    id: base.id,
    name: typeof r.name === 'string' && r.name.trim() ? r.name.trim() : base.name,
    counts_as: Array.isArray(r.counts_as) ? r.counts_as.filter((c) => typeof c === 'string') : [],
    refills: Array.isArray(r.refills) ? r.refills.filter(isPlainObject).map((x) => ({ ...x })) : [],
    standard,
  });
  const out = [];
  for (const base of STANDARD) {
    const r = isPlainObject(stored[base.id]) ? stored[base.id] : {};
    if (r.on !== false) out.push(whole(base, r, true));
  }
  for (const [id, r] of Object.entries(stored)) {
    if (STANDARD_IDS.has(id) || !NAME.test(id) || !isPlainObject(r) || typeof r.name !== 'string' || !r.name.trim()) continue;
    out.push(whole({ id, name: r.name.trim() }, r, false));
  }
  const on = new Set(out.map((r) => r.id));
  return out.slice(0, LIMITS.rests).map((r) => ({ ...r, counts_as: r.counts_as.filter((c) => on.has(c) && c !== r.id) }));
};

module.exports = { STANDARD, LIMITS, HOWS, SECTION, checkRests, restsOf, restIdsOf, reachOf, amountNames };
