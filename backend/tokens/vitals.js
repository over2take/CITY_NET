// A token's health, defense and injuries, kept per game system.
//
// A character's state belongs to the game it is in (decided with the user, 2026-09-29), but a
// token lives on the map, which every system shares. So the token's own columns on `locations`
// hold the RUNNING system's values - every reader and writer in the app (combat, the health
// monitor, damage, the sheet's linked HP and AC) keeps working on them unchanged - and the
// other systems' values wait in `token_vitals`, one row per token per system.
//
// Switching systems swaps them: each token's live values are put away under the system being
// left, and the incoming system's are brought back, or blanks where that system has never seen
// the token. One transaction, so a switch happens entirely or not at all.

const FIELDS = ['hp_current', 'hp_max', 'hp_temp', 'melee_ac', 'ranged_ac', 'injuries'];
const TOKEN_SHAPES = ['rhombus', 'enemy_rhombus', 'friendly_rhombus'];
const SHAPES_SQL = TOKEN_SHAPES.map((s) => `'${s}'`).join(', ');

let ready = Promise.resolve();

/**
 * Hold switches until the one-time start (startup/tokenVitals.js) has finished. Set once by
 * db.js; a failure is handled here too, so it can never surface as an unhandled rejection.
 */
const setReady = (promise) => {
  ready = Promise.resolve(promise);
  ready.catch(() => {});
};

const q = (db, method, sql, params = []) => new Promise((resolve, reject) => {
  db[method](sql, params, function (err, rows) { if (err) reject(err); else resolve(method === 'run' ? this : rows); });
});

/**
 * Change the running system to `to`, carrying every token's health with it: the live values
 * are put away under the system being left, and `to`'s are brought back (blanks where `to`
 * has never seen the token).
 *
 * The swap and the `game_system` setting change in ONE transaction, and the system being left
 * is read inside it. Were they separate, a failure between them would leave tokens showing one
 * system's health while the game runs another, and two quick switches could interleave.
 * Resolves to `{ from, to, switched, tokens }`.
 */
const switchSystem = async (db, to, { defaultSystem = 'generic' } = {}) => {
  await ready;
  await q(db, 'run', 'BEGIN IMMEDIATE');
  try {
    const row = await q(db, 'get', `SELECT value FROM global_settings WHERE key = 'game_system'`);
    const from = row && row.value ? row.value : defaultSystem;
    let tokens = 0;
    if (from !== to) {
      await q(db, 'run',
        `INSERT OR REPLACE INTO token_vitals (location_id, system, ${FIELDS.join(', ')})
         SELECT id, ?, ${FIELDS.join(', ')} FROM locations WHERE shape IN (${SHAPES_SQL})`,
        [from]);
      // A subselect that finds no row gives NULL: a blank, which is what a system that has
      // never seen this token should show. Injuries fall back to none rather than NULL.
      const sets = FIELDS.map((col) => (col === 'injuries'
        ? `injuries = COALESCE((SELECT injuries FROM token_vitals v WHERE v.location_id = locations.id AND v.system = ?), '{}')`
        : `${col} = (SELECT ${col} FROM token_vitals v WHERE v.location_id = locations.id AND v.system = ?)`));
      const res = await q(db, 'run',
        `UPDATE locations SET ${sets.join(', ')} WHERE shape IN (${SHAPES_SQL})`,
        FIELDS.map(() => to));
      tokens = res.changes;
    }
    await q(db, 'run',
      `INSERT INTO global_settings (key, value) VALUES ('game_system', ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [to]);
    await q(db, 'run', 'COMMIT');
    return { from, to, switched: from !== to, tokens };
  } catch (err) {
    await q(db, 'run', 'ROLLBACK').catch(() => {});
    throw err;
  }
};

/**
 * After a map is cleared or loaded: keep saved values for player tokens only.
 *
 * Both keep the players' tokens and replace everything else, and both wind the id sequence
 * back, so a new enemy can get the id a cleared one had. It must not inherit that token's
 * health from another system. Not run when a token is simply deleted: undo brings it back
 * under the same id, and its saved values should come back with it.
 */
const pruneAfterMapChange = (db, cb = () => {}) => {
  db.run(
    `DELETE FROM token_vitals WHERE location_id NOT IN (SELECT id FROM locations WHERE shape = 'rhombus')`,
    [],
    (err) => {
      if (err) console.error('[tokens] Could not tidy saved token health:', err.message);
      cb(err || null);
    },
  );
};

/** Resolves once the one-time start has finished (never rejects). For startup code and tests. */
const whenReady = () => ready.then(() => undefined, () => undefined);

module.exports = { FIELDS, TOKEN_SHAPES, SHAPES_SQL, setReady, whenReady, switchSystem, pruneAfterMapChange };
