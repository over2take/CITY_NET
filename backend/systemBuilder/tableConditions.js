// A built-in game's own conditions (4e2c1; approved mockup docs/mockups/builder-conditions.html,
// 2026-10-09, stage 3): the table adds conditions of its own to CWN, Cyberpunk RED, Shadowrun or
// Generic from the GAME tab, beside the standard set. Names, icons and descriptions only - no
// modifiers and no rounds - so a built-in game's rules don't change. A custom system's conditions
// are its own definition's, edited in the builder.
//
//   global_settings 'table_conditions:cities_without_number' =
//     '{"wired":{"name":"Wired","icon":"bolt","description":"Jacked in."}}'
//
// Kept in memory once loaded, as published systems are (runtime.js), so a token's conditions are
// checked without reading the database each time.

const { STANDARD, checkConditions } = require('./conditions');

const PREFIX = 'table_conditions:';
/** What a table's own condition may say: no modifiers or rounds, which would change the game's rules. */
const KEYS = new Set(['name', 'short', 'icon', 'description']);
const STANDARD_IDS = new Set(STANDARD.map((c) => c.id));

const own = new Map();
const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const parse = (text) => { try { const v = JSON.parse(text); return isPlainObject(v) ? v : {}; } catch { return {}; } };

/** Load every built-in game's own conditions. cb(err). */
const loadTableConditions = (db, cb = () => {}) => {
  db.all(`SELECT key, value FROM global_settings WHERE key LIKE ?`, [`${PREFIX}%`], (err, rows) => {
    if (err) { console.error('[conditions] Could not load the tables\' own conditions:', err.message); return cb(err); }
    own.clear();
    for (const r of rows) own.set(r.key.slice(PREFIX.length), parse(r.value));
    return cb(null);
  });
};

/** A built-in game's own conditions, as stored ({} for none). */
const tableConditionsOf = (system) => own.get(system) || {};

/**
 * Problems with a table's own conditions: the condition checks, and on top of them nothing a
 * standard condition is called, and nothing but a name, chip label, icon and description.
 */
const checkTableConditions = (entries) => {
  if (!isPlainObject(entries)) return [{ where: 'conditions', message: 'Must be a set of conditions' }];
  const problems = [];
  for (const [id, c] of Object.entries(entries)) {
    if (STANDARD_IDS.has(id)) { problems.push({ where: `condition ${id}`, message: 'A standard condition is already there' }); continue; }
    if (!isPlainObject(c)) continue;
    for (const key of Object.keys(c)) {
      if (!KEYS.has(key)) problems.push({ where: `condition ${id}, ${key}`, message: 'A built-in game\'s conditions have a name, label, icon and description only' });
    }
  }
  checkConditions(entries, new Set(), problems);
  return problems;
};

/** Store a built-in game's own conditions, replacing what it had. cb(err). */
const saveTableConditions = (db, system, entries, cb) => {
  db.run(`INSERT INTO global_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [`${PREFIX}${system}`, JSON.stringify(entries)], (err) => {
      if (err) return cb(err);
      own.set(system, entries);
      return cb(null);
    });
};

module.exports = { PREFIX, loadTableConditions, tableConditionsOf, checkTableConditions, saveTableConditions };
