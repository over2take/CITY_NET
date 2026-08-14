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

/** What other players are allowed to see: the numbers they are shooting at, not the sheet. */
function publicState(vehicle) {
  if (!vehicle) return null;
  return JSON.stringify({
    name: vehicle.name,
    ac: vehicle.ac,
    armorRating: vehicle.armorRating,
    hp: vehicle.hp,
    hpMax: vehicle.hpMax,
    moving: vehicle.moving,
  });
}

/**
 * Mirror one player's vehicle state onto their token(s).
 *
 * Also re-mirrors anyone riding with them, because a rider's badge is derived from this
 * player's sheet: change the car's armour and every passenger's token is stale. Riders
 * are found by scanning, which is cheap on a table with one row per player and avoids
 * keeping a second index of who is in whose car.
 */
function syncTokens(db, username, cb) {
  const write = (user, state, done) => {
    db.run(`UPDATE locations SET vehicle_state = ? WHERE shape = 'rhombus' AND owner = ?`,
      [state, user], () => done());
  };
  db.get(
    `SELECT id, data FROM character_sheets WHERE username = ? AND system = ? AND is_npc = 0`,
    [username, SYSTEM],
    (err, row) => {
      if (err || !row) return cb && cb();
      let data;
      try { data = JSON.parse(row.data || '{}'); } catch (e) { return cb && cb(); }
      resolve(db, row.id, data, (vehicle) => {
        write(username, publicState(vehicle), () => {
          db.all(
            `SELECT username, data FROM character_sheets WHERE system = ? AND is_npc = 0 AND username != ?`,
            [SYSTEM, username],
            (err2, rows) => {
              if (err2 || !rows || !rows.length) return cb && cb();
              const riders = rows.filter((r) => {
                let d;
                try { d = JSON.parse(r.data || '{}'); } catch (e) { return false; }
                const occ = attackCwn.readOccupancy(d);
                return !!occ && occ.owner === username;
              });
              let left = riders.length;
              if (!left) return cb && cb();
              riders.forEach((r) => {
                let d = {};
                try { d = JSON.parse(r.data || '{}'); } catch (e) { /* treated as on foot */ }
                resolve(db, null, d, (v) => write(r.username, publicState(v), () => {
                  if (--left === 0 && cb) cb();
                }));
              });
            }
          );
        });
      });
    }
  );
}

module.exports = { SYSTEM, resolve, publicState, syncTokens };
