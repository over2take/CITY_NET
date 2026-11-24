// Resistances (8b3a; approved mockup docs/mockups/damage-pipeline.html, answered 2026-11-23): what a character resists,
// is immune to or is vulnerable to, and where each comes from.
//
//   resistances: [{ kind: 'resist', type: 'poison' }, { kind: 'immune', type: 'all' }]
//
// One RESISTANCE row wherever a modifier lives: a feature's (a pick's, so also an item's, worn or installed, 7e3), and a
// condition's. Each is RESIST, IMMUNE or VULNERABLE to one of the game's damage types, or ALL of them. While the thing
// counts (the feature unlocked, the item working, the condition on the token) the character has it; when it stops
// counting, it is gone. Worked out, never written into the sheet, as modifiers are.
//
// Two for one type don't stack (the mockup, as most games say): IMMUNE beats either; RESIST and VULNERABLE together come
// to nothing. ALL counts for every type that is on.
//
// The GM's own, BY HAND (8b3c1; the user, 2026-11-23: "on the sheet and the health window"): rows kept on the character's
// sheet under HAND_KEY, a name no field can have, so players never write it; the same list wherever the GM changes it (the
// sheet, the token's HEALTH window), and tokens sharing one NPC sheet share it. A type switched off is kept in the row but counts for nothing until
// it is on again. What each kind does to a number (WORKS OUT AS) is 8b5's.
//
// Pure: the definition's checks and the running game read it.

const { KINDS, damageTypesOf, damageTypeIdsOf } = require('./damageTypes');

/** A row's type for every type the game has on. */
const ALL = 'all';
/** The most rows one feature or condition has. */
const LIMIT = 10;
const KEYS = new Set(['kind', 'type']);
/** Where a sheet keeps the GM's own resistances. */
const HAND_KEY = '_resistances';

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const list = (v) => (Array.isArray(v) ? v : []);

/** Problems with one feature's or condition's `resistances`, pushed onto `problems`, its types read from `definition`. */
const checkResistances = (value, where, definition, problems) => {
  if (value === undefined) return;
  if (!Array.isArray(value)) { problems.push({ where, message: 'Must be a list of resistances' }); return; }
  if (value.length > LIMIT) problems.push({ where, message: `At most ${LIMIT}` });
  const ids = damageTypeIdsOf(definition);
  const seen = new Set();
  value.slice(0, LIMIT).forEach((r, i) => {
    const at = `${where} ${i + 1}`;
    if (!isPlainObject(r)) { problems.push({ where: at, message: 'Must say RESIST, IMMUNE or VULNERABLE, and to what' }); return; }
    for (const key of Object.keys(r)) if (!KEYS.has(key)) problems.push({ where: `${at}, ${key}`, message: 'Not part of a resistance' });
    if (!KINDS.includes(r.kind)) problems.push({ where: `${at}, kind`, message: 'RESIST, IMMUNE or VULNERABLE' });
    if (r.type !== ALL && (typeof r.type !== 'string' || !ids.has(r.type))) problems.push({ where: `${at}, type`, message: 'Not one of this system\'s damage types, or all' });
    else if (seen.has(r.type)) problems.push({ where: `${at}, type`, message: r.type === ALL ? 'Already says ALL' : 'Already says that type' });
    seen.add(r.type);
  });
};

/** What is wrong with the GM's own rows for this system, in words, or null: as a feature's are checked. */
const handProblem = (definition, value) => {
  const problems = [];
  checkResistances(value, 'resistance', definition, problems);
  return problems.length ? `${problems[0].where}: ${problems[0].message}` : null;
};

/** The rows well formed enough to count, as written. */
const resistancesIn = (value) => list(value).slice(0, LIMIT)
  .filter((r) => isPlainObject(r) && KINDS.includes(r.kind) && typeof r.type === 'string')
  .map((r) => ({ kind: r.kind, type: r.type }));

/** Of the kinds one type is given, what counts: IMMUNE beats either; RESIST and VULNERABLE together come to nothing. */
const kindOf = (kinds) => {
  if (kinds.includes('immune')) return 'immune';
  if (kinds.includes('resist') && kinds.includes('vulnerable')) return null;
  return kinds.includes('resist') ? 'resist' : kinds.includes('vulnerable') ? 'vulnerable' : null;
};

/**
 * What `sources` ([{ kind, type, from }], each where it comes from by name) come to, by each type that is on:
 * `{ fire: { kind, from: [{ kind, from, all? }] } }`, `kind` null where they cancel. A type nothing names is left out.
 */
const resistancesWorked = (definition, sources) => {
  const out = {};
  for (const t of damageTypesOf(definition)) {
    const here = sources.filter((s) => s.type === t.id || s.type === ALL);
    if (!here.length) continue;
    out[t.id] = { kind: kindOf(here.map((s) => s.kind)), from: here.map((s) => ({ kind: s.kind, from: s.from, ...(s.type === ALL ? { all: true } : {}), ...(s.hand ? { hand: true } : {}) })) };
  }
  return out;
};

module.exports = { ALL, LIMIT, HAND_KEY, handProblem, checkResistances, resistancesIn, kindOf, resistancesWorked };
