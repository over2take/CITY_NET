// Tokens riding in vehicles.
//
// The `vehicle_occupants` table, shared by the two paths that use it: the GM seating their
// own tokens in enemy vehicles, and a player inviting a friendly NPC into theirs. Both are
// the same operation against the same table with a different allowlist of token shapes, so
// they are one implementation with the allowlist passed in rather than two that drift.
//
// Player occupancy is *not* here — a player riding in a car is recorded on their own sheet,
// because that is where it has always lived and moving it would rewrite working seating for
// the whole table. So a seat can be claimed two ways, and `evictSeat` is what keeps the rule
// "one seat, one occupant" true across both.

/** Tokens a player may invite: their own side only, never a hostile. */
const FRIENDLY_SHAPES = ['friendly_rhombus'];

/** Tokens the GM may seat: anything of theirs. */
const GM_SHAPES = ['enemy_rhombus', 'friendly_rhombus'];

/**
 * A token belongs to the city map when `battle_map_id` is null, and to a battle map floor
 * otherwise. `IS ?` rather than `= ?`, because `= NULL` matches nothing in SQL and the city
 * map is exactly the null case.
 */
const levelClause = (level) => ({
  clause: `battle_map_id IS ? AND COALESCE(floor_index, 0) = COALESCE(?, 0)`,
  params: [
    level?.battleMapId == null ? null : Number(level.battleMapId),
    level?.floorIndex == null ? null : Number(level.floorIndex),
  ],
});

/** The tokens of these shapes on this map level, as seat candidates. */
function candidates(db, shapes, level, cb) {
  const { clause, params } = levelClause(level);
  db.all(
    `SELECT id, name, shape, hp_current, hp_max FROM locations
      WHERE shape IN (${shapes.map(() => '?').join(', ')}) AND ${clause}
      ORDER BY name, id`,
    [...shapes, ...params],
    (err, rows) => cb(err || !rows ? [] : rows.map(r => ({
      locationId: r.id,
      name: String(r.name || '').trim() || `TOKEN ${r.id}`,
      shape: r.shape,
      hp: r.hp_current,
      hpMax: r.hp_max,
    }))),
  );
}

/**
 * Every seated token, as `sheetId:vehicleIndex -> { seat: { locationId, name } }`.
 *
 * Read whole rather than per vehicle: a roster is already walking every vehicle, and one
 * query beats one per car.
 */
function aboardMap(db, cb) {
  db.all(
    `SELECT o.location_id, o.sheet_id, o.vehicle_index, o.seat, l.name, l.shape
       FROM vehicle_occupants o JOIN locations l ON l.id = o.location_id`,
    [],
    (err, rows) => {
      const out = new Map();
      for (const r of err ? [] : rows || []) {
        const key = `${r.sheet_id}:${r.vehicle_index}`;
        if (!out.has(key)) out.set(key, {});
        out.get(key)[r.seat] = {
          locationId: r.location_id,
          name: String(r.name || '').trim() || `TOKEN ${r.location_id}`,
          shape: r.shape,
        };
      }
      cb(out);
    },
  );
}

/** Empty a seat of any token in it. The player half of the rule is the caller's business. */
const evictSeat = (db, sheetId, vehicleIndex, seat, cb) =>
  db.run(
    `DELETE FROM vehicle_occupants WHERE sheet_id = ? AND vehicle_index = ? AND seat = ?`,
    [Number(sheetId), Number(vehicleIndex), String(seat)],
    () => cb(),
  );

/**
 * Put a token in a seat.
 *
 * `shapes` is the allowlist: a player may invite a friendly, the GM may seat either. A token
 * outside it is refused rather than merely absent from the picker, because a picker is a
 * suggestion and this is the rule.
 *
 * Moving a token from one seat to another is one call: it leaves whatever it was in first,
 * which the UNIQUE on `location_id` would force anyway.
 */
function seat(db, { locationId, sheetId, vehicleIndex, seat: seatId, shapes = GM_SHAPES }, cb) {
  const loc = Number(locationId);
  const index = Number(vehicleIndex);
  const id = String(seatId || '').trim().toLowerCase();
  db.get(
    `SELECT id FROM locations WHERE id = ? AND shape IN (${shapes.map(() => '?').join(', ')})`,
    [loc, ...shapes],
    (err, row) => {
      if (err || !row) return cb('NOT_INVITABLE');
      db.run(`DELETE FROM vehicle_occupants WHERE location_id = ?`, [loc], () =>
        evictSeat(db, sheetId, index, id, () =>
          db.run(
            `INSERT INTO vehicle_occupants (location_id, sheet_id, vehicle_index, seat) VALUES (?, ?, ?, ?)`,
            [loc, Number(sheetId), index, id],
            () => cb(null),
          )));
    },
  );
}

/** Take a token out of whatever it is in. Idempotent — no seat is not an error. */
const unseat = (db, locationId, cb) =>
  db.run(`DELETE FROM vehicle_occupants WHERE location_id = ?`, [Number(locationId)], () => cb(null));

module.exports = {
  FRIENDLY_SHAPES, GM_SHAPES, levelClause, candidates, aboardMap, evictSeat, seat, unseat,
};
