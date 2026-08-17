// The vehicle a character is riding in, resolved against the database.
//
// attackCwn holds the rules — how to read the declaration, what a vehicle's AC and
// armour work out to. This holds the one thing those cannot: a rider points at another
// player's sheet by name, so resolving them takes a query.
//
// Two callers share it. The attack path asks what is standing between a defender and a
// bullet; the token mirror asks the same question so everyone else can see the answer
// before they shoot. They must agree, which is why this is one function rather than two.
//
// Which system's sheets to read is a parameter rather than a constant. Only one system is
// ever live in a game, and a table that has played both should not find last campaign's
// cars on this campaign's roster — so the seating and roster calls are told the active
// system, and the combat path, which is CWN's own, passes CWN.

const attackCwn = require('./attackCwn');
const vehicleSeats = require('./vehicleSeats');

/** The default for the CWN combat path, which is the only caller that is system-specific. */
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
    const vehicle = attackCwn.getVehicle(ownerData, occ.vehicleIndex);
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
      const vehicle = attackCwn.getVehicle(ownerData, occ.vehicleIndex);
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

/**
 * The character's name, falling back to the login name when the sheet has none.
 *
 * `identity` is required here rather than at the top: it requires this module for the
 * vehicle mirror, and a cycle at load time leaves one of the two half-built. The require
 * cache makes the repeat call free.
 */
const displayNameOf = (data, username, system = SYSTEM) => {
  const { nameField } = require('./identity');
  return String(data?.[nameField(system)] ?? '').trim() || username;
};

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
function syncAll(db, cb, system = SYSTEM) {
  const done = () => cb && cb();
  db.all(
    `SELECT id, username, data FROM character_sheets WHERE system = ? AND is_npc = 0`,
    [system],
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
          ? attackCwn.getVehicle(ownerSheet.data, occ.vehicleIndex)
          : null;
        const usable = vehicle && !vehicle.destroyed ? vehicle : null;
        // Names rather than logins: this is read by people, on a badge and in an attack
        // panel, and nobody at the table thinks of each other by account name.
        const occupants = usable
          ? (aboard.get(vehicleKey(sh.username, occ)) || []).map(u => displayNameOf(byUser.get(u)?.data, u, system))
          : [];
        db.run(
          `UPDATE locations SET vehicle_state = ? WHERE shape = 'rhombus' AND owner = ?`,
          [publicState(usable, occupants), sh.username],
          () => { if (--left === 0) done(); }
        );
      }
    }
  );
}


/** The occupancy fields, as one place so seating and unseating cannot disagree. */
const OCCUPANCY_FIELDS = ['in_vehicle', 'ride_owner', 'ride_vehicle', 'vehicle_seat'];

const clearOccupancy = (data) => {
  const out = { ...data };
  OCCUPANCY_FIELDS.forEach((f) => { delete out[f]; });
  return out;
};

/** Read one sheet by username, in the given system. cb(null) when they have none. */
function loadSheet(db, username, cb, system = SYSTEM) {
  db.get(
    `SELECT id, username, data FROM character_sheets WHERE username = ? AND system = ? AND is_npc = 0`,
    [String(username || '').trim(), system],
    (err, row) => {
      if (err || !row) return cb(null);
      try { cb({ id: row.id, username: row.username, data: JSON.parse(row.data || '{}') }); }
      catch (e) { cb(null); }
    }
  );
}

const writeSheet = (db, id, data, cb) =>
  db.run(`UPDATE character_sheets SET data = ? WHERE id = ?`, [JSON.stringify(data), id], () => cb());

/**
 * Put someone in a seat.
 *
 * A seat holds one person and a person is in one seat, so this also empties whatever seat
 * they were in and turns out whoever was in this one. That is what the window's dropdowns
 * mean: choosing a name for a seat is a statement about where everyone is, not just an
 * addition.
 *
 * cb(null) on success, or a short reason. The reasons are checks the window should not be
 * able to trip — a seat that is not on the vehicle, a vehicle that does not exist — so
 * they are worth refusing rather than papering over.
 */
function seatIn(db, { occupant, owner, vehicleIndex, seat, system = SYSTEM }, cb) {
  const index = Number(vehicleIndex);
  loadSheet(db, owner, (ownerSheet) => {
    if (!ownerSheet) return cb('NO_SUCH_VEHICLE_OWNER');
    if (!attackCwn.getVehicle(ownerSheet.data, index)) return cb('NO_SUCH_VEHICLE');
    if (!vehicleSeats.hasSeat(ownerSheet.data, index, seat)) return cb('NO_SUCH_SEAT');

    loadSheet(db, occupant, (occSheet) => {
      if (!occSheet) return cb('NO_SUCH_PLAYER');
      const seatId = String(seat).trim().toLowerCase();
      const isOwn = occSheet.username === ownerSheet.username;
      const data = {
        ...clearOccupancy(occSheet.data),
        in_vehicle: isOwn ? `own:${index}` : 'ride',
        vehicle_seat: seatId,
      };
      if (!isOwn) { data.ride_owner = ownerSheet.username; data.ride_vehicle = index; }

      // Turn out whoever was already in this seat — one seat, one person.
      db.all(
        `SELECT id, username, data FROM character_sheets WHERE system = ? AND is_npc = 0`,
        [system],
        (err, rows) => {
          const evictions = [];
          for (const r of rows || []) {
            if (r.username === occSheet.username) continue;
            let d;
            try { d = JSON.parse(r.data || '{}'); } catch (e) { continue; }
            const occ = attackCwn.readOccupancy(d);
            if (!occ || occ.seat !== seatId) continue;
            if ((occ.owner || r.username) !== ownerSheet.username || occ.vehicleIndex !== index) continue;
            evictions.push({ id: r.id, data: clearOccupancy(d) });
          }
          let left = evictions.length + 1;
          const done = () => { if (--left === 0) cb(null); };
          evictions.forEach(e => writeSheet(db, e.id, e.data, done));
          writeSheet(db, occSheet.id, data, done);
        }
      );
    }, system);
  }, system);
}

