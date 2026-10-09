// The one-time move of BLIND and BLEED from the injury map into conditions (4e2b1; decided with the
// user 2026-10-09, approved mockup docs/mockups/builder-conditions.html).
//
// The injury map used to carry two flags beside the body, `blind` and `bleeding`, in a token's
// `injuries`. They are now the Blinded and Bleeding conditions (systemBuilder/conditions.js), so a
// token that had a flag gets the condition instead and keeps everything else. Both on the token
// itself (the running game's) and in every game's saved values (`token_vitals`), so switching
// games later still shows what it showed. A condition already there isn't added twice.
//
// Nothing is lost: each flag is written as a condition in the same transaction that takes it out,
// so no database copy is needed. A marker so it runs once.

const { SHAPES_SQL } = require('../tokens/vitals');
const { parseTokenConditions } = require('../tokens/conditions');

const MARKER = 'migration_injury_conditions';
/** Each old flag, and the condition it becomes. */
const MOVES = [['blind', 'blinded'], ['bleeding', 'bleeding']];

const q = (db, method, sql, params = []) => new Promise((resolve, reject) => {
  db[method](sql, params, function (err, rows) { if (err) reject(err); else resolve(method === 'run' ? this : rows); });
});

const parseInjuries = (text) => {
  try {
    const v = JSON.parse(text || '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? v : {};
  } catch { return {}; }
};

/**
 * One row's injuries and conditions with the flags moved: null when it has neither flag (the key
 * present but false is still taken out, so the map never shows a stale one).
 */
const moved = (injuriesText, conditionsText) => {
  const injuries = parseInjuries(injuriesText);
  if (!MOVES.some(([flag]) => Object.prototype.hasOwnProperty.call(injuries, flag))) return null;
  const conditions = parseTokenConditions(conditionsText);
  for (const [flag, id] of MOVES) {
    if (injuries[flag] === true && !conditions.some((c) => c.id === id)) conditions.push({ id });
    delete injuries[flag];
  }
  return { injuries: JSON.stringify(injuries), conditions: JSON.stringify(conditions) };
};

const moveInjuryConditions = async (db, { log = console } = {}) => {
  if (await q(db, 'get', 'SELECT value FROM global_settings WHERE key = ?', [MARKER])) return { ran: false };
  const tokens = await q(db, 'all', `SELECT id, injuries, conditions FROM locations WHERE shape IN (${SHAPES_SQL})`);
  const saved = await q(db, 'all', 'SELECT location_id, system, injuries, conditions FROM token_vitals');
  let changed = 0;
  await q(db, 'run', 'BEGIN IMMEDIATE');
  try {
    for (const t of tokens) {
      const next = moved(t.injuries, t.conditions);
      if (!next) continue;
      await q(db, 'run', 'UPDATE locations SET injuries = ?, conditions = ? WHERE id = ?', [next.injuries, next.conditions, t.id]);
      changed += 1;
    }
    for (const s of saved) {
      const next = moved(s.injuries, s.conditions);
      if (!next) continue;
      await q(db, 'run', 'UPDATE token_vitals SET injuries = ?, conditions = ? WHERE location_id = ? AND system = ?',
        [next.injuries, next.conditions, s.location_id, s.system]);
      changed += 1;
    }
    await q(db, 'run', 'INSERT OR REPLACE INTO global_settings (key, value) VALUES (?, ?)', [MARKER, new Date().toISOString()]);
    await q(db, 'run', 'COMMIT');
  } catch (err) {
    await q(db, 'run', 'ROLLBACK').catch(() => {});
    throw err;
  }
  if (changed) log.log(`[tokens] Moved BLIND and BLEED into conditions on ${changed} token record(s).`);
  return { ran: true, changed };
};

module.exports = { moveInjuryConditions, moved, MARKER };
