// Single source of truth for player display names and descriptions: the
// character sheet. The sheet's name field ("handle" under CP:R, "name"
// elsewhere) and description are mirrored onto the player's rhombus
// token(s) so the 3D label, info window, and spectator view all agree,
// and an in-memory cache serves display names for dice-roll broadcasts.

// Per-system override of which sheet field is the character's name.
// IMPORTANT: must stay in sync with each frontend template's
// `header.nameField` (frontend/src/sheets/templates/*.ts). Every current
// system uses 'name' (CP:R's field is *labelled* Handle but stored as
// 'name') — only list systems that store something else. A missing entry
// makes tokens/rolls silently fall back to the login username.
const vehicleState = require('./vehicleState');

const NAME_FIELDS = {};
const nameField = (system) => NAME_FIELDS[system] || 'name';

// username -> sheet display name (login username when no sheet/name)
const cache = new Map();

/** Display name for roll broadcasts etc. Falls back to the login username. */
function displayName(username) {
  return cache.get(username) || username;
}

/** Reload the cached display name for one player from their active-system sheet. */
function refresh(db, system, username, cb) {
  db.get(
    `SELECT data FROM character_sheets WHERE username = ? AND system = ? AND is_npc = 0`,
    [username, system],
    (err, row) => {
      if (!err && row) {
        try {
          const data = JSON.parse(row.data || '{}');
          const n = String(data[nameField(system)] ?? '').trim();
          cache.set(username, n || username);
        } catch { /* keep previous cache entry */ }
      }
      if (cb) cb();
    }
  );
}

/** Mirror sheet name + description onto the player's rhombus token(s).
 *  cb(changed) — changed is true when at least one token row was updated. */
function syncToken(db, system, username, cb) {
  db.get(
    `SELECT data FROM character_sheets WHERE username = ? AND system = ? AND is_npc = 0`,
    [username, system],
    (err, row) => {
      if (err || !row) return cb && cb(false);
      let data;
      try { data = JSON.parse(row.data || '{}'); } catch { return cb && cb(false); }
      const name = String(data[nameField(system)] ?? '').trim();
      cache.set(username, name || username);
      const description = String(data.description ?? '').trim();
      db.run(
        `UPDATE locations SET name = ?, description = ? WHERE shape = 'rhombus' AND owner = ?`,
        [name || null, description || null, username],
        function (err2) {
          const changed = !err2 && this && this.changes > 0;
          // Vehicle occupancy rides along on the same mirror: it is another sheet value
          // other players need to see on the token, and hanging it here means every
          // caller that saves a sheet already refreshes it.
          if (system !== vehicleState.SYSTEM) return cb && cb(changed);
          vehicleState.syncAll(db, () => cb && cb(changed));
        }
      );
    }
  );
}

module.exports = { nameField, displayName, refresh, syncToken };
