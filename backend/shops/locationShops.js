// Which of a game's own shops a building is, in that game (8a7b3c1; decided with the user, 2026-11-22: "yes that matches
// and fixes most the edge cases I can think of").
//
// A building has one shared type, the app's (locations.building_type): a Ripperdoc in one game is the Street Doc in the
// next, same building, same stock. A game's own kind of shop (systemBuilder/buildings.js ownShops: an Apothecary, a
// Magican) is that game's alone, so which building is one is kept per game here: a building can be a Magican in one game,
// a Mechanic in another, and its shared type (or none) in CWN. Two games each making a "Magican" never mix, so a shop's id
// need only be unique within its game. Nothing in the definition changes: the system file carries the shops, the map keeps
// which building is which.

const { BUILDING_TYPES } = require('../buildingTypes');
const { ownShops, ownShopOf } = require('../systemBuilder/buildings');

/**
 * The table, run by db.js and by the tests' database. Kept like the GM's notes (buildings/gmNotes.js): through a
 * building's delete, so an undone delete finds them waiting under the same id; carried by a saved map and put back with
 * it; dropped for buildings gone where ids come round again (a map cleared or loaded).
 */
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS location_shops (
    location_id INTEGER NOT NULL,
    system TEXT NOT NULL,
    shop TEXT NOT NULL,
    PRIMARY KEY (location_id, system)
  )`,
];

/**
 * A building's type in a game: the game's own shop it is there, while the game still makes that shop (on or off: an off
 * one is still its type, just no shop), else its shared type. One the game no longer makes falls back to the shared type.
 */
const typeIn = (definition, sharedType, ownShop) => (ownShop && ownShopOf(definition, ownShop) ? ownShop : sharedType || null);

/** The game's own shop each building is in `system`: Map of location id to shop id. */
const shopsIn = (db, system, cb) => db.all('SELECT location_id, shop FROM location_shops WHERE system = ?', [String(system || '')], (err, rows) =>
  (err ? cb(err) : cb(null, new Map((rows || []).map((r) => [r.location_id, r.shop])))));

/** A building made one of `system`'s own shops, or (shop null) none of them, its shared type showing again. */
const setShop = (db, locationId, system, shop, cb) => (shop
  ? db.run('INSERT INTO location_shops (location_id, system, shop) VALUES (?, ?, ?) ON CONFLICT(location_id, system) DO UPDATE SET shop = excluded.shop',
    [locationId, String(system), String(shop)], cb)
  : db.run('DELETE FROM location_shops WHERE location_id = ? AND system = ?', [locationId, String(system)], cb));

/** One building's shared type, buy-back rate and own shop in `system`, read together; null where there is no such building. */
const buildingIn = (db, locationId, system, cb) => db.get(
  `SELECT l.id, l.building_type, l.buyback_pct, s.shop FROM locations l
   LEFT JOIN location_shops s ON s.location_id = l.id AND s.system = ? WHERE l.id = ?`,
  [String(system || ''), locationId], (err, row) => cb(err, row || null),
);

/**
 * The buildings set to a game's own shop before it was kept per game (8a7b3a stored it as the shared type): each given
 * to every game whose published version makes a shop of that id, so whatever worked keeps working, and its shared type
 * cleared. One no game makes is left as it is. Run at start-up; does nothing once done.
 */
const moveOldShops = (db, cb = () => {}) => {
  // Only a type the app hasn't got can be a game's own shop (buildings.js refuses its ids).
  const appTypes = BUILDING_TYPES.map((t) => t.id);
  db.all(`SELECT id, building_type FROM locations WHERE building_type IS NOT NULL AND building_type != '' AND building_type NOT IN (${appTypes.map(() => '?').join(', ')})`, appTypes, (err, old) => {
    if (err) return cb(err);
    if (!old || !old.length) return cb(null, 0);
    db.all('SELECT id, published FROM custom_systems WHERE published IS NOT NULL', [], (sErr, systems) => {
      if (sErr) return cb(sErr);
      const makers = (systems || []).map((s) => {
        let definition = null;
        try { definition = JSON.parse(s.published); } catch { /* a broken copy makes no shops */ }
        return { id: s.id, shops: new Set(ownShops(definition).map((shop) => shop.id)) };
      });
      const moves = old.map((r) => ({ id: r.id, shop: r.building_type, to: makers.filter((m) => m.shops.has(r.building_type)).map((m) => m.id) }))
        .filter((m) => m.to.length);
      db.serialize(() => {
        for (const m of moves) {
          for (const system of m.to) db.run('INSERT OR IGNORE INTO location_shops (location_id, system, shop) VALUES (?, ?, ?)', [m.id, system, m.shop]);
          db.run('UPDATE locations SET building_type = NULL WHERE id = ?', [m.id]);
        }
        db.get('SELECT 1', [], (dErr) => cb(dErr || null, moves.length));
      });
    });
  });
};

/** Drop the rows of buildings that no longer exist: after a map is cleared, before its ids come round again. */
const pruneOrphans = (db, cb = () => {}) => db.run('DELETE FROM location_shops WHERE location_id NOT IN (SELECT id FROM locations)', (err) => cb(err || null));

/** Every row, for a saved map to carry. */
const all = (db, cb) => db.all('SELECT location_id, system, shop FROM location_shops', (err, rows) => cb(err, rows || []));

/**
 * Put back the rows a saved map carried, replacing whatever was there: only for buildings the map has once it is in, so
 * none lands on a later building with the same id. A map saved before these traveled carries none; its buildings set to a
 * game's own shop the old way are then moved as at start-up (moveOldShops).
 */
const replaceAll = (db, rows, cb = () => {}) => {
  db.serialize(() => {
    db.run('DELETE FROM location_shops');
    const stmt = db.prepare(
      `INSERT OR REPLACE INTO location_shops (location_id, system, shop)
       SELECT ?, ?, ? WHERE EXISTS (SELECT 1 FROM locations WHERE id = ?)`,
    );
    for (const r of Array.isArray(rows) ? rows : []) {
      if (!r || r.location_id == null || !r.system || !r.shop) continue;
      stmt.run([r.location_id, String(r.system), String(r.shop), r.location_id]);
    }
    stmt.finalize((err) => (err ? cb(err) : moveOldShops(db, (mErr) => cb(mErr || null))));
  });
};

/** How many buildings are each of `system`'s own shops there (8a7b3b, for FEATURES' DELETE): { shop id: count }. */
const countsIn = (db, system, cb) => db.all(
  `SELECT s.shop, COUNT(*) AS n FROM location_shops s JOIN locations l ON l.id = s.location_id WHERE s.system = ? GROUP BY s.shop`,
  [String(system || '')], (err, rows) => cb(err, Object.fromEntries((rows || []).map((r) => [r.shop, r.n]))),
);

/**
 * A game published without some of its own shops (8a7b3b, DELETE on FEATURES): its buildings let go of them, each its
 * shared type again, so one made later with the same name starts with none. `kept` are the shop ids the game still makes.
 * Answers how many buildings let go.
 */
const dropGone = (db, system, kept, cb = () => {}) => {
  const ids = (kept || []).map(String);
  db.run(`DELETE FROM location_shops WHERE system = ?${ids.length ? ` AND shop NOT IN (${ids.map(() => '?').join(', ')})` : ''}`,
    [String(system), ...ids], function done(err) { cb(err || null, err ? 0 : this.changes); });
};

module.exports = { SCHEMA, typeIn, shopsIn, setShop, buildingIn, moveOldShops, pruneOrphans, all, replaceAll, countsIn, dropGone };
