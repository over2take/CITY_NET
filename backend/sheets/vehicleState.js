// The vehicle a CWN character is riding in, resolved against the database.
//
// attackCwn holds the rules — how to read the declaration, what a vehicle's AC and
// armour work out to. This holds the one thing those cannot: a rider points at another
// player's sheet by name, so resolving them takes a query.
//
// Two callers share it. The attack path asks what is standing between a defender and a
// bullet; the token mirror asks the same question so everyone else can see the answer
// before they shoot. They must agree, which is why this is one function rather than two.

const attackCwn = require('./attackCwn');

const SYSTEM = 'cities_without_number';

/**
 * cb(vehicle | null). Null means on foot, and every unreadable state resolves to it —
 * an owner who has been purged, a vehicle row never filled in, a wreck. A destroyed
 * vehicle stops being cover rather than absorbing forever.
 */
function resolve(db, sheetId, sheetData, cb) {
  const occ = attackCwn.readOccupancy(sheetData);
  if (!occ) return cb(null);
  const done = (ownerSheetId, ownerData) => {
    const vehicle = attackCwn.getVehicle(ownerData, occ.vehicleIndex, { moving: occ.moving });
    cb(vehicle && !vehicle.destroyed ? { ...vehicle, sheetId: ownerSheetId } : null);
  };
  if (!occ.owner) {
    if (!sheetId) return cb(null);
    return done(sheetId, sheetData);
  }
  db.get(
    `SELECT id, data FROM character_sheets WHERE username = ? AND system = ? AND is_npc = 0`,
    [occ.owner, SYSTEM],
    (err, row) => {
      if (err || !row) return cb(null);
      let ownerData;
      try { ownerData = JSON.parse(row.data || '{}'); } catch (e) { return cb(null); }
      done(row.id, ownerData);
    }
  );
}

/**
 * The mounts on the vehicle a player is riding in, when the vehicle is someone else's.
 *
 * A gunner fires the car's guns with their own skill, so the weapon row has to come off
 * the owner's sheet — which the gunner cannot see. Only the mount rows travel, and only
 * to someone who has declared they are sitting in that vehicle.
 *
 * cb(null) when on foot or in one of their own vehicles: those mounts are already on the
 * sheet the client holds.
 */
function getRideMounts(db, sheetData, cb) {
  const occ = attackCwn.readOccupancy(sheetData);
  if (!occ || !occ.owner) return cb(null);
  db.get(
    `SELECT data FROM character_sheets WHERE username = ? AND system = ? AND is_npc = 0`,
    [occ.owner, SYSTEM],
    (err, row) => {
      if (err || !row) return cb(null);
      let ownerData;
      try { ownerData = JSON.parse(row.data || '{}'); } catch (e) { return cb(null); }
      const vehicle = attackCwn.getVehicle(ownerData, occ.vehicleIndex, { moving: occ.moving });
      if (!vehicle) return cb(null);
      const mounts = [];
      for (let i = 1; i <= attackCwn.VEHICLE_WEAPON_ROWS; i++) {
        const weapon = attackCwn.getVehicleWeapon(ownerData, occ.vehicleIndex, i);
        if (weapon) mounts.push({ index: i, name: weapon.name, dmg: weapon.dmg, skill: weapon.skill });
      }
      cb(mounts.length ? { owner: occ.owner, vehicleName: vehicle.name, mounts } : null);
    }
  );
}

/**
 * The mount a rider is firing, resolved off the owner's sheet.
 *
 * cb(null) when they are not riding in someone else's vehicle — the caller then falls
 * back to the ordinary "not a valid weapon" error rather than silently firing something
 * else.
 */
function getRideWeapon(db, sheetData, weaponIndex, cb) {
  const occ = attackCwn.readOccupancy(sheetData);
  if (!occ || !occ.owner) return cb(null);
  db.get(
    `SELECT data FROM character_sheets WHERE username = ? AND system = ? AND is_npc = 0`,
    [occ.owner, SYSTEM],
    (err, row) => {
      if (err || !row) return cb(null);
      let ownerData;
      try { ownerData = JSON.parse(row.data || '{}'); } catch (e) { return cb(null); }
      cb(attackCwn.getVehicleWeapon(ownerData, occ.vehicleIndex, weaponIndex));
    }
  );
}

/** What other players are allowed to see: the numbers they are shooting at, not the sheet. */
function publicState(vehicle, occupants = []) {
  if (!vehicle) return null;
  return JSON.stringify({
    name: vehicle.name,
    ac: vehicle.ac,
    armorRating: vehicle.armorRating,
    hp: vehicle.hp,
    hpMax: vehicle.hpMax,
    moving: vehicle.moving,
    occupants,
  });
}

/** Which vehicle a sheet is in, as a key two occupants of the same car agree on. */
const vehicleKey = (username, occ) => `${occ.owner || username}:${occ.vehicleIndex}`;

/**
 * Recompute every player's vehicle state and mirror it onto their token(s).
 *
 * Whole-table rather than one player, because occupancy is not a property of one sheet:
 * boarding someone's car changes what their badge should say as much as yours, and the
 * badge now names who is aboard. Working out which subset to refresh means working out
 * the whole thing anyway, so the partial version was only ever more code for the same
 * scan — on a table with one row per player.
 */
function syncAll(db, cb) {
  const done = () => cb && cb();
  db.all(
    `SELECT id, username, data FROM character_sheets WHERE system = ? AND is_npc = 0`,
    [SYSTEM],
    (err, rows) => {
      if (err || !rows) return done();
      const sheets = rows.map((r) => {
        let data;
        try { data = JSON.parse(r.data || '{}'); } catch (e) { data = {}; }
        return { id: r.id, username: r.username, data };
      });
      const byUser = new Map(sheets.map(sh => [sh.username, sh]));

      // Everyone aboard each car, keyed so a rider and the owner land in the same bucket.
      const aboard = new Map();
      const occupancy = new Map();
      for (const sh of sheets) {
        const occ = attackCwn.readOccupancy(sh.data);
        if (!occ) continue;
        occupancy.set(sh.username, occ);
        const key = vehicleKey(sh.username, occ);
        if (!aboard.has(key)) aboard.set(key, []);
        aboard.get(key).push(sh.username);
      }

      let left = sheets.length;
      if (!left) return done();
      for (const sh of sheets) {
        const occ = occupancy.get(sh.username);
        const ownerSheet = occ ? (occ.owner ? byUser.get(occ.owner) : sh) : null;
        const vehicle = ownerSheet
          ? attackCwn.getVehicle(ownerSheet.data, occ.vehicleIndex, { moving: occ.moving })
          : null;
        const usable = vehicle && !vehicle.destroyed ? vehicle : null;
        const occupants = usable ? (aboard.get(vehicleKey(sh.username, occ)) || []) : [];
        db.run(
          `UPDATE locations SET vehicle_state = ? WHERE shape = 'rhombus' AND owner = ?`,
          [publicState(usable, occupants), sh.username],
          () => { if (--left === 0) done(); }
        );
      }
    }
  );
}

module.exports = { SYSTEM, resolve, publicState, syncAll, vehicleKey, getRideMounts, getRideWeapon };