/** Take someone out of whatever they are in. Idempotent — no seat is not an error. */
function seatOut(db, occupant, cb, system = SYSTEM) {
  loadSheet(db, occupant, (sheet) => {
    if (!sheet) return cb('NO_SUCH_PLAYER');
    writeSheet(db, sheet.id, clearOccupancy(sheet.data), () => cb(null));
  }, system);
}

/**
 * Damage or repair a vehicle by hand.
 *
 * Combat already writes this field when someone shoots the car. This is for everything
 * combat does not model — a crash, a ram, an explosion, and above all the repair
 * afterwards, which until now meant opening the owner's sheet and editing the number.
 *
 * Clamped to the hull rather than trusting the client: a repair cannot exceed the maximum
 * and damage cannot drive it below zero, so `destroyed` stays a fact derived from HP
 * instead of a state the UI can invent. Landing exactly where it already was is not an
 * error — it just writes nothing.
 */
function adjustHp(db, { owner, vehicleIndex, delta, system = SYSTEM }, cb) {
  const index = Number(vehicleIndex);
  const amount = Math.trunc(Number(delta));
  if (!Number.isFinite(amount) || amount === 0) return cb('NO_CHANGE');
  loadSheet(db, owner, (ownerSheet) => {
    if (!ownerSheet) return cb('NO_SUCH_VEHICLE_OWNER');
    const vehicle = attackCwn.getVehicle(ownerSheet.data, index);
    if (!vehicle) return cb('NO_SUCH_VEHICLE');
    const next = Math.max(0, Math.min(vehicle.hpMax, vehicle.hp + amount));
    if (next === vehicle.hp) return cb(null);
    writeSheet(db, ownerSheet.id, { ...ownerSheet.data, [vehicle.hpField]: next }, () => cb(null));
  }, system);
}

/** Set whether a vehicle is moving. It belongs to the car, so everyone aboard agrees. */
function setMoving(db, { owner, vehicleIndex, moving, system = SYSTEM }, cb) {
  const index = Number(vehicleIndex);
  loadSheet(db, owner, (ownerSheet) => {
    if (!ownerSheet) return cb('NO_SUCH_VEHICLE_OWNER');
    if (!attackCwn.getVehicle(ownerSheet.data, index)) return cb('NO_SUCH_VEHICLE');
    const data = { ...ownerSheet.data, [`vehicle${index}_moving`]: moving ? 1 : 0 };
    writeSheet(db, ownerSheet.id, data, () => cb(null));
  }, system);
}


/**
 * Every vehicle in play, with who is in which seat.
 *
 * Built from all the sheets at once rather than per-player, because a vehicle's occupants
 * are spread across their own sheets — the car does not know who is in it, the passengers
 * know which car they are in. One pass turns that inside out.
 *
 * Only the numbers a table needs travel. The rest of anyone's sheet stays where it is.
 */
function roster(db, cb, system = SYSTEM) {
  db.all(
    `SELECT username, data FROM character_sheets WHERE system = ? AND is_npc = 0 ORDER BY username`,
    [system],
    (err, rows) => {
      if (err || !rows) return cb({ vehicles: [], players: [] });
      const sheets = rows.map((r) => {
        let data;
        try { data = JSON.parse(r.data || '{}'); } catch (e) { data = {}; }
        return { username: r.username, data };
      });

      // Who is sitting where, keyed so a rider and the owner agree on the car.
      const seated = new Map();
      for (const sh of sheets) {
        const occ = attackCwn.readOccupancy(sh.data);
        if (!occ || !occ.seat) continue;
        const key = vehicleKey(sh.username, occ);
        if (!seated.has(key)) seated.set(key, {});
        seated.get(key)[occ.seat] = sh.username;
      }

      const vehicles = [];
      for (const sh of sheets) {
        for (let i = 1; i <= attackCwn.VEHICLE_ROWS; i++) {
          const vehicle = attackCwn.getVehicle(sh.data, i);
          if (!vehicle) continue;
          vehicles.push({
            owner: sh.username,
            ownerName: displayNameOf(sh.data, sh.username, system),
            index: i,
            name: vehicle.name,
            type: String(sh.data[`vehicle${i}_type`] || ''),
            ac: vehicle.ac,
            armorRating: vehicle.armorRating,
            hp: vehicle.hp,
            hpMax: vehicle.hpMax,
            moving: vehicle.moving,
            destroyed: vehicle.destroyed,
            crew: vehicleSeats.crewOf(sh.data, i),
            seats: vehicleSeats.seatsFor(sh.data, i),
            occupants: seated.get(`${sh.username}:${i}`) || {},
          });
        }
      }
      // The username is the key everything else is written against, so it travels with
      // the name rather than being replaced by it.
      cb({
        vehicles,
        players: sheets.map(sh => ({ username: sh.username, name: displayNameOf(sh.data, sh.username, system) })),
      });
    }
  );
}

module.exports = {
  SYSTEM, resolve, publicState, syncAll, vehicleKey, getRideMounts, getRideWeapon,
  seatIn, seatOut, setMoving, adjustHp, loadSheet, roster, OCCUPANCY_FIELDS,
};
