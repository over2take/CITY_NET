// The GM's enemy vehicles.
//
// A deliberately separate path from the player one, and the reason is the key: everything in
// `vehicleState` is keyed by **username** — a rider names the owner's login, occupancy is
// written onto that player's own sheet, the roster returns players to fill the dropdowns.
// NPC sheets have no username. They are `character_sheets` rows with `is_npc = 1`, labelled
// rather than named, and linked to tokens through `npc_sheet_links`.
//
// Generalising the occupant key from a login to "a login or an NPC sheet id" is the correct
// fix and the wrong size: it would touch seatIn, seatOut, the roster, the token mirror and
// every test around them, to change how the table's own seating works mid-campaign. So this
// is a sibling keyed by sheet id, and the player path is left alone.
//
// **Nothing here needed storing.** NPC sheets already render the whole template, vehicle
// section included, and already live in folders — so an enemy vehicle typed on an NPC sheet
// has persisted from session to session since before this file existed. What was missing was
// only a read: every roster query filters `is_npc = 0`.
//
// GM-only, which removes three problems the player window has to solve. No permission model
// (the player one's asymmetry — anyone can seat you, only you get out — exists because
// players share it). No question about what players may see, since enemy pools and armour
// stay behind the admin gate. And no name resolution, because NPCs have labels.

const attackCwn = require('./attackCwn');
const vehicleSeats = require('./vehicleSeats');
const vehicleTokens = require('./vehicleTokens');

const SYSTEM = 'cities_without_number';

/**
 * The GM's own tokens. Players are not on this list: they seat themselves in their own
 * window, and offering them here would give the GM a second, conflicting way to move
 * somebody who can already move themselves.
 */
const GM_TOKEN_SHAPES = vehicleTokens.GM_SHAPES;

/** An NPC sheet's display name: its label, or something rather than nothing. */
const labelOf = (row) => String(row.npc_label || '').trim() || `NPC ${row.id}`;

const parse = (raw) => {
  try { return JSON.parse(raw || '{}'); } catch (e) { return {}; }
};

/**
 * Every enemy vehicle in the active system, keyed by the sheet that owns it.
 *
 * Grouped by the NPC's folder, because a GM with three sessions' worth of antagonists is
 * looking for "the gang's van", not scrolling one flat list.
 *
 * `level` is the map the GM is looking at — `{ battleMapId, floorIndex }`. The vehicles
 * themselves have no position, since they live on sheets; the *tokens* offered for its seats
 * are filtered to that level, because a GM running a rooftop fight should not be scrolling
 * past every ganger in the city to find the two in front of them.
 */
function roster(db, level, cb, system = SYSTEM) {
  db.all(
    `SELECT id, npc_label, folder, data FROM character_sheets
      WHERE system = ? AND is_npc = 1
      ORDER BY COALESCE(folder, ''), COALESCE(npc_label, ''), id`,
    [system],
    (err, rows) => {
      if (err || !rows) return cb({ vehicles: [], crew: [] });

      const vehicles = [];
      for (const row of rows) {
        const data = parse(row.data);
        for (let i = 1; i <= attackCwn.VEHICLE_ROWS; i++) {
          const vehicle = attackCwn.getVehicle(data, i);
          if (!vehicle) continue;
          vehicles.push({
            sheetId: row.id,
            owner: labelOf(row),
            folder: String(row.folder || '').trim() || null,
            index: i,
            name: vehicle.name,
            type: String(data[`vehicle${i}_type`] || ''),
            ac: vehicle.ac,
            armorRating: vehicle.armorRating,
            hp: vehicle.hp,
            hpMax: vehicle.hpMax,
            moving: vehicle.moving,
            destroyed: vehicle.destroyed,
            crew: vehicleSeats.crewOf(data, i),
            seats: vehicleSeats.seatsFor(data, i),
          });
        }
      }
      // Who the GM can put in a seat, and who is already in one. Both are token reads, so
      // they happen together rather than leaving the window to reconcile two shapes.
      vehicleTokens.candidates(db, GM_TOKEN_SHAPES, level, (tokens) => {
        vehicleTokens.aboardMap(db, (aboard) => {
          cb({
            vehicles: vehicles.map(v => ({
              ...v,
              occupants: aboard.get(`${v.sheetId}:${v.index}`) || {},
            })),
            // Every token on this map level, whether it has a character sheet or not.
            tokens,
          });
        });
      });
    }
  );
}

