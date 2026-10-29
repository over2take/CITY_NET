// A feature's modifier on the token's maximum (7a5a3; decision 10 of the approved mockup
// docs/mockups/nested-choices.html, 2026-10-28): Tough's `hp_max + 2 * @level` moves the token's real
// maximum while the pick counts, and back when it doesn't, the current moving with it.
//
// Every other modifier is worked out and never written (choices.js overlayOf), but the token's
// maximum lives on the token, where damage, healing, rests and the health window read it, so the
// bonus is put there. The sheet keeps what it has added under TOKEN_MAX_KEY, with the token it went
// on: after any change to the sheet the bonus as it is now is compared with that, and the token moves
// by the difference. A new token (the GM made another) starts with nothing added. One write through
// the sheet queue (sheets/mutate.js) records it, so two saves close together never add it twice.
//
// Only for the game running, whose vitals are on the token (another system's wait in token_vitals),
// and only while it has token health on: off, the bonus stays as it was until the part is back.

const { overlayOf, tokenMaxFieldOf } = require('./choices');
const { partOn } = require('./parts');
const runtime = require('./runtime');
const { mutateSheetForUser } = require('../sheets/mutate');

/** Where a sheet keeps what it has added to its token's maximum: { token, amount }. */
const TOKEN_MAX_KEY = '_token_max';

const isPlainObject = (v) => !!v && typeof v === 'object' && !Array.isArray(v);

/** What the picks add to the token's maximum now: every modifier on that field, summed. 0 with none. */
const bonusOf = (definition, data) => {
  const field = tokenMaxFieldOf(definition);
  const from = field ? overlayOf(definition, data).from[field] : null;
  return Array.isArray(from) ? from.reduce((n, m) => n + m.amount, 0) : 0;
};

/** What a sheet has already added to `token`: nothing to any other token. */
const addedTo = (data, token) => {
  const kept = isPlainObject(data) ? data[TOKEN_MAX_KEY] : null;
  return isPlainObject(kept) && kept.token === token && Number.isFinite(kept.amount) ? kept.amount : 0;
};

/**
 * How far `token`'s maximum moves for a sheet: `{ by, data }`, the sheet to store recording it, or
 * null when it is where it should be.
 */
const moveFor = (definition, data, token) => {
  const want = bonusOf(definition, data);
  const by = want - addedTo(data, token);
  return by ? { by, data: { ...data, [TOKEN_MAX_KEY]: { token, amount: want } } } : null;
};

/** The player's token the bonus is kept against: the world map's, as the sheet reads its health. */
const TOKEN_SQL = `SELECT id FROM locations WHERE shape = 'rhombus' AND owner = ?
  ORDER BY (battle_map_id IS NULL) DESC, id LIMIT 1`;

/**
 * Bring a player's token maximum in step with their picks, in `system`, the game running. Every token
 * of theirs moves together, as their health always does; the current moves by as much, kept between 0
 * and the new maximum. cb(moved).
 */
const syncTokenMax = (db, system, username, cb = () => {}) => {
  const definition = runtime.definitionOf(system);
  if (!definition || !partOn(definition, 'token_health') || !tokenMaxFieldOf(definition)) return cb(false);
  return db.get(TOKEN_SQL, [username], (err, token) => {
    if (err || !token) return cb(false);
    let by = 0;
    return mutateSheetForUser(db, { username, system }, (data) => {
      const move = moveFor(definition, data, token.id);
      if (!move) return undefined;
      by = move.by;
      return move.data;
    }, (err2, stored) => {
      if (err2 || !stored || !by) return cb(false);
      // In SQLite every SET reads the row as it was, so the current is held under the new maximum.
      return db.run(`UPDATE locations SET hp_max = MAX(0, COALESCE(hp_max, 0) + ?),
        hp_current = MIN(MAX(0, COALESCE(hp_current, 0) + ?), MAX(0, COALESCE(hp_max, 0) + ?))
        WHERE shape = 'rhombus' AND owner = ?`, [by, by, by, username], (err3) => cb(!err3));
    });
  });
};

/**
 * Every player's, after a new version of `system` is published, when it is the game running. (A house
 * rule never changes the bonus: an amount reads the sheet as typed and the levels, never a formula.)
 * cb(moved), whether any token moved.
 */
const syncAllTokenMax = (db, system, cb = () => {}) => {
  db.get(`SELECT value FROM global_settings WHERE key = 'game_system'`, [], (err, row) => {
    if (err || !row || row.value !== system) return cb(false);
    return db.all('SELECT username FROM character_sheets WHERE system = ? AND is_npc = 0', [system], (err2, rows) => {
      if (err2 || !rows.length) return cb(false);
      let moved = false;
      const next = (i) => (i === rows.length ? cb(moved)
        : syncTokenMax(db, system, rows[i].username, (m) => { moved = moved || m; next(i + 1); }));
      return next(0);
    });
  });
};

module.exports = { TOKEN_MAX_KEY, bonusOf, addedTo, moveFor, syncTokenMax, syncAllTokenMax };
