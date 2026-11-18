/**
 * A player's own token, as their sheet's vitals strip needs it (8s3a): its id to change health through the same route
 * as the HEALTH window (PUT /api/locations/:id/health), and the health, conditions and injuries it carries.
 *
 * A player may have one on the city and one on a battle map. Their health, conditions and injuries are written to every
 * one of them alike (by owner, routes/locations.js), so any will do; the city's first, as the sheet's linked HP reads it
 * (overlayLinkedData). Null with none on the map: the strip then offers to make one, as HEALTH does.
 *
 * What it sends is what the map already sends about every token (GET /api/locations), nothing more: which conditions it
 * has, and how many rounds each has left only to the GM (`rounds`), as the map has them.
 */

const { publicTokenConditions } = require('../tokens/conditions');

// The armor class too, shown by the vitals box for quick reference (the user, 2026-11-17).
const TOKEN_FIELDS = ['id', 'name', 'shape', 'owner', 'hp_current', 'hp_max', 'hp_temp', 'conditions', 'injuries', 'melee_ac', 'ranged_ac'];

const ownToken = (db, username, { rounds = false } = {}, cb) => {
  db.get(
    `SELECT ${TOKEN_FIELDS.join(', ')} FROM locations WHERE shape = 'rhombus' AND owner = ?
     ORDER BY (battle_map_id IS NULL) DESC, id LIMIT 1`,
    [username],
    (err, row) => {
      if (err || !row) return cb(null);
      cb(rounds ? row : { ...row, conditions: publicTokenConditions(row.conditions) });
    },
  );
};

module.exports = { ownToken, TOKEN_FIELDS };