/** Read one NPC sheet by id, in the given system. cb(null) when there is none. */
function loadSheet(db, sheetId, cb, system = SYSTEM) {
  db.get(
    `SELECT id, npc_label, data FROM character_sheets WHERE id = ? AND system = ? AND is_npc = 1`,
    [Number(sheetId), system],
    (err, row) => cb(err || !row ? null : { id: row.id, label: labelOf(row), data: parse(row.data) }),
  );
}

const writeSheet = (db, id, data, cb) =>
  db.run(`UPDATE character_sheets SET data = ? WHERE id = ?`, [JSON.stringify(data), id], () => cb());

/**
 * Damage or repair an enemy hull.
 *
 * Same clamp as the player path, and for the same reason: `destroyed` is derived from the
 * pool rather than stored, so a write past either end would invent a state the rules have no
 * name for. Landing where it already was is not an error — it writes nothing.
 */
function adjustHp(db, { sheetId, vehicleIndex, delta, system = SYSTEM }, cb) {
  const index = Number(vehicleIndex);
  const amount = Math.trunc(Number(delta));
  if (!Number.isFinite(amount) || amount === 0) return cb('NO_CHANGE');
  loadSheet(db, sheetId, (sheet) => {
    if (!sheet) return cb('NO_SUCH_SHEET');
    const vehicle = attackCwn.getVehicle(sheet.data, index);
    if (!vehicle) return cb('NO_SUCH_VEHICLE');
    const next = Math.max(0, Math.min(vehicle.hpMax, vehicle.hp + amount));
    if (next === vehicle.hp) return cb(null);
    writeSheet(db, sheet.id, { ...sheet.data, [vehicle.hpField]: next }, () => cb(null));
  }, system);
}

/** Set whether an enemy vehicle is moving. It belongs to the car, so everyone aboard agrees. */
function setMoving(db, { sheetId, vehicleIndex, moving, system = SYSTEM }, cb) {
  const index = Number(vehicleIndex);
  loadSheet(db, sheetId, (sheet) => {
    if (!sheet) return cb('NO_SUCH_SHEET');
    if (!attackCwn.getVehicle(sheet.data, index)) return cb('NO_SUCH_VEHICLE');
    writeSheet(db, sheet.id, { ...sheet.data, [`vehicle${index}_moving`]: moving ? 1 : 0 }, () => cb(null));
  }, system);
}

/**
 * Put one of the GM's tokens in a seat.
 *
 * A seat holds one token and a token is in one seat, so this also empties whatever seat it
 * was in — which the UNIQUE on `location_id` would enforce anyway, but replacing explicitly
 * makes moving a ganger from the front to the back one statement rather than two.
 *
 * cb(null) or a short reason. The refusals are things the window should not be able to trip,
 * so they are worth saying no to rather than papering over.
 */
function seatToken(db, { locationId, sheetId, vehicleIndex, seat }, cb) {
  const index = Number(vehicleIndex);
  const seatId = String(seat || '').trim().toLowerCase();
  loadSheet(db, sheetId, (sheet) => {
    if (!sheet) return cb('NO_SUCH_SHEET');
    if (!attackCwn.getVehicle(sheet.data, index)) return cb('NO_SUCH_VEHICLE');
    if (!vehicleSeats.hasSeat(sheet.data, index, seatId)) return cb('NO_SUCH_SEAT');
    // The seat rules are this module's; the table write is the shared one, so the GM path
    // and the player path cannot disagree about what being aboard means.
    vehicleTokens.seat(db, {
      locationId, sheetId: sheet.id, vehicleIndex: index, seat: seatId,
      shapes: GM_TOKEN_SHAPES,
    }, (reason) => cb(reason === 'NOT_INVITABLE' ? 'NOT_A_GM_TOKEN' : reason));
  });
}

/** Take a token out of whatever it is in. Idempotent — no seat is not an error. */
function unseatToken(db, locationId, cb) {
  // No permission check: a token has no autonomy to protect. The "only you can take
  // yourself out" rule exists for people, so anyone may move an NPC — the GM included.
  return vehicleTokens.unseat(db, locationId, cb);
}

module.exports = {
  SYSTEM, GM_TOKEN_SHAPES, roster, loadSheet, adjustHp, setMoving, seatToken, unseatToken, labelOf,
};
